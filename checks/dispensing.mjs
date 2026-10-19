import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {parseProductBarcode,gs1Expiry,localDate} from '../src/dispensing-data.js';
import {createRelay,normalizeLabel} from '../api/print-relay.js';

assert.deepEqual(parseProductBarcode(']d201088012345678901729123110LOT123\x1d21SERIAL'),{raw:'01088012345678901729123110LOT123\x1d21SERIAL',code:'08801234567890',lot:'LOT123',expiry:'2029-12-31'});
assert.equal(parseProductBarcode('(01)08801234567890(17)280200(10)BATCH17').expiry,'2028-02-29');
assert.equal(parseProductBarcode('8801234567890').code,'8801234567890');
assert.equal(gs1Expiry('291332'),'');assert.equal(gs1Expiry('290230'),'');
assert.throws(()=>parseProductBarcode('\x00bad'));
const sample={code:'8801234567890',name:'테스트정',strength:'500 mg',manufacturer:'테스트제약',lot:'LOT001',expiry:'2029-12-31',packedOn:localDate(),useBy:'',size:'60x40',copies:1,count:8};
assert.throws(()=>normalizeLabel({...sample,count:-1}));assert.throws(()=>normalizeLabel({...sample,count:1.5}));assert.throws(()=>normalizeLabel({...sample,expiry:'2029-02-31'}));assert.throws(()=>normalizeLabel({...sample,copies:21}));

const values=new Map();let clock=Date.now();
const store={async read(path){return values.get(path)||null;},async write(path,value,overwrite=false){if(values.has(path)&&!overwrite)throw Error('duplicate');values.set(path,structuredClone(value));},async paths(prefix,limit=100){return [...values.keys()].filter(path=>path.startsWith(prefix)).sort().slice(0,limit).map(path=>({path,uploadedAt:clock}));},async remove(paths){for(const path of paths)values.delete(path);}};
const relay=createRelay(store,()=>clock);
async function call(action,session={},data={},method='POST') {
  let status=0,body;
  await relay({method,url:'/api/print-relay?'+new URLSearchParams({action,station:session.id||'',...data}),headers:{authorization:session.token?'Bearer '+session.token:''},body:{action,station:session.id,...data}},{setHeader(){},status(value){status=value;return this;},json(value){body=value;}});
  return {status,body};
}
const station=(await call('create',{}, {name:'검증 PC'})).body;
const sender={id:station.id,token:station.pairToken},owner={id:station.id,token:station.ownerToken};
assert.equal((await call('pair',sender)).status,200);
assert.equal((await call('pair',{...sender,token:'0'.repeat(64)})).status,403);
assert.equal((await call('jobs',sender,{},'GET')).status,403);
const jobId=randomUUID();
assert.equal((await call('submit',sender,{jobId,label:sample})).status,200);
assert.equal((await call('submit',sender,{jobId,label:sample})).body.duplicate,true);
assert.equal((await call('jobs',owner,{},'GET')).body.jobs.length,1);
assert.equal((await call('printed',sender,{jobId})).status,403);
assert.equal((await call('printed',owner,{jobId})).status,200);
assert.equal((await call('status',sender,{jobId},'GET')).body.status,'printed');
assert.equal((await call('jobs',owner,{},'GET')).body.jobs.length,0);
clock+=9*60*60*1000;assert.equal((await call('pair',sender)).status,410);clock=Date.now();
await call('close',owner);values.clear();
console.log('PASS GS1 decoding, date/quantity validation, station authorization, duplicate protection, acknowledgement and expiry');

const root=fileURLToPath(new URL('../dist/',import.meta.url)),results=fileURLToPath(new URL('../.test-results/',import.meta.url));await mkdir(results,{recursive:true});
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/print-relay') {
    const chunks=[];for await(const chunk of req)chunks.push(chunk);req.body=Buffer.concat(chunks).toString()||'{}';
    res.status=value=>{res.statusCode=value;return res;};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    return relay(req,res);
  }
  if(url.pathname==='/api/analyze') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({objects:Array.from({length:8},(_,i)=>({x:80+i*50,y:250,r:15,source:'auto'})),processingTimeMs:1}));return;}
  try {
    const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(resolve(root)+sep)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const pc=await browser.newContext({viewport:{width:1280,height:900}}),phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const desktop=await pc.newPage(),mobile=await phone.newPage(),errors=[];
for(const page of [desktop,mobile]){page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());await page.addInitScript(()=>{window.printCalls=0;window.print=()=>{window.printCalls++;};});}
try {
  await desktop.goto(base+'/?test');await desktop.locator('#dispense-tab').click();await desktop.locator('#printer-settings').click();await desktop.locator('#station-create').click();
  await desktop.waitForFunction(()=>!!sessionStorage.getItem('pill-label-station-v1'));
  const pairing=await desktop.evaluate(()=>{const station=JSON.parse(sessionStorage.getItem('pill-label-station-v1'));return `${location.origin}/?test#pc=${station.id}.${station.pairToken}`;});
  assert(await desktop.locator('#station-qr svg').isVisible());
  await desktop.locator('#printer-dialog-close').click();
  await mobile.goto(pairing);await mobile.waitForFunction(()=>document.getElementById('pc-connection-status').textContent.includes('연결됨'));
  assert.equal(await mobile.evaluate(()=>location.hash),'');
  await mobile.locator('#product-barcode').fill('(01)08801234567890(17)291231(10)LOT001');await mobile.locator('#barcode-apply').click();
  assert.equal(await mobile.locator('#product-lot').inputValue(),'LOT001');assert.equal(await mobile.locator('#product-expiry').inputValue(),'2029-12-31');
  await mobile.locator('#product-name').fill('테스트정');await mobile.locator('#product-strength').fill('500 mg');await mobile.locator('#dispense-start-count').click();
  assert(await mobile.locator('#dispense-count-banner').isVisible());
  await mobile.locator('#file-input').setInputFiles(fileURLToPath(new URL('../examples/mediseg-8-pills.png',import.meta.url)));
  await mobile.waitForFunction(()=>window.__pillCounterTest.state().analyzed&&!window.__pillCounterTest.state().busy);
  await mobile.locator('#confirm').click();await mobile.waitForFunction(()=>document.getElementById('dispense-count').value==='8');
  assert(await mobile.locator('#label-send').isDisabled());await mobile.locator('#label-reviewed').check();
  assert(await mobile.locator('#label-send').isEnabled());
  await mobile.locator('#label-send').click();await mobile.waitForFunction(()=>document.getElementById('label-send').textContent==='PC로 전송했어요');
  await desktop.waitForFunction(()=>document.querySelectorAll('.received-job').length===1,{},{timeout:15000});
  await desktop.getByRole('button',{name:'라벨 보기·출력',exact:true}).click();
  assert.equal(await desktop.locator('#received-label-preview .label-heading strong').innerText(),'8개');
  assert(await desktop.locator('#received-label-done').isDisabled());
  await desktop.locator('#received-label-print').click();assert.equal(await desktop.evaluate(()=>window.printCalls),1);
  await desktop.locator('#received-label-done').click();
  await mobile.waitForFunction(()=>document.getElementById('label-send-status').textContent.includes('실제 출력 완료'),{},{timeout:15000});
  assert.equal(await desktop.locator('.received-job').count(),0);
  // A fresh barcode cannot inherit the previous medication's count or review.
  await mobile.locator('#product-barcode').fill('1234567890128');assert.equal(await mobile.locator('#dispense-count').innerText(),'—');assert(await mobile.locator('#label-send').isDisabled());
  await mobile.locator('#barcode-apply').click();assert.equal(await mobile.locator('#product-name').inputValue(),'');assert.equal(await mobile.locator('#product-lot').inputValue(),'');
  // Use the shipped decoder against a real rendered barcode, not a stubbed string.
  const decoded=await mobile.evaluate(async()=>{const canvas=document.createElement('canvas');JsBarcode(canvas,'8801234567890',{format:'CODE128',width:3,height:80,margin:30});return (await new ZXingBrowser.BrowserMultiFormatReader().decodeFromImageUrl(canvas.toDataURL())).getText();});
  assert.equal(decoded,'8801234567890');
  for(const width of [320,390,430,1280]){await mobile.setViewportSize({width,height:844});assert(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow at '+width);}
  await mobile.setViewportSize({width:390,height:844});await mobile.screenshot({path:results+'/dispensing-mobile.png',fullPage:true});await desktop.screenshot({path:results+'/dispensing-pc.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS two-device QR pairing → barcode → photo count → confirmation → relay → PC print → phone acknowledgement; barcode library; responsive layouts; no browser errors');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
