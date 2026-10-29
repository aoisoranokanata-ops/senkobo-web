/* 線工房 Web — 形の操作（フェーズ3）: パスファインダー・パスのオフセット・線のアウトライン・連結・複合パスの解除・シェイプ形成ツール。
   計算は boolean.js。App のメソッドとして足す（app.js の後に読む）。文字は字の形を取り出せないので使えない（exe でアウトライン化）。
*/
'use strict';

/** olds を消して、一番上だった位置に news を置く（exe の _replace と同じ） */
function replaceItems(doc, olds, news) {
  olds = sortByOrder(doc, topLevel(doc, olds));
  const top = olds[olds.length - 1], parent = doc.parentOf(top) || doc.currentLayer();
  let idx = parent.children.indexOf(top);
  for (const o of olds) {
    const p = doc.parentOf(o);
    if (p === parent && parent.children.indexOf(o) < idx) idx--;
    doc.remove(o);
  }
  for (const n of news) { doc.assignIds(n); parent.children.splice(++idx, 0, n); }
  doc.touch();
}
function styleCopy(st) { const s = JSON.parse(JSON.stringify(st)); delete s.profile; return s; }

Object.assign(App.prototype, {
  /** 形に使える物（パスを含む物）だけ。文字が混じっていれば知らせる */
  shapeItems(min = 1) {
    const doc = this.doc;
    let items = sortByOrder(doc, topLevel(doc, this.selection()));
    items = items.filter((it) => boolPaths(doc, it).length);
    if (items.length < min) { toast(min > 1 ? `パスを ${min} つ以上選んでください` : 'パスを選んでください'); return null; }
    return items;
  },
  pathfinder(how) {
    const items = this.shapeItems(how === 'unite' ? 1 : 2);
    if (!items) return;
    const doc = this.doc, t0 = performance.now();
    let out = [];
    try {
      doc.edit(PATHFINDER_LABELS[how], () => {
        if (how === 'divide') {
          const styles = items.map((it) => boolPaths(doc, it)[0].item.style);
          const { regs } = divideRegions(doc, items);
          const g = makeGroup(regs.map((r) => { const p = makePath(r.sps, styleCopy(styles[r.top])); p.fill_rule = 'evenodd'; return p; }));
          replaceItems(doc, items, [g]);
          out = [g];
          return;
        }
        const sps = boolOp(doc, items, how);
        const src = boolPaths(doc, how === 'minus_front' ? items[0] : items[items.length - 1])[0].item;
        if (!sps.length) { OPS.remove(doc, items); return; }
        const p = makePath(sps, styleCopy(src.style));
        p.fill_rule = 'evenodd';
        replaceItems(doc, items, [p]);
        out = [p];
      });
    } catch (e) { console.error(e); toast('計算できませんでした: ' + e.message, 5000); return; }
    this.select(out);
    if (!out.length) toast('重なりがないので、何も残りませんでした');
    else if (performance.now() - t0 > 1500) toast(`${PATHFINDER_LABELS[how]}（${((performance.now() - t0) / 1000).toFixed(1)} 秒）`);
  },
  async offsetDialog() {
    const items = this.shapeItems(1);
    if (!items) return;
    const u = this.doc.data.units, S = this.settings;
    const dist = h('input', { type: 'number', step: 'any', inputmode: 'decimal', value: S.offsetDist ?? +(10 / PT_PER[u]).toFixed(2) });
    const join = h('select', {}, [['miter', 'マイター（とがる）'], ['round', 'ラウンド（丸い）'], ['bevel', 'ベベル（面取り）']].map(([v, l]) => h('option', { value: v }, l)));
    const miter = h('input', { type: 'number', min: 1, step: 0.5, value: S.offsetMiter ?? 4, inputmode: 'decimal' });
    join.value = S.offsetJoin || 'miter';
    const body = h('div', { class: 'form' }, h('label', {}, `ずらす量（${u}、マイナスで内側）`, dist), h('label', {}, '角の形', join), h('label', {}, '比率の上限（マイター）', miter),
      h('p', { class: 'note' }, '元の形はそのまま、ずらした新しい形を後ろに作ります。'));
    if (!await this.modal('パスのオフセット', body, [['キャンセル', false], ['作る', true, 'primary']])) return;
    const d = parseFloat(dist.value);
    if (!d) { toast('0 以外の量にしてください'); return; }
    Object.assign(S, { offsetDist: d, offsetJoin: join.value, offsetMiter: Math.max(1, +miter.value || 4) });
    this.saveSettings();
    const doc = this.doc, out = [];
    try {
      doc.edit('パスのオフセット', () => {
        for (const it of items) {
          const paths = boolPaths(doc, it);
          const sps = offsetSps(paths, d * PT_PER[u], S.offsetJoin, S.offsetMiter);
          if (!sps.length) continue;
          const p = makePath(sps, styleCopy(paths[0].item.style));
          p.fill_rule = 'evenodd';
          const parent = doc.parentOf(it);
          doc.addItem(p, parent, parent.children.indexOf(it));
          out.push(p);
        }
      });
    } catch (e) { console.error(e); toast('計算できませんでした: ' + e.message, 5000); return; }
    if (!out.length) toast('形が残りませんでした（内側にずらしすぎかもしれません）');
    this.select(out);
  },
  outlineStroke() {
    const doc = this.doc, sel = this.selection();
    const targets = [];
    for (const it of topLevel(doc, sel)) for (const x of doc.iterTree([it])) if (x.kind === 'path' && x.style.stroke && x.style.width > 0 && x.paths.length) targets.push(x);
    if (!targets.length) { toast(hasTextIn(doc, sel) ? '文字の線は、先に［アウトラインを作成］してからにしてください' : '線のあるパスを選んでください'); return; }
    if (targets.some((p) => p.style.profile)) toast('可変幅の線は、今は同じ太さとして形にします', 4000);
    const out = [];
    doc.edit('線のアウトライン', () => {
      for (const p of targets) {
        const st = p.style;
        const sps = strokeOutline(p.paths, st.width, st.join || 'miter', st.miter || 10, st.cap || 'butt', st.dash, st.dash_offset || 0);
        if (!sps.length) continue;
        const outline = makePath(sps, newStyle(paintCopy(st.stroke), null, 1));
        outline.fill_rule = 'evenodd';
        let neu = outline;
        if (st.fill) {
          const fillPart = makePath(spsCopy(p.paths), newStyle(paintCopy(st.fill), null, st.width));
          if (p.fill_rule) fillPart.fill_rule = p.fill_rule;
          neu = makeGroup([fillPart, outline]);
          neu.name = itemLabel(p);
        }
        for (const k of ['opacity', 'blend', 'effects']) if (p[k] != null) neu[k] = JSON.parse(JSON.stringify(p[k]));
        const parent = doc.parentOf(p), idx = parent.children.indexOf(p);
        doc.remove(p);
        doc.addItem(neu, parent, idx);
        out.push(neu);
      }
    });
    this.select(out);
  },
  /** 開いたパスを 1 本なら閉じる、2 本なら近い端どうしをつなぐ（exe の join_paths と同じ） */
  joinPaths() {
    const doc = this.doc, paths = topLevel(doc, this.selection()).filter((x) => x.kind === 'path');
    const opens = [];
    for (const p of paths) for (const sp of p.paths) if (!sp.c && sp.n.length >= 2) opens.push([p, sp]);
    if (opens.length !== 1 && opens.length !== 2) { toast('連結するには開いたパスを 1 つか 2 つ選んでください'); return; }
    doc.edit('連結', () => {
      if (opens.length === 1) {
        const [p, s] = opens[0];
        dropShape(p);
        const a = s.n[0], b = s.n[s.n.length - 1];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 0.01 && s.n.length > 2) { a.ix = b.ix; a.iy = b.iy; s.n.pop(); }
        s.c = true;
      } else {
        const [[p1, s1], [p2, s2]] = opens;
        let best = null;
        for (const r1 of [false, true]) for (const r2 of [false, true]) {
          const e1 = r1 ? s1.n[0] : s1.n[s1.n.length - 1], e2 = r2 ? s2.n[s2.n.length - 1] : s2.n[0];
          const dd = Math.hypot(e1.x - e2.x, e1.y - e2.y);
          if (!best || dd < best[0]) best = [dd, r1, r2];
        }
        const a = spCopy(s1), b = spCopy(s2);
        if (best[1]) spReverse(a);
        if (best[2]) spReverse(b);
        const end = a.n[a.n.length - 1], start = b.n[0];
        if (Math.hypot(end.x - start.x, end.y - start.y) < 0.01) { end.ox = start.ox; end.oy = start.oy; b.n.shift(); }
        const joined = { n: [...a.n, ...b.n], c: false };
        dropShape(p1);
        p1.paths = [...p1.paths.filter((s) => s !== s1 && s !== s2), joined];
        if (p2 !== p1) { p2.paths = p2.paths.filter((s) => s !== s2); if (!p2.paths.length) doc.remove(p2); }
      }
      doc.touch();
    });
    this.select(this.selection());
  },
  releaseCompound() {
    const doc = this.doc, out = [];
    const targets = topLevel(doc, this.selection()).filter((x) => x.kind === 'path' && x.paths.length > 1);
    if (!targets.length) { toast('複合パスを選んでください'); return; }
    doc.edit('複合パスの解除', () => {
      for (const it of targets) {
        const parent = doc.parentOf(it);
        let idx = parent.children.indexOf(it);
        doc.remove(it);
        for (const s of it.paths) {
          const p = makePath([spCopy(s)], styleCopy(it.style));
          doc.addItem(p, parent, idx++);
          out.push(p);
        }
      }
    });
    this.select(out);
  },
  reversePaths() {
    const paths = [];
    for (const it of this.selection()) for (const x of this.doc.iterTree([it])) if (x.kind === 'path') paths.push(x);
    if (!paths.length) { toast('パスを選んでください'); return; }
    this.doc.edit('パスの方向を反転', () => { for (const p of paths) { dropShape(p); p.paths.forEach(spReverse); } this.doc.touch(); });
  },
});

// ---- シェイプ形成ツール（Shift+M）: 重なりで分けた領域をなぞって合体、消すモードでは削除 -----------------------
class ShapeBuilderTool {
  constructor(app) { this.app = app; this.cache = null; this.hot = null; this.st = null; this.showsBBox = false; }
  get doc() { return this.app.doc; }
  regions() {
    const app = this.app, doc = this.doc;
    const items = sortByOrder(doc, topLevel(doc, app.selection())).filter((it) => boolPaths(doc, it).length);
    const key = doc.version + ':' + items.map((i) => i.id).join(',');
    if (this.cache && this.cache.key === key) return this.cache;
    if (items.length < 1) { this.cache = { key, items, regs: [] }; return this.cache; }
    const res = divideRegions(doc, items);
    for (const r of res.regs) {
      r.path = spsPath2D(r.sps);
      r.bbox = spsBBox(r.sps);
    }
    this.cache = { key, items, ...res, styles: items.map((it) => boolPaths(doc, it)[0].item.style) };
    return this.cache;
  }
  activate() {
    if (!this.app.selection().length) toast('先に形を 2 つ以上選んでから、なぞって合体・押して分割します');
    this.cache = null;
  }
  at(x, y) {
    const c = this.regions();
    for (let i = c.regs.length - 1; i >= 0; i--) {
      const r = c.regs[i], b = r.bbox;
      if (b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && _hitCtx.isPointInPath(r.path, x, y, 'evenodd')) return i;
    }
    return -1;
  }
  hover(x, y) { const i = this.at(x, y); if (i !== this.hot) { this.hot = i; this.app.view.request(); } }
  down(x, y, e) {
    const del = e.altKey || !!this.app.settings.sbDelete;
    const i = this.at(x, y);
    this.st = { set: new Set(i >= 0 ? [i] : []), del };
    this.app.view.request();
  }
  drag(x, y) {
    if (!this.st) return;
    const i = this.at(x, y);
    if (i >= 0 && !this.st.set.has(i)) { this.st.set.add(i); this.app.view.request(); }
    this.hot = i;
  }
  up() {
    const st = this.st;
    this.st = null;
    if (!st || !st.set.size) { this.app.view.request(); return; }
    const c = this.regions(), doc = this.doc, app = this.app;
    const pick = [...st.set];
    const out = [];
    doc.edit('シェイプ形成', () => {
      c.regs.forEach((r, i) => {
        if (st.set.has(i)) return;
        const p = makePath(spsCopy(r.sps), styleCopy(c.styles[r.top]));
        p.fill_rule = 'evenodd';
        out.push(p);
      });
      if (!st.del) {
        const faces = new Set();
        for (const i of pick) for (const f of c.regs[i].faces) faces.add(f);
        const sps = loopsToSps(c.A, extractLoops(c.A, (f, k) => faces.has(k)), c.segs);
        if (sps.length) {
          const m = makePath(sps, styleCopy(c.styles[c.regs[pick[0]].top]));
          m.fill_rule = 'evenodd';
          out.push(m);
        }
      }
      if (out.length) replaceItems(doc, c.items, out); else OPS.remove(doc, c.items);
    });
    this.cache = null;
    app.select(out);
    this.hot = -1;
  }
  cancel() { this.st = null; this.app.view.request(); }
  paint(ctx) {
    const c = this.cache, v = this.app.view;
    if (!c || !c.regs) return;
    const vm = new DOMMatrix([v.zoom, 0, 0, v.zoom, v.ox, v.oy]);
    const draw = (i, fill) => {
      const r = c.regs[i]; if (!r) return;
      const p = new Path2D(); p.addPath(r.path, vm);
      ctx.fillStyle = fill; ctx.fill(p, 'evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.setLineDash([3, 3]); ctx.stroke(p); ctx.setLineDash([]);
    };
    // 領域の境目を薄く
    ctx.strokeStyle = 'rgba(79,124,255,0.6)';
    for (const r of c.regs) { const p = new Path2D(); p.addPath(r.path, vm); ctx.stroke(p); }
    const del = this.st ? this.st.del : !!this.app.settings.sbDelete;
    const col = del ? 'rgba(255,70,70,0.45)' : 'rgba(79,124,255,0.35)';
    if (this.st) for (const i of this.st.set) draw(i, col);
    else if (this.hot >= 0) draw(this.hot, col);
  }
}
