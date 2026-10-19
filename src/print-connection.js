import {zipStore} from './zip-store.js';
import {createLabel,printLabel} from './label-view.js';
import {localDate,labelSizeText} from './dispensing-data.js';

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

export function printConnection({onChange,onOpenDispensing,getPaperSettings=()=>({size:'60x40'})}) {
  let sender=readSession(senderKey),station=readSession(stationKey),pollTimer=null,polling=false,activeJob=null,jobs=[],pairURL='',disposed=false,connectionTimer=null,stationIssue=false,refreshing=false,changingConnection=false;
  const connectionMessage=text=>$('printer-connection-message').textContent=text;
  function sync() {
    if(sender?.expiresAt<=Date.now()){sender=null;saveSession(senderKey,null);}
    if(station?.expiresAt<=Date.now()){station=null;saveSession(stationKey,null);$('station-pairing').hidden=true;}
    const receiver=(sender||station)?.receiver;
    const receiverOnline=!!receiver?.online&&Date.now()-receiver.updatedAt<60000;
    const autoReady=receiverOnline&&receiver.state==='ready';
    const receiverName=receiver?.app==='pc-print-agent'?'PC':'유팜데일리';
    const receiverTitle=autoReady?`${receiverName} 자동 출력 연결됨`:receiverOnline&&receiver.state==='error'?`${receiverName} 프린터 확인 필요`:`${receiverName} 자동 출력 연결 끊김`;
    const state=receiver?(autoReady?'connected':'warning'):sender?'connected':station?(stationIssue?'warning':'receiving'):'disconnected';
    const title=receiver?receiverTitle:sender?'PC 연결됨':station?(stationIssue?'PC 수신 연결 확인 필요':'이 PC에서 라벨 받는 중'):'PC 연결 안 됨';
    const detail=receiver?`${(sender||station).name} · ${receiver.printerName} · ${autoReady?'휴대폰에서 전송하면 자동 출력해요.':`${receiverName} 출력 연결 프로그램을 확인해 주세요.`}`:sender?`${sender.name} · PC의 출력 대기 화면을 열어 두세요.`:station?`${station.name} · ${stationIssue?'인터넷 연결을 확인해 주세요.':'휴대폰을 연결하려면 QR을 보여 주세요.'}`:'라벨을 받을 PC를 연결해 주세요.';
    $('pc-connection-banner').dataset.state=state;
    $('pc-banner-title').textContent=title;$('pc-banner-detail').textContent=detail;
    $('pc-banner-action').textContent=sender?'연결 관리 ›':station?'연결 QR ›':'연결하기 ›';
    $('upharm-config-download').hidden=!station;
    $('upharm-connection-status').textContent=receiver?`${receiverTitle} · ${receiver.printerName}`:'유팜데일리 수신 연결을 기다리고 있어요.';
    $('dispense-count-connection').textContent=receiver?`${receiverTitle} · ${receiver.printerName}`:sender?`출력 PC: ${sender.name} · 연결됨`:station?title:'출력 PC 연결 안 됨';
    $('pc-connection-status').textContent=sender?(receiver?receiverTitle:`${sender.name} 연결됨`):'출력 PC를 연결해 주세요';
    $('pc-connection-dot').classList.toggle('connected',!!sender&&(!receiver||autoReady));
    $('pc-disconnect').hidden=!sender;
    $('mobile-connection-help').hidden=!!sender;
    $('mobile-connection-current').hidden=!sender;
    $('mobile-link-fields').hidden=!!sender&&!changingConnection;
    $('pc-change').hidden=changingConnection;
    $('mobile-pc-name').textContent=sender?.name||'';
    $('mobile-pc-state').textContent=receiver?receiverTitle:sender?'연결됨':'';
    $('printer-settings').textContent=document.documentElement.dataset.deviceView==='pc'?'프린터 설정':sender?'연결 관리':'PC 연결';
    document.querySelector('.connection-summary').hidden=!!sender;
    document.querySelector('.local-print-options').hidden=!!sender&&document.documentElement.dataset.inputDevice==='mobile';
    $('pc-station-panel').hidden=!station;
    $('station-create').textContent=station?'연결 QR 다시 보기':document.documentElement.dataset.deviceView==='pc'?'프로그램 없이 수동 인쇄 연결':'이 PC에서 라벨 받기';
    onChange?.();
  }
  async function pair(value) {
    const url=new URL(value,location.href);
    const match=new URLSearchParams(url.hash.slice(1)).get('pc')?.match(/^(\d{13}-[a-f0-9]{32})\.([a-f0-9]{64})$/);
    if(url.origin!==location.origin||!match)throw Error('이 앱의 PC 연결 링크를 입력해 주세요.');
    const candidate={id:match[1],token:match[2]};
    const result=await relayRequest('pair',candidate);
    changingConnection=false;sender={...candidate,...result};saveSession(senderKey,sender);sync();connectionMessage(`${sender.name}에 연결했어요.`);
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
      if(station?.receiver||job.status==='processing'){
        const status=document.createElement('p');status.className='helper';status.textContent=job.status==='processing'?'프린터로 전달 중이에요. 오래 멈춰 있다면 실제 출력물을 확인해 주세요.':'자동 출력을 기다리고 있어요.';
        card.append(title,detail,status);$('station-jobs').append(card);continue;
      }
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
      stationIssue=false;const receiverChanged=JSON.stringify(station.receiver)!==JSON.stringify(result.receiver);station.receiver=result.receiver;sync();
      const changed=JSON.stringify(jobs)!==JSON.stringify(result.jobs);jobs=result.jobs;
      if(changed||receiverChanged)renderJobs();
      $('station-status').textContent=jobs.length?`${jobs.length}건의 라벨이 도착했어요.`:'휴대폰의 라벨 전송을 기다리고 있어요.';
    }catch(error) {
      if(current!==station?.id)return;
      stationIssue=true;sync();$('station-status').textContent=error.message;
      if(error.status===410||error.status===403){station=null;saveSession(stationKey,null);$('station-pairing').hidden=true;connectionMessage(error.message);sync();}
    }finally {
      polling=false;clearTimeout(pollTimer);
      if(station&&!disposed)pollTimer=setTimeout(poll,document.hidden?12000:5000);
    }
  }
  async function refreshConnection() {
    sync();if(refreshing||disposed)return;
    const session=sender||station;if(!session)return;
    refreshing=true;
    try {
      const state=await relayRequest('connection',{id:session.id,token:sender?session.token:session.ownerToken},{},true);
      if(session!==(sender||station))return;
      session.receiver=state.receiver;sync();
    }catch(error){if(session===(sender||station)){if(session.receiver)session.receiver.online=false;if(error.status===410||error.status===403){if(session===sender){sender=null;saveSession(senderKey,null);}else{station=null;saveSession(stationKey,null);}}sync();}}
    finally{refreshing=false;}
  }
  document.addEventListener('pc-agent-download',async()=>{
    const button=$('pc-agent-download'),message=$('pc-agent-message');
    button.disabled=true;message.textContent='출력 연결 파일을 준비하고 있어요…';
    try {
      if(station?.expiresAt<=Date.now())station=null;
      if(!station){station=await relayRequest('create',{}, {name:$('station-name').value||'라벨 출력 PC'});saveSession(stationKey,station);stationIssue=false;sync();void poll();}
      showPairing();
      const files=['Start.cmd','Start.ps1','Print-Label.ps1','Barcode.ps1','receiver.py','README.txt','JsBarcode-LICENSE.txt'];
      const entries=await Promise.all(files.map(async name=>{
        const response=await fetch('/integrations/pc-printer/'+name,{cache:'no-store'});
        if(!response.ok)throw Error('출력 프로그램을 받지 못했어요. 다시 눌러 주세요.');
        return [name,new Uint8Array(await response.arrayBuffer())];
      }));
      const response=await fetch('/integrations/upharm-daily/pill_counter_relay.py',{cache:'no-store'});
      if(!response.ok)throw Error('출력 프로그램을 받지 못했어요. 다시 눌러 주세요.');
      entries.push(['pill_counter_relay.py',new Uint8Array(await response.arrayBuffer())]);
      entries.push(['connection.json',JSON.stringify({schemaVersion:1,apiUrl:new URL('/api/print-relay',location.origin).href,stationId:station.id,ownerToken:station.ownerToken,expiresAt:station.expiresAt},null,2)]);
      const url=URL.createObjectURL(zipStore(entries)),link=document.createElement('a');link.href=url;link.download='pill-counter-auto-print.zip';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
      message.textContent='압축을 풀고 Start.cmd를 실행하세요. 프린터 선택 후 휴대폰으로 아래 QR을 읽으면 돼요.';
    }catch(error){message.textContent=error.message;}
    finally{button.disabled=false;}
  });
  $('upharm-config-download').onclick=()=>{
    if(!station)return;
    const config={schemaVersion:1,apiUrl:new URL('/api/print-relay',location.origin).href,stationId:station.id,ownerToken:station.ownerToken,expiresAt:station.expiresAt,printerHint:'Brother QL-550',paper:getPaperSettings()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='upharm-daily-connection.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    connectionMessage('유팜데일리 연동용 연결 파일을 저장했어요. 해당 PC의 유팜데일리에 연동 기능을 적용한 뒤 등록해 주세요.');
  };
  function openJob(job) {
    activeJob=job;
    $('received-label-preview').replaceChildren(createLabel(job.label));
    $('received-label-meta').textContent=`${job.label.count}개 · 동일 라벨 ${job.label.copies}장 · ${labelSizeText(job.label)}`;
    $('received-label-status').textContent='제품명과 수량을 확인한 뒤 인쇄해 주세요.';
    $('received-label-done').disabled=true;$('received-label-print').disabled=false;
    $('received-label-dialog').showModal();
  }
  $('pc-connection-banner').onclick=$('printer-settings').onclick=$('pc-connect-inline').onclick=()=>{$('printer-dialog').showModal();if(station)showPairing();};
  $('printer-dialog-close').onclick=()=>$('printer-dialog').close();
  $('pc-link-apply').onclick=async()=>{
    $('pc-link-apply').disabled=true;
    try{await pair($('pc-link-input').value.trim());$('pc-link-input').value='';}catch(error){connectionMessage(error.message);}
    finally{$('pc-link-apply').disabled=false;}
  };
  $('pc-change').onclick=()=>{changingConnection=true;sync();$('pc-link-input').focus();};
  $('pc-disconnect').onclick=()=>{changingConnection=false;sender=null;saveSession(senderKey,null);sync();connectionMessage('휴대폰 연결을 해제했어요.');};
  $('station-create').onclick=async()=>{
    if(station){showPairing();return;}
    $('station-create').disabled=true;connectionMessage('PC 연결을 준비하고 있어요…');
    try {
      stationIssue=false;station=await relayRequest('create',{}, {name:$('station-name').value});
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
    try{printLabel({name:'프린터 연결 테스트',code:'1234567890128',count:1,packedOn:localDate(),copies:1,...getPaperSettings()},{test:true});connectionMessage('인쇄 창에서 PC에 연결된 라벨프린터를 선택해 주세요.');}
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
  window.addEventListener('pagehide',()=>{disposed=true;clearTimeout(pollTimer);clearInterval(connectionTimer);});
  window.addEventListener('pageshow',()=>{disposed=false;sync();clearInterval(connectionTimer);connectionTimer=setInterval(()=>void refreshConnection(),15000);if(station)void poll();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){void refreshConnection();if(station){clearTimeout(pollTimer);void poll();}}});
  queueMicrotask(()=>{
    sync();clearInterval(connectionTimer);connectionTimer=setInterval(()=>void refreshConnection(),15000);void refreshConnection();if(station){onOpenDispensing();void poll();}
    consumePairLink();
  });
  function consumePairLink() {
    const hash=new URLSearchParams(location.hash.slice(1));
    if(hash.has('pc')) {
      const link=location.href;history.replaceState(history.state,'',location.pathname+location.search);
      onOpenDispensing();void pair(link).catch(error=>{connectionMessage(error.message);$('printer-dialog').showModal();});
    }
  }
  window.addEventListener('hashchange',consumePairLink);
  async function senderRequest(action,data,get=false) {
    if(!sender)throw Error('출력 PC를 먼저 연결해 주세요.');
    const current=sender;
    try{return await relayRequest(action,current,data,get);}
    catch(error){
      if(sender===current&&(error.status===403||error.status===410)){
        sender=null;saveSession(senderKey,null);sync();connectionMessage('PC 연결이 종료됐어요. 다시 연결해 주세요.');
      }
      throw error;
    }
  }
  return {
    connected:()=>!!sender&&sender.expiresAt>Date.now(),
    async send(label,jobId){return senderRequest('submit',{label,jobId});},
    async status(jobId){return senderRequest('status',{jobId},true);},
    automatic:()=>!!sender?.receiver,
    refresh:()=>void refreshConnection()
  };
}
