import concurrent.futures
import hashlib
import http.client
import json
from pathlib import Path
import ssl
import sys
import tempfile
import threading
import time
import unittest
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'integrations/direct-printer'))
from direct_server import DirectPrinterServer,PrintQueue,PrintRejected,SPOOLED,validate_label
ROOT=Path(__file__).resolve().parents[1]
LABEL=dict(code='8801234567890',name='테스트정_(성분명)',strength='500 mg',manufacturer='테스트',lot='LOT',packedOn='2026-10-19',expiry='2029-12-31',useBy='',size='dk22210',widthMm=29,heightMm=90,count=8,copies=1)
class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.prints=[]
  def printer(label):self.prints.append(label);time.sleep(.03);return SPOOLED
  self.app=DirectPrinterServer(printer,printer_name='MOCK QL-550',host='127.0.0.1',port=0,setup_port=0,web_root=ROOT/'dist',catalog_dir=ROOT/'data',data_dir=self.temp.name,allow_loopback_test=True)
  self.app.start();self.context=ssl.create_default_context(cafile=str(Path(self.temp.name)/'phone-ca.crt'))
 def tearDown(self):self.app.stop();self.temp.cleanup()
 def call(self,path='/api/direct',body=None,token=True,origin=None,admin=False):
  conn=http.client.HTTPConnection('127.0.0.1',self.app.setup_port,timeout=5) if admin else http.client.HTTPSConnection('127.0.0.1',self.app.port,context=self.context,timeout=5)
  headers={}
  if token:headers['Authorization']='Bearer '+(self.app.admin_token if admin else self.app.token)
  if origin:headers['Origin']=origin
  data=json.dumps(body) if body is not None else None
  if data:headers['Content-Type']='application/json'
  conn.request('POST' if body is not None else 'GET',path,body=data,headers=headers);response=conn.getresponse();raw=response.read();status=response.status;conn.close()
  try:value=json.loads(raw)
  except ValueError:value=raw
  return status,value
 def submit(self,job,label=LABEL):return self.call(body={'action':'submit','jobId':job,'label':label})
 def wait(self,job):
  for _ in range(100):
   value=self.call('/api/direct?action=status&jobId='+job)[1]
   if value['status'] in ('spooled','failed'):return value
   time.sleep(.02)
  self.fail('job timeout')
 def test_tls_auth_csrf_and_retired_cloud(self):
  self.assertEqual(self.call()[0],200) # CA/hostname verified, no TLS bypass.
  self.assertEqual(self.call(token=False)[0],403)
  self.assertEqual(self.call(origin='https://example.com')[0],403)
  self.assertEqual(self.call('/api/print-relay')[0],410)
  self.assertEqual(self.call('/api/admin',admin=True,token=False)[0],403)
  self.assertEqual(self.call('/api/admin',admin=True)[0],200)
 def test_duplicate_concurrency_and_changed_content(self):
  job=str(uuid4())
  with concurrent.futures.ThreadPoolExecutor(8) as pool:results=list(pool.map(lambda _:self.submit(job),range(8)))
  self.assertTrue(all(code==200 for code,_ in results));self.assertEqual(self.wait(job)['status'],'spooled');self.assertEqual(len(self.prints),1)
  self.assertEqual(self.prints[0]['name'],'테스트정')
  self.assertEqual(self.submit(job)[1]['duplicate'],True) # response lost -> resend
  self.assertEqual(self.submit(job,{**LABEL,'count':9})[0],409);self.assertEqual(len(self.prints),1)
 def test_validation_and_file_boundaries(self):
  for change in [{'count':True},{'count':0},{'copies':21},{'expiry':'2026-02-31'},{'packedOn':''},{'widthMm':30},{'heightMm':float('nan')},{'name':'x'*81}]:self.assertEqual(self.submit(str(uuid4()),{**LABEL,**change})[0],400)
  for path in ['/../direct-jobs.sqlite','/%2e%2e/ca-key.pem','/src/../../ca-key.pem','/integrations/direct-printer/server-key.pem']:self.assertEqual(self.call(path)[0],404)
  self.assertEqual(len(self.prints),0)
 def test_failure_pauses_and_resume_does_not_reprint(self):
  def broken(label):raise PrintRejected('layout')
  self.app.jobs.callback=broken;job=str(uuid4());self.submit(job);self.assertEqual(self.wait(job)['status'],'failed');self.assertEqual(self.submit(str(uuid4()))[0],409)
  self.call('/api/admin',body={'action':'resume'},admin=True);self.assertFalse(self.app.jobs.paused);self.submit(job);self.assertEqual(len(self.prints),0)
 def test_restart_does_not_reprint_uncertain(self):
  self.app.jobs.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?)',(str(uuid4()),'hash','processing','',time.time()));self.app.jobs.db.commit()
  self.app.jobs.close();self.app.jobs=PrintQueue(self.temp.name,lambda label:self.fail('must not print'))
  self.assertTrue(self.app.jobs.paused);self.assertEqual(self.submit(str(uuid4()))[0],409)
 def test_sse_rotation_expiry(self):
  conn=http.client.HTTPSConnection('127.0.0.1',self.app.port,context=self.context,timeout=5);conn.request('GET','/api/direct/events',headers={'Authorization':'Bearer '+self.app.token});response=conn.getresponse()
  self.assertEqual(response.status,200);self.assertTrue(response.readline().startswith(b'data: '));conn.close()
  old=self.app.token;self.call('/api/admin',body={'action':'rotate'},admin=True);self.assertNotEqual(old,self.app.token)
  self.app.expires=time.time()-1;self.assertEqual(self.call()[0],410)
 def test_local_assets_and_product_catalog(self):
  code,value=self.call('/local.html');self.assertEqual(code,200);self.assertIn(b'data-direct="1"',value)
  self.assertEqual(self.call('/src/local-worker.js')[0],200)
  self.assertEqual(self.call('/model-download/manifest.json')[0],200)
  self.assertEqual(self.call('/api/product-lookup?code=1234567890128')[1]['status'],'not_found')
  self.assertEqual(self.call('/api/product-lookup?code=8801234567891')[0],400)
if __name__=='__main__':unittest.main(verbosity=2)
