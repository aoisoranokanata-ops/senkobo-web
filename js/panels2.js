/* 線工房 Web — パネル（フェーズ2）: 変形の数値・文字・グラデーション・縁取り（袋文字）・効果・アートボード。
   Panels のメソッドとして足す（panels.js の後に読む）。並び（行の数）が変わったときだけ作り直し、ふだんは値だけ書き換える。
*/
'use strict';

const REF_POINTS = [['tl', 0, 0], ['tc', 0.5, 0], ['tr', 1, 0], ['ml', 0, 0.5], ['mc', 0.5, 0.5], ['mr', 1, 0.5], ['bl', 0, 1], ['bc', 0.5, 1], ['br', 1, 1]];
const FX_MODES = [['normal', '通常'], ['multiply', '乗算'], ['screen', 'スクリーン'], ['overlay', 'オーバーレイ']];
const FX_PARAMS = { dx: ['X のずれ', 'pt', -500, 500, 0.5], dy: ['Y のずれ', 'pt', -500, 500, 0.5], blur: ['ぼかし', 'pt', 0, 200, 0.5], radius: ['半径', 'pt', 0, 200, 0.5], opacity: ['不透明度', '%', 0, 100, 1] };

function numInput(attrs, onch) {
  return h('input', { type: 'number', step: 'any', inputmode: 'decimal', ...attrs, onchange: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onch(v, e.target); } });
}
function setVal(el, v) { if (el !== document.activeElement) el.value = v; }
const r2 = (v) => +(+v).toFixed(2);

Object.assign(Panels.prototype, {
  // ---- 変形 ---------------------------------------------------------------------------
  buildTransform() {
    const app = this.app;
    this.refGrid = h('div', { class: 'refgrid', title: '基準点' }, REF_POINTS.map(([k]) => h('button', { 'data-k': k, onclick: () => { app.settings.refPoint = k; app.saveSettings(); this.refresh(); } })));
    this.tf = {};
    const row = (k, label) => { this.tf[k] = numInput({ 'data-k': k }, (v) => this.setXYWH(k, v)); return h('label', {}, label, this.tf[k]); };
    this.tf.rot = numInput({ value: 0, placeholder: '0' }, (v, el) => { if (v) app.transformSel(M.r(v, ...this.refXY()), '回転'); el.value = ''; });
    const act = (label, fn) => h('button', { class: 'act', onclick: fn }, label);
    return h('div', { class: 'tf' },
      h('div', { class: 'tf-top' }, this.refGrid, h('div', { class: 'xywh' }, row('X', 'X'), row('Y', 'Y'), row('W', 'W'), row('H', 'H'))),
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, '回転'), this.tf.rot, h('span', { class: 'unit' }, '°'),
        act('↺90', () => app.transformSel(M.r(-90, ...this.refXY()), '回転')), act('↻90', () => app.transformSel(M.r(90, ...this.refXY()), '回転'))),
      h('div', { class: 'grid2' }, act('左右に反転', () => app.transformSel(M.s(-1, 1, ...this.refXY()), '反転')),
        act('上下に反転', () => app.transformSel(M.s(1, -1, ...this.refXY()), '反転'))),
      (this.cornerRow = h('div', { class: 'row' }, h('span', { class: 'lbl' }, '角の丸み'), (this.tf.corner = numInput({ min: 0, step: 1 }, (v) => app.setShapeCorner(Math.max(0, v)))), h('span', { class: 'unit' }, ''))));
  },
  refXY(b) {
    b = b || selectionBBox(this.app.selection()) || [0, 0, 0, 0];
    const rp = REF_POINTS.find((r) => r[0] === (this.app.settings.refPoint || 'tl')) || REF_POINTS[0];
    return [b[0] + (b[2] - b[0]) * rp[1], b[1] + (b[3] - b[1]) * rp[2]];
  },
  setXYWH(k, v) {
    const app = this.app, sel = app.selection(), u = PT_PER[this.doc.data.units] || 1;
    const b = selectionBBox(sel);
    if (!b) return;
    v *= u;
    const [rx, ry] = this.refXY(b), w = b[2] - b[0], hh = b[3] - b[1];
    let m;
    if (k === 'X') m = M.t(v - rx, 0);
    else if (k === 'Y') m = M.t(0, v - ry);
    else if (k === 'W') { if (w < 1e-6 || v <= 0) return; const s = v / w; m = M.s(s, app.settings.keepRatio ? s : 1, rx, ry); }
    else { if (hh < 1e-6 || v <= 0) return; const s = v / hh; m = M.s(app.settings.keepRatio ? s : 1, s, rx, ry); }
    app.transformSel(m, '変形', (k === 'W' || k === 'H') && app.settings.scaleStrokes);
  },
  refreshTransform(sel) {
    const b = sel.length ? selectionBBox(sel) : null, u = PT_PER[this.doc.data.units] || 1;
    this.tfBox.hidden = !b;
    $$('button', this.refGrid).forEach((x) => x.classList.toggle('on', x.dataset.k === (this.app.settings.refPoint || 'tl')));
    if (!b) return;
    const sh = sel.find((x) => x.kind === 'path' && x.shape && ['rect', 'polygon', 'star'].includes(x.shape.kind));
    this.cornerRow.hidden = !sh;
    if (sh) { setVal(this.tf.corner, r2((sh.shape.kind === 'rect' ? sh.shape.r || 0 : sh.shape.corner || 0) * M.scale(sh.shape_matrix || M.I()) / u)); this.cornerRow.lastChild.textContent = this.doc.data.units; }
    const [rx, ry] = this.refXY(b);
    setVal(this.tf.X, r2(rx / u)); setVal(this.tf.Y, r2(ry / u)); setVal(this.tf.W, r2((b[2] - b[0]) / u)); setVal(this.tf.H, r2((b[3] - b[1]) / u));
  },

  // ---- 文字 ---------------------------------------------------------------------------
  buildText() {
    const T = {};
    this.tx = T;
    T.font = h('select', { onchange: (e) => this.setTextAttr('font', e.target.value) });
    T.bold = h('input', { type: 'checkbox', onchange: (e) => this.setTextAttr('font_style', e.target.checked ? 'Bold' : '') });
    const n = (k, attrs, conv = (v) => v) => (T[k] = numInput(attrs, (v) => this.setTextAttr(k, conv(v))));
    T.align = h('div', { class: 'seg' }, [['left', '左'], ['center', '中央'], ['right', '右'], ['justify', '均等']].map(([v, l]) => h('button', { 'data-v': v, onclick: () => this.setTextAttr('align', v) }, l)));
    T.vertical = h('input', { type: 'checkbox', onchange: (e) => this.setTextAttr('vertical', e.target.checked) });
    T.warp = h('select', { onchange: () => this.setWarp() }, h('option', { value: '' }, 'なし'), Object.entries(WARPS).map(([k, l]) => h('option', { value: k }, l)));
    T.bend = h('input', { type: 'range', min: -100, max: 100, step: 1, oninput: () => this.setWarp(true) });
    T.ruby = h('input', { type: 'text', placeholder: '読み（範囲を選んで）' });
    T.kind = h('span', { class: 'note' });
    T.rangeNote = h('p', { class: 'note range-note' });
    const lbl = (s) => h('span', { class: 'lbl' }, s);
    const act = (label, fn) => h('button', { class: 'act', onclick: fn }, label);
    this.textConv = act('エリア内文字にする', () => this.app.convertTextKind());
    return h('div', {},
      h('div', { class: 'row' }, T.font, h('label', { class: 'opt-check' }, T.bold, '太字')),
      h('div', { class: 'grid2 tx-nums' },
        h('label', {}, 'サイズ', n('size', { min: 0.5 })), h('label', {}, '行送り', n('leading', { min: 0, placeholder: '自動' })),
        h('label', {}, '字間', n('tracking', { step: 10 })), h('label', {}, 'ベースライン', n('baseline', { step: 0.5 })),
        h('label', {}, '横比率 %', n('hscale', { min: 1, step: 5 }, (v) => v / 100)), h('label', {}, '縦比率 %', n('vscale', { min: 1, step: 5 }, (v) => v / 100))),
      h('div', { class: 'row' }, lbl('揃え'), T.align),
      h('div', { class: 'row' }, h('label', { class: 'opt-check' }, T.vertical, '縦書き'), h('span', { class: 'mini-lbl' }, '縦中横'),
        n('tcy', { min: 0, max: 4, step: 1, placeholder: '0' }, (v) => Math.max(0, Math.min(4, Math.round(v)))), h('span', { class: 'mini-lbl' }, '桁')),
      h('div', { class: 'row path-only' }, lbl('開始位置'), n('path_offset', { step: 1 }), h('span', { class: 'unit' }, 'pt')),
      h('div', { class: 'row' }, lbl('ワープ'), T.warp, T.bend),
      h('div', { class: 'row' }, lbl('ルビ'), T.ruby, act('付ける', () => this.setTextAttr('ruby', T.ruby.value.trim() || null)), act('外す', () => this.setTextAttr('ruby', null))),
      h('div', { class: 'row' }, T.kind, h('span', { class: 'sp' }), this.textConv),
      T.rangeNote);
  },
  setWarp(merge) {
    const t = this.tx.warp.value;
    this.setTextAttr('warp', t ? { type: t, bend: +this.tx.bend.value / 100 } : null, merge);
  },
  textTargets() {
    const out = [];
    if (this.app.editing) return [this.app.editing.it];
    for (const it of this.app.selection()) for (const x of this.doc.iterTree([it])) if (x.kind === 'text' && !this.doc.isLocked(x)) out.push(x);
    return out;
  },
  /** 文字の設定。編集中に範囲を選んでいれば、その範囲だけ（書式の範囲 runs）に */
  setTextAttr(k, v, merge = false) {
    const app = this.app, S = app.settings;
    const map = { font: 'font', size: 'fontSize', font_style: 'fontStyle', vertical: 'vertical' };
    const range = app.textRange();
    if (!range && map[k]) { S[map[k]] = v; app.saveSettings(); }
    const texts = this.textTargets();
    if (!texts.length) { this.refresh(); return; }
    const RUN_ONLY = ['kern', 'baseline', 'hscale', 'vscale', 'ruby'];
    const DEF = { kern: 0, baseline: 0, hscale: 1, vscale: 1, ruby: null };
    if (k === 'ruby' && !range) { toast('文字を編集中に、ルビを付ける範囲を選んでください'); return; }
    this.doc.edit('文字の設定', () => {
      for (const t of texts) {
        const n = cps(t.text).length;
        if (range && RUN_KEYS.includes(k)) {
          t.runs = runsSet(t.runs || [], range[0], range[1], k, v, v === DEF[k] || v == null || (k === 'font_style' && !v));
        } else if (RUN_ONLY.includes(k)) {
          t.runs = runsSet(t.runs || [], 0, n, k, v, v === DEF[k] || v == null);
        } else {
          if (RUN_KEYS.includes(k) && t.runs) t.runs = runsSet(t.runs, 0, n, k, null, true);
          const dflt = { align: 'left', vertical: false, tcy: 0, leading: 0, tracking: 0, path_offset: 0, font_style: '', warp: null }[k];
          if (v === dflt || v == null || v === '') delete t[k]; else t[k] = v;
        }
        if (t.runs && !t.runs.length) delete t.runs;
        delete t._lay;
      }
      this.doc.touch();
    }, merge ? 'text-' + k : null);
    app.view.request();
    this.refresh();
  },
  refreshText() {
    const T = this.tx, texts = this.textTargets(), t = texts[0];
    this.textSec.hidden = !t;
    if (!t) return;
    const range = this.app.textRange();
    let a = { font: t.font, font_style: t.font_style || '', size: t.size, tracking: t.tracking || 0 };
    if (range && t.runs) { for (const r of t.runs) if (r.s <= range[0] && range[0] < r.e) a = { ...a, ...runAttrs(r) }; }
    if (T.font._key !== a.font) {
      T.font.textContent = '';
      for (const [v, l] of FONTS) T.font.append(h('option', { value: v }, l));
      if (!FONTS.some(([v]) => v === a.font)) T.font.prepend(h('option', { value: a.font }, a.font));
      T.font._key = a.font;
    }
    setVal(T.font, a.font);
    T.bold.checked = /bold/i.test(a.font_style || '');
    setVal(T.size, r2(a.size)); setVal(T.leading, t.leading ? r2(t.leading) : ''); setVal(T.tracking, r2(a.tracking || 0));
    setVal(T.baseline, r2(a.baseline || 0)); setVal(T.hscale, Math.round((a.hscale ?? 1) * 100)); setVal(T.vscale, Math.round((a.vscale ?? 1) * 100));
    setVal(T.tcy, t.tcy || 0); setVal(T.path_offset, r2(t.path_offset || 0));
    $$('button', T.align).forEach((b) => b.classList.toggle('on', b.dataset.v === (t.align || 'left')));
    T.vertical.checked = !!t.vertical;
    setVal(T.warp, (t.warp && t.warp.type) || '');
    setVal(T.bend, Math.round(((t.warp && t.warp.bend) ?? 0.5) * 100));
    T.bend.disabled = !t.warp;
    if (document.activeElement !== T.ruby) T.ruby.value = range && a.ruby ? a.ruby : '';
    const kind = t.text_kind || 'point';
    T.kind.textContent = { point: 'ポイント文字', area: 'エリア内文字', path: 'パス上文字' }[kind] + (textLayout(t).overflow ? '（あふれています）' : '');
    this.textConv.hidden = kind === 'path';
    this.textConv.textContent = kind === 'area' ? 'ポイント文字にする' : 'エリア内文字にする';
    $$('.path-only', this.textSec).forEach((x) => { x.hidden = kind !== 'path'; });
    T.rangeNote.textContent = range ? `選んだ ${range[1] - range[0]} 字だけに効きます（色もパネルから）` : '文字を編集中に範囲を選ぶと、その範囲だけに効きます';
  },

  // ---- グラデーション -------------------------------------------------------------------
  buildGradient() {
    const G = {};
    this.gr = G;
    G.kind = h('div', { class: 'seg' }, [['linear', '線形'], ['radial', '円形']].map(([v, l]) => h('button', { 'data-v': v, onclick: () => this.editGradient((g) => { g.kind = v; }) }, l)));
    G.angle = numInput({ step: 15 }, (v) => this.editGradient((g) => {
      const cx = (g.p0[0] + g.p1[0]) / 2, cy = (g.p0[1] + g.p1[1]) / 2, L = Math.hypot(g.p1[0] - g.p0[0], g.p1[1] - g.p0[1]) / 2 || 50, a = v * Math.PI / 180;
      if (g.kind === 'radial') { g.p1 = [g.p0[0] + Math.cos(a) * L * 2, g.p0[1] + Math.sin(a) * L * 2]; return; }
      g.p0 = [cx - Math.cos(a) * L, cy - Math.sin(a) * L]; g.p1 = [cx + Math.cos(a) * L, cy + Math.sin(a) * L];
    }));
    G.bar = h('div', { class: 'grad-bar' });
    G.stops = h('div', { class: 'grad-stops' });
    const act = (label, fn) => h('button', { class: 'act', onclick: fn }, label);
    G.box = h('div', { class: 'grad' },
      h('div', { class: 'row' }, G.kind, h('span', { class: 'mini-lbl' }, '角度'), G.angle, h('span', { class: 'unit' }, '°')),
      G.bar, G.stops,
      h('div', { class: 'grid2' }, act('＋ 色を足す', () => this.addStop()), act('逆にする', () => this.editGradient((g) => { g.stops = g.stops.map(([p, c, o]) => [r4(1 - p), c, o]).reverse(); }))),
      h('p', { class: 'note' }, 'グラデーションツール（G）で引っぱると向きと長さを決められます'));
    return G.box;
  },
  buildGradientBtn() { return h('button', { class: 'mini', title: 'グラデーションにする', onclick: () => this.app.makeGradient() }, 'グラデ'); },
  curGradient() { const p = this.shownStyle()[this.app.colorTarget]; return isGradient(p) ? p : null; },
  editGradient(fn, merge) {
    const t = this.app.colorTarget;
    const leaves = this.styledLeaves().filter((x) => isGradient(x.style[t]));
    if (!leaves.length) return;
    this.doc.edit('グラデーション', () => { for (const it of leaves) { fn(it.style[t]); } this.doc.touch(); }, merge ? 'grad' : null);
    this.app.view.request();
    this.refresh();
  },
  addStop() {
    this.editGradient((g) => {
      const st = g.stops.slice().sort((a, b) => a[0] - b[0]);
      let best = 0, at = 0.5;
      for (let i = 0; i + 1 < st.length; i++) if (st[i + 1][0] - st[i][0] > best) { best = st[i + 1][0] - st[i][0]; at = (st[i][0] + st[i + 1][0]) / 2; }
      g.stops.push([r4(at), gradientColorAt(g, at), 1]);
      g.stops.sort((a, b) => a[0] - b[0]);
    });
  },
  refreshGradient() {
    const g = this.curGradient(), G = this.gr;
    G.box.hidden = !g;
    if (!g) return;
    $$('button', G.kind).forEach((b) => b.classList.toggle('on', b.dataset.v === (g.kind || 'linear')));
    setVal(G.angle, Math.round(Math.atan2(g.p1[1] - g.p0[1], g.p1[0] - g.p0[0]) * 180 / Math.PI));
    const stops = g.stops.slice().sort((a, b) => a[0] - b[0]);
    G.bar.style.background = `linear-gradient(90deg, ${stops.map(([p, c, o]) => `${colorCSS(c, o)} ${Math.round(p * 100)}%`).join(',')}), repeating-conic-gradient(#888 0 25%, #bbb 0 50%) 0 0 / 10px 10px`;
    if (G.stops._n !== g.stops.length) {
      G.stops._n = g.stops.length;
      G.stops.textContent = '';
      g.stops.forEach((_, i) => {
        const row = h('div', { class: 'stop-row' },
          h('input', { type: 'color', 'data-f': 'c', oninput: (e) => this.editGradient((gg) => { gg.stops[i][1] = hexColor(e.target.value, this.cmykMode()); }, true) }),
          h('label', {}, '位置', numInput({ min: 0, max: 100, step: 1, 'data-f': 'p' }, (v) => this.editGradient((gg) => { gg.stops[i][0] = r4(clamp01(v / 100)); }))),
          h('label', {}, '不透明', numInput({ min: 0, max: 100, step: 5, 'data-f': 'o' }, (v) => this.editGradient((gg) => { gg.stops[i][2] = r4(clamp01(v / 100)); }))),
          h('button', { class: 'x', title: '消す', onclick: () => this.editGradient((gg) => { if (gg.stops.length > 2) gg.stops.splice(i, 1); else toast('色は 2 つ以上いります'); }) }, '×'));
        G.stops.append(row);
      });
    }
    $$('.stop-row', G.stops).forEach((row, i) => {
      const s = g.stops[i];
      if (!s) return;
      setVal($('[data-f=c]', row), colorHex(s[1])); setVal($('[data-f=p]', row), Math.round(s[0] * 100)); setVal($('[data-f=o]', row), Math.round(s[2] * 100));
    });
  },

  // ---- 縁取り（袋文字）------------------------------------------------------------------
  buildRims() {
    this.rimList = h('div', { class: 'rims' });
    return h('div', {}, this.rimList,
      h('div', { class: 'row' }, h('button', { class: 'act', onclick: () => this.addRim() }, '＋ 縁を足す'),
        h('span', { class: 'note' }, '線の外側に重ねる縁。袋文字に')));
  },
  editRims(fn, merge) {
    const leaves = this.styledLeaves();
    if (!leaves.length) { toast('先に選んでください'); return; }
    this.doc.edit('縁取り', () => { for (const it of leaves) { it.style.extra = it.style.extra || []; fn(it.style.extra, it.style); if (!it.style.extra.length) delete it.style.extra; } this.doc.touch(); }, merge ? 'rim' : null);
    this.app.view.request();
    this.refresh();
  },
  addRim() {
    this.editRims((ex, st) => {
      const last = ex[ex.length - 1];
      const w = last ? last.width + 8 : Math.max((st.stroke ? st.width : 0) + 8, 6);
      ex.push({ paint: ex.length % 2 ? hexColor('#1d2a5c', this.cmykMode()) : hexColor('#ffffff', this.cmykMode()), width: w, join: 'round' });
    });
  },
  refreshRims() {
    const ex = (this.shownStyle().extra) || [], L = this.rimList;
    if (L._n !== ex.length) {
      L._n = ex.length;
      L.textContent = '';
      ex.forEach((_, i) => L.append(h('div', { class: 'stop-row' },
        h('span', { class: 'mini-lbl' }, `縁 ${i + 1}`),
        h('input', { type: 'color', 'data-f': 'c', oninput: (e) => this.editRims((x) => { if (x[i]) x[i].paint = hexColor(e.target.value, this.cmykMode()); }, true) }),
        h('label', {}, '太さ', numInput({ min: 0, step: 1, 'data-f': 'w' }, (v) => this.editRims((x) => { if (x[i]) x[i].width = Math.max(0, v); }))),
        h('button', { class: 'x', title: '消す', onclick: () => this.editRims((x) => x.splice(i, 1)) }, '×'))));
    }
    $$('.stop-row', L).forEach((row, i) => {
      const e = ex[i]; if (!e) return;
      if (e.paint && !isGradient(e.paint)) setVal($('[data-f=c]', row), colorHex(e.paint));
      setVal($('[data-f=w]', row), r2(e.width));
    });
  },

  // ---- 効果 ---------------------------------------------------------------------------
  buildEffects() {
    this.fxList = h('div', { class: 'fx-list' });
    const add = h('select', { onchange: (e) => { if (e.target.value) this.addEffect(e.target.value); e.target.value = ''; } },
      h('option', { value: '' }, '＋ 効果を足す…'), Object.entries(EFFECTS).map(([k, d]) => h('option', { value: k }, d.label)));
    return h('div', {}, this.fxList, h('div', { class: 'row' }, add));
  },
  fxTargets() { return topLevel(this.doc, this.app.selection()); },
  addEffect(type) {
    const items = this.fxTargets();
    if (!items.length) { toast('先に選んでください'); return; }
    this.doc.edit('効果', () => { for (const it of items) (it.effects = it.effects || []).push(newEffect(type)); this.doc.touch(); });
    this.app.view.request();
    this.refresh();
  },
  editEffect(i, fn, merge) {
    const items = this.fxTargets(), type = items[0] && items[0].effects && items[0].effects[i] && items[0].effects[i].type;
    if (!type) return;
    this.doc.edit('効果', () => {
      for (const it of items) { const e = it.effects && it.effects[i]; if (e && e.type === type) fn(e, it); if (it.effects && !it.effects.length) delete it.effects; }
      this.doc.touch();
    }, merge ? 'fx-' + i : null);
    this.app.view.request();
    this.refresh();
  },
  refreshEffects() {
    const it = this.fxTargets()[0], list = (it && it.effects) || [], L = this.fxList;
    const key = list.map((e) => e.type).join(',');
    if (L._key !== key) {
      L._key = key;
      L.textContent = '';
      list.forEach((e, i) => {
        const params = Object.keys(EFFECTS[e.type] ? EFFECTS[e.type].defaults : {});
        const box = h('div', { class: 'fx' },
          h('div', { class: 'fx-head' },
            h('input', { type: 'checkbox', 'data-f': 'on', onchange: (ev) => this.editEffect(i, (x) => { if (ev.target.checked) delete x.on; else x.on = false; }) }),
            h('b', {}, EFFECTS[e.type] ? EFFECTS[e.type].label : e.type), h('span', { class: 'sp' }),
            h('button', { class: 'x', title: '消す', onclick: () => this.editEffect(i, (x, owner) => owner.effects.splice(owner.effects.indexOf(x), 1)) }, '×')),
          h('div', { class: 'fx-params' }, params.map((p) => {
            if (p === 'color') return h('label', {}, '色', h('input', { type: 'color', 'data-f': p, oninput: (ev) => this.editEffect(i, (x) => { x.color = hexColor(ev.target.value); }, true) }));
            if (p === 'mode') return h('label', {}, 'モード', h('select', { 'data-f': p, onchange: (ev) => this.editEffect(i, (x) => { x.mode = ev.target.value; }) }, FX_MODES.map(([v, l]) => h('option', { value: v }, l))));
            const [l, u, mn, mx, st] = FX_PARAMS[p];
            return h('label', {}, l, numInput({ min: mn, max: mx, step: st, 'data-f': p }, (v) => this.editEffect(i, (x) => { x[p] = p === 'opacity' ? clamp01(v / 100) : v; })), h('span', { class: 'unit' }, u));
          })));
        L.append(box);
      });
    }
    $$('.fx', L).forEach((box, i) => {
      const e = list[i]; if (!e) return;
      $('[data-f=on]', box).checked = e.on !== false;
      for (const el of $$('[data-f]', box)) {
        const f = el.dataset.f;
        if (f === 'on') continue;
        if (f === 'color') setVal(el, colorHex(e.color && e.color.v ? e.color : { m: 'rgb', v: [0, 0, 0] }));
        else if (f === 'mode') setVal(el, e.mode || 'normal');
        else setVal(el, f === 'opacity' ? Math.round((e.opacity ?? 0.75) * 100) : r2(e[f] || 0));
      }
    });
  },

  // ---- アートボード ------------------------------------------------------------------------
  buildArtboards() {
    const pg = $('#page-artboards'), app = this.app;
    this.abList = h('div', { class: 'layers' });
    this.ab = {};
    const f = (k, label) => h('label', {}, label, (this.ab[k] = numInput({ 'data-k': k }, (v) => app.setArtboardField(k, v))));
    this.ab.name = h('input', { type: 'text', onchange: (e) => app.setArtboardField('name', e.target.value.trim() || 'アートボード') });
    this.ab.preset = h('select', { onchange: (e) => { if (e.target.value) app.setArtboardPreset(e.target.value); e.target.value = ''; } },
      h('option', { value: '' }, '大きさを選ぶ…'), Object.keys(PRESETS).map((k) => h('option', { value: k }, k)));
    const act = (label, fn) => h('button', { class: 'act', onclick: fn }, label);
    pg.append(
      h('div', { class: 'row layer-btns' }, act('＋ 追加', () => app.addArtboard()), act('上へ', () => app.moveArtboard(-1)), act('下へ', () => app.moveArtboard(1)), act('削除', () => app.deleteArtboard())),
      this.abList,
      h('section', { class: 'sec' }, h('h3', {}, '選んでいるアートボード'),
        h('label', { class: 'stack' }, '名前', this.ab.name),
        h('div', { class: 'xywh' }, f('x', 'X'), f('y', 'Y'), f('w', 'W'), f('h', 'H')),
        h('div', { class: 'row' }, this.ab.preset, act('縦横を入れ替え', () => app.swapArtboard())),
        h('div', { class: 'grid2' }, act('選択に合わせる', () => app.fitArtboardTo('sel')), act('全部に合わせる', () => app.fitArtboardTo('all'))),
        h('p', { class: 'note' }, 'アートボードツール（Shift+O）で、つかんで動かす・角や辺で大きさを変えられます')));
  },
  refreshArtboards() {
    const doc = this.doc, app = this.app, u = PT_PER[doc.data.units] || 1, L = this.abList;
    const cur = Math.min(app.curArtboard, doc.artboards.length - 1);
    const key = JSON.stringify([doc.artboards, cur, doc.data.units]);
    if (L._key !== key) {
      L._key = key;
      L.textContent = '';
      doc.artboards.forEach((a, i) => {
        const r = h('div', { class: 'ly-row' + (i === cur ? ' sel' : ''), style: '--depth:0' },
          h('span', { class: 'ab-no' }, String(i + 1)), h('span', { class: 'ly-name' }, a.name),
          h('span', { class: 'ab-size' }, `${r2(a.w / u)}×${r2(a.h / u)} ${doc.data.units}`));
        r.addEventListener('click', () => { app.curArtboard = i; app.view.fitArtboard(i); this.refresh(); });
        L.append(r);
      });
    }
    const a = doc.artboards[cur];
    setVal(this.ab.name, a.name);
    for (const k of ['x', 'y', 'w', 'h']) setVal(this.ab[k], r2(a[k] / u));
  },
});
function r4(v) { return Math.round(v * 1e4) / 1e4; }
function gradientColorAt(g, t) {
  const st = g.stops.slice().sort((a, b) => a[0] - b[0]);
  if (t <= st[0][0]) return { ...st[0][1], v: [...st[0][1].v] };
  for (let i = 0; i + 1 < st.length; i++) {
    const [p0, c0] = st[i], [p1, c1] = st[i + 1];
    if (t <= p1) {
      const k = p1 > p0 ? (t - p0) / (p1 - p0) : 0;
      if (c0.m === c1.m) return { m: c0.m, v: c0.v.map((x, j) => r4(x + (c1.v[j] - x) * k)) };
      const a = colorRGB(c0), b = colorRGB(c1);
      return { m: 'rgb', v: a.map((x, j) => r4(x + (b[j] - x) * k)) };
    }
  }
  const l = st[st.length - 1][1];
  return { ...l, v: [...l.v] };
}
