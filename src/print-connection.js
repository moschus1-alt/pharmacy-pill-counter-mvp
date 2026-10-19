import {createLabel,printLabel} from './label-view.js';
import {localDate} from './dispensing-data.js';

const $=id=>document.getElementById(id),senderKey='pill-label-sender-v1',stationKey='pill-label-station-v1';
function readSession(key){try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}}
function saveSession(key,value){try{value?sessionStorage.setItem(key,JSON.stringify(value)):sessionStorage.removeItem(key);}catch{ /* Session still works in memory. */ }}
export async function relayRequest(action,session={},data={},get=false) {
  const parameters={action,station:session.id,...data};
  const url='/api/print-relay'+(get?'?'+new URLSearchParams(parameters):'');
  let response;
  try {response=await fetch(url,{method:get?'GET':'POST',headers:{'Content-Type':'application/json',...(session.token?{Authorization:`Bearer ${session.token}`}:{})},...(get?{}:{body:JSON.stringify(parameters)}),signal:AbortSignal.timeout(15000),cache:'no-store'});}
  catch{throw Error('PC 연결 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');}
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(Error(result.error||'PC 연결 요청에 실패했어요.'),{status:response.status});
  return result;
}

export function printConnection({onChange,onOpenDispensing}) {
  let sender=readSession(senderKey),station=readSession(stationKey),pollTimer=null,polling=false,activeJob=null,jobs=[],pairURL='',disposed=false;
  const connectionMessage=text=>$('printer-connection-message').textContent=text;
  function sync() {
    if(sender?.expiresAt<=Date.now()){sender=null;saveSession(senderKey,null);}
    $('pc-connection-status').textContent=sender?`${sender.name} 연결됨`:'출력 PC를 연결해 주세요';
    $('pc-connection-dot').classList.toggle('connected',!!sender);
    $('pc-disconnect').hidden=!sender;
    $('pc-station-panel').hidden=!station;
    $('station-create').textContent=station?'연결 QR 다시 보기':'이 PC에서 라벨 받기';
    onChange?.();
  }
  async function pair(value) {
    const url=new URL(value,location.href);
    const match=new URLSearchParams(url.hash.slice(1)).get('pc')?.match(/^(\d{13}-[a-f0-9]{32})\.([a-f0-9]{64})$/);
    if(url.origin!==location.origin||!match)throw Error('이 앱의 PC 연결 링크를 입력해 주세요.');
    const candidate={id:match[1],token:match[2]};
    const result=await relayRequest('pair',candidate);
    sender={...candidate,...result};saveSession(senderKey,sender);sync();connectionMessage(`${sender.name}에 연결했어요.`);
    onOpenDispensing();return sender;
  }
  function showPairing() {
    if(!station)return;
    const url=new URL(location.pathname,location.origin);url.hash=new URLSearchParams({pc:`${station.id}.${station.pairToken}`}).toString();pairURL=url.href;
    $('station-pairing').hidden=false;$('station-name-display').textContent=station.name;
    $('station-expiry').textContent=`연결 종료 예정: ${new Date(station.expiresAt).toLocaleString('ko-KR')}`;
    const qr=window.qrcode(0,'M');qr.addData(pairURL);qr.make();
    // QR markup is generated only from our own validated connection URL.
    $('station-qr').innerHTML=qr.createSvgTag({cellSize:4,margin:16,scalable:true});
  }
  function renderJobs() {
    $('station-jobs').replaceChildren();
    for(const job of jobs) {
      const card=document.createElement('article');card.className='received-job';
      const title=document.createElement('strong');title.textContent=job.label.name;
      const detail=document.createElement('p');detail.className='helper';detail.textContent=`${job.label.count}개 · ${job.label.copies}장 · ${new Date(job.createdAt).toLocaleTimeString('ko-KR')}`;
      const row=document.createElement('div');row.className='save-row';
      const open=document.createElement('button');open.className='primary';open.textContent='라벨 보기·출력';open.onclick=()=>openJob(job);
      const dismiss=document.createElement('button');dismiss.className='secondary';dismiss.textContent='요청 취소';dismiss.onclick=async()=>{
        if(!window.confirm(`${job.label.name} 라벨 요청을 취소할까요?`))return;
        dismiss.disabled=true;
        try{await relayRequest('dismissed',{id:station.id,token:station.ownerToken},{jobId:job.id});jobs=jobs.filter(x=>x.id!==job.id);renderJobs();}
        catch(error){$('station-status').textContent=error.message;dismiss.disabled=false;}
      };
      row.append(open,dismiss);card.append(title,detail,row);$('station-jobs').append(card);
    }
  }
  async function poll() {
    if(!station||disposed||polling)return;
    polling=true;const current=station.id;
    try {
      const result=await relayRequest('jobs',{id:station.id,token:station.ownerToken},{},true);
      if(current!==station?.id)return;
      const changed=JSON.stringify(jobs)!==JSON.stringify(result.jobs);jobs=result.jobs;
      if(changed)renderJobs();
      $('station-status').textContent=jobs.length?`${jobs.length}건의 라벨이 도착했어요.`:'휴대폰의 라벨 전송을 기다리고 있어요.';
    }catch(error) {
      if(current!==station?.id)return;
      $('station-status').textContent=error.message;
      if(error.status===410||error.status===403){station=null;saveSession(stationKey,null);$('station-pairing').hidden=true;connectionMessage(error.message);sync();}
    }finally {
      polling=false;clearTimeout(pollTimer);
      if(station&&!disposed)pollTimer=setTimeout(poll,document.hidden?12000:5000);
    }
  }
  function openJob(job) {
    activeJob=job;
    $('received-label-preview').replaceChildren(createLabel(job.label));
    $('received-label-meta').textContent=`${job.label.count}개 · 동일 라벨 ${job.label.copies}장 · ${job.label.size.replace('x',' × ')} mm`;
    $('received-label-status').textContent='제품명과 수량을 확인한 뒤 인쇄해 주세요.';
    $('received-label-done').disabled=true;$('received-label-print').disabled=false;
    $('received-label-dialog').showModal();
  }
  $('printer-settings').onclick=$('pc-connect-inline').onclick=()=>{$('printer-dialog').showModal();if(station)showPairing();};
  $('printer-dialog-close').onclick=()=>$('printer-dialog').close();
  $('pc-link-apply').onclick=async()=>{
    $('pc-link-apply').disabled=true;
    try{await pair($('pc-link-input').value.trim());$('pc-link-input').value='';}catch(error){connectionMessage(error.message);}
    finally{$('pc-link-apply').disabled=false;}
  };
  $('pc-disconnect').onclick=()=>{sender=null;saveSession(senderKey,null);sync();connectionMessage('휴대폰 연결을 해제했어요.');};
  $('station-create').onclick=async()=>{
    if(station){showPairing();return;}
    $('station-create').disabled=true;connectionMessage('PC 연결을 준비하고 있어요…');
    try {
      station=await relayRequest('create',{}, {name:$('station-name').value});
      saveSession(stationKey,station);sync();showPairing();onOpenDispensing();connectionMessage('휴대폰 카메라로 QR을 읽어 연결해 주세요.');void poll();
    }catch(error){connectionMessage(error.message);}
    finally{$('station-create').disabled=false;}
  };
  $('station-copy').onclick=async()=>{
    try{await navigator.clipboard.writeText(pairURL);connectionMessage('연결 링크를 복사했어요. 휴대폰에서 열어 주세요.');}
    catch{$('pc-link-input').value=pairURL;$('pc-link-input').select();connectionMessage('입력란의 링크를 직접 복사해 주세요.');}
  };
  $('station-close').onclick=async()=>{
    if(!station||!window.confirm('PC 연결을 종료할까요? 아직 출력하지 않은 요청도 취소됩니다.'))return;
    $('station-close').disabled=true;
    try{await relayRequest('close',{id:station.id,token:station.ownerToken});station=null;jobs=[];clearTimeout(pollTimer);saveSession(stationKey,null);$('station-pairing').hidden=true;renderJobs();sync();}
    catch(error){$('station-status').textContent=error.message;}
    finally{$('station-close').disabled=false;}
  };
  $('printer-test').onclick=()=>{
    try{printLabel({name:'프린터 연결 테스트',code:'1234567890128',count:1,packedOn:localDate(),copies:1,size:'60x40'},{test:true});connectionMessage('인쇄 창에서 PC에 연결된 라벨프린터를 선택해 주세요.');}
    catch(error){connectionMessage(error.message);}
  };
  $('received-label-close').onclick=()=>$('received-label-dialog').close();
  $('received-label-print').onclick=()=>{
    if(!activeJob)return;
    try{printLabel(activeJob.label);$('received-label-done').disabled=false;$('received-label-status').textContent='실제 출력물을 확인한 뒤 아래에서 완료해 주세요.';}
    catch(error){$('received-label-status').textContent=error.message;}
  };
  $('received-label-done').onclick=async()=>{
    if(!activeJob||!station)return;
    $('received-label-done').disabled=true;
    try{await relayRequest('printed',{id:station.id,token:station.ownerToken},{jobId:activeJob.id});jobs=jobs.filter(x=>x.id!==activeJob.id);renderJobs();$('received-label-dialog').close();activeJob=null;}
    catch(error){$('received-label-status').textContent=error.message;$('received-label-done').disabled=false;}
  };
  window.addEventListener('pagehide',()=>{disposed=true;clearTimeout(pollTimer);});
  window.addEventListener('pageshow',()=>{disposed=false;if(station)void poll();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&station){clearTimeout(pollTimer);void poll();}});
  queueMicrotask(()=>{
    sync();if(station){onOpenDispensing();void poll();}
    const hash=new URLSearchParams(location.hash.slice(1));
    if(hash.has('pc')) {
      const link=location.href;history.replaceState(history.state,'',location.pathname+location.search);
      onOpenDispensing();void pair(link).catch(error=>{connectionMessage(error.message);$('printer-dialog').showModal();});
    }
  });
  return {
    connected:()=>!!sender&&sender.expiresAt>Date.now(),
    async send(label,jobId){if(!sender)throw Error('출력 PC를 먼저 연결해 주세요.');return relayRequest('submit',sender,{label,jobId});},
    async status(jobId){if(!sender)throw Error('출력 PC 연결이 해제됐어요.');return relayRequest('status',sender,{jobId},true);},
    refresh:sync
  };
}
