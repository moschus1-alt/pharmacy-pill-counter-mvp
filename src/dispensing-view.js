export const dispensingView=`
<section id="dispense-panel" aria-labelledby="dispense-title" hidden>
  <div class="dispense-heading"><div><h1 id="dispense-title">의약품 소분</h1></div><button id="printer-settings" class="secondary">PC·프린터 연결</button></div>
  <button id="pc-connection-banner" type="button" class="pc-connection-banner" data-state="disconnected">
    <svg class="pc-banner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/></svg>
    <span class="pc-banner-copy" role="status" aria-live="polite"><span class="pc-banner-label">PC 라벨 출력</span><strong id="pc-banner-title">연결 안 됨</strong><span id="pc-banner-detail">라벨을 받을 PC를 연결해 주세요.</span></span>
    <span id="pc-banner-action" class="pc-banner-action">연결하기 ›</span>
  </button>
  <form id="dispense-form">
    <section class="dispense-card" aria-labelledby="product-heading">
      <div class="section-title"><span class="step-number">1</span><h2 id="product-heading">제품 확인</h2></div>
      <label for="product-barcode">제품 바코드</label>
      <div class="input-action"><input id="product-barcode" name="barcode" autocomplete="off" spellcheck="false" maxlength="200" placeholder="스캔하거나 바코드를 입력하세요" required><button id="barcode-apply" type="button" class="secondary">적용</button></div>
      <button id="barcode-open" type="button" class="primary full">바코드 스캔</button>
      <p id="barcode-status" class="helper" role="status">바코드를 스캔하거나 입력해 주세요.</p>
      <details class="compact-help"><summary>제품 조회 정보</summary><p id="product-lookup-details" class="helper" role="status"></p><p class="helper">출처: <a href="https://www.data.go.kr/data/15067462/fileData.do" target="_blank" rel="noopener noreferrer">심평원 의약품표준코드</a> · 공공누리 제1유형. 조회 결과는 현재 포장과 대조해 주세요.</p></details>
      <div class="dispense-fields">
        <label class="span-two">제품명 <input id="product-name" maxlength="80" autocomplete="off" placeholder="포장에 표시된 제품명" required></label>
        <label>함량·규격 <input id="product-strength" maxlength="40" placeholder="예: 500 mg"></label>
        <label>제조·수입사 <input id="product-manufacturer" maxlength="60" placeholder="선택 입력"></label>
        <label>제조번호 <input id="product-lot" maxlength="40" autocomplete="off" placeholder="포장의 LOT 번호"></label>
        <label>제품 사용기한 <input id="product-expiry" type="date"></label>
      </div>
      <label class="check-label"><input id="remember-product" type="checkbox" checked><span>이 기기에 제품 저장</span></label>

    </section>
    <section class="dispense-card" aria-labelledby="dispense-count-heading">
      <div class="section-title"><span class="step-number">2</span><h2 id="dispense-count-heading">소분할 수량 확인</h2></div>
      <div class="dispense-quantity"><output id="dispense-count" aria-live="polite">—</output><span>개</span><span id="dispense-count-state" class="status">카운팅 전</span></div>
      <p class="helper">촬영 후 실제 수량을 확인해 주세요.</p>
      <button id="dispense-start-count" type="submit" class="primary full">수량 카운팅 시작</button>
    </section>
    <section class="dispense-card" aria-labelledby="label-heading">
      <div class="section-title"><span class="step-number">3</span><h2 id="label-heading">라벨 확인·전송</h2></div>
      <div class="dispense-fields">
        <label>소분일 <input id="packed-on" type="date" required></label>
        <label>소분 후 사용기한 <input id="use-by" type="date"></label>
        <label>라벨 크기 <select id="label-size"><option value="dk22210" selected>DK-22210 · 29 mm 연속 (QL-550)</option><option value="60x40">60 × 40 mm</option><option value="70x50">70 × 50 mm</option><option value="50x30">50 × 30 mm</option><option value="62x29">62 × 29 mm · Brother DK</option><option value="62x100">62 × 100 mm · Brother DK</option><option value="29x90">29 × 90 mm · Brother DK</option><option value="custom">직접 입력 / 연속 용지</option></select></label>
        <label>동일 라벨 매수 <input id="label-copies" type="number" min="1" max="20" step="1" value="1" required></label>
      </div>
      <div id="custom-label-fields" class="dispense-fields" hidden>
        <label>용지 폭 (mm) <input id="label-width" type="number" min="12" max="200" step="0.1" value="29" inputmode="decimal"></label>
        <label>라벨 한 장 길이 (mm) <input id="label-height" type="number" min="12" max="200" step="0.1" value="90" inputmode="decimal"></label>
      </div>
      <p id="label-paper-summary" class="helper" role="status"></p>
      <details class="compact-help"><summary>용지 설정 안내</summary><p class="helper">DK-22210은 폭 29 mm 연속 용지예요. 한 장 길이를 조절할 수 있어요. PC 프린터의 용지도 같은 크기로 설정해 주세요.</p></details>
      <div class="label-preview-wrap"><div id="label-preview" aria-label="소분 라벨 미리보기"></div></div><p id="label-fit-info" class="label-fit-info" role="status">용지에 맞춰 자동으로 크기를 조절해요.</p>
      <p id="label-validation" class="helper" role="status"></p>
      <label class="check-label review-label"><input id="label-reviewed" type="checkbox"><span>포장의 제품·제조번호·사용기한과 실제 수량을 확인했어요.</span></label>
      <div class="connection-summary"><span class="connection-dot" id="pc-connection-dot"></span><span id="pc-connection-status">출력 PC를 연결해 주세요</span><button id="pc-connect-inline" type="button" class="text-button">연결</button></div>
      <button id="label-send" type="button" class="primary full" disabled>PC로 라벨 전송</button>
      <details class="local-print-options"><summary>다른 방법: 이 기기의 인쇄 창</summary><p class="helper">휴대폰 인쇄 목록에서 PC의 USB 공유 프린터를 찾는 기능은 아니에요. QL-550은 PC 연결 후 라벨 전송을 이용해 주세요.</p><button id="label-print-local" type="button" class="secondary full" disabled>이 기기에서 직접 인쇄</button></details>
      <p id="label-send-status" class="helper" role="status" aria-live="polite"></p>
      <button id="dispense-new" type="button" class="text-button full">다음 소분 시작</button>
    </section>
  </form>
  <section id="pc-station-panel" class="dispense-card pc-station" hidden aria-labelledby="pc-station-heading"><div class="section-title"><h2 id="pc-station-heading">PC 라벨 출력 대기</h2><button id="station-close" class="text-button">연결 종료</button></div><p class="helper">이 화면을 열어 두세요. 휴대폰에서 보낸 라벨이 여기에 도착해요.</p><p id="station-status" role="status" class="helper"></p><div id="station-jobs"></div></section>
</section>
<div id="dispense-count-banner" class="dispense-count-banner" hidden><div><strong>소분용 수량 카운팅</strong><p id="dispense-count-product"></p><p id="dispense-count-connection"></p></div><button id="dispense-return" class="secondary">라벨로 돌아가기</button></div>
`;

export const dispensingDialogs=`
<dialog id="barcode-dialog" aria-labelledby="barcode-dialog-title"><div class="dialog-heading"><h2 id="barcode-dialog-title">바코드 읽기</h2><button type="button" class="close-button" data-scan-close aria-label="바코드 카메라 닫기">×</button></div><video muted autoplay playsinline aria-label="바코드 카메라"></video><p data-scan-status class="helper" role="status"></p><p class="helper">제품 포장의 바코드를 비춰 주세요.</p></dialog>
<dialog id="printer-dialog" aria-labelledby="printer-dialog-title"><div class="dialog-heading"><h2 id="printer-dialog-title">PC 연결</h2><button id="printer-dialog-close" class="close-button" aria-label="PC 연결 창 닫기">×</button></div>
  <div id="mobile-connection-help"><p class="helper">PC 또는 유팜데일리에 표시된 QR을 휴대폰 카메라로 읽어 주세요.</p></div>
  <div id="mobile-connection-current" class="connection-current" hidden><span>연결된 PC</span><strong id="mobile-pc-name"></strong><p id="mobile-pc-state" role="status"></p><button id="pc-change" class="secondary">연결 변경</button></div>
  <div id="mobile-link-fields"><label for="pc-link-input">연결 링크로 연결</label><div class="input-action"><input id="pc-link-input" type="text" autocomplete="off" placeholder="PC 연결 링크 붙여넣기"><button id="pc-link-apply" class="secondary">연결</button></div></div><button id="pc-disconnect" class="text-button" hidden>연결 해제</button>
  <p id="printer-connection-message" role="status" class="helper"></p>
  <details id="desktop-connection-tools" open><summary>PC 연결 · 프린터 설정</summary>
    <label for="station-name">PC 이름</label><input id="station-name" value="약국 라벨 PC" maxlength="40"><button id="station-create" class="primary full">이 PC에서 라벨 받기</button>
    <div id="station-pairing" hidden><div id="station-qr" aria-label="휴대폰 연결 QR"></div><p id="station-name-display"></p><p id="station-expiry" class="helper"></p><button id="station-copy" class="secondary full">휴대폰 연결 링크 복사</button></div>
    <button id="upharm-config-download" class="secondary full" hidden>유팜데일리 연결 파일 받기</button><p id="upharm-connection-status" class="helper" role="status"></p>
    <h3>프린터 테스트</h3><p class="helper">PC 인쇄 대상에 Brother QL-550을 선택하세요. 용지 크기 일치 · 배율 100% · 머리글/바닥글 끔.</p><p id="printer-test-paper" class="helper"></p><button id="printer-test" class="secondary full">테스트 라벨 인쇄</button>
  </details>
</dialog>
<dialog id="received-label-dialog" aria-labelledby="received-label-title"><div class="dialog-heading"><h2 id="received-label-title">휴대폰에서 받은 라벨</h2><button id="received-label-close" class="close-button" aria-label="받은 라벨 닫기">×</button></div><p id="received-label-meta" class="helper"></p><div id="received-label-preview" class="label-preview-wrap"></div><p id="received-label-status" class="helper" role="status"></p><button id="received-label-print" class="primary full">프린터 선택·인쇄</button><button id="received-label-done" class="secondary full" disabled>실제 출력 완료 확인</button><p class="helper">인쇄를 취소했다면 완료를 누르지 마세요. 실제 출력물을 확인한 뒤 완료해 주세요. DK-22210은 PC 인쇄 창에서 ‘29 mm 연속’과 위 라벨의 길이를 맞춰 주세요.</p></dialog>
<div id="label-print-area" aria-hidden="true"></div><style id="label-page-style"></style>
`;
