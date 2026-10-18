import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const results=fileURLToPath(new URL('../.test-results/',import.meta.url));
await mkdir(results,{recursive:true});
const server=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!path.startsWith(resolve(root)+sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(path)]||'application/octet-stream');
  res.end(await readFile(path));
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/analyze',async route=>{
 requests.push(route.request().postDataBuffer().toString('base64'));
 await route.fulfill({json:{objects:[{x:300,y:300,r:40,source:'auto',confidence:.99}],processingTimeMs:5}});
});
await page.addInitScript(()=>{
 window.testOrientation='portrait';window.testConstraints=[];
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async constraints=>{
  window.testConstraints.push(constraints);
  const c=document.createElement('canvas'),portrait=window.testOrientation==='portrait';
  c.width=portrait?600:1000;c.height=portrait?1000:600;
  const ctx=c.getContext('2d'),x=(c.width-600)/2,y=(c.height-600)/2;
  const paint=()=>{ctx.fillStyle='#ff0000';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#00ff00';ctx.fillRect(x,y,600,600);ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(c.width/2,c.height/2,60,0,Math.PI*2);ctx.fill();};
  paint();const stream=c.captureStream(10),timer=setInterval(paint,100);
  for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};}
  return stream;
 }});
});
const box=selector=>page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,bottom:r.bottom,fit:getComputedStyle(el.querySelector('video')||el).objectFit};});
const settled=()=>page.waitForFunction(()=>window.__pillCounterTest.state().loaded&&!window.__pillCounterTest.state().busy);
try{
 for(const size of [{width:320,height:640},{width:390,height:844},{width:430,height:932},{width:844,height:390},{width:1280,height:900}]){
  await page.setViewportSize(size);await page.goto(base+'/?test');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
  await page.locator('#camera-open').click();await page.waitForFunction(()=>!document.getElementById('shutter').disabled);
  const camera=await box('.camera-viewer');assert(Math.abs(camera.width-camera.height)<1);assert.equal(camera.fit,'cover');
  assert((await box('.capture-toolbar')).bottom<=size.height+1,'capture controls clipped');
  await page.locator('#capture-close').click();await page.locator('#live-tab').click();
  await page.waitForFunction(()=>!document.getElementById('live-capture').hidden&&!document.getElementById('live-capture').disabled);
  const live=await box('.live-viewer');assert(Math.abs(camera.width-live.width)<1);assert(Math.abs(camera.height-live.height)<1);
  if(size.height>=640)assert((await box('#live-panel>.capture-actions')).bottom<=size.height+1,'live controls clipped');
  if(size.width===390)await page.screenshot({path:results+'/live-mobile.png',fullPage:true});
  console.log('PASS responsive frames and controls',size);
 }
 await page.setViewportSize({width:390,height:844});
 for(const orientation of ['portrait','landscape']){
  await page.goto(base+'/?test');await page.evaluate(value=>window.testOrientation=value,orientation);
  if(orientation==='portrait')await page.screenshot({path:results+'/home-mobile.png',fullPage:true});
  await page.locator('#camera-open').click();await page.waitForFunction(()=>!document.getElementById('shutter').disabled);
  await page.screenshot({path:results+`/camera-${orientation}.png`,fullPage:true});
  await page.locator('#shutter').click();await settled();
  const state=await page.evaluate(()=>window.__pillCounterTest.state());assert.equal(state.width,600);assert.equal(state.height,600);
  const payload=requests.at(-1);
  const pixels=await page.evaluate(async data=>{
   const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes]));
   const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);
   const pixel=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);
   return {width:c.width,height:c.height,edge:pixel(2,2),center:pixel(300,300),insideX:pixel(350,300),insideY:pixel(300,350),outsideX:pixel(370,300),outsideY:pixel(300,370)};
  },payload);
  assert.deepEqual(pixels,{width:600,height:600,edge:[0,255,0,255],center:[255,255,255,255],insideX:[255,255,255,255],insideY:[255,255,255,255],outsideX:[0,255,0,255],outsideY:[0,255,0,255]});
  await page.locator('#save-photo').click();
  for(const id of ['save-plain','save-marked']){
   await page.locator('#'+id).click();await page.waitForFunction(()=>!document.getElementById('save-device').disabled);
   const dims=await page.locator('#save-preview').evaluate(async img=>{await img.decode();return [img.naturalWidth,img.naturalHeight];});assert.deepEqual(dims,[600,600]);
  }
  await page.locator('#save-close').click();await page.locator('#live-tab').click();
  await page.waitForFunction(()=>window.__pillCounterTest.state().liveCount===1);
  await page.locator('#live-capture').click();await settled();
  const liveState=await page.evaluate(()=>window.__pillCounterTest.state());assert.equal(liveState.width,600);assert.equal(liveState.height,600);
  const constraints=await page.evaluate(()=>window.testConstraints);assert.deepEqual(constraints[0],constraints[1]);
  console.log('PASS center crop, round shape, live capture and both export ratios',orientation);
 }
 assert.deepEqual(errors,[]);console.log('PASS no browser errors; inference was mocked for geometry checks');
}finally{await browser.close();server.close();}
