/* 線工房 Web — 文書モデル。exe の .snk の document.json と同じ形の dict をそのまま扱う。

   item.kind: path / group / layer / text / image。重ね順は children の 0 番が一番下。
   パスの錨点だけメモリでは {x, y, ix, iy, ox, oy, s}（unpack / pack で exe の配列と行き来）。
   取り消しは文書全体の JSON（pack した形）のスナップショット。
*/
'use strict';

const PRESETS = {
  'A4': [210, 297, 'mm', 'cmyk'], 'A3': [297, 420, 'mm', 'cmyk'], 'A5': [148, 210, 'mm', 'cmyk'], 'B5': [182, 257, 'mm', 'cmyk'],
  'B4': [257, 364, 'mm', 'cmyk'], 'はがき': [100, 148, 'mm', 'cmyk'], '名刺': [91, 55, 'mm', 'cmyk'],
  'ロゴ（1000px）': [1000, 1000, 'px', 'rgb'], 'アイコン（1024px）': [1024, 1024, 'px', 'rgb'],
  'Web（1920×1080）': [1920, 1080, 'px', 'rgb'], 'SNS 正方形（1080px）': [1080, 1080, 'px', 'rgb'],
  'X ヘッダー（1500×500）': [1500, 500, 'px', 'rgb'], 'YouTube サムネイル': [1280, 720, 'px', 'rgb'],
};
const LAYER_COLORS = ['#4f7cff', '#ff4f4f', '#3fbf5f', '#3fa0ff', '#ff8a3f', '#c05fff', '#20c0c0', '#ffc020'];
const BLEND_MODES = [['normal', '通常'], ['multiply', '乗算'], ['screen', 'スクリーン'], ['overlay', 'オーバーレイ'],
  ['darken', '比較（暗）'], ['lighten', '比較（明）'], ['color-dodge', '覆い焼きカラー'], ['color-burn', '焼き込みカラー'],
  ['hard-light', 'ハードライト'], ['soft-light', 'ソフトライト'], ['difference', '差の絶対値'], ['exclusion', '除外']];
const KIND_LABEL = { path: 'パス', group: 'グループ', layer: 'レイヤー', text: '文字', image: '画像' };
const SHAPE_LABEL = { rect: '長方形', ellipse: '楕円', polygon: '多角形', star: 'スター', line: '直線' };

// ---- pack / unpack -----------------------------------------------------------------------
function unpackItem(it) {
  if (it.paths) for (const sp of it.paths) sp.n = sp.n.map((v) => (Array.isArray(v) ? nodeFromList(v) : v));
  if (it.frame) for (const sp of it.frame) sp.n = sp.n.map((v) => (Array.isArray(v) ? nodeFromList(v) : v));
  if (it.children) it.children.forEach(unpackItem);
  return it;
}
function packItem(it) {
  const o = { ...it };
  if (it.paths) o.paths = it.paths.map((sp) => ({ n: sp.n.map(nodeToList), c: sp.c ? 1 : 0 }));
  if (it.frame) o.frame = it.frame.map((sp) => ({ n: sp.n.map(nodeToList), c: sp.c ? 1 : 0 }));
  if (it.children) o.children = it.children.map(packItem);
  for (const k of Object.keys(o)) if (k.startsWith('_')) delete o[k];
  return o;
}

// ---- 作る ------------------------------------------------------------------------------
function newStyle(fill, stroke, width = 1) {
  return { fill: fill ?? null, stroke: stroke ?? null, width };
}
function makePath(paths, style) { return { kind: 'path', id: 0, style: style || newStyle(hexColor('#ffffff'), hexColor('#000000')), paths }; }
function makeShape(shape, style, matrix) {
  const it = { kind: 'path', id: 0, style, paths: [], shape: { ...shape } };
  if (matrix && !M.isI(matrix)) it.shape_matrix = M.round(matrix);
  rebuildShape(it);
  return it;
}
function rebuildShape(it) {
  if (!it.shape) return;
  const sps = shapeSubpaths(it.shape);
  if (it.shape_matrix) spsTransform(sps, it.shape_matrix);
  it.paths = sps;
}
function dropShape(it) { delete it.shape; delete it.shape_matrix; }
function makeText(text, font, size, style) {
  return { kind: 'text', id: 0, text, font, size, style: style || newStyle(hexColor('#000000'), null), matrix: M.I() };
}
function makeGroup(children = []) { return { kind: 'group', id: 0, children }; }

// ---- 文書 ------------------------------------------------------------------------------
class Doc {
  constructor(data, images = {}) {
    this.data = data;
    this.images = images;           // id → Uint8Array
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.depth = 0;
    this.version = 0;
    this.dirty = false;
    this.listeners = [];
    this._pv = -1;
    unpackAll(this.data);
  }

  static create(w = 595.28, h = 841.89, mode = 'rgb', units = 'mm', count = 1) {
    const abs = [];
    for (let i = 0; i < Math.max(1, count); i++) abs.push({ name: `アートボード ${i + 1}`, x: i * (w + 40), y: 0, w, h });
    const data = { format: 'senkobo', version: 1, artboards: abs,
      layers: [{ kind: 'layer', id: 1, name: 'レイヤー 1', children: [], color: LAYER_COLORS[0] }],
      current_layer: 1, color_mode: mode, units, swatches: defaultSwatches(mode), bleed: 0, meta: {}, next_id: 2,
      guides: [], grid: { size: 72 / 25.4 * 10, div: 4 } };
    return new Doc(data);
  }
  static fromPreset(name, count = 1) {
    const [w, h, u, mode] = PRESETS[name];
    return Doc.create(w * PT_PER[u], h * PT_PER[u], mode, u, count);
  }

  get layers() { return this.data.layers; }
  get artboards() { return this.data.artboards; }
  newId() { return this.data.next_id++; }
  touch() { this.version++; GEO_EPOCH++; }

  // ---- 探す
  *iterTree(items = this.data.layers) {
    for (const it of items) {
      yield it;
      if (it.children) yield* this.iterTree(it.children);
    }
  }
  parents() {
    if (this._pv !== this.version || !this._parents) {
      this._parents = new Map();
      this._byId = new Map();
      const walk = (arr, parent) => { for (const it of arr) { this._parents.set(it, parent); this._byId.set(it.id, it); if (it.children) walk(it.children, it); } };
      walk(this.data.layers, null);
      this._pv = this.version;
    }
    return this._parents;
  }
  parentOf(it) { return this.parents().get(it) || null; }
  find(id) { this.parents(); return this._byId.get(id) || null; }
  siblings(it) { const p = this.parentOf(it); return p ? p.children : this.data.layers; }
  layerOf(it) { let p = it; while (p && p.kind !== 'layer') p = this.parentOf(p); return p; }
  isLocked(it) { for (let p = it; p; p = this.parentOf(p)) if (p.locked) return true; return false; }
  isVisible(it) { for (let p = it; p; p = this.parentOf(p)) if (p.visible === false) return false; return true; }
  currentLayer() {
    const l = this.find(this.data.current_layer);
    if (l && l.kind === 'layer') return l;
    const top = this.data.layers[this.data.layers.length - 1];
    this.data.current_layer = top.id;
    return top;
  }
  drawTarget() {
    const id = this.data.meta && this.data.meta.draw_target;
    const g = id ? this.find(id) : null;
    return g && g.symmetry && this.isVisible(g) && !this.isLocked(g) ? g : null;
  }
  assignIds(it) {
    this.parents();
    for (const x of this.iterTree([it])) if (!x.id || (this._byId.has(x.id) && this._byId.get(x.id) !== x)) x.id = this.newId();
  }
  addItem(it, parent = null, index = null) {
    const tgt = parent || this.drawTarget() || this.currentLayer();
    this.assignIds(it);
    if (index == null) tgt.children.push(it); else tgt.children.splice(index, 0, it);
    this.touch();
    return it;
  }
  remove(it) {
    const sib = this.siblings(it);
    const i = sib.indexOf(it);
    if (i >= 0) sib.splice(i, 1);
    this.touch();
  }
  addLayer(name) {
    const n = this.data.layers.length;
    const l = { kind: 'layer', id: this.newId(), name: name || `レイヤー ${n + 1}`, children: [], color: LAYER_COLORS[n % LAYER_COLORS.length] };
    const cur = this.currentLayer();
    this.data.layers.splice(this.data.layers.indexOf(cur) + 1, 0, l);
    this.data.current_layer = l.id;
    this.touch();
    return l;
  }
  artboardAt(x, y) {
    const abs = this.data.artboards;
    for (let i = 0; i < abs.length; i++) { const a = abs[i]; if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return i; }
    return 0;
  }

  // ---- 保存の形
  pack() { const d = { ...this.data, layers: this.data.layers.map(packItem) }; return d; }
  snapshot() { return JSON.stringify(this.pack()); }
  restore(s) { this.data = JSON.parse(s); unpackAll(this.data); this.touch(); }

  // ---- 取り消し
  begin(label, merge = null) {
    if (this.depth === 0) this.pending = { label, snap: this.snapshot(), merge };
    this.depth++;
  }
  commit() {
    if (this.depth === 0) return;
    this.depth--;
    if (this.depth === 0 && this.pending) {
      const now = performance.now();
      const last = this._lastMerge || {};
      if (!(this.pending.merge && last.key === this.pending.merge && now - last.t < 1500 && this.undoStack.length)) {
        this.undoStack.push({ label: this.pending.label, snap: this.pending.snap });
        if (this.undoStack.length > 150) this.undoStack.shift();
        let total = this.undoStack.reduce((s, e) => s + e.snap.length, 0);
        while (this.undoStack.length > 5 && total > 8e7) total -= this.undoStack.shift().snap.length;
      }
      this._lastMerge = { key: this.pending.merge, t: now };
      this.redoStack = [];
      this.pending = null;
      this.dirty = true;
      this.touch();
      this.emit('changed');
    }
  }
  cancel() {
    if (this.depth === 0) return;
    this.depth = 0;
    if (this.pending) this.restore(this.pending.snap);
    this.pending = null;
    this.emit('changed');
  }
  edit(label, fn, merge = null) {
    this.begin(label, merge);
    try { fn(); } catch (e) { this.depth = 1; this.cancel(); throw e; }
    this.commit();
  }
  inEdit() { return this.depth > 0; }
  undo() {
    if (!this.undoStack.length || this.depth) return false;
    const e = this.undoStack.pop();
    this.redoStack.push({ label: e.label, snap: this.snapshot() });
    this.restore(e.snap);
    this._lastMerge = null;
    this.dirty = true;
    this.emit('undo');
    return true;
  }
  redo() {
    if (!this.redoStack.length || this.depth) return false;
    const e = this.redoStack.pop();
    this.undoStack.push({ label: e.label, snap: this.snapshot() });
    this.restore(e.snap);
    this.dirty = true;
    this.emit('undo');
    return true;
  }
  emit(kind) { for (const f of this.listeners.slice()) f(kind); }
}
function unpackAll(data) { data.layers.forEach(unpackItem); }

// ---- 項目の計算 ---------------------------------------------------------------------------
function itemLabel(it) {
  if (it.name) return it.name;
  if (it.kind === 'path') return it.shape ? (SHAPE_LABEL[it.shape.kind] || 'パス') : (it.paths.length > 1 ? '複合パス' : 'パス');
  if (it.kind === 'text') { const t = (it.text || '').replace(/\n/g, ' ').trim(); return t ? (t.length > 16 ? t.slice(0, 16) + '…' : t) : '文字'; }
  if (it.kind === 'group' && it.symmetry) return '対称グループ';
  if (it.kind === 'group' && it.clip) return 'クリップグループ';
  return KIND_LABEL[it.kind] || it.kind;
}
function itemBBox(it) {
  if (it.visible === false) return null;
  if (it.kind === 'path') { if (!it._bb || it._bb.e !== GEO_EPOCH) it._bb = { e: GEO_EPOCH, b: spsBBox(it.paths) }; return it._bb.b; }
  if (it.kind === 'text') {
    const b = textLocalBBox(it);
    return b ? mapBBox(it.matrix, b) : null;
  }
  if (it.kind === 'image') return mapBBox(it.matrix, [0, 0, it.pw, it.ph]);
  if (it.children) {
    if (it.clip && it.children.length) return itemBBox(it.children[it.children.length - 1]);
    let b = unionBBox(it.children.map(itemBBox));
    if (b && it.symmetry) b = unionBBox([b, ...symmetryMatrices(it.symmetry).map((m) => mapBBox(m, b))]);
    return b;
  }
  return null;
}
function itemVisualBBox(it) {
  const b = itemBBox(it);
  if (!b || it.kind !== 'path' || !it.style.stroke) return b;
  const w = it.style.width / 2 * ((it.style.join || 'miter') === 'miter' ? 1.5 : 1);
  return [b[0] - w, b[1] - w, b[2] + w, b[3] + w];
}
function mapBBox(m, b) {
  const pts = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([x, y]) => M.map(m, x, y));
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}
function styleTransform(st, m, scaleStrokes) {
  if (!st) return;
  for (const p of [st.fill, st.stroke, ...(st.extra || []).map((e) => e.paint)]) {
    if (isGradient(p)) { p.p0 = M.map(m, ...p.p0); p.p1 = M.map(m, ...p.p1); }
  }
  if (scaleStrokes) {
    const s = M.scale(m);
    st.width *= s;
    if (st.dash) st.dash = st.dash.map((d) => d * s);
    for (const e of st.extra || []) e.width *= s;
  }
}
function itemTransform(it, m, scaleStrokes = false) {
  if (it.kind === 'path') {
    if (it.shape) { it.shape_matrix = M.round(M.then(it.shape_matrix || M.I(), m)); rebuildShape(it); }
    else spsTransform(it.paths, m);
    styleTransform(it.style, m, scaleStrokes);
  } else if (it.kind === 'text') {
    it.matrix = M.round(M.then(it.matrix || M.I(), m));
    styleTransform(it.style, m, scaleStrokes);
    absorbFrame(it);
  } else if (it.kind === 'image') {
    it.matrix = M.round(M.then(it.matrix || M.I(), m));
  } else if (it.children) {
    for (const c of it.children) itemTransform(c, m, scaleStrokes);
    if (it.symmetry) { [it.symmetry.cx, it.symmetry.cy] = M.map(m, it.symmetry.cx || 0, it.symmetry.cy || 0); }
  }
  if (it.effects && scaleStrokes) {
    const s = M.scale(m);
    for (const e of it.effects) for (const k of ['dx', 'dy', 'blur', 'radius']) if (k in e) e[k] *= s;
  }
}
/** エリア内文字・パス上文字は拡大縮小を枠に移す（exe の absorb_frame と同じ） */
function absorbFrame(it) {
  if (!it.frame || !it.frame.length || (it.text_kind || 'point') === 'point') return;
  const m = it.matrix;
  if (it.text_kind === 'path') { spsTransform(it.frame, m); it.matrix = M.I(); return; }
  if (Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && m[0] > 0 && m[3] > 0 && (Math.abs(m[0] - 1) > 1e-9 || Math.abs(m[3] - 1) > 1e-9)) {
    spsTransform(it.frame, M.s(m[0], m[3]));
    it.matrix = M.t(m[4], m[5]);
  }
}
function cloneItem(it, doc) {
  const c = unpackItem(JSON.parse(JSON.stringify(packItem(it))));
  if (doc) for (const x of doc.iterTree([c])) x.id = doc.newId();
  return c;
}
function topLevel(doc, items) {
  const set = new Set(items);
  return items.filter((it) => { for (let p = doc.parentOf(it); p; p = doc.parentOf(p)) if (set.has(p)) return false; return true; });
}
function orderKey(doc, it) {
  const chain = [];
  for (let x = it; x;) { const p = doc.parentOf(x); chain.unshift((p ? p.children : doc.layers).indexOf(x)); x = p; }
  return chain;
}
function sortByOrder(doc, items) {
  return items.slice().sort((a, b) => {
    const ka = orderKey(doc, a), kb = orderKey(doc, b);
    for (let i = 0; i < Math.min(ka.length, kb.length); i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return ka.length - kb.length;
  });
}
function selectionBBox(items, visual = false) { return unionBBox(items.map(visual ? itemVisualBBox : itemBBox)); }

// ---- 対称（exe の beyond.symmetry_matrices と同じ）-------------------------------------------
function symmetryMatrices(sym) {
  if (!sym) return [];
  const cx = sym.cx || 0, cy = sym.cy || 0, mode = sym.mode || 'v';
  if (mode === 'v') return [M.s(-1, 1, cx, cy)];
  if (mode === 'h') return [M.s(1, -1, cx, cy)];
  if (mode === 'vh') return [M.s(-1, 1, cx, cy), M.s(1, -1, cx, cy), M.s(-1, -1, cx, cy)];
  const n = Math.max(2, sym.n || 6), out = [];
  for (let k = 1; k < n; k++) out.push(M.r(360 * k / n, cx, cy));
  if (sym.mirror) { const mir = M.s(-1, 1, cx, cy); for (let k = 0; k < n; k++) out.push(M.then(mir, M.r(360 * k / n, cx, cy))); }
  return out;
}

// ---- 操作 ------------------------------------------------------------------------------
const OPS = {
  group(doc, items) {
    items = sortByOrder(doc, topLevel(doc, items));
    if (!items.length) return null;
    const top = items[items.length - 1], sib = doc.siblings(top);
    let idx = sib.indexOf(top);
    for (const it of items) { const s = doc.siblings(it), i = s.indexOf(it); if (s === sib && i < idx) idx--; s.splice(i, 1); }
    const g = makeGroup(items);
    g.id = doc.newId();
    sib.splice(idx + 1, 0, g);
    doc.touch();
    return g;
  },
  ungroup(doc, items) {
    const out = [];
    for (const it of topLevel(doc, items)) {
      if (it.kind === 'group') {
        const sib = doc.siblings(it), idx = sib.indexOf(it);
        sib.splice(idx, 1, ...it.children);
        if (it.opacity != null && it.opacity !== 1) for (const k of it.children) k.opacity = (k.opacity ?? 1) * it.opacity;
        out.push(...it.children);
      } else out.push(it);
    }
    doc.touch();
    return out;
  },
  arrange(doc, items, how) {
    const groups = new Map();
    for (const it of topLevel(doc, items)) { const s = doc.siblings(it); if (!groups.has(s)) groups.set(s, []); groups.get(s).push(it); }
    for (const [ch, lst] of groups) {
      const sel = lst.slice().sort((a, b) => ch.indexOf(a) - ch.indexOf(b));
      if (how === 'front' || how === 'back') {
        for (const it of sel) ch.splice(ch.indexOf(it), 1);
        if (how === 'front') ch.push(...sel); else ch.unshift(...sel);
      } else if (how === 'forward') {
        for (const it of sel.slice().reverse()) { const i = ch.indexOf(it); if (i + 1 < ch.length && !sel.includes(ch[i + 1])) [ch[i], ch[i + 1]] = [ch[i + 1], ch[i]]; }
      } else if (how === 'backward') {
        for (const it of sel) { const i = ch.indexOf(it); if (i > 0 && !sel.includes(ch[i - 1])) [ch[i], ch[i - 1]] = [ch[i - 1], ch[i]]; }
      }
    }
    doc.touch();
  },
  duplicate(doc, items, dx = 0, dy = 0) {
    const out = [];
    for (const it of sortByOrder(doc, topLevel(doc, items))) {
      const c = cloneItem(it, doc), sib = doc.siblings(it);
      sib.splice(sib.indexOf(it) + 1, 0, c);
      if (dx || dy) itemTransform(c, M.t(dx, dy));
      out.push(c);
    }
    doc.touch();
    return out;
  },
  remove(doc, items) { for (const it of topLevel(doc, items)) doc.remove(it); },
  align(doc, items, how, ab) {
    items = topLevel(doc, items);
    const ref = items.length > 1 ? selectionBBox(items, true) : [ab.x, ab.y, ab.x + ab.w, ab.y + ab.h];
    for (const it of items) {
      const b = itemVisualBBox(it);
      if (!b) continue;
      let dx = 0, dy = 0;
      if (how === 'left') dx = ref[0] - b[0];
      else if (how === 'right') dx = ref[2] - b[2];
      else if (how === 'hcenter') dx = (ref[0] + ref[2]) / 2 - (b[0] + b[2]) / 2;
      else if (how === 'top') dy = ref[1] - b[1];
      else if (how === 'bottom') dy = ref[3] - b[3];
      else if (how === 'vcenter') dy = (ref[1] + ref[3]) / 2 - (b[1] + b[3]) / 2;
      if (dx || dy) itemTransform(it, M.t(dx, dy));
    }
    doc.touch();
  },
  distribute(doc, items, how) {
    items = topLevel(doc, items).filter((i) => itemVisualBBox(i));
    if (items.length < 3) return;
    const h = how === 'h', k0 = h ? 0 : 1, k1 = h ? 2 : 3;
    const box = new Map(items.map((i) => [i, itemVisualBBox(i)]));
    items.sort((a, b) => box.get(a)[k0] - box.get(b)[k0]);
    const total = items.reduce((s, i) => s + box.get(i)[k1] - box.get(i)[k0], 0);
    const start = box.get(items[0])[k0], end = Math.max(...items.map((i) => box.get(i)[k1]));
    const gap = (end - start - total) / (items.length - 1);
    let pos = start;
    for (const it of items) {
      const b = box.get(it), d = pos - b[k0];
      itemTransform(it, h ? M.t(d, 0) : M.t(0, d));
      pos += b[k1] - b[k0] + gap;
    }
    doc.touch();
  },
  makeCompound(doc, items) {
    items = sortByOrder(doc, topLevel(doc, items));
    const paths = [];
    for (const it of items) for (const x of doc.iterTree([it])) if (x.kind === 'path') paths.push(x);
    if (paths.length < 1) return null;
    const res = makePath(paths.flatMap((p) => spsCopy(p.paths)), JSON.parse(JSON.stringify(paths[0].style)));
    res.fill_rule = 'evenodd';
    const top = items[items.length - 1], sib = doc.siblings(top);
    sib.splice(sib.indexOf(top) + 1, 0, res);
    doc.assignIds(res);
    for (const it of items) doc.remove(it);
    return res;
  },
  makeClip(doc, items) {
    items = sortByOrder(doc, topLevel(doc, items));
    if (items.length < 2) return null;
    const mask = items[items.length - 1];
    const g = OPS.group(doc, items);
    g.clip = true;
    if (mask.kind === 'path') { mask.style.fill = null; mask.style.stroke = null; }
    return g;
  },
};
