/* 線工房 Web — 画像トレース（exe の core/trace.py と同じ手順。OpenCV の代わりに自前）。

   モード: bw 白黒（しきい値より暗い所）／ color カラー（Lab で k-means 減色、広い色ほど下）／ gray グレー（明るさを n 段）。
   輪郭は 2 値の画像の等高線（outline.js の traceField）→ 点をならす → 角で切って曲線を当てはめる。
   座標は画像の画素 → place（画像の行列）で文書へ。
*/
'use strict';

const TRACE_MODES = { bw: '白黒', color: 'カラー', gray: 'グレー' };
const TRACE_PRESETS = [
  ['ロゴ（少ない色・くっきり）', { mode: 'color', colors: 4, smooth: 1.5, corner: 0.7, min_area: 20 }],
  ['イラスト（色多め）', { mode: 'color', colors: 12, smooth: 2.0, corner: 0.5, min_area: 12 }],
  ['写真（細かく）', { mode: 'color', colors: 24, smooth: 1.0, corner: 0.3, min_area: 6 }],
  ['白黒（線画・ハンコ）', { mode: 'bw', colors: 2, smooth: 1.5, corner: 0.6, min_area: 12 }],
  ['グレー（濃淡 4 段）', { mode: 'gray', colors: 4, smooth: 2.0, corner: 0.5, min_area: 12 }],
];

async function traceLoad(bytes, maxSide) {
  const bmp = await createImageBitmap(new Blob([bytes]));
  let s = 1;
  if (Math.max(bmp.width, bmp.height) > maxSide) s = maxSide / Math.max(bmp.width, bmp.height);
  else if (Math.max(bmp.width, bmp.height) < 900) s = Math.min(3, 900 / Math.max(bmp.width, bmp.height));      // 小さい画像は拡大してから（階段が目立たない）
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const cv = newCanvas(w, h), ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);          // 透明は白に
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  return { rgb: ctx.getImageData(0, 0, w, h).data, w, h, s, sx: w / bmp.width, sy: h / bmp.height };
}
function boxBlur3(src, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += src[yy * w + xx]; n++; } }
    out[y * w + x] = s / n;
  }
  return out;
}
function morph(mask, w, h, grow) {
  // 3×3 の膨張（grow）／収縮
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = grow ? 0 : 1;
    for (let dy = -1; dy <= 1 && (grow ? !v : v); dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy, m = xx >= 0 && yy >= 0 && xx < w && yy < h ? mask[yy * w + xx] : 0;
      if (grow && m) { v = 1; break; }
      if (!grow && !m) { v = 0; break; }
    }
    out[y * w + x] = v;
  }
  return out;
}
function rgbToLab(r, g, b) {
  const f = (c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
  const R = f(r / 255), G = f(g / 255), B = f(b / 255);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g3 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = g3(x); y = g3(y); z = g3(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function labToRgb(L, a, bb) {
  let y = (L + 16) / 116, x = a / 500 + y, z = y - bb / 200;
  const g3 = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  x = g3(x) * 0.95047; y = g3(y); z = g3(z) * 1.08883;
  const R = x * 3.2406 + y * -1.5372 + z * -0.4986, G = x * -0.9689 + y * 1.8758 + z * 0.0415, B = x * 0.0557 + y * -0.2040 + z * 1.0570;
  const f = (c) => clamp01(c > 0.0031308 ? 1.055 * c ** (1 / 2.4) - 0.055 : 12.92 * c);
  return [f(R), f(G), f(B)];
}
/** k-means++（同じ乱数の種で毎回同じ結果） */
function kmeans(pts, k, iters = 30) {
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const C = [pts[Math.floor(rnd() * pts.length)].slice()];
  const dist = pts.map((p) => d2(p, C[0]));
  while (C.length < k) {
    const tot = dist.reduce((s, v) => s + v, 0);
    let r = rnd() * tot, i = 0;
    while (i < pts.length - 1 && (r -= dist[i]) > 0) i++;
    C.push(pts[i].slice());
    for (let j = 0; j < pts.length; j++) dist[j] = Math.min(dist[j], d2(pts[j], C[C.length - 1]));
  }
  const lab = new Int32Array(pts.length);
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    pts.forEach((p, j) => { let b = 0, bd = Infinity; for (let c = 0; c < k; c++) { const d = d2(p, C[c]); if (d < bd) { bd = d; b = c; } } if (lab[j] !== b) moved++; lab[j] = b; });
    const S = C.map(() => [0, 0, 0, 0]);
    pts.forEach((p, j) => { const s = S[lab[j]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    S.forEach((s, c) => { if (s[3]) C[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    if (it > 0 && moved < pts.length * 0.001) break;
  }
  return C;
}
/** 2 値の画像 → 輪郭の subpaths（偶奇で塗る） */
function maskToSps(mask, w, h, opt) {
  const W = w + 2, H = h + 2;
  const loops = traceField((x, y) => (x > 0 && y > 0 && x <= w && y <= h ? mask[(y - 1) * w + (x - 1)] : 0), W, H, 0.5);
  const out = [], smooth = opt.smooth ?? 2, minArea = opt.min_area ?? 12, corner = opt.corner ?? 0.5;
  const thr = -0.2 - 0.6 * (1 - corner), turnDeg = 180 - Math.acos(Math.max(-1, Math.min(1, thr))) * 180 / Math.PI;
  for (let pts of loops) {
    pts = pts.map(([x, y]) => [x - 1, y - 1]);
    if (Math.abs(polyArea(pts)) < minArea || pts.length < 3) continue;
    if (smooth <= 0.01) { const r = rdp([...pts, pts[0]], 0.6); out.push({ n: r.slice(0, -1).map((p) => N(...p)), c: true }); continue; }
    const k = Math.round(2 + smooth * 1.5);
    const n = pts.length, kk = Math.min(k, n >> 2), sm = [];
    for (let i = 0; i < n; i++) { let sx = 0, sy = 0; for (let d = -kk; d <= kk; d++) { const p = pts[(i + d + n) % n]; sx += p[0]; sy += p[1]; } sm.push([sx / (2 * kk + 1), sy / (2 * kk + 1)]); }
    out.push(fitLoopCorners(sm, 0.6 + smooth * 0.5, Math.max(3, 2 + k), turnDeg));
  }
  return out;
}
/** 画像のバイト列 → グループ（色ごとの複合パス）。place は画素 → 文書の行列 */
async function traceImage(bytes, opt, place = null, cmyk = false) {
  const mode = opt.mode || 'color', n = Math.max(2, opt.colors | 0 || 6), maxSide = opt.max_side || 1600;
  const { rgb, w, h, sx, sy } = await traceLoad(bytes, maxSide);
  const N2 = w * h, layers = [];
  const gray = new Float32Array(N2);
  for (let i = 0; i < N2; i++) gray[i] = 0.299 * rgb[i * 4] + 0.587 * rgb[i * 4 + 1] + 0.114 * rgb[i * 4 + 2];
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));
  if (mode === 'bw') {
    const g = boxBlur3(gray, w, h), m = new Uint8Array(N2);
    for (let i = 0; i < N2; i++) m[i] = g[i] < (opt.threshold ?? 128) ? 1 : 0;
    layers.push([m, [0, 0, 0]]);
  } else if (mode === 'gray') {
    const g = boxBlur3(gray, w, h);
    for (let k = 0; k < n; k++) {
      const m = new Uint8Array(N2), lim = 255 * (n - k) / (n + 1);
      for (let i = 0; i < N2; i++) m[i] = g[i] < lim ? 1 : 0;
      const v = 1 - (k + 1) / n;
      layers.push([m, [v, v, v]]);
    }
  } else {
    // 少しならしてから Lab で減色
    const R = new Float32Array(N2), G = new Float32Array(N2), B = new Float32Array(N2);
    for (let i = 0; i < N2; i++) { R[i] = rgb[i * 4]; G[i] = rgb[i * 4 + 1]; B[i] = rgb[i * 4 + 2]; }
    const br = boxBlur3(R, w, h), bg = boxBlur3(G, w, h), bb = boxBlur3(B, w, h);
    const lab = new Float32Array(N2 * 3);
    for (let i = 0; i < N2; i++) { const L = rgbToLab(br[i], bg[i], bb[i]); lab[i * 3] = L[0]; lab[i * 3 + 1] = L[1]; lab[i * 3 + 2] = L[2]; }
    await yieldUI();
    const sample = [], step = Math.max(1, Math.floor(N2 / 40000));
    for (let i = 0; i < N2; i += step) sample.push([lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]]);
    const C = kmeans(sample, Math.min(n, sample.length));
    let labels = new Uint8Array(N2);
    for (let i = 0; i < N2; i++) {
      let b = 0, bd = Infinity;
      for (let c = 0; c < C.length; c++) { const d = (lab[i * 3] - C[c][0]) ** 2 + (lab[i * 3 + 1] - C[c][1]) ** 2 + (lab[i * 3 + 2] - C[c][2]) ** 2; if (d < bd) { bd = d; b = c; } }
      labels[i] = b;
    }
    // 3×3 でいちばん多い色に（小さなノイズを消す）
    const lb2 = new Uint8Array(N2), cnt = new Uint16Array(C.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      cnt.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)); cnt[labels[yy * w + xx]]++; }
      let b = labels[y * w + x], bc = cnt[b];
      for (let c = 0; c < C.length; c++) if (cnt[c] > bc) { bc = cnt[c]; b = c; }
      lb2[y * w + x] = b;
    }
    labels = lb2;
    await yieldUI();
    const cols = C.map((c) => labToRgb(...c));
    const counts = C.map((_, c) => { let s = 0; for (let i = 0; i < N2; i++) if (labels[i] === c) s++; return s; });
    const order = C.map((_, i) => i).sort((a, b) => counts[b] - counts[a]);
    const ignoreWhite = opt.ignore_white !== false;
    order.forEach((ci, rank) => {
      const c = cols[ci];
      if (ignoreWhite && Math.min(...c) > 0.93) return;
      let m = new Uint8Array(N2);
      if (rank === 0 && !ignoreWhite) m.fill(1);            // いちばん広い色は全面に（すき間が出ない）
      else { for (let i = 0; i < N2; i++) m[i] = labels[i] === ci ? 1 : 0; m = morph(m, w, h, true); }     // 隣の色に少し重ねる
      layers.push([m, c]);
    });
  }
  const g = makeGroup([]);
  g.name = `画像トレース（${TRACE_MODES[mode] || mode}）`;
  let m = [1 / sx, 0, 0, 1 / sy, 0, 0];
  if (place) m = M.then(m, place);
  for (let [mask, c] of layers) {
    const sps = maskToSps(mask, w, h, opt);
    await yieldUI();
    if (!sps.length) continue;
    let col = rgbColor(...c);
    if (cmyk) col = toCMYK(col);
    const p = makePath(sps, newStyle(col, null));
    p.fill_rule = 'evenodd';
    spsTransform(p.paths, m);
    g.children.push(p);
  }
  return g;
}
