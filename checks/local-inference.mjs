import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {chromium,request} from 'playwright';
import {compareResults} from '../src/local-inference.js';
const root=resolve('dist'),hits=new Map(),base=process.env.LOCAL_TEST_URL;
let server;
if(!base){server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname,path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep))return res.writeHead(403).end();hits.set(pathname,(hits.get(pathname)||0)+1);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));}
const origin=base||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(base&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{})}),page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const api=await request.newContext({proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY}:undefined}),errors=[],report=[];
page.on('pageerror',e=>errors.push(e.message));
if(base&&process.env.HTTPS_PROXY)await page.route(origin+'/**',async route=>{const response=await route.fetch({timeout:120000});await route.fulfill({response});});
await page.addInitScript(()=>{const Original=Worker;window.workerResults=[];window.Worker=class extends Original{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='result')window.workerResults.push(data);});}};});
let serverRequests=0,serverResult=null,failServer=false,chunkRequests=0;
page.on('request',req=>{if(/\/model-download\/.*\.bin/.test(req.url()))chunkRequests++;});
await page.route('**/api/analyze',async route=>{
 serverRequests++;if(failServer)return route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'다른 사진을 분석 중입니다.'})});
 const response=await api.post('https://pharmacy-pill-counter-mvp.vercel.app/api/analyze',{headers:{'Content-Type':route.request().headers()['content-type'],'X-Confidence':'.5'},data:route.request().postDataBuffer(),timeout:120000});
 assert.equal(response.status(),200);serverResult=await response.json();await route.fulfill({response});
});
const idle=()=>page.waitForFunction(()=>document.querySelector('#cancel').hidden,null,{timeout:180000});
const localResult=()=>page.evaluate(()=>window.workerResults.at(-1));
async function compare(label){
 await page.locator('#compare').click();await idle();assert.match(await page.locator('#status').textContent(),/비교 완료/);
 const local=await localResult(),match=compareResults(local.objects,serverResult.objects);
 assert.equal(match.localOnly,0,label);assert.equal(match.serverOnly,0,label);assert(match.maxBoxDelta<.1,label);assert(match.maxConfidenceDelta<.001,label);
 report.push({label,count:local.objects.length,timings:local.timings,serverMs:serverResult.processingTimeMs,match});
}
try{
 await page.goto(origin+'/local-test.html');await page.locator('#sample').click();await idle();
 await page.locator('#run-local').click();await idle();assert.match(await page.locator('#status').textContent(),/기기 인식 완료/);assert.equal(await page.locator('#local-count').textContent(),'8');assert.equal(serverRequests,0);assert.equal(chunkRequests,10);
 report.push({label:'first local sample',...(await localResult())});
 const downloaded=chunkRequests;
 await page.reload();await page.locator('#sample').click();await idle();await page.locator('#run-local').click();await idle();
 assert.match(await page.locator('#status').textContent(),/기기 인식 완료/);assert.equal(chunkRequests,downloaded,'model must be reused after reload');assert.equal(await page.locator('#local-count').textContent(),'8');assert.equal(serverRequests,0);
 if(process.env.LOCAL_TEST_COMPARE==='1')await compare('8-pill square');
 await page.locator('#run-local').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('알약을 찾고'));await page.locator('#cancel').click();await idle();assert.match(await page.locator('#status').textContent(),/중지/);assert.equal(await page.locator('#engine-state').textContent(),'준비 전');
 await page.locator('#run-local').click();await idle();assert.equal(await page.locator('#local-count').textContent(),'8');assert.equal(chunkRequests,downloaded);
 failServer=true;await page.locator('#compare').click();await idle();assert.match(await page.locator('#status').textContent(),/기기 인식은 완료/);assert.equal(await page.locator('#local-count').textContent(),'8');assert.equal(await page.locator('#server-card').isVisible(),false);failServer=false;
 // Odd non-square dimensions exercise exact centering/sampling in real inference.
 const portrait=await page.evaluate(async()=>{const source=document.querySelector('#preview'),c=document.createElement('canvas');c.width=641;c.height=833;const ctx=c.getContext('2d');ctx.fillStyle='#222';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(source,0,96,641,640);return Array.from(new Uint8Array(await(await new Promise(r=>c.toBlob(r))).arrayBuffer()));});
 await page.locator('#file').setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:Buffer.from(portrait)});await idle();
 if(process.env.LOCAL_TEST_COMPARE==='1')await compare('odd portrait');else{await page.locator('#run-local').click();await idle();assert.equal(await page.locator('#local-count').textContent(),'8');}
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`layout ${width}`);}
 await page.setViewportSize({width:390,height:844});await mkdir('.test-results',{recursive:true});await page.screenshot({path:'.test-results/local-inference.png',fullPage:true});
 // No GPU on the headless runner: a readable error must leave CPU recoverable.
 await page.locator('#backend').selectOption('webgpu');await page.locator('#prepare').click();await idle();
 const gpuStatus=await page.locator('#status').textContent();report.push({gpuStatus});
 if(!gpuStatus.includes('엔진 준비 완료'))assert.match(gpuStatus,/CPU/);
 await page.locator('#backend').selectOption('wasm');await page.locator('#run-local').click();await idle();assert.equal(await page.locator('#local-count').textContent(),'8');
 assert.deepEqual(errors,[]);await writeFile('.test-results/local-inference.json',JSON.stringify(report,null,2));
 console.log('PASS real LiteRT model inference, 8-pill detection, no local photo upload, cached reload, cancellation/recovery, server failure retention, non-square photo, GPU recovery, 320/390/1280 layout'+(process.env.LOCAL_TEST_COMPARE==='1'?', real server box/score parity':''));
 console.log(JSON.stringify(report.filter(x=>x.match||x.gpuStatus)));
}finally{await browser.close();await api.dispose();server?.closeAllConnections();server?.close();}
