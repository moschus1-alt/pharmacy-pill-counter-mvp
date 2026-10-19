import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const base=process.env.PILL_BASE_URL||'https://pharmacy-pill-counter-mvp.vercel.app';
const browser=await chromium.launch({headless:true,...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{})});
const pc=await browser.newContext({viewport:{width:1280,height:900},locale:'ko-KR'});
const phone=await browser.newContext({viewport:{width:390,height:844},locale:'ko-KR',isMobile:true,hasTouch:true});
const desktop=await pc.newPage(),mobile=await phone.newPage(),errors=[];
const results=fileURLToPath(new URL('../.test-results/',import.meta.url));await mkdir(results,{recursive:true});
let created=false;
for(const page of [desktop,mobile]) {
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.addInitScript(()=>{window.printCalls=0;window.print=()=>{window.printCalls++;};});
  // In the managed environment Node trusts NODE_EXTRA_CA_CERTS. Chromium has
  // its own trust store. Forward through Playwright's TLS-verifying HTTP client
  // without disabling certificate verification or substituting API responses.
  if(process.env.HTTPS_PROXY)await page.route(base+'/**',async route=>{
    const response=await route.fetch({timeout:120000});await route.fulfill({response});
  });
}
try {
  const response=await desktop.goto(base+'/?test',{waitUntil:'networkidle'});assert.equal(response.status(),200);
  await desktop.locator('#dispense-tab').click();await desktop.locator('#printer-settings').click();
  await desktop.locator('#station-name').fill('기능 검증용 PC');
  const createResponse=desktop.waitForResponse(response=>response.url().endsWith('/api/print-relay')&&response.request().postDataJSON()?.action==='create');
  await desktop.locator('#station-create').click();
  const createdResponse=await createResponse;
  if(createdResponse.status()!==200)throw Error('Station create failed: '+createdResponse.status()+' '+await createdResponse.text());
  created=true;await desktop.waitForFunction(()=>!!sessionStorage.getItem('pill-label-station-v1'));
  const pairing=await desktop.evaluate(()=>{const station=JSON.parse(sessionStorage.getItem('pill-label-station-v1'));return `${location.origin}/?test#pc=${station.id}.${station.pairToken}`;});
  await desktop.locator('#printer-dialog-close').click();
  await mobile.goto(pairing,{waitUntil:'networkidle'});await mobile.waitForFunction(()=>document.getElementById('pc-connection-status').textContent.includes('연결됨'));
  await mobile.locator('#product-barcode').fill('(01)08801234567890(17)291231(10)TEST001');await mobile.locator('#barcode-apply').click();
  await mobile.locator('#product-name').fill('출력 시험용 예제정');await mobile.locator('#product-strength').fill('시험용 라벨');
  await mobile.locator('#dispense-start-count').click();
  const inference=mobile.waitForResponse(response=>response.url().endsWith('/api/analyze')&&response.request().method()==='POST',{timeout:120000});
  await mobile.locator('#file-input').setInputFiles(fileURLToPath(new URL('../examples/mediseg-8-pills.png',import.meta.url)));
  const inferred=await inference;assert.equal(inferred.status(),200);
  await mobile.waitForFunction(()=>window.__pillCounterTest.state().analyzed&&!window.__pillCounterTest.state().busy,{},{timeout:20000});
  const actualCount=await mobile.evaluate(()=>window.__pillCounterTest.state().count);assert.equal(actualCount,8);
  await mobile.locator('#confirm').click();await mobile.locator('#label-reviewed').check();
  await mobile.screenshot({path:results+'/production-dispensing-mobile.png',fullPage:true});
  const sendResponse=mobile.waitForResponse(response=>response.url().endsWith('/api/print-relay')&&response.request().postDataJSON()?.action==='submit');
  await mobile.locator('#label-send').click();assert.equal((await sendResponse).status(),200);
  await desktop.waitForFunction(()=>document.querySelectorAll('.received-job').length===1,{},{timeout:30000});
  await desktop.getByRole('button',{name:'라벨 보기·출력',exact:true}).click();
  assert.equal(await desktop.locator('#received-label-preview .label-heading strong').innerText(),'8개');
  await desktop.screenshot({path:results+'/production-dispensing-pc.png',fullPage:true});
  await desktop.locator('#received-label-print').click();assert.equal(await desktop.evaluate(()=>window.printCalls),1);
  // Verify print media renders only the 60 x 40 mm label, not the app/dialog.
  await desktop.emulateMedia({media:'print'});
  assert.equal(await desktop.locator('main').isVisible(),false);
  assert.equal(await desktop.locator('#label-print-area .label-paper').count(),1);
  const box=await desktop.locator('#label-print-area .label-paper').boundingBox();assert(Math.abs(box.width-60*96/25.4)<1);assert(Math.abs(box.height-40*96/25.4)<1);
  await desktop.pdf({path:results+'/production-label-60x40.pdf',preferCSSPageSize:true,printBackground:true});
  await desktop.emulateMedia({media:'screen'});
  await desktop.locator('#received-label-done').click();
  await mobile.waitForFunction(()=>document.getElementById('label-send-status').textContent.includes('실제 출력 완료'),{},{timeout:30000});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({url:base,actualModelCount:actualCount,inferenceStatus:inferred.status(),privateBlobRelay:'passed',phoneToPcFlow:'passed',printLayout:'60x40 mm',physicalPrinter:'not exercised',browserErrors:errors}));
}finally {
  if(created) {
    await desktop.evaluate(async()=>{const station=JSON.parse(sessionStorage.getItem('pill-label-station-v1')||'null');if(station){const response=await fetch('/api/print-relay',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${station.ownerToken}`},body:JSON.stringify({action:'close',station:station.id})});if(!response.ok)throw Error('Test station cleanup failed: '+response.status);}}).catch(error=>console.error(error.message));
  }
  await browser.close();
}
