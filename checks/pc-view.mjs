import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,rm} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {isPcView} from '../src/pc-view.js';
import {createRelay} from '../api/print-relay.js';
import {localDate} from '../src/dispensing-data.js';
assert(isPcView({userAgent:'Windows NT',maxTouchPoints:5,coarsePointer:true}));
assert(isPcView({userAgent:'X11; Linux x86_64'}));
assert(!isPcView({userAgent:'Android',search:''}));
assert(!isPcView({platform:'MacIntel',maxTouchPoints:5}));
assert(!isPcView({hash:'#pc=pairing',userAgent:'Windows NT'}));
assert(!isPcView({pairedSender:true,userAgent:'Windows NT'}));
assert(!isPcView({search:'?view=mobile',userAgent:'Windows NT'}));
assert(isPcView({search:'?view=pc',userAgent:'Android'}));
const values=new Map();
const store={async read(path){return values.get(path)||null;},async write(path,value,overwrite=false){if(values.has(path)&&!overwrite)throw Error('duplicate');values.set(path,structuredClone(value));},async paths(prefix,limit=100){return [...values.keys()].filter(path=>path.startsWith(prefix)).sort().slice(0,limit).map(path=>({path,uploadedAt:Date.now()}));},async remove(paths){for(const path of paths)values.delete(path);}};
const relay=createRelay(store),root=fileURLToPath(new URL('../dist/',import.meta.url)),remote=process.env.PILL_BASE_URL;
const server=remote?null:createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/print-relay'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);req.body=JSON.parse(Buffer.concat(chunks).toString()||'{}');res.status=value=>{res.statusCode=value;return res;};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};return relay(req,res);
  }
  try{const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(resolve(root)+sep))return res.writeHead(403).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}
});
if(server)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=remote||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(remote&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{})});
const pc=await browser.newContext({viewport:{width:1280,height:950}}),phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
const desktop=await pc.newPage(),mobile=await phone.newPage(),errors=[],stations=[];
for(const page of [desktop,mobile]){
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.addInitScript(()=>{window.printCalls=0;window.print=()=>window.printCalls++;Object.defineProperty(navigator.clipboard,'writeText',{value:async value=>{window.copiedLink=value;}});});
  if(remote&&process.env.HTTPS_PROXY)await page.route(base+'/**',async route=>{const response=await route.fetch({timeout:120000});await route.fulfill({response});});
}
async function request(action,session={},data={},get=false){const parameters={action,station:session.id,...data};const response=await pc.request.fetch(base+'/api/print-relay'+(get?'?'+new URLSearchParams(parameters):''),{method:get?'GET':'POST',headers:{'Content-Type':'application/json',...(session.token?{Authorization:'Bearer '+session.token}:{})},...(!get?{data:parameters}:{})});assert.equal(response.status(),200);return response.json();}
const results=fileURLToPath(new URL('../.test-results/',import.meta.url));await mkdir(results,{recursive:true});
try {
  await desktop.goto(base);assert(await desktop.locator('#pc-panel').isVisible());
  assert(!await desktop.locator('.tabs').isVisible());assert(!await desktop.locator('#camera-open').isVisible());assert(!await desktop.locator('#dispense-form').isVisible());
  assert.equal(await desktop.evaluate(()=>history.state?.__pillCounterNavigation),undefined);
  await desktop.screenshot({path:results+'/pc-connection-home.png',fullPage:true});
  for(const width of [420,1280]){await desktop.setViewportSize({width,height:950});assert(await desktop.locator('#pc-panel').isVisible());assert(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await desktop.locator('.pc-home-advanced').evaluate(node=>node.open=true);
  await desktop.locator('#station-create').click();await desktop.waitForFunction(()=>!!sessionStorage.getItem('pill-label-station-v1'));
  const station=await desktop.evaluate(()=>JSON.parse(sessionStorage.getItem('pill-label-station-v1')));stations.push(station);
  assert(await desktop.locator('#station-qr svg').isVisible());await desktop.locator('#station-copy').click();
  const link=await desktop.evaluate(()=>window.copiedLink);assert.equal(new URL(link).search,'');
  await mobile.goto(base);assert(await mobile.locator('#camera-open').isVisible());assert.equal(await mobile.locator('#pc-panel').count(),0);
  await mobile.locator('#dispense-tab').click();await mobile.locator('#printer-settings').click();assert(await mobile.locator('#mobile-connection-help').isVisible());assert(!await mobile.locator('#desktop-connection-tools').isVisible());await mobile.locator('#printer-dialog-close').click();
  await mobile.goto(link);await mobile.waitForFunction(()=>document.getElementById('pc-banner-title').textContent==='PC 연결됨');
  await mobile.locator('#printer-settings').click();assert(!await mobile.locator('#mobile-connection-help').isVisible());assert(!await mobile.locator('#mobile-link-fields').isVisible());assert(await mobile.locator('#mobile-connection-current').isVisible());
  await mobile.locator('#pc-change').click();assert(await mobile.locator('#mobile-link-fields').isVisible());assert(!await mobile.locator('#mobile-connection-help').isVisible());await mobile.locator('#printer-dialog-close').click();
  const jobId=randomUUID(),label={code:'8806723002015',name:'PC 화면 검증정',count:8,strength:'500mg',manufacturer:'',lot:'TEST',packedOn:localDate(),expiry:'2029-12-31',useBy:'',size:'dk22210',widthMm:29,heightMm:90,copies:1};
  await request('submit',{id:station.id,token:station.pairToken},{jobId,label});
  await desktop.waitForFunction(()=>document.querySelectorAll('.received-job').length===1,{},{timeout:30000});await desktop.getByRole('button',{name:'라벨 보기·출력',exact:true}).click();await desktop.locator('#received-label-print').click();assert.equal(await desktop.evaluate(()=>window.printCalls),1);await desktop.locator('#received-label-done').click();
  const downloadPromise=desktop.waitForEvent('download');await desktop.locator('#pc-agent-download').click();
  const download=await downloadPromise,archive=results+'/pc-printer.zip';await download.saveAs(archive);
  execFileSync('python',['-c',`import zipfile,json,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert len(z.namelist())==9
 assert z.read('Start.ps1').startswith(b'\\xef\\xbb\\xbf')
 config=json.loads(z.read('connection.json'))
 assert config['stationId']==sys.argv[2] and len(config['ownerToken'])==64
 assert 'DesktopReceiver' in z.read('receiver.py').decode()
`,archive,station.id]);await rm(archive);
  await request('receiver-heartbeat',{id:station.id,token:station.ownerToken},{receiverId:randomUUID(),printerName:'Other PC printer',state:'ready',app:'pc-print-agent'});
  for(const page of [desktop,mobile])await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await desktop.waitForFunction(()=>document.getElementById('pc-banner-title').textContent==='PC 자동 출력 연결됨');
  await mobile.waitForFunction(()=>document.getElementById('pc-banner-title').textContent==='PC 자동 출력 연결됨');
  const auto=await request('create',{}, {name:'자동 출력 검증 PC'});stations.push(auto);const owner={id:auto.id,token:auto.ownerToken},receiverId=randomUUID();
  await request('receiver-heartbeat',owner,{receiverId,printerName:'Brother QL-550',state:'ready'});
  await desktop.locator('#pc-upharm-options').evaluate(node=>node.open=true);
  await desktop.locator('#pc-auto-link').fill(base+'/#pc='+auto.id+'.'+auto.pairToken);await desktop.locator('#pc-auto-connect').click();
  await desktop.waitForFunction(()=>document.getElementById('pc-auto-status').textContent==='자동 출력 준비됨');assert(await desktop.locator('#pc-auto-qr svg').isVisible());assert(!await desktop.locator('#pc-auto-setup').isVisible());
  await desktop.locator('#pc-auto-copy').click();const autoLink=await desktop.evaluate(()=>window.copiedLink);assert(!autoLink.includes(auto.ownerToken));
  await mobile.goto(autoLink);await mobile.waitForFunction(()=>document.getElementById('pc-banner-title').textContent==='유팜데일리 자동 출력 연결됨');
  await mobile.locator('#printer-settings').click();assert(!await mobile.locator('#mobile-connection-help').isVisible());assert(!await mobile.locator('#mobile-link-fields').isVisible());assert(!await mobile.locator('#desktop-connection-tools').isVisible());await mobile.screenshot({path:results+'/mobile-connected-manager.png'});await mobile.locator('#printer-dialog-close').click();
  await desktop.reload();await desktop.waitForFunction(()=>document.getElementById('pc-auto-status').textContent==='자동 출력 준비됨');assert(await desktop.locator('#pc-panel').isVisible());
  await request('receiver-heartbeat',owner,{receiverId,printerName:'Brother QL-550',state:'stopped'});await desktop.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await desktop.waitForFunction(()=>document.getElementById('pc-auto-status').textContent==='유팜데일리 수신 연결 확인 필요');
  await desktop.locator('#pc-auto-change').click();assert(await desktop.locator('#pc-auto-setup').isVisible());assert(!await desktop.locator('#pc-auto-pairing').isVisible());
  await desktop.locator('#pc-auto-link').fill('https://example.com/#pc='+auto.id+'.'+auto.pairToken);await desktop.locator('#pc-auto-connect').click();await desktop.waitForFunction(()=>document.getElementById('pc-auto-status').dataset.state==='error');
  await mobile.locator('#printer-settings').click();await mobile.locator('#pc-disconnect').click();assert(await mobile.locator('#mobile-connection-help').isVisible());assert(await mobile.locator('#mobile-link-fields').isVisible());
  assert.deepEqual(errors,[]);
  console.log('PASS PC-only landing at all widths; mobile and paired-link routing; QR pairing and label receipt; connected-mobile help hidden; UPharm automatic readiness, reload, stopped state and invalid URL; no physical prints');
}finally {
  for(const station of stations)await request('close',{id:station.id,token:station.ownerToken}).catch(()=>{});
  await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
}
