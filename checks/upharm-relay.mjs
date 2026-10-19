import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRelay} from '../api/print-relay.js';
import {localDate} from '../src/dispensing-data.js';
const values=new Map();let clock=Date.now(),dropAck=false;
const store={async read(path){return values.get(path)||null;},async write(path,value,overwrite=false){if(values.has(path)&&!overwrite)throw Error('duplicate');values.set(path,structuredClone(value));},async paths(prefix,limit=100){return [...values.keys()].filter(path=>path.startsWith(prefix)).sort().slice(0,limit).map(path=>({path,uploadedAt:clock}));},async remove(paths){for(const path of paths)values.delete(path);}};
const relay=createRelay(store,()=>clock);
const server=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);req.body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
  res.status=value=>{res.statusCode=value;return res;};res.json=value=>{if(dropAck&&req.body.action==='spooled'){dropAck=false;res.destroy();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  await relay(req,res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const api=`http://127.0.0.1:${server.address().port}/api/print-relay`;
async function call(action,session={},data={},get=false){const args={action,station:session.id,...data};const response=await fetch(api+(get?'?'+new URLSearchParams(args):''),{method:get?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(session.token||'')},...(!get?{body:JSON.stringify(args)}:{})});return {status:response.status,body:await response.json()};}
const label={code:'8806723002015',name:'연동검증정',count:8,strength:'500 mg',manufacturer:'',lot:'LOT001',packedOn:localDate(),expiry:'2029-12-31',useBy:'',size:'dk22210',widthMm:29,heightMm:90,copies:1};
const directory=await mkdtemp(join(tmpdir(),'upharm-relay-'));
try {
  for(const [profile,scenario] of ['upharm','standalone'].flatMap(profile=>['success','lost-ack','crash','printer-error'].map(scenario=>[profile,scenario]))) {
    const station=(await call('create')).body,owner={id:station.id,token:station.ownerToken},sender={id:station.id,token:station.pairToken};
    const jobs=[];
    for(let i=0;i<(scenario==='printer-error'?2:1);i++){const jobId=randomUUID();jobs.push(jobId);assert.equal((await call('submit',sender,{jobId,label})).status,200);}
    const configPath=join(directory,'connection.json');
    await writeFile(configPath,JSON.stringify({schemaVersion:1,apiUrl:api,stationId:station.id,ownerToken:station.ownerToken,expiresAt:station.expiresAt}),{mode:0o600});
    dropAck=scenario==='lost-ack';
    const result=await promisify(execFile)('python',['checks/upharm-receiver.py',configPath,scenario,profile]);process.stdout.write(result.stdout);
    assert.equal((await call('status',sender,{jobId:jobs[0]},true)).body.status,['crash','printer-error'].includes(scenario)?'failed':'spooled');
    if(jobs.length===2)assert.equal((await call('status',sender,{jobId:jobs[1]},true)).body.status,'spooled');
    assert.equal((await call('jobs',owner,{},true)).body.jobs.length,0);
    assert.equal((await call('connection',sender,{},true)).body.receiver.app,profile==='standalone'?'pc-print-agent':'upharm-daily');
    assert.equal((await call('connection',sender,{},true)).body.receiver.online,true);
    clock+=61000;assert.equal((await call('connection',sender,{},true)).body.receiver.online,false);clock=Date.now();
    await call('close',owner);
  }
  const station=(await call('create')).body,owner={id:station.id,token:station.ownerToken},sender={id:station.id,token:station.pairToken};
  const jobId=randomUUID(),receiverId=randomUUID(),claimId=randomUUID();
  await call('submit',sender,{jobId,label});
  assert.equal((await call('claim',sender,{jobId,receiverId,claimId})).status,403);
  assert.equal((await call('receiver-heartbeat',sender,{receiverId,state:'ready',printerName:'Brother QL-550'})).status,403);
  const attempts=await Promise.all(Array.from({length:5},()=>call('claim',owner,{jobId,receiverId,claimId})));
  assert.equal(attempts.filter(x=>x.body.claimed).length,1);
  assert.equal((await call('status',sender,{jobId},true)).body.status,'processing');
  assert.equal((await call('printed',owner,{jobId})).status,409);
  assert.equal((await call('spooled',owner,{jobId,receiverId,claimId:randomUUID()})).status,409);
  assert.equal((await call('spooled',owner,{jobId,receiverId,claimId})).status,200);
  assert.equal((await call('failed',owner,{jobId,receiverId,claimId})).status,409);
  assert.equal((await call('claim',owner,{jobId,receiverId,claimId})).body.claimed,false);
  assert.equal((await call('submit',sender,{jobId,label})).body.duplicate,true);
  clock+=9*60*60*1000;assert.equal((await call('jobs',owner,{},true)).status,410);
  console.log('PASS receiver authorization, concurrent claim exclusivity, stale heartbeat, terminal status and expiry');
}finally{await rm(directory,{recursive:true,force:true});await new Promise(resolve=>server.close(resolve));}
