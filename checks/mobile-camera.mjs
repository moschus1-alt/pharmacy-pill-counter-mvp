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
// Test-driven page reloads intentionally leave the current screen.
page.on('dialog',dialog=>dialog.accept());
let delayAnalysis=0;
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/analyze',async route=>{
 requests.push(route.request().postDataBuffer().toString('base64'));
 if(delayAnalysis)await new Promise(resolve=>setTimeout(resolve,delayAnalysis));
 await route.fulfill({json:{objects:[{x:300,y:300,r:40,source:'auto',confidence:.99}],processingTimeMs:5}});
});
await page.addInitScript(()=>{
 window.testHistoryPushes=0;const originalPush=history.pushState.bind(history);
 history.pushState=(...args)=>{window.testHistoryPushes++;return originalPush(...args);};
 if(location.search.includes('fallback'))Object.defineProperty(window,'CloseWatcher',{value:undefined});
 window.testOrientation='portrait';window.testConstraints=[];
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async constraints=>{
  window.testConstraints.push(constraints);
  if(window.testPermissionDelay)await new Promise(resolve=>setTimeout(resolve,window.testPermissionDelay));
  if(window.testPermissionDenied)throw new DOMException('Test permission denied','NotAllowedError');
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
 // Exercise both the platform close-request path and history-only browsers.
 for(const path of ['native','fallback','toolbar']){
  await page.goto(base+'/?test&'+path);
  const back=async()=>{
   if(path==='native')await page.keyboard.press('Escape');
   else await page.goBack();
  };
  // Toolbar traversal also runs with CloseWatcher present and without a page tap.
  if(path==='fallback')await page.locator('#photo-tab').click();
  await back();await page.waitForFunction(()=>document.getElementById('exit-dialog').open);
  await page.locator('#exit-cancel').click();
  if(path!=='native'){
   const baseline=await page.evaluate(()=>({pushes:window.testHistoryPushes,length:history.length}));
   // No intervening page taps: reproduce the repeated hardware-Back path
   // which previously pushed a fresh, browser-skippable history entry.
   for(let i=0;i<3;i++){
    await back();await page.waitForFunction(()=>document.getElementById('exit-dialog').open);
    await back();await page.waitForFunction(()=>!document.getElementById('exit-dialog').open);
   }
   assert.deepEqual(await page.evaluate(()=>({pushes:window.testHistoryPushes,length:history.length})),baseline);
  }
  await page.locator('#camera-open').click();await page.waitForFunction(()=>!document.getElementById('shutter').disabled);
  await back();await page.waitForFunction(()=>!window.__pillCounterTest.state().captureMode);
  assert.equal(await page.locator('#exit-dialog').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.__pillCounterTest.state().captureActive),false);
  await page.locator('#live-tab').click();await page.waitForFunction(()=>window.__pillCounterTest.state().streamActive);
  await back();await page.waitForFunction(()=>window.__pillCounterTest.state().currentTab==='photo');
  assert.equal(await page.evaluate(()=>window.__pillCounterTest.state().streamActive),false);
  await page.locator('#camera-open').click();await page.waitForFunction(()=>!document.getElementById('shutter').disabled);
  delayAnalysis=600;await page.locator('#shutter').click();await page.waitForFunction(()=>window.__pillCounterTest.state().busy);
  await back();await page.waitForFunction(()=>!window.__pillCounterTest.state().busy);delayAnalysis=0;
  assert.equal(await page.evaluate(()=>window.__pillCounterTest.state().loaded),true);
  await page.locator('#reanalyze').click();await settled();
  assert(await page.locator('#retake').isVisible());assert(await page.locator('#other-photo').isVisible());
  await page.locator('#retake').click();await page.waitForFunction(()=>!document.getElementById('shutter').disabled);
  await back();await page.waitForFunction(()=>!window.__pillCounterTest.state().captureMode);
  assert.equal(await page.evaluate(()=>window.__pillCounterTest.state().count),1);
  const chooserPromise=page.waitForEvent('filechooser');await page.locator('#other-photo').click();
  await (await chooserPromise).setFiles([]);
  assert.equal(await page.evaluate(()=>window.__pillCounterTest.state().count),1);
  const nextChooser=page.waitForEvent('filechooser');await page.locator('#other-photo').click();
  await (await nextChooser).setFiles(fileURLToPath(new URL('../examples/mediseg-8-pills.png',import.meta.url)));
  await page.waitForFunction(()=>window.__pillCounterTest.state().width===640);await settled();
  assert.equal(await page.evaluate(()=>window.__pillCounterTest.state().width),640);
  await page.locator('#photo-back').click();await page.waitForFunction(()=>document.getElementById('leave-dialog').open);
  await page.locator('#leave-cancel').click();
  if(path==='fallback')await page.screenshot({path:results+'/result-new-photo-actions.png',fullPage:true});
  await page.locator('[data-mode="add"]').click();await back();
  await page.waitForFunction(()=>window.__pillCounterTest.state().mode==='view');
  await page.locator('#save-photo').click();await page.waitForFunction(()=>document.getElementById('save-dialog').open);
  await back();await page.waitForFunction(()=>!document.getElementById('save-dialog').open);
  assert.equal(await page.locator('#leave-dialog').isVisible(),false,'one Back must only close the save dialog');
  await page.locator('#zoom-in').click();await back();
  await page.waitForFunction(()=>window.__pillCounterTest.state().zoom===1);
  assert.equal(await page.locator('#leave-dialog').isVisible(),false);
  await back();await page.waitForFunction(()=>document.getElementById('leave-dialog').open);
  await back();await page.waitForFunction(()=>!document.getElementById('leave-dialog').open);
  assert.equal(await page.evaluate(()=>window.__pillCounterTest.state().loaded),true);
  await back();await page.locator('#leave-confirm').click();
  await page.waitForFunction(()=>!window.__pillCounterTest.state().loaded);
  for(let i=0;i<3;i++){
   await back();await page.waitForFunction(()=>document.getElementById('exit-dialog').open);
   await page.locator('#exit-cancel').click();
  }
  await page.reload();await page.locator('#photo-tab').click();
  await back();await page.waitForFunction(()=>document.getElementById('exit-dialog').open);
  await page.locator('#exit-cancel').click();
  console.log('PASS Back: home, capture, live, analysis, edit, save, zoom, result, repeat, reload',path);
 }
 await page.goto(base+'/?test');await page.locator('#camera-open').click();
 await page.waitForFunction(()=>!document.getElementById('shutter').disabled);
 await page.locator('#shutter').click();await settled();
 await page.locator('#stage').scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>{
  const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  return {stage:rect('stage'),canvas:rect('canvas'),marker:document.querySelector('.marker').getBoundingClientRect().width,viewport:visualViewport.scale,scroll:scrollY};
 });
 const cdp=await context.newCDPSession(page),cx=before.stage.x+before.stage.width/2,cy=before.stage.y+before.stage.height/2;
 const touch=async(type,d)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:cx-d,y:cy,id:1},{x:cx+d,y:cy,id:2}]});
 await touch('touchStart',30);
 for(let d=35;d<=90;d+=5)await touch('touchMove',d);
 await touch('touchEnd',0);
 await page.waitForFunction(()=>window.__pillCounterTest.state().zoom>2);
 const after=await page.evaluate(()=>({stage:document.getElementById('stage').getBoundingClientRect().toJSON(),canvas:document.getElementById('canvas').getBoundingClientRect().toJSON(),marker:document.querySelector('.marker').getBoundingClientRect().width,viewport:visualViewport.scale,scroll:scrollY,count:window.__pillCounterTest.state().count}));
 assert.equal(after.stage.width,before.stage.width);assert.equal(after.stage.height,before.stage.height);
 assert(after.canvas.width>before.canvas.width*2);assert.equal(after.viewport,before.viewport);assert.equal(after.scroll,before.scroll);assert.equal(after.marker,before.marker);
 assert.equal(after.count,1);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx,y:cy,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx+45,y:cy+30,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert((await page.evaluate(()=>window.__pillCounterTest.state().panX))>20);
 await page.screenshot({path:results+'/zoom-inside-frame.png',fullPage:true});
 await page.locator('#zoom-reset').click();assert.equal(await page.evaluate(()=>window.__pillCounterTest.state().zoom),1);
 console.log('PASS real two-finger touch: frame/page fixed, photo enlarged, labels fixed, drag and reset');
 // Gallery aspect ratio, tap editing, and gesture suppression in editing mode.
 await page.locator('#file-input').setInputFiles(fileURLToPath(new URL('../examples/mediseg-8-pills.png',import.meta.url)));await settled();
 await page.locator('#zoom-in').click();
 assert.equal(await page.evaluate(()=>visualViewport.scale),1);
 await page.locator('[data-mode="add"]').click();
 await page.locator('#stage').tap();
 await page.waitForFunction(()=>window.__pillCounterTest.state().count===2);
 const editBox=await page.locator('#stage').boundingBox(),editX=editBox.x+editBox.width/2,editY=editBox.y+editBox.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:editX-20,y:editY,id:1},{x:editX+20,y:editY,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await new Promise(resolve=>setTimeout(resolve,450));
 assert.equal(await page.evaluate(()=>window.__pillCounterTest.state().count),2);
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await page.locator('#leave-confirm').click();
 await page.evaluate(()=>window.testPermissionDelay=350);
 await page.locator('#camera-open').click();await page.waitForFunction(()=>window.__pillCounterTest.state().captureStarting);
 await page.keyboard.press('Escape');await new Promise(resolve=>setTimeout(resolve,450));
 assert.equal(await page.evaluate(()=>window.__pillCounterTest.state().captureActive),false);
 assert.equal(await page.locator('#camera-open').isVisible(),true);
 await page.evaluate(()=>{window.testPermissionDelay=0;window.testPermissionDenied=true;});
 await page.locator('#camera-open').click();await page.waitForFunction(()=>!window.__pillCounterTest.state().captureStarting);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#camera-open').isVisible(),true);
 await page.locator('#live-tab').click();await page.waitForFunction(()=>!window.__pillCounterTest.state().starting);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#camera-open').isVisible(),true);
 console.log('PASS gallery, tap editing, Back during camera permission wait and denial');
 await page.route('**/before',route=>route.fulfill({contentType:'text/html',body:'<a href="/?test">Open counter</a>'}));
 await page.goto(base+'/before');await page.locator('a').click();
 await page.waitForFunction(()=>!!window.__pillCounterTest);
 await page.locator('#photo-tab').click();await page.keyboard.press('Escape');
 await page.locator('#exit-confirm').click();await page.waitForURL(base+'/before');
 console.log('PASS explicit exit reaches previous page without another prompt');
 // A separate tab has no previous document. Exercise the Samsung toolbar path
 // before any page activation, delayed/ignored forward, repeat and reload.
 for(const mode of ['normal','delayed','blocked']){
  const fresh=await context.newPage();fresh.on('dialog',dialog=>dialog.accept());fresh.on('pageerror',error=>errors.push(error.message));
  await fresh.addInitScript(mode=>{
   if(mode==='normal')return;
   const forward=history.forward.bind(history);
   history.forward=()=>{if(mode==='delayed')setTimeout(forward,250);};
  },mode);
  const freshURL=base+'/?test&toolbar-'+mode;
  await fresh.evaluate(url=>location.replace(url),freshURL);await fresh.waitForURL(freshURL);
  await fresh.waitForFunction(()=>history.state?.__pillCounterNavigation==='guard');
  const baseline=await fresh.evaluate(()=>({length:history.length,pushes:window.testHistoryPushes}));
  await fresh.goBack();
  await fresh.waitForFunction(()=>document.getElementById('exit-dialog').open,{},{timeout:1000});
  if(mode==='delayed')assert.equal(await fresh.evaluate(()=>history.state.__pillCounterNavigation),'base','confirmation must not wait for forward');
  if(mode!=='normal'){
   await fresh.locator('#exit-cancel').click();
   await fresh.goBack();await fresh.waitForFunction(()=>document.getElementById('exit-dialog').open);
   assert.equal(await fresh.evaluate(()=>history.length),baseline.length,'repair must not grow history');
  }
  await fresh.locator('#exit-confirm').click();await fresh.waitForURL(base+'/exit.html');
  assert.equal(await fresh.locator('h1').innerText(),'알약 카운터 사용을 마쳤어요');
  assert(!await fresh.locator('.message.error').count());
  await fresh.getByRole('link',{name:'알약 카운터 다시 열기'}).click();
  await fresh.waitForFunction(()=>!!document.getElementById('dispense-tab'));
  await fresh.reload();await fresh.goBack();await fresh.waitForFunction(()=>document.getElementById('exit-dialog').open);
  await fresh.locator('#exit-cancel').click();
  assert.equal(await fresh.locator('#camera-open').isVisible(),true);
  await fresh.close();console.log('PASS fresh-tab toolbar confirmation, exit without previous page, restart/reload',mode,baseline);
 }
 assert.deepEqual(errors,[]);console.log('PASS no browser errors; inference was mocked for geometry and navigation checks');
}finally{await browser.close();server.close();}
