import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const remote=process.env.PILL_BASE_URL,root=fileURLToPath(new URL('../dist/',import.meta.url));
const server=remote?null:createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/before'){res.setHeader('Content-Type','text/html');return res.end('<a href="/">Open counter</a>');}
  const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(resolve(root)+sep))return res.writeHead(403).end();
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
 }catch{res.writeHead(404).end();}
});
if(server)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=remote||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(remote&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];
try{
 for(const mode of ['normal','delayed','blocked','legacy']){
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  if(remote&&process.env.HTTPS_PROXY)await page.route(base+'/**',async route=>{const response=await route.fetch({timeout:120000});await route.fulfill({response});});
  await page.addInitScript(mode=>{
   if(mode==='legacy')Object.defineProperty(window,'CloseWatcher',{value:undefined});
   if(mode==='delayed'||mode==='blocked'){const forward=history.forward.bind(history);history.forward=()=>{if(mode==='delayed')setTimeout(forward,250);};}
  },mode);
  // Replace the automation-created about:blank to model a tab with no prior page.
  await page.evaluate(url=>location.replace(url),base+'/');await page.waitForURL(base+'/');
  await page.waitForFunction(()=>history.state?.__pillCounterNavigation==='guard');
  const length=await page.evaluate(()=>history.length);assert.equal(length,2);
  for(let i=0;i<3;i++){
   await page.goBack();await page.waitForFunction(()=>document.getElementById('exit-dialog').open);
   await page.locator('#exit-cancel').click();
   await page.waitForTimeout(300);
   assert.equal(await page.locator('#exit-dialog').isVisible(),false,'late restoration must not reopen confirmation');
   assert.equal(await page.evaluate(()=>history.length),length,'history must remain bounded');
  }
  await page.reload();await page.goBack();await page.waitForFunction(()=>document.getElementById('exit-dialog').open);
  await page.locator('#exit-confirm').click();await page.waitForURL(base+'/exit.html');
  assert.equal(await page.locator('h1').innerText(),'알약 카운터 사용을 마쳤어요');
  assert(!await page.locator('body').innerText().then(text=>text.includes('앱을 닫지 못했어요')));
  await page.getByRole('link',{name:'알약 카운터 다시 열기'}).click();await page.waitForFunction(()=>history.state?.__pillCounterNavigation==='guard');
  if(mode==='normal'){
   await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('exit-dialog').open);
   await page.locator('#exit-confirm').click();await page.waitForURL(base+'/exit.html');
  }
  console.log('PASS toolbar before first tap, repeated cancel, delayed/blocked restore, reload, exit and restart:',mode);
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({base,navigation:'passed',browserErrors:errors,samsungPhysicalDevice:'not available'}));
}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
