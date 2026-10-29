/* 線工房 Web — Illustrator を超える機能の計算（exe の core/beyond.py・palette.py と同じ）:
   可変幅の線・線幅の点・角丸（選んだ角）・色を集める／塗り替える・バリエーション・アイコン一括の計画・配色の提案。
*/
'use strict';

// ---- 可変幅の線 -------------------------------------------------------------------------
const WIDTH_PROFILES = {
  uniform: ['均等', [[0, 1], [1, 1]]],
  taper_both: ['両端を細く', [[0, 0.05], [0.5, 1], [1, 0.05]]],
  taper_end: ['終わりを細く', [[0, 1], [1, 0.05]]],
  taper_start: ['始まりを細く', [[0, 0.05], [1, 1]]],
  drop: ['しずく', [[0, 0.05], [0.3, 1.25], [1, 0.05]]],
  bulge: ['ふくらみ', [[0, 0.4], [0.5, 1.5], [1, 0.4]]],
  brush: ['筆', [[0, 0.1], [0.08, 1.1], [0.7, 0.85], [1, 0.05]]],
  wave: ['波', [[0, 0.5], [0.25, 1.3], [0.5, 0.5], [0.75, 1.3], [1, 0.5]]],
};
function profileAt(profile, t) {
  const pr = profile.slice().sort((a, b) => a[0] - b[0]);
  if (t <= pr[0][0]) return pr[0][1];
  for (let i = 0; i + 1 < pr.length; i++) {
    const [t0, f0] = pr[i], [t1, f1] = pr[i + 1];
    if (t0 <= t && t <= t1) { let u = t1 > t0 ? (t - t0) / (t1 - t0) : 0; u = u * u * (3 - 2 * u); return f0 + (f1 - f0) * u; }
  }
  return pr[pr.length - 1][1];
}
function polyCum(pts) { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return cum; }
function resamplePts(pts, step) {
  if (pts.length < 2) return pts.length ? [[pts[0], 0]] : [];
  const cum = polyCum(pts), total = cum[cum.length - 1];
  if (total <= 1e-9) return [[pts[0], 0]];
  const n = Math.max(2, Math.floor(total / step) + 1), out = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = total * k / n;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1e-9, u = (s - cum[j]) / seg, p = pts[j], q = pts[j + 1];
    out.push([[p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u], s / total]);
  }
  return out;
}
function capArc(c, a, b) {
  const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
  if (r < 0.05) return [];
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]), a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  let d = ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (Math.abs(Math.abs(d) - Math.PI) > 0.3) d = d < 0 ? -Math.PI : Math.PI;
  const steps = Math.max(4, Math.floor(r)), out = [];
  for (let k = 1; k < steps; k++) out.push([c[0] + r * Math.cos(a0 - d * k / steps), c[1] + r * Math.sin(a0 - d * k / steps)]);
  return out;
}
/** 可変幅の線の輪郭（塗りの形）。開いたパスは閉じた形 1 つ、閉じたパスは外と内の 2 つ（偶奇で輪） */
function variableStroke(sp, width, profile, cap = 'round') {
  let pts = flattenSp(sp, 0.5);
  if (sp.c && pts.length) pts = [...pts, pts[0]];
  const smp = resamplePts(pts, Math.max(0.4, Math.min(3, width / 6)));
  if (smp.length < 2) return [];
  let left = [], right = [];
  const m = smp.length;
  for (let i = 0; i < m; i++) {
    const [[x, y], t] = smp[i];
    const a = sp.c && i === 0 ? smp[m - 2][0] : smp[Math.max(0, i - 1)][0];
    const b = sp.c && i === m - 1 ? smp[1][0] : smp[Math.min(m - 1, i + 1)][0];
    const dx = b[0] - a[0], dy = b[1] - a[1], ln = Math.hypot(dx, dy) || 1, nx = -dy / ln, ny = dx / ln;
    const h = Math.max(0, width * profileAt(profile, t) / 2);
    left.push([x + nx * h, y + ny * h]); right.push([x - nx * h, y - ny * h]);
  }
  left = rdp(left, 0.06); right = rdp(right, 0.06);
  if (sp.c) return [{ n: left.slice(0, -1).map((p) => N(...p)), c: true }, { n: right.slice(0, -1).reverse().map((p) => N(...p)), c: true }];
  let ring = [...left];
  if (cap === 'round') ring = ring.concat(capArc(smp[m - 1][0], left[left.length - 1], right[right.length - 1]));
  ring = ring.concat(right.slice().reverse());
  if (cap === 'round') ring = ring.concat(capArc(smp[0][0], right[0], left[0]));
  return [{ n: ring.map((p) => N(...p)), c: true }];
}
/** render.js が呼ぶ（st.profile がある線）。形が変わらなければ覚えておく */
function variableOutline(it) {
  if (it._vo && it._vo.e === GEO_EPOCH) return it._vo.sps;
  const st = it.style, key = JSON.stringify([st.width, st.profile, st.cap, it.paths.map((s) => [s.c, s.n.map((n) => [n.x, n.y, n.ix, n.iy, n.ox, n.oy])])]);
  if (it._vo && it._vo.key === key) { it._vo.e = GEO_EPOCH; return it._vo.sps; }
  const sps = it.paths.flatMap((sp) => variableStroke(sp, st.width, st.profile, st.cap || 'butt'));      // exe の Style.cap の既定は butt
  it._vo = { e: GEO_EPOCH, key, sps };
  return sps;
}
/** パスの上で (x, y) に一番近い所: [長さの割合 t, 距離, 点, 向き] */
function nearestT(sp, x, y) {
  let pts = flattenSp(sp, 1);
  if (sp.c && pts.length) pts = [...pts, pts[0]];
  const cum = polyCum(pts), total = cum[cum.length - 1] || 1;
  let best = [Infinity, 0, pts[0] || [0, 0], [1, 0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy || 1e-12;
    const u = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / L2)), px = p[0] + dx * u, py = p[1] + dy * u, d = Math.hypot(px - x, py - y);
    if (d < best[0]) { const ln = Math.sqrt(L2); best = [d, (cum[i] + ln * u) / total, [px, py], [dx / ln, dy / ln]]; }
  }
  return { t: best[1], d: best[0], p: best[2], dir: best[3] };
}
function pointAtT(sp, t) {
  let pts = flattenSp(sp, 1);
  if (sp.c && pts.length) pts = [...pts, pts[0]];
  const cum = polyCum(pts), s = cum[cum.length - 1] * Math.max(0, Math.min(1, t));
  for (let i = 0; i + 1 < pts.length; i++) {
    if (cum[i + 1] >= s) {
      const seg = cum[i + 1] - cum[i] || 1e-9, u = (s - cum[i]) / seg, p = pts[i], q = pts[i + 1];
      return { p: [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u], dir: [(q[0] - p[0]) / seg, (q[1] - p[1]) / seg] };
    }
  }
  return { p: pts[pts.length - 1] || [0, 0], dir: [1, 0] };
}

// ---- 角丸（選んだ角。直線どうしの角だけ）---------------------------------------------------------
function roundNodes(sp, radius, indices = null) {
  const n = sp.n.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = sp.n[i], a = sp.n[(i - 1 + n) % n], b = sp.n[(i + 1) % n];
    let ok = (!indices || indices.has(i)) && (sp.c || (i > 0 && i < n - 1));
    if (ok && (hasIn(p) || hasOut(p) || hasOut(a) || hasIn(b))) ok = false;
    if (!ok) { out.push(nodeCopy(p)); continue; }
    const v1 = [a.x - p.x, a.y - p.y], v2 = [b.x - p.x, b.y - p.y], l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    if (l1 < 1e-9 || l2 < 1e-9) { out.push(nodeCopy(p)); continue; }
    const u1 = [v1[0] / l1, v1[1] / l1], u2 = [v2[0] / l2, v2[1] / l2];
    const ang = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
    if (ang < 1e-3 || Math.abs(ang - Math.PI) < 1e-3) { out.push(nodeCopy(p)); continue; }
    const d = Math.min(radius / Math.tan(ang / 2), l1 / 2, l2 / 2), reff = d * Math.tan(ang / 2), h = 4 / 3 * Math.tan((Math.PI - ang) / 4) * reff;
    const s = [p.x + u1[0] * d, p.y + u1[1] * d], e = [p.x + u2[0] * d, p.y + u2[1] * d];
    out.push(N(s[0], s[1], null, null, s[0] - u1[0] * h, s[1] - u1[1] * h));
    out.push(N(e[0], e[1], e[0] - u2[0] * h, e[1] - u2[1] * h, null, null));
  }
  return { n: out, c: sp.c };
}

// ---- 色を集める・塗り替える ----------------------------------------------------------------
function colorKey(c) { return `${c.m}:${c.v.map((x) => x.toFixed(3)).join(',')}:${c.name || ''}:${c.spot ? 1 : 0}`; }
/** 物の中のすべての色（塗り・線・グラデーションの分岐点・縁取り・効果・文字の範囲）に fn(色) → 新しい色 | null */
function visitColors(doc, items, fn) {
  const paint = (p) => {
    if (!p) return p;
    if (isGradient(p)) { p.stops = p.stops.map(([pos, c, o]) => [pos, paint(c), o]); return p; }
    const r = fn(p);
    return r || p;
  };
  for (const it of items) for (const x of doc.iterTree([it])) {
    if (x.style) {
      x.style.fill = paint(x.style.fill); x.style.stroke = paint(x.style.stroke);
      for (const e of x.style.extra || []) e.paint = paint(e.paint);
    }
    for (const e of x.effects || []) if (e.color && e.color.v) e.color = paint(e.color);
    if (x.kind === 'text') for (const r of x.runs || []) for (const k of ['fill', 'stroke']) if (r[k] && (r[k].v || isGradient(r[k]))) r[k] = paint(r[k]);
  }
}
function collectColors(doc, items) {
  const seen = new Map();
  visitColors(doc, items, (c) => { const k = colorKey(c); if (seen.has(k)) seen.get(k)[1]++; else seen.set(k, [paintCopy(c), 1]); return null; });
  return [...seen.values()].sort((a, b) => b[1] - a[1]);
}
function rgbToHls(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, l, 0];
  const d = mx - mn, s = l <= 0.5 ? d / (mx + mn) : d / (2 - mx - mn);
  let h = mx === r ? (g - b) / d : mx === g ? 2 + (b - r) / d : 4 + (r - g) / d;
  h = ((h / 6) % 1 + 1) % 1;
  return [h, l, s];
}
function hlsToRgb(h, l, s) {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s, m1 = 2 * l - m2;
  const v = (hh) => { hh = ((hh % 1) + 1) % 1; if (hh < 1 / 6) return m1 + (m2 - m1) * hh * 6; if (hh < 0.5) return m2; if (hh < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hh) * 6; return m1; };
  return [v(h + 1 / 3), v(h), v(h - 1 / 3)];
}
const rgbColor = (r, g, b) => ({ m: 'rgb', v: [r, g, b].map((x) => Math.round(clamp01(x) * 1e5) / 1e5) });
function shiftHue(c, deg, sat = 1, light = 0) {
  const [h, l, s] = rgbToHls(...colorRGB(c));
  const o = rgbColor(...hlsToRgb((h + deg / 360) % 1, clamp01(l + light), clamp01(s * sat)));
  return c.m === 'cmyk' ? toCMYK(o) : o;
}
function grayscale(c) { const [r, g, b] = colorRGB(c), y = 0.299 * r + 0.587 * g + 0.114 * b; return c.m !== 'rgb' ? { m: 'gray', v: [Math.round((1 - y) * 1e5) / 1e5] } : rgbColor(y, y, y); }
function isLight(c, thr = 0.85) { const [r, g, b] = colorRGB(c); return 0.299 * r + 0.587 * g + 0.114 * b >= thr; }
function grayLike(c) { const v = colorRGB(c); return Math.max(...v) - Math.min(...v) < 0.06; }

// ---- バリエーション --------------------------------------------------------------------------
const VARIATIONS = { gray: 'グレースケール', black: '1 色（黒）', white: '白抜き（暗い背景）', invert: '明るさの反転', hue60: '色相 +60°', hue120: '色相 +120°',
  hue240: '色相 +240°', pastel: 'パステル', vivid: 'ビビッド', deep: '深い色' };
function variationFn(kind) {
  if (kind === 'gray') return grayscale;
  if (kind === 'black') return (c) => (isLight(c) ? c : c.m === 'cmyk' ? { m: 'cmyk', v: [0, 0, 0, 1] } : rgbColor(0, 0, 0));
  if (kind === 'white') return (c) => (c.m === 'cmyk' ? { m: 'cmyk', v: [0, 0, 0, 0] } : rgbColor(1, 1, 1));
  if (kind === 'invert') return (c) => { const [h, l, s] = rgbToHls(...colorRGB(c)), o = rgbColor(...hlsToRgb(h, 1 - l, s)); return c.m === 'cmyk' ? toCMYK(o) : o; };
  if (kind.startsWith('hue')) { const deg = +kind.slice(3); return (c) => (isLight(c, 0.97) || grayLike(c) ? c : shiftHue(c, deg)); }
  if (kind === 'pastel') return (c) => (isLight(c, 0.97) ? c : shiftHue(c, 0, 0.6, 0.25));
  if (kind === 'vivid') return (c) => (isLight(c, 0.97) ? c : shiftHue(c, 0, 1.6, 0));
  if (kind === 'deep') return (c) => (isLight(c, 0.97) ? c : shiftHue(c, 0, 1.1, -0.18));
  throw new Error(kind);
}

// ---- アイコン一括 ---------------------------------------------------------------------------
const ICON_SETS = {
  ico: ['Windows アイコン（.ico・16〜256）', [16, 24, 32, 48, 64, 128, 256]],
  favicon: ['ファビコン（Web サイト用一式）', [16, 32, 48, 180, 192, 512]],
  ios: ['iOS アプリ', [1024, 180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29, 20]],
  android: ['Android（mdpi〜xxxhdpi・Play ストア 512）', [48, 72, 96, 144, 192, 512]],
  macos: ['macOS（16〜1024）', [16, 32, 64, 128, 256, 512, 1024]],
  pwa: ['PWA（192・512・マスカブル）', [192, 512]],
};
const ANDROID_DIRS = { 48: 'mipmap-mdpi', 72: 'mipmap-hdpi', 96: 'mipmap-xhdpi', 144: 'mipmap-xxhdpi', 192: 'mipmap-xxxhdpi' };
function iconPlan(sets, custom = []) {
  const out = [];
  if (sets.includes('ico')) { out.push({ path: 'windows/app.ico', kind: 'ico', sizes: ICON_SETS.ico[1] }); out.push(...ICON_SETS.ico[1].map((s) => ({ path: `windows/app_${s}.png`, size: s }))); }
  if (sets.includes('favicon')) out.push({ path: 'favicon/favicon.ico', kind: 'ico', sizes: [16, 32, 48] }, { path: 'favicon/favicon-16x16.png', size: 16 }, { path: 'favicon/favicon-32x32.png', size: 32 },
    { path: 'favicon/apple-touch-icon.png', size: 180, opaque: true }, { path: 'favicon/android-chrome-192x192.png', size: 192 }, { path: 'favicon/android-chrome-512x512.png', size: 512 }, { path: 'favicon/icon.svg', kind: 'svg' });
  if (sets.includes('ios')) out.push(...ICON_SETS.ios[1].map((s) => ({ path: `ios/AppIcon-${s}.png`, size: s, opaque: true })));
  if (sets.includes('android')) { for (const s of Object.keys(ANDROID_DIRS)) out.push({ path: `android/${ANDROID_DIRS[s]}/ic_launcher.png`, size: +s }); out.push({ path: 'android/playstore-512.png', size: 512, opaque: true }); }
  if (sets.includes('macos')) out.push(...ICON_SETS.macos[1].map((s) => ({ path: `macos/icon_${s}x${s}.png`, size: s })));
  if (sets.includes('pwa')) out.push({ path: 'pwa/icon-192.png', size: 192 }, { path: 'pwa/icon-512.png', size: 512 }, { path: 'pwa/maskable-512.png', size: 512, padding: 0.2, opaque: true });
  for (const s of custom) out.push({ path: `custom/icon_${s}.png`, size: s });
  return out;
}
const FAVICON_HTML = `<!-- 線工房で書き出したファビコン: <head> の中に貼り付け -->
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
`;
function webmanifest(name, color = '#ffffff') {
  return JSON.stringify({ name, short_name: name, icons: [{ src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' }], theme_color: color, background_color: color, display: 'standalone' }, null, 2);
}
/** PNG（の Uint8Array）を並べた .ico（Vista 以降の PNG 入り ICO） */
function makeIco(pngs) {
  const n = pngs.length, head = 6 + 16 * n, total = head + pngs.reduce((s, p) => s + p.data.length, 0);
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint16(0, 0, true); dv.setUint16(2, 1, true); dv.setUint16(4, n, true);
  let off = head;
  pngs.forEach((p, i) => {
    const e = 6 + 16 * i;
    out[e] = p.size >= 256 ? 0 : p.size; out[e + 1] = p.size >= 256 ? 0 : p.size;
    dv.setUint16(e + 4, 1, true); dv.setUint16(e + 6, 32, true); dv.setUint32(e + 8, p.data.length, true); dv.setUint32(e + 12, off, true);
    out.set(p.data, off); off += p.data.length;
  });
  return out;
}

// ---- 配色の提案（exe の palette.harmony と同じ）----------------------------------------------------
const SCHEMES = { analogous: '類似色', complementary: '補色', triad: 'トライアド（3 色）', split: '分裂補色', tetrad: 'テトラード（4 色）', mono: '同系の濃淡', pastel: 'パステル', vivid: 'ビビッド' };
function harmony(base, scheme = 'analogous', count = 5) {
  let [h, l, s] = rgbToHls(...colorRGB(base));
  const cmyk = base.m === 'cmyk';
  const mk = (hh, ss, ll) => { const c = rgbColor(...hlsToRgb(((hh % 1) + 1) % 1, clamp01(ll), clamp01(ss))); return cmyk ? toCMYK(c) : c; };
  count = Math.max(2, count | 0);
  if (s < 0.05 && scheme !== 'mono') s = 0.55;
  let hues;
  if (scheme === 'complementary') hues = [h, h + 0.5];
  else if (scheme === 'triad') hues = [h, h + 1 / 3, h + 2 / 3];
  else if (scheme === 'split') hues = [h, h + 0.5 - 1 / 12, h + 0.5 + 1 / 12];
  else if (scheme === 'tetrad') hues = [h, h + 0.25, h + 0.5, h + 0.75];
  else if (scheme === 'mono') return Array.from({ length: count }, (_, i) => mk(h, s, 0.15 + 0.7 * i / (count - 1)));
  else if (scheme === 'pastel') return Array.from({ length: count }, (_, i) => mk(h + i / count, 0.55, 0.82));
  else if (scheme === 'vivid') return Array.from({ length: count }, (_, i) => mk(h + i / count, 0.9, 0.5));
  else {
    const out = Array.from({ length: count }, (_, i) => mk(h + (i - (count - 1) / 2) / 12, s, l));
    out[(count - 1) >> 1] = paintCopy(base);
    return out;
  }
  const out = [paintCopy(base)];
  for (let i = 1; out.length < count; i++) {
    const hh = hues[i % hues.length], round = Math.floor(i / hues.length);
    const ll = round === 0 ? l : round % 2 ? Math.min(0.9, l + 0.18 * round) : Math.max(0.12, l - 0.18 * round);
    out.push(mk(hh, s, ll));
  }
  return out.slice(0, count);
}
