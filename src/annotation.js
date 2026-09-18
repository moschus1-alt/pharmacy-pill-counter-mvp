import { detect } from './detector.js';
const imageInput = document.querySelector('#image'), canvas = document.querySelector('#canvas'), ctx = canvas.getContext('2d');
let image, points = [];
const json = document.querySelector('#json'), count = document.querySelector('#count'), download = document.querySelector('#download');
function render() {
  if (!image) return; const scale = Math.min(1, 900 / image.width), w = image.width * scale, h = image.height * scale;
  canvas.width = w; canvas.height = h; ctx.drawImage(image, 0, 0, w, h);
  points.forEach((p, i) => { ctx.beginPath(); ctx.arc(p.x * scale, p.y * scale, 14, 0, Math.PI * 2); ctx.fillStyle = '#19b997'; ctx.fill(); ctx.fillStyle = '#06231d'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(i + 1, p.x * scale, p.y * scale); });
  count.textContent = `${points.length}개`; json.value = JSON.stringify({ schemaVersion: 1, image: image.name || 'local-image', width: image.width, height: image.height, centers: points.map(({ x, y }) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 })) }, null, 2); download.disabled = false;
}
imageInput.onchange = e => { const file = e.target.files[0]; if (!file) return; const im = new Image(); im.onload = () => { image = im; image.name = file.name; points = []; render(); }; im.src = URL.createObjectURL(file); };
canvas.onclick = e => { if (!image) return; const scale = canvas.width / image.width, x = (e.offsetX / scale), y = (e.offsetY / scale), hit = points.findIndex(p => Math.hypot(p.x - x, p.y - y) < 24); if (hit >= 0) points.splice(hit, 1); else points.push({ x, y }); render(); };
json.oninput = () => { try { const parsed = JSON.parse(json.value); if (Array.isArray(parsed.centers)) { points = parsed.centers.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)); render(); } } catch { /* allow editing while incomplete */ } };
download.onclick = () => { const blob = new Blob([json.value], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(image?.name || 'annotation').replace(/\.[^.]+$/, '')}.ground-truth.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 0); document.querySelector('#message').textContent = '다운로드했습니다. 자동 업로드는 하지 않습니다.'; };
