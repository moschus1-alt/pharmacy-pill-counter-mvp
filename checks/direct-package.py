import hashlib,json,zipfile
from pathlib import Path
path=Path('dist/integrations/pill-counter-direct.zip')
with zipfile.ZipFile(path) as z:
 assert z.testzip() is None
 for name in ['Start.cmd','Start.ps1','Firewall.ps1','run_direct.py','direct_server.py','admin.html','setup.html','receiver.py','pill_counter_relay.py','Print-Label.ps1','Barcode.ps1','web/local.html','web/src/direct-connection.js','web/src/local-worker.js','data/drug-catalog.json.gz','CODEX_HANDOFF.md']:assert name in z.namelist(),name
 manifest=json.loads(z.read('runtime-manifest.json'))
 for item in manifest['files']:assert hashlib.sha256(z.read('runtime-assets/'+item['name'])).hexdigest()==item['sha256']
 model=json.loads(z.read('web/model-download/manifest.json'));digest=hashlib.sha256()
 for part in model['parts']:
  data=z.read('web'+part['url']);assert hashlib.sha256(data).hexdigest()==part['sha256'];digest.update(data)
 assert digest.hexdigest()==model['sha256']
 assert not any(name.endswith(('ca-key.pem','server-key.pem','.sqlite','connection.json')) for name in z.namelist())
 assert 'api/print-relay' not in z.read('web/src/print-connection.js').decode()
 assert z.read('Start.ps1').startswith(b'\xef\xbb\xbf')
print('PASS ZIP CRC, offline runtime/model hashes, direct UI/resources, Windows encoding and no credentials/journals bundled; bytes:',path.stat().st_size)
