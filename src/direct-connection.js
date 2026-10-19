const $=id=>document.getElementById(id),key='pill-direct-token-v1';
function getToken(){try{return sessionStorage.getItem(key)||'';}catch{return '';}}
function storeToken(value){try{value?sessionStorage.setItem(key,value):sessionStorage.removeItem(key);}catch{}}
export function directPrintConnection({onChange,onOpenDispensing}){
 const local=document.body.dataset.direct==='1';let token=local?getToken():'',info=null,online=false,stream=null,retry=null,stopped=false,retryMs=1000,refreshing=null;
 const say=text=>$('printer-connection-message').textContent=text;
 // Retire cloud sessions without contacting Blob or trying to migrate jobs.
 for(const old of ['pill-label-sender-v1','pill-label-station-v1'])try{sessionStorage.removeItem(old);}catch{}
 $('station-create').hidden=true;$('upharm-config-download').hidden=true;$('upharm-connection-status').hidden=true;$('pc-station-panel').hidden=true;
 $('desktop-connection-tools').hidden=true;$('pc-change').hidden=true;
 $('mobile-connection-help').innerHTML='<p class="helper">PC 직접 연결 프로그램 또는 유팜데일리에 표시된 새 QR을 읽어 주세요. 같은 공유기에 연결돼 있어야 해요.</p>';
 function sync(){
  const ready=online&&info?.state==='ready'&&info.expiresAt>Date.now();
  const title=ready?'PC 직접 연결됨':online?'PC 프린터 확인 필요':token?'PC 연결 끊김':'PC 연결 안 됨';
  const detail=online?`${info.name} · ${info.printerName}`:token?'PC 프로그램과 같은 공유기 연결을 확인해 주세요.':'PC에서 직접 연결 QR을 읽어 주세요.';
  $('pc-connection-banner').dataset.state=ready?'connected':token?'warning':'disconnected';
  $('pc-banner-title').textContent=title;$('pc-banner-detail').textContent=detail;$('pc-banner-action').textContent=ready?'연결 관리 ›':'연결하기 ›';
  $('dispense-count-connection').textContent=`${title}${info?' · '+info.printerName:''}`;
  $('pc-connection-status').textContent=title;$('pc-connection-dot').classList.toggle('connected',ready);
  $('mobile-connection-help').hidden=ready;$('mobile-connection-current').hidden=!token;$('mobile-link-fields').hidden=ready;
  $('mobile-pc-name').textContent=info?.name||'직접 연결 PC';$('mobile-pc-state').textContent=title;$('pc-disconnect').hidden=!token;
  $('printer-settings').textContent=ready?'연결 관리':'PC 연결';document.querySelector('.connection-summary').hidden=ready;
  document.querySelector('.local-print-options').hidden=document.documentElement.dataset.inputDevice==='mobile';
  onChange?.();
 }
 async function call(action,data={}){
  if(!local||!token)throw Error('PC에서 표시한 직접 연결 QR을 먼저 읽어 주세요.');
  const post=action==='submit',url='/api/direct'+(post?'':'?'+new URLSearchParams({action,...data}));
  let response;try{response=await fetch(url,{method:post?'POST':'GET',headers:{Authorization:'Bearer '+token,...(post?{'Content-Type':'application/json'}:{})},...(post?{body:JSON.stringify({action,...data})}:{}),signal:AbortSignal.timeout(15000),cache:'no-store'});}catch{throw Error('PC에 연결하지 못했어요. PC 전원과 공유기 연결을 확인해 주세요.');}
  const result=await response.json();if(!response.ok){if([403,410].includes(response.status)){token='';storeToken('');online=false;stream?.abort();sync();}throw Object.assign(Error(result.error||'PC 요청에 실패했어요.'),{status:response.status});}return result;
 }
 async function listen(){
  if(!local||!token||stopped||document.hidden)return;
  stream?.abort();const current=new AbortController();stream=current;let watchdog;
  const alive=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>current.abort(),30000);};
  try{
   const response=await fetch('/api/direct/events',{headers:{Authorization:'Bearer '+token},signal:current.signal,cache:'no-store'});
   if(!response.ok)throw Error('PC 연결을 확인해 주세요.');
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';alive();
   try{while(true){const {done,value}=await reader.read();if(done)break;alive();buffer+=decoder.decode(value,{stream:true});let boundary;
    while((boundary=buffer.indexOf('\n\n'))>=0){const packet=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);if(packet.startsWith('data: ')){info=JSON.parse(packet.slice(6));online=true;retryMs=1000;sync();}}
   }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }catch(error){if(current.signal.aborted)return;}
  finally{clearTimeout(watchdog);if(stream===current){stream=null;online=false;sync();if(!stopped&&token&&!document.hidden){clearTimeout(retry);retry=setTimeout(()=>void refresh(),retryMs);retryMs=Math.min(15000,retryMs*2);}}}
 }
 async function refresh(){
  if(!local||!token||stopped||refreshing)return;
  refreshing=(async()=>{try{info=await call('connection');online=true;sync();if(!stream)void listen();}catch(error){online=false;say(error.message);sync();if(token&&!stopped&&!document.hidden){clearTimeout(retry);retry=setTimeout(()=>void refresh(),retryMs);retryMs=Math.min(15000,retryMs*2);}}})();
  try{await refreshing;}finally{refreshing=null;}
 }
 function consume(){
  const params=new URLSearchParams(location.hash.slice(1));
  if(params.has('direct')&&local){const candidate=params.get('direct');if(/^[a-f0-9]{64}$/.test(candidate)){token=candidate;storeToken(token);stream?.abort();stream=null;history.replaceState(history.state,'',location.pathname+location.search);void refresh();onOpenDispensing();}}
  else if(params.has('pc')){history.replaceState(history.state,'',location.pathname+location.search);say('이전 클라우드 연결은 종료됐어요. PC의 새 직접 연결 QR을 읽어 주세요.');}
 }
 $('pc-connection-banner').onclick=$('printer-settings').onclick=$('pc-connect-inline').onclick=()=>{$('printer-dialog').showModal();void refresh();};
 $('printer-dialog-close').onclick=()=>$('printer-dialog').close();
 $('pc-link-apply').onclick=()=>{
  try{const url=new URL($('pc-link-input').value.trim());const ip=url.hostname.split('.').map(Number),privateHost=/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)&&ip.every(n=>n>=0&&n<=255)&&(ip[0]===10||(ip[0]===172&&ip[1]>=16&&ip[1]<=31)||(ip[0]===192&&ip[1]===168));
   if(url.protocol!=='https:'||!privateHost||url.username||url.password||url.pathname!='/local.html'||url.search||!/^direct=[a-f0-9]{64}$/.test(url.hash.slice(1)))throw Error('PC에 표시된 새 직접 연결 주소를 입력해 주세요.');
   location.assign(url.href);
  }catch(error){say(error.message);}
 };
 $('pc-disconnect').onclick=()=>{token='';storeToken('');stream?.abort();stream=null;clearTimeout(retry);online=false;info=null;sync();say('이 휴대폰 연결을 해제했어요.');};
 $('received-label-close').onclick=()=>$('received-label-dialog').close();
 addEventListener('hashchange',consume);addEventListener('pagehide',()=>{stopped=true;stream?.abort();stream=null;clearTimeout(retry);});
 addEventListener('pageshow',()=>{stopped=false;void refresh();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){stream?.abort();stream=null;online=false;clearTimeout(retry);}else void refresh();});
 queueMicrotask(()=>{consume();sync();void refresh();});
 return {connected:()=>online&&info?.state==='ready'&&info.expiresAt>Date.now(),automatic:()=>true,send:(label,jobId)=>call('submit',{label,jobId}),status:jobId=>call('status',{jobId}),refresh:()=>void refresh()};
}
