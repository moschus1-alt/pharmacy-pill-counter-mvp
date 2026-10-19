export function isPcView({search='',hash='',userAgent='',platform='',maxTouchPoints=0,coarsePointer=false,pairedSender=false}={}) {
  // Pairing links always belong to the sending device, including desktop-site
  // mode on mobile browsers. Do not turn them into a second receiving station.
  if(new URLSearchParams(hash.slice(1)).has('pc')||new URLSearchParams(hash.slice(1)).has('direct')||pairedSender)return false;
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
  if(document.body.dataset.direct==='1')return false;
  let pairedSender=false;
  try{const sender=JSON.parse(sessionStorage.getItem('pill-label-sender-v1')||'null');pairedSender=!!sender?.id&&sender.expiresAt>Date.now();}catch{}
  return isPcView({search:location.search,hash:location.hash,userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints,coarsePointer:matchMedia('(pointer:coarse)').matches,pairedSender});
}

export function mountPcView() {
  document.title='휴대폰 직접 연결 · 알약 카운터';
  document.querySelector('.header-note').textContent='PC 직접 연결';
  const panel=document.createElement('section');panel.id='pc-panel';
  panel.innerHTML=`<div class="pc-home-heading"><p class="eyebrow">알약 카운터 · PC</p><h1>휴대폰과 직접 연결하세요</h1><p>같은 공유기 안에서 라벨을 바로 받아 출력해요.</p></div>
  <section class="pc-home-card"><h2>이 PC에서 시작</h2><p class="helper">연결 프로그램을 받고 Start.cmd를 실행하세요.<br>프린터를 선택하면 휴대폰 연결 QR이 나타나요.</p><a class="primary full model-link" id="pc-direct-download" href="/integrations/pill-counter-direct.zip" download>PC 직접 연결 프로그램 받기</a><p class="helper">휴대폰 첫 연결은 카메라 사용을 위한 PC 인증서 등록이 필요해요. 이후에는 QR에서 카운터를 바로 열면 됩니다.</p></section>
  <section class="pc-home-card"><h2>유팜데일리에서 사용</h2><p class="helper">직접 연결 모듈을 유팜데일리의 기존 라벨 출력 함수에 연결할 수 있어요. 유팜데일리 프로그램에 적용이 필요합니다.</p><a href="/integrations/direct-printer/CODEX_HANDOFF.md" download>유팜데일리 개발창 전달 파일</a></section>
  <p class="pc-home-footer">기존 클라우드 자동 수신은 종료됐어요. 새 직접 연결 프로그램을 사용하세요. <a href="local.html?view=mobile">이 기기에서 카운팅 화면 열기</a></p>`;
  document.querySelector('main').prepend(panel);
}
