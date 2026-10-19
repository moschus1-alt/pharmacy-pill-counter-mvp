import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {chromium} from 'playwright';
const root=resolve('dist'),base=process.env.LOCAL_TEST_URL;
let server;
if(!base){server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname,path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep))return res.writeHead(403).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));}
const origin=base||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(base&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{})}),page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[],report=[];let uploads=0,chunks=0;
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
page.on('request',r=>{if(/\/model-download\/.*\.bin/.test(r.url()))chunks++;if(r.url().endsWith('/api/analyze'))uploads++;});
if(base&&process.env.HTTPS_PROXY)await page.route(origin+'/**',async route=>{const response=await route.fetch({timeout:120000});await route.fulfill({response});});
await page.route('**/api/analyze',route=>route.fulfill({status:500,body:'on-device page must never upload photos'}));
await page.addInitScript(()=>{
 const Original=Worker;window.workerCount=0;window.Worker=class extends Original{constructor(...args){super(...args);window.workerCount++;}};
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
  const image=new Image();image.src='/examples/mediseg-8-pills.png';await image.decode();
  const c=document.createElement('canvas');c.width=c.height=640;const ctx=c.getContext('2d'),paint=()=>ctx.drawImage(image,0,0,640,640);paint();
  const stream=c.captureStream(10),timer=setInterval(paint,100);for(const t of stream.getTracks()){const stop=t.stop.bind(t);t.stop=()=>{clearInterval(timer);stop();};}return stream;
 }});
});
const settled=()=>page.waitForFunction(()=>window.__pillCounterTest.state().analyzed&&!window.__pillCounterTest.state().busy,null,{timeout:180000});
const state=()=>page.evaluate(()=>window.__pillCounterTest.state());
try{
 await page.goto(origin+'/local.html?test&view=mobile');
 assert.equal(await page.locator('#compare').count(),0);assert.equal(await page.locator('#prepare').count(),0);assert(await page.locator('#camera-open').isVisible());
 await page.locator('#file-input').setInputFiles('examples/mediseg-8-pills.png');await settled();
 assert.equal((await state()).count,8);assert.equal((await state()).analysis.detector.type,'on-device');assert.equal(uploads,0);assert.equal(chunks,10);const firstChunks=chunks;
 report.push({step:'photo',ms:(await state()).analysis.processingTimeMs,count:8});
 const workers=await page.evaluate(()=>window.workerCount);await page.locator('#reanalyze').click();await settled();assert.equal(await page.evaluate(()=>window.workerCount),workers,'reuse engine between photos');
 // Existing correction controls and save/confirm flow stay usable.
 await page.locator('[data-mode=add]').click();const bounds=await page.locator('#canvas').boundingBox();await page.mouse.click(bounds.x+20,bounds.y+20);assert.equal((await state()).count,9);await page.locator('#undo').click();assert.equal((await state()).count,8);
 await page.locator('[data-mode=remove]').click();const object=(await state()).objects[0];await page.mouse.click(bounds.x+object.x*bounds.width/640,bounds.y+object.y*bounds.height/640);assert.equal((await state()).count,7);await page.locator('#undo').click();assert.equal((await state()).count,8);
 await page.locator('#save-photo').click();assert(await page.locator('#save-dialog').isVisible());await page.keyboard.press('Escape');await page.locator('#confirm').click();assert((await state()).confirmed);
 await page.screenshot({path:'.test-results/local-counter-result.png',fullPage:true});
 await page.reload();await page.locator('#file-input').setInputFiles('examples/mediseg-8-pills.png');await settled();assert.equal(chunks,firstChunks,'cached model across reload');
 await page.locator('#reanalyze').click();await page.waitForFunction(()=>window.__pillCounterTest.state().busy);await page.locator('#photo-back').click();await page.waitForFunction(()=>!window.__pillCounterTest.state().busy);assert((await state()).loaded,'cancelling preserves the selected photo');
 await page.locator('#retake').click();await page.waitForFunction(()=>!document.getElementById('shutter').disabled);await page.locator('#shutter').click();await settled();assert.equal((await state()).count,8);
 await page.locator('#live-tab').click();await page.waitForFunction(()=>window.__pillCounterTest.state().liveCount===8,null,{timeout:120000});
 const liveWorkers=await page.evaluate(()=>window.workerCount),firstAt=(await state()).liveAt;await page.waitForFunction(firstAt=>window.__pillCounterTest.state().liveAt>firstAt,firstAt,{timeout:120000});assert.equal(await page.evaluate(()=>window.workerCount),liveWorkers,'reuse engine between live frames');
 await page.locator('#live-capture').click();await settled();assert.equal((await state()).count,8);assert(!(await state()).streamActive);
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.goto(origin+'/local-test.html?test&view=mobile');assert(await page.locator('#camera-open').isVisible());assert.equal(await page.locator('#compare').count(),0);assert.equal(await page.locator('body').getAttribute('data-inference'),'local');
 assert.equal(uploads,0);assert.deepEqual(errors,[]);await mkdir('.test-results',{recursive:true});await writeFile('.test-results/local-counter.json',JSON.stringify({report,uploads,chunks},null,2));
 console.log('PASS real on-device model: automatic setup, 8-pill photo/camera/live, add/remove/undo, confirmation/save dialog, cancellation, engine reuse, cached reload, old URL, responsive UI; zero analysis uploads');
}finally{await browser.close();server?.closeAllConnections();server?.close();}
