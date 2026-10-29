/* exe との往復確認（ブラウザ側）。開発サーバーで開いた画面のコンソールで:
     eval(await (await fetch('tools/roundtrip.js')).text())
   tools/fixtures/exe_*.snk を Web で開いて、web_*.snk（そのまま保存し直した物）と web_*.png（Web で描いた絵）を PUT する。
   その後 python tools/snk_check.py check で exe 側から確かめる。 */
(async () => {
  const names = await (await fetch('tools/fixtures/list.json')).json();
  const out = [];
  for (const n of names) {
    const blob = await (await fetch(`tools/fixtures/exe_${n}.snk`)).blob();
    const doc = await snkToDoc(blob);
    await preloadImages(doc);
    const a = doc.artboards[0];
    const cv = renderToCanvas(doc, [a.x, a.y, a.x + a.w, a.y + a.h], 400 / Math.max(a.w, a.h), '#ffffff');
    const snk = await docToSnk(doc);
    await fetch(`tools/fixtures/web_${n}.snk`, { method: 'PUT', body: snk });
    await fetch(`tools/fixtures/web_${n}.png`, { method: 'PUT', body: await canvasToBlob(cv) });
    out.push(`${n}: ${[...doc.iterTree()].length} 個`);
  }
  return out;
})();
