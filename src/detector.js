// Shared, browser-only detector interface used by the app and developer tools.
const state = { loaded: false };
let loading;

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function fallback(source) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
  c.width = source.width; c.height = source.height; ctx.drawImage(source, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  const mask = new Uint8Array(width * height), seen = new Uint8Array(width * height), out = [];
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4, hsv = rgbToHsv(data[p], data[p + 1], data[p + 2]);
    mask[i] = hsv.v > .55 && hsv.s > .10 && hsv.s < .78 && hsv.h >= 25 && hsv.h <= 70 ? 1 : 0;
  }
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const start = y * width + x; if (!mask[start] || seen[start]) continue;
    const q = [start]; seen[start] = 1; let n = 0, sx = 0, sy = 0, minX = x, maxX = x, minY = y, maxY = y;
    while (q.length) {
      const p = q.pop(), px = p % width, py = (p - px) / width; n++; sx += px; sy += py;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      for (const np of [p - 1, p + 1, p - width, p + width])
        if (np >= 0 && np < mask.length && !seen[np] && mask[np]) { seen[np] = 1; q.push(np); }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1, ratio = Math.max(w, h) / Math.min(w, h);
    if (n > Math.max(80, width * height * .0002) && n < width * height * .08 && ratio < 2.5)
      out.push({ x: sx / n, y: sy / n, r: Math.max(8, Math.min(80, Math.max(w, h) / 2)) });
  }
  return out.filter((d, i, a) => a.findIndex(x => Math.hypot(x.x - d.x, x.y - d.y) < d.r * .7) === i).slice(0, 100);
}

async function loadOpenCV() {
  if (state.loaded) return true;
  if (loading) return loading;
  loading = new Promise(resolve => {
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.x/opencv.js'; script.async = true;
    script.onload = () => { const ready = () => { state.loaded = true; resolve(true); }; window.cv?.Mat ? ready() : window.cv ? cv.onRuntimeInitialized = ready : resolve(false); };
    script.onerror = () => resolve(false); document.head.appendChild(script);
  });
  return loading;
}

// The shared interface deliberately returns normalized center/radius objects.
// This offline-safe implementation is also useful for developer fixtures.
export async function detect(source) {
  await loadOpenCV();
  if (state.loaded && window.cv?.Mat) {
    const mat = cv.imread(source), rgb = new cv.Mat(), hsv = new cv.Mat(), mask = new cv.Mat(), contours = new cv.MatVector(), hierarchy = new cv.Mat(), out = [];
    try {
      cv.cvtColor(mat, rgb, cv.COLOR_RGBA2RGB); cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      const low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [12, 18, 70, 0]);
      const high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [48, 235, 255, 255]);
      cv.inRange(hsv, low, high, mask); low.delete(); high.delete();
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) { const c = contours.get(i), r = cv.boundingRect(c), m = cv.moments(c); if (m.m00 && r.width > 8 && r.height > 8) out.push({ x: m.m10 / m.m00, y: m.m01 / m.m00, r: Math.max(r.width, r.height) / 2 }); c.delete(); }
      if (out.length) return out.slice(0, 100);
    } finally { [mat, rgb, hsv, mask, contours, hierarchy].forEach(x => x.delete()); }
  }
  // Keep the public contract stable while remaining usable without a CDN.
  return fallback(source);
}
export { loadOpenCV };
