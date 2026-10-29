/* 線工房 Web — 形の計算（exe は skia-pathops。Web は自前）。

   手順: 形を細かい折れ線にする（どの元の曲線の何 t かを覚える）→ 全部の交わりで切って平面のグラフにする →
   面（半辺のたどり）ごとに、どの形の内側かを調べる → 欲しい面だけ残して境目をつなぐ → 元の曲線の一部はそのまま曲線に戻す。
   線を太らせる・オフセットは、区間ごとの四角と角の形を全部合わせた物（exe の stroke と同じ考え方）で、境目は曲線を当てはめる。
   座標の向き: 面積が正 = 内側が左（数式どおりの向き。画面は y が下向きなので見た目は逆回り）。
*/
'use strict';

const SNAP = 2e-4;            // これより近い点は同じ点
const SAMPLE_EPS = 2e-3;      // 面の内側を調べる点を、辺からずらす量

// ---- 折れ線にする -----------------------------------------------------------------------
/** subpaths → {polys: [[x,y]...], srcs: [[{seg,t0,t1}]...]}。segs には元の区間を足していく */
function flattenForBool(sps, segs, tol = 0.02, closeOpen = true) {
  const polys = [], srcs = [];
  for (const sp of sps) {
    const n = sp.n.length;
    if (n < 2) continue;
    const pts = [], src = [];
    const nseg = sp.c || closeOpen ? n : n - 1;
    for (let i = 0; i < nseg; i++) {
      const a = sp.n[i], b = sp.n[(i + 1) % n];
      const closing = !sp.c && i === n - 1;
      const line = closing || (!hasOut(a) && !hasIn(b));
      const P = closing ? [[a.x, a.y], [a.x, a.y], [b.x, b.y], [b.x, b.y]] : [[a.x, a.y], [a.ox, a.oy], [b.ix, b.iy], [b.x, b.y]];
      const id = segs.push({ p: P, line }) - 1;
      let k = 1;
      if (!line) {
        const m = Math.max(Math.hypot(P[0][0] - 2 * P[1][0] + P[2][0], P[0][1] - 2 * P[1][1] + P[2][1]),
          Math.hypot(P[1][0] - 2 * P[2][0] + P[3][0], P[1][1] - 2 * P[2][1] + P[3][1]));
        k = Math.max(2, Math.min(256, Math.ceil(Math.sqrt(0.75 * m / tol))));
      }
      for (let j = 0; j < k; j++) {
        const t0 = j / k, t1 = (j + 1) / k;
        pts.push(j === 0 ? [P[0][0], P[0][1]] : cubicPoint(...P, t0));
        src.push({ seg: id, t0, t1 });
      }
    }
    if (!sp.c && !closeOpen) pts.push([sp.n[n - 1].x, sp.n[n - 1].y]);      // 開いたまま（線を太らせる用）: 終わりの点も
    if (pts.length >= 2) { polys.push(pts); srcs.push(src); }
  }
  return { polys, srcs };
}
function polyArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function polysBBox(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of polys) for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return x0 <= x1 ? [x0, y0, x1, y1] : null;
}
/** 点の周りの巻き数（rule: nonzero / evenodd / positive） */
function insideShape(sh, x, y) {
  const b = sh.bbox;
  if (!b || x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  let w = 0, c = 0;
  for (const pts of sh.polys) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      if ((p[1] > y) !== (q[1] > y)) {
        const xi = p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]);
        if (xi > x) { c++; w += q[1] > p[1] ? 1 : -1; }
      }
    }
  }
  return sh.rule === 'evenodd' ? (c & 1) === 1 : sh.rule === 'positive' ? w > 0 : w !== 0;
}
function shapeOf(polys, rule, srcs = null) { return { polys, srcs, rule, bbox: polysBBox(polys) }; }

// ---- 平面のグラフ ------------------------------------------------------------------------
/** shapes の輪郭で平面を分ける。classify(x, y) → 面の印（文字列。'' は外）*/
function arrange(shapes, classify) {
  // 1. 辺
  const E = [];
  for (const sh of shapes) sh.polys.forEach((pts, pi) => {
    const src = sh.srcs ? sh.srcs[pi] : null, n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      if (Math.abs(p[0] - q[0]) < 1e-12 && Math.abs(p[1] - q[1]) < 1e-12) continue;
      E.push({ x0: p[0], y0: p[1], x1: q[0], y1: q[1], src: src ? src[i] : null, cuts: [] });
    }
  });
  // 2. 交わり（升目で近い辺だけ調べる）
  let len = 0, bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const e of E) {
    len += Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
    bx0 = Math.min(bx0, e.x0, e.x1); by0 = Math.min(by0, e.y0, e.y1); bx1 = Math.max(bx1, e.x0, e.x1); by1 = Math.max(by1, e.y0, e.y1);
  }
  const cs = Math.max(1e-3, (len / Math.max(1, E.length)) * 2, Math.max(bx1 - bx0, by1 - by0) / 400);
  const grid = new Map();
  const cellsOf = (e) => {
    const cx0 = Math.floor((Math.min(e.x0, e.x1) - bx0) / cs), cx1 = Math.floor((Math.max(e.x0, e.x1) - bx0) / cs);
    const cy0 = Math.floor((Math.min(e.y0, e.y1) - by0) / cs), cy1 = Math.floor((Math.max(e.y0, e.y1) - by0) / cs);
    const out = [];
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) out.push(cx * 1000003 + cy);
    return out;
  };
  E.forEach((e, i) => { for (const c of cellsOf(e)) { let l = grid.get(c); if (!l) grid.set(c, (l = [])); l.push(i); } });
  const stamp = new Int32Array(E.length).fill(-1);
  for (let i = 0; i < E.length; i++) {
    const a = E[i];
    for (const c of cellsOf(a)) for (const j of grid.get(c)) {
      if (j <= i || stamp[j] === i) continue;
      stamp[j] = i;
      intersectEdges(a, E[j]);
    }
  }
  // 3. 点をまとめて、短い辺に切る
  const V = [], vgrid = new Map();
  const vtx = (x, y) => {
    const gx = Math.floor(x / SNAP), gy = Math.floor(y / SNAP);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const l = vgrid.get((gx + dx) + ',' + (gy + dy));
      if (l) for (const k of l) if (Math.abs(V[k][0] - x) <= SNAP && Math.abs(V[k][1] - y) <= SNAP) return k;
    }
    const k = V.push([x, y]) - 1, key = gx + ',' + gy;
    let l = vgrid.get(key); if (!l) vgrid.set(key, (l = [])); l.push(k);
    return k;
  };
  const edges = [], seen = new Map();
  for (const e of E) {
    const cuts = [{ u: 0, x: e.x0, y: e.y0 }, ...e.cuts, { u: 1, x: e.x1, y: e.y1 }].sort((p, q) => p.u - q.u);
    let prev = cuts[0], pv = vtx(prev.x, prev.y);
    for (let k = 1; k < cuts.length; k++) {
      const c = cuts[k], cv = vtx(c.x, c.y);
      if (cv !== pv) {
        const key = pv < cv ? pv + ':' + cv : cv + ':' + pv;
        if (!seen.has(key)) {
          let src = null;
          if (e.src) { const t = (u) => e.src.t0 + (e.src.t1 - e.src.t0) * u; src = { seg: e.src.seg, ta: t(prev.u), tb: t(c.u) }; }
          seen.set(key, edges.length);
          edges.push({ a: pv, b: cv, src });
        }
      }
      prev = c; pv = cv;
    }
  }
  // 4. 半辺と面
  const H = edges.length * 2;
  const org = new Int32Array(H), out = V.map(() => []);
  edges.forEach((e, i) => { org[2 * i] = e.a; org[2 * i + 1] = e.b; out[e.a].push(2 * i); out[e.b].push(2 * i + 1); });
  const dest = (h) => org[h ^ 1];
  const ang = new Float64Array(H), pos = new Int32Array(H);
  for (let h = 0; h < H; h++) { const p = V[org[h]], q = V[dest(h)]; ang[h] = Math.atan2(q[1] - p[1], q[0] - p[0]); }
  for (const l of out) { l.sort((x, y) => ang[x] - ang[y]); l.forEach((h, k) => { pos[h] = k; }); }
  const next = new Int32Array(H);
  for (let h = 0; h < H; h++) { const tw = h ^ 1, l = out[org[tw]]; next[h] = l[(pos[tw] - 1 + l.length) % l.length]; }
  const face = new Int32Array(H).fill(-1), faces = [];
  for (let h = 0; h < H; h++) {
    if (face[h] >= 0) continue;
    const f = faces.length, hs = [];
    let x = h, guard = 0;
    do { face[x] = f; hs.push(x); x = next[x]; } while (x !== h && ++guard < H + 2);
    let area = 0, best = hs[0], bl = -1;
    for (const y of hs) {
      const p = V[org[y]], q = V[dest(y)];
      area += p[0] * q[1] - q[0] * p[1];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l > bl) { bl = l; best = y; }
    }
    faces.push({ hs, area: area / 2, best, bl, key: '' });
  }
  // 5. 面がどの形の内側か（いちばん長い辺の少し左で調べる）
  for (const f of faces) {
    if (Math.abs(f.area) < 1e-9 || f.bl <= 0) continue;
    const p = V[org[f.best]], q = V[dest(f.best)], l = f.bl;
    const eps = Math.min(SAMPLE_EPS, l * 0.25);
    const mx = (p[0] + q[0]) / 2 - (q[1] - p[1]) / l * eps, my = (p[1] + q[1]) / 2 + (q[0] - p[0]) / l * eps;
    f.key = classify(mx, my);
  }
  return { V, edges, org, next, face, faces, dest };
}
function intersectEdges(a, b) {
  const dx1 = a.x1 - a.x0, dy1 = a.y1 - a.y0, dx2 = b.x1 - b.x0, dy2 = b.y1 - b.y0;
  if (Math.max(a.x0, a.x1) < Math.min(b.x0, b.x1) - SNAP || Math.max(b.x0, b.x1) < Math.min(a.x0, a.x1) - SNAP ||
      Math.max(a.y0, a.y1) < Math.min(b.y0, b.y1) - SNAP || Math.max(b.y0, b.y1) < Math.min(a.y0, a.y1) - SNAP) return;
  const L1 = Math.hypot(dx1, dy1), L2 = Math.hypot(dx2, dy2);
  const d = dx1 * dy2 - dy1 * dx2;
  const lo = 1e-9, hi = 1 - 1e-9;
  if (Math.abs(d) <= 1e-10 * L1 * L2) {
    // 平行: 同じ直線の上で重なっていれば、互いの端で切る
    const dist = Math.abs((b.x0 - a.x0) * dy1 - (b.y0 - a.y0) * dx1) / (L1 || 1);
    if (dist > SNAP) return;
    for (const [px, py] of [[b.x0, b.y0], [b.x1, b.y1]]) { const u = ((px - a.x0) * dx1 + (py - a.y0) * dy1) / (L1 * L1); if (u > lo && u < hi) a.cuts.push({ u, x: px, y: py }); }
    for (const [px, py] of [[a.x0, a.y0], [a.x1, a.y1]]) { const u = ((px - b.x0) * dx2 + (py - b.y0) * dy2) / (L2 * L2); if (u > lo && u < hi) b.cuts.push({ u, x: px, y: py }); }
    return;
  }
  const ex = b.x0 - a.x0, ey = b.y0 - a.y0;
  const u = (ex * dy2 - ey * dx2) / d, v = (ex * dy1 - ey * dx1) / d;
  const tu = SNAP / (L1 || 1), tv = SNAP / (L2 || 1);
  if (u < -tu || u > 1 + tu || v < -tv || v > 1 + tv) return;
  const x = a.x0 + dx1 * Math.min(1, Math.max(0, u)), y = a.y0 + dy1 * Math.min(1, Math.max(0, u));
  if (u > lo && u < hi) a.cuts.push({ u, x, y });
  if (v > lo && v < hi) b.cuts.push({ u: v, x, y });
}

/** 残す面（keep(face)）の境目をたどった輪 → 半辺の並びの配列 */
function extractLoops(A, keep) {
  const { next, face, faces } = A, H = next.length;
  const kf = faces.map((f, i) => !!keep(f, i));
  const isB = (h) => kf[face[h]] && !kf[face[h ^ 1]];
  const used = new Uint8Array(H), loops = [];
  for (let h = 0; h < H; h++) {
    if (used[h] || !isB(h)) continue;
    const loop = [];
    let x = h, guard = 0;
    while (!used[x] && guard++ < H + 2) {
      used[x] = 1; loop.push(x);
      let c = next[x], g2 = 0;
      while (!isB(c) && g2++ < H) c = next[c ^ 1];      // 残す面の中を回って、次の境目へ
      x = c;
    }
    if (loop.length >= 2) loops.push(loop);
  }
  return loops;
}
function loopPts(A, loop) { return loop.map((h) => A.V[A.org[h]]); }

/** 輪（半辺の並び）→ subpath。元の曲線から来た所は曲線のまま、そうでない所は曲線を当てはめる */
function loopToSubpath(A, loop, segs, fitTol) {
  const { V, org, edges } = A;
  const srcOf = (h) => { const e = edges[h >> 1]; if (!e.src) return null; return h & 1 ? { seg: e.src.seg, ta: e.src.tb, tb: e.src.ta } : e.src; };
  const P = loop.map((h) => V[org[h]]), S = loop.map(srcOf), n = loop.length;
  // 長い直線の辺は曲線に混ぜない（当てはめは点の所でしか誤差を見ないので、長い辺の途中でふくらむ）
  const bb = polysBBox([P]), longEdge = Math.max(3, Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) * 0.02);
  const elen = (i) => { const p = P[i], q = P[(i + 1) % n]; return Math.hypot(q[0] - p[0], q[1] - p[1]); };
  // 1. 同じ元の区間で t が続く所をひとまとめに
  const same = (i) => { const a = S[i], b = S[(i + 1) % n]; return a && b && a.seg === b.seg && Math.abs(a.tb - b.ta) < 1e-7; };
  const smooth = (i) => {              // i の終わり（= i+1 の始まり）の点で、元の無い辺どうしがなめらかにつながるか
    const a = S[i], b = S[(i + 1) % n];
    if (a || b) return false;
    if (elen(i) > longEdge || elen((i + 1) % n) > longEdge) return false;
    const p = P[i], q = P[(i + 1) % n], r = P[(i + 2) % n];
    const ax = q[0] - p[0], ay = q[1] - p[1], bx = r[0] - q[0], by = r[1] - q[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) return true;
    return (ax * bx + ay * by) / (la * lb) > Math.cos(22 * Math.PI / 180);
  };
  const joinable = (i) => same(i) || smooth(i);
  let start = 0;
  while (start < n && joinable((start - 1 + n) % n)) start++;
  if (start >= n) start = 0;
  const pieces = [];
  let i = start, count = 0;
  while (count < n) {
    const run = [i];
    let j = i;
    while (count + run.length < n && joinable(j)) { j = (j + 1) % n; run.push(j); }
    pieces.push(run);
    count += run.length;
    i = (j + 1) % n;
  }
  // 2. かけらごとに錨点とハンドル
  const nodes = [];
  const add = (pt) => { const nd = N(pt[0], pt[1]); nodes.push(nd); return nd; };
  for (const run of pieces) {
    const first = run[0], last = run[run.length - 1], sa = S[first];
    const p0 = P[first], p3 = P[(last + 1) % n];
    const nd = add(p0);
    if (sa) {
      const sb = S[last], seg = segs[sa.seg];
      if (seg.line) continue;
      const q = subCubic(seg.p, sa.ta, sb.tb);
      nd.ox = q[1][0] + p0[0] - q[0][0]; nd.oy = q[1][1] + p0[1] - q[0][1];
      nd._in = [q[2][0] + p3[0] - q[3][0], q[2][1] + p3[1] - q[3][1]];
    } else if (run.length > 1) {
      // 元の無い折れ線 → 曲線を当てはめ（途中の錨点も足す）
      const pts = [p0, ...run.slice(1).map((k) => P[k]), p3];
      const sp = fitCurve(pts, fitTol, false);
      if (sp.n.length >= 2) {
        nd.ox = sp.n[0].ox; nd.oy = sp.n[0].oy;
        for (let k = 1; k < sp.n.length - 1; k++) nodes.push({ ...sp.n[k] });
        nodes[nodes.length - 1]._in = [sp.n[sp.n.length - 1].ix, sp.n[sp.n.length - 1].iy];
      }
    }
  }
  // 3. 前のかけらの入りのハンドルを次の錨点へ
  for (let k = 0; k < nodes.length; k++) {
    const a = nodes[k];
    if (a._in) { const b = nodes[(k + 1) % nodes.length]; [b.ix, b.iy] = a._in; delete a._in; }
  }
  const sp = { n: nodes.map((x) => ({ ...x })), c: true };
  markSmooth(sp);
  return sp;
}
function subCubic(P, ta, tb) {
  if (ta > tb) { const q = subCubic(P, tb, ta); return [q[3], q[2], q[1], q[0]]; }
  let q = P;
  if (ta > 1e-12) q = splitCubic(...q, ta)[1];
  const t = ta < 1 - 1e-12 ? (tb - ta) / (1 - ta) : 1;
  if (t < 1 - 1e-12) q = splitCubic(...q, t)[0];
  return q;
}
function loopsToSps(A, loops, segs, fitTol = null, minArea = 0.01) {
  const out = [];
  for (const l of loops) {
    const pts = loopPts(A, l);
    if (Math.abs(polyArea(pts)) < minArea) continue;
    const b = polysBBox([pts]), tol = fitTol ?? Math.max(0.03, Math.hypot(b[2] - b[0], b[3] - b[1]) * 0.0012);
    const sp = loopToSubpath(A, l, segs, tol);
    if (sp.n.length >= 2) out.push(sp);
  }
  return out;
}

/** つながった面ごとの領域（同じ印の面が辺でつながる・穴は入れ物の面と同じ）→ [{key, faces:Set}] */
function regionsOf(A) {
  const { faces, face, V, org } = A;
  const par = faces.map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  for (let h = 0; h < face.length; h += 2) { const a = face[h], b = face[h + 1]; if (faces[a].key && faces[a].key === faces[b].key) unite(a, b); }
  // 穴の輪（面積が負）を、それを囲む一番小さい正の輪と同じ面に
  const pos = faces.map((f, i) => [f, i]).filter(([f]) => f.area > 1e-9).map(([f, i]) => ({ i, pts: f.hs.map((h) => V[org[h]]), area: f.area, bb: polysBBox([f.hs.map((h) => V[org[h]])]) }));
  faces.forEach((f, i) => {
    if (f.area >= -1e-9 || !f.key) return;
    const p = V[org[f.hs[0]]];
    let best = null;
    for (const c of pos) {
      if (c.area >= (best ? best.area : Infinity) || c.area < -f.area) continue;
      const b = c.bb;
      if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
      if (insideShape({ polys: [c.pts], rule: 'evenodd', bbox: b }, p[0] + 1e-7, p[1] + 1e-7) && faces[c.i].key === f.key) best = c;
    }
    if (best) unite(i, best.i);
  });
  const groups = new Map();
  faces.forEach((f, i) => {
    if (!f.key) return;
    const r = find(i);
    if (!groups.has(r)) groups.set(r, { key: f.key, faces: new Set() });
    groups.get(r).faces.add(i);
  });
  return [...groups.values()];
}

// ---- 線を太らせる（区間の四角・角の形・端の形をすべて合わせる）---------------------------------------
function strokePieces(pts, closed, h, join = 'miter', miter = 10, cap = 'butt') {
  const out = [], n = pts.length;
  if (n < 2 || h <= 0) return out;
  const seg = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return l < 1e-12 ? null : { ux: dx / l, uy: dy / l, nx: -dy / l, ny: dx / l, l }; };
  const m = closed ? n : n - 1, S = [];
  for (let i = 0; i < m; i++) S.push(seg(pts[i], pts[(i + 1) % n]));
  const arcStep = Math.max(0.05, Math.acos(Math.max(-1, Math.min(1, 1 - 0.05 / Math.max(h, 0.05)))) * 2);
  for (let i = 0; i < m; i++) {
    const s = S[i]; if (!s) continue;
    const a = pts[i], b = pts[(i + 1) % n];
    out.push([[a[0] + s.nx * h, a[1] + s.ny * h], [b[0] + s.nx * h, b[1] + s.ny * h], [b[0] - s.nx * h, b[1] - s.ny * h], [a[0] - s.nx * h, a[1] - s.ny * h]]);
  }
  const joinAt = (b, s1, s2) => {
    const cr = s1.ux * s2.uy - s1.uy * s2.ux, dt = s1.ux * s2.ux + s1.uy * s2.uy;
    if (Math.abs(cr) < 1e-9 && dt > 0) return;
    const sg = cr > 0 ? -1 : 1;
    const P1 = [b[0] + sg * s1.nx * h, b[1] + sg * s1.ny * h], P2 = [b[0] + sg * s2.nx * h, b[1] + sg * s2.ny * h];
    if (join === 'round') {
      const a0 = Math.atan2(P1[1] - b[1], P1[0] - b[0]);
      let da = Math.atan2(P2[1] - b[1], P2[0] - b[0]) - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const k = Math.max(1, Math.ceil(Math.abs(da) / arcStep)), poly = [b];
      for (let j = 0; j <= k; j++) { const t = a0 + da * j / k; poly.push([b[0] + Math.cos(t) * h, b[1] + Math.sin(t) * h]); }
      out.push(poly);
      return;
    }
    const ratio = Math.sqrt(2 / Math.max(1e-12, 1 + (s1.nx * s2.nx + s1.ny * s2.ny)));
    if (join === 'miter' && ratio <= miter) {
      const mx = s1.nx + s2.nx, my = s1.ny + s2.ny, ml = Math.hypot(mx, my) || 1;
      const tip = [b[0] + sg * mx / ml * h * ratio, b[1] + sg * my / ml * h * ratio];
      out.push([b, P1, tip, P2]);
    } else out.push([b, P1, P2]);
  };
  for (let i = 0; i < (closed ? m : m - 1); i++) {
    const s1 = S[i], s2 = S[(i + 1) % m];
    if (s1 && s2) joinAt(pts[(i + 1) % n], s1, s2);
  }
  if (!closed) {
    const capAt = (p, s, back) => {
      if (!s || cap === 'butt') return;
      const ux = back ? -s.ux : s.ux, uy = back ? -s.uy : s.uy;
      if (cap === 'square') {
        out.push([[p[0] + s.nx * h, p[1] + s.ny * h], [p[0] + s.nx * h + ux * h, p[1] + s.ny * h + uy * h], [p[0] - s.nx * h + ux * h, p[1] - s.ny * h + uy * h], [p[0] - s.nx * h, p[1] - s.ny * h]]);
      } else {
        const poly = [], a0 = Math.atan2(s.ny, s.nx), dir = back ? 1 : -1, k = Math.max(4, Math.ceil(Math.PI / arcStep));
        for (let j = 0; j <= k; j++) { const t = a0 + dir * Math.PI * j / k; poly.push([p[0] + Math.cos(t) * h, p[1] + Math.sin(t) * h]); }
        out.push(poly);
      }
    };
    capAt(pts[0], S.find(Boolean), true);
    capAt(pts[n - 1], [...S].reverse().find(Boolean), false);
  }
  return out;
}
/** 折れ線に破線を当てる → 開いた折れ線の並び */
function dashPolyline(pts, closed, dash, offset = 0) {
  const d = dash.length % 2 ? [...dash, ...dash] : dash.slice(), total = d.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [pts];
  const P = closed ? [...pts, pts[0]] : pts, out = [];
  let k = 0, rem = 0, on = true, pos = ((offset % total) + total) % total;
  while (pos > 0) { if (pos >= d[k]) { pos -= d[k]; k = (k + 1) % d.length; on = !on; } else { rem = d[k] - pos; pos = 0; } }
  if (!rem) rem = d[k];
  let cur = on ? [P[0]] : null;
  for (let i = 0; i + 1 < P.length; i++) {
    let a = P[i];
    const b = P[i + 1];
    let L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (L > 1e-12) {
      if (rem >= L) { rem -= L; if (cur) cur.push(b); L = 0; }
      else {
        const t = rem / L, m2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (cur) { cur.push(m2); if (cur.length >= 2) out.push(cur); cur = null; } else cur = [m2];
        L -= rem; a = m2; k = (k + 1) % d.length; rem = d[k]; on = !on;
        if (!on) cur = null;
      }
    }
  }
  if (cur && cur.length >= 2) out.push(cur);
  return out;
}

// ---- 操作（exe の ops.pathfinder / offset_path / outline_stroke / shape_regions と同じ考え方）------------------
const PATHFINDER_LABELS = { unite: '合体', minus_front: '前面オブジェクトで型抜き', intersect: '交差', exclude: '中マド', minus_back: '背面オブジェクトで型抜き', divide: '分割' };

/** 物 → その中のパス（グループの中・対称の写しも。文字・画像は入れない） */
function boolPaths(doc, it, m = null) {
  const out = [];
  const walk = (x, mm) => {
    if (x.visible === false) return;
    if (x.kind === 'path' && x.paths.length) {
      const sps = spsCopy(x.paths);
      if (mm) spsTransform(sps, mm);
      out.push({ item: x, sps, rule: x.fill_rule === 'evenodd' ? 'evenodd' : 'nonzero' });
    } else if (x.children) {
      const base = out.length;
      for (const c of x.children) walk(c, mm);
      if (x.symmetry) {
        const made = out.slice(base);
        for (const sm of symmetryMatrices(x.symmetry)) for (const p of made) { const sps = spsCopy(p.sps); spsTransform(sps, sm); out.push({ ...p, sps }); }
      }
    }
  };
  walk(it, m);
  return out;
}
function hasTextIn(doc, items) { return items.some((it) => [...doc.iterTree([it])].some((x) => x.kind === 'text')); }

/** 選んだ物を形にする: owners[i] = その物の形（shape の並び）*/
function ownersOf(doc, items, segs) {
  return items.map((it) => boolPaths(doc, it).map((p) => { const f = flattenForBool(p.sps, segs); return shapeOf(f.polys, p.rule, f.srcs); }));
}
function inOwner(sh, x, y) { for (const s of sh) if (insideShape(s, x, y)) return true; return false; }

function boolOp(doc, items, how) {
  const segs = [], owners = ownersOf(doc, items, segs), K = owners.length;
  const A = arrange(owners.flat(), (x, y) => owners.map((o) => (inOwner(o, x, y) ? '1' : '0')).join('').replace(/^0+$/, ''));
  const bits = (f) => f.key.padStart(K, '0');
  const keep = {
    unite: (f) => !!f.key,
    intersect: (f) => !!f.key && !bits(f).includes('0'),
    minus_front: (f) => bits(f)[0] === '1' && !bits(f).slice(1).includes('1'),
    minus_back: (f) => bits(f)[K - 1] === '1' && !bits(f).slice(0, K - 1).includes('1'),
    exclude: (f) => (bits(f).split('').filter((c) => c === '1').length & 1) === 1,
  }[how];
  return loopsToSps(A, extractLoops(A, keep), segs);
}
/** 分割・シェイプ形成用の領域: [{sps, top（色を取る物の番号）, key, faces}] */
function divideRegions(doc, items) {
  const segs = [], owners = ownersOf(doc, items, segs);
  const A = arrange(owners.flat(), (x, y) => { const s = owners.map((o) => (inOwner(o, x, y) ? '1' : '0')).join(''); return s.includes('1') ? s : ''; });
  const regs = regionsOf(A).map((r) => {
    const sps = loopsToSps(A, extractLoops(A, (f, i) => r.faces.has(i)), segs, null, 0.05);
    return { sps, key: r.key, top: r.key.lastIndexOf('1'), faces: r.faces };
  }).filter((r) => r.sps.length);
  return { A, segs, regs };
}
/** 線のふち（線の幅の形）。sps を w の太さで（join・miter・cap・dash は線の設定と同じ意味）*/
function strokeOutline(sps, w, join = 'miter', miter = 10, cap = 'butt', dash = null, dashOffset = 0) {
  const segs = [], pieces = [];
  for (const sp of sps) {
    if (sp.n.length < 2) continue;
    const f = flattenForBool([sp], segs, 0.02, false);
    if (!f.polys.length) continue;
    const pts = f.polys[0];
    const lines = dash && dash.length && dash.some((x) => x > 0) ? dashPolyline(pts, sp.c, dash, dashOffset).map((p) => [p, false]) : [[pts, sp.c]];
    for (const [pl, closed] of lines) for (const q of strokePieces(pl, closed, w / 2, join, miter, cap)) pieces.push(shapeOf([q], 'nonzero'));
  }
  if (!pieces.length) return [];
  const A = arrange(pieces, (x, y) => { for (const s of pieces) if (insideShape(s, x, y)) return '1'; return ''; });
  return loopsToSps(A, extractLoops(A, (f) => !!f.key), []);
}
/** パスのオフセット（d > 0 で外、d < 0 で内）: 形の境目を 2|d| で太らせて足す／引く */
function offsetSps(paths, d, join = 'miter', miter = 4) {
  const segs = [], shapes = paths.map((p) => { const f = flattenForBool(p.sps, segs); return shapeOf(f.polys, p.rule, f.srcs); });
  // 1. まず形そのものの境目（重なりを解いた物）
  const A0 = arrange(shapes, (x, y) => (shapes.some((s) => insideShape(s, x, y)) ? '1' : ''));
  const rims = extractLoops(A0, (f) => !!f.key).map((l) => loopPts(A0, l));
  // 2. 境目を太らせた物
  const pieces = [];
  for (const pts of rims) for (const q of strokePieces(pts, true, Math.abs(d), join, miter)) pieces.push(shapeOf([q], 'nonzero'));
  const all = [...shapes, ...pieces];
  const A = arrange(all, (x, y) => {
    const inBase = shapes.some((s) => insideShape(s, x, y)), inRing = pieces.some((s) => insideShape(s, x, y));
    return (d > 0 ? inBase || inRing : inBase && !inRing) ? '1' : '';
  });
  return loopsToSps(A, extractLoops(A, (f) => !!f.key), segs);
}
