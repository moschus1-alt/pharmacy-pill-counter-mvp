const app = document.querySelector('#app');
app.innerHTML = `
<header><div class="brand"><span class="mark" aria-hidden="true">약</span><div><b>알약 카운터</b><small>약국용 빠른 계수 도구</small></div></div><button id="help" class="icon" aria-label="도움말과 개인정보 안내">?</button></header>
<main>
<section class="card hero"><span class="eyebrow">빠르고 안전하게, 기기 안에서</span><h1>알약을 정확하게 세어 보세요.</h1><p>약 봉투나 금속 트레이 사진을 올리고, 인식 결과를 직접 확인한 뒤 저장하세요.</p><div class="actions"><label class="button primary">사진 촬영·불러오기<input id="file" type="file" accept="image/*" capture="environment" hidden></label><button id="demo" class="button secondary">예시 사진 보기</button></div><p id="secure" class="hint"></p></section>
<section class="card target"><div><span class="eyebrow">목표 수량</span><h2>몇 정을 준비할까요?</h2></div><div class="presets" role="group" aria-label="목표 수량 선택"><button data-target="30">30정</button><button data-target="60">60정</button><button data-target="90">90정</button><button data-target="custom">직접 입력</button></div><input id="custom" type="number" min="1" max="9999" placeholder="수량 입력" aria-label="직접 입력할 수량" hidden></section>
<section class="card review"><div class="section-head"><div><span class="eyebrow">검토</span><h2 id="status">사진을 기다리는 중</h2></div><span id="countBadge" class="badge">0정 인식</span></div><div id="stage" class="stage empty"><canvas id="canvas" aria-label="알약 인식 결과 이미지"></canvas><div class="empty-state"><span class="camera" aria-hidden="true">＋</span><b>사진이 여기에 표시됩니다</b><small>빈 곳을 누르면 추가하고, 표시를 누르면 삭제할 수 있어요</small></div><div id="zoom" class="zoom">100%</div></div><div class="toolbar"><button id="minus" class="round" aria-label="알약 하나 삭제">−</button><strong id="count" aria-live="polite">0</strong><button id="plus" class="round" aria-label="알약 하나 추가">＋</button><span class="grow"></span><button id="undo" class="text">실행 취소</button><button id="redo" class="text">다시 실행</button></div><div class="actions"><button id="reanalyze" class="button secondary" disabled>다시 인식</button><button id="save" class="button primary" disabled>수정 결과 저장</button></div></section>
<section class="card tips"><h2>잘 찍는 방법</h2><div class="tip-grid"><span>1 <b>밝고 고르게</b><small>반사광과 그림자를 줄여 주세요</small></span><span>2 <b>알약을 펼쳐서</b><small>서로 겹치지 않게 놓아 주세요</small></span><span>3 <b>결과를 확인</b><small>번호 표시를 확대해 검토하세요</small></span></div><p id="notice" class="notice" hidden></p></section>
</main><footer>사진은 기본적으로 저장하지 않습니다 · <a id="privacy">개인정보 안내</a> · <a href="./annotation.html">개발자 주석 도구</a> · <a href="./benchmark.html">벤치마크</a></footer>
<div id="modal" class="modal" hidden><div class="modal-box"><button id="close" class="close" aria-label="닫기">×</button><h2>알약 카운터 안내</h2><p>이 도구는 브라우저 안에서 밝고 분리된 알약 모양을 찾아 수를 셉니다. 결과를 반드시 확인하세요. 의료기기가 아닙니다.</p><p>사진은 새로고침하면 메모리에서 사라지며, 저장을 누른 경우에도 이미지 없이 수정 결과와 수량만 이 기기에 저장됩니다.</p></div></div>`;
const $ = s => document.querySelector(s);
let target = 30, image = null, detections = [], history = [], future = [], zoom = 1;
const cvState = { loaded: false }; let cvPromise;
function setStatus() {
  const n = detections.length, d = n - target;
  $('#count').textContent = n; $('#countBadge').textContent = `${n}정 인식`;
  $('#status').textContent = !image ? '사진을 기다리는 중' : d === 0 ? '목표 수량과 일치합니다' : d < 0 ? `${Math.abs(d)}정 부족합니다` : `${d}정 많습니다`;
  $('#status').className = d === 0 ? 'match' : d < 0 ? 'short' : 'over';
}
function draw() {
  const c = $('#canvas'), ctx = c.getContext('2d');
  if (!image) { $('#stage').classList.add('empty'); setStatus(); return; }
  $('#stage').classList.remove('empty'); const scale = Math.min(Math.min(900, innerWidth - 40) / image.width, 500 / image.height);
  c.width = image.width * scale; c.height = image.height * scale; ctx.drawImage(image, 0, 0, c.width, c.height);
  detections.forEach((d, i) => { ctx.beginPath(); ctx.arc(d.x * scale, d.y * scale, d.r * scale, 0, Math.PI * 2); ctx.fillStyle = '#19b9972b'; ctx.fill(); ctx.strokeStyle = '#16b892'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = '#063027'; ctx.beginPath(); ctx.arc(d.x * scale, d.y * scale, 11, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(i + 1, d.x * scale, d.y * scale); });
  setStatus();
}
function snapshot() { history.push(detections.map(x => ({ ...x }))); if (history.length > 30) history.shift(); future = []; }
function rgbToHsv(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: (h * 60 + 360) % 360, s: mx ? d / mx : 0, v: mx }; }
function colorFallback(source) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true }); c.width = source.width; c.height = source.height; ctx.drawImage(source, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height), mask = new Uint8Array(width * height), seen = new Uint8Array(width * height), out = [];
  for (let i = 0; i < mask.length; i++) { const p = i * 4, hsv = rgbToHsv(data[p], data[p + 1], data[p + 2]); mask[i] = hsv.v > .55 && hsv.s > .10 && hsv.s < .78 && hsv.h >= 25 && hsv.h <= 70 ? 1 : 0; }
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) { const start = y * width + x; if (!mask[start] || seen[start]) continue; const q = [start]; seen[start] = 1; let n = 0, sx = 0, sy = 0, minX = x, maxX = x, minY = y, maxY = y;
    while (q.length) { const p = q.pop(), px = p % width, py = (p - px) / width; n++; sx += px; sy += py; minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); for (const np of [p - 1, p + 1, p - width, p + width]) if (np >= 0 && np < mask.length && !seen[np] && mask[np]) { seen[np] = 1; q.push(np); } }
    const w = maxX - minX + 1, h = maxY - minY + 1, ratio = Math.max(w, h) / Math.min(w, h); if (n > Math.max(80, width * height * .0002) && n < width * height * .08 && ratio < 2.5) out.push({ x: sx / n, y: sy / n, r: Math.max(8, Math.min(80, Math.max(w, h) / 2)) });
  }
  return out.filter((d, i, a) => a.findIndex(x => Math.hypot(x.x - d.x, x.y - d.y) < d.r * .7) === i).slice(0, 100);
}
function openCvDetect(source) {
  const mat = cv.imread(source), rgb = new cv.Mat(), hsv = new cv.Mat(), gray = new cv.Mat(), enhanced = new cv.Mat();
  const adaptive = new cv.Mat(), bright = new cv.Mat(), colorMask = new cv.Mat(), mask = new cv.Mat();
  const roiMask = new cv.Mat(mat.rows, mat.cols, cv.CV_8UC1, new cv.Scalar(0));
  const candidates = [], cleanup = [];
  const minArea = Math.max(60, mat.cols * mat.rows * .00015), maxArea = mat.cols * mat.rows * .18;
  try {
    cv.cvtColor(mat, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    if (typeof cv.createCLAHE === 'function') {
      const clahe = cv.createCLAHE(2.2, new cv.Size(8, 8));
      clahe.apply(gray, enhanced); clahe.delete();
    } else {
      // Some compact OpenCV.js builds omit the CLAHE factory; keep the same
      // local-contrast intent rather than disabling the detector entirely.
      cv.equalizeHist(gray, enhanced);
    }
    cv.adaptiveThreshold(enhanced, adaptive, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, -3);
    cv.threshold(enhanced, bright, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.bitwise_or(adaptive, bright, mask);
    // Pale yellow tablets need color separation: a white tray and its
    // reflections can be brighter than the tablets but lack this hue band.
    const colorLow = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [12, 18, 70, 0]);
    const colorHigh = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [48, 235, 255, 255]);
    cv.inRange(hsv, colorLow, colorHigh, colorMask);
    // Use the color mask as the primary foreground. Adaptive brightness is
    // useful for pale tablets, but intersecting it can erase yellow tablets
    // on a light tray before contours are even extracted.
    colorMask.copyTo(mask);
    colorLow.delete(); colorHigh.delete();
    const inset = Math.max(4, Math.round(Math.min(mat.cols, mat.rows) * .025));
    cv.rectangle(roiMask, new cv.Point(inset, inset), new cv.Point(mat.cols - inset, mat.rows - inset), new cv.Scalar(255), -1);
    cv.bitwise_and(mask, roiMask, mask);
    const closeKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, closeKernel); cleanup.push(closeKernel);
    const collect = (sourceMask, erosionSize) => {
      const eroded = new cv.Mat(), contours = new cv.MatVector(), hierarchy = new cv.Mat();
      const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(erosionSize, erosionSize));
      cv.erode(sourceMask, eroded, kernel); cv.findContours(eroded, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const found = [];
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i), area = cv.contourArea(contour), rect = cv.boundingRect(contour);
        const perimeter = cv.arcLength(contour, true), circularity = perimeter ? 4 * Math.PI * area / (perimeter * perimeter) : 0;
        const ratio = Math.max(rect.width, rect.height) / Math.max(1, Math.min(rect.width, rect.height));
        const moments = cv.moments(contour);
        if (rect.x > 1 && rect.y > 1 && rect.x + rect.width < mat.cols - 1 && rect.y + rect.height < mat.rows - 1 &&
            area >= minArea && area <= maxArea && circularity > .18 && ratio < 2.8 && moments.m00) {
          found.push({ x: moments.m10 / moments.m00, y: moments.m01 / moments.m00, r: Math.max(7, Math.min(90, Math.max(rect.width, rect.height) / 2)), contour });
        } else contour.delete();
      }
      [eroded, contours, hierarchy, kernel].forEach(x => x.delete()); return found;
    };
    const conservative = collect(mask, 3), alternate = collect(mask, 7);
    // A broad contour containing two eroded centers is two touching pills, not one.
    conservative.forEach(item => {
      const inside = alternate.filter(other => cv.pointPolygonTest(item.contour, new cv.Point(other.x, other.y), false) >= 0);
      if (inside.length >= 2) inside.forEach(other => candidates.push({ x: other.x, y: other.y, r: Math.max(7, item.r * .72) }));
      else candidates.push({ x: item.x, y: item.y, r: item.r });
      item.contour.delete();
    });
    alternate.forEach(item => item.contour.delete());
    // Distance peaks provide a conservative split when erosion still leaves one blob.
    const distance = new cv.Mat(), peaks = new cv.Mat(), peakContours = new cv.MatVector(), peakHierarchy = new cv.Mat();
    cv.distanceTransform(mask, distance, cv.DIST_L2, 5);
    const maxDistance = cv.minMaxLoc(distance).maxVal;
    if (maxDistance > 8) {
      cv.threshold(distance, peaks, Math.max(7, maxDistance * .42), 255, cv.THRESH_BINARY); peaks.convertTo(peaks, cv.CV_8U);
      cv.findContours(peaks, peakContours, peakHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < peakContours.size(); i++) {
        const contour = peakContours.get(i), moments = cv.moments(contour);
        if (moments.m00 && cv.contourArea(contour) > 3) candidates.push({ x: moments.m10 / moments.m00, y: moments.m01 / moments.m00, r: Math.max(7, maxDistance * .55) });
        contour.delete();
      }
    }
    [distance, peaks, peakContours, peakHierarchy].forEach(x => x.delete());
  } finally {
    [mat, rgb, hsv, gray, enhanced, adaptive, bright, colorMask, mask, roiMask, ...cleanup].forEach(x => x.delete());
  }
  return candidates.filter((d, i, all) => all.findIndex(x => Math.hypot(x.x - d.x, x.y - d.y) < Math.min(x.r, d.r) * .55) === i).slice(0, 100);
}
async function loadOpenCV() { if (cvState.loaded) return; if (cvPromise) return cvPromise; cvPromise = new Promise(resolve => { const s = document.createElement('script'); s.src = 'https://docs.opencv.org/4.x/opencv.js'; s.async = true; s.onload = () => { const ready = () => { cvState.loaded = true; resolve(); }; if (window.cv && cv.Mat) ready(); else if (window.cv) cv.onRuntimeInitialized = ready; else resolve(); }; s.onerror = resolve; document.head.appendChild(s); }); return cvPromise; }
async function analyze() { if (!image) return; snapshot(); await loadOpenCV(); try { detections = cvState.loaded ? openCvDetect(image) : colorFallback(image); } catch { detections = colorFallback(image); } draw(); $('#reanalyze').disabled = false; $('#save').disabled = false; $('#notice').hidden = false; $('#notice').textContent = '사진 속 밝은 색상과 모양을 기준으로 인식했습니다. 결과를 확인해 주세요.'; }
function read(file) { const url = URL.createObjectURL(file), im = new Image(); im.onload = () => { image = im; analyze(); URL.revokeObjectURL(url); }; im.src = url; }
function demo() { const c = document.createElement('canvas'); c.width = 900; c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#5e6870'; x.fillRect(0, 0, c.width, c.height); for (let i = 0; i < 28; i++) { const px = 110 + (i % 7) * 115, py = 120 + Math.floor(i / 7) * 120; x.fillStyle = '#f3d77b'; x.beginPath(); x.ellipse(px, py, 30, 23, (i % 3) * .2, 0, 7); x.fill(); x.strokeStyle = '#d2ad4c'; x.stroke(); } const im = new Image(); im.onload = () => { image = im; analyze(); }; im.src = c.toDataURL(); }
$('#file').onchange = e => e.target.files[0] && read(e.target.files[0]); $('#demo').onclick = demo; $('#reanalyze').onclick = analyze;
document.querySelectorAll('[data-target]').forEach(b => b.onclick = () => { document.querySelectorAll('[data-target]').forEach(x => x.classList.remove('active')); b.classList.add('active'); if (b.dataset.target === 'custom') { $('#custom').hidden = false; $('#custom').focus(); } else { target = +b.dataset.target; $('#custom').hidden = true; setStatus(); } }); $('#custom').oninput = e => { target = Math.max(1, +e.target.value || 1); setStatus(); };
$('#plus').onclick = () => { snapshot(); detections.push({ x: image ? image.width / 2 : 100, y: image ? image.height / 2 : 100, r: 20 }); draw(); }; $('#minus').onclick = () => { if (detections.length) { snapshot(); detections.pop(); draw(); } }; $('#undo').onclick = () => { if (history.length) { future.push(detections); detections = history.pop(); draw(); } }; $('#redo').onclick = () => { if (future.length) { history.push(detections); detections = future.pop(); draw(); } };
$('#save').onclick = async () => { try { const db = await new Promise((res, rej) => { const r = indexedDB.open('pillcount', 1); r.onupgradeneeded = () => r.result.createObjectStore('corrections', { autoIncrement: true }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); db.transaction('corrections', 'readwrite').objectStore('corrections').add({ target, count: detections.length, at: new Date().toISOString() }); $('#notice').hidden = false; $('#notice').textContent = '수정 결과를 이 기기에 저장했습니다. 사진은 저장하지 않았습니다.'; } catch { $('#notice').hidden = false; $('#notice').textContent = '이 브라우저에서는 저장할 수 없습니다.'; } };
$('#stage').addEventListener('wheel', e => { if (!image) return; e.preventDefault(); zoom = Math.max(1, Math.min(2.5, zoom + (e.deltaY < 0 ? .1 : -.1))); $('#canvas').style.transform = `scale(${zoom})`; $('#zoom').textContent = `${Math.round(zoom * 100)}%`; }, { passive: false }); $('#stage').addEventListener('dblclick', () => { zoom = zoom === 1 ? 1.8 : 1; $('#canvas').style.transform = `scale(${zoom})`; $('#zoom').textContent = `${Math.round(zoom * 100)}%`; });
$('#stage').addEventListener('click', e => { if (!image || e.target !== $('#canvas')) return; const rect = $('#canvas').getBoundingClientRect(), scale = $('#canvas').width / image.width, x = (e.clientX - rect.left) / scale, y = (e.clientY - rect.top) / scale, hit = detections.findIndex(d => Math.hypot(d.x - x, d.y - y) < Math.max(24, d.r * 1.5)); snapshot(); if (hit >= 0) detections.splice(hit, 1); else detections.push({ x, y, r: 20 }); draw(); });
$('#help').onclick = () => $('#modal').hidden = false; $('#close').onclick = () => $('#modal').hidden = true; $('#privacy').onclick = e => { e.preventDefault(); $('#modal').hidden = false; }; $('#secure').textContent = location.protocol === 'https:' || location.hostname === 'localhost' ? '카메라를 사용할 수 있는 안전한 연결입니다.' : '카메라는 HTTPS 또는 localhost에서 사용할 수 있습니다.'; loadOpenCV(); if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => {});
// Kept small and non-invasive so a local browser fixture can exercise the real pipeline.
window.__pillCounterTest = { detect: source => cvState.loaded ? openCvDetect(source) : colorFallback(source) };
// Developer pages can rely on one documented shape without reaching into UI state.
window.__pillCounterDetector = { detect: window.__pillCounterTest.detect };
