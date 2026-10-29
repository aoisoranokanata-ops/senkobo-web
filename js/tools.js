/* 線工房 Web — 道具。どれも {down, drag, up, cancel, hover, dbl, paint, activate, deactivate} を持つ（無い物は呼ばない）。
   座標は文書（pt）。lp は画面（CSS 画素）。変形中は元の形を覚えておき、毎回そこから計算し直す（exe と同じ考え方）。
*/
'use strict';

const TOOL_LABEL = {
  select: '選択', direct: 'ダイレクト選択', pen: 'ペン', pencil: '鉛筆', rect: '長方形', roundrect: '角丸長方形',
  ellipse: '楕円', polygon: '多角形', star: 'スター', line: '直線', text: '文字', eyedropper: 'スポイト', hand: '手のひら',
  gradient: 'グラデーション', artboard: 'アートボード', shapebuilder: 'シェイプ形成', width: '線幅',
};

function saveItems(items) { return items.map((it) => JSON.stringify(packItem(it))); }
function loadInto(it, s) {
  const d = unpackItem(JSON.parse(s));
  for (const k of Object.keys(it)) delete it[k];
  Object.assign(it, d);
}
function moveThreshold(e) { return e && e.pointerType === 'touch' ? 8 : 3; }

/** 外枠を (dx, dy) 動かしたときの、四隅と中心の吸着を合わせた補正後の移動量 */
function snapDelta(view, b, dx, dy, exclude) {
  if (!view.app.settings.snap || !b) return [dx, dy];
  const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]], [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]];
  let best = null, bd = Infinity, mark = null;
  for (const [px, py] of pts) {
    const [sx, sy] = view.snap(px + dx, py + dy, exclude);
    const cx = sx - (px + dx), cy = sy - (py + dy), d = Math.hypot(cx, cy);
    if ((cx || cy) && d < bd) { bd = d; best = [cx, cy]; mark = [sx, sy]; }
  }
  view.snapMark = mark;
  return best ? [dx + best[0], dy + best[1]] : [dx, dy];
}
function excludeIds(doc, items) { const s = new Set(); for (const it of items) for (const x of doc.iterTree([it])) s.add(x.id); return s; }

// ---- 選択（移動・拡大縮小・回転）---------------------------------------------------------------
class SelectTool {
  constructor(app) { this.app = app; this.st = null; this.showsBBox = true; }
  get doc() { return this.app.doc; }
  down(x, y, e, lp) {
    const app = this.app, view = app.view, doc = this.doc;
    let sel = app.selection();
    const h = sel.length ? view.hitHandle(lp.x, lp.y) : null;
    if (h) {
      const b = selectionBBox(sel);
      this.st = { mode: h === 'rot' ? 'rot' : 'scale', h, b, x0: x, y0: y, items: sel, saved: saveItems(sel), moved: false, e0: e };
      if (h === 'rot') this.st.a0 = Math.atan2(y - (b[1] + b[3]) / 2, x - (b[0] + b[2]) / 2);
      doc.begin(h === 'rot' ? '回転' : '拡大・縮小');
      return;
    }
    const hit = view.hitTop(x, y);
    if (hit) {
      if (e.shiftKey) {
        if (sel.includes(hit)) { app.select(sel.filter((s) => s !== hit)); this.st = null; return; }
        sel = [...sel, hit];
      } else if (!sel.includes(hit)) sel = [hit];
      app.select(sel);
      doc.begin('移動');
      if (e.altKey) { sel = OPS.duplicate(doc, sel); app.select(sel); }
      this.st = { mode: 'move', x0: x, y0: y, items: sel, saved: saveItems(sel), b: selectionBBox(sel), ex: excludeIds(doc, sel), moved: false, e0: e, alt: e.altKey };
      return;
    }
    if (!e.shiftKey) app.select([]);
    this.st = { mode: 'marquee', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, moved: false, e0: e };
  }
  drag(x, y, e, lp) {
    const st = this.st;
    if (!st) return;
    const view = this.app.view;
    if (!st.moved) {
      const [sx, sy] = view.toScreen(st.x0, st.y0);
      if (Math.hypot(lp.x - sx, lp.y - sy) < moveThreshold(st.e0)) return;
      st.moved = true;
    }
    const doc = this.doc;
    if (st.mode === 'marquee') { st.x1 = x; st.y1 = y; view.request(); return; }
    st.items.forEach((it, i) => loadInto(it, st.saved[i]));
    doc.touch();
    let m;
    if (st.mode === 'move') {
      let dx = x - st.x0, dy = y - st.y0;
      if (e.shiftKey) [dx, dy] = constrainAngle(0, 0, dx, dy);
      [dx, dy] = snapDelta(view, st.b, dx, dy, st.ex);
      m = M.t(dx, dy);
    } else if (st.mode === 'scale') {
      const b = st.b, h = st.h, center = e.altKey;
      const ax = center ? (b[0] + b[2]) / 2 : h.includes('w') ? b[2] : b[0];
      const ay = center ? (b[1] + b[3]) / 2 : h.includes('n') ? b[3] : b[1];
      const ox = h.includes('w') ? b[0] : b[2], oy = h.includes('n') ? b[1] : b[3];
      let sx = h.includes('e') || h.includes('w') ? (x - ax) / ((ox - ax) || 1e-9) : 1;
      let sy = h.includes('n') || h.includes('s') ? (y - ay) / ((oy - ay) || 1e-9) : 1;
      if (Math.abs(b[2] - b[0]) < 1e-6) sx = 1;
      if (Math.abs(b[3] - b[1]) < 1e-6) sy = 1;
      const keep = e.shiftKey !== !!this.app.settings.keepRatio;
      if (keep && h.length === 2) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
      m = M.s(sx || 1e-4, sy || 1e-4, ax, ay);
    } else {
      const b = st.b, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      let deg = (Math.atan2(y - cy, x - cx) - st.a0) * 180 / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      st.deg = deg;
      m = M.r(deg, cx, cy);
    }
    for (const it of st.items) itemTransform(it, m, st.mode === 'scale' && this.app.settings.scaleStrokes);
    doc.touch();
    view.request();
    this.app.panels.refreshSoon();
  }
  up() {
    const st = this.st;
    this.st = null;
    if (!st) return;
    const doc = this.doc, app = this.app;
    if (st.mode === 'marquee') {
      if (st.moved) {
        const r = [Math.min(st.x0, st.x1), Math.min(st.y0, st.y1), Math.max(st.x0, st.x1), Math.max(st.y0, st.y1)];
        const got = app.view.itemsInRect(r);
        app.select(st.add ? [...new Set([...app.selection(), ...got])] : got);
      }
      app.view.request();
      return;
    }
    if (!st.moved && !st.alt) doc.cancel(); else doc.commit();
    app.view.snapMark = null;
  }
  cancel() { if (this.st && this.st.mode !== 'marquee') this.doc.cancel(); this.st = null; }
  hover(x, y) { const h = this.app.view.hitTop(x, y); if (h !== this.app.view.hover) { this.app.view.hover = h; this.app.view.request(); } }
  dbl(x, y) {
    const leaf = this.app.view.hitLeaf(x, y);
    if (leaf && leaf.kind === 'text') { this.app.setTool('text'); this.app.editText(leaf); }
    else if (leaf && leaf.kind === 'path') { this.app.setTool('direct'); this.app.select([leaf]); }
  }
  paint(ctx) {
    const st = this.st;
    if (st && st.mode === 'marquee' && st.moved) {
      const [x0, y0] = this.app.view.toScreen(st.x0, st.y0), [x1, y1] = this.app.view.toScreen(st.x1, st.y1);
      ctx.fillStyle = 'rgba(79,124,255,0.12)'; ctx.strokeStyle = '#4f7cff'; ctx.setLineDash([4, 3]);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0); ctx.setLineDash([]);
    }
    if (st && st.mode === 'rot' && st.moved) {
      const [sx, sy] = this.app.view.toScreen(st.b[2], st.b[1]);
      ctx.fillStyle = '#fff'; ctx.font = '12px system-ui'; ctx.fillText(`${Math.round(st.deg)}°`, sx + 10, sy - 10);
    }
  }
}

// ---- ダイレクト選択（錨点・ハンドル）-----------------------------------------------------------
class DirectTool {
  constructor(app) { this.app = app; this.st = null; this.showsAnchors = true; }
  get doc() { return this.app.doc; }
  leafPaths() {
    const out = [];
    for (const it of this.app.selection()) for (const p of this.doc.iterTree([it])) if (p.kind === 'path' && !this.doc.isLocked(p)) out.push(p);
    return out;
  }
  hitHandle(lp) {
    const app = this.app, view = app.view, r = app.touchy ? 14 : 8;
    for (const p of this.leafPaths()) for (let si = 0; si < p.paths.length; si++) {
      const sp = p.paths[si], n = sp.n.length;
      for (let ni = 0; ni < n; ni++) {
        const nd = sp.n[ni];
        const on = app.anchorSel.has(`${p.id}:${si}:${ni}`);
        const prevOn = app.anchorSel.has(`${p.id}:${si}:${(ni - 1 + n) % n}`) && (ni > 0 || sp.c);
        const nextOn = app.anchorSel.has(`${p.id}:${si}:${(ni + 1) % n}`) && (ni < n - 1 || sp.c);
        for (const [show, which] of [[on || prevOn, 'in'], [on || nextOn, 'out']]) {
          if (!show || !(which === 'in' ? hasIn(nd) : hasOut(nd))) continue;
          const [qx, qy] = view.toScreen(which === 'in' ? nd.ix : nd.ox, which === 'in' ? nd.iy : nd.oy);
          if (Math.hypot(qx - lp.x, qy - lp.y) <= r) return { p, si, ni, which };
        }
      }
    }
    return null;
  }
  hitAnchor(lp, paths) {
    const view = this.app.view, r = this.app.touchy ? 14 : 7;
    let best = null, bd = r;
    for (const p of paths) p.paths.forEach((sp, si) => sp.n.forEach((nd, ni) => {
      const [ax, ay] = view.toScreen(nd.x, nd.y), d = Math.hypot(ax - lp.x, ay - lp.y);
      if (d <= bd) { bd = d; best = { p, si, ni }; }
    }));
    return best;
  }
  down(x, y, e, lp) {
    const app = this.app, doc = this.doc;
    const hh = this.hitHandle(lp);
    if (hh) {
      doc.begin('ハンドル');
      this.st = { mode: 'handle', ...hh, saved: saveItems([hh.p]), x0: x, y0: y, moved: false, e0: e };
      return;
    }
    let ha = this.hitAnchor(lp, this.leafPaths());
    if (!ha) {
      const leaf = app.view.hitLeaf(x, y);
      if (leaf && leaf.kind === 'path') ha = this.hitAnchor(lp, [leaf]);
    }
    if (ha) {
      const key = `${ha.p.id}:${ha.si}:${ha.ni}`;
      if (!app.selection().includes(ha.p)) app.select(e.shiftKey ? [...app.selection(), ha.p] : [ha.p], true);
      if (e.shiftKey) { if (app.anchorSel.has(key)) app.anchorSel.delete(key); else app.anchorSel.add(key); }
      else if (!app.anchorSel.has(key)) { app.anchorSel.clear(); app.anchorSel.add(key); }
      this.beginAnchors(x, y, e);
      return;
    }
    const leaf = app.view.hitLeaf(x, y);
    if (leaf) {
      if (!app.selection().includes(leaf)) app.select(e.shiftKey ? [...app.selection(), leaf] : [leaf], true);
      if (leaf.kind === 'path') {
        // 線（区間）を押したら、そのパスの錨点を全部つかむ
        app.anchorSel.clear();
        for (const p of this.leafPaths()) p.paths.forEach((sp, si) => sp.n.forEach((_, ni) => app.anchorSel.add(`${p.id}:${si}:${ni}`)));
        this.beginAnchors(x, y, e);
      } else {
        const sel = app.selection();
        doc.begin('移動');
        this.st = { mode: 'items', items: sel, saved: saveItems(sel), x0: x, y0: y, moved: false, e0: e };
      }
      return;
    }
    if (!e.shiftKey) { app.select([]); app.anchorSel.clear(); }
    this.st = { mode: 'marquee', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, moved: false, e0: e };
  }
  beginAnchors(x, y, e) {
    const app = this.app, doc = this.doc;
    const items = [...new Set([...app.anchorSel].map((k) => doc.find(+k.split(':')[0])).filter(Boolean))];
    doc.begin('錨点の移動');
    this.st = { mode: 'anchors', items, saved: saveItems(items), x0: x, y0: y, moved: false, e0: e, ex: new Set(items.map((i) => i.id)) };
    this.app.view.request();
  }
  drag(x, y, e, lp) {
    const st = this.st;
    if (!st) return;
    const view = this.app.view, doc = this.doc;
    if (!st.moved) {
      const [sx, sy] = view.toScreen(st.x0, st.y0);
      if (Math.hypot(lp.x - sx, lp.y - sy) < moveThreshold(st.e0)) return;
      st.moved = true;
    }
    if (st.mode === 'marquee') { st.x1 = x; st.y1 = y; view.request(); return; }
    if (st.mode === 'handle') {
      loadInto(st.p, st.saved[0]); doc.touch();
      dropShape(st.p);
      const nd = st.p.paths[st.si].n[st.ni];
      let [hx, hy] = view.snap(x, y, new Set([st.p.id]));
      if (e.shiftKey) [hx, hy] = constrainAngle(nd.x, nd.y, hx, hy);
      if (e.altKey) nd.s = false;
      if (st.which === 'in') { nd.ix = hx; nd.iy = hy; } else { nd.ox = hx; nd.oy = hy; }
      if (nd.s) {
        // なめらかな点: 反対側のハンドルを一直線に保つ（長さはそのまま）
        const [ox, oy] = st.which === 'in' ? [nd.ox, nd.oy] : [nd.ix, nd.iy];
        const L = Math.hypot(ox - nd.x, oy - nd.y), dx = nd.x - hx, dy = nd.y - hy, l = Math.hypot(dx, dy);
        if (l > 1e-9 && L > 1e-9) {
          const px = nd.x + dx / l * L, py = nd.y + dy / l * L;
          if (st.which === 'in') { nd.ox = px; nd.oy = py; } else { nd.ix = px; nd.iy = py; }
        }
      }
      doc.touch(); view.request();
      return;
    }
    st.items.forEach((it, i) => loadInto(it, st.saved[i]));
    doc.touch();
    let dx = x - st.x0, dy = y - st.y0;
    if (e.shiftKey) [dx, dy] = constrainAngle(0, 0, dx, dy);
    if (st.mode === 'items') {
      for (const it of st.items) itemTransform(it, M.t(dx, dy));
    } else {
      // つかんだ点を吸着させる
      const first = [...this.app.anchorSel][0];
      if (first) {
        const [id, si, ni] = first.split(':').map(Number), p = doc.find(id), nd = p && p.paths[si] && p.paths[si].n[ni];
        if (nd) { const [sx, sy] = view.snap(nd.x + dx, nd.y + dy, st.ex); dx = sx - nd.x; dy = sy - nd.y; }
      }
      for (const k of this.app.anchorSel) {
        const [id, si, ni] = k.split(':').map(Number), p = doc.find(id);
        if (!p || !p.paths[si] || !p.paths[si].n[ni]) continue;
        dropShape(p);
        nodeMove(p.paths[si].n[ni], dx, dy);
      }
    }
    doc.touch(); view.request();
    this.app.panels.refreshSoon();
  }
  up() {
    const st = this.st, app = this.app;
    this.st = null;
    if (!st) return;
    if (st.mode === 'marquee') {
      if (st.moved) {
        const r = [Math.min(st.x0, st.x1), Math.min(st.y0, st.y1), Math.max(st.x0, st.x1), Math.max(st.y0, st.y1)];
        if (!st.add) app.anchorSel.clear();
        const items = new Set(st.add ? app.selection() : []);
        for (const p of this.doc.iterTree()) {
          if (p.kind !== 'path' || !this.doc.isVisible(p) || this.doc.isLocked(p)) continue;
          p.paths.forEach((sp, si) => sp.n.forEach((nd, ni) => {
            if (nd.x >= r[0] && nd.x <= r[2] && nd.y >= r[1] && nd.y <= r[3]) { app.anchorSel.add(`${p.id}:${si}:${ni}`); items.add(p); }
          }));
        }
        app.select([...items], true);
      }
      app.view.request();
      return;
    }
    if (!st.moved) this.doc.cancel(); else this.doc.commit();
    app.view.snapMark = null;
  }
  cancel() { if (this.st && this.st.mode !== 'marquee') this.doc.cancel(); this.st = null; }
  hover(x, y) { const h = this.app.view.hitLeaf(x, y); if (h !== this.app.view.hover) { this.app.view.hover = h; this.app.view.request(); } }
  /** ダブルタップ: 角の点 ⇔ なめらかな点 */
  dbl(x, y, e, lp) {
    const ha = this.hitAnchor(lp, this.leafPaths());
    if (!ha) return;
    this.doc.edit('点の切り替え', () => {
      dropShape(ha.p);
      toggleSmooth(ha.p.paths[ha.si], ha.ni);
      this.doc.touch();
    });
  }
  paint(ctx) { SelectTool.prototype.paint.call(this, ctx); }
}
function toggleSmooth(sp, i) {
  const nd = sp.n[i], n = sp.n.length;
  if (hasIn(nd) || hasOut(nd)) { nd.ix = nd.ox = nd.x; nd.iy = nd.oy = nd.y; nd.s = false; return; }
  const a = sp.n[(i - 1 + n) % n], b = sp.n[(i + 1) % n];
  const first = !sp.c && i === 0, last = !sp.c && i === n - 1;
  const pa = first ? [nd.x, nd.y] : [a.x, a.y], pb = last ? [nd.x, nd.y] : [b.x, b.y];
  let tx = pb[0] - pa[0], ty = pb[1] - pa[1];
  const l = Math.hypot(tx, ty);
  if (l < 1e-9) return;
  tx /= l; ty /= l;
  const la = first ? 0 : Math.hypot(a.x - nd.x, a.y - nd.y) / 3, lb = last ? 0 : Math.hypot(b.x - nd.x, b.y - nd.y) / 3;
  nd.ix = nd.x - tx * la; nd.iy = nd.y - ty * la;
  nd.ox = nd.x + tx * lb; nd.oy = nd.y + ty * lb;
  nd.s = true;
}

// ---- ペン --------------------------------------------------------------------------------
class PenTool {
  constructor(app) { this.app = app; this.cur = null; this.st = null; this.mouse = null; this.showsAnchors = true; }
  get doc() { return this.app.doc; }
  path() { const p = this.cur ? this.doc.find(this.cur) : null; if (!p || p.kind !== 'path' || !p.paths.length) { this.cur = null; return null; } return p; }
  down(x, y, e, lp) {
    const doc = this.doc, view = this.app.view;
    let p = this.path();
    const sp = p && p.paths[0];
    if (sp && sp.c) { this.cur = null; p = null; }
    if (p) {
      const last = sp.n[sp.n.length - 1];
      if (e.shiftKey) [x, y] = constrainAngle(last.x, last.y, x, y);
      else [x, y] = view.snap(x, y, new Set([p.id]));
      const [fx, fy] = view.toScreen(sp.n[0].x, sp.n[0].y);
      if (sp.n.length >= 2 && Math.hypot(fx - lp.x, fy - lp.y) <= (this.app.touchy ? 16 : 8)) {
        doc.begin('パスを閉じる');
        sp.c = true;
        doc.touch();
        this.st = { node: sp.n[0], x0: sp.n[0].x, y0: sp.n[0].y, moved: false, e0: e, close: true };
        return;
      }
      doc.begin('錨点の追加');
      sp.n.push(N(x, y));
      doc.touch();
      this.st = { node: sp.n[sp.n.length - 1], x0: x, y0: y, moved: false, e0: e };
    } else {
      [x, y] = view.snap(x, y);
      doc.begin('ペン');
      p = makePath([{ n: [N(x, y)], c: false }], this.app.newItemStyle());
      doc.addItem(p);
      this.cur = p.id;
      this.app.select([p], true);
      this.st = { node: p.paths[0].n[0], x0: x, y0: y, moved: false, e0: e };
    }
    this.app.anchorSel.clear();
    this.app.view.request();
  }
  drag(x, y, e, lp) {
    const st = this.st;
    if (!st) return;
    const [sx, sy] = this.app.view.toScreen(st.x0, st.y0);
    if (!st.moved && Math.hypot(lp.x - sx, lp.y - sy) < moveThreshold(st.e0)) return;
    st.moved = true;
    const nd = st.node;
    if (e.shiftKey) [x, y] = constrainAngle(nd.x, nd.y, x, y);
    nd.ox = x; nd.oy = y; nd.ix = 2 * nd.x - x; nd.iy = 2 * nd.y - y; nd.s = true;
    this.doc.touch();
    this.app.view.request();
  }
  up() {
    if (!this.st) return;
    const close = this.st.close;
    this.st = null;
    this.doc.commit();
    if (close) { this.cur = null; this.app.toolOptionsChanged(); }
    this.app.toolOptionsChanged();
  }
  cancel() { if (this.st) { this.doc.cancel(); this.st = null; } }
  hover(x, y) { this.mouse = [x, y]; if (this.path()) this.app.view.request(); }
  /** 描きかけを終える（1 点だけなら消す） */
  finish() {
    const p = this.path();
    this.cur = null;
    if (p && p.paths[0].n.length < 2) this.doc.edit('ペン', () => this.doc.remove(p));
    this.app.toolOptionsChanged();
    this.app.view.request();
  }
  deactivate() { this.finish(); }
  paint(ctx) {
    const p = this.path();
    if (!p || this.st || !this.mouse) return;
    const sp = p.paths[0];
    if (sp.c) return;
    const last = sp.n[sp.n.length - 1], view = this.app.view;
    const [ax, ay] = view.toScreen(last.x, last.y), [bx, by] = view.toScreen(...this.mouse);
    const [ox, oy] = view.toScreen(last.ox, last.oy);
    ctx.strokeStyle = '#4f7cff'; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.bezierCurveTo(ox, oy, bx, by, bx, by); ctx.stroke();
    const [fx, fy] = view.toScreen(sp.n[0].x, sp.n[0].y);
    if (sp.n.length >= 2 && Math.hypot(fx - bx, fy - by) <= 8) { ctx.beginPath(); ctx.arc(fx, fy, 7, 0, Math.PI * 2); ctx.stroke(); }
  }
}

// ---- 鉛筆 --------------------------------------------------------------------------------
class PencilTool {
  constructor(app) { this.app = app; this.pts = null; this.showsBBox = false; }
  get doc() { return this.app.doc; }
  down(x, y) { this.pts = [[x, y]]; }
  drag(x, y) { if (this.pts) { this.pts.push([x, y]); this.app.view.request(); } }
  up() {
    const pts = this.pts, app = this.app, view = app.view;
    this.pts = null;
    if (!pts || pts.length < 2) return;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len * view.zoom < 4) return;
    const first = pts[0], last = pts[pts.length - 1];
    const closed = pts.length > 8 && Math.hypot(first[0] - last[0], first[1] - last[1]) * view.zoom < (app.touchy ? 18 : 12) && len * view.zoom > 60;
    const sp = fitCurve(pts, Math.max(0.05, (app.settings.pencilSmooth ?? 3) / view.zoom), closed);
    if (sp.n.length < 2) return;
    const st = app.newItemStyle();
    if (!st.stroke) st.stroke = hexColor('#000000', this.doc.data.color_mode === 'cmyk');
    if (!closed) st.fill = null;
    this.doc.edit('鉛筆', () => { const p = makePath([sp], st); this.doc.addItem(p); app.select([p], true); });
  }
  cancel() { this.pts = null; }
  paint(ctx) {
    if (!this.pts) return;
    const v = this.app.view, st = this.app.curStyle;
    ctx.strokeStyle = st.stroke ? colorCSS(st.stroke) : '#000';
    ctx.lineWidth = Math.max(1, (st.width || 1) * v.zoom);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    this.pts.forEach(([x, y], i) => { const [sx, sy] = v.toScreen(x, y); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

// ---- 図形 --------------------------------------------------------------------------------
class ShapeTool {
  constructor(app, kind) { this.app = app; this.kind = kind; this.st = null; }
  get doc() { return this.app.doc; }
  down(x, y, e) {
    [x, y] = this.app.view.snap(x, y);
    this.st = { x0: x, y0: y, item: null, e0: e };
  }
  shape(x, y, e) {
    const S = this.app.settings, st = this.st, k = this.kind;
    let { x0, y0 } = st;
    let dx = x - x0, dy = y - y0;
    const square = e.shiftKey !== !!S.keepRatio;
    if (k === 'line') {
      if (e.shiftKey) [x, y] = constrainAngle(x0, y0, x, y);
      return { kind: 'line', x1: x0, y1: y0, x2: x, y2: y };
    }
    if (k === 'polygon' || k === 'star') {
      // 中心から
      const r = Math.hypot(dx, dy);
      let deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
      if (square) deg = 0;
      const sh = k === 'polygon' ? { kind: 'polygon', cx: x0, cy: y0, r, sides: S.sides || 6, corner: 0 }
        : { kind: 'star', cx: x0, cy: y0, r1: r, r2: r * (S.starRatio || 0.5), points: S.points || 5, corner: 0 };
      return { sh, matrix: Math.abs(deg) > 1e-6 ? M.r(deg, x0, y0) : null };
    }
    if (square) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * s; dy = Math.sign(dy || 1) * s; }
    if (e.altKey) { x0 -= dx; y0 -= dy; dx *= 2; dy *= 2; }
    const bx = Math.min(x0, x0 + dx), by = Math.min(y0, y0 + dy), w = Math.abs(dx), h = Math.abs(dy);
    if (k === 'ellipse') return { kind: 'ellipse', cx: bx + w / 2, cy: by + h / 2, rx: w / 2, ry: h / 2 };
    return { kind: 'rect', x: bx, y: by, w, h, r: k === 'roundrect' ? (S.cornerRadius ?? 12) : 0 };
  }
  drag(x, y, e, lp) {
    const st = this.st;
    if (!st) return;
    const view = this.app.view;
    if (!st.item) {
      const [sx, sy] = view.toScreen(st.x0, st.y0);
      if (Math.hypot(lp.x - sx, lp.y - sy) < moveThreshold(st.e0)) return;
      this.doc.begin(TOOL_LABEL[this.kind]);
      st.item = makeShape({ kind: 'rect', x: x, y: y, w: 0, h: 0 }, this.app.newItemStyle());
      if (this.kind === 'line') { st.item.style.fill = null; if (!st.item.style.stroke) st.item.style.stroke = hexColor('#000000', this.doc.data.color_mode === 'cmyk'); }
      this.doc.addItem(st.item);
    }
    if (this.kind !== 'line' && this.kind !== 'polygon' && this.kind !== 'star') [x, y] = view.snap(x, y, new Set([st.item.id]));
    const r = this.shape(x, y, e);
    const sh = r.sh || r;
    st.item.shape = sh;
    if (r.matrix) st.item.shape_matrix = M.round(r.matrix); else delete st.item.shape_matrix;
    rebuildShape(st.item);
    this.doc.touch();
    view.request();
  }
  up() {
    const st = this.st;
    this.st = null;
    if (!st || !st.item) return;
    this.doc.commit();
    this.app.select([st.item]);
  }
  cancel() { if (this.st && this.st.item) this.doc.cancel(); this.st = null; }
}

// ---- 文字 --------------------------------------------------------------------------------
class TextTool {
  constructor(app) { this.app = app; this.st = null; }
  get doc() { return this.app.doc; }
  down(x, y, e) {
    if (this.app.editing) this.app.endTextEdit();
    const hit = this.app.view.hitLeaf(x, y);
    // パスの線の近くを押したら: 開いたパス → パス上文字、閉じたパス → その形のエリア内文字
    let onPath = null;
    if (hit && hit.kind === 'path' && this.app.settings.textOnShapes !== false && hit.paths.length) {
      _hitCtx.lineWidth = 2 * this.app.view.tol(this.app.touchy ? 10 : 6);
      if (_hitCtx.isPointInStroke(spsPath2D(hit.paths), x, y)) onPath = hit;
    }
    this.st = { x0: x, y0: y, x1: x, y1: y, hit: hit && hit.kind === 'text' ? hit : null, onPath, moved: false, e0: e };
  }
  drag(x, y, e, lp) {
    const st = this.st;
    if (!st) return;
    const [sx, sy] = this.app.view.toScreen(st.x0, st.y0);
    if (!st.moved && Math.hypot(lp.x - sx, lp.y - sy) < 10) return;
    st.moved = true; st.x1 = x; st.y1 = y;
    this.app.view.request();
  }
  up() {
    const st = this.st, app = this.app;
    this.st = null;
    if (!st) return;
    if (st.hit && !st.moved) { app.editText(st.hit); return; }
    // 文字の色は今の塗り。ただし白・なしだと見えないので黒に
    const f = app.curStyle.fill, white = !f || isGradient(f) || colorRGB(f).every((v) => v > 0.97);
    const S = app.settings, style = newStyle(white ? hexColor('#000000', this.doc.data.color_mode === 'cmyk') : paintCopy(f), null);
    const it = makeText('', S.font || 'Yu Gothic', S.fontSize || 24, style);
    if (S.fontStyle) it.font_style = S.fontStyle;
    if (S.vertical) it.vertical = true;
    if (st.onPath && !st.moved) {
      const p = st.onPath, closed = p.paths.some((sp) => sp.c);
      it.text_kind = closed ? 'area' : 'path';
      it.frame = closed ? spsCopy(p.paths.filter((sp) => sp.c)) : [spCopy(p.paths[0])];
      if (!closed) delete it.vertical;
      this.doc.begin('文字');
      const parent = this.doc.parentOf(p) || this.doc.currentLayer(), idx = parent.children.indexOf(p);
      this.doc.remove(p);
      this.doc.addItem(it, parent, Math.max(0, idx));
      app.select([it], true);
      app.editText(it, true);
      toast(closed ? '形の中に文字を入れます' : 'パスに沿って文字を並べます');
      return;
    }
    if (st.moved) {
      const x0 = Math.min(st.x0, st.x1), y0 = Math.min(st.y0, st.y1), w = Math.abs(st.x1 - st.x0), h = Math.abs(st.y1 - st.y0);
      it.text_kind = 'area';
      it.frame = [rectSp(0, 0, w, h)];
      it.matrix = M.t(x0, y0);
    } else it.matrix = M.t(st.x0, st.y0);
    this.doc.begin('文字');
    this.doc.addItem(it);
    app.select([it], true);
    app.editText(it, true);
  }
  cancel() { this.st = null; }
  paint(ctx) {
    const st = this.st;
    if (!st || !st.moved) return;
    const v = this.app.view, [x0, y0] = v.toScreen(st.x0, st.y0), [x1, y1] = v.toScreen(st.x1, st.y1);
    ctx.strokeStyle = '#4f7cff'; ctx.setLineDash([4, 3]); ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0); ctx.setLineDash([]);
  }
}

// ---- グラデーション（引っぱった向きと長さに）----------------------------------------------------
class GradientTool {
  constructor(app) { this.app = app; this.st = null; }
  down(x, y, e) {
    const app = this.app;
    if (!app.selection().length) { const hit = app.view.hitTop(x, y); if (hit) app.select([hit]); }
    if (!app.selection().length) { toast('塗る物を選んでから引っぱってください'); return; }
    [x, y] = app.view.snap(x, y, excludeIds(app.doc, app.selection()));
    this.st = { x0: x, y0: y, moved: false, e0: e };
  }
  drag(x, y, e, lp) {
    const st = this.st;
    if (!st) return;
    const [sx, sy] = this.app.view.toScreen(st.x0, st.y0);
    if (!st.moved && Math.hypot(lp.x - sx, lp.y - sy) < moveThreshold(st.e0)) return;
    st.moved = true;
    if (e.shiftKey) [x, y] = constrainAngle(st.x0, st.y0, x, y);
    this.app.makeGradient([st.x0, st.y0], [x, y], 'grad-tool-' + st.e0.timeStamp);
  }
  up() { this.st = null; }
  cancel() { this.st = null; }
  paint(ctx) {
    const app = this.app, v = app.view, t = app.colorTarget;
    for (const it of app.panels.styledLeaves().slice(0, 8)) {
      const g = it.style[t];
      if (!isGradient(g)) continue;
      const [ax, ay] = v.toScreen(...g.p0), [bx, by] = v.toScreen(...g.p1);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
      for (const [pos, c] of g.stops) {
        const px = ax + (bx - ax) * pos, py = ay + (by - ay) * pos;
        ctx.fillStyle = colorHex(c); ctx.fillRect(px - 5, py - 5, 10, 10); ctx.strokeStyle = '#000'; ctx.strokeRect(px - 5.5, py - 5.5, 11, 11);
      }
      ctx.beginPath(); ctx.arc(ax, ay, 5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
      break;
    }
  }
}

// ---- アートボード（つかんで動かす・角と辺で大きさ）-------------------------------------------------
class ArtboardTool {
  constructor(app) { this.app = app; this.st = null; this.showsBBox = false; }
  get doc() { return this.app.doc; }
  handles(a) {
    const v = this.app.view, [x0, y0] = v.toScreen(a.x, a.y), [x1, y1] = v.toScreen(a.x + a.w, a.y + a.h), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return [['nw', x0, y0], ['n', cx, y0], ['ne', x1, y0], ['e', x1, cy], ['se', x1, y1], ['s', cx, y1], ['sw', x0, y1], ['w', x0, cy]];
  }
  down(x, y, e, lp) {
    const app = this.app, doc = this.doc;
    const cur = app.curAB(), r = app.touchy ? 16 : 9;
    const hh = this.handles(cur).find(([, hx, hy]) => Math.hypot(hx - lp.x, hy - lp.y) <= r);
    let i = app.curArtboard;
    if (!hh) {
      const k = doc.artboards.findIndex((a) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h);
      if (k < 0) { this.st = null; return; }
      i = k; app.curArtboard = k; app.panels.refresh();
    }
    const a = doc.artboards[i];
    // 動かすときは、上に載っている絵も一緒に（設定で切れる）
    const items = !hh && app.settings.abMoveArt !== false ? doc.layers.filter((l) => !l.locked).flatMap((l) => l.children).filter((c) => {
      if (c.locked) return false;
      const b = itemBBox(c);
      return b && b[0] >= a.x - 0.01 && b[1] >= a.y - 0.01 && b[2] <= a.x + a.w + 0.01 && b[3] <= a.y + a.h + 0.01;
    }) : [];
    doc.begin(hh ? 'アートボードの大きさ' : 'アートボードの移動');
    this.st = { h: hh && hh[0], a, orig: { ...a }, items, saved: saveItems(items), x0: x, y0: y, moved: false, e0: e };
  }
  drag(x, y, e, lp) {
    const st = this.st;
    if (!st) return;
    const v = this.app.view;
    if (!st.moved) { const [sx, sy] = v.toScreen(st.x0, st.y0); if (Math.hypot(lp.x - sx, lp.y - sy) < moveThreshold(st.e0)) return; st.moved = true; }
    const o = st.orig, a = st.a;
    let dx = x - st.x0, dy = y - st.y0;
    if (!st.h) {
      if (e.shiftKey) [dx, dy] = constrainAngle(0, 0, dx, dy);
      a.x = o.x + dx; a.y = o.y + dy;
      st.items.forEach((it, i) => loadInto(it, st.saved[i]));
      for (const it of st.items) itemTransform(it, M.t(dx, dy));
    } else {
      const h = st.h;
      let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
      [x, y] = v.snap(x, y);
      if (h.includes('w')) x0 = Math.min(x, x1 - 1); if (h.includes('e')) x1 = Math.max(x, x0 + 1);
      if (h.includes('n')) y0 = Math.min(y, y1 - 1); if (h.includes('s')) y1 = Math.max(y, y0 + 1);
      Object.assign(a, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    for (const k of ['x', 'y', 'w', 'h']) a[k] = Math.round(a[k] * 1e4) / 1e4;
    this.doc.touch();
    v.request();
    this.app.panels.refreshSoon();
  }
  up() {
    const st = this.st;
    this.st = null;
    if (!st) return;
    if (st.moved) this.doc.commit(); else this.doc.cancel();
  }
  cancel() { if (this.st) this.doc.cancel(); this.st = null; }
  paint(ctx) {
    const app = this.app, a = app.curAB(), v = app.view;
    const [x0, y0] = v.toScreen(a.x, a.y), [x1, y1] = v.toScreen(a.x + a.w, a.y + a.h);
    ctx.strokeStyle = '#4f7cff'; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.lineWidth = 1;
    const hs = app.handleSize();
    ctx.fillStyle = '#fff';
    for (const [, hx, hy] of this.handles(a)) { ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs); ctx.strokeRect(hx - hs / 2 + 0.5, hy - hs / 2 + 0.5, hs - 1, hs - 1); }
    const u = PT_PER[app.doc.data.units] || 1;
    ctx.fillStyle = '#fff'; ctx.font = '12px system-ui';
    ctx.fillText(`${+(a.w / u).toFixed(1)} × ${+(a.h / u).toFixed(1)} ${app.doc.data.units}`, x0, y1 + 16);
  }
}


// ---- スポイト・手のひら ---------------------------------------------------------------------
class EyedropperTool {
  constructor(app) { this.app = app; }
  down(x, y) {
    const app = this.app, doc = app.doc, src = app.view.hitLeaf(x, y);
    if (!src || !src.style) { toast('色を取れる物がありません'); return; }
    const st = JSON.parse(JSON.stringify(src.style));
    const targets = [];
    for (const it of app.selection()) for (const l of doc.iterTree([it])) if (l !== src && l.style && (l.kind === 'path' || l.kind === 'text')) targets.push(l);
    if (targets.length) {
      doc.edit('スポイト', () => {
        for (const t of targets) {
          const keep = t.kind === 'text' ? {} : { profile: t.style.profile };
          t.style = { ...JSON.parse(JSON.stringify(st)), ...keep };
          if (!keep.profile) delete t.style.profile;
        }
        doc.touch();
      });
      toast(`${targets.length} 個に見た目を写しました`);
    } else toast('見た目を取りました（次に描く物に使います）');
    app.curStyle = { ...app.curStyle, fill: paintCopy(st.fill), stroke: paintCopy(st.stroke), width: st.width, cap: st.cap, join: st.join, dash: st.dash };
    app.panels.refresh();
  }
}
class HandTool {
  constructor(app) { this.app = app; this.st = null; this.showsBBox = true; }
  down(x, y, e, lp) { this.st = { sx: lp.x, sy: lp.y, ox: this.app.view.ox, oy: this.app.view.oy }; }
  drag(x, y, e, lp) {
    if (!this.st) return;
    const v = this.app.view;
    v.ox = this.st.ox + lp.x - this.st.sx; v.oy = this.st.oy + lp.y - this.st.sy;
    v.request();
  }
  up() { this.st = null; }
}

function makeTools(app) {
  return {
    select: new SelectTool(app), direct: new DirectTool(app), pen: new PenTool(app), pencil: new PencilTool(app),
    rect: new ShapeTool(app, 'rect'), roundrect: new ShapeTool(app, 'roundrect'), ellipse: new ShapeTool(app, 'ellipse'),
    polygon: new ShapeTool(app, 'polygon'), star: new ShapeTool(app, 'star'), line: new ShapeTool(app, 'line'),
    text: new TextTool(app), eyedropper: new EyedropperTool(app), hand: new HandTool(app),
    gradient: new GradientTool(app), artboard: new ArtboardTool(app), shapebuilder: new ShapeBuilderTool(app), width: new WidthTool(app),
  };
}
