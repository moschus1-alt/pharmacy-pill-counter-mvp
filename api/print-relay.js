import {put,get,list,del} from '@vercel/blob';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {labelIssues} from '../src/dispensing-data.js';

const TTL=8*60*60*1000, ROOT='pill-label-relay/';
const hash=value=>createHash('sha256').update(value).digest('hex');
const same=(token,expected)=>typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)&&typeof expected==='string'&&timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(expected,'hex'));
const stationPattern=/^\d{13}-[a-f0-9]{32}$/;
const jobPattern=/^[a-f0-9-]{36}$/;
const receiverPattern=/^[a-f0-9-]{36}$/;
const RECEIVER_ONLINE_MS=60000;
function fail(status,message){throw Object.assign(new Error(message),{status});}

export function normalizeLabel(input) {
  if (!input || typeof input!=='object') fail(400,'라벨 내용이 없어요.');
  const text=(key,max)=>String(input[key]??'').trim().slice(0,max);
  const data={code:text('code',100),name:text('name',80),strength:text('strength',40),manufacturer:text('manufacturer',60),lot:text('lot',40),expiry:text('expiry',10),useBy:text('useBy',10),packedOn:text('packedOn',10),size:text('size',10),count:input.count,copies:input.copies};
  if(['custom','dk22210'].includes(data.size)){data.widthMm=input.widthMm;data.heightMm=input.heightMm;}
  if (!/^[\x20-\x7e]+$/.test(data.code)) fail(400,'바코드를 확인해 주세요.');
  for (const field of ['expiry','useBy','packedOn']) {
    const value=data[field];
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)) fail(400,'날짜를 확인해 주세요.');
  }
  const issues=labelIssues(data);if(issues.length)fail(400,issues[0]);
  return data;
}

const storage={
  async read(path) {
    const result=await get(path,{access:'private',useCache:false});
    if(!result||result.statusCode!==200)return null;
    return JSON.parse(await new Response(result.stream).text());
  },
  async write(path,value,overwrite=false) {
    return put(path,JSON.stringify(value),{access:'private',addRandomSuffix:false,allowOverwrite:overwrite,contentType:'application/json',cacheControlMaxAge:0});
  },
  async paths(prefix,limit=100) {return (await list({prefix,limit})).blobs.map(blob=>({path:blob.pathname,uploadedAt:new Date(blob.uploadedAt).getTime()}));},
  async remove(paths) {if(paths.length)await del(paths);}
};

// The injected store lets the actual protocol be exercised without credentials.
export function createRelay(store=storage,now=()=>Date.now()) {
  return async function relay(req,res) {
    res.setHeader('Cache-Control','no-store');
    try {
      if (!['GET','POST'].includes(req.method)) {res.setHeader('Allow','GET, POST');fail(405,'지원하지 않는 요청이에요.');}
      const url=new URL(req.url,'https://relay.invalid');
      let body={};
      if(req.method==='POST') {
        if(Number(req.headers['content-length']||0)>16384)fail(413,'라벨 내용이 너무 길어요.');
        try {body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};}catch{fail(400,'요청 형식이 올바르지 않아요.');}
        if(JSON.stringify(body).length>16384)fail(413,'라벨 내용이 너무 길어요.');
      }
      const action=req.method==='POST'?body.action:url.searchParams.get('action');
      const send=value=>res.status(200).json(value);
      if(req.method==='POST'&&action==='create') {
        // Bounded cleanup of expired temporary files; no medication archive.
        const old=await store.paths(ROOT,200);
        await store.remove(old.filter(x=>Number(x.path.slice(ROOT.length,ROOT.length+13))+TTL<now()).map(x=>x.path));
        const id=`${now()}-${randomBytes(16).toString('hex')}`,ownerToken=randomBytes(32).toString('hex'),pairToken=randomBytes(32).toString('hex');
        const name=String(body.name||'라벨 출력 PC').trim().slice(0,40)||'라벨 출력 PC';
        const station={id,name,ownerHash:hash(ownerToken),pairHash:hash(pairToken),expiresAt:now()+TTL};
        await store.write(`${ROOT}${id}/station.json`,station);
        return send({id,name,ownerToken,pairToken,expiresAt:station.expiresAt});
      }
      const id=body.station||url.searchParams.get('station');
      if(!stationPattern.test(id||''))fail(400,'PC 연결 정보가 올바르지 않아요.');
      const prefix=`${ROOT}${id}/`,station=await store.read(prefix+'station.json');
      if(!station||station.expiresAt<=now())fail(410,'PC 연결이 종료됐어요. PC의 새 연결 QR을 읽어 주세요.');
      const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
      const owner=same(token,station.ownerHash),sender=same(token,station.pairHash);
      if(!owner&&!sender)fail(403,'PC 연결을 다시 확인해 주세요.');
      async function connectionState() {
        const saved=await store.read(prefix+'receiver.json');
        const receiver=saved?{app:'upharm-daily',printerName:saved.printerName,state:saved.state,updatedAt:saved.updatedAt,online:now()-saved.updatedAt<RECEIVER_ONLINE_MS}:null;
        return {name:station.name,expiresAt:station.expiresAt,receiver};
      }
      if((req.method==='POST'&&action==='pair')||(req.method==='GET'&&action==='connection'))return send(await connectionState());
      if(req.method==='POST'&&action==='receiver-heartbeat') {
        if(!owner)fail(403,'유팜데일리의 PC 연결 정보가 필요해요.');
        if(!receiverPattern.test(body.receiverId||'')||!['ready','error','stopped'].includes(body.state))fail(400,'수신 프로그램 상태를 확인해 주세요.');
        const printerName=String(body.printerName||'').trim().slice(0,120);
        if(!printerName)fail(400,'유팜데일리에서 출력 프린터를 선택해 주세요.');
        await store.write(prefix+'receiver.json',{receiverId:body.receiverId,printerName,state:body.state,updatedAt:now()},true);
        return send(await connectionState());
      }
      if(req.method==='GET'&&action==='jobs') {
        if(!owner)fail(403,'출력 PC에서만 라벨을 받을 수 있어요.');
        const files=await store.paths(prefix+'jobs/',30);
        const jobs=(await Promise.all(files.map(x=>store.read(x.path)))).filter(Boolean).sort((a,b)=>a.createdAt-b.createdAt);
        const pending=[];
        for(const job of jobs) {
          if(await store.read(prefix+`status/${job.id}.json`))continue;
          const claim=await store.read(prefix+`claims/${job.id}.json`);
          pending.push({...job,status:claim?'processing':'waiting',...(claim?{claimedAt:claim.at}:{})});
        }
        return send({jobs:pending,...await connectionState()});
      }
      if(req.method==='POST'&&action==='close') {
        if(!owner)fail(403,'출력 PC에서만 연결을 종료할 수 있어요.');
        // Revoke authorization first, even if deleting queued files later fails.
        await store.remove([prefix+'station.json']);
        await store.remove((await store.paths(prefix,1000)).map(x=>x.path));
        return send({closed:true});
      }
      const jobId=body.jobId||url.searchParams.get('jobId');
      if(!jobPattern.test(jobId||''))fail(400,'라벨 요청 번호가 올바르지 않아요.');
      const jobPath=prefix+`jobs/${jobId}.json`,statusPath=prefix+`status/${jobId}.json`,claimPath=prefix+`claims/${jobId}.json`;
      if(req.method==='POST'&&action==='submit') {
        if(!sender)fail(403,'연결된 휴대폰에서 전송해 주세요.');
        const label=normalizeLabel(body.label);
        const previous=await store.read(jobPath),status=await store.read(statusPath);
        if(previous||status)return send({jobId,status:status?.status||'waiting',duplicate:true});
        if((await store.paths(prefix+'jobs/',30)).length>=20)fail(409,'PC의 대기 라벨을 먼저 출력해 주세요. 한 번에 20개까지 보낼 수 있어요.');
        const job={id:jobId,label,createdAt:now()};
        try {await store.write(jobPath,job);}catch(error) {
          if(!await store.read(jobPath))throw error;
        }
        return send({jobId,status:'waiting'});
      }
      if(req.method==='GET'&&action==='status') {
        const status=await store.read(statusPath);
        if(status)return send(status);
        const claim=await store.read(claimPath);
        if(claim)return send({status:'processing',at:claim.at});
        if(await store.read(jobPath))return send({status:'waiting'});
        fail(404,'라벨 요청을 찾지 못했어요.');
      }
      if(req.method==='POST'&&action==='claim') {
        if(!owner)fail(403,'유팜데일리에서만 출력을 시작할 수 있어요.');
        if(!receiverPattern.test(body.receiverId||'')||!receiverPattern.test(body.claimId||''))fail(400,'출력 처리 번호를 확인해 주세요.');
        if(await store.read(statusPath)||await store.read(claimPath))return send({claimed:false});
        if(!await store.read(jobPath))fail(404,'라벨 요청을 찾지 못했어요.');
        // A durable, create-only claim is never automatically released. If the
        // receiver crashes around spooling, another receiver must not reprint it.
        try {await store.write(claimPath,{receiverId:body.receiverId,claimId:body.claimId,at:now()});}
        catch(error){if(await store.read(claimPath))return send({claimed:false});throw error;}
        return send({claimed:true});
      }
      if(req.method==='POST'&&['spooled','failed'].includes(action)) {
        if(!owner)fail(403,'유팜데일리에서 출력 상태를 알려 주세요.');
        const claim=await store.read(claimPath);
        if(!claim||claim.receiverId!==body.receiverId||claim.claimId!==body.claimId)fail(409,'이 라벨의 출력 처리 권한이 없어요.');
        const previous=await store.read(statusPath);
        if(previous){if(previous.status!==action)fail(409,'이미 처리 결과가 기록됐어요.');return send(previous);}
        const reason=action==='failed'&&['printer','layout','uncertain'].includes(body.reason)?body.reason:action==='failed'?'uncertain':undefined;
        const status={status:action,at:now(),...(reason?{reason}:{})};
        try{await store.write(statusPath,status);}catch(error){const saved=await store.read(statusPath);if(!saved)throw error;if(saved.status!==action)fail(409,'이미 처리 결과가 기록됐어요.');return send(saved);}
        await store.remove([jobPath]);
        return send(status);
      }
      if(req.method==='POST'&&['printed','dismissed'].includes(action)) {
        if(!owner)fail(403,'출력 PC에서 확인해 주세요.');
        const previous=await store.read(statusPath);
        if(previous)return send(previous);
        if(await store.read(claimPath))fail(409,'유팜데일리에서 처리 중이에요. 프린터 출력물을 먼저 확인해 주세요.');
        if(!await store.read(jobPath))fail(404,'라벨 요청을 찾지 못했어요.');
        const status={status:action,at:now()};
        await store.write(statusPath,status);
        await store.remove([jobPath]);
        return send(status);
      }
      fail(400,'지원하지 않는 요청이에요.');
    } catch(error) {
      // Never include storage credentials, pairing tokens or label data in logs.
      if(!error.status)console.error('Label relay storage request failed:',error.name||'Error');
      res.status(error.status||503).json({error:error.status?error.message:'PC 연결 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'});
    }
  };
}

export default createRelay();
