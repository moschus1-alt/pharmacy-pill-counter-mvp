export const dispensingView=`
<section id="dispense-panel" aria-labelledby="dispense-title" hidden>
  <div class="dispense-heading"><div><p class="eyebrow">포장부터 라벨까지</p><h1 id="dispense-title">의약품예제소분</h1></div><button id="printer-settings" class="secondary">PC·프린터 연결</button></div>
  <button id="pc-connection-banner" type="button" class="pc-connection-banner" data-state="disconnected">
    <svg class="pc-banner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/></svg>
    <span class="pc-banner-copy" role="status" aria-live="polite"><span class="pc-banner-label">PC 라벨 출력</span><strong id="pc-banner-title">연결 안 됨</strong><span id="pc-banner-detail">라벨을 받을 PC를 연결해 주세요.</span></span>
    <span id="pc-banner-action" class="pc-banner-action">연결하기 ›</span>
  </button>
  <ol class="dispense-steps" aria-label="소분 순서"><li>1 제품 확인</li><li>2 수량 확인</li><li>3 라벨 출력</li></ol>
  <form id="dispense-form">
    <section class="dispense-card" aria-labelledby="product-heading">
      <div class="section-title"><span class="step-number">1</span><h2 id="product-heading">제품 포장 읽기</h2></div>
      <label for="product-barcode">제품 바코드</label>
      <div class="input-action"><input id="product-barcode" name="barcode" autocomplete="off" spellcheck="false" maxlength="200" placeholder="스캔하거나 바코드를 입력하세요" required><button id="barcode-apply" type="button" class="secondary">적용</button></div>
      <button id="barcode-open" type="button" class="primary full">카메라로 바코드 읽기</button>
      <p id="barcode-status" class="helper" role="status">바코드를 읽으면 심평원 공개 데이터에서 제품 정보를 찾아요. 조회 후 현재 포장과 대조해 주세요.</p>
      <p id="product-lookup-details" class="helper" role="status"></p>
      <div class="dispense-fields">
        <label class="span-two">제품명 <input id="product-name" maxlength="80" autocomplete="off" placeholder="포장에 표시된 제품명" required></label>
        <label>함량·규격 <input id="product-strength" maxlength="40" placeholder="예: 500 mg"></label>
        <label>제조·수입사 <input id="product-manufacturer" maxlength="60" placeholder="선택 입력"></label>
        <label>제조번호 <input id="product-lot" maxlength="40" autocomplete="off" placeholder="포장의 LOT 번호"></label>
        <label>제품 사용기한 <input id="product-expiry" type="date"></label>
      </div>
      <label class="check-label"><input id="remember-product" type="checkbox" checked><span>제품명·함량·제조사를 이 기기에 저장</span></label>
      <p class="helper">제조번호와 사용기한은 매 포장에서 확인해 주세요.</p>
      <p class="helper">출처: <a href="https://www.data.go.kr/data/15067462/fileData.do" target="_blank" rel="noopener noreferrer">건강보험심사평가원 의약품표준코드</a> · 공공누리 제1유형. 정기 공개 자료이며 일부 제품은 조회되지 않을 수 있어요.</p>
    </section>
    <section class="dispense-card" aria-labelledby="dispense-count-heading">
      <div class="section-title"><span class="step-number">2</span><h2 id="dispense-count-heading">소분할 수량 확인</h2></div>
      <div class="dispense-quantity"><output id="dispense-count" aria-live="polite">—</output><span>개</span><span id="dispense-count-state" class="status">카운팅 전</span></div>
      <p class="helper">알약을 촬영하고 번호를 대조한 뒤 ‘확인 완료’를 누르면 이 라벨에 수량이 반영돼요.</p>
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
      <p class="helper">DK-22210은 폭 29 mm 연속 용지예요. 한 장 길이는 우선 90 mm이며 조절할 수 있어요. QL-550은 롤 폭이 최대 62 mm예요. 연속 용지는 폭과 잘라낼 한 장 길이를 입력해 주세요. PC 인쇄 창에서도 같은 용지 크기를 선택해야 해요.</p>
      <p class="helper">소분 후 사용기한은 확인한 기준에 따라 직접 입력해 주세요.</p>
      <div class="label-preview-wrap"><div id="label-preview" aria-label="소분 라벨 미리보기"></div><p>선택한 용지 크기의 미리보기</p></div>
      <p id="label-validation" class="helper" role="status"></p>
      <label class="check-label review-label"><input id="label-reviewed" type="checkbox"><span>포장의 제품·제조번호·사용기한과 실제 수량을 확인했어요.</span></label>
      <div class="connection-summary"><span class="connection-dot" id="pc-connection-dot"></span><span id="pc-connection-status">출력 PC를 연결해 주세요</span><button id="pc-connect-inline" type="button" class="text-button">연결</button></div>
      <button id="label-send" type="button" class="primary full" disabled>PC로 라벨 전송</button>
      <p class="helper">PC에 연결한 QL-550으로 출력하려면 위 ‘PC로 라벨 전송’을 눌러 주세요.</p>
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
<dialog id="barcode-dialog" aria-labelledby="barcode-dialog-title"><div class="dialog-heading"><h2 id="barcode-dialog-title">바코드 읽기</h2><button type="button" class="close-button" data-scan-close aria-label="바코드 카메라 닫기">×</button></div><video muted autoplay playsinline aria-label="바코드 카메라"></video><p data-scan-status class="helper" role="status"></p><p class="helper">포장의 숫자 바코드 또는 GS1 DataMatrix를 읽을 수 있어요.</p></dialog>
<dialog id="printer-dialog" aria-labelledby="printer-dialog-title"><div class="dialog-heading"><h2 id="printer-dialog-title">PC·프린터 연결</h2><button id="printer-dialog-close" class="close-button" aria-label="PC 연결 창 닫기">×</button></div>
  <div class="printer-setup-guide"><strong>QL-550 · PC USB 프린터 연결 순서</strong><ol><li>프린터를 연결한 PC에서 윈도우 테스트 페이지를 인쇄해 주세요.</li><li>같은 PC에서 이 앱을 열고 ‘이 PC에서 라벨 받기’를 누르세요.</li><li>휴대폰 카메라로 PC의 QR을 읽고, 라벨을 PC로 전송하세요.</li><li>PC의 출력 대기에서 라벨을 열고 인쇄 대상에 Brother QL-550을 선택하세요.</li></ol><p>윈도우 공유 설정만으로 휴대폰에 프린터가 나타나지는 않아요. 이 앱의 연결 대상은 라벨을 받는 PC예요.</p></div>
  <h3>유팜데일리 자동 출력</h3><p class="helper">유팜데일리에 연동 기능을 적용하면 휴대폰에서 전송한 라벨이 PC의 추가 클릭 없이 출력돼요. 아래 연결 파일은 유팜데일리 연동용이며, 파일을 받는 것만으로 연결되지는 않아요.</p><button id="upharm-config-download" class="primary full" hidden>유팜데일리 연결 파일 받기</button><p id="upharm-connection-status" class="helper" role="status">유팜데일리 수신 연결을 기다리고 있어요.</p><p class="helper">프린터가 연결된 PC에서 ‘이 PC에서 라벨 받기’를 먼저 눌러 주세요. 연결 파일은 해당 PC에서만 사용하세요. 연결은 최대 8시간 유지돼요.</p><hr><h3>휴대폰에서 연결</h3><p class="helper">프린터가 연결된 PC에서 이 웹앱을 열고 아래 ‘이 PC에서 라벨 받기’를 눌러 주세요. PC에 나타난 QR을 휴대폰 카메라로 읽으면 연결돼요.</p>
  <label for="pc-link-input">PC 연결 링크</label><div class="input-action"><input id="pc-link-input" type="text" autocomplete="off" placeholder="PC의 연결 링크를 붙여 넣으세요"><button id="pc-link-apply" class="secondary">연결</button></div><button id="pc-disconnect" class="text-button" hidden>휴대폰 연결 해제</button>
  <hr><h3>프린터가 연결된 PC에서</h3><label for="station-name">PC 이름</label><input id="station-name" value="약국 라벨 PC" maxlength="40"><button id="station-create" class="primary full">이 PC에서 라벨 받기</button>
  <div id="station-pairing" hidden><div id="station-qr" aria-label="휴대폰 연결 QR"></div><p id="station-name-display"></p><p id="station-expiry" class="helper"></p><button id="station-copy" class="secondary full">휴대폰 연결 링크 복사</button><p class="helper">이 QR·링크를 가진 기기에서 라벨을 보낼 수 있어요. 연결은 최대 8시간 유지돼요.</p></div>
  <p id="printer-connection-message" role="status" class="helper"></p><hr><h3>프린터 선택</h3><p class="helper">PC에 라벨프린터 드라이버를 설치한 뒤 인쇄 창에서 프린터를 선택해 주세요. USB 연결 프린터와 PC에 등록한 공유 프린터를 사용할 수 있어요. 인쇄 대상이 ‘PDF로 저장’이라면 대상을 변경해 Brother QL-550을 선택하세요. 다른 PC의 공유 프린터라면 먼저 이 PC의 윈도우 프린터 목록에 추가해야 해요. DK-22210은 드라이버에서 ‘29 mm 연속’을 고르고, 한 장 길이를 앱과 같게 설정하세요. 크기가 없으면 프린터 속성에서 사용자 정의 용지를 등록하세요. 배율 100%·여백 없음·머리글/바닥글 끔으로 설정해 주세요.</p><p id="printer-test-paper" class="helper"></p><button id="printer-test" class="secondary full">테스트 라벨로 프린터 선택</button>
</dialog>
<dialog id="received-label-dialog" aria-labelledby="received-label-title"><div class="dialog-heading"><h2 id="received-label-title">휴대폰에서 받은 라벨</h2><button id="received-label-close" class="close-button" aria-label="받은 라벨 닫기">×</button></div><p id="received-label-meta" class="helper"></p><div id="received-label-preview" class="label-preview-wrap"></div><p id="received-label-status" class="helper" role="status"></p><button id="received-label-print" class="primary full">프린터 선택·인쇄</button><button id="received-label-done" class="secondary full" disabled>실제 출력 완료 확인</button><p class="helper">인쇄를 취소했다면 완료를 누르지 마세요. 실제 출력물을 확인한 뒤 완료해 주세요. DK-22210은 PC 인쇄 창에서 ‘29 mm 연속’과 위 라벨의 길이를 맞춰 주세요.</p></dialog>
<div id="label-print-area" aria-hidden="true"></div><style id="label-page-style"></style>
`;
