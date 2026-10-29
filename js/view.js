/* 線工房 Web — 画面: 表示の変換・ジェスチャー（Pencil／指／マウス）・選択の表示・当たり判定。

   画面 = 文書 × zoom + (ox, oy)（CSS 画素）。canvas は devicePixelRatio 倍で持つ。
   指: 2 本でつまむ＝拡大縮小・移動、2 本指タップ＝取り消し、3 本指タップ＝やり直し。
   Apple Pencil を使うと「指では描かない」（1 本指＝画面の移動）に自動で切り替わる（設定で戻せる）。
*/
'use strict';

const _hitCtx = document.createElement('canvas').getContext('2d');

class View {
  constructor(app, canvas) {
    this.app = app;
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.zoom = 1; this.ox = 40; this.oy = 40;
    this.pointers = new Map();
    this.mode = null;               // 'tool' | 'pinch' | 'pan'
    this.gesture = null;
    this.toolPointer = null;
    this.pending = false;
    this.hover = null;
    this.snapMark = null;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e, true));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.lastTap = null;            // ダブルタップ（iPad では dblclick が来ないので自前で見る）
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
    window.addEventListener('resize', () => this.resize());
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }
  get doc() { return this.app.doc; }

  resize() {
    const r = this.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr));
    if (this.cv.width !== w) this.cv.width = w;
    if (this.cv.height !== hh) this.cv.height = hh;
    this.dpr = dpr;
    this.request();
  }
  local(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  toDoc(x, y) { return [(x - this.ox) / this.zoom, (y - this.oy) / this.zoom]; }
  toScreen(x, y) { return [x * this.zoom + this.ox, y * this.zoom + this.oy]; }
  tol(px = 6) { return px / this.zoom; }
  setZoom(z, ax, ay) {
    z = Math.max(0.02, Math.min(z, 64));
    if (ax == null) { const r = this.cv.getBoundingClientRect(); ax = r.width / 2; ay = r.height / 2; }
    const [dx, dy] = this.toDoc(ax, ay);
    this.zoom = z; this.ox = ax - dx * z; this.oy = ay - dy * z;
    this.app.onView();
    this.request();
  }
  /** 見えている所（狭い画面でパネルが重なっていればその分を除く。キャンバスの座標） */
  visible() {
    const r = this.cv.getBoundingClientRect(), p = document.getElementById('panel');
    let w = r.width;
    if (p && !p.classList.contains('closed') && getComputedStyle(p).position === 'absolute') w = Math.max(120, w - p.getBoundingClientRect().width);
    return { width: w, height: r.height };
  }
  fitRect(b, margin = 30) {
    const r = this.visible();
    const w = Math.max(b[2] - b[0], 1e-3), h = Math.max(b[3] - b[1], 1e-3);
    this.zoom = Math.max(0.02, Math.min(64, Math.min((r.width - 2 * margin) / w, (r.height - 2 * margin) / h)));
    this.ox = r.width / 2 - (b[0] + w / 2) * this.zoom;
    this.oy = r.height / 2 - (b[1] + h / 2) * this.zoom;
    this.app.onView();
    this.request();
  }
  fitArtboard(i) {
    if (!this.doc) return;
    if (i == null) { const r = this.cv.getBoundingClientRect(); i = this.doc.artboardAt(...this.toDoc(r.width / 2, r.height / 2)); }
    const a = this.doc.artboards[Math.max(0, Math.min(i, this.doc.artboards.length - 1))];
    this.fitRect([a.x, a.y, a.x + a.w, a.y + a.h]);
  }
  center() { const r = this.visible(); return this.toDoc(r.width / 2, r.height / 2); }

  // ---- 入力 ------------------------------------------------------------------------
  down(e) {
    this.cv.setPointerCapture(e.pointerId);
    const lp = this.local(e);
    this.pointers.set(e.pointerId, { x: lp.x, y: lp.y, type: e.pointerType, t0: e.timeStamp, sx: lp.x, sy: lp.y });
    const S = this.app.settings;
    if (e.pointerType === 'pen' && S.fingerDraws !== false && !S._penNoticed) {
      S.fingerDraws = false; S._penNoticed = true; this.app.saveSettings();
      toast('Apple Pencil を見つけました。指は画面の移動に使います（設定で変えられます）', 4000);
    }
    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
    if (e.pointerType === 'touch' && touches.length >= 2) {
      if (this.mode === 'tool' && this.toolPointer && this.toolPointer.type === 'touch') { this.app.tool.cancel && this.app.tool.cancel(); }
      this.startPinch(touches);
      return;
    }
    if (this.mode === 'pinch') return;
    const fingerPans = e.pointerType === 'touch' && (S.fingerDraws === false || this.app.toolName === 'hand');
    const onRuler = S.showRulers && (lp.x < RULER || lp.y < RULER);
    if ((onRuler || !fingerPans) && !this.app.space && this.app.guidePointerDown(e, lp)) {
      this.mode = 'guide';
      this.toolPointer = { id: e.pointerId, type: e.pointerType };
      return;
    }
    if (fingerPans || e.button === 1 || (e.pointerType === 'mouse' && this.app.space)) {
      this.mode = 'pan';
      this.gesture = { sx: lp.x, sy: lp.y, ox: this.ox, oy: this.oy, id: e.pointerId, moved: false };
      return;
    }
    this.mode = 'tool';
    this.toolPointer = { id: e.pointerId, type: e.pointerType };
    const [x, y] = this.toDoc(lp.x, lp.y);
    this.app.tool.down && this.app.tool.down(x, y, e, lp);
  }
  startPinch(touches) {
    const [a, b] = touches;
    this.mode = 'pinch';
    this.gesture = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, z0: this.zoom,
      ox: this.ox, oy: this.oy, t0: performance.now(), moved: false, n: touches.length };
  }
  move(e) {
    const lp = this.local(e);
    const p = this.pointers.get(e.pointerId);
    if (p) { p.x = lp.x; p.y = lp.y; }
    if (this.mode === 'pinch') {
      if (e.pointerType !== 'touch') return;
      const ts = [...this.pointers.values()].filter((q) => q.type === 'touch');
      if (ts.length >= 2) {
        const [a, b] = ts, G = this.gesture;
        G.n = Math.max(G.n, ts.length);
        const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        if (Math.abs(d - G.d0) > 10 || Math.hypot(cx - G.cx, cy - G.cy) > 10) G.moved = true;
        const z = Math.max(0.02, Math.min(64, G.z0 * d / G.d0));
        const dx = (G.cx - G.ox) / G.z0, dy = (G.cy - G.oy) / G.z0;
        this.zoom = z; this.ox = cx - dx * z; this.oy = cy - dy * z;
        this.app.onView();
        this.request();
      }
      return;
    }
    if (this.mode === 'guide') { if (this.toolPointer && e.pointerId === this.toolPointer.id) this.app.guidePointerMove(lp); return; }
    if (this.mode === 'pan' && this.gesture && e.pointerId === this.gesture.id) {
      this.ox = this.gesture.ox + lp.x - this.gesture.sx;
      this.oy = this.gesture.oy + lp.y - this.gesture.sy;
      this.request();
      return;
    }
    const [x, y] = this.toDoc(lp.x, lp.y);
    if (this.mode === 'tool' && this.toolPointer && e.pointerId === this.toolPointer.id) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ce of (evs.length ? evs : [e])) {
        const q = this.local(ce);
        this.app.tool.drag && this.app.tool.drag(...this.toDoc(q.x, q.y), ce, q);
      }
      return;
    }
    if (!this.mode && e.pointerType !== 'touch') {
      this.app.tool.hover && this.app.tool.hover(x, y, e, lp);
      this.app.status(x, y);
    }
  }
  up(e, cancelled = false) {
    const lp = this.local(e);
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.mode === 'pinch') {
      const left = [...this.pointers.values()].filter((q) => q.type === 'touch').length;
      if (left === 0) {
        const G = this.gesture;
        if (G && !G.moved && performance.now() - G.t0 < 350) {
          if (G.n >= 3) this.app.redo(); else this.app.undo();
        }
        this.mode = null; this.gesture = null;
      }
      return;
    }
    if (this.mode === 'pan') { this.mode = null; this.gesture = null; return; }
    if (this.mode === 'guide') {
      if (this.toolPointer && e.pointerId === this.toolPointer.id) { this.mode = null; this.toolPointer = null; this.app.guidePointerUp(lp); }
      return;
    }
    if (this.mode === 'tool' && this.toolPointer && e.pointerId === this.toolPointer.id) {
      this.mode = null;
      this.toolPointer = null;
      const [x, y] = this.toDoc(lp.x, lp.y);
      if (cancelled) this.app.tool.cancel && this.app.tool.cancel();
      else {
        this.app.tool.up && this.app.tool.up(x, y, e, lp);
        const tap = p && Math.hypot(lp.x - p.sx, lp.y - p.sy) < 8 && e.timeStamp - p.t0 < 400;
        const L = this.lastTap;
        if (tap && L && e.timeStamp - L.t < 400 && Math.hypot(lp.x - L.x, lp.y - L.y) < 16) {
          this.lastTap = null;
          this.app.tool.dbl && this.app.tool.dbl(x, y, e, lp);
        } else this.lastTap = tap ? { t: e.timeStamp, x: lp.x, y: lp.y } : null;
      }
      this.snapMark = null;
      this.request();
    }
    void p;
  }
  wheel(e) {
    e.preventDefault();
    const lp = this.local(e);
    if (e.ctrlKey || e.metaKey || e.altKey) this.setZoom(this.zoom * Math.pow(1.0018, -e.deltaY), lp.x, lp.y);
    else { this.ox -= e.shiftKey ? e.deltaY : e.deltaX; this.oy -= e.shiftKey ? 0 : e.deltaY; this.request(); }
  }

  // ---- 当たり判定 --------------------------------------------------------------------
  hitLeaf(x, y, tol = this.tol(6)) {
    if (!this.doc) return null;
    for (let i = this.doc.layers.length - 1; i >= 0; i--) {
      const l = this.doc.layers[i];
      if (l.visible === false || l.locked) continue;
      const r = this._hitIn(l, x, y, tol);
      if (r) return r;
    }
    return null;
  }
  _hitIn(g, x, y, tol) {
    let kids = g.children;
    if (g.clip && kids.length) {
      if (!_hitCtx.isPointInPath(this.app.renderer.shapeOf(kids[kids.length - 1]), x, y)) return null;
      kids = kids.slice(0, -1);
    }
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i];
      if (c.visible === false || c.locked) continue;
      if (c.children) { const r = this._hitIn(c, x, y, tol); if (r) return r; }
      else if (this.hitItem(c, x, y, tol)) return c;
    }
    return null;
  }
  hitItem(it, x, y, tol) {
    if (it.kind === 'path') {
      if (!it.paths.length) return false;
      const p = itemPath2D(it);
      if (it.style.fill && _hitCtx.isPointInPath(p, x, y, it.fill_rule === 'evenodd' ? 'evenodd' : 'nonzero')) return true;
      _hitCtx.lineWidth = (it.style.stroke ? it.style.width : 0) + 2 * tol;
      return _hitCtx.isPointInStroke(p, x, y);
    }
    const b = it.kind === 'text' ? textLocalBBox(it) : [0, 0, it.pw, it.ph];
    if (!b) return false;
    const [lx, ly] = M.map(M.inv(it.matrix), x, y), t = tol / (M.scale(it.matrix) || 1);
    return lx >= b[0] - t && lx <= b[2] + t && ly >= b[1] - t && ly <= b[3] + t;
  }
  topOf(it) { let x = it; while (x && this.doc.parentOf(x) && this.doc.parentOf(x).kind !== 'layer') x = this.doc.parentOf(x); return x; }
  hitTop(x, y) { const l = this.hitLeaf(x, y); return l ? this.topOf(l) : null; }
  itemsInRect(r, leaf = false) {
    const out = [];
    const q = new Path2D();
    q.rect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    for (const l of this.doc.layers) {
      if (l.visible === false || l.locked) continue;
      for (const c of l.children) {
        if (c.visible === false || c.locked) continue;
        const cands = leaf ? [...this.doc.iterTree([c])].filter((x) => !x.children) : [c];
        for (const it of cands) {
          const b = itemBBox(it);
          if (b && !(b[2] < r[0] || b[0] > r[2] || b[3] < r[1] || b[1] > r[3])) out.push(it);
        }
      }
    }
    return out;
  }

  // ---- 描画 ------------------------------------------------------------------------
  request() { if (!this.pending) { this.pending = true; requestAnimationFrame(() => { this.pending = false; this.paint(); }); } }
  paint() {
    const ctx = this.ctx, d = this.dpr, doc = this.doc;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#48484e';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    if (!doc) return;
    ctx.setTransform(d * this.zoom, 0, 0, d * this.zoom, d * this.ox, d * this.oy);
    for (const a of doc.artboards) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(a.x + 3 / this.zoom, a.y + 3 / this.zoom, a.w, a.h);
      ctx.fillStyle = '#fff';
      ctx.fillRect(a.x, a.y, a.w, a.h);
    }
    this.app.renderer.outline = this.app.outlineMode;
    if (this.app.settings.showGrid && !this.app.settings.gridFront) { ctx.save(); ctx.setTransform(d, 0, 0, d, 0, 0); this.paintGrid(ctx); ctx.restore(); }
    this.app.renderer.drawDoc(ctx);
    // ここからは画面の画素で（線を細く保つ）
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    doc.artboards.forEach((a, i) => {
      const [x0, y0] = this.toScreen(a.x, a.y), [x1, y1] = this.toScreen(a.x + a.w, a.y + a.h);
      ctx.strokeStyle = '#222'; ctx.setLineDash([]); ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
      if (doc.data.bleed > 0) {
        const b = doc.data.bleed * this.zoom;
        ctx.strokeStyle = '#e33'; ctx.strokeRect(x0 - b, y0 - b, x1 - x0 + 2 * b, y1 - y0 + 2 * b);
      }
      ctx.fillStyle = '#c8c8cd'; ctx.fillText(`${i + 1} - ${a.name}`, x0, y0 - 6);
    });
    const tgt = doc.drawTarget();
    if (tgt) {
      ctx.strokeStyle = 'rgba(255,60,160,0.8)'; ctx.setLineDash([5, 4]);
      const [cx, cy] = this.toScreen(tgt.symmetry.cx || 0, tgt.symmetry.cy || 0);
      const axes = tgt.symmetry.mode === 'v' ? [90] : tgt.symmetry.mode === 'h' ? [0] : tgt.symmetry.mode === 'vh' ? [0, 90] :
        Array.from({ length: Math.max(2, tgt.symmetry.n || 6) }, (_, k) => -90 + (tgt.symmetry.mirror ? 180 : 360) * k / (tgt.symmetry.n || 6));
      for (const deg of axes) {
        const a = deg * Math.PI / 180, L = 4000;
        ctx.beginPath();
        if (tgt.symmetry.mode === 'radial') { ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); }
        else { ctx.moveTo(cx - Math.cos(a) * L, cy - Math.sin(a) * L); ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (this.app.settings.showGrid && this.app.settings.gridFront) this.paintGrid(ctx);
    if (this.app.settings.showGuides || this.tempGuide) this.paintGuides(ctx);
    this.paintSelection(ctx);
    if (this.app.editing) this.paintTextEdit(ctx);
    this.app.tool.paint && this.app.tool.paint(ctx);
    if (this.snapMark) {
      const [sx, sy] = this.toScreen(...this.snapMark);
      ctx.strokeStyle = '#ff3ca0'; ctx.strokeRect(sx - 4, sy - 4, 8, 8);
    }
    if (this.app.settings.showRulers) this.paintRulers(ctx);
  }
  /** 文字の編集中: 選んでいる範囲を色で、カーソルを線で（入力欄の選択に合わせる） */
  paintTextEdit(ctx) {
    const it = this.app.editing.it, lay = textLayout(it), ta = document.getElementById('textedit');
    const a = cpIndex(ta.value, ta.selectionStart), b = cpIndex(ta.value, ta.selectionEnd);
    const [ascR, descR] = fontMetrics(it.font);
    const toS = (g, x, y) => this.toScreen(...M.map(it.matrix, ...M.map(g.m, x, y)));
    if (it.frame && it.frame.length) {
      const p = new Path2D();
      p.addPath(spsPath2D(it.frame), new DOMMatrix([...M.then(it.matrix, [this.zoom, 0, 0, this.zoom, this.ox, this.oy])]));
      ctx.strokeStyle = 'rgba(79,124,255,0.7)'; ctx.setLineDash([4, 3]); ctx.stroke(p); ctx.setLineDash([]);
    }
    const gs = lay.glyphs.filter((g) => g.adv !== undefined);
    if (b > a) {
      ctx.fillStyle = 'rgba(79,124,255,0.35)';
      for (const g of gs) {
        if (g.ci < a || g.ci >= b) continue;
        const q = [[0, -ascR * 100], [g.w100, -ascR * 100], [g.w100, descR * 100], [0, descR * 100]].map(([x, y]) => toS(g, x, y));
        ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
      }
      return;
    }
    let g = gs.find((x) => x.ci >= a), atEnd = false;
    if (!g || g.ci !== a) { const prev = gs.filter((x) => x.ci < a).pop(); if (prev) { g = prev; atEnd = true; } }
    ctx.strokeStyle = '#ff3ca0'; ctx.lineWidth = 2;
    if (!g) {
      const [x, y] = this.toScreen(...M.map(it.matrix, 0, 0)), s = (it.size || 24) * this.zoom * M.scale(it.matrix);
      ctx.beginPath();
      if (lay.vertical) { ctx.moveTo(x - s / 2, y); ctx.lineTo(x + s / 2, y); } else { ctx.moveTo(x, y - s * 0.88); ctx.lineTo(x, y + s * 0.12); }
      ctx.stroke();
    } else if (lay.vertical && Math.abs(g.m[1]) < 1e-9) {
      // 縦書きの正立した字: 字の上（終わりなら下）に横線
      const y = atEnd ? descR * 100 : -ascR * 100, [p0x, p0y] = toS(g, -10, y), [p1x, p1y] = toS(g, g.w100 + 10, y);
      ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.stroke();
    } else {
      const x = atEnd ? g.w100 : 0, [p0x, p0y] = toS(g, x, -ascR * 100), [p1x, p1y] = toS(g, x, descR * 100);
      ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.stroke();
    }
    ctx.lineWidth = 1;
  }
  outlinePath(it) {
    if (it._op && it._op.e === GEO_EPOCH) return it._op.p;
    const p = this._outlinePath(it);
    it._op = { e: GEO_EPOCH, p };
    return p;
  }
  _outlinePath(it) {
    // 選択の表示用（文書座標の Path2D）
    if (it.kind === 'text' && it.frame && it.frame.length && (it.text_kind || 'point') !== 'point') {
      const p = new Path2D();
      p.addPath(spsPath2D(it.frame), new DOMMatrix(it.matrix));
      return p;
    }
    if (it.kind === 'text') {
      const b = textLocalBBox(it), p = new Path2D();
      if (b) { const r = new Path2D(); r.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]); p.addPath(r, new DOMMatrix(it.matrix)); }
      return p;
    }
    if (it.children) {
      if (it.clip && it.children.length) return this.outlinePath(it.children[it.children.length - 1]);
      const p = new Path2D();
      for (const c of it.children) if (c.visible !== false) p.addPath(this.outlinePath(c));
      return p;
    }
    return this.app.renderer.shapeOf(it);
  }
  paintSelection(ctx) {
    const app = this.app, sel = app.selection();
    const d = this.dpr, vm = new DOMMatrix([this.zoom, 0, 0, this.zoom, this.ox, this.oy]);
    const pv = this.app.renderer.preview, pvm = pv ? new DOMMatrix([this.zoom, 0, 0, this.zoom, this.ox, this.oy]).multiply(new DOMMatrix(pv.m)) : null;
    const strokeDoc = (path, color, w = 1, it = null) => {
      ctx.save(); ctx.setTransform(d, 0, 0, d, 0, 0);
      const p = new Path2D(); p.addPath(path, pv && it && pv.ids.has(it.id) ? pvm : vm);
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash([]); ctx.stroke(p); ctx.restore();
    };
    if (this.hover && !sel.includes(this.hover)) strokeDoc(this.outlinePath(this.hover), this.layerColor(this.hover), 2);
    if (!sel.length) return;
    for (const it of sel) strokeDoc(this.outlinePath(it), this.layerColor(it), 1, it);
    const tool = app.tool;
    if (tool.showsAnchors || app.anchorSel.size) { this.paintAnchors(ctx, sel); return; }
    if (tool.showsBBox === false) return;
    let b = selectionBBox(sel);
    if (!b) return;
    if (pv) b = mapBBox(pv.m, b);
    const [x0, y0] = this.toScreen(b[0], b[1]), [x1, y1] = this.toScreen(b[2], b[3]);
    ctx.strokeStyle = this.layerColor(sel[0]);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    const hs = app.handleSize();
    ctx.fillStyle = '#fff';
    for (const [, hx, hy] of this.handlePoints(b)) { ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs); ctx.strokeRect(hx - hs / 2 + 0.5, hy - hs / 2 + 0.5, hs - 1, hs - 1); }
    // 回転のつまみ（上の中央の少し上）
    const rx = (x0 + x1) / 2, ry = y0 - 26;
    ctx.beginPath(); ctx.moveTo(rx, y0); ctx.lineTo(rx, ry + 6); ctx.stroke();
    ctx.beginPath(); ctx.arc(rx, ry, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  handlePoints(b) {
    const [x0, y0] = this.toScreen(b[0], b[1]), [x1, y1] = this.toScreen(b[2], b[3]), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const out = [['nw', x0, y0], ['ne', x1, y0], ['se', x1, y1], ['sw', x0, y1]];
    if (Math.abs(x1 - x0) > 40) out.push(['n', cx, y0], ['s', cx, y1]);
    if (Math.abs(y1 - y0) > 40) out.push(['e', x1, cy], ['w', x0, cy]);
    return out;
  }
  hitHandle(sx, sy) {
    const sel = this.app.selection();
    const b = sel.length ? selectionBBox(sel) : null;
    if (!b) return null;
    const hs = this.app.handleSize() + 6;
    const [x0, y0] = this.toScreen(b[0], b[1]), [x1] = this.toScreen(b[2], b[3]);
    if (Math.hypot(sx - (x0 + x1) / 2, sy - (y0 - 26)) <= hs) return 'rot';
    for (const [k, hx, hy] of this.handlePoints(b)) if (Math.abs(hx - sx) <= hs / 2 + 2 && Math.abs(hy - sy) <= hs / 2 + 2) return k;
    return null;
  }
  paintAnchors(ctx, sel) {
    const app = this.app, s = app.handleSize() - 2;
    for (const it of sel) for (const p of this.doc.iterTree([it])) {
      if (p.kind !== 'path') continue;
      const col = this.layerColor(p);
      p.paths.forEach((sp, si) => {
        const n = sp.n.length;
        sp.n.forEach((nd, ni) => {
          const key = `${p.id}:${si}:${ni}`, on = app.anchorSel.has(key);
          const prevOn = app.anchorSel.has(`${p.id}:${si}:${(ni - 1 + n) % n}`) && (ni > 0 || sp.c);
          const nextOn = app.anchorSel.has(`${p.id}:${si}:${(ni + 1) % n}`) && (ni < n - 1 || sp.c);
          const [ax, ay] = this.toScreen(nd.x, nd.y);
          ctx.strokeStyle = col;
          for (const [show, hx, hy] of [[on || prevOn, nd.ix, nd.iy], [on || nextOn, nd.ox, nd.oy]]) {
            if (!show || (Math.abs(hx - nd.x) < 1e-6 && Math.abs(hy - nd.y) < 1e-6)) continue;
            const [qx, qy] = this.toScreen(hx, hy);
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(qx, qy); ctx.stroke();
            ctx.fillStyle = col; ctx.beginPath(); ctx.arc(qx, qy, 4, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = on ? col : '#fff';
          ctx.fillRect(ax - s / 2, ay - s / 2, s, s);
          ctx.strokeRect(ax - s / 2 + 0.5, ay - s / 2 + 0.5, s - 1, s - 1);
        });
      });
    }
  }
  layerColor(it) { const l = this.doc.layerOf(it); return (l && l.color) || '#4f7cff'; }

  /** 吸着する点（錨点・外枠の中心）を升目に。形が変わるまで覚えておく。点ごとに、その物と親の id */
  snapIndex() {
    if (this._snapIdx && this._snapIdx.e === GEO_EPOCH && this._snapIdx.doc === this.doc) return this._snapIdx;
    const cs = 24, grid = new Map(), doc = this.doc;
    const add = (x, y, ids) => { const k = Math.floor(x / cs) + ',' + Math.floor(y / cs); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push([x, y, ids]); };
    const walk = (arr, chain) => {
      for (const it of arr) {
        if (it.visible === false) continue;
        const ids = it.kind === 'layer' ? chain : [...chain, it.id];
        if (it.children) { walk(it.children, ids); continue; }
        if (it.kind === 'path') for (const sp of it.paths) for (const n of sp.n) add(n.x, n.y, ids);
        const b = itemBBox(it);
        if (b) add((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, ids);
      }
    };
    walk(doc.layers, []);
    this._snapIdx = { e: GEO_EPOCH, doc, cs, grid };
    return this._snapIdx;
  }
  snap(x, y, exclude = new Set()) {
    this.snapMark = null;
    if (this.app.settings.snapGrid) { const g = this.gridSnap(x, y); this.snapMark = g; return g; }
    if (!this.app.settings.snap) return [x, y];
    const t = this.tol(this.app.touchy ? 10 : 6);
    let best = null, bd = t;
    const consider = (sx, sy) => { const dd = Math.max(Math.abs(sx - x), Math.abs(sy - y)); if (dd <= bd) { bd = dd; best = [sx, sy]; } };
    for (const a of this.doc.artboards) for (const [sx, sy] of [[a.x, a.y], [a.x + a.w, a.y], [a.x, a.y + a.h], [a.x + a.w, a.y + a.h], [a.x + a.w / 2, a.y + a.h / 2], [a.x + a.w / 2, a.y], [a.x, a.y + a.h / 2], [a.x + a.w, a.y + a.h / 2], [a.x + a.w / 2, a.y + a.h]]) consider(sx, sy);
    const idx = this.snapIndex(), cs = idx.cs;
    for (let gx = Math.floor((x - t) / cs); gx <= Math.floor((x + t) / cs); gx++) for (let gy = Math.floor((y - t) / cs); gy <= Math.floor((y + t) / cs); gy++) {
      const l = idx.grid.get(gx + ',' + gy);
      if (l) for (const [sx, sy, ids] of l) { if (ids.some((id) => exclude.has(id))) continue; consider(sx, sy); }
    }
    // ガイド: 縦のガイドには x、横のガイドには y をそろえる
    if (this.app.settings.showGuides) {
      let gx = null, gy = null, dx = t, dy = t;
      for (const g of this.doc.data.guides || []) {
        if (g.o === 'v' && Math.abs(g.p - x) <= dx) { dx = Math.abs(g.p - x); gx = g.p; }
        if (g.o === 'h' && Math.abs(g.p - y) <= dy) { dy = Math.abs(g.p - y); gy = g.p; }
      }
      if (gx != null || gy != null) {
        const p = [gx ?? (best ? best[0] : x), gy ?? (best ? best[1] : y)];
        this.snapMark = p;
        return p;
      }
    }
    if (best) { this.snapMark = best; return best; }
    return [x, y];
  }
}
