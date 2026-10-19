import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{BARS}=require('jsbarcode/bin/barcodes/CODE128/constants.js');
const inputs=['08806723002015','8806723002015','1234','12345','LOT-ABC 123','1'];
const script=`$ErrorActionPreference='Stop';
foreach($file in (Get-ChildItem integrations/pc-printer/*.ps1)) {
 $tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
 if($errors){throw 'PowerShell parse failure'}
}
. ./integrations/pc-printer/Barcode.ps1
@(${inputs.map(value=>`(Get-BarcodeModules '${value}')`).join(',')}) | ConvertTo-Json -Compress`;
const encoded=JSON.parse(execFileSync(process.env.PILL_PWSH||'pwsh',['-NoProfile','-Command',script],{encoding:'utf8',env:{...process.env,XDG_CACHE_HOME:'/tmp/pill-pwsh-cache',XDG_CONFIG_HOME:'/tmp/pill-pwsh-config',XDG_DATA_HOME:'/tmp/pill-pwsh-data'}}));
for(let i=0;i<inputs.length;i++){
  let bits=encoded[i];assert(bits.startsWith('0000000000')&&bits.endsWith('0000000000'));
  bits=bits.slice(10,-10);assert(bits.endsWith(String(BARS[106])));bits=bits.slice(0,-13);
  const values=[];while(bits){const value=BARS.map(String).indexOf(bits.slice(0,11));assert(value>=0);values.push(value);bits=bits.slice(11);}
  const checksum=values.pop();assert.equal(checksum,values.reduce((sum,value,index)=>sum+value*(index||1),0)%103);
  let set=values.shift()===105?'C':'B',decoded='';
  for(const value of values){if(set==='B'&&value===99)set='C';else if(set==='C'&&value===100)set='B';else decoded+=set==='C'?String(value).padStart(2,'0'):String.fromCharCode(value+32);}
  assert.equal(decoded,inputs[i]);
}
execFileSync('python',['-c',`
import os,sys,json
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,'integrations/upharm-daily');sys.path.insert(0,'integrations/pc-printer')
from receiver import print_label,PrintRejected
os.environ['SystemRoot']='C:/Windows'
paths=[]
def run(args,**kwargs):
 path=Path(args[args.index('-LabelPath')+1]);paths.append(path)
 assert json.loads(path.read_text(encoding='utf-8'))['name']=='검증정'
 assert args[-1]=='Mock printer' and kwargs['timeout']==180
 return SimpleNamespace(returncode=0,stdout=b'SPOOLED\\r\\n')
assert print_label({'name':'검증정'},'Mock printer',run=run)=='spooled'
assert all(not path.exists() for path in paths)
for code in [2,3]:
 try:
  print_label({'name':'검증정'},'Mock printer',run=lambda *a,**k:SimpleNamespace(returncode=code,stdout=b''))
  raise AssertionError('failed printer accepted')
 except PrintRejected as error:
  assert error.reason==('layout' if code==2 else 'uncertain')
`],{stdio:'pipe'});
console.log('PASS PowerShell parsing, Code 128 decode/checksums, native adapter result handling and temporary-label cleanup; Windows GDI not executed');
