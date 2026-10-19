import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
const directory=await mkdtemp(join(tmpdir(),'pill-direct-'));
const child=spawn('python',['checks/direct-browser-server.py',directory],{stdio:['pipe','pipe','pipe']});
const server=await new Promise((resolve,reject)=>{
 let text='';
 child.stdout.on('data',part=>{
  text+=part;
  if(text.includes('\n')){
   try{resolve(JSON.parse(text.split('\n')[0]));}
   catch{reject(Error('Fixture could not start'));}
  }
 });
 child.on('error',reject);child.on('exit',code=>reject(Error('Fixture exited '+code)));
});
// Trust only this ephemeral fixture leaf key. Python tests separately perform
// full CA/hostname validation, and shipped browser code never bypasses TLS.
const browser=await chromium.launch({headless:true,args:['--ignore-certificate-errors-spki-list='+server.spki]});
const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),pc=await browser.newPage();
const errors=[],external=[],cloud=[];
for(const page of [phone,pc]){page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.on('request',r=>{if(!r.url().startsWith('https://127.0.0.1:')&&!r.url().startsWith('http://127.0.0.1:')&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());if(/\/api\/(print-relay|analyze)/.test(r.url()))cloud.push(r.url());});}
try{
 await pc.goto(server.adminUrl);await pc.waitForFunction(()=>document.getElementById('qr').children.length>0);assert.match(await pc.locator('#status').textContent(),/준비 완료/);
 const url=new URL(server.mobileUrl);url.search='test';await phone.goto(url.href);await phone.waitForFunction(()=>document.getElementById('pc-banner-title').textContent==='PC 직접 연결됨');
 assert(await phone.evaluate(()=>isSecureContext&&!!navigator.mediaDevices?.getUserMedia));assert.equal(await phone.evaluate(()=>location.hash),'');
 assert.equal(await phone.locator('#mobile-connection-help').isVisible(),false);
 await phone.locator('#product-barcode').fill('(01)08801234567890(17)291231(10)LOT001');await phone.locator('#barcode-apply').click();
 await phone.waitForFunction(()=>!document.getElementById('barcode-status').textContent.includes('조회하고'));
 await phone.locator('#product-name').fill('테스트정_(성분명)');await phone.locator('#dispense-start-count').click();
 await phone.locator('#file-input').setInputFiles('examples/mediseg-8-pills.png');await phone.waitForFunction(()=>window.__pillCounterTest.state().analyzed&&!window.__pillCounterTest.state().busy,null,{timeout:120000});
 assert.equal(await phone.evaluate(()=>window.__pillCounterTest.state().count),8);
 await phone.locator('#confirm').click();await phone.locator('#label-reviewed').check();await phone.locator('#label-send').click();
 await phone.waitForFunction(()=>document.getElementById('label-send-status').textContent.includes('프린터로 보냈어요'),null,{timeout:20000});
 let printed=JSON.parse(await readFile(join(directory,'printed.json'),'utf8'));assert.equal(printed.length,1);assert.equal(printed[0].count,8);assert.equal(printed[0].name,'테스트정');assert.equal(printed[0].widthMm,29);
 await mkdir('.test-results',{recursive:true});await phone.screenshot({path:'.test-results/direct-mobile.png',fullPage:true});await pc.screenshot({path:'.test-results/direct-pc.png',fullPage:true});
 await phone.reload();await phone.waitForFunction(()=>document.getElementById('pc-banner-title').textContent==='PC 직접 연결됨');
 // A single persistent local event stream, no polling storage. Rotate invalidates.
 await pc.locator('#rotate').click();await phone.waitForFunction(()=>document.getElementById('pc-banner-title').textContent==='PC 연결 안 됨',null,{timeout:20000});
 for(const width of [320,390,1280]){await phone.setViewportSize({width,height:844});assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 assert.equal(JSON.parse(await readFile(join(directory,'printed.json'),'utf8')).length,1);assert.deepEqual(cloud,[]);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 console.log('PASS HTTPS LAN UI → local barcode lookup → real 8-pill model → confirmation → direct PC mock spool; reconnect/QR rotation; zero external requests, zero Blob/API analysis requests, no physical printing');
}finally{await browser.close();child.stdin.end('stop\n');await new Promise(r=>child.on('exit',r));await rm(directory,{recursive:true,force:true});}
