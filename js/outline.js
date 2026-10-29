/* 線工房 Web — 文字のアウトライン（字の形をパスに）。

   ブラウザは字の輪郭を取り出せないので、字を 1 つずつ大きく（1em = 400px）描いて、
   濃さ 50% の等高線をなぞり（マーチングスクエア、画素の間を直線で補う）、曲線を当てはめる。
   誤差は 0.3px / 400px ≒ 1em の 0.08%。字ごとに覚えておく（同じ字・同じフォントは 1 回だけ）。
   座標は text.js の字の行列と同じ「100px の字」の空間（原点はベースラインの左、y 下向き）。
*/
'use strict';

const OUTLINE_EM = 400;
const _glyphOutlines = new Map();
let _olCanvas = null;

/** 字の輪郭 → subpaths（100px の字の空間） */
function glyphSps(font100, ch) {
  const key = font100 + '\u0000' + ch;
  const hit = _glyphOutlines.get(key);
  if (hit) return hit;
  const k = OUTLINE_EM / 100, font = font100.replace(/100px/, OUTLINE_EM + 'px');
  if (!_olCanvas) _olCanvas = document.createElement('canvas');
  const cv = _olCanvas, ctx0 = cv.getContext('2d', { willReadFrequently: true });
  ctx0.font = font;
  const m = ctx0.measureText(ch);
  const L = Math.ceil(m.actualBoundingBoxLeft || 0), R = Math.ceil(m.actualBoundingBoxRight || m.width);
  const A = Math.ceil(m.actualBoundingBoxAscent || OUTLINE_EM), D = Math.ceil(m.actualBoundingBoxDescent || 0);
  const pad = 4, w = Math.max(1, L + R + 2 * pad), h = Math.max(1, A + D + 2 * pad);
  if (w * h > 4e6 || !(R + L > 0)) { _glyphOutlines.set(key, []); return []; }
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#000';
  const ox = pad + L, oy = pad + A;
  ctx.fillText(ch, ox, oy);
  const data = ctx.getImageData(0, 0, w, h).data;
  const loops = traceAlpha(data, w, h, 0.5);
  const sps = [];
  for (const pts of loops) {
    if (pts.length < 4) continue;
    if (Math.abs(polyArea(pts)) < 0.3 * k * k) continue;      // ごく小さな点は捨てる
    const sp = fitLoopCorners(pts, 0.45);
    if (sp.n.length < 2) continue;
    spsTransform([sp], [1 / k, 0, 0, 1 / k, -ox / k, -oy / k]);
    sps.push(sp);
  }
  orientNested(sps);
  _glyphOutlines.set(key, sps);
  if (_glyphOutlines.size > 4000) _glyphOutlines.delete(_glyphOutlines.keys().next().value);
  return sps;
}

/** 閉じた折れ線 → 角で切ってから区間ごとに曲線を当てはめる（Schneider の方法は角があると細かく割れて点が増えるので） */
function fitLoopCorners(pts, tol, r = 3, angleDeg = 38) {
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i % n][0] - pts[i - 1][0], pts[i % n][1] - pts[i - 1][1]));
  const total = cum[n];
  if (total < 4 * r) return fitCurve(pts, tol, true);
  // 点 i の前後 r の所への向きの曲がり
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = i, b = i, la = 0, lb = 0;
    while (la < r) { const j = (a - 1 + n) % n; la += Math.hypot(pts[a][0] - pts[j][0], pts[a][1] - pts[j][1]); a = j; if (a === i) break; }
    while (lb < r) { const j = (b + 1) % n; lb += Math.hypot(pts[j][0] - pts[b][0], pts[j][1] - pts[b][1]); b = j; if (b === i) break; }
    const ux = pts[i][0] - pts[a][0], uy = pts[i][1] - pts[a][1], vx = pts[b][0] - pts[i][0], vy = pts[b][1] - pts[i][1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    turn[i] = lu > 0 && lv > 0 ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)))) * 180 / Math.PI : 0;
  }
  const corners = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < angleDeg) continue;
    let isMax = true;
    for (let d = 1; d <= 4 && isMax; d++) { if (turn[(i + d) % n] > turn[i] || turn[(i - d + n) % n] >= turn[i]) isMax = false; }
    if (isMax) corners.push(i);
  }
  if (corners.length < 1) return fitCurve(pts, tol, true);
  const nodes = [];
  for (let c = 0; c < corners.length; c++) {
    const s = corners[c], e = corners[(c + 1) % corners.length];
    const run = [];
    for (let i = s; ; i = (i + 1) % n) { run.push(pts[i]); if (i === e && run.length > 1) break; if (run.length > n + 1) break; }
    // ほぼまっすぐなら直線 1 本
    const [p0, p1] = [run[0], run[run.length - 1]], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const straight = L > 0 && run.every(([x, y]) => Math.abs((x - p0[0]) * (p1[1] - p0[1]) - (y - p0[1]) * (p1[0] - p0[0])) / L <= tol);
    const sp = straight ? { n: [N(...p0), N(...p1)] } : fitCurve(run, tol, false);
    const ns = sp.n.length >= 2 ? sp.n : [N(...run[0]), N(...run[run.length - 1])];
    if (nodes.length) { const last = nodes[nodes.length - 1]; last.ox = ns[0].ox; last.oy = ns[0].oy; }
    else nodes.push({ ...ns[0] });
    for (let k = 1; k < ns.length; k++) nodes.push({ ...ns[k] });
  }
  // 最後の点は最初の角と同じ点: 入りのハンドルを最初の点へ
  const last = nodes.pop(), first = nodes[0];
  first.ix = last.ix; first.iy = last.iy;
  const sp = { n: nodes, c: true };
  for (const nd of sp.n) nd.s = false;
  markSmooth(sp);
  return sp;
}

/** RGBA の濃さ（a）の等高線 → 輪（画素の座標の点の並び） */
function traceAlpha(data, w, h, T) {
  const v = (x, y) => data[(y * w + x) * 4 + 3] / 255;
  const segs = [];        // [edgeKeyA, edgeKeyB]
  const pos = new Map();  // edgeKey → [x, y]
  const ept = (kind, x, y) => {
    const key = kind + x + ',' + y;
    if (!pos.has(key)) {
      let p;
      if (kind === 'h') { const a = v(x, y), b = v(x + 1, y), t = (T - a) / ((b - a) || 1e-9); p = [x + 0.5 + Math.max(0, Math.min(1, t)), y + 0.5]; }
      else { const a = v(x, y), b = v(x, y + 1), t = (T - a) / ((b - a) || 1e-9); p = [x + 0.5, y + 0.5 + Math.max(0, Math.min(1, t))]; }
      pos.set(key, p);
    }
    return key;
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = v(x, y) >= T, b = v(x + 1, y) >= T, c = v(x + 1, y + 1) >= T, d = v(x, y + 1) >= T;
      const idx = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const Tk = () => ept('h', x, y), Bk = () => ept('h', x, y + 1), Lk = () => ept('v', x, y), Rk = () => ept('v', x + 1, y);
      const centre = () => (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4 >= T;
      switch (idx) {
        case 1: case 14: segs.push([Lk(), Bk()]); break;
        case 2: case 13: segs.push([Bk(), Rk()]); break;
        case 3: case 12: segs.push([Lk(), Rk()]); break;
        case 4: case 11: segs.push([Tk(), Rk()]); break;
        case 6: case 9: segs.push([Tk(), Bk()]); break;
        case 7: case 8: segs.push([Lk(), Tk()]); break;
        case 5: if (centre()) { segs.push([Lk(), Tk()], [Bk(), Rk()]); } else { segs.push([Tk(), Rk()], [Lk(), Bk()]); } break;
        case 10: if (centre()) { segs.push([Tk(), Rk()], [Lk(), Bk()]); } else { segs.push([Lk(), Tk()], [Bk(), Rk()]); } break;
      }
    }
  }
  // つなぐ（どの辺の点も、ちょうど 2 つの線分に出てくる）
  const by = new Map();
  segs.forEach(([p, q], i) => { for (const k of [p, q]) { let l = by.get(k); if (!l) by.set(k, (l = [])); l.push(i); } });
  const used = new Uint8Array(segs.length), loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const start = segs[i][0], loop = [pos.get(start)];
    let cur = segs[i][1], guard = 0;
    while (cur !== start && guard++ < segs.length + 2) {
      loop.push(pos.get(cur));
      const nx = (by.get(cur) || []).find((j) => !used[j]);
      if (nx == null) break;
      used[nx] = 1;
      cur = segs[nx][0] === cur ? segs[nx][1] : segs[nx][0];
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
/** 入れ子の深さで向きをそろえる（外は面積が正・穴は負 → nonzero で穴があく） */
function orientNested(sps) {
  const polys = sps.map((sp) => flattenForBool([sp], [], 0.2).polys[0] || []);
  sps.forEach((sp, i) => {
    const p = polys[i][0];
    if (!p) return;
    let depth = 0;
    polys.forEach((q, j) => { if (j !== i && q.length > 2 && insideShape({ polys: [q], rule: 'evenodd', bbox: polysBBox([q]) }, p[0], p[1])) depth++; });
    const a = polyArea(polys[i]);
    if ((depth % 2 === 0) !== (a > 0)) spReverse(sp);
  });
}

/** 文字の物 → 字ごとのパス [{sps, style}]（文書座標）。withExtra なら縁取りを線のパスとして下に（exe の _text_paths と同じ） */
function textOutlinePaths(it, withExtra = false) {
  const lay = textLayout(it), out = [], all = [];
  for (const g of lay.glyphs) {
    if (!g.ch.trim()) continue;
    const base = glyphSps(g.font, g.ch);
    if (!base.length) continue;
    const sps = spsCopy(base);
    spsTransform(sps, M.then(g.m, it.matrix));
    const st = JSON.parse(JSON.stringify(glyphStyle(it.style, g)));
    delete st.extra;
    out.push({ sps, style: st });
    all.push(...sps);
  }
  if (withExtra && it.style.extra && it.style.extra.length) {
    const rims = [];
    for (const e of it.style.extra.slice().reverse()) {
      if (!e.paint || !(e.width > 0)) continue;
      rims.push({ sps: spsCopy(all), style: { fill: null, stroke: paintCopy(e.paint), width: e.width, cap: 'round', join: e.join || 'round' } });
    }
    return [...rims, ...out];
  }
  return out;
}
