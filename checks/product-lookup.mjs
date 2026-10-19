import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import handler,{lookupProduct} from '../api/product-lookup.js';
import {normalizeProductCode} from '../src/product-code.js';
import {gs1Matrix} from './gs1-datamatrix.mjs';
import {parseProductBarcode} from '../src/dispensing-data.js';

const first='8806723002015',second='8806435016010';
assert.equal(normalizeProductCode(first),first);
assert.equal(normalizeProductCode('0'+first),first);
assert.equal(normalizeProductCode('8806723002016'),null);
assert.equal(normalizeProductCode('199303108'),null);
assert.equal(normalizeProductCode('18806723002012'),'18806723002012');
assert.equal(parseProductBarcode(']d2010'+first+'1729123110LOT-A\x1d21SERIAL').code,'0'+first);
const gs1='010'+first+'1729123110LOT-A\x1d21SERIAL';
for(const prefix of ['\x1d',']d2\x1d',']d2','']) {
  const parsed=parseProductBarcode(prefix+gs1);
  assert.equal(parsed.code,'0'+first);assert.equal(parsed.lot,'LOT-A');assert.equal(parsed.expiry,'2029-12-31');
}
assert.throws(()=>parseProductBarcode('\x00'+gs1));
const fake={source:{asOf:'2026-08-31'},entries:{[first]:[['Name','Maker','5mg','10','정','PTP','id','','9999-12-31']]}};
assert.equal(lookupProduct(first,fake).status,'found');
fake.entries[first][0][8]='2025-01-01';assert.equal(lookupProduct(first,fake).status,'historical');
fake.entries[first].push(['Other']);assert.equal(lookupProduct(first,fake).status,'ambiguous');
assert.equal(lookupProduct('18806723002012',fake).status,'not_found');

const remote=process.env.PILL_BASE_URL;
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const server=remote?null:createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/product-lookup') {
    res.status=value=>{res.statusCode=value;return res;};res.json=value=>res.end(JSON.stringify(value));
    return handler(req,res);
  }
  try {
    const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(resolve(root)+sep))return res.writeHead(403).end();
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');
    res.end(await readFile(path));
  }catch{res.writeHead(404).end();}
});
if(server)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=remote||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(remote&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'ko-KR',isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
if(remote&&process.env.HTTPS_PROXY)await page.route(base+'/**',async route=>{const response=await route.fetch({timeout:120000});await route.fulfill({response});});
try {
  const api=async code=>{const response=await context.request.get(base+'/api/product-lookup?'+new URLSearchParams({code}));return {status:response.status(),body:await response.json()};};
  const a=await api(first),b=await api('0'+first);
  assert.equal(a.status,200);assert.equal(a.body.status,'found');assert.deepEqual(a,b);
  assert.equal(a.body.product.name,'약국용타이레놀정500mg(아세트아미노펜)');
  assert.equal(a.body.product.packageQuantity,'10');
  assert.equal((await api('8806723002022')).body.product.packageQuantity,'20');
  assert.equal((await api('18806723002012')).body.status,'not_found');
  assert.equal((await api('8800505000305')).body.status,'historical');
  assert.equal((await api('8800734003603')).body.status,'found');
  assert.equal((await api('8806723002016')).status,400);
  assert.equal((await context.request.post(base+'/api/product-lookup?code='+first)).status(),405);
  console.log('PASS official catalog, checksum, zero-padded GS1, packaging distinction, historical and open-ended transfer dates');

  await page.goto(base);await page.locator('#dispense-tab').click();
  const apply=async code=>{await page.locator('#product-barcode').fill(code);await page.locator('#barcode-apply').click();};
  const settled=()=>page.waitForFunction(()=>!document.getElementById('dispense-start-count').disabled);
  const decoded=await page.evaluate(async pixels=>{
    const scale=10,margin=30,canvas=document.createElement('canvas');canvas.width=canvas.height=pixels.length*scale+margin*2;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='black';
    pixels.forEach((row,y)=>row.forEach((set,x)=>{if(set)ctx.fillRect(margin+x*scale,margin+y*scale,scale,scale);}));
    return (await new ZXingBrowser.BrowserMultiFormatReader().decodeFromImageUrl(canvas.toDataURL())).getText();
  },gs1Matrix(gs1));
  assert.equal(decoded,'\x1d'+gs1);
  // This is the exact scanner output that previously threw the unsupported error.
  await apply(decoded);await settled();
  assert.doesNotMatch(await page.locator('#label-validation').innerText(),/바코드를 적용/);
  assert.equal(await page.locator('#pc-banner-title').innerText(),'PC 연결 안 됨');
  await page.locator('#pc-connection-banner').click();assert(await page.locator('#printer-dialog').isVisible());await page.locator('#printer-dialog-close').click();
  console.log('PASS real GS1 DataMatrix image → shipped ZXing decoder → leading FNC1 → product lookup');
  assert.equal(await page.locator('#product-name').inputValue(),a.body.product.name);
  assert.equal(await page.locator('#product-strength').inputValue(),'500밀리그램');
  assert.equal(await page.locator('#product-lot').inputValue(),'LOT-A');
  assert.equal(await page.locator('#product-expiry').inputValue(),'2029-12-31');
  assert.equal(await page.locator('#dispense-count').innerText(),'—');
  assert.match(await page.locator('#barcode-status').innerText(),/2026-08-31/);
  assert.match(await page.locator('#product-lookup-details').innerText(),/10/);
  for(const width of [320,390,430,1280]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.setViewportSize({width:390,height:844});
  await mkdir('.test-results',{recursive:true});await page.screenshot({path:'.test-results/'+(remote?'production-':'')+'product-lookup.png',fullPage:true});
  await apply(second);await settled();
  assert.match(await page.locator('#product-name').inputValue(),/^아모디핀정/);
  assert.equal(await page.locator('#product-lot').inputValue(),'');assert.equal(await page.locator('#product-expiry').inputValue(),'');
  await apply('18806723002012');await settled();assert.equal(await page.locator('#product-name').inputValue(),'');assert.match(await page.locator('#barcode-status').innerText(),/찾지 못/);
  await apply('8800505000305');await settled();assert.equal(await page.locator('#product-name').inputValue(),'');assert.match(await page.locator('#barcode-status').innerText(),/취소·양도/);

  if(!remote) {
    // Hold a real response while the user edits/scans again. It must not win.
    let release,waiting;
    const gate=()=>{waiting=new Promise(resolve=>{release=resolve;});};
    await page.route('**/api/product-lookup?code='+first,async route=>{
      const response=await route.fetch();await waiting;
      await route.fulfill({response}).catch(()=>{});
    });
    gate();await apply(first);assert(await page.locator('#dispense-start-count').isDisabled());
    await apply(second);await settled();release();await page.waitForTimeout(100);
    assert.match(await page.locator('#product-name').inputValue(),/^아모디핀정/);
    gate();await apply(first);await page.locator('#product-name').fill('수동 입력');release();await page.waitForTimeout(100);
    assert.equal(await page.locator('#product-name').inputValue(),'수동 입력');assert(await page.locator('#dispense-start-count').isEnabled());
    await page.unroute('**/api/product-lookup?code='+first);
    await page.evaluate(code=>localStorage.setItem('pill-products-v1',JSON.stringify({['0'+code]:{name:'저장 제품',strength:'5mg',manufacturer:'저장 업체'}})),first);
    await page.reload();await page.locator('#dispense-tab').click();
    await page.route('**/api/product-lookup?**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"status":"unavailable"}'}));
    await apply(first);await settled();assert.equal(await page.locator('#product-name').inputValue(),'저장 제품');assert.match(await page.locator('#barcode-status').innerText(),/연결하지 못/);
    await page.unroute('**/api/product-lookup?**');await page.locator('#barcode-apply').click();await settled();assert.equal(await page.locator('#product-name').inputValue(),a.body.product.name);
    console.log('PASS stale request suppression, manual edit preservation, offline saved-product fallback and retry');
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({base,automaticProduct:a.body.product.name,catalogAsOf:a.body.source.asOf,apiAndMobile:'passed',browserErrors:errors}));
}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
