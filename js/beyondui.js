/* 線工房 Web — Illustrator を超える機能の画面（フェーズ5）: 対称描画・線幅ツール・角丸・再配色・バリエーション・
   アイコン一括書き出し・画像トレース・配色の提案。App のメソッドとして足す（app.js の後に読む）。計算は beyond.js・trace.js。
*/
'use strict';

const SYMMETRY_LABELS = { v: '左右対称', h: '上下対称', vh: '上下左右（4 分割）', radial: '放射（回転）' };

Object.assign(App.prototype, {
  // ---- 対称描画（exe の start_symmetry と同じ: 対称グループを作って、描く先にする）-------------------
  async startSymmetry(mode = null) {
    const doc = this.doc, sel = this.selection();
    let v = { mode, n: 8, mirror: false, center: 'artboard', wrap: true };
    if (!mode) {
      const m = h('select', {}, Object.entries(SYMMETRY_LABELS).map(([k, l]) => h('option', { value: k }, l)));
      const n = h('input', { type: 'number', min: 2, max: 64, step: 1, value: 8, inputmode: 'numeric' });
      const mirror = h('input', { type: 'checkbox' }), wrap = h('input', { type: 'checkbox', checked: true });
      const center = h('select', {}, h('option', { value: 'artboard' }, 'アートボードの中心'), h('option', { value: 'selection' }, '選んでいる物の中心'));
      m.value = 'radial';
      const body = h('div', { class: 'form' }, h('label', {}, '種類', m), h('label', {}, '放射の数', n),
        h('label', { class: 'check' }, mirror, '万華鏡（放射のそれぞれも左右対称に）'), h('label', {}, '中心', center),
        h('label', { class: 'check' }, wrap, '選んでいる物も対称の中に入れる'),
        h('p', { class: 'note' }, '描いた物の写しがその場で描かれます（写しは描くだけ・元の物だけ直せばよい）。［対称を確定］で本物のオブジェクトになります。'));
      if (!await this.modal('対称描画', body, [['キャンセル', false], ['始める', true, 'primary']])) return;
      v = { mode: m.value, n: Math.max(2, Math.min(64, parseInt(n.value, 10) || 8)), mirror: mirror.checked, center: center.value, wrap: wrap.checked };
    }
    const a = this.curAB(), b = v.center === 'selection' && sel.length ? selectionBBox(sel) : [a.x, a.y, a.x + a.w, a.y + a.h];
    let g;
    doc.edit('対称描画', () => {
      if (v.wrap && sel.length) g = OPS.group(doc, sel);
      else { g = makeGroup([]); doc.addItem(g, doc.currentLayer()); }
      g.symmetry = { mode: v.mode, n: v.n, mirror: v.mirror, cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2 };
      (doc.data.meta = doc.data.meta || {}).draw_target = g.id;
      doc.touch();
    });
    this.select(g.children.length ? [g] : []);
    if (['select', 'direct'].includes(this.toolName)) this.setTool('pencil');
    toast('対称描画中: 描いた物の写しがその場で描かれます（［対称描画を終わる］で終了）', 4500);
  },
  stopSymmetry() {
    const m = this.doc.data.meta || {};
    if (!m.draw_target) { toast('対称描画はしていません'); return; }
    this.doc.edit('対称描画を終わる', () => { delete m.draw_target; this.doc.touch(); });
    toast('対称描画を終わりました（写しはそのまま。直すとまた写しも変わります）');
  },
  resumeSymmetry() {
    const g = this.selection().find((x) => x.symmetry);
    if (!g) { toast('対称グループを選んでください'); return; }
    this.doc.edit('対称描画を再開', () => { (this.doc.data.meta = this.doc.data.meta || {}).draw_target = g.id; this.doc.touch(); });
  },
  expandSymmetry() {
    const doc = this.doc, gs = this.selection().filter((x) => x.symmetry);
    if (!gs.length) { toast('対称グループを選んでください'); return; }
    doc.edit('対称を確定', () => {
      for (const g of gs) {
        const kids = g.children.slice();
        for (const m of symmetryMatrices(g.symmetry)) for (const k of kids) { const c = cloneItem(k, doc); itemTransform(c, m); g.children.push(c); }
        delete g.symmetry;
        if (doc.data.meta && doc.data.meta.draw_target === g.id) delete doc.data.meta.draw_target;
      }
      doc.touch();
    });
    this.select(gs);
  },

  // ---- 角丸（選んだ角・なければパスの全部の角）---------------------------------------------------
  async roundCornersDialog() {
    const doc = this.doc, u = doc.data.units;
    const refs = [...this.anchorSel].map((k) => k.split(':').map(Number));
    const paths = [];
    for (const it of this.selection()) for (const x of doc.iterTree([it])) if (x.kind === 'path') paths.push(x);
    if (!paths.length) { toast('パスか角（ダイレクト選択の錨点）を選んでください'); return; }
    const r = h('input', { type: 'number', min: 0.01, step: 'any', inputmode: 'decimal', value: this.settings.roundR ?? (u === 'mm' ? 3 : 10) });
    const body = h('div', { class: 'form' }, h('label', {}, `半径（${u}）`, r), h('p', { class: 'note' }, refs.length ? `選んだ錨点 ${refs.length} 個の角を丸くします（直線どうしの角だけ）。` : '選んだパスの、直線どうしの角を全部丸くします。'));
    if (!await this.modal('角を丸くする', body, [['キャンセル', false], ['丸くする', true, 'primary']])) return;
    const rad = parseFloat(r.value);
    if (!(rad > 0)) return;
    this.settings.roundR = rad; this.saveSettings();
    const by = new Map();
    for (const [id, si, ni] of refs) { if (!by.has(id)) by.set(id, new Map()); const m = by.get(id); if (!m.has(si)) m.set(si, new Set()); m.get(si).add(ni); }
    doc.edit('角を丸くする', () => {
      for (const p of refs.length ? paths.filter((x) => by.has(x.id)) : paths) {
        // 図形のまま丸められる物（長方形・多角形・スター）は図形の値で
        if (!refs.length && p.shape && ['rect', 'polygon', 'star'].includes(p.shape.kind)) {
          p.shape[p.shape.kind === 'rect' ? 'r' : 'corner'] = rad * PT_PER[u] / M.scale(p.shape_matrix || M.I());
          rebuildShape(p);
          continue;
        }
        dropShape(p);
        const subs = by.get(p.id);
        p.paths = p.paths.map((sp, si) => roundNodes(sp, rad * PT_PER[u], subs ? subs.get(si) || new Set() : null));
      }
      doc.touch();
    });
    this.anchorSel.clear();
    this.select(this.selection());
  },
  setShapeCorner(v) {
    const doc = this.doc, u = PT_PER[doc.data.units] || 1;
    const shapes = this.selection().filter((x) => x.kind === 'path' && x.shape && ['rect', 'polygon', 'star'].includes(x.shape.kind));
    if (!shapes.length) return;
    doc.edit('角の丸み', () => { for (const p of shapes) { p.shape[p.shape.kind === 'rect' ? 'r' : 'corner'] = Math.max(0, v * u / M.scale(p.shape_matrix || M.I())); rebuildShape(p); } doc.touch(); }, 'shape-corner');
    this.view.request();
  },

  // ---- 再配色（色の一覧を差し替え・色相／彩度／明るさをまとめて。キャンバスで見ながら）-----------------------
  colorTargets() {
    const sel = this.selection();
    if (sel.length) return topLevel(this.doc, sel);
    const a = this.curAB();
    return this.doc.layers.filter((l) => !l.locked && l.visible !== false).flatMap((l) => l.children).filter((c) => {
      const b = itemBBox(c); if (!b) return false;
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      return cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h;
    });
  },
  async recolorDialog() {
    const doc = this.doc, items = this.colorTargets();
    if (!items.length) { toast('塗り替える物がありません'); return; }
    const colors = collectColors(doc, items).slice(0, 60);
    if (!colors.length) { toast('色が見つかりません'); return; }
    const cm = doc.data.color_mode === 'cmyk';
    const saved = saveItems(items), repl = new Map();
    const hue = h('input', { type: 'range', min: -180, max: 180, step: 1, value: 0 });
    const sat = h('input', { type: 'range', min: 0, max: 200, step: 1, value: 100 });
    const light = h('input', { type: 'range', min: -50, max: 50, step: 1, value: 0 });
    const keepGray = h('input', { type: 'checkbox', checked: true });
    const chips = new Map();
    const mapping = () => {
      const m = new Map(), dh = +hue.value, ds = +sat.value / 100, dl = +light.value / 100;
      for (const [c] of colors) {
        const k = colorKey(c);
        let nc = repl.get(k);
        if (!nc) nc = (dh || ds !== 1 || dl) && !(keepGray.checked && grayLike(c)) ? shiftHue(c, dh, ds, dl) : c;
        m.set(k, nc);
      }
      return m;
    };
    doc.begin('再配色');
    const apply = () => {
      items.forEach((it, i) => loadInto(it, saved[i]));
      const m = mapping();
      visitColors(doc, items, (c) => { const n = m.get(colorKey(c)); return n ? paintCopy(n) : null; });
      for (const [k, el] of chips) { const c = m.get(k); if (c) el.value = colorHex(c); }
      doc.touch();
      this.view.request();
    };
    const rows = colors.map(([c, n]) => {
      const k = colorKey(c);
      const pick = h('input', { type: 'color', value: colorHex(c), oninput: (e) => { const nc = hexColor(e.target.value, cm || c.m === 'cmyk'); repl.set(k, nc); apply(); } });
      chips.set(k, pick);
      const sw = h('span', { class: 'rc-sw' }); sw.style.background = colorHex(c);
      return h('div', { class: 'rc-row' }, sw, h('span', { class: 'rc-label' }, `${colorLabel(c)}（${n}）`), h('span', {}, '→'), pick);
    });
    for (const el of [hue, sat, light]) el.addEventListener('input', apply);
    keepGray.addEventListener('change', apply);
    const body = h('div', { class: 'form' },
      h('p', { class: 'note' }, `使われている色 ${colors.length} 色（多い順）。右の色を押して差し替え。キャンバスにすぐ出ます。`),
      h('div', { class: 'rc-list' }, rows),
      h('label', {}, '色相', hue), h('label', {}, '彩度', sat), h('label', {}, '明るさ', light),
      h('label', { class: 'check' }, keepGray, '白・黒・グレーは変えない'),
      h('button', { class: 'act', onclick: () => { repl.clear(); hue.value = 0; sat.value = 100; light.value = 0; apply(); } }, '元に戻す'));
    const ok = await this.modal('オブジェクトの再配色', body, [['キャンセル', false], ['決定', true, 'primary']]);
    if (ok) doc.commit(); else doc.cancel();
    this.view.request();
    this.panels.refresh();
  },

  // ---- バリエーション（アートボードごと右に写して色を変える。exe の make_variations と同じ）----------------
  async variationsDialog() {
    const defaults = new Set(['gray', 'black', 'white', 'hue120']);
    const checks = Object.entries(VARIATIONS).map(([k, l]) => [k, h('input', { type: 'checkbox', checked: defaults.has(k) }), l]);
    const body = h('div', { class: 'form' }, h('p', { class: 'note' }, '選んだ物（なければアートボードの全部）を、アートボードごと右に写して色を変えます。'),
      h('div', { class: 'grid2' }, checks.map(([, cb, l]) => h('label', { class: 'check' }, cb, l))));
    if (!await this.modal('バリエーションを作る', body, [['キャンセル', false], ['作る', true, 'primary']])) return;
    const kinds = checks.filter(([, cb]) => cb.checked).map(([k]) => k);
    if (!kinds.length) return;
    const doc = this.doc, items = this.colorTargets(), src = this.curAB();
    if (!items.length) { toast('写す物がありません'); return; }
    doc.edit('バリエーション', () => {
      for (const k of kinds) {
        const abs = doc.artboards, x = Math.max(...abs.map((a) => a.x + a.w)) + 40;
        const ab = { name: `${src.name} — ${VARIATIONS[k]}`, x, y: src.y, w: src.w, h: src.h };
        abs.push(ab);
        const dx = ab.x - src.x, dy = ab.y - src.y, copies = [];
        for (const it of sortByOrder(doc, topLevel(doc, items))) {
          const c = cloneItem(it, doc), sib = doc.siblings(it);
          sib.splice(sib.indexOf(it) + 1, 0, c);
          itemTransform(c, M.t(dx, dy));
          copies.push(c);
        }
        doc.touch();
        if (k === 'white') {
          let dark = doc.data.color_mode === 'cmyk' ? { m: 'cmyk', v: [0.75, 0.68, 0.67, 0.9] } : hexColor('#1d2a5c');
          const cols = collectColors(doc, items).map(([c]) => c).filter((c) => !isLight(c));
          if (cols.length) dark = cols.reduce((a, b) => (colorRGB(b).reduce((s, v) => s + v) < colorRGB(a).reduce((s, v) => s + v) ? b : a));
          const bg = makeShape({ kind: 'rect', x: ab.x, y: ab.y, w: ab.w, h: ab.h }, newStyle(paintCopy(dark), null));
          bg.name = '背景';
          const parent = doc.parentOf(copies[0]);
          doc.addItem(bg, parent, parent.children.indexOf(copies[0]));
        }
        const fn = variationFn(k);
        visitColors(doc, copies, (c) => fn(c));
      }
      doc.touch();
    });
    this.fitAll();
    toast(`バリエーションを ${kinds.length} 個作りました`);
  },

  // ---- アイコン・アセットの一括書き出し（zip にまとめて共有）----------------------------------------
  async iconExportDialog() {
    const doc = this.doc, last = this.settings.icons || {}, sel = this.selection();
    const src = h('select', {}, doc.artboards.map((a, i) => h('option', { value: 'ab' + i }, `アートボード ${i + 1}（${a.name}）`)), sel.length ? h('option', { value: 'sel' }, '選んでいる物') : null);
    src.value = sel.length ? 'sel' : 'ab' + (this.curArtboard || 0);
    const sets = Object.entries(ICON_SETS).map(([k, [l, sizes]]) => [k, h('input', { type: 'checkbox', checked: (last.sets || ['ico', 'favicon']).includes(k) }), `${l}　${sizes.join(', ')}`]);
    const custom = h('input', { type: 'text', value: last.custom || '', placeholder: 'ほかの大きさ（例: 100, 300）' });
    const pad = h('input', { type: 'number', min: 0, max: 40, step: 1, value: last.padding ?? 0, inputmode: 'numeric' });
    const bg = h('select', {}, h('option', { value: '' }, '透明'), h('option', { value: '#ffffff' }, '白'), h('option', { value: '#000000' }, '黒'), h('option', { value: 'pick' }, '色を選ぶ'));
    const bgc = h('input', { type: 'color', value: last.bgc || '#ffffff' });
    const square = h('input', { type: 'checkbox', checked: true }), assets = h('input', { type: 'checkbox', checked: !!last.assets });
    bg.value = last.bg || '';
    const body = h('div', { class: 'form' }, h('label', {}, '元', src),
      h('div', { class: 'icon-sets' }, sets.map(([, cb, l]) => h('label', { class: 'check' }, cb, l))),
      h('label', {}, '自由な大きさ', custom),
      h('div', { class: 'form-row' }, h('label', {}, '余白（%）', pad), h('label', {}, '背景', bg), h('label', {}, '色', bgc)),
      h('label', { class: 'check' }, square, '正方形にする（縦長・横長は中央に収める）'),
      h('label', { class: 'check' }, assets, 'ほかに、すべてのアートボードを PNG（1x・2x・3x）・SVG で書き出す'));
    if (!await this.modal('アイコン・アセットの一括書き出し', body, [['キャンセル', false], ['書き出す', true, 'primary']])) return;
    const sizes = custom.value.replace(/、/g, ',').split(',').map((t) => parseInt(t.trim(), 10)).filter((n) => n >= 1 && n <= 8192);
    const v = { sets: sets.filter(([, cb]) => cb.checked).map(([k]) => k), custom: custom.value, padding: +pad.value || 0, bg: bg.value, bgc: bgc.value, assets: assets.checked };
    this.settings.icons = v; this.saveSettings();
    const plan = iconPlan(v.sets, sizes);
    if (!plan.length && !v.assets) { toast('書き出す物を選んでください'); return; }
    toast('書き出しています…', 30000);
    await preloadImages(doc);
    const items = src.value === 'sel' ? sel : null;
    let rect;
    if (items) rect = selectionBBox(items, true);
    else { const a = doc.artboards[+src.value.slice(2)]; rect = [a.x, a.y, a.x + a.w, a.y + a.h]; }
    const bgColor = v.bg === 'pick' ? v.bgc : v.bg || null;
    const cache = new Map();
    const render = async (size, p, opaque) => {
      const key = `${size}|${p}|${opaque}`;
      if (cache.has(key)) return cache.get(key);
      const [x0, y0, x1, y1] = rect, w = x1 - x0, hh = y1 - y0;
      let r = rect, s;
      if (square.checked) { const inner = size * (1 - 2 * p); s = inner / Math.max(w, hh); const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, half = size / s / 2; r = [cx - half, cy - half, cx + half, cy + half]; }
      else s = size / Math.max(w, hh);
      const cv = renderToCanvas(doc, r, s, bgColor || (opaque ? '#ffffff' : null), items);
      let out = cv;
      if (square.checked && (cv.width !== size || cv.height !== size)) { out = newCanvas(size, size); out.getContext('2d').drawImage(cv, 0, 0); }
      const bytes = new Uint8Array(await (await canvasToBlob(out)).arrayBuffer());
      cache.set(key, bytes);
      return bytes;
    };
    const enc = new TextEncoder(), files = [], base = this.fileBase();
    for (const ent of plan) {
      const p = ent.padding ?? v.padding / 100;
      if (ent.kind === 'svg') files.push({ name: ent.path, data: enc.encode(items ? docToSvg(doc, 0, items) : docToSvg(doc, doc.artboardAt((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2))) });
      else if (ent.kind === 'ico') { const pngs = []; for (const s of ent.sizes) pngs.push({ size: s, data: await render(s, p, false) }); files.push({ name: ent.path, data: makeIco(pngs) }); }
      else files.push({ name: ent.path, data: await render(ent.size, p, !!ent.opaque) });
    }
    if (plan.some((e) => e.path.startsWith('favicon/'))) {
      files.push({ name: 'favicon/site.webmanifest', data: enc.encode(webmanifest(doc.name || base, bgColor || '#ffffff')) });
      files.push({ name: 'favicon/head.html', data: enc.encode(FAVICON_HTML) });
    }
    if (v.assets) {
      for (let i = 0; i < doc.artboards.length; i++) {
        const a = doc.artboards[i], nm = `${String(i + 1).padStart(2, '0')}_${a.name.replace(/[\\/:*?"<>|]/g, '_')}`;
        for (const k of [1, 2, 3]) files.push({ name: `assets/${nm}${k > 1 ? `@${k}x` : ''}.png`, data: new Uint8Array(await (await canvasToBlob(renderToCanvas(doc, [a.x, a.y, a.x + a.w, a.y + a.h], k, null))).arrayBuffer()) });
        files.push({ name: `assets/${nm}.svg`, data: enc.encode(docToSvg(doc, i)) });
      }
    }
    const zip = zipStore(files);
    toast(`${files.length} 個のファイルを zip にしました`, 2500);
    await shareOrDownload(new Blob([zip], { type: 'application/zip' }), base + '_icons.zip');
  },

  // ---- 画像トレース（選んだ画像・なければファイル）-------------------------------------------------
  async traceDialog() {
    const doc = this.doc;
    let src = this.selection().find((x) => x.kind === 'image'), bytes, place;
    if (src) { bytes = doc.images[src.image]; place = src.matrix; }
    else {
      const f = await pickFile('image/*');
      if (!f) return;
      bytes = new Uint8Array(await f.arrayBuffer());
      const bmp = await createImageBitmap(new Blob([bytes]));
      const a = this.curAB(), sc = Math.min(1, a.w * 0.9 / bmp.width, a.h * 0.9 / bmp.height), [cx, cy] = this.view.center();
      place = [sc, 0, 0, sc, cx - bmp.width * sc / 2, cy - bmp.height * sc / 2];
    }
    if (!bytes) { toast('画像のデータがありません'); return; }
    const last = this.settings.trace || TRACE_PRESETS[0][1];
    const preset = h('select', {}, h('option', { value: '' }, '（自分で設定）'), TRACE_PRESETS.map(([l], i) => h('option', { value: i }, l)));
    const mode = h('select', {}, Object.entries(TRACE_MODES).map(([k, l]) => h('option', { value: k }, l)));
    const colors = h('input', { type: 'number', min: 2, max: 64, step: 1, inputmode: 'numeric' });
    const threshold = h('input', { type: 'range', min: 1, max: 254, step: 1 });
    const smooth = h('input', { type: 'range', min: 0, max: 5, step: 0.1 });
    const corner = h('input', { type: 'range', min: 0, max: 1, step: 0.05 });
    const minArea = h('input', { type: 'number', min: 0, max: 5000, step: 1, inputmode: 'numeric' });
    const ignoreWhite = h('input', { type: 'checkbox' });
    const set = (d) => { mode.value = d.mode; colors.value = d.colors ?? 6; threshold.value = d.threshold ?? 128; smooth.value = d.smooth ?? 2; corner.value = d.corner ?? 0.5; minArea.value = d.min_area ?? 12; ignoreWhite.checked = d.ignore_white !== false; };
    set(last);
    preset.addEventListener('change', () => { if (preset.value !== '') set({ ...TRACE_PRESETS[+preset.value][1], ignore_white: ignoreWhite.checked }); });
    const body = h('div', { class: 'form' }, h('label', {}, 'プリセット', preset), h('label', {}, 'モード', mode),
      h('div', { class: 'form-row' }, h('label', {}, '色の数（段数）', colors), h('label', {}, 'ノイズを無視（画素²）', minArea)),
      h('label', {}, 'しきい値（白黒）', threshold), h('label', {}, 'なめらかさ', smooth), h('label', {}, '角を残す', corner),
      h('label', { class: 'check' }, ignoreWhite, '白い所は塗らない（透明に）'),
      h('p', { class: 'note' }, src ? '元の画像は隠して残します。' : '選んだ画像を、見ている所の中央に置いてトレースします。'));
    if (!await this.modal('画像トレース', body, [['キャンセル', false], ['トレース', true, 'primary']])) return;
    const v = { mode: mode.value, colors: +colors.value || 6, threshold: +threshold.value, smooth: +smooth.value, corner: +corner.value, min_area: +minArea.value || 0, ignore_white: ignoreWhite.checked };
    this.settings.trace = v; this.saveSettings();
    toast('トレースしています…', 60000);
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    let g;
    try { g = await traceImage(bytes, v, place, doc.data.color_mode === 'cmyk'); } catch (e) { console.error(e); toast('トレースできませんでした: ' + e.message, 5000); return; }
    if (!g.children.length) { toast('形が見つかりませんでした（しきい値・色の数を変えてみてください）', 4000); return; }
    doc.edit('画像トレース', () => {
      if (src) { const parent = doc.parentOf(src); doc.addItem(g, parent, parent.children.indexOf(src) + 1); src.visible = false; }
      else doc.addItem(g, doc.currentLayer());
    });
    this.select([g]);
    const nodes = g.children.reduce((s, p) => s + p.paths.reduce((t, sp) => t + sp.n.length, 0), 0);
    toast(`トレースしました: パス ${g.children.length} 個・錨点 ${nodes}（${((performance.now() - t0) / 1000).toFixed(1)} 秒）${src ? '・元の画像は隠してあります' : ''}`, 4500);
  },

  // ---- 配色の提案（今の色から、スウォッチに足す）---------------------------------------------------
  async harmonyDialog() {
    const st = this.panels.shownStyle(), base0 = st[this.colorTarget] && !isGradient(st[this.colorTarget]) ? st[this.colorTarget] : (st.fill && !isGradient(st.fill) ? st.fill : hexColor('#e60012'));
    const scheme = h('select', {}, Object.entries(SCHEMES).map(([k, l]) => h('option', { value: k }, l)));
    const count = h('input', { type: 'number', min: 2, max: 12, step: 1, value: 5, inputmode: 'numeric' });
    const baseIn = h('input', { type: 'color', value: colorHex(base0) });
    const prev = h('div', { class: 'harm' });
    const cm = this.doc.data.color_mode === 'cmyk';
    const base = () => (baseIn.value === colorHex(base0) ? base0 : hexColor(baseIn.value, cm));
    const show = () => { prev.textContent = ''; for (const c of harmony(base(), scheme.value, +count.value || 5)) { const s = h('span', { class: 'harm-sw', title: colorLabel(c) }); s.style.background = colorHex(c); prev.append(s); } };
    for (const el of [scheme, count, baseIn]) el.addEventListener('input', show);
    show();
    const body = h('div', { class: 'form' }, h('label', {}, 'もとの色', baseIn), h('label', {}, '組み合わせ', scheme), h('label', {}, '色の数', count), prev);
    if (!await this.modal('配色の提案', body, [['キャンセル', false], ['スウォッチに足す', true, 'primary']])) return;
    const cols = harmony(base(), scheme.value, +count.value || 5);
    this.doc.edit('配色の提案', () => { this.doc.data.swatches.push(...cols); });
    this.panels.refresh();
    toast(`${cols.length} 色をスウォッチに足しました`);
  },
});

// ---- 線幅ツール（Shift+W）: 線の上を引っぱって、その位置の太さを変える（exe の WidthTool と同じ）--------------------
class WidthTool {
  constructor(app) { this.app = app; this.target = null; this.hovered = null; this.showsBBox = false; }
  get doc() { return this.app.doc; }
  find(x, y) {
    const p = this.app.view.hitLeaf(x, y, this.app.view.tol(this.app.touchy ? 14 : 8));
    if (!p || p.kind !== 'path' || !p.style.stroke || !(p.style.width > 0)) return null;
    let best = null;
    p.paths.forEach((sp, si) => { const r = nearestT(sp, x, y); if (!best || r.d < best.d) best = { si, ...r }; });
    return best ? { ...best, item: p } : null;
  }
  down(x, y, e) {
    const f = this.find(x, y);
    this.target = null;
    if (!f) return;
    const { item: p, t, si } = f, doc = this.doc;
    doc.begin('線幅');
    dropShape(p);
    const prof = (p.style.profile || [[0, 1], [1, 1]]).map((q) => [...q]);
    const near = prof.reduce((b, q, i) => (Math.abs(q[0] - t) < Math.abs(prof[b][0] - t) ? i : b), 0);
    if (e.altKey || this.app.settings.widthDelete) {
      if (Math.abs(prof[near][0] - t) < 0.04 && prof.length > 2) prof.splice(near, 1);
      p.style.profile = prof;
      doc.touch(); doc.commit();
      this.app.view.request();
      return;
    }
    let idx;
    if (Math.abs(prof[near][0] - t) < 0.03) idx = near;
    else { prof.push([t, profileAt(prof, t)]); prof.sort((a, b) => a[0] - b[0]); idx = prof.findIndex((q) => q[0] === t); }
    p.style.profile = prof;
    this.target = { p, si, idx };
    doc.touch();
    this.app.select([p]);
  }
  drag(x, y) {
    const T = this.target;
    if (!T) return;
    const { p, si, idx } = T, t = p.style.profile[idx][0];
    const { p: [px, py], dir: [tx, ty] } = pointAtT(p.paths[si], t), nx = -ty, ny = tx;
    const dist = Math.abs((x - px) * nx + (y - py) * ny);
    p.style.profile[idx][1] = Math.round(Math.max(0.02, 2 * dist / Math.max(p.style.width, 0.01)) * 1e4) / 1e4;
    this.doc.touch();
    this.app.view.request();
  }
  up() { if (this.target) { this.doc.commit(); this.app.panels.refresh(); } this.target = null; }
  cancel() { if (this.target) this.doc.cancel(); this.target = null; }
  hover(x, y) { this.hovered = this.find(x, y); this.app.view.request(); }
  /** ダブルタップ: 近くの点を消す（iPad には Alt が無いので） */
  dbl(x, y) {
    const f = this.find(x, y);
    if (!f || !f.item.style.profile || f.item.style.profile.length <= 2) return;
    const prof = f.item.style.profile.map((q) => [...q]);
    const near = prof.reduce((b, q, i) => (Math.abs(q[0] - f.t) < Math.abs(prof[b][0] - f.t) ? i : b), 0);
    if (Math.abs(prof[near][0] - f.t) > 0.06) return;
    prof.splice(near, 1);
    this.doc.edit('線幅の点を消す', () => { f.item.style.profile = prof; this.doc.touch(); });
  }
  paint(ctx) {
    const v = this.app.view, items = this.target ? [this.target.p] : this.hovered ? [this.hovered.item] : [];
    for (const it of items) {
      const prof = it.style.profile || [[0, 1], [1, 1]];
      for (const sp of it.paths) for (const [t, k] of prof) {
        const { p: [px, py], dir: [tx, ty] } = pointAtT(sp, t), nx = -ty, ny = tx, hw = it.style.width * k / 2;
        const [ax, ay] = v.toScreen(px + nx * hw, py + ny * hw), [bx, by] = v.toScreen(px - nx * hw, py - ny * hw), [cx, cy] = v.toScreen(px, py);
        ctx.strokeStyle = '#5a96ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.fillStyle = '#fff';
        for (const [qx, qy, r] of [[ax, ay, 4], [bx, by, 4], [cx, cy, 3]]) { ctx.beginPath(); ctx.arc(qx, qy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      }
    }
    ctx.lineWidth = 1;
  }
}
