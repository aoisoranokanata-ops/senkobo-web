/* 線工房 Web — 印刷まわり（フェーズ4）: PDF 書き出しの設定・文字のアウトライン化・テンプレート。App のメソッドとして足す。 */
'use strict';

Object.assign(App.prototype, {
  async pdfDialog() {
    const doc = this.doc, last = this.settings.pdf || {}, u = doc.data.units === 'px' ? 'mm' : doc.data.units;
    const purpose = h('select', {}, h('option', { value: 'print' }, '入稿用（トンボ・塗り足し・CMYK）'), h('option', { value: 'screen' }, '確認用（仕上がりの大きさだけ）'));
    const range = h('select', {}, h('option', { value: 'all' }, 'すべてのアートボード'), doc.artboards.map((a, i) => h('option', { value: i }, `${i + 1}. ${a.name}`)));
    const marks = h('input', { type: 'checkbox' }), info = h('input', { type: 'checkbox' }), opBlack = h('input', { type: 'checkbox' }), cmykImg = h('input', { type: 'checkbox', checked: true });
    const bleed = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: +(((doc.data.bleed > 0 ? doc.data.bleed : 3 * PT_PER.mm)) / PT_PER[u]).toFixed(3) });
    const preset = () => { const p = purpose.value === 'print'; marks.checked = p; info.checked = p; opBlack.checked = p; };
    purpose.addEventListener('change', preset);
    purpose.value = last.purpose || (doc.data.color_mode === 'cmyk' ? 'print' : 'screen');
    preset();
    if ('marks' in last && purpose.value === last.purpose) { marks.checked = last.marks; info.checked = last.info; opBlack.checked = last.opBlack; }
    const body = h('div', { class: 'form' },
      h('label', {}, '目的', purpose), h('label', {}, '範囲', range),
      h('label', { class: 'check' }, marks, 'トンボ（日本式・センタートンボ付き）'),
      h('label', { class: 'check' }, info, 'ページ情報（ファイル名・日時）'),
      h('label', {}, `裁ち落とし（${u}）`, bleed),
      h('label', { class: 'check' }, opBlack, 'K100% の塗り・線をオーバープリント（墨ノセ）'),
      h('label', { class: 'check' }, cmykImg, 'RGB の画像を CMYK にして入れる（CMYK の書類のとき）'),
      h('p', { class: 'note' }, '文字はすべてアウトラインになります。効果（影・ぼかし）は 300ppi の画像として入ります。' +
        (doc.data.color_mode !== 'cmyk' ? '書類は RGB です。印刷所に出すなら［ファイル］→［書類の設定］で CMYK にしてください。' : '書類は CMYK です。')));
    if (!await this.modal('PDF 書き出し（印刷用）', body, [['キャンセル', false], ['書き出す', true, 'primary']])) return;
    this.settings.pdf = { purpose: purpose.value, marks: marks.checked, info: info.checked, opBlack: opBlack.checked };
    this.saveSettings();
    const b = Math.max(0, parseFloat(bleed.value) || 0) * PT_PER[u];
    const opts = { artboards: range.value === 'all' ? null : [+range.value], marks: marks.checked, pageInfo: info.checked,
      bleed: marks.checked || purpose.value === 'print' ? b : 0, opBlack: opBlack.checked, imagesCmyk: cmykImg.checked, title: doc.name };
    toast('PDF を作っています…', 20000);
    try {
      if (this.editing) this.endTextEdit();
      const t0 = performance.now();
      const blob = await exportPdf(doc, opts);
      toast(`PDF ができました（${(blob.size / 1024 / 1024).toFixed(1)} MB・${((performance.now() - t0) / 1000).toFixed(1)} 秒）`, 2500);
      const n = opts.artboards && doc.artboards.length > 1 ? `_${opts.artboards[0] + 1}` : '';
      await shareOrDownload(blob, this.fileBase() + n + '.pdf');
    } catch (e) { console.error(e); toast('PDF を作れませんでした: ' + e.message, 6000); }
  },
  /** 文字をアウトライン化（1 文字 1 つのパスを 1 つのグループに。exe の outline_text と同じ） */
  outlineText() {
    const doc = this.doc, texts = topLevel(doc, this.selection()).filter((x) => x.kind === 'text');
    if (!texts.length) { toast('文字を選んでください'); return; }
    const out = [];
    doc.edit('アウトラインを作成', () => {
      for (const t of texts) {
        const parts = textOutlinePaths(t, true);
        const g = makeGroup(parts.map((p) => { const q = makePath(p.sps, p.style); q.fill_rule = 'nonzero'; return q; }));
        g.name = itemLabel(t);
        for (const k of ['opacity', 'blend', 'effects']) if (t[k] != null) g[k] = JSON.parse(JSON.stringify(t[k]));
        const parent = doc.parentOf(t), idx = parent.children.indexOf(t);
        doc.remove(t);
        doc.addItem(g, parent, idx);
        out.push(g);
      }
    });
    this.select(out);
    toast('字の形は端末のフォントから作りました（exe とは字の形が少し違うことがあります）', 3500);
  },
  async saveTemplate() {
    const name = prompt('テンプレートの名前（新しい作品を作るときに選べます）', (this.doc.name || 'テンプレート'));
    if (!name || !name.trim()) return;
    if (this.editing) this.endTextEdit();
    const copy = new Doc(JSON.parse(this.doc.snapshot()), { ...this.doc.images });
    copy.name = name.trim();
    copy.template = true;
    await Store.save(copy, await this.thumbnail(copy, 360, 'image/jpeg'));
    toast(`テンプレート「${copy.name}」を保存しました`);
  },
});
