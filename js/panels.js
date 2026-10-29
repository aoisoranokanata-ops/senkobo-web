/* 線工房 Web — パネル: 道具箱・道具の設定・プロパティ（塗り・線・不透明度・整列）・スウォッチ・レイヤー。
   DOM は最初に一度だけ組み、refresh() では値だけ書き換える（スライダーを動かしている最中に作り直さないため）。
*/
'use strict';

const ICON = {
  select: '<path d="M6 3l12 9-5.5 1 3.5 7-2.6 1.2-3.4-7L6 18z" fill="currentColor"/>',
  direct: '<path d="M6 3l12 9-5.5 1 3.5 7-2.6 1.2-3.4-7L6 18z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  pen: '<path d="M12 2l5 9-3 9h-4l-3-9z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="11" r="1.6" fill="currentColor"/><path d="M12 2v7.4" stroke="currentColor" stroke-width="1.2"/>',
  pencil: '<path d="M4 20l1.2-4.6L16 4.6l3.4 3.4L8.6 18.8z M14.4 6.2l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  rect: '<rect x="4" y="6" width="16" height="12" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  roundrect: '<rect x="4" y="6" width="16" height="12" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  polygon: '<path d="M12 3.5l8 5.8-3 9.2H7l-3-9.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  star: '<path d="M12 3l2.6 5.8 6.2.6-4.7 4.2 1.4 6.2L12 16.6 6.5 19.8l1.4-6.2L3.2 9.4l6.2-.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  line: '<path d="M5 19L19 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  text: '<path d="M5 5h14M12 5v14M9 19h6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  eyedropper: '<path d="M14.5 4.5l5 5-2 2-1-1-7 7H6v-3.5l7-7-1-1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  gradient: '<defs><linearGradient id="ig" x1="0" x2="1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect x="3.5" y="5.5" width="17" height="13" rx="1.5" fill="url(#ig)" stroke="currentColor" stroke-width="1.4"/>',
  artboard: '<path d="M7 3v18M17 3v18M3 7h18M3 17h18" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  shapebuilder: '<circle cx="9" cy="12" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="15" cy="12" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 7.5a5.5 5.5 0 010 9 5.5 5.5 0 010-9z" fill="currentColor"/>',
  width: '<path d="M3 16c4-9 7 2 9-4s4-6 9-4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 18c4-8 6 1 8-3s5-6 9-4" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" opacity=".55"/>',
  hand: '<path d="M8 12V6.5a1.5 1.5 0 013 0V11m0-5.5V5a1.5 1.5 0 013 0v6m0-4.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-.6a6 6 0 01-4.9-2.6L4 15a1.6 1.6 0 012.6-1.8L8 15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
};
const TOOL_ORDER = [['select', 'V'], ['direct', 'A'], ['pen', 'P'], ['pencil', 'N'], ['rect', 'M'], ['roundrect', ''], ['ellipse', 'L'],
  ['polygon', ''], ['star', ''], ['line', '\\'], ['text', 'T'], ['shapebuilder', 'Shift+M'], ['width', 'Shift+W'], ['gradient', 'G'], ['eyedropper', 'I'], ['artboard', 'Shift+O'], ['hand', 'H']];
const FONTS = [['Yu Gothic', '游ゴシック（ヒラギノ角ゴ）'], ['Yu Mincho', '游明朝（ヒラギノ明朝）'], ['Meiryo', 'メイリオ'],
  ['BIZ UDPGothic', 'BIZ UDP ゴシック'], ['Noto Sans JP', 'Noto Sans JP'], ['Noto Serif JP', 'Noto Serif JP'],
  ['Hiragino Maru Gothic ProN', 'ヒラギノ丸ゴ'], ['Arial', 'Arial'], ['Helvetica', 'Helvetica'], ['Georgia', 'Georgia'],
  ['Times New Roman', 'Times New Roman'], ['Courier New', 'Courier New']];
const ALIGN_BTNS = [['left', '左'], ['hcenter', '左右中央'], ['right', '右'], ['top', '上'], ['vcenter', '上下中央'], ['bottom', '下']];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
function svgIcon(name) { const s = document.createElement('span'); s.className = 'ico'; s.innerHTML = `<svg viewBox="0 0 24 24">${ICON[name] || ''}</svg>`; return s; }

class Panels {
  constructor(app) {
    this.app = app;
    this._soon = false;
    this.buildToolbar();
    this.buildProps();
    this.buildLayers();
    this.buildArtboards();
    $$('#panel .tabs button').forEach((b) => b.addEventListener('click', () => this.tab(b.dataset.tab)));
    this.tab(app.settings.panelTab || 'prop');
  }
  get doc() { return this.app.doc; }
  tab(name) {
    $$('#panel .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $$('#panel .page').forEach((p) => { p.hidden = p.dataset.page !== name; });
    this.app.settings.panelTab = name; this.app.saveSettings();
    this.refresh();
  }
  refreshSoon() {
    if (this._soon) return;
    this._soon = true;
    requestAnimationFrame(() => { this._soon = false; this.refresh(); });
  }
  refresh() {
    if (!this.doc) return;
    this.refreshToolbar();
    this.refreshProps();
    if (!$('#page-layers').hidden) this.refreshLayers();
    if (!$('#page-artboards').hidden) this.refreshArtboards();
    $('#b-undo').disabled = !this.doc.undoStack.length;
    $('#b-redo').disabled = !this.doc.redoStack.length;
  }

  // ---- 道具箱 -----------------------------------------------------------------------
  buildToolbar() {
    const bar = $('#toolbar');
    for (const [name, key] of TOOL_ORDER) {
      const b = h('button', { 'data-tool': name, title: TOOL_LABEL[name] + (key ? `（${key}）` : ''), onclick: () => this.app.setTool(name) }, svgIcon(name));
      bar.append(b);
    }
    bar.append(h('div', { class: 'tb-sep' }));
    this.fsw = h('div', { class: 'fs-mini' },
      h('button', { class: 'fs-fill', title: '塗り', onclick: () => this.setTarget('fill') }),
      h('button', { class: 'fs-stroke', title: '線', onclick: () => this.setTarget('stroke') }));
    bar.append(this.fsw);
  }
  refreshToolbar() {
    $$('#toolbar [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === this.app.toolName));
    const st = this.shownStyle();
    this.paintChip($('.fs-fill', this.fsw), st.fill);
    this.paintChip($('.fs-stroke', this.fsw), st.stroke);
    this.fsw.dataset.target = this.app.colorTarget;
  }
  paintChip(el, p) {
    el.classList.toggle('none', !p);
    if (!p) { el.style.background = ''; return; }
    if (isGradient(p)) el.style.background = `linear-gradient(90deg, ${p.stops.map(([pos, c]) => `${colorHex(c)} ${Math.round(pos * 100)}%`).join(',')})`;
    else el.style.background = colorHex(p);
  }

  // ---- 道具の設定（上の帯）-------------------------------------------------------------------
  toolOptions() {
    const app = this.app, S = app.settings, bar = $('#optbar');
    bar.textContent = '';
    const toggle = (label, key, after) => h('label', { class: 'opt-check' },
      h('input', { type: 'checkbox', checked: !!S[key], onchange: (e) => { S[key] = e.target.checked; app.saveSettings(); after && after(); } }), label);
    const num = (label, key, def, min, max, step = 1, onch) => h('label', { class: 'opt-num' }, label,
      h('input', { type: 'number', value: S[key] ?? def, min, max, step, inputmode: 'decimal',
        onchange: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { S[key] = Math.max(min, Math.min(max, v)); app.saveSettings(); onch && onch(S[key]); } } }));
    const btn = (label, fn, cls = '') => h('button', { class: 'opt-btn ' + cls, onclick: fn }, label);
    const t = app.toolName;
    bar.append(h('span', { class: 'opt-title' }, TOOL_LABEL[t]));
    if (t === 'select') bar.append(toggle('縦横比を保つ', 'keepRatio'), toggle('線幅も拡大縮小', 'scaleStrokes'));
    if (t === 'direct') bar.append(btn('角 ⇔ なめらか', () => app.toggleAnchorSmooth()), btn('錨点を削除', () => app.deleteAnchors()));
    if (t === 'pen') {
      bar.append(btn('描き終える', () => app.tools.pen.finish(), app.tools.pen.cur ? 'accent' : ''));
      bar.append(h('span', { class: 'opt-hint' }, '押すと角、引っぱると曲線。最初の点を押すと閉じる'));
    }
    if (t === 'pencil') bar.append(num('なめらかさ', 'pencilSmooth', 3, 0.5, 20, 0.5));
    if (t === 'rect' || t === 'ellipse' || t === 'roundrect') bar.append(toggle(t === 'ellipse' ? '正円' : '正方形', 'keepRatio'));
    if (t === 'roundrect') bar.append(num('角の半径（pt）', 'cornerRadius', 12, 0, 1000, 1));
    if (t === 'polygon') bar.append(num('辺の数', 'sides', 6, 3, 60, 1), toggle('まっすぐ立てる', 'keepRatio'));
    if (t === 'star') bar.append(num('点の数', 'points', 5, 2, 60, 1), num('内側の比率', 'starRatio', 0.5, 0.05, 0.95, 0.05), toggle('まっすぐ立てる', 'keepRatio'));
    if (t === 'gradient') bar.append(h('span', { class: 'opt-hint' }, `選んだ物の${app.colorTarget === 'fill' ? '塗り' : '線'}に、引っぱった向きでかける（Shift で 45° ごと）`));
    if (t === 'artboard') bar.append(toggle('上の絵も一緒に動かす', 'abMoveArt'), h('span', { class: 'opt-hint' }, '押して選ぶ・つかんで動かす・角や辺で大きさ'));
    if (t === 'shapebuilder') bar.append(toggle('消すモード（Alt でも）', 'sbDelete', () => this.app.view.request()),
      h('span', { class: 'opt-hint' }, 'なぞった領域を合体、消すモードでは押した領域を削除。押さなかった所は別々の形になります'));
    if (t === 'width') bar.append(toggle('点を消すモード（Alt でも）', 'widthDelete'),
      h('span', { class: 'opt-hint' }, '線の上を引っぱると、その所の太さが変わります。点をダブルタップで消す'));
    if (t === 'line') bar.append(h('span', { class: 'opt-hint' }, 'Shift で 45° ごと'));
    if (t === 'text') {
      const cur = this.selText();
      const font = h('select', { onchange: (e) => this.setTextAttr('font', e.target.value) },
        FONTS.map(([v, l]) => h('option', { value: v, selected: (cur ? cur.font : S.font || 'Yu Gothic') === v }, l)));
      if (cur && !FONTS.some(([v]) => v === cur.font)) font.prepend(h('option', { value: cur.font, selected: true }, cur.font));
      bar.append(font,
        h('label', { class: 'opt-num' }, 'サイズ', h('input', { type: 'number', min: 1, max: 2000, step: 1, value: cur ? +cur.size.toFixed(2) : S.fontSize || 24, inputmode: 'decimal',
          onchange: (e) => { const v = parseFloat(e.target.value); if (v > 0) this.setTextAttr('size', v); } })),
        h('label', { class: 'opt-check' }, h('input', { type: 'checkbox', checked: cur ? /bold/i.test(cur.font_style || '') : /bold/i.test(S.fontStyle || ''),
          onchange: (e) => this.setTextAttr('font_style', e.target.checked ? 'Bold' : '') }), '太字'),
        h('label', { class: 'opt-check' }, h('input', { type: 'checkbox', checked: cur ? !!cur.vertical : !!S.vertical,
          onchange: (e) => this.setTextAttr('vertical', e.target.checked) }), '縦書き'),
        h('select', { onchange: (e) => this.setTextAttr('align', e.target.value) },
          [['left', '左揃え'], ['center', '中央揃え'], ['right', '右揃え']].map(([v, l]) => h('option', { value: v, selected: (cur ? cur.align || 'left' : 'left') === v }, l))));
      bar.append(toggle('パスの線を押すとパスに沿わせる', 'textOnShapes'));
      bar.append(h('span', { class: 'opt-hint' }, '押すと 1 行、引っぱると枠の中で折り返す'));
    }
    bar.append(h('span', { class: 'sp' }), toggle('スナップ', 'snap'));
  }
  selText() { return this.app.selection().find((x) => x.kind === 'text') || null; }

  // ---- プロパティ ------------------------------------------------------------------------
  buildProps() {
    const pg = $('#page-prop'), app = this.app;
    const sec = (title, ...kids) => h('section', { class: 'sec' }, h('h3', {}, title), ...kids);
    this.info = h('div', { class: 'sel-info' });
    this.tfBox = this.buildTransform();
    // 塗りと線
    this.chipFill = h('button', { class: 'chip big', onclick: () => this.setTarget('fill') });
    this.chipStroke = h('button', { class: 'chip big stroke', onclick: () => this.setTarget('stroke') });
    this.colorIn = h('input', { type: 'color', oninput: (e) => this.setColor(hexColor(e.target.value, this.cmykMode())) });
    this.hexIn = h('input', { type: 'text', class: 'hex', maxlength: 7, spellcheck: 'false', autocapitalize: 'off',
      onchange: (e) => { const v = e.target.value.trim(); if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) this.setColor(hexColor(v, this.cmykMode())); } });
    this.cmyk = h('div', { class: 'cmyk' }, ['C', 'M', 'Y', 'K'].map((k, i) => h('label', {}, k,
      h('input', { type: 'range', min: 0, max: 100, step: 1, 'data-i': i, oninput: () => this.setCMYK() }),
      h('output', {}))));
    const colorRow = h('div', { class: 'color-row' }, this.chipFill, this.chipStroke,
      h('div', { class: 'color-tools' },
        h('button', { title: 'なし', class: 'mini', onclick: () => this.setColor(null) }, 'なし'),
        h('button', { title: '塗りと線を入れ替え', class: 'mini', onclick: () => this.swapFS() }, '⇄'),
        this.buildGradientBtn(),
        h('div', { class: 'color-pick' }, this.colorIn, this.hexIn)));
    this.swatches = h('div', { class: 'swatches' });
    // 線
    this.widthRange = h('input', { type: 'range', min: 0, max: 50, step: 0.25, oninput: (e) => this.setStroke('width', +e.target.value, true) });
    this.widthNum = h('input', { type: 'number', min: 0, max: 1000, step: 0.25, inputmode: 'decimal', onchange: (e) => this.setStroke('width', Math.max(0, +e.target.value || 0)) });
    const seg = (key, opts) => h('div', { class: 'seg', 'data-key': key }, opts.map(([v, l]) => h('button', { 'data-v': v, onclick: () => this.setStroke(key, v) }, l)));
    this.dashOn = h('input', { type: 'checkbox', onchange: (e) => this.setStroke('dash', e.target.checked ? [this.num(this.dashA, 6), this.num(this.dashB, 4)] : null) });
    this.dashA = h('input', { type: 'number', min: 0, step: 0.5, value: 6, inputmode: 'decimal', onchange: () => this.dashOn.checked && this.setStroke('dash', [this.num(this.dashA, 6), this.num(this.dashB, 4)]) });
    this.dashB = h('input', { type: 'number', min: 0, step: 0.5, value: 4, inputmode: 'decimal', onchange: () => this.dashOn.checked && this.setStroke('dash', [this.num(this.dashA, 6), this.num(this.dashB, 4)]) });
    // 見た目
    this.opRange = h('input', { type: 'range', min: 0, max: 100, step: 1, oninput: (e) => this.setItemAttr('opacity', +e.target.value / 100, true) });
    this.opOut = h('output', {});
    this.blendSel = h('select', { onchange: (e) => this.setItemAttr('blend', e.target.value) }, BLEND_MODES.map(([v, l]) => h('option', { value: v }, l)));
    const act = (label, fn, title) => h('button', { class: 'act', title: title || label, onclick: fn }, label);
    pg.append(
      sec('選択', this.info, this.tfBox),
      (this.textSec = sec('文字', this.buildText())),
      sec('塗りと線', colorRow, this.buildGradient(), this.cmyk, this.swatches,
        h('div', { class: 'row' }, act('＋ スウォッチに追加', () => this.addSwatch()))),
      sec('線',
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, '線幅'), this.widthRange, this.widthNum, h('span', { class: 'unit' }, 'pt')),
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, '線端'), seg('cap', [['butt', 'なし'], ['round', '丸'], ['square', '突出']])),
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, '角'), seg('join', [['miter', 'マイター'], ['round', 'ラウンド'], ['bevel', 'ベベル']])),
        h('div', { class: 'row' }, h('label', { class: 'lbl' }, this.dashOn, '破線'), h('span', { class: 'mini-lbl' }, '線'), this.dashA, h('span', { class: 'mini-lbl' }, '間隔'), this.dashB),
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, '線の形'), (this.profileSel = h('select', { onchange: (e) => this.setStroke('profile', e.target.value === 'uniform' ? null : e.target.value ? WIDTH_PROFILES[e.target.value][1] : undefined) },
          Object.entries(WIDTH_PROFILES).map(([k, [l]]) => h('option', { value: k }, l)), h('option', { value: '', disabled: true }, '（線幅ツールで変えた形）'))))),
      sec('縁取り（袋文字）', this.buildRims()),
      sec('見た目',
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, '不透明度'), this.opRange, this.opOut),
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, '描画モード'), this.blendSel),
        this.buildEffects()),
      sec('パスファインダー',
        h('div', { class: 'grid3' }, Object.entries(PATHFINDER_LABELS).map(([k, l]) => act(l.replace('オブジェクトで', ''), () => app.pathfinder(k), l))),
        h('div', { class: 'grid2' }, act('パスのオフセット…', () => app.offsetDialog()), act('線のアウトライン', () => app.outlineStroke()),
          act('連結', () => app.joinPaths()), act('複合パスを解除', () => app.releaseCompound())),
        h('p', { class: 'note' }, 'シェイプ形成ツール（Shift+M）で、重なった所をなぞって合体もできます')),
      sec('並べる',
        h('div', { class: 'grid3' }, ALIGN_BTNS.map(([k, l]) => act(l, () => app.align(k), l + '揃え'))),
        h('div', { class: 'grid2' }, act('横に等間隔', () => app.distribute('h')), act('縦に等間隔', () => app.distribute('v'))),
        h('p', { class: 'note' }, '1 個だけ選んでいるときはアートボードに揃える')),
      sec('重ね順とグループ',
        h('div', { class: 'grid2' }, act('最前面へ', () => app.arrange('front')), act('最背面へ', () => app.arrange('back')),
          act('前面へ', () => app.arrange('forward')), act('背面へ', () => app.arrange('backward')),
          act('グループ', () => app.group()), act('グループ解除', () => app.ungroup()),
          act('複製', () => app.duplicate()), act('削除', () => app.deleteSelection()))),
    );
  }
  num(el, d) { const v = parseFloat(el.value); return Number.isFinite(v) && v >= 0 ? v : d; }
  cmykMode() { return this.doc && this.doc.data.color_mode === 'cmyk'; }
  /** パネルに出す見た目: 選択の最初の物、無ければ「次に描く物」 */
  shownStyle() {
    for (const it of this.app.selection()) for (const x of this.doc.iterTree([it])) if (x.style) return x.style;
    return this.app.curStyle;
  }
  styledLeaves() {
    const out = [];
    for (const it of this.app.selection()) for (const x of this.doc.iterTree([it])) if (x.style && (x.kind === 'path' || x.kind === 'text') && !this.doc.isLocked(x)) out.push(x);
    return out;
  }
  editStyles(label, fn, merge) {
    const leaves = this.styledLeaves();
    fn(this.app.curStyle, null);
    if (leaves.length) this.doc.edit(label, () => { for (const it of leaves) fn(it.style, it); this.doc.touch(); }, merge);
    this.app.view.request();
    this.refresh();
  }
  setTarget(t) { this.app.colorTarget = t; this.refresh(); }
  setColor(c) {
    const t = this.app.colorTarget;
    if (this.app.textRange()) { this.setTextAttr(t, c ? { ...c, v: [...c.v] } : null, true); return; }
    this.editStyles(t === 'fill' ? '塗り' : '線の色', (st, it) => {
      st[t] = c ? { ...c, v: [...c.v] } : null;
      if (t === 'stroke' && c && !(st.width > 0) && it) st.width = 1;
    }, 'color-' + t);
  }
  setCMYK() {
    const v = $$('input', this.cmyk).map((r) => +r.value / 100);
    this.setColor({ m: 'cmyk', v });
  }
  swapFS() { this.editStyles('塗りと線を入れ替え', (st) => { [st.fill, st.stroke] = [st.stroke, st.fill]; }); }
  setStroke(k, v, merge = false) {
    this.editStyles('線の設定', (st) => {
      if (v == null) delete st[k]; else st[k] = Array.isArray(v) ? [...v] : v;
      if (k === 'width' && v > 0 && !st.stroke && st !== this.app.curStyle) st.stroke = hexColor('#000000', this.cmykMode());
    }, merge ? 'stroke-' + k : null);
  }
  setItemAttr(k, v, merge = false) {
    const items = this.app.selection();
    if (!items.length) return;
    this.doc.edit(k === 'opacity' ? '不透明度' : '描画モード', () => {
      for (const it of items) { if ((k === 'opacity' && v >= 1) || (k === 'blend' && v === 'normal')) delete it[k]; else it[k] = v; }
      this.doc.touch();
    }, merge ? 'item-' + k : null);
    this.app.view.request();
    this.refresh();
  }
  addSwatch() {
    const p = this.shownStyle()[this.app.colorTarget];
    if (!p || isGradient(p)) { toast('単色を選んでから追加してください'); return; }
    this.doc.edit('スウォッチの追加', () => { this.doc.data.swatches.push({ ...p, v: [...p.v] }); });
    this.refresh();
  }
  refreshProps() {
    if ($('#page-prop').hidden) return;
    const app = this.app, doc = this.doc, sel = app.selection();
    const active = document.activeElement;
    const set = (el, v) => { if (el !== active) el.value = v; };
    this.info.textContent = sel.length === 0 ? '選択なし（色は次に描く物に使います）' : sel.length === 1 ? itemLabel(sel[0]) : `${sel.length} 個を選択`;
    this.refreshTransform(sel);
    this.refreshText();
    this.refreshGradient();
    this.refreshRims();
    this.refreshEffects();
    const st = this.shownStyle(), t = app.colorTarget;
    this.paintChip(this.chipFill, st.fill);
    this.paintChip(this.chipStroke, st.stroke);
    this.chipFill.classList.toggle('on', t === 'fill');
    this.chipStroke.classList.toggle('on', t === 'stroke');
    const c = st[t];
    if (c && !isGradient(c)) { set(this.colorIn, colorHex(c)); set(this.hexIn, colorHex(c).toUpperCase()); } else set(this.hexIn, c ? 'グラデ' : '');
    const showCmyk = this.cmykMode() || (c && c.m === 'cmyk');
    this.cmyk.hidden = !showCmyk;
    if (showCmyk) {
      const v = c && !isGradient(c) ? toCMYK(c).v : [0, 0, 0, 0];
      $$('label', this.cmyk).forEach((l, i) => { const r = $('input', l); set(r, Math.round(v[i] * 100)); $('output', l).textContent = Math.round(v[i] * 100) + '%'; });
    }
    // スウォッチ
    const sw = doc.data.swatches || [];
    const swKey = JSON.stringify(sw);
    if (this.swatches._key !== swKey) {
      this.swatches._key = swKey;
      this.swatches.textContent = '';
      this.swatches.append(h('button', { class: 'sw none', title: 'なし', onclick: () => this.setColor(null) }));
      sw.forEach((p, i) => {
        const b2 = h('button', { class: 'sw', title: colorLabel(p) + (p.name ? ' ' + p.name : ''), onclick: () => this.setColor(p) });
        b2.style.background = colorHex(p);
        b2.addEventListener('contextmenu', (e) => { e.preventDefault(); this.removeSwatch(i); });
        this.swatches.append(b2);
      });
    }
    // 線
    set(this.widthRange, Math.min(50, st.width || 0)); set(this.widthNum, +(st.width || 0).toFixed(2));
    $$('.seg', $('#page-prop')).forEach((s) => {
      const cur = st[s.dataset.key] || (s.dataset.key === 'cap' ? 'butt' : 'miter');
      $$('button', s).forEach((bb) => bb.classList.toggle('on', bb.dataset.v === cur));
    });
    this.dashOn.checked = !!(st.dash && st.dash.length);
    if (this.profileSel !== active) {
      const pj = JSON.stringify(st.profile || null), hit = Object.entries(WIDTH_PROFILES).find(([k, [, pr]]) => (k === 'uniform' ? pj === 'null' : JSON.stringify(pr) === pj));
      this.profileSel.value = hit ? hit[0] : '';
    }
    if (st.dash && st.dash.length) { set(this.dashA, st.dash[0]); set(this.dashB, st.dash[1] ?? st.dash[0]); }
    // 見た目
    const it0 = sel[0];
    const op = it0 ? it0.opacity ?? 1 : 1;
    set(this.opRange, Math.round(op * 100)); this.opOut.textContent = Math.round(op * 100) + '%';
    set(this.blendSel, it0 ? it0.blend || 'normal' : 'normal');
    this.opRange.disabled = this.blendSel.disabled = !sel.length;
  }
  removeSwatch(i) {
    if (!confirm('このスウォッチを削除しますか？')) return;
    this.doc.edit('スウォッチの削除', () => { this.doc.data.swatches.splice(i, 1); });
    this.refresh();
  }

  // ---- レイヤー ------------------------------------------------------------------------
  buildLayers() {
    const pg = $('#page-layers'), app = this.app;
    this.layerList = h('div', { class: 'layers' });
    pg.append(
      h('div', { class: 'row layer-btns' },
        h('button', { class: 'act', onclick: () => app.addLayer() }, '＋ 追加'),
        h('button', { class: 'act', onclick: () => app.moveLayer(1) }, '上へ'),
        h('button', { class: 'act', onclick: () => app.moveLayer(-1) }, '下へ'),
        h('button', { class: 'act', onclick: () => app.deleteLayer() }, '削除')),
      this.layerList,
      h('p', { class: 'note' }, '名前を 2 回押すと名前を変えられます。選んだ物は「選択をこのレイヤーへ」で移せます。'),
      h('button', { class: 'act wide', onclick: () => app.moveSelectionToLayer() }, '選択をこのレイヤーへ'));
  }
  refreshLayers() {
    const doc = this.doc, app = this.app, list = this.layerList;
    const selIds = new Set(app.selection().map((x) => x.id));
    const key = JSON.stringify([doc.version, [...selIds], app.expanded && [...app.expanded]]);
    if (list._key === key) return;
    list._key = key;
    list.textContent = '';
    const cur = doc.currentLayer();
    const row = (it, depth) => {
      const isLayer = it.kind === 'layer';
      const eye = h('button', { class: 'ly-eye' + (it.visible === false ? ' off' : ''), title: '表示',
        onclick: (e) => { e.stopPropagation(); doc.edit('表示の切り替え', () => { if (it.visible === false) delete it.visible; else it.visible = false; doc.touch(); }); app.view.request(); } }, it.visible === false ? '◌' : '●');
      const lock = h('button', { class: 'ly-lock' + (it.locked ? ' on' : ''), title: 'ロック',
        onclick: (e) => { e.stopPropagation(); doc.edit('ロックの切り替え', () => { if (it.locked) delete it.locked; else it.locked = true; doc.touch(); }); app.select(app.selection().filter((x) => !doc.isLocked(x))); } }, it.locked ? '🔒' : '·');
      const kids = it.children && it.children.length;
      const open = isLayer ? !app.collapsed.has(it.id) : app.expanded.has(it.id);
      const tw = h('button', { class: 'ly-tw', onclick: (e) => {
        e.stopPropagation();
        if (isLayer) { if (app.collapsed.has(it.id)) app.collapsed.delete(it.id); else app.collapsed.add(it.id); }
        else if (app.expanded.has(it.id)) app.expanded.delete(it.id); else app.expanded.add(it.id);
        list._key = null; this.refreshLayers();
      } }, kids ? (open ? '▾' : '▸') : '');
      const name = h('span', { class: 'ly-name' }, itemLabel(it));
      const r = h('div', { class: 'ly-row' + (isLayer ? ' layer' : '') + (isLayer && it === cur ? ' cur' : '') + (selIds.has(it.id) ? ' sel' : ''),
        style: `--depth:${depth}` }, eye, lock, tw, isLayer ? h('i', { class: 'ly-color', style: `background:${it.color || '#4f7cff'}` }) : null, name);
      r.addEventListener('click', (e) => {
        if (isLayer) {
          if (it === cur && e.target === name) { this.renameLayer(it); return; }
          doc.data.current_layer = it.id; list._key = null; this.refreshLayers();
        } else if (!doc.isLocked(it) && doc.isVisible(it)) {
          const sel = app.selection();
          app.select(e.shiftKey ? (sel.includes(it) ? sel.filter((x) => x !== it) : [...sel, it]) : [it]);
          const l = doc.layerOf(it); if (l) doc.data.current_layer = l.id;
        }
      });
      list.append(r);
      if (kids && open) for (let i = it.children.length - 1; i >= 0; i--) row(it.children[i], depth + 1);
    };
    for (let i = doc.layers.length - 1; i >= 0; i--) row(doc.layers[i], 0);
  }
  renameLayer(l) {
    const n = prompt('レイヤーの名前', l.name || '');
    if (n == null || !n.trim()) return;
    this.doc.edit('レイヤー名', () => { l.name = n.trim(); this.doc.touch(); });
    this.refresh();
  }
}
