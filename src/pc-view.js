import {relayRequest} from './print-connection.js';

export function isPcView({search='',hash='',userAgent='',platform='',maxTouchPoints=0,coarsePointer=false,pairedSender=false}={}) {
  // Pairing links always belong to the sending device, including desktop-site
  // mode on mobile browsers. Do not turn them into a second receiving station.
  if(new URLSearchParams(hash.slice(1)).has('pc')||pairedSender)return false;
  const override=new URLSearchParams(search).get('view');
  if(override==='mobile')return false;
  if(override==='pc')return true;
  if(/Android|iPhone|iPad|iPod/i.test(userAgent))return false;
  if(platform==='MacIntel'&&maxTouchPoints>1)return false;
  if(/Windows/i.test(userAgent))return true;
  return !(maxTouchPoints>0&&coarsePointer);
}

export function detectPcDevice() {
  return isPcView({userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints,coarsePointer:matchMedia('(pointer:coarse)').matches});
}

export function detectPcView() {
  let pairedSender=false;
  try{const sender=JSON.parse(sessionStorage.getItem('pill-label-sender-v1')||'null');pairedSender=!!sender?.id&&sender.expiresAt>Date.now();}catch{}
  return isPcView({search:location.search,hash:location.hash,userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints,coarsePointer:matchMedia('(pointer:coarse)').matches,pairedSender});
}

export function mountPcView() {
  const $=id=>document.getElementById(id);
  document.title='휴대폰 연결 · 알약 카운터';
  document.querySelector('.header-note').textContent='PC 연결 화면';
  const panel=document.createElement('section');panel.id='pc-panel';panel.setAttribute('aria-labelledby','pc-title');
  panel.innerHTML=`
    <div class="pc-home-heading"><p class="eyebrow">알약 카운터 · PC</p><h1 id="pc-title">휴대폰과 연결하세요</h1><p>바코드 읽기와 카운팅은 휴대폰에서 진행하고,<br>PC에서는 연결과 라벨 수신을 관리해요.</p></div>
    <div class="pc-home-grid">
      <section class="pc-home-card" id="pc-web-connection" aria-labelledby="pc-web-title"><span class="pc-home-tag">유팜데일리 없이 사용</span><h2 id="pc-web-title">이 PC에서 자동 출력</h2>
        <p class="helper">연결 프로그램을 실행하고 프린터를 선택하세요.</p>
        <button id="pc-agent-download" class="primary full">Windows 자동 출력 설정 받기</button>
        <p id="pc-agent-message" class="helper" role="status">ZIP 압축 해제 → Start.cmd 실행 → 프린터 선택</p>
        <div id="pc-web-status"></div><div id="pc-web-controls"></div>
        <p class="pc-home-note">연결 프로그램을 켜 두면 웹창을 닫아도 출력돼요. 연결은 8시간 유지돼요.</p>
        <details class="pc-home-advanced"><summary>수동 인쇄 · 연결 파일</summary><div id="pc-web-options"></div></details>
      </section>
      <section class="pc-home-card" aria-labelledby="pc-upharm-title"><h2 id="pc-upharm-title">유팜데일리를 쓰고 있다면</h2>
        <p class="helper">기존 유팜데일리 연결도 그대로 사용할 수 있어요.</p>
        <details id="pc-upharm-options"><summary>유팜데일리로 연결</summary>
        <div id="pc-auto-setup"><form id="pc-auto-form"><label for="pc-auto-link">유팜데일리의 ‘새 연결 만들기’에서 받은 주소</label><input id="pc-auto-link" type="text" autocomplete="off" placeholder="연결 주소 붙여넣기" required><button id="pc-auto-connect" class="secondary full">연결 확인</button></form></div>
        <p id="pc-auto-status" class="pc-auto-status" role="status" data-state="waiting">자동 출력 연결 전</p>
        <div id="pc-auto-pairing" hidden><strong id="pc-auto-name"></strong><p id="pc-auto-printer" class="helper"></p><div id="pc-auto-qr" aria-label="유팜데일리 휴대폰 연결 QR"></div><p class="helper">휴대폰으로 QR을 읽고 라벨을 전송하세요.</p><p id="pc-auto-expiry" class="helper"></p><button id="pc-auto-copy" class="secondary full">휴대폰 연결 주소 복사</button><button id="pc-auto-change" class="text-button full">연결 주소 변경</button></div>
        </details>
      </section>
    </div>
    <div id="pc-web-jobs"></div>
    <p class="pc-home-footer">휴대폰에서는 같은 주소를 열면 카운팅 화면이 나와요. <a href="?view=mobile">이 기기에서 카운팅 화면 열기</a></p>`;
  document.querySelector('main').prepend(panel);
  $('pc-web-status').append($('pc-connection-banner'));
  $('pc-connection-banner').querySelector('.pc-banner-label').textContent='이 PC의 출력 연결';
  $('pc-agent-download').onclick=()=>document.dispatchEvent(new Event('pc-agent-download')); 
  $('pc-connection-banner').onclick=()=>{$('pc-web-controls').scrollIntoView({behavior:'smooth',block:'center'});$('station-create').focus({preventScroll:true});};
  const nameLabel=document.querySelector('label[for="station-name"]');
  $('pc-web-controls').append(nameLabel,$('station-name'));
  $('pc-agent-download').before($('pc-web-controls'));
  $('pc-web-status').after($('station-pairing'),$('printer-connection-message'));
  $('station-create').className='secondary full';
  $('pc-web-options').append($('station-create'),$('upharm-config-download'),$('upharm-connection-status'),$('printer-settings'));
  $('printer-settings').textContent='프린터 설정';
  $('pc-web-jobs').append($('pc-station-panel'));
  setupAutomaticConnection();
}

function setupAutomaticConnection() {
  const $=id=>document.getElementById(id),key='pill-label-observer-v1';
  let session=null,timer=null,refreshing=false,disposed=false,pairUrl='';
  try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved?.expiresAt>Date.now()&&/^\d{13}-[a-f0-9]{32}$/.test(saved.id)&&/^[a-f0-9]{64}$/.test(saved.token))session=saved;}catch{}
  function save(){try{session?sessionStorage.setItem(key,JSON.stringify(session)):sessionStorage.removeItem(key);}catch{}}
  function message(text,state='waiting'){$('pc-auto-status').textContent=text;$('pc-auto-status').dataset.state=state;}
  function render() {
    $('pc-auto-setup').hidden=!!session;$('pc-auto-pairing').hidden=!session;
    if(!session)return;
    $('pc-upharm-options').open=true;
    const receiver=session.receiver,ready=receiver?.online&&Date.now()-receiver.updatedAt<60000&&receiver.state==='ready';
    message(ready?'자동 출력 준비됨':receiver?.state==='error'?'유팜데일리 프린터 확인 필요':'유팜데일리 수신 연결 확인 필요',ready?'ready':'waiting');
    $('pc-auto-name').textContent=session.name;
    $('pc-auto-printer').textContent=receiver?.printerName||'유팜데일리에서 라벨 수신을 시작해 주세요.';
    $('pc-auto-expiry').textContent=`연결 만료: ${new Date(session.expiresAt).toLocaleString('ko-KR')}`;
    const url=new URL(document.body.dataset.inference==='local'?'/local.html':'/',location.origin);url.hash=`pc=${session.id}.${session.token}`;
    if(pairUrl!==url.href){pairUrl=url.href;const qr=window.qrcode(0,'M');qr.addData(pairUrl);qr.make();$('pc-auto-qr').innerHTML=qr.createSvgTag({cellSize:4,margin:16,scalable:true});}
  }
  async function refresh() {
    if(!session||refreshing||disposed)return;
    const current=session;refreshing=true;
    try {
      const state=await relayRequest('connection',current,{},true);
      if(session!==current)return;
      Object.assign(session,state);save();render();
    }catch(error){if(session===current){if(error.status===403||error.status===410){session=null;save();render();message('연결이 만료됐어요. 유팜데일리에서 새 연결 주소를 만들어 주세요.');}else message('자동 출력 연결 상태를 확인하지 못했어요.','error');}}
    finally{refreshing=false;clearTimeout(timer);if(session&&!disposed)timer=setTimeout(refresh,15000);}
  }
  $('pc-auto-form').onsubmit=async event=>{
    event.preventDefault();$('pc-auto-connect').disabled=true;message('유팜데일리 연결 확인 중…');
    try {
      const url=new URL($('pc-auto-link').value.trim());
      const match=new URLSearchParams(url.hash.slice(1)).get('pc')?.match(/^(\d{13}-[a-f0-9]{32})\.([a-f0-9]{64})$/);
      if(url.origin!==location.origin||!match)throw Error('유팜데일리에 표시된 알약카운터 연결 주소를 입력해 주세요.');
      const candidate={id:match[1],token:match[2]};
      const state=await relayRequest('pair',candidate);
      session={...candidate,...state};pairUrl='';save();render();$('pc-auto-link').value='';void refresh();
    }catch(error){message(error.message,'error');}
    finally{$('pc-auto-connect').disabled=false;}
  };
  $('pc-auto-copy').onclick=async()=>{try{await navigator.clipboard.writeText(pairUrl);message('휴대폰 연결 주소를 복사했어요.');}catch{message('주소 복사를 지원하지 않아요. 휴대폰으로 QR을 읽어 주세요.');}};
  $('pc-auto-change').onclick=()=>{session=null;pairUrl='';clearTimeout(timer);save();$('pc-auto-qr').replaceChildren();render();message('새 유팜데일리 연결 주소를 입력해 주세요.');};
  window.addEventListener('pagehide',()=>{disposed=true;clearTimeout(timer);});
  window.addEventListener('pageshow',()=>{disposed=false;void refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  render();void refresh();
}
