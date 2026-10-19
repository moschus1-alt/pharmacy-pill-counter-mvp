import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,extname,sep} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {buildModelDownload} from '../scripts/build-model-download.mjs';
import {MODEL_HASH,validateManifest} from '../src/model-store.js';
const directory=await mkdtemp(join(tmpdir(),'model-download-')),data=Buffer.alloc(100000);
for(let i=0;i<data.length;i++)data[i]=(i*37+11)%256;
const sha=createHash('sha256').update(data).digest('hex'),root=resolve('dist'),hits=new Map();
await writeFile(join(directory,'fixture.tflite'),data);
const manifest=await buildModelDownload(join(directory,'fixture.tflite'),join(directory,'assets'),{expectedHash:sha,partBytes:20000});
assert.equal(manifest.bytes,data.length);assert.equal(manifest.parts.length,5);validateManifest(manifest,sha);
assert.throws(()=>validateManifest({...manifest,bytes:data.length+1},sha));
assert.throws(()=>validateManifest({...manifest,parts:[{...manifest.parts[0],url:'https://example.com/model'}]},sha));
await assert.rejects(buildModelDownload(join(directory,'fixture.tflite'),join(directory,'bad'),{expectedHash:'0'.repeat(64)}),/hash mismatch/);
let corrupt=true,slow=true;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try{
    if(url.pathname==='/model-download/manifest.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(manifest));}
    if(url.pathname.startsWith('/model-download/')){
      hits.set(url.pathname,(hits.get(url.pathname)||0)+1);const part=manifest.parts.find(part=>part.url===url.pathname);
      if(!part)return res.writeHead(404).end();let bytes=await readFile(join(directory,'assets',...url.pathname.split('/').slice(2)));
      if(corrupt&&part===manifest.parts[1]){bytes=Buffer.from(bytes);bytes[0]^=1;}
      if(slow&&part===manifest.parts[1]){res.write(bytes.subarray(0,100));const timer=setTimeout(()=>res.end(bytes.subarray(100)),1000);res.on('close',()=>clearTimeout(timer));return;}
      return res.end(bytes);
    }
    const path=resolve(root,'.'+url.pathname);if(!path.startsWith(root+sep))return res.writeHead(403).end();
    let bytes=await readFile(path);
    if(url.pathname==='/src/model-store.js')bytes=Buffer.from(bytes.toString().replace(MODEL_HASH,sha));
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(bytes);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/model.html`);
  await page.waitForFunction(()=>!document.getElementById('model-download').disabled);
  await page.locator('#model-download').click();
  await page.waitForFunction(()=>{const value=document.getElementById('model-progress').value;return value>20&&value<40;});
  await page.locator('#model-cancel').click();await page.waitForFunction(()=>document.getElementById('model-status').textContent.includes('중지했어요'));
  assert(!await page.locator('#model-save').isVisible());slow=false;
  await page.locator('#model-download').click();
  await page.waitForFunction(()=>document.getElementById('model-status').textContent.includes('완전하지'));
  assert(!await page.locator('#model-save').isVisible());
  assert.equal(hits.get(manifest.parts[0].url),1);
  corrupt=false;await page.locator('#model-download').click();await page.waitForFunction(()=>!document.getElementById('model-save').hidden);
  assert.equal(hits.get(manifest.parts[0].url),1);assert.equal(hits.get(manifest.parts[1].url),3);
  const waiting=page.waitForEvent('download');await page.locator('#model-save').click();const download=await waiting;
  assert.equal(download.suggestedFilename(),'pill-counter-model.tflite');assert.equal(createHash('sha256').update(await readFile(await download.path())).digest('hex'),sha);
  await page.reload();await page.waitForFunction(()=>document.getElementById('model-cached').textContent==='저장됨');
  const before=JSON.stringify([...hits]);await page.locator('#model-download').click();await page.waitForFunction(()=>!document.getElementById('model-download').disabled);assert.equal(JSON.stringify([...hits]),before);
  await page.locator('#model-remove').click();await page.waitForFunction(()=>document.getElementById('model-cached').textContent==='저장 안 됨');assert(!await page.locator('#model-save').isVisible());
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await mkdir('.test-results',{recursive:true});await page.screenshot({path:'.test-results/model-download.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS model builder integrity, cancellation, corrupt download rejection, resume, verified file export, reload/cache reuse, removal and responsive UI');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
