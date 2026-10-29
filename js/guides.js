/* 線工房 Web — 定規・ガイド・グリッド（exe の ui/rulers.py と canvas.py のガイドと同じ形）。

   ガイドは doc.data.guides = [{o: 'v'（縦線 x=p）| 'h'（横線 y=p）, p}]、ロックは doc.data.meta.guides_locked。
   グリッドは doc.data.grid = {size（太い線の間隔 pt）, div（分割数）}。原点・定規の 0 は見ている所のアートボードの左上。
   定規から引っぱるとガイド、ガイドを定規へ戻すと消える。
*/
'use strict';

const RULER = 20;

function niceStep(pxPerUnit, minPx = 60) {
  if (pxPerUnit <= 0) return 1;
  const raw = minPx / pxPerUnit, e = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * e >= raw) return m * e;
  return 10 * e;
}

Object.assign(View.prototype, {
  rulerOrigin() {
    const d = this.doc, [cx, cy] = this.center(), a = d.artboards[d.artboardAt(cx, cy)];
    return [a.x, a.y];
  },
  gridStep() { const g = this.doc.data.grid || {}; return Math.max(0.01, (g.size || 72 / 25.4 * 10) / Math.max(1, g.div | 0 || 4)); },
  gridSnap(x, y) {
    const st = this.gridStep(), a = this.doc.artboards[this.doc.artboardAt(x, y)];
    return [a.x + Math.round((x - a.x) / st) * st, a.y + Math.round((y - a.y) / st) * st];
  },
  paintGrid(ctx) {
    const g = this.doc.data.grid || {}, major = g.size || 72 / 25.4 * 10, div = Math.max(1, g.div | 0 || 4), minor = major / div;
    const r = this.cv.getBoundingClientRect(), [ox, oy] = this.rulerOrigin();
    const [x0, y0] = this.toDoc(0, 0), [x1, y1] = this.toDoc(r.width, r.height);
    const lines = (step, color) => {
      if (step * this.zoom < 6) return;
      ctx.strokeStyle = color; ctx.beginPath();
      for (let x = ox + Math.ceil((x0 - ox) / step) * step; x <= x1; x += step) { const sx = Math.round(x * this.zoom + this.ox) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, r.height); }
      for (let y = oy + Math.ceil((y0 - oy) / step) * step; y <= y1; y += step) { const sy = Math.round(y * this.zoom + this.oy) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(r.width, sy); }
      ctx.stroke();
    };
    lines(minor, 'rgba(120,140,200,0.18)');
    lines(major, 'rgba(90,110,190,0.38)');
  },
  paintGuides(ctx) {
    const gs = this.doc.data.guides || [], r = this.cv.getBoundingClientRect(), locked = this.doc.data.meta && this.doc.data.meta.guides_locked;
    ctx.strokeStyle = locked ? 'rgba(34,200,240,0.55)' : '#22c8f0'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath();
    for (const g of gs) {
      if (g.o === 'v') { const x = Math.round(g.p * this.zoom + this.ox) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, r.height); }
      else { const y = Math.round(g.p * this.zoom + this.oy) + 0.5; ctx.moveTo(0, y); ctx.lineTo(r.width, y); }
    }
    ctx.stroke();
    const t = this.tempGuide;
    if (t && t.p != null) {
      ctx.strokeStyle = '#22c8f0'; ctx.setLineDash([5, 3]); ctx.beginPath();
      if (t.o === 'v') { const x = t.p * this.zoom + this.ox; ctx.moveTo(x, 0); ctx.lineTo(x, r.height); } else { const y = t.p * this.zoom + this.oy; ctx.moveTo(0, y); ctx.lineTo(r.width, y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
  },
  paintRulers(ctx) {
    const r = this.cv.getBoundingClientRect(), u = this.doc.data.units, k = PT_PER[u] || 1, [ox, oy] = this.rulerOrigin();
    ctx.fillStyle = '#2a2a30'; ctx.fillRect(0, 0, r.width, RULER); ctx.fillRect(0, 0, RULER, r.height);
    ctx.strokeStyle = '#555'; ctx.beginPath(); ctx.moveTo(0, RULER - 0.5); ctx.lineTo(r.width, RULER - 0.5); ctx.moveTo(RULER - 0.5, 0); ctx.lineTo(RULER - 0.5, r.height); ctx.stroke();
    const step = niceStep(this.zoom * k, 60), sub = step / 10;
    ctx.fillStyle = '#b8b8c0'; ctx.strokeStyle = '#8a8a94'; ctx.font = '10px system-ui, sans-serif';
    const ticks = (horiz) => {
      const len = horiz ? r.width : r.height, o = horiz ? ox : oy;
      const toS = (v) => (horiz ? (o + v * k) * this.zoom + this.ox : (o + v * k) * this.zoom + this.oy);
      const v0 = ((horiz ? this.toDoc(RULER, 0)[0] : this.toDoc(0, RULER)[1]) - o) / k, v1 = ((horiz ? this.toDoc(len, 0)[0] : this.toDoc(0, len)[1]) - o) / k;
      ctx.beginPath();
      const subOk = sub * this.zoom * k >= 4;
      for (let v = Math.floor(v0 / sub) * sub; v <= v1; v += sub) {
        const s = Math.round(toS(v)) + 0.5, n = Math.round(v / sub);
        if (s < RULER) continue;
        const big = n % 10 === 0, mid = n % 5 === 0;
        if (!big && !subOk) continue;
        const l = big ? RULER : mid ? 8 : 4;
        if (horiz) { ctx.moveTo(s, RULER); ctx.lineTo(s, RULER - l); } else { ctx.moveTo(RULER, s); ctx.lineTo(RULER - l, s); }
        if (big) {
          const label = String(+(Math.round(v / step) * step).toFixed(6));
          if (horiz) ctx.fillText(label, s + 2, 10);
          else { ctx.save(); ctx.translate(10, s + 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(label, 0, 0); ctx.restore(); }
        }
      }
      ctx.stroke();
    };
    ticks(true); ticks(false);
    ctx.fillStyle = '#2a2a30'; ctx.fillRect(0, 0, RULER, RULER);
    ctx.fillStyle = '#8a8a94'; ctx.fillText(u, 2, 13);
  },
  hitGuide(lp) {
    const d = this.doc;
    if (!this.app.settings.showGuides || (d.data.meta && d.data.meta.guides_locked)) return -1;
    const tol = this.app.touchy ? 12 : 5;
    return (d.data.guides || []).findIndex((g) => Math.abs(g.o === 'v' ? g.p * this.zoom + this.ox - lp.x : g.p * this.zoom + this.oy - lp.y) <= tol);
  },
  /** ガイドを引く・動かす位置: 物の端・中心・アートボードに近ければそろえる */
  snapGuideValue(v, o) {
    if (!this.app.settings.snap) return v;
    const t = this.tol(this.app.touchy ? 10 : 5), xs = [], ys = [];
    for (const a of this.doc.artboards) { xs.push(a.x, a.x + a.w / 2, a.x + a.w); ys.push(a.y, a.y + a.h / 2, a.y + a.h); }
    for (const it of this.doc.iterTree()) {
      if (it.kind === 'layer' || !this.doc.isVisible(it)) continue;
      const b = itemBBox(it); if (!b) continue;
      xs.push(b[0], (b[0] + b[2]) / 2, b[2]); ys.push(b[1], (b[1] + b[3]) / 2, b[3]);
    }
    let best = v, bd = t;
    for (const c of o === 'v' ? xs : ys) if (Math.abs(c - v) <= bd) { bd = Math.abs(c - v); best = c; }
    return best;
  },
});

// ---- 定規から引く・ガイドを動かす（view.js の down / move / up から呼ぶ）-------------------------
Object.assign(App.prototype, {
  guidePointerDown(e, lp) {
    const v = this.view, S = this.settings;
    if (e.button && e.button !== 0) return false;
    if (S.showRulers && (lp.x < RULER || lp.y < RULER)) {
      if (lp.x < RULER && lp.y < RULER) return false;
      v.guideDrag = { o: lp.y < RULER ? 'h' : 'v', idx: -1 };
      v.tempGuide = { o: v.guideDrag.o, p: null };
      return true;
    }
    if (!['select', 'direct'].includes(this.toolName)) return false;
    const i = v.hitGuide(lp);
    if (i < 0) return false;
    const [x, y] = v.toDoc(lp.x, lp.y);
    if (v.hitTop(x, y) || (this.selection().length && v.hitHandle(lp.x, lp.y))) return false;
    this.doc.begin('ガイドの移動');
    v.guideDrag = { o: this.doc.data.guides[i].o, idx: i };
    return true;
  },
  guidePointerMove(lp) {
    const v = this.view, G = v.guideDrag;
    if (!G) return;
    const [x, y] = v.toDoc(lp.x, lp.y);
    const p = v.snapGuideValue(G.o === 'v' ? x : y, G.o);
    if (G.idx < 0) v.tempGuide = { o: G.o, p };
    else { this.doc.data.guides[G.idx].p = Math.round(p * 1e4) / 1e4; this.doc.touch(); }
    v.request();
  },
  guidePointerUp(lp) {
    const v = this.view, G = v.guideDrag, doc = this.doc;
    v.guideDrag = null;
    if (!G) return;
    const r = v.cv.getBoundingClientRect();
    const off = lp.x < (this.settings.showRulers ? RULER : 4) || lp.y < (this.settings.showRulers ? RULER : 4) || lp.x > r.width || lp.y > r.height;
    if (G.idx < 0) {
      const t = v.tempGuide;
      v.tempGuide = null;
      if (t && t.p != null && !off) {
        doc.edit('ガイド', () => { (doc.data.guides = doc.data.guides || []).push({ o: t.o, p: Math.round(t.p * 1e4) / 1e4 }); doc.touch(); });
        if (!this.settings.showGuides) { this.settings.showGuides = true; this.saveSettings(); }
      }
    } else if (off) { doc.data.guides.splice(G.idx, 1); doc.touch(); doc.commit(); toast('ガイドを消しました', 1200); }
    else doc.commit();
    v.request();
  },
  clearGuides() {
    if (!(this.doc.data.guides || []).length) return;
    this.doc.edit('ガイドを消去', () => { this.doc.data.guides = []; this.doc.touch(); });
  },
  async marginGuidesDialog() {
    const u = this.doc.data.units === 'px' ? 'px' : 'mm';
    const inp = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: this.settings.marginGuide ?? (u === 'mm' ? 5 : 40) });
    const body = h('div', { class: 'form' }, h('label', {}, `アートボードの内側の余白（${u}）`, inp), h('p', { class: 'note' }, 'すべてのアートボードの四辺の内側にガイドを引きます（文字や大事な物を収める目安）。'));
    if (!await this.modal('マージンにガイド', body, [['キャンセル', false], ['引く', true, 'primary']])) return;
    const m = parseFloat(inp.value);
    if (!(m > 0)) return;
    this.settings.marginGuide = m; this.saveSettings();
    this.doc.edit('マージンのガイド', () => { addMarginGuides(this.doc, m * PT_PER[u]); this.doc.touch(); });
    if (!this.settings.showGuides) { this.settings.showGuides = true; this.saveSettings(); }
    this.view.request();
  },
  toggleView(key) { this.settings[key] = !this.settings[key]; this.saveSettings(); this.view.request(); this.panels.toolOptions(); },
  toggleGuidesLock() { const m = this.doc.data.meta = this.doc.data.meta || {}; this.doc.edit('ガイドのロック', () => { if (m.guides_locked) delete m.guides_locked; else m.guides_locked = true; }); this.view.request(); },
  /** トンボをオブジェクトとして作る（Illustrator の［トンボを作成］・exe の make_crop_mark_items と同じ） */
  makeCropMarks() {
    const a = this.curAB(), g = makeGroup(cropMarks([a.x, a.y, a.x + a.w, a.y + a.h]).map(([x1, y1, x2, y2]) =>
      makePath([{ n: [N(x1, y1), N(x2, y2)], c: false }], newStyle(null, { ...REGISTRATION, v: [...REGISTRATION.v] }, MARK_WIDTH))));
    g.name = 'トンボ';
    this.doc.edit('トンボを作成', () => this.doc.addItem(g, this.doc.currentLayer()));
    this.select([g]);
  },
});
function addMarginGuides(doc, m) {
  doc.data.guides = doc.data.guides || [];
  for (const a of doc.artboards) doc.data.guides.push({ o: 'v', p: a.x + m }, { o: 'v', p: a.x + a.w - m }, { o: 'h', p: a.y + m }, { o: 'h', p: a.y + a.h - m });
}
