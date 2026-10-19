import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
const root=resolve('dist');let apiCalls=0;
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(path.startsWith('/api/')){apiCalls++;res.writeHead(410).end('{}');return;}try{res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[extname(path==='/'?'/index.html':path)]||'application/octet-stream');res.end(await readFile(resolve(root,'.'+(path==='/'?'/index.html':path))));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true}),pc=await browser.newPage({viewport:{width:1280,height:900}}),phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const base=`http://127.0.0.1:${server.address().port}`,errors=[];for(const page of [pc,phone])page.on('pageerror',e=>errors.push(e.message));
try{
 await pc.goto(base+'/');await pc.waitForSelector('#pc-panel');assert(await pc.locator('#pc-direct-download').isVisible());assert.equal(await pc.locator('#pc-direct-download').getAttribute('href'),'/integrations/pill-counter-direct.zip');assert(!(await pc.locator('#photo-tab').isVisible()));
 await phone.goto(base+'/?view=mobile#pc=1234567890123.'+'a'.repeat(32)+'.'+'b'.repeat(64));await phone.waitForFunction(()=>document.getElementById('printer-connection-message').textContent.includes('이전 클라우드 연결'));await phone.locator('#dispense-tab').click();await phone.locator('#printer-settings').click();assert(!(await phone.locator('#station-create').isVisible()));
 for(const width of [320,390,1280]){await pc.setViewportSize({width,height:900});assert(await pc.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await new Promise(r=>setTimeout(r,6000));assert.equal(apiCalls,0);assert.deepEqual(errors,[]);console.log('PASS PC direct setup/download, mobile legacy-link retirement and no cloud polling at startup/idle');
}finally{await browser.close();server.closeAllConnections();server.close();}
