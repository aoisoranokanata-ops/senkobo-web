/* 形の計算の突き合わせ（ブラウザ側）。開発サーバーの画面のコンソールで:
     eval(await (await fetch('tools/boolcases.js')).text())
   いくつかの形の組で、Web の結果を tools/fixtures/bool_web.json に PUT する。
   python tools/boolean_check.py が同じ入力を exe（skia-pathops）で計算して、面積と数を比べる。 */
(async () => {
  const S = (sh) => makeShape(sh, newStyle(hexColor('#ff0000'), null));
  const P = (nodes, c = true) => makePath([{ n: nodes, c }], newStyle(hexColor('#00ff00'), null));
  const ring = makePath([ellipseSp(0, 0, 100, 100), ellipseSp(0, 0, 60, 60)], newStyle(hexColor('#0000ff'), null));
  ring.fill_rule = 'evenodd';
  const cases = {
    circles: [S({ kind: 'ellipse', cx: 100, cy: 100, rx: 50, ry: 50 }), S({ kind: 'ellipse', cx: 160, cy: 100, rx: 50, ry: 50 })],
    star_rrect: [S({ kind: 'star', cx: 700, cy: 700, r1: 180, r2: 80, points: 5, corner: 0 }), S({ kind: 'rect', x: 560, y: 560, w: 260, h: 150, r: 30 })],
    shared_edge: [S({ kind: 'rect', x: 0, y: 0, w: 100, h: 100 }), S({ kind: 'rect', x: 100, y: 0, w: 100, h: 100 })],
    same_rect: [S({ kind: 'rect', x: 0, y: 0, w: 100, h: 100 }), S({ kind: 'rect', x: 0, y: 0, w: 100, h: 100 })],
    ring_circle: [ring, S({ kind: 'ellipse', cx: 80, cy: 0, rx: 50, ry: 50 })],
    island: [S({ kind: 'ellipse', cx: 0, cy: 0, rx: 100, ry: 100 }), S({ kind: 'ellipse', cx: 0, cy: 0, rx: 40, ry: 40 })],
    tangent: [S({ kind: 'polygon', cx: 0, cy: 0, r: 100, sides: 6, corner: 0 }), S({ kind: 'ellipse', cx: 0, cy: -150, rx: 50, ry: 50 })],
    bowtie: [P([N(0, 0), N(100, 100), N(100, 0), N(0, 100)]), S({ kind: 'rect', x: 30, y: 30, w: 40, h: 40 })],
    three: [S({ kind: 'rect', x: 0, y: 0, w: 200, h: 200 }), S({ kind: 'ellipse', cx: 200, cy: 100, rx: 110, ry: 110 }), S({ kind: 'polygon', cx: 100, cy: 200, r: 90, sides: 6, corner: 0 })],
  };
  const doc = Doc.create(1000, 1000, 'rgb', 'px', 1);
  const out = { cases: {}, ops: {} };
  const area = (sps) => { const f = flattenForBool(sps, [], 0.005); return f.polys.reduce((s, p) => s + polyArea(p), 0); };
  const t0 = performance.now();
  for (const [name, items] of Object.entries(cases)) {
    for (const it of items) doc.assignIds(it);
    out.cases[name] = items.map((it) => JSON.parse(JSON.stringify(packItem(it))));
    const r = {};
    for (const how of ['unite', 'minus_front', 'intersect', 'exclude', 'minus_back']) {
      const sps = boolOp(doc, items, how);
      r[how] = { area: Math.abs(area(sps)), loops: sps.length, nodes: sps.reduce((s, x) => s + x.n.length, 0) };
    }
    const dv = divideRegions(doc, items);
    r.divide = { regions: dv.regs.length, area: dv.regs.reduce((s, x) => s + Math.abs(area(x.sps)), 0) };
    const paths = boolPaths(doc, items[0]);
    for (const [k, d, j] of [['off_p10_round', 10, 'round'], ['off_m10_miter', -10, 'miter']]) {
      const sps = offsetSps(paths, d, j, 4);
      r[k] = { area: Math.abs(area(sps)), loops: sps.length, nodes: sps.reduce((s, x) => s + x.n.length, 0) };
    }
    const so = strokeOutline(items[0].paths, 8, 'round', 10, 'round');
    r.stroke8 = { area: Math.abs(area(so)), loops: so.length, nodes: so.reduce((s, x) => s + x.n.length, 0) };
    out.ops[name] = r;
  }
  const line = [{ n: [N(100, 700), N(250, 600, 200, 600, 300, 600), N(400, 750)], c: false }];
  out.lines = {
    round: Math.abs(area(strokeOutline(line, 24, 'round', 10, 'round'))),
    butt_miter: Math.abs(area(strokeOutline(line, 24, 'miter', 10, 'butt'))),
    dash: Math.abs(area(strokeOutline(line, 6, 'miter', 10, 'butt', [20, 10]))),
    line: line.map((sp) => ({ n: sp.n.map(nodeToList), c: 0 })),
  };
  out.ms = performance.now() - t0;
  await fetch('tools/fixtures/bool_web.json', { method: 'PUT', body: JSON.stringify(out) });
  return `${Object.keys(cases).length} 組・${out.ms.toFixed(0)} ms`;
})();
