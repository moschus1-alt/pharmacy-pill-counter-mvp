import base64,json,sys,time,hashlib
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import serialization
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'integrations/direct-printer'))
from direct_server import DirectPrinterServer,SPOOLED
root=Path(__file__).resolve().parents[1];directory=Path(sys.argv[1]);prints=[]
def printer(label):
 prints.append(label);(directory/'printed.json').write_text(json.dumps(prints));return SPOOLED
app=DirectPrinterServer(printer,printer_name='MOCK QL-550',web_root=root/'dist',catalog_dir=root/'data',host='127.0.0.1',port=0,setup_port=0,data_dir=directory,allow_loopback_test=True)
app.start();cert=x509.load_pem_x509_certificate((directory/'server.crt').read_bytes());spki=base64.b64encode(hashlib.sha256(cert.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)).digest()).decode()
# Test fixture protocol only, captured in test process memory (never user logs).
print(json.dumps({'origin':app.origin,'mobileUrl':app.mobile_url,'adminUrl':app.admin_url,'spki':spki}),flush=True)
try:
 for line in sys.stdin:
  if line.strip()=='stop':break
finally:app.stop()
