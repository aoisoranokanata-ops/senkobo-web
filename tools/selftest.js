/* exe との突き合わせの材料をまとめて作る（ブラウザ側）。開発サーバーの画面のコンソールで:
     eval(await (await fetch('tools/selftest.js')).text())
   先に python tools/snk_check.py prepare（exe の見本を fixtures に）。終わったら python tools/check_all.py。
   作る物: web_*.snk / web_*.png（往復）・bool_web.json（形の計算）・web_*.pdf（PDF）・webdoc_all.snk / .png（Web で作った全部入りの作品）。 */
(async () => {
  const log = [];
  const t0 = performance.now();
  log.push('往復: ' + (await eval(await (await fetch('tools/roundtrip.js')).text())).join(' / '));
  log.push('形の計算: ' + (await eval(await (await fetch('tools/boolcases.js')).text())));
  const names = await (await fetch('tools/fixtures/list.json')).json();
  for (const n of names) {
    const d = await snkToDoc(await (await fetch(`tools/fixtures/exe_${n}.snk`)).blob());
    await fetch(`tools/fixtures/web_${n}.pdf`, { method: 'PUT', body: await exportPdf(d, { marks: true, pageInfo: true, opBlack: true, imagesCmyk: true, bleed: 3 * 72 / 25.4 }) });
  }
  log.push(`PDF: ${names.length} 枚`);
  // Web で作る全部入りの作品（フェーズ1〜5 の機能を 1 つずつ）
  const doc = Doc.create(1200, 900, 'cmyk', 'mm', 2);
  const add = (it, parent) => doc.addItem(it, parent || doc.currentLayer());
  const st = (f, s, w = 1) => newStyle(f && hexColor(f, true), s && hexColor(s, true), w);
  const bg = makeShape({ kind: 'rect', x: 0, y: 0, w: 1200, h: 900, r: 0 }, st('#fdf2e0'));
  bg.style.fill = { type: 'gradient', kind: 'radial', p0: [600, 450], p1: [1200, 900], stops: [[0, hexColor('#ffffff', true), 1], [1, hexColor('#f3c48c', true), 1]] };
  add(bg);
  const a = makeShape({ kind: 'ellipse', cx: 260, cy: 260, rx: 160, ry: 160 }, st('#e60012'));
  const b = makeShape({ kind: 'star', cx: 360, cy: 300, r1: 150, r2: 70, points: 5, corner: 8 }, st('#0068b7'));
  add(a); add(b);
  const u = makePath(boolOp(doc, [a, b], 'exclude'), st('#920783', '#1d2a5c', 4)); u.fill_rule = 'evenodd';
  u.effects = [newEffect('drop_shadow')];
  OPS.remove(doc, [a, b]); add(u);
  const off = makePath(offsetSps(boolPaths(doc, u), 12, 'round', 4), st('#fff100')); off.fill_rule = 'evenodd';
  const parent = doc.parentOf(u); doc.addItem(off, parent, parent.children.indexOf(u));
  const line = makePath([{ n: [N(80, 760), N(600, 620, 330, 560, 870, 680), N(1120, 780)], c: false }], st(null, '#1d2a5c', 26));
  line.style.profile = WIDTH_PROFILES.brush[1]; line.style.cap = 'round'; add(line);
  const t1 = makeText('線工房 Web で作った作品', 'Yu Gothic', 64, st('#1d2a5c')); t1.font_style = 'Bold'; t1.matrix = M.t(560, 150);
  t1.runs = [{ s: 0, e: 3, fill: hexColor('#e60012', true), ruby: 'せんこうぼう' }];
  t1.style.extra = [{ paint: hexColor('#ffffff', true), width: 10, join: 'round' }];
  t1.warp = { type: 'arch', bend: 0.3 };
  add(t1);
  const t2 = makeText('縦書きで令和8年10月29日。エリアの中で折り返します。', 'Yu Mincho', 28, st('#333333'));
  t2.vertical = true; t2.tcy = 2; t2.text_kind = 'area'; t2.frame = [rectSp(0, 0, 160, 330)]; t2.matrix = M.t(1000, 300); add(t2);
  const sym = makeGroup([makeShape({ kind: 'ellipse', cx: 800, cy: 420, rx: 18, ry: 60 }, st('#e4007f', '#1d2a5c', 2))]);
  sym.symmetry = { mode: 'radial', n: 8, mirror: false, cx: 800, cy: 500 }; add(sym);
  const clipA = makeShape({ kind: 'rect', x: 600, y: 650, w: 200, h: 120, r: 20 }, st('#009944'));
  const clipB = makeShape({ kind: 'ellipse', cx: 700, cy: 710, rx: 80, ry: 80 }, st(null)); add(clipA); add(clipB);
  OPS.makeClip(doc, [clipA, clipB]);
  doc.data.guides = [{ o: 'v', p: 600 }, { o: 'h', p: 450 }];
  doc.data.bleed = 3 * 72 / 25.4;
  await fetch('tools/fixtures/webdoc_all.snk', { method: 'PUT', body: await docToSnk(doc) });
  const ab = doc.artboards[0];
  await fetch('tools/fixtures/webdoc_all.png', { method: 'PUT', body: await canvasToBlob(renderToCanvas(doc, [ab.x, ab.y, ab.x + ab.w, ab.y + ab.h], 400 / Math.max(ab.w, ab.h), '#ffffff')) });
  log.push(`全部入りの作品: ${[...doc.iterTree()].length} 個`);
  log.push(`${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
  return log;
})();
