/* 線工房 Web — 幾何: 錨点・ベジェ・図形・曲線の当てはめ（exe の core/geom.py と同じ計算）

   錨点（メモリの形）: {x, y, ix, iy, ox, oy, s}（ハンドルは絶対座標、無いときは錨点と同じ）
   保存の形: [x, y] か [x, y, ix, iy, ox, oy, s(0/1)]（exe と同じ）
   パス: {n: [錨点…], c: 閉じているか}
*/
'use strict';

const KAPPA = 0.5522847498307936;
const EPS = 1e-9;

function N(x, y, ix, iy, ox, oy, s = false) {
  return { x, y, ix: ix ?? x, iy: iy ?? y, ox: ox ?? x, oy: oy ?? y, s: !!s };
}
function nodeFromList(v) { return v.length >= 6 ? N(v[0], v[1], v[2], v[3], v[4], v[5], !!v[6]) : N(v[0], v[1]); }
function hasIn(n) { return Math.abs(n.ix - n.x) > EPS || Math.abs(n.iy - n.y) > EPS; }
function hasOut(n) { return Math.abs(n.ox - n.x) > EPS || Math.abs(n.oy - n.y) > EPS; }
function nodeToList(n) {
  const r = (v) => Math.round(v * 1e4) / 1e4;
  const out = [r(n.x), r(n.y)];
  if (hasIn(n) || hasOut(n) || n.s) out.push(r(n.ix), r(n.iy), r(n.ox), r(n.oy), n.s ? 1 : 0);
  return out;
}
function nodeMove(n, dx, dy) { n.x += dx; n.y += dy; n.ix += dx; n.iy += dy; n.ox += dx; n.oy += dy; }
function nodeTransform(n, m) {
  [n.x, n.y] = M.map(m, n.x, n.y);
  [n.ix, n.iy] = M.map(m, n.ix, n.iy);
  [n.ox, n.oy] = M.map(m, n.ox, n.oy);
}
const nodeCopy = (n) => ({ ...n });
const spCopy = (sp) => ({ n: sp.n.map(nodeCopy), c: sp.c });
const spsCopy = (sps) => sps.map(spCopy);
function spsTransform(sps, m) { for (const sp of sps) for (const n of sp.n) nodeTransform(n, m); }
function spReverse(sp) {
  sp.n = sp.n.reverse().map((n) => ({ ...n, ix: n.ox, iy: n.oy, ox: n.ix, oy: n.iy }));
}
function spSegCount(sp) { const n = sp.n.length; return n < 2 ? 0 : (sp.c ? n : n - 1); }
function spSeg(sp, i) {
  const a = sp.n[i], b = sp.n[(i + 1) % sp.n.length];
  return [[a.x, a.y], [a.ox, a.oy], [b.ix, b.iy], [b.x, b.y]];
}

// ---- ベジェ -----------------------------------------------------------------------------
function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}
function splitCubic(p0, p1, p2, p3, t) {
  const l = (u, v) => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t];
  const a = l(p0, p1), bb = l(p1, p2), c = l(p2, p3), d = l(a, bb), e = l(bb, c), m = l(d, e);
  return [[p0, a, d, m], [m, e, c, p3]];
}
function quadRoots(a, b, c) {
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  return [(-b + s) / (2 * a), (-b - s) / (2 * a)];
}
function cubicBBox(p0, p1, p2, p3) {
  const xs = [p0[0], p3[0]], ys = [p0[1], p3[1]];
  for (const [k, arr] of [[0, xs], [1, ys]]) {
    const a = -p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k], b = 2 * (p0[k] - 2 * p1[k] + p2[k]), c = p1[k] - p0[k];
    for (const t of quadRoots(3 * a, 3 * b, 3 * c)) if (t > 0 && t < 1) arr.push(cubicPoint(p0, p1, p2, p3, t)[k]);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function unionBBox(boxes) {
  let o = null;
  for (const b of boxes) {
    if (!b) continue;
    o = o ? [Math.min(o[0], b[0]), Math.min(o[1], b[1]), Math.max(o[2], b[2]), Math.max(o[3], b[3])] : [...b];
  }
  return o;
}
function spsBBox(sps) {
  const boxes = [];
  for (const sp of sps) {
    if (!sp.n.length) continue;
    if (sp.n.length === 1) boxes.push([sp.n[0].x, sp.n[0].y, sp.n[0].x, sp.n[0].y]);
    for (let i = 0; i < spSegCount(sp); i++) boxes.push(cubicBBox(...spSeg(sp, i)));
  }
  return unionBBox(boxes);
}
function nearestOnCubic(seg, px, py, samples = 24) {
  let bt = 0, bd = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples, [x, y] = cubicPoint(...seg, t), d = (x - px) ** 2 + (y - py) ** 2;
    if (d < bd) { bt = t; bd = d; }
  }
  let step = 1 / samples;
  for (let k = 0; k < 18; k++) {
    step /= 2;
    for (const t of [bt - step, bt + step]) {
      if (t < 0 || t > 1) continue;
      const [x, y] = cubicPoint(...seg, t), d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bd) { bt = t; bd = d; }
    }
  }
  return { t: bt, d: Math.sqrt(bd), p: cubicPoint(...seg, bt) };
}
/** 区間 i の t に錨点を足す（形は変わらない）→ 足した番号 */
function insertNode(sp, i, t) {
  const n = sp.n.length, a = sp.n[i], b = sp.n[(i + 1) % n], seg = spSeg(sp, i);
  let nn;
  if (!hasOut(a) && !hasIn(b)) {
    nn = N(seg[0][0] + (seg[3][0] - seg[0][0]) * t, seg[0][1] + (seg[3][1] - seg[0][1]) * t);
  } else {
    const [l, r] = splitCubic(...seg, t);
    [a.ox, a.oy] = l[1];
    [b.ix, b.iy] = r[2];
    nn = N(l[3][0], l[3][1], l[2][0], l[2][1], r[1][0], r[1][1], true);
  }
  sp.n.splice(i + 1, 0, nn);
  return i + 1;
}

// ---- コマンド列 -------------------------------------------------------------------------
function toCmds(sps) {
  const out = [];
  for (const sp of sps) {
    if (!sp.n.length) continue;
    out.push(['M', sp.n[0].x, sp.n[0].y]);
    for (let i = 0; i < spSegCount(sp); i++) {
      const [p0, p1, p2, p3] = spSeg(sp, i);
      if (p1[0] === p0[0] && p1[1] === p0[1] && p2[0] === p3[0] && p2[1] === p3[1]) out.push(['L', p3[0], p3[1]]);
      else out.push(['C', p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]]);
    }
    if (sp.c) out.push(['Z']);
  }
  return out;
}
function fromCmds(cmds) {
  const sps = [];
  let cur = null, start = null;
  const ensure = () => { if (!cur && start) { cur = { n: [N(...start)], c: false }; sps.push(cur); } return cur; };
  for (const c of cmds) {
    const op = c[0];
    if (op === 'M') { cur = { n: [N(c[1], c[2])], c: false }; start = [c[1], c[2]]; sps.push(cur); }
    else if (op === 'L' && ensure()) cur.n.push(N(c[1], c[2]));
    else if (op === 'C' && ensure()) {
      const last = cur.n[cur.n.length - 1];
      last.ox = c[1]; last.oy = c[2];
      cur.n.push(N(c[5], c[6], c[3], c[4]));
    } else if (op === 'Q' && ensure()) {
      const last = cur.n[cur.n.length - 1], qx = c[1], qy = c[2], x = c[3], y = c[4];
      last.ox = last.x + 2 / 3 * (qx - last.x); last.oy = last.y + 2 / 3 * (qy - last.y);
      cur.n.push(N(x, y, x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y)));
    } else if (op === 'Z' && cur) {
      cur.c = true;
      if (cur.n.length > 1) {
        const a = cur.n[0], b = cur.n[cur.n.length - 1];
        if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) { a.ix = b.ix; a.iy = b.iy; cur.n.pop(); }
      }
      cur = null;
    }
  }
  for (const sp of sps) markSmooth(sp);
  return sps.filter((s) => s.n.length);
}
function markSmooth(sp) {
  for (const n of sp.n) {
    if (!(hasIn(n) && hasOut(n))) continue;
    const v1 = [n.x - n.ix, n.y - n.iy], v2 = [n.ox - n.x, n.oy - n.y];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    if (l1 > EPS && l2 > EPS) {
      const cross = (v1[0] * v2[1] - v1[1] * v2[0]) / (l1 * l2), dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
      n.s = Math.abs(cross) < 0.02 && dot > 0;
    }
  }
}
function cmdsPath2D(cmds) {
  const p = new Path2D();
  for (const c of cmds) {
    if (c[0] === 'M') p.moveTo(c[1], c[2]);
    else if (c[0] === 'L') p.lineTo(c[1], c[2]);
    else if (c[0] === 'C') p.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else if (c[0] === 'Q') p.quadraticCurveTo(c[1], c[2], c[3], c[4]);
    else if (c[0] === 'Z') p.closePath();
  }
  return p;
}
function spsPath2D(sps) { return cmdsPath2D(toCmds(sps)); }
/** パスの物の Path2D（形が変わるまで覚えておく） */
function itemPath2D(it) {
  if (!it._p2 || it._p2.e !== GEO_EPOCH) it._p2 = { e: GEO_EPOCH, p: spsPath2D(it.paths) };
  return it._p2.p;
}

// ---- 図形（exe の shape_subpaths と同じ）--------------------------------------------------
function rectSp(x, y, w, h, r = 0) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  const x0 = Math.min(x, x + w), x1 = Math.max(x, x + w), y0 = Math.min(y, y + h), y1 = Math.max(y, y + h);
  if (r <= EPS) return { n: [N(x0, y0), N(x1, y0), N(x1, y1), N(x0, y1)], c: true };
  const k = r * (1 - KAPPA);
  return { n: [
    N(x0 + r, y0, x0 + k, y0, null, null), N(x1 - r, y0, null, null, x1 - k, y0),
    N(x1, y0 + r, x1, y0 + k, null, null), N(x1, y1 - r, null, null, x1, y1 - k),
    N(x1 - r, y1, x1 - k, y1, null, null), N(x0 + r, y1, null, null, x0 + k, y1),
    N(x0, y1 - r, x0, y1 - k, null, null), N(x0, y0 + r, null, null, x0, y0 + k)], c: true };
}
function ellipseSp(cx, cy, rx, ry) {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return { n: [N(cx, cy - ry, cx - kx, cy - ry, cx + kx, cy - ry, true), N(cx + rx, cy, cx + rx, cy - ky, cx + rx, cy + ky, true),
    N(cx, cy + ry, cx + kx, cy + ry, cx - kx, cy + ry, true), N(cx - rx, cy, cx - rx, cy + ky, cx - rx, cy - ky, true)], c: true };
}
function polygonSp(cx, cy, r, sides) {
  sides = Math.max(3, sides | 0);
  const n = [];
  for (let i = 0; i < sides; i++) { const a = (-90 + 360 * i / sides) * Math.PI / 180; n.push(N(cx + r * Math.cos(a), cy + r * Math.sin(a))); }
  return { n, c: true };
}
function starSp(cx, cy, r1, r2, points) {
  points = Math.max(2, points | 0);
  const n = [];
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? r1 : r2, a = (-90 + 180 * i / points) * Math.PI / 180;
    n.push(N(cx + rr * Math.cos(a), cy + rr * Math.sin(a)));
  }
  return { n, c: true };
}
function roundCorners(sp, radius) {
  const n = sp.n.length;
  if (radius <= EPS || n < 3) return spCopy(sp);
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = sp.n[i];
    if (!sp.c && (i === 0 || i === n - 1)) { out.push(nodeCopy(p)); continue; }
    const a = sp.n[(i - 1 + n) % n], b = sp.n[(i + 1) % n];
    const v1 = [a.x - p.x, a.y - p.y], v2 = [b.x - p.x, b.y - p.y], l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    if (l1 < EPS || l2 < EPS) { out.push(nodeCopy(p)); continue; }
    const u1 = [v1[0] / l1, v1[1] / l1], u2 = [v2[0] / l2, v2[1] / l2];
    const ang = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
    if (ang < 1e-3 || Math.abs(ang - Math.PI) < 1e-3) { out.push(nodeCopy(p)); continue; }
    const d = Math.min(radius / Math.tan(ang / 2), l1 / 2, l2 / 2), reff = d * Math.tan(ang / 2);
    const h = 4 / 3 * Math.tan((Math.PI - ang) / 4) * reff;
    const s = [p.x + u1[0] * d, p.y + u1[1] * d], e = [p.x + u2[0] * d, p.y + u2[1] * d];
    out.push(N(s[0], s[1], null, null, s[0] - u1[0] * h, s[1] - u1[1] * h));
    out.push(N(e[0], e[1], e[0] - u2[0] * h, e[1] - u2[1] * h, null, null));
  }
  return { n: out, c: sp.c };
}
function shapeSubpaths(sh) {
  switch (sh.kind) {
    case 'rect': return [rectSp(sh.x, sh.y, sh.w, sh.h, sh.r || 0)];
    case 'ellipse': return [ellipseSp(sh.cx, sh.cy, sh.rx, sh.ry)];
    case 'polygon': return [roundCorners(polygonSp(sh.cx, sh.cy, sh.r, sh.sides || 6), sh.corner || 0)];
    case 'star': return [roundCorners(starSp(sh.cx, sh.cy, sh.r1, sh.r2, sh.points || 5), sh.corner || 0)];
    case 'line': return [{ n: [N(sh.x1, sh.y1), N(sh.x2, sh.y2)], c: false }];
  }
  throw new Error('不明な図形: ' + sh.kind);
}

// ---- 鉛筆: 点列 → ベジェ（Schneider の方法、exe の fit_curve と同じ）---------------------------
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop(), [ax, ay] = pts[i0], [bx, by] = pts[i1], dx = bx - ax, dy = by - ay, ln = Math.hypot(dx, dy);
    let best = -1, bi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const [px, py] = pts[i];
      const d = ln > EPS ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / ln : Math.hypot(px - ax, py - ay);
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps && bi > 0) { keep[bi] = true; stack.push([i0, bi], [bi, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const _norm = (v) => { const l = Math.hypot(v[0], v[1]); return l > EPS ? [v[0] / l, v[1] / l] : [0, 0]; };
function _chord(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const tot = u[u.length - 1] || 1;
  return u.map((x) => x / tot);
}
function _bfit(pts, u, t1, t2) {
  const p0 = pts[0], p3 = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  pts.forEach((p, i) => {
    const t = u[i], mt = 1 - t, b0 = mt ** 3, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t ** 3;
    const a1 = [t1[0] * b1, t1[1] * b1], a2 = [t2[0] * b2, t2[1] * b2];
    c00 += a1[0] * a1[0] + a1[1] * a1[1]; c01 += a1[0] * a2[0] + a1[1] * a2[1]; c11 += a2[0] * a2[0] + a2[1] * a2[1];
    const tx = p[0] - (p0[0] * (b0 + b1) + p3[0] * (b2 + b3)), ty = p[1] - (p0[1] * (b0 + b1) + p3[1] * (b2 + b3));
    x0 += a1[0] * tx + a1[1] * ty; x1 += a2[0] * tx + a2[1] * ty;
  });
  const det = c00 * c11 - c01 * c01, sl = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  let al, ar;
  if (Math.abs(det) > 1e-12) { al = (x0 * c11 - c01 * x1) / det; ar = (c00 * x1 - c01 * x0) / det; } else al = ar = sl / 3;
  if (al < sl * 1e-6 || ar < sl * 1e-6) al = ar = sl / 3;
  return [p0, [p0[0] + t1[0] * al, p0[1] + t1[1] * al], [p3[0] + t2[0] * ar, p3[1] + t2[1] * ar], p3];
}
function _maxErr(pts, u, bez) {
  let w = 0, wi = pts.length >> 1;
  pts.forEach((p, i) => { const q = cubicPoint(...bez, u[i]), d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d > w) { w = d; wi = i; } });
  return [w, wi];
}
function _fit(pts, t1, t2, err, out, depth = 0) {
  if (pts.length === 2) {
    const d = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) / 3;
    out.push([pts[0], [pts[0][0] + t1[0] * d, pts[0][1] + t1[1] * d], [pts[1][0] + t2[0] * d, pts[1][1] + t2[1] * d], pts[1]]);
    return;
  }
  const u = _chord(pts);
  const bez = _bfit(pts, u, t1, t2);
  let [e, si] = _maxErr(pts, u, bez);
  if (e < err * err || depth > 40) { out.push(bez); return; }
  si = Math.max(1, Math.min(pts.length - 2, si));
  const tc = _norm([pts[si - 1][0] - pts[si + 1][0], pts[si - 1][1] - pts[si + 1][1]]);
  _fit(pts.slice(0, si + 1), t1, tc, err, out, depth + 1);
  _fit(pts.slice(si), [-tc[0], -tc[1]], t2, err, out, depth + 1);
}
function fitCurve(points, error = 2, closed = false) {
  const pts = [];
  for (const p of points) if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 0.5) pts.push([p[0], p[1]]);
  if (pts.length < 2) return { n: pts.length ? [N(...pts[0])] : [], c: false };
  if (closed && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) > 0.5) pts.push(pts[0]);
  if (pts.length === 2) return { n: [N(...pts[0]), N(...pts[1])], c: false };
  let t1, t2;
  if (closed) { t1 = _norm([pts[1][0] - pts[pts.length - 2][0], pts[1][1] - pts[pts.length - 2][1]]); t2 = [-t1[0], -t1[1]]; }
  else { t1 = _norm([pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]]); t2 = _norm([pts[pts.length - 2][0] - pts[pts.length - 1][0], pts[pts.length - 2][1] - pts[pts.length - 1][1]]); }
  const bz = [];
  _fit(pts, t1, t2, error, bz);
  const nodes = [N(...bz[0][0])];
  for (const b of bz) {
    const last = nodes[nodes.length - 1];
    last.ox = b[1][0]; last.oy = b[1][1];
    nodes.push(N(b[3][0], b[3][1], b[2][0], b[2][1]));
  }
  if (closed && nodes.length > 2) { const last = nodes.pop(); nodes[0].ix = last.ix; nodes[0].iy = last.iy; }
  const sp = { n: nodes, c: closed };
  markSmooth(sp);
  return sp;
}
function constrainAngle(x0, y0, x, y, step = 45) {
  const dx = x - x0, dy = y - y0, ln = Math.hypot(dx, dy);
  if (ln < EPS) return [x, y];
  const st = step * Math.PI / 180, a = Math.round(Math.atan2(dy, dx) / st) * st;
  return [x0 + ln * Math.cos(a), y0 + ln * Math.sin(a)];
}
