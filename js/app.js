/* 線工房 Web — アプリ本体: 作品ギャラリー・編集画面・操作・書き出し・自動保存・キーボード。 */
'use strict';

const SETTINGS_DEFAULT = {
  snap: true, keepRatio: false, scaleStrokes: false, fingerDraws: true, pencilSmooth: 3, cornerRadius: 12,
  sides: 6, points: 5, starRatio: 0.5, font: 'Yu Gothic', fontSize: 24, fontStyle: '', vertical: false, panelTab: 'prop',
  panelOpen: true, textOnShapes: true, abMoveArt: true, refPoint: 'tl',
};

class App {
  constructor() {
    this.settings = { ...SETTINGS_DEFAULT };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(LS + 'settings') || '{}')); } catch { /* 壊れていたら既定値 */ }
    this.doc = null;
    this.sel = [];
    this.anchorSel = new Set();
    this.expanded = new Set();
    this.collapsed = new Set();
    this.colorTarget = 'fill';
    this.curStyle = { fill: hexColor('#ffffff'), stroke: hexColor('#000000'), width: 1 };
    this.clip = null;
    this.space = false;
    this.outlineMode = false;
    this.editing = null;
    this.curArtboard = 0;
    this.touchy = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    this.renderer = new Renderer(null, () => this.view.request());
    this.view = new View(this, $('#cv'));
    this.tools = makeTools(this);
    this.toolName = 'select';
    this.tool = this.tools.select;
    this.panels = new Panels(this);
    this.bindUI();
    this.bindKeys();
    this.showGallery();
  }
  saveSettings() { try { localStorage.setItem(LS + 'settings', JSON.stringify(this.settings)); } catch { /* 入れられなくても動く */ } }
  handleSize() { return this.touchy ? 12 : 8; }

  // ---- 画面の切り替え ------------------------------------------------------------------
  async showGallery() {
    if (this.doc) await this.closeDoc();
    $('#editor').hidden = true;
    $('#gallery').hidden = false;
    document.title = '線工房 Web';
    await this.refreshGallery();
  }
  async refreshGallery() {
    const list = $('#g-list');
    let works = [];
    try { works = await Store.list(); } catch (e) { toast('作品を読めませんでした: ' + e.message); }
    list.textContent = '';
    $('#g-empty').hidden = works.length > 0;
    for (const w of works) {
      const card = h('div', { class: 'card' },
        h('button', { class: 'card-thumb', onclick: () => this.openWork(w.id) }, w.thumb ? h('img', { src: w.thumb, alt: '' }) : ''),
        h('div', { class: 'card-foot' },
          h('div', { class: 'card-name' }, w.name),
          h('div', { class: 'card-date' }, new Date(w.updated).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })),
          h('button', { class: 'card-more', title: 'その他', onclick: (e) => this.cardMenu(e.currentTarget, w) }, '⋯')));
      list.append(card);
    }
  }
  cardMenu(anchor, w) {
    this.popup(anchor, [
      ['開く', () => this.openWork(w.id)],
      ['名前を変える', async () => { const n = prompt('作品の名前', w.name); if (n && n.trim()) { await Store.rename(w.id, n.trim()); this.refreshGallery(); } }],
      ['複製', async () => { const d = await Store.load(w.id); d.workId = null; d.name = w.name + ' のコピー'; await Store.save(d, w.thumb); this.refreshGallery(); }],
      ['.snk で書き出す', async () => { const d = await Store.load(w.id); await this.exportSnk(d); }],
      null,
      ['削除', async () => { if (confirm(`「${w.name}」を削除しますか？（元に戻せません）`)) { await Store.remove(w.id); this.refreshGallery(); } }, 'danger'],
    ]);
  }
  async openWork(id) {
    try { this.openDoc(await Store.load(id)); } catch (e) { toast('開けませんでした: ' + e.message); }
  }
  openDoc(doc) {
    this.doc = doc;
    this.renderer.doc = doc;
    this.sel = [];
    this.anchorSel.clear();
    this.collapsed.clear(); this.expanded.clear();
    doc.listeners.push((kind) => this.onDocChange(kind));
    if (doc.data.color_mode === 'cmyk') { this.curStyle.fill = toCMYK(this.curStyle.fill || hexColor('#ffffff')); if (this.curStyle.stroke) this.curStyle.stroke = toCMYK(this.curStyle.stroke); }
    $('#gallery').hidden = true;
    $('#editor').hidden = false;
    $('#doc-name').value = doc.name || '名称未設定';
    document.title = (doc.name || '名称未設定') + ' — 線工房 Web';
    this.applyPanelOpen();
    this.view.resize();
    this.setTool('select');
    requestAnimationFrame(() => { this.view.resize(); this.view.fitArtboard(0); });
    this.panels.refresh();
  }
  async closeDoc() {
    if (this.editing) this.endTextEdit();
    this.tools.pen.finish();
    await this.saveNow();
    this.doc = null;
    this.renderer.doc = null;
  }
  onDocChange(kind) {
    if (kind === 'undo') {
      this.anchorSel = new Set([...this.anchorSel].filter((k) => { const [id, si, ni] = k.split(':').map(Number), p = this.doc.find(id); return p && p.paths && p.paths[si] && p.paths[si].n[ni]; }));
      if (this.editing) { this.editing = null; $('#textdock').hidden = true; }
    }
    this.view.request();
    this.panels.refreshSoon();
    this.scheduleSave();
  }

  // ---- 保存 ------------------------------------------------------------------------
  scheduleSave() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.saveNow(), 1500);
  }
  async saveNow() {
    clearTimeout(this._saveT);
    const doc = this.doc;
    if (!doc || doc.inEdit()) { if (doc) this.scheduleSave(); return; }
    if (!doc.dirty && doc.workId) return;
    try {
      const thumb = await this.thumbnail(doc, 360, 'image/jpeg');
      await Store.save(doc, thumb);
      doc.dirty = false;
    } catch (e) { toast('保存できませんでした: ' + e.message, 5000); }
  }
  async thumbnail(doc, size, type) {
    await preloadImages(doc);
    const a = doc.artboards[0];
    const sc = size / Math.max(a.w, a.h);
    const cv = renderToCanvas(doc, [a.x, a.y, a.x + a.w, a.y + a.h], sc, '#ffffff');
    if (type === 'blob') return new Uint8Array(await (await canvasToBlob(cv)).arrayBuffer());
    return cv.toDataURL(type, 0.82);
  }

  // ---- 新規・開く ------------------------------------------------------------------------
  async newDocDialog() {
    const presetSel = h('select', {}, h('option', { value: '' }, 'サイズを入力'), Object.keys(PRESETS).map((k) => h('option', { value: k }, k)));
    const w = h('input', { type: 'number', value: 1000, min: 1, step: 'any', inputmode: 'decimal' });
    const hh = h('input', { type: 'number', value: 1000, min: 1, step: 'any', inputmode: 'decimal' });
    const unit = h('select', {}, [['px', 'px'], ['mm', 'mm'], ['pt', 'pt']].map(([v, l]) => h('option', { value: v }, l)));
    const mode = h('select', {}, h('option', { value: 'rgb' }, 'RGB（画面・Web）'), h('option', { value: 'cmyk' }, 'CMYK（印刷）'));
    const count = h('input', { type: 'number', value: 1, min: 1, max: 50, step: 1, inputmode: 'numeric' });
    const name = h('input', { type: 'text', value: '名称未設定' });
    presetSel.value = 'ロゴ（1000px）';
    const sync = () => {
      const p = PRESETS[presetSel.value];
      if (p) { w.value = p[0]; hh.value = p[1]; unit.value = p[2]; mode.value = p[3]; }
    };
    presetSel.addEventListener('change', sync);
    sync();
    const body = h('div', { class: 'form' },
      h('label', {}, '名前', name), h('label', {}, '用途', presetSel),
      h('div', { class: 'form-row' }, h('label', {}, '幅', w), h('label', {}, '高さ', hh), h('label', {}, '単位', unit)),
      h('label', {}, 'カラー', mode), h('label', {}, 'アートボードの数', count));
    const ok = await this.modal('新しい作品', body, [['キャンセル', false], ['作る', true, 'primary']]);
    if (!ok) return;
    const u = unit.value, W = parseFloat(w.value), H = parseFloat(hh.value);
    if (!(W > 0 && H > 0)) { toast('大きさが正しくありません'); return; }
    const doc = Doc.create(W * PT_PER[u], H * PT_PER[u], mode.value, u, Math.max(1, Math.min(50, parseInt(count.value, 10) || 1)));
    doc.name = name.value.trim() || '名称未設定';
    doc.dirty = true;
    await Store.save(doc, await this.thumbnail(doc, 360, 'image/jpeg'));
    this.openDoc(doc);
  }
  async openFileFromGallery() {
    const f = await pickFile('');
    if (!f) return;
    try {
      let doc;
      if (/\.snk$/i.test(f.name) || (await sniffZip(f))) {
        doc = await snkToDoc(f);
        doc.name = f.name.replace(/\.snk$/i, '');
      } else if (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name)) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const bmp = await createImageBitmap(new Blob([bytes]));
        doc = Doc.create(bmp.width, bmp.height, 'rgb', 'px', 1);
        doc.name = f.name.replace(/\.[^.]+$/, '');
        const key = await sha1hex(bytes);
        doc.images[key] = bytes;
        doc.addItem({ kind: 'image', id: 0, image: key, pw: bmp.width, ph: bmp.height, matrix: M.I() });
      } else { toast('線工房の .snk か画像を選んでください'); return; }
      doc.dirty = true;
      await Store.save(doc, await this.thumbnail(doc, 360, 'image/jpeg'));
      this.openDoc(doc);
    } catch (e) { toast('開けませんでした: ' + e.message, 5000); }
  }

  // ---- 選択 ------------------------------------------------------------------------
  selection() {
    if (!this.doc) return [];
    const out = [];
    for (const id of this.sel) { const it = this.doc.find(id); if (it && it.kind !== 'layer' && this.doc.isVisible(it) && !this.doc.isLocked(it)) out.push(it); }
    return out;
  }
  select(items, keepAnchors = false) {
    this.sel = [...new Set(items.filter(Boolean).map((x) => x.id))];
    if (!keepAnchors) this.anchorSel.clear();
    this.view.hover = null;
    this.view.request();
    this.panels.refresh();
    if (this.toolName === 'text') this.panels.toolOptions();
  }
  selectAll() {
    const items = [];
    for (const l of this.doc.layers) if (l.visible !== false && !l.locked) for (const c of l.children) if (c.visible !== false && !c.locked) items.push(c);
    this.select(items);
  }

  // ---- 道具 ------------------------------------------------------------------------
  setTool(name) {
    if (!this.tools[name]) return;
    if (this.editing && name !== 'text') this.endTextEdit();
    if (this.tool !== this.tools[name] && this.tool.deactivate) this.tool.deactivate();
    this.toolName = name;
    this.tool = this.tools[name];
    if (name !== 'direct' && name !== 'pen') this.anchorSel.clear();
    $('#stage').dataset.tool = name;
    this.panels.toolOptions();
    this.panels.refresh();
    this.view.request();
  }
  toolOptionsChanged() { if (this.toolName === 'pen') this.panels.toolOptions(); }
  newItemStyle() {
    const s = JSON.parse(JSON.stringify(this.curStyle));
    if (this.doc.data.color_mode === 'cmyk') { if (s.fill && !isGradient(s.fill)) s.fill = toCMYK(s.fill); if (s.stroke && !isGradient(s.stroke)) s.stroke = toCMYK(s.stroke); }
    if (!(s.width >= 0)) s.width = 1;
    for (const k of ['cap', 'join', 'dash']) if (s[k] == null) delete s[k];
    return s;
  }

  // ---- 文字の入力（上の入力欄で打ち、キャンバスにはそのまま組んだ結果を出す。日本語の変換もこれで効く）------------
  editText(it, isNew = false) {
    if (this.editing) this.endTextEdit();
    if (!isNew) this.doc.begin('文字の編集');
    this.editing = { it, isNew, orig: it.text, origRuns: JSON.stringify(it.runs || null) };
    const ta = $('#textedit');
    ta.value = it.text || '';
    $('#textdock').hidden = false;
    this.view.request();
    this.panels.refresh();
    setTimeout(() => { ta.focus(); if (!isNew) ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  }
  layoutTextEdit() { this.view.request(); }
  /** 編集中の文字で選んでいる範囲（コードポイントの番号 [a, b)）。選んでいなければ null */
  textRange() {
    if (!this.editing) return null;
    const ta = $('#textedit'), v = ta.value;
    const a = cpIndex(v, ta.selectionStart), b = cpIndex(v, ta.selectionEnd);
    return b > a ? [a, b] : null;
  }
  onTextInput() {
    if (!this.editing) return;
    const it = this.editing.it, now = $('#textedit').value;
    if (it.runs) { it.runs = runsAfterTextChange(it.runs, it.text, now); if (!it.runs.length) delete it.runs; }
    it.text = now;
    delete it._lay;
    this.doc.touch();
    this.view.request();
  }
  endTextEdit() {
    const ed = this.editing;
    if (!ed) return;
    if ($('#textedit').value !== ed.it.text) this.onTextInput();
    this.editing = null;
    const it = ed.it, ta = $('#textedit');
    delete it._lay;
    $('#textdock').hidden = true;
    ta.blur();
    if (!it.text.trim()) {
      if (ed.isNew) this.doc.cancel();
      else { this.doc.remove(it); this.doc.commit(); }
      this.select([]);
    } else if (!ed.isNew && it.text === ed.orig && JSON.stringify(it.runs || null) === ed.origRuns) this.doc.cancel();
    else { this.doc.touch(); this.doc.commit(); this.select([it]); }
    this.view.request();
    this.panels.refresh();
  }
  /** ポイント文字 ⇔ エリア内文字 */
  convertTextKind() {
    const t = this.panels.textTargets()[0];
    if (!t) return;
    const lay = textLayout(t);
    this.doc.edit('文字の種類', () => {
      if ((t.text_kind || 'point') === 'area') {
        const fb = spsBBox(t.frame) || [0, 0, 0, 0], first = lay.lines[0];
        const ox = lay.vertical ? (first ? (first[0] + first[2]) / 2 : fb[2]) : fb[0];
        const oy = lay.vertical ? fb[1] : (first ? first[1] + lay.asc : fb[1] + lay.asc);
        t.matrix = M.round(M.then(M.t(ox, oy), t.matrix));
        delete t.text_kind; delete t.frame;
      } else {
        const b = lay.bbox, pad = t.size * 0.5;
        t.frame = [rectSp(0, 0, b[2] - b[0] + pad, b[3] - b[1] + pad * 0.5)];
        t.matrix = M.round(M.then(M.t(b[0], b[1]), t.matrix));
        t.text_kind = 'area';
      }
      delete t._lay;
      this.doc.touch();
    });
    this.panels.refresh();
  }

  // ---- 操作 ------------------------------------------------------------------------
  undo() { if (this.editing) { this.endTextEdit(); } if (this.doc && this.doc.undo()) toast('取り消し', 900); }
  redo() { if (this.doc && this.doc.redo()) toast('やり直し', 900); }
  need(n = 1) { const s = this.selection(); if (s.length < n) { toast(n > 1 ? `${n} 個以上選んでください` : '先に選んでください'); return null; } return s; }
  group() { const s = this.need(2); if (!s) return; let g; this.doc.edit('グループ', () => { g = OPS.group(this.doc, s); }); this.select([g]); }
  ungroup() { const s = this.need(); if (!s) return; let out; this.doc.edit('グループ解除', () => { out = OPS.ungroup(this.doc, s); }); this.select(out); }
  arrange(how) { const s = this.need(); if (!s) return; this.doc.edit('重ね順', () => OPS.arrange(this.doc, s, how)); this.view.request(); }
  duplicate() { const s = this.need(); if (!s) return; let out; this.doc.edit('複製', () => { out = OPS.duplicate(this.doc, s, 10, 10); }); this.select(out); }
  deleteSelection() {
    if (this.toolName === 'direct' && this.anchorSel.size) { this.deleteAnchors(); return; }
    const s = this.selection(); if (!s.length) return;
    this.doc.edit('削除', () => OPS.remove(this.doc, s));
    this.select([]);
  }
  align(how) {
    const s = this.need(); if (!s) return;
    const b = selectionBBox(s), ab = this.doc.artboards[b ? this.doc.artboardAt((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) : 0];
    this.doc.edit('整列', () => OPS.align(this.doc, s, how, ab));
  }
  distribute(how) { const s = this.need(3); if (!s) return; this.doc.edit('等間隔に分布', () => OPS.distribute(this.doc, s, how)); }
  makeCompound() { const s = this.need(); if (!s) return; let r; this.doc.edit('複合パス', () => { r = OPS.makeCompound(this.doc, s); }); if (r) this.select([r]); }
  makeClip() { const s = this.need(2); if (!s) return; let g; this.doc.edit('クリッピングマスク', () => { g = OPS.makeClip(this.doc, s); }); if (g) this.select([g]); }
  releaseClip() {
    const gs = this.selection().filter((x) => x.clip);
    if (!gs.length) { toast('クリップグループを選んでください'); return; }
    this.doc.edit('クリッピングの解除', () => { for (const g of gs) delete g.clip; this.doc.touch(); });
  }
  lockSelection() { const s = this.need(); if (!s) return; this.doc.edit('ロック', () => { for (const it of s) it.locked = true; this.doc.touch(); }); this.select([]); }
  unlockAll() { this.doc.edit('すべてのロックを解除', () => { for (const it of this.doc.iterTree()) if (it.kind !== 'layer') delete it.locked; this.doc.touch(); }); }
  hideSelection() { const s = this.need(); if (!s) return; this.doc.edit('隠す', () => { for (const it of s) it.visible = false; this.doc.touch(); }); this.select([]); }
  showAll() { this.doc.edit('すべて表示', () => { for (const it of this.doc.iterTree()) if (it.kind !== 'layer') delete it.visible; this.doc.touch(); }); }
  copy() {
    const s = this.selection(); if (!s.length) return false;
    this.clip = { docId: this.doc.workId, items: sortByOrder(this.doc, topLevel(this.doc, s)).map((it) => JSON.stringify(packItem(it))),
      images: Object.fromEntries([...this.doc.iterTree(s)].filter((x) => x.kind === 'image').map((x) => [x.image, this.doc.images[x.image]])) };
    toast(`${s.length} 個をコピー`, 900);
    return true;
  }
  cut() { if (this.copy()) this.deleteSelection(); }
  paste() {
    if (!this.clip) { toast('コピーした物がありません'); return; }
    const same = this.clip.docId === this.doc.workId;
    const out = [];
    this.doc.edit('ペースト', () => {
      for (const [k, v] of Object.entries(this.clip.images)) if (v && !this.doc.images[k]) this.doc.images[k] = v;
      for (const s of this.clip.items) {
        const it = cloneItem(unpackItem(JSON.parse(s)), this.doc);
        if (same) itemTransform(it, M.t(10, 10));
        this.doc.addItem(it, this.doc.currentLayer());
        out.push(it);
      }
      if (same) this.clip.items = out.map((it) => JSON.stringify(packItem(it)));
    });
    this.select(out);
  }
  deleteAnchors() {
    if (!this.anchorSel.size) { toast('錨点を選んでください（ダイレクト選択）'); return; }
    const byPath = new Map();
    for (const k of this.anchorSel) { const [id, si, ni] = k.split(':').map(Number); if (!byPath.has(id)) byPath.set(id, []); byPath.get(id).push([si, ni]); }
    this.doc.edit('錨点の削除', () => {
      for (const [id, lst] of byPath) {
        const p = this.doc.find(id);
        if (!p || !p.paths) continue;
        dropShape(p);
        lst.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
        for (const [si, ni] of lst) if (p.paths[si]) p.paths[si].n.splice(ni, 1);
        p.paths = p.paths.filter((sp) => sp.n.length >= 2);
        if (!p.paths.length) this.doc.remove(p);
      }
      this.doc.touch();
    });
    this.anchorSel.clear();
    this.select(this.selection());
  }
  toggleAnchorSmooth() {
    if (!this.anchorSel.size) { toast('錨点を選んでください'); return; }
    this.doc.edit('点の切り替え', () => {
      for (const k of this.anchorSel) {
        const [id, si, ni] = k.split(':').map(Number), p = this.doc.find(id);
        if (p && p.paths && p.paths[si]) { dropShape(p); toggleSmooth(p.paths[si], ni); }
      }
      this.doc.touch();
    });
  }
  transformSel(m, label = '変形', scaleStrokes = false) {
    const s = this.need(); if (!s) return;
    this.doc.edit(label, () => { for (const it of topLevel(this.doc, s)) itemTransform(it, m, scaleStrokes); this.doc.touch(); });
    this.view.request();
  }
  /** 選んでいる物の塗り（か線）をグラデーションに（今の色 → 白か黒、外枠の左から右へ）。p0・p1 を渡すとその向きに */
  makeGradient(p0, p1, merge = null) {
    const leaves = this.panels.styledLeaves(), t = this.colorTarget;
    if (!leaves.length) { toast('先に選んでください'); return false; }
    const cm = this.doc.data.color_mode === 'cmyk';
    this.doc.edit('グラデーション', () => {
      for (const it of leaves) {
        const cur = it.style[t], b = itemBBox(it) || [0, 0, 100, 100], cy = (b[1] + b[3]) / 2;
        const light = cur && !isGradient(cur) && colorRGB(cur).reduce((x, y) => x + y) > 2.4;
        const g = isGradient(cur) ? cur : { type: 'gradient', kind: 'linear', p0: [b[0], cy], p1: [b[2], cy],
          stops: [[0, cur ? { ...cur, v: [...cur.v] } : hexColor('#ffffff', cm), 1], [1, light || !cur ? hexColor('#000000', cm) : hexColor('#ffffff', cm), 1]] };
        if (p0) { g.p0 = [...p0]; g.p1 = [...p1]; }
        it.style[t] = g;
        if (t === 'stroke' && !(it.style.width > 0)) it.style.width = 1;
      }
      this.doc.touch();
    }, merge);
    this.view.request();
    this.panels.refreshSoon();
    return true;
  }
  nudge(dx, dy) {
    const s = this.selection(); if (!s.length) return;
    this.doc.edit('移動', () => { for (const it of topLevel(this.doc, s)) itemTransform(it, M.t(dx, dy)); this.doc.touch(); }, 'nudge');
  }

  // ---- レイヤー ------------------------------------------------------------------------
  addLayer() { this.doc.edit('レイヤーの追加', () => this.doc.addLayer()); this.panels.tab('layers'); }
  deleteLayer() {
    const doc = this.doc, l = doc.currentLayer();
    if (doc.layers.length <= 1) { toast('最後のレイヤーは消せません'); return; }
    if (l.children.length && !confirm(`「${l.name}」と中の ${l.children.length} 個を削除しますか？`)) return;
    doc.edit('レイヤーの削除', () => { doc.layers.splice(doc.layers.indexOf(l), 1); doc.data.current_layer = doc.layers[doc.layers.length - 1].id; doc.touch(); });
    this.select([]);
  }
  moveLayer(dir) {
    const doc = this.doc, l = doc.currentLayer(), i = doc.layers.indexOf(l), j = i + dir;
    if (j < 0 || j >= doc.layers.length) return;
    doc.edit('レイヤーの順番', () => { [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]]; doc.touch(); });
  }
  moveSelectionToLayer() {
    const s = this.need(); if (!s) return;
    const l = this.doc.currentLayer();
    this.doc.edit('レイヤーへ移動', () => {
      for (const it of sortByOrder(this.doc, topLevel(this.doc, s))) { this.doc.remove(it); l.children.push(it); }
      this.doc.touch();
    });
    this.select(s);
  }

  // ---- アートボード ------------------------------------------------------------------------
  curAB() { this.curArtboard = Math.max(0, Math.min(this.curArtboard || 0, this.doc.artboards.length - 1)); return this.doc.artboards[this.curArtboard]; }
  setArtboardField(k, v) {
    const a = this.curAB(), u = PT_PER[this.doc.data.units] || 1;
    if ((k === 'w' || k === 'h') && !(v > 0)) return;
    this.doc.edit('アートボード', () => { a[k] = k === 'name' ? v : Math.round(v * u * 1e4) / 1e4; this.doc.touch(); }, 'ab-' + k);
    this.panels.refresh();
  }
  setArtboardPreset(name) {
    const [w, h, u] = PRESETS[name], a = this.curAB();
    this.doc.edit('アートボードの大きさ', () => { a.w = Math.round(w * PT_PER[u] * 1e4) / 1e4; a.h = Math.round(h * PT_PER[u] * 1e4) / 1e4; this.doc.touch(); });
    this.panels.refresh();
  }
  swapArtboard() { const a = this.curAB(); this.doc.edit('縦横の入れ替え', () => { [a.w, a.h] = [a.h, a.w]; this.doc.touch(); }); this.panels.refresh(); }
  addArtboard() {
    const abs = this.doc.artboards, last = abs[abs.length - 1];
    const x = Math.max(...abs.map((a) => a.x + a.w)) + 40;
    this.doc.edit('アートボードの追加', () => { abs.push({ name: `アートボード ${abs.length + 1}`, x, y: last.y, w: last.w, h: last.h }); this.doc.touch(); });
    this.curArtboard = abs.length - 1;
    this.view.fitArtboard(this.curArtboard);
    this.panels.refresh();
  }
  deleteArtboard() {
    const abs = this.doc.artboards;
    if (abs.length <= 1) { toast('最後のアートボードは消せません'); return; }
    const i = this.curArtboard || 0;
    if (!confirm(`「${abs[i].name}」を削除しますか？（上の絵は残ります）`)) return;
    this.doc.edit('アートボードの削除', () => { abs.splice(i, 1); this.doc.touch(); });
    this.curArtboard = Math.max(0, i - 1);
    this.panels.refresh();
  }
  moveArtboard(d) {
    const abs = this.doc.artboards, i = this.curArtboard || 0, j = i + d;
    if (j < 0 || j >= abs.length) return;
    this.doc.edit('アートボードの順番', () => { [abs[i], abs[j]] = [abs[j], abs[i]]; this.doc.touch(); });
    this.curArtboard = j;
    this.panels.refresh();
  }
  fitArtboardTo(what) {
    const b = what === 'sel' ? selectionBBox(this.selection(), true) : selectionBBox(this.doc.layers.flatMap((l) => l.children), true);
    if (!b) { toast(what === 'sel' ? '先に選んでください' : '何も描いてありません'); return; }
    const a = this.curAB();
    this.doc.edit('アートボードを合わせる', () => { Object.assign(a, { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] }); this.doc.touch(); });
    this.panels.refresh();
  }

  // ---- 画像・書き出し ------------------------------------------------------------------------
  async placeImage() {
    const f = await pickFile('image/*');
    if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const bmp = await createImageBitmap(new Blob([bytes]));
      const key = await sha1hex(bytes);
      const [cx, cy] = this.view.center();
      const a = this.doc.artboards[this.doc.artboardAt(cx, cy)];
      const s = Math.min(1, a.w * 0.8 / bmp.width, a.h * 0.8 / bmp.height);
      const it = { kind: 'image', id: 0, image: key, pw: bmp.width, ph: bmp.height,
        matrix: M.round([s, 0, 0, s, cx - bmp.width * s / 2, cy - bmp.height * s / 2]) };
      this.doc.edit('画像の配置', () => { this.doc.images[key] = bytes; this.doc.addItem(it); });
      this.select([it]);
      this.setTool('select');
    } catch (e) { toast('画像を読めませんでした: ' + e.message); }
  }
  fileBase(doc = this.doc) { return (doc.name || '名称未設定').replace(/[\\/:*?"<>|]/g, '_'); }
  async exportSnk(doc = this.doc) {
    try {
      const blob = await docToSnk(doc, await this.thumbnail(doc, 512, 'blob'));
      await shareOrDownload(new Blob([blob], { type: 'application/zip' }), this.fileBase(doc) + '.snk');
    } catch (e) { toast('書き出せませんでした: ' + e.message, 5000); }
  }
  artboardSelect() {
    return h('select', {}, this.doc.artboards.map((a, i) => h('option', { value: i }, `${i + 1} - ${a.name}`)));
  }
  async exportSvg() {
    const ab = this.artboardSelect();
    const onlySel = h('input', { type: 'checkbox' });
    const body = h('div', { class: 'form' }, h('label', {}, 'アートボード', ab), h('label', { class: 'check' }, onlySel, '選んだ物だけ'));
    if (!await this.modal('SVG で書き出す', body, [['キャンセル', false], ['書き出す', true, 'primary']])) return;
    const items = onlySel.checked ? this.selection() : null;
    if (onlySel.checked && !items.length) { toast('何も選んでいません'); return; }
    const svg = docToSvg(this.doc, +ab.value, items);
    const n = this.doc.artboards.length > 1 && !items ? `_${+ab.value + 1}` : '';
    await shareOrDownload(new Blob([svg], { type: 'image/svg+xml' }), this.fileBase() + n + '.svg');
  }
  async exportPng() {
    const ab = this.artboardSelect();
    const scale = h('select', {}, [['1', '等倍（72 ppi）'], ['2', '2 倍'], ['3', '3 倍'], ['4', '4 倍'], ['4.1667', '300 ppi（印刷）'], ['4.8611', '350 ppi']]
      .map(([v, l]) => h('option', { value: v }, l)));
    const bg = h('select', {}, h('option', { value: '' }, '透明'), h('option', { value: '#ffffff' }, '白'));
    const onlySel = h('input', { type: 'checkbox' });
    scale.value = '2';
    const body = h('div', { class: 'form' }, h('label', {}, 'アートボード', ab), h('label', {}, '大きさ', scale), h('label', {}, '背景', bg),
      h('label', { class: 'check' }, onlySel, '選んだ物だけ（外枠で切り抜く）'));
    if (!await this.modal('PNG で書き出す', body, [['キャンセル', false], ['書き出す', true, 'primary']])) return;
    const items = onlySel.checked ? this.selection() : null;
    if (onlySel.checked && !items.length) { toast('何も選んでいません'); return; }
    await preloadImages(this.doc);
    let rect;
    if (items) rect = selectionBBox(items, true);
    else { const a = this.doc.artboards[+ab.value]; rect = [a.x, a.y, a.x + a.w, a.y + a.h]; }
    let sc = +scale.value;
    const px = (rect[2] - rect[0]) * (rect[3] - rect[1]) * sc * sc;
    if (px > 16.7e6) { sc = Math.sqrt(16.7e6 / ((rect[2] - rect[0]) * (rect[3] - rect[1]))); toast('大きすぎるので縮めて書き出します（iPad の上限）', 4000); }
    const cv = renderToCanvas(this.doc, rect, sc, bg.value || null, items);
    const blob = await canvasToBlob(cv);
    const n = this.doc.artboards.length > 1 && !items ? `_${+ab.value + 1}` : '';
    await shareOrDownload(blob, this.fileBase() + n + '.png');
  }
  async docSettings() {
    const d = this.doc.data, u = d.units;
    const mode = h('select', {}, h('option', { value: 'rgb' }, 'RGB'), h('option', { value: 'cmyk' }, 'CMYK'));
    const units = h('select', {}, ['px', 'mm', 'pt', 'cm', 'in'].map((v) => h('option', { value: v }, v)));
    const bleed = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: +((d.bleed || 0) / PT_PER[u]).toFixed(3) });
    mode.value = d.color_mode; units.value = u;
    const body = h('div', { class: 'form' }, h('label', {}, 'カラー', mode), h('label', {}, '単位', units),
      h('label', {}, `裁ち落とし（${u}）`, bleed), h('p', { class: 'note' }, 'カラーを変えても、塗ってある色はそのまま（新しく塗る色から変わります）。'));
    if (!await this.modal('書類の設定', body, [['キャンセル', false], ['決定', true, 'primary']])) return;
    this.doc.edit('書類の設定', () => { d.color_mode = mode.value; d.units = units.value; d.bleed = Math.max(0, parseFloat(bleed.value) || 0) * PT_PER[u]; this.doc.touch(); });
    this.panels.refresh();
  }

  // ---- 表示 ------------------------------------------------------------------------
  onView() {
    $('#zoom').textContent = Math.round(this.view.zoom * 100) + '%';
    if (this.editing) this.layoutTextEdit();
  }
  status(x, y) {
    const u = this.doc.data.units, k = PT_PER[u] || 1;
    $('#status').textContent = `${(x / k).toFixed(1)}, ${(y / k).toFixed(1)} ${u}`;
  }
  fitAll() { const b = unionBBox([selectionBBox(this.doc.layers.flatMap((l) => l.children)), ...this.doc.artboards.map((a) => [a.x, a.y, a.x + a.w, a.y + a.h])]); if (b) this.view.fitRect(b); }
  applyPanelOpen() {
    $('#panel').classList.toggle('closed', !this.settings.panelOpen);
    $('#b-panel').classList.toggle('on', !!this.settings.panelOpen);
    requestAnimationFrame(() => this.view.resize());
  }

  // ---- メニュー・ダイアログ ---------------------------------------------------------------------
  popup(anchor, items) {
    const m = $('#menu');
    m.textContent = '';
    for (const it of items) {
      if (!it) { m.append(h('hr')); continue; }
      const [label, fn, cls, on] = it;
      m.append(h('button', { class: (cls || '') + (on ? ' checked' : ''), onclick: () => { this.closePopup(); fn(); } }, label));
    }
    m.hidden = false;
    const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - mw - 8)) + 'px';
    m.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
    $('#veil').hidden = false;
  }
  closePopup() { $('#menu').hidden = true; $('#veil').hidden = true; }
  menu(name, anchor) {
    const sel = this.selection().length > 0;
    const menus = {
      file: [
        ['.snk で保存（線工房 exe と共通）', () => this.exportSnk()],
        ['SVG で書き出す', () => this.exportSvg()],
        ['PNG で書き出す', () => this.exportPng()],
        null,
        ['画像を配置', () => this.placeImage()],
        ['書類の設定', () => this.docSettings()],
      ],
      edit: [
        ['取り消し', () => this.undo()], ['やり直し', () => this.redo()], null,
        ['カット', () => this.cut()], ['コピー', () => this.copy()], ['ペースト', () => this.paste()],
        ['複製', () => this.duplicate()], ['削除', () => this.deleteSelection()], null,
        ['すべて選択', () => this.selectAll()], ['選択を解除', () => this.select([])],
      ],
      object: [
        ['グループ', () => this.group()], ['グループ解除', () => this.ungroup()], null,
        ['最前面へ', () => this.arrange('front')], ['前面へ', () => this.arrange('forward')],
        ['背面へ', () => this.arrange('backward')], ['最背面へ', () => this.arrange('back')], null,
        ['複合パスを作る', () => this.makeCompound()], ['クリッピングマスクを作る', () => this.makeClip()], ['クリッピングを解除', () => this.releaseClip()], null,
        ['ロック', () => this.lockSelection()], ['すべてのロックを解除', () => this.unlockAll()],
        ['隠す', () => this.hideSelection()], ['すべて表示', () => this.showAll()],
      ],
      view: [
        ['アートボードに合わせる', () => this.view.fitArtboard()], ['全体を表示', () => this.fitAll()],
        ['100%', () => this.view.setZoom(1)], ['選んだ物に合わせる', () => { const b = selectionBBox(this.selection()); if (b) this.view.fitRect(b, 60); }], null,
        ['アウトライン表示', () => { this.outlineMode = !this.outlineMode; this.view.request(); }, '', this.outlineMode],
        ['指でも描く（オフで指は画面の移動）', () => { this.settings.fingerDraws = !this.settings.fingerDraws; this.saveSettings(); }, '', this.settings.fingerDraws !== false],
        ['スナップ', () => { this.settings.snap = !this.settings.snap; this.saveSettings(); this.panels.toolOptions(); }, '', this.settings.snap],
      ],
    };
    void sel;
    this.popup(anchor, menus[name]);
  }
  modal(title, body, buttons) {
    return new Promise((resolve) => {
      const box = $('#modal'), done = (v) => { box.hidden = true; box.textContent = ''; resolve(v); };
      box.textContent = '';
      box.append(h('div', { class: 'modal-box' }, h('h2', {}, title), body,
        h('div', { class: 'modal-btns' }, buttons.map(([label, v, cls]) => h('button', { class: cls || '', onclick: () => done(v) }, label)))));
      box.hidden = false;
      box.onclick = (e) => { if (e.target === box) done(false); };
      const first = body.querySelector('input,select');
      if (first && !this.touchy) setTimeout(() => first.focus(), 0);
    });
  }

  // ---- 画面の部品 ------------------------------------------------------------------------
  bindUI() {
    $('#g-new').onclick = () => this.newDocDialog();
    $('#g-open').onclick = () => this.openFileFromGallery();
    $('#g-ver').textContent = 'v' + APP_VERSION;
    $('#b-back').onclick = () => this.showGallery();
    $('#b-undo').onclick = () => this.undo();
    $('#b-redo').onclick = () => this.redo();
    $('#b-panel').onclick = () => { this.settings.panelOpen = !this.settings.panelOpen; this.saveSettings(); this.applyPanelOpen(); };
    $('#zoom').onclick = (e) => this.menu('view', e.currentTarget);
    $$('[data-menu]').forEach((b) => { b.onclick = () => this.menu(b.dataset.menu, b); });
    $('#veil').onclick = () => this.closePopup();
    $('#doc-name').addEventListener('change', (e) => {
      if (!this.doc) return;
      this.doc.name = e.target.value.trim() || '名称未設定';
      document.title = this.doc.name + ' — 線工房 Web';
      this.doc.dirty = true; this.scheduleSave();
    });
    const ta = $('#textedit');
    ta.addEventListener('input', () => this.onTextInput());
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); this.endTextEdit(); } });
    $('#text-done').onclick = () => this.endTextEdit();
    document.addEventListener('selectionchange', () => { if (this.editing && document.activeElement === ta) { this.view.request(); this.panels.refreshSoon(); } });
    $('#cv').addEventListener('pointerdown', () => { if (this.editing && this.toolName !== 'text') this.endTextEdit(); }, true);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.saveNow(); });
    window.addEventListener('pagehide', () => this.saveNow());
    document.addEventListener('keyup', (e) => { if (e.code === 'Space') { this.space = false; $('#stage').classList.remove('panning'); } });
  }
  bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (!this.doc || $('#editor').hidden || !$('#modal').hidden) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (e.code === 'Space') { this.space = true; $('#stage').classList.add('panning'); e.preventDefault(); return; }
      const run = (fn) => { e.preventDefault(); fn(); };
      if (mod) {
        if (k === 'z') return run(() => (e.shiftKey ? this.redo() : this.undo()));
        if (k === 'y') return run(() => this.redo());
        if (k === 'g') return run(() => (e.shiftKey ? this.ungroup() : this.group()));
        if (k === 'd') return run(() => this.duplicate());
        if (k === 'c') return run(() => this.copy());
        if (k === 'x') return run(() => this.cut());
        if (k === 'v') return run(() => this.paste());
        if (k === 'a') return run(() => this.selectAll());
        if (k === 's') return run(() => { this.saveNow(); toast('保存しました', 900); });
        if (k === '0') return run(() => this.view.fitArtboard());
        if (k === '1') return run(() => this.view.setZoom(1));
        if (k === '=' || k === '+' || k === ';') return run(() => this.view.setZoom(this.view.zoom * 1.25));
        if (k === '-') return run(() => this.view.setZoom(this.view.zoom / 1.25));
        if (k === ']') return run(() => this.arrange(e.shiftKey ? 'front' : 'forward'));
        if (k === '[') return run(() => this.arrange(e.shiftKey ? 'back' : 'backward'));
        if (k === '8') return run(() => this.makeCompound());
        if (k === '7') return run(() => this.makeClip());
        if (k === 'y' && e.shiftKey) return run(() => { this.outlineMode = !this.outlineMode; this.view.request(); });
        return;
      }
      if (k === 'delete' || k === 'backspace') return run(() => this.deleteSelection());
      if (k === 'escape') return run(() => { if (this.toolName === 'pen' && this.tools.pen.cur) this.tools.pen.finish(); else this.select([]); });
      if (k === 'enter' && this.toolName === 'pen') return run(() => this.tools.pen.finish());
      const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (arrows[k]) { const s = e.shiftKey ? 10 : 1; return run(() => this.nudge(arrows[k][0] * s, arrows[k][1] * s)); }
      if (k === 'o' && e.shiftKey) return run(() => this.setTool('artboard'));
      const keys = { v: 'select', a: 'direct', p: 'pen', n: 'pencil', m: 'rect', l: 'ellipse', t: 'text', i: 'eyedropper', h: 'hand', g: 'gradient', '\\': 'line' };
      if (keys[k]) return run(() => this.setTool(keys[k]));
      if (k === 'x') return run(() => this.panels.setTarget(this.colorTarget === 'fill' ? 'stroke' : 'fill'));
      if (k === 'd') return run(() => { this.colorTarget = 'fill'; this.panels.setColor(hexColor('#ffffff', this.doc.data.color_mode === 'cmyk')); this.colorTarget = 'stroke'; this.panels.setColor(hexColor('#000000', this.doc.data.color_mode === 'cmyk')); this.colorTarget = 'fill'; this.panels.refresh(); });
      if (k === '/') return run(() => this.panels.setColor(null));
    });
  }
}
async function sniffZip(f) { const b = new Uint8Array(await f.slice(0, 4).arrayBuffer()); return b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4; }

// ---- 起動 ---------------------------------------------------------------------------
let app;
window.addEventListener('DOMContentLoaded', () => {
  app = new App();
  window.app = app;
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (had) { const b = $('#update'); b.hidden = false; }
    });
  }
  $('#update-btn').onclick = async () => { if (app.doc) await app.saveNow(); location.reload(); };
});
