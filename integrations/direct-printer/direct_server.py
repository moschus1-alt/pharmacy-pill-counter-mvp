"""LAN-only HTTPS counter/label receiver. No cloud clients or polling.

Use DirectPrinterServer(print_label=existing_callback, ...) in UPharmDaily.
print_label runs on one worker and must return 'spooled' only after GDI accepts.
"""
from __future__ import annotations
import datetime as dt
import gzip
import hashlib
import hmac
import ipaddress
import json
import mimetypes
import os
from pathlib import Path
import queue
import re
import secrets
import socket
import sqlite3
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs, unquote
from uuid import UUID

SPOOLED = 'spooled'
class PrintRejected(Exception):
    def __init__(self, reason='uncertain'):
        self.reason = reason if reason in ('printer','layout','uncertain') else 'uncertain'
        super().__init__(self.reason)
class RequestError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message
        super().__init__(message)

def private_ipv4(host):
    try:
        ip=ipaddress.IPv4Address(host)
        return any(ip in ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'))
    except ValueError:return False

def validate_label(value):
    if not isinstance(value,dict):raise RequestError(400,'라벨 내용을 확인해 주세요.')
    limits={'code':100,'name':80,'strength':40,'manufacturer':60,'lot':40,'packedOn':10,'expiry':10,'useBy':10,'size':10}
    out={}
    for key,limit in limits.items():
        text=value.get(key,'')
        if not isinstance(text,str) or len(text)>limit or any(ord(c)<32 for c in text):raise RequestError(400,'라벨 입력 길이와 내용을 확인해 주세요.')
        out[key]=text.strip()
    depth=0;name=[]
    for c in out['name']:
        if c in '(（':depth+=1
        elif c in ')）':depth=max(0,depth-1)
        elif not depth and c not in '_＿':name.append(c)
    out['name']=' '.join(''.join(name).split())
    if not out['name'] or not re.fullmatch(r'[\x20-\x7e]+',out['code']):raise RequestError(400,'제품명과 바코드를 확인해 주세요.')
    for key,maximum in [('count',99999),('copies',20)]:
        n=value.get(key)
        if type(n) is not int or not 1<=n<=maximum:raise RequestError(400,'수량과 출력 매수를 확인해 주세요.')
        out[key]=n
    for key in ('packedOn','expiry','useBy'):
        text=out[key]
        if key=='packedOn' and not text:raise RequestError(400,'소분일을 입력해 주세요.')
        if text:
            try:
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',text) or dt.date.fromisoformat(text).isoformat()!=text:raise ValueError()
            except ValueError:raise RequestError(400,'날짜를 확인해 주세요.')
    if any(out[k] and out[k]<out['packedOn'] for k in ('expiry','useBy')) or (out['expiry'] and out['useBy'] and out['useBy']>out['expiry']):raise RequestError(400,'사용기한을 확인해 주세요.')
    if out['size'] in ('custom','dk22210'):
        for key in ('widthMm','heightMm'):
            n=value.get(key)
            if type(n) not in (int,float) or not 12<=n<=200 or abs(n*10-round(n*10))>1e-6:raise RequestError(400,'라벨 크기를 확인해 주세요.')
            out[key]=n
        if out['size']=='dk22210' and out['widthMm']!=29:raise RequestError(400,'DK-22210 용지 폭은 29mm예요.')
    elif out['size'] not in ('60x40','70x50','50x30','62x29','62x100','29x90'):raise RequestError(400,'지원하지 않는 라벨 크기예요.')
    return out

class PrintQueue:
    """Persist IDs/status/hash, never medications. Crash/reply loss never reprints."""
    def __init__(self,directory,print_label,on_change=lambda:None):
        self.lock=threading.RLock();self.callback=print_label;self.changed=on_change
        self.db=sqlite3.connect(str(Path(directory)/'direct-jobs.sqlite'),check_same_thread=False)
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, digest TEXT NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL,created REAL NOT NULL)')
        self.db.execute("UPDATE jobs SET status='failed',reason='uncertain' WHERE status IN ('queued','processing')")
        self.db.commit()
        self.paused=bool(self.db.execute("SELECT 1 FROM jobs WHERE status='failed' AND reason!='acknowledged' LIMIT 1").fetchone())
        self.items=queue.Queue(20);self.stopping=threading.Event()
        self.thread=threading.Thread(target=self.run,name='direct-printer',daemon=True);self.thread.start()
    def submit(self,job_id,label):
        try:
            if str(UUID(job_id))!=job_id:raise ValueError()
        except (ValueError,TypeError,AttributeError):raise RequestError(400,'출력 요청 번호가 올바르지 않아요.')
        label=validate_label(label);digest=hashlib.sha256(json.dumps(label,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        with self.lock:
            row=self.db.execute('SELECT digest,status,reason FROM jobs WHERE id=?',(job_id,)).fetchone()
            if row:
                if row[0]!=digest:raise RequestError(409,'같은 요청 번호의 라벨 내용이 달라요.')
                return {'jobId':job_id,'duplicate':True,'status':row[1],'reason':row[2]}
            if self.stopping.is_set() or self.paused:raise RequestError(409,'PC에서 실제 출력물과 프린터를 확인한 뒤 수신을 재개해 주세요.')
            if self.items.full():raise RequestError(429,'PC가 이전 라벨을 처리 중이에요. 잠시 후 다시 보내 주세요.')
            self.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?)',(job_id,digest,'queued','',time.time()));self.db.commit()
            self.items.put_nowait((job_id,label))
        self.changed();return {'jobId':job_id,'status':'queued'}
    def status(self,job_id):
        with self.lock:row=self.db.execute('SELECT status,reason FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not row:raise RequestError(404,'출력 요청을 찾지 못했어요.')
        return {'status':'waiting' if row[0]=='queued' else row[0],'reason':row[1]}
    def set_status(self,job_id,status,reason=''):
        with self.lock:
            self.db.execute('UPDATE jobs SET status=?,reason=? WHERE id=?',(status,reason,job_id));self.db.commit()
        self.changed()
    def run(self):
        while not self.stopping.is_set():
            try:job_id,label=self.items.get(timeout=.2)
            except queue.Empty:continue
            try:
                with self.lock:
                    if self.paused or self.stopping.is_set():
                        self.set_status(job_id,'failed','printer');continue
                    self.set_status(job_id,'processing')
                try:
                    if self.callback(label)!=SPOOLED:raise PrintRejected('uncertain')
                except Exception as error:
                    # Accept the existing UPharmDaily PrintRejected class too.
                    reason=getattr(error,'reason','uncertain')
                    if reason not in ('printer','layout','uncertain'):reason='uncertain'
                    with self.lock:self.paused=True
                    self.set_status(job_id,'failed',reason)
                else:self.set_status(job_id,'spooled')
            except Exception:
                # In particular, a journal write failure after driver submission
                # leaves 'processing' durable. No retry of the print callback.
                with self.lock:self.paused=True
                self.changed()
            finally:self.items.task_done()
    def resume(self):
        with self.lock:
            self.db.execute("UPDATE jobs SET reason='acknowledged' WHERE status='failed'");self.db.commit();self.paused=False
        self.changed()
    def close(self):
        self.stopping.set();self.thread.join()
        with self.lock:
            self.db.execute("UPDATE jobs SET status='failed',reason='uncertain' WHERE status='queued'");self.db.commit();self.db.close()

def certificates(directory,host):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes,serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID
    directory=Path(directory);now=dt.datetime.now(dt.timezone.utc)
    ca_path=directory/'phone-ca.crt';key_path=directory/'ca-key.pem';cert_path=directory/'server.crt';server_key_path=directory/'server-key.pem'
    if not ca_path.exists():
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Pill Counter Local PC '+secrets.token_hex(4))])
        # This CA can issue only for loopback and private LAN IPs, not websites.
        ca=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-dt.timedelta(days=1)).not_valid_after(now+dt.timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True)
            .add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),critical=True)
            .add_extension(x509.NameConstraints(permitted_subtrees=[x509.IPAddress(ipaddress.ip_network(n)) for n in ('127.0.0.0/8','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')],excluded_subtrees=[x509.DNSName('')]),critical=True)
            .sign(key,hashes.SHA256()))
        key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        ca_path.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    key=serialization.load_pem_private_key(key_path.read_bytes(),password=None);ca=x509.load_pem_x509_certificate(ca_path.read_bytes())
    existing=x509.load_pem_x509_certificate(cert_path.read_bytes()) if cert_path.exists() else None
    addresses={ipaddress.ip_address(host),ipaddress.ip_address('127.0.0.1')}
    if not existing or existing.not_valid_after_utc<now+dt.timedelta(days=7) or not addresses.issubset(set(existing.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.IPAddress))):
        server_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        cert=(x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Pill Counter PC')])).issuer_name(ca.subject).public_key(server_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-dt.timedelta(days=1)).not_valid_after(min(now+dt.timedelta(days=365),ca.not_valid_after_utc))
              .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ip) for ip in sorted(addresses,key=str)]),critical=False)
              .add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True)
              .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False)
              .sign(key,hashes.SHA256()))
        cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM));server_key_path.write_bytes(server_key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    for path in (key_path,server_key_path):path.chmod(0o600)
    return cert_path,server_key_path,hashlib.sha256(ca.public_bytes(serialization.Encoding.DER)).hexdigest().upper()

class BoundedServer(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,*args,**kwargs):self.slots=threading.BoundedSemaphore(40);super().__init__(*args,**kwargs)
    def get_request(self):
        connection,address=super().get_request();connection.settimeout(15)
        if hasattr(self,'tls_context'):
            try:connection=self.tls_context.wrap_socket(connection,server_side=True)
            except Exception:connection.close();raise
        return connection,address
    def process_request(self,request,address):
        if not self.slots.acquire(False):request.close();return
        try:super().process_request(request,address)
        except Exception:self.slots.release();raise
    def process_request_thread(self,*args):
        try:super().process_request_thread(*args)
        finally:self.slots.release()

class DirectPrinterServer:
    def __init__(self,print_label,*,printer_name,web_root,data_dir,host,port=8443,setup_port=8444,name='약국 라벨 PC',catalog_dir=None,on_event=None,allow_loopback_test=False):
        if not private_ipv4(host) and not(allow_loopback_test and host=='127.0.0.1'):raise ValueError('Select this PC’s private IPv4 LAN address')
        self.host=host;self.port=port;self.setup_port=setup_port;self.name=name;self.printer=printer_name;self.web_root=Path(web_root).resolve();self.data_dir=Path(data_dir);self.data_dir.mkdir(parents=True,exist_ok=True)
        self.catalog_dir=Path(catalog_dir) if catalog_dir else None;self.catalog=None;self.catalog_lock=threading.Lock()
        self.subscribers=set();self.event_lock=threading.Lock();self.stop_event=threading.Event();self.on_event=on_event or (lambda event:None)
        self.token=secrets.token_hex(32);self.admin_token=secrets.token_hex(32);self.expires=time.time()+8*3600
        self.jobs=PrintQueue(self.data_dir,print_label,self.broadcast)
        try:
            cert,key,self.fingerprint=certificates(self.data_dir,host)
            context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.minimum_version=ssl.TLSVersion.TLSv1_2;context.load_cert_chain(cert,key)
            self.https=BoundedServer(('0.0.0.0' if host!='127.0.0.1' else host,port),self.handler(True));self.port=self.https.server_address[1];self.https.tls_context=context
            self.setup=BoundedServer(('0.0.0.0' if host!='127.0.0.1' else host,setup_port),self.handler(False));self.setup_port=self.setup.server_address[1]
        except Exception:
            if hasattr(self,'https'):self.https.server_close()
            self.jobs.close();raise
    @property
    def origin(self):return f'https://{self.host}:{self.port}'
    @property
    def mobile_url(self):return self.origin+'/local.html#direct='+self.token
    @property
    def setup_url(self):return f'http://{self.host}:{self.setup_port}/setup#port={self.port}'
    @property
    def admin_url(self):return f'http://127.0.0.1:{self.setup_port}/admin#admin='+self.admin_token
    def info(self):
        return {'name':self.name,'printerName':self.printer,'state':'error' if self.jobs.paused else 'ready','expiresAt':int(self.expires*1000),'transport':'lan','online':not self.stop_event.is_set()}
    def broadcast(self):
        with self.event_lock:
            for q in self.subscribers:
                try:q.put_nowait(self.info())
                except queue.Full:pass
        try:self.on_event(self.info())
        except Exception:pass
    def rotate(self):self.token=secrets.token_hex(32);self.expires=time.time()+8*3600;self.broadcast()
    def start(self):
        for server in (self.https,self.setup):threading.Thread(target=server.serve_forever,daemon=True).start()
    def stop(self):
        self.stop_event.set();self.broadcast()
        for server in (self.https,self.setup):server.shutdown();server.server_close()
        self.jobs.close()
    def lookup(self,code):
        if not re.fullmatch(r'\d{13,14}',code) or sum(int(d)*(3 if i%2 else 1) for i,d in enumerate(reversed(code)))%10:raise RequestError(400,'잘못된 제품 코드예요.')
        if code.startswith('0') and len(code)==14:code=code[1:]
        with self.catalog_lock:
            if self.catalog is None:
                if not self.catalog_dir:raise RequestError(503,'PC에 제품 목록이 없어요. 직접 입력해 주세요.')
                source=json.loads((self.catalog_dir/'drug-catalog-source.json').read_text('utf8'));data=(self.catalog_dir/'drug-catalog.json.gz').read_bytes()
                if hashlib.sha256(data).hexdigest()!=source['catalogSha256']:raise RequestError(503,'제품 목록 검증에 실패했어요.')
                self.catalog=(json.loads(gzip.decompress(data)),source)
        entries,source=self.catalog;rows=entries.get(code,[]);result={'status':'not_found','code':code,'source':{k:source[v] for k,v in {'provider':'provider','title':'title','url':'sourceUrl','asOf':'asOf','license':'license'}.items()}}
        if not rows:return result
        if len(rows)!=1:result['status']='ambiguous';return result
        product=dict(zip(('name','manufacturer','strength','packageQuantity','dosageForm','packageType','itemCode','cancelledOn','transferEndedOn'),rows[0]));product['code']=code
        if product['strength']=='없음':product['strength']=''
        result.update(product=product,status='historical' if any(product[k] and product[k]<=source['asOf'] for k in ('cancelledOn','transferEndedOn')) else 'found');return result
    def handler(self,tls):
        app=self
        class Handler(BaseHTTPRequestHandler):
            server_version='PillCounterLAN/1';sys_version=''
            def log_message(self,*args):pass  # No tokens, medication or URLs in logs.
            def setup(self):super().setup();self.connection.settimeout(20)
            def send_bytes(self,status,data,content_type='application/json; charset=utf-8',headers=None):
                self.send_response(status);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');self.send_header('X-Frame-Options','DENY')
                for k,v in (headers or {}).items():self.send_header(k,v)
                self.end_headers();self.wfile.write(data)
            def reply(self,status,value):self.send_bytes(status,json.dumps(value,ensure_ascii=False,allow_nan=False).encode())
            def authenticate(self,admin=False):
                origin=self.headers.get('Origin');expected=f'http://127.0.0.1:{app.setup_port}' if admin else app.origin
                if origin and origin!=expected:raise RequestError(403,'다른 사이트의 요청은 허용하지 않아요.')
                if admin and self.client_address[0]!='127.0.0.1':raise RequestError(403,'PC에서만 설정할 수 있어요.')
                token=self.headers.get('Authorization','').removeprefix('Bearer ')
                if not re.fullmatch(r'[a-f0-9]{64}',token) or not hmac.compare_digest(token,app.admin_token if admin else app.token):raise RequestError(403,'PC의 연결 QR을 다시 읽어 주세요.')
                if not admin and time.time()>=app.expires:raise RequestError(410,'PC 연결이 만료됐어요. 새 QR을 읽어 주세요.')
            def dispatch(self,post=False):
                host=self.headers.get('Host','');valid={f'{app.host}:{app.port if tls else app.setup_port}',f'127.0.0.1:{app.port if tls else app.setup_port}'}
                if host not in valid:raise RequestError(403,'PC 주소를 확인해 주세요.')
                url=urlsplit(self.path);path=unquote(url.path)
                if path=='/api/print-relay':raise RequestError(410,'클라우드 라벨 수신은 종료됐어요. PC 직접 연결을 이용해 주세요.')
                if not tls:
                    if path=='/admin' and not post:
                        if self.client_address[0]!='127.0.0.1':raise RequestError(403,'PC에서 열어 주세요.')
                        return self.send_bytes(200,(Path(__file__).parent/'admin.html').read_bytes(),'text/html; charset=utf-8')
                    if path=='/api/admin':
                        self.authenticate(True)
                        if post:
                            action=self.body().get('action')
                            if action=='resume':app.jobs.resume()
                            elif action=='rotate':app.rotate()
                            else:raise RequestError(400,'설정 요청을 확인해 주세요.')
                        return self.reply(200,{**app.info(),'setupUrl':app.setup_url,'mobileUrl':app.mobile_url,'fingerprint':app.fingerprint})
                    if post:raise RequestError(405,'허용하지 않는 요청이에요.')
                    if path=='/setup':return self.send_bytes(200,(Path(__file__).parent/'setup.html').read_bytes(),'text/html; charset=utf-8')
                    if path=='/phone-ca.crt':return self.send_bytes(200,(app.data_dir/'phone-ca.crt').read_bytes(),'application/x-x509-ca-cert',{'Content-Disposition':'attachment; filename="PillCounter-PC.crt"'})
                    if path=='/qrcode.js':return self.send_bytes(200,(app.web_root/'vendor/qrcode.js').read_bytes(),'text/javascript')
                    raise RequestError(404,'페이지를 찾지 못했어요.')
                if path.startswith('/api/direct'):
                    self.authenticate()
                    if path=='/api/direct/events' and not post:return self.events()
                    if path!='/api/direct':raise RequestError(404,'요청 경로를 확인해 주세요.')
                    if post:
                        data=self.body()
                        if data.get('action')!='submit':raise RequestError(400,'출력 요청을 확인해 주세요.')
                        return self.reply(200,app.jobs.submit(data.get('jobId'),data.get('label')))
                    params=parse_qs(url.query)
                    if params.get('action',[''])[0]=='status':return self.reply(200,app.jobs.status(params.get('jobId',[''])[0]))
                    return self.reply(200,app.info())
                if post:raise RequestError(405,'허용하지 않는 요청이에요.')
                if path=='/api/product-lookup':return self.reply(200,app.lookup(parse_qs(url.query).get('code',[''])[0]))
                if path.startswith('/api/'):raise RequestError(404,'이 PC에서는 휴대폰 인식만 사용해요.')
                if path in ('/','/index.html','/local.html','/local-test.html'):
                    html=(app.web_root/'local.html').read_text('utf8').replace('<body data-inference="local">','<body data-inference="local" data-direct="1">').replace('href="./">기존 카운터</a>','href="local.html">PC 직접 연결</a>')
                    return self.send_bytes(200,html.encode(),'text/html; charset=utf-8')
                allowed=path.startswith(('/src/','/vendor/','/model-download/','/examples/','/licenses/')) or path in ('/style.css','/dispensing.css','/exit.html','/model.html','/model.css','/private-model-profile.json')
                target=(app.web_root/path.lstrip('/')).resolve()
                if not allowed or app.web_root not in target.parents or not target.is_file():raise RequestError(404,'파일을 찾지 못했어요.')
                mime={'.js':'text/javascript','.wasm':'application/wasm'}.get(target.suffix) or mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
                return self.send_bytes(200,target.read_bytes(),mime)
            def body(self):
                try:
                    n=int(self.headers.get('Content-Length','0'))
                    if not 0<n<=16000 or self.headers.get('Content-Type','').split(';')[0]!='application/json' or self.headers.get('Transfer-Encoding'):raise ValueError()
                    value=json.loads(self.rfile.read(n))
                    if not isinstance(value,dict):raise ValueError()
                    return value
                except (ValueError,UnicodeError):raise RequestError(400,'출력 요청 형식이 올바르지 않아요.')
            def events(self):
                q=queue.Queue(8);token=app.token
                with app.event_lock:
                    if len(app.subscribers)>=8:raise RequestError(429,'열려 있는 연결 화면을 줄여 주세요.')
                    app.subscribers.add(q)
                self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-store');self.send_header('Connection','close');self.end_headers()
                try:
                    q.put_nowait(app.info())
                    while not app.stop_event.is_set() and token==app.token and time.time()<app.expires:
                        try:data=q.get(timeout=min(10,max(.1,app.expires-time.time())));payload=('data: '+json.dumps(data,ensure_ascii=False)+'\n\n').encode()
                        except queue.Empty:payload=b': connected\n\n'
                        self.wfile.write(payload);self.wfile.flush()
                except (OSError,ValueError):pass
                finally:
                    with app.event_lock:app.subscribers.discard(q)
                    self.close_connection=True
            def handle_request(self,post=False):
                try:self.dispatch(post)
                except RequestError as e:self.reply(e.status,{'error':e.message})
                except (BrokenPipeError,ConnectionResetError,TimeoutError):pass
                except Exception:self.reply(503,{'error':'PC 수신 프로그램을 확인해 주세요.'})
            def do_GET(self):self.handle_request()
            def do_POST(self):self.handle_request(True)
            def do_OPTIONS(self):self.reply(403,{'error':'같은 PC 페이지에서 연결해 주세요.'})
        return Handler
