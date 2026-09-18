import { detect } from './detector.js';
const input = document.querySelector('#manifest'), imageInput = document.querySelector('#images'), run = document.querySelector('#run'), details = document.querySelector('#details'), summary = document.querySelector('#summary'), canvas = document.querySelector('#canvas'), ctx = canvas.getContext('2d');
let manifest;
const localImages = new Map();
imageInput.onchange = e => [...e.target.files].forEach(file => localImages.set(file.name, URL.createObjectURL(file)));
input.onchange = async e => { try { manifest = JSON.parse(await e.target.files[0].text()); run.disabled = !Array.isArray(manifest.cases); details.textContent = run.disabled ? 'manifest.cases 배열이 필요합니다.' : `${manifest.cases.length}개 케이스 준비됨`; } catch { details.textContent = 'JSON을 읽을 수 없습니다.'; } };
function loadImage(url) { return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = url; }); }
function match(pred, truth, threshold) { const used = new Set(), pairs = []; pred.forEach((p, i) => { let best = -1, dist = Infinity; truth.forEach((t, j) => { const d = Math.hypot(p.x - t.x, p.y - t.y); if (!used.has(j) && d <= threshold && d < dist) { best = j; dist = d; } }); if (best >= 0) { used.add(best); pairs.push({ p: i, t: best, d: dist }); } }); return pairs; }
run.onclick = async () => {
  const totals = { tp: 0, fp: 0, fn: 0, absError: 0, time: 0, cases: 0 }, threshold = Number(manifest.matching?.centerDistancePx || 30), rows = [];
  for (const item of manifest.cases) {
    try {
      const image = await loadImage(localImages.get(item.image.split('/').pop()) || item.image), truth = item.centers || (item.annotation ? (await fetch(item.annotation)).json() : []);
      const ground = Array.isArray(truth) ? truth : (await truth).centers || []; const start = performance.now(), pred = await detect(image), elapsed = performance.now() - start, pairs = match(pred, ground, threshold);
      totals.tp += pairs.length; totals.fp += pred.length - pairs.length; totals.fn += ground.length - pairs.length; totals.absError += Math.abs(pred.length - ground.length); totals.time += elapsed; totals.cases++;
      rows.push({ id: item.id || item.image, actual: ground.length, predicted: pred.length, timeMs: Math.round(elapsed), tp: pairs.length, fp: pred.length - pairs.length, fn: ground.length - pairs.length });
      canvas.width = image.width; canvas.height = image.height; ctx.drawImage(image, 0, 0); pred.forEach((p, i) => { const hit = pairs.some(x => x.p === i); ctx.strokeStyle = hit ? '#20c59d' : '#ff6f61'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r || 12, 0, 7); ctx.stroke(); }); ground.forEach((p, i) => { if (!pairs.some(x => x.t === i)) { ctx.strokeStyle = '#ffd166'; ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, 7); ctx.stroke(); } });
    } catch (error) { rows.push({ id: item.id || item.image, error: error.message }); }
  }
  const precision = totals.tp / Math.max(1, totals.tp + totals.fp), recall = totals.tp / Math.max(1, totals.tp + totals.fn);
  summary.innerHTML = `<p>TP ${totals.tp} · FP ${totals.fp} · FN ${totals.fn} · Precision ${(precision * 100).toFixed(1)}% · Recall ${(recall * 100).toFixed(1)}% · F1 ${(2 * precision * recall / Math.max(.0001, precision + recall) * 100).toFixed(1)}% · exact count ${(rows.filter(r => r.actual === r.predicted).length / Math.max(1, totals.cases) * 100).toFixed(1)}% · MAE ${(totals.absError / Math.max(1, totals.cases)).toFixed(2)} · avg ${(totals.time / Math.max(1, totals.cases)).toFixed(1)}ms</p>`; details.textContent = JSON.stringify(rows, null, 2);
};
