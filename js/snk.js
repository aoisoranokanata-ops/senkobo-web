/* 線工房 Web — .snk（exe と同じ: zip の document.json ＋ images/<id>.<拡張子>）の読み書き、SVG 書き出し */
'use strict';

function sniffExt(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return '.png';
  if (b[0] === 0xff && b[1] === 0xd8) return '.jpg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return '.webp';
  return '.bin';
}
async function docToSnk(doc, thumbPng = null) {
  const enc = new TextEncoder();
  const data = doc.pack();
  const used = new Set([...doc.iterTree()].filter((x) => x.kind === 'image').map((x) => x.image));
  const entries = [{ name: 'mimetype', data: enc.encode('application/x-senkobo') },
    { name: 'document.json', data: enc.encode(JSON.stringify(data)) }];
  for (const id of [...used].sort()) if (doc.images[id]) entries.push({ name: `images/${id}${sniffExt(doc.images[id])}`, data: doc.images[id] });
  if (thumbPng) entries.push({ name: 'thumbnail.png', data: thumbPng });
  return zipStore(entries);
}
async function snkToDoc(blob) {
  const files = await unzip(blob);
  if (!files['document.json']) throw new Error('線工房のファイルではありません');
  const data = JSON.parse(new TextDecoder().decode(files['document.json']));
  if (data.format !== 'senkobo') throw new Error('線工房のファイルではありません');
  const images = {};
  for (const [name, bytes] of Object.entries(files)) {
    if (name.startsWith('images/')) images[name.slice(7).replace(/\.[^.]+$/, '')] = bytes;
  }
  // リンク画像で中身が無い物（exe のリンク）は枠だけ表示される
  return new Doc(data, images);
}

// ---- SVG 書き出し（exe の core/svg.py の書き出しと同じ考え方）---------------------------------------
function svgNum(v) { const s = (Math.round(v * 1000) / 1000).toString(); return s === '-0' ? '0' : s; }
function svgD(sps) {
  return toCmds(sps).map((c) => (c[0] === 'Z' ? 'Z' : c[0] + c.slice(1).map(svgNum).join(' '))).join('');
}
function docToSvg(doc, artboard = 0, items = null) {
  const defs = [];
  let n = 0;
  const uid = (p) => p + (++n);
  const paint = (p, what) => {
    if (!p) return `${what}="none"`;
    if (isGradient(p)) {
      const gid = uid('grad');
      const stops = p.stops.map(([pos, c, o]) => `<stop offset="${svgNum(pos)}" stop-color="${colorHex(c)}"${o < 1 ? ` stop-opacity="${svgNum(o)}"` : ''}/>`).join('');
      if (p.kind === 'radial') {
        const r = Math.hypot(p.p1[0] - p.p0[0], p.p1[1] - p.p0[1]);
        defs.push(`<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${svgNum(p.p0[0])}" cy="${svgNum(p.p0[1])}" r="${svgNum(r)}">${stops}</radialGradient>`);
      } else {
        defs.push(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${svgNum(p.p0[0])}" y1="${svgNum(p.p0[1])}" x2="${svgNum(p.p1[0])}" y2="${svgNum(p.p1[1])}">${stops}</linearGradient>`);
      }
      return `${what}="url(#${gid})"`;
    }
    return `${what}="${colorHex(p)}"`;
  };
  const styleAttrs = (st) => {
    const a = [paint(st.fill, 'fill'), paint(st.stroke, 'stroke')];
    if (st.stroke) {
      a.push(`stroke-width="${svgNum(st.width)}"`);
      if (st.cap && st.cap !== 'butt') a.push(`stroke-linecap="${st.cap}"`);
      if (st.join && st.join !== 'miter') a.push(`stroke-linejoin="${st.join}"`);
      if (st.dash && st.dash.length) a.push(`stroke-dasharray="${st.dash.map(svgNum).join(' ')}"`);
    }
    return a.join(' ');
  };
  const common = (it) => (it.opacity != null && it.opacity < 1 ? ` opacity="${svgNum(it.opacity)}"` : '') +
    (it.blend && it.blend !== 'normal' ? ` style="mix-blend-mode:${it.blend}"` : '');
  const rims = (d, st, sc = 1) => (st.extra || []).slice().reverse().filter((e) => e.paint)
    .map((e) => `<path d="${d}" fill="none" ${paint(e.paint, 'stroke')} stroke-width="${svgNum(e.width / sc)}" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
  const item = (it) => {
    if (it.visible === false) return '';
    if (it.kind === 'path') {
      if (!it.paths.length) return '';
      const d = svgD(it.paths), fr = it.fill_rule === 'evenodd' ? ' fill-rule="evenodd"' : '';
      const body = `<path d="${d}" ${styleAttrs(it.style)}${fr}/>`;
      return it.style.extra && it.style.extra.length ? `<g${common(it)}>${rims(d, it.style)}${body}</g>` : body.slice(0, -2) + `${common(it)}/>`;
    }
    if (it.kind === 'text') {
      const lay = textLayout(it), m = it.matrix.map(svgNum).join(' ');
      const fam = esc(it.font || '');
      const bold = /bold|太/i.test(it.font_style || '') ? ' font-weight="bold"' : '';
      const tsp = lay.vertical ? '' : lay.lines.map((l) => `<tspan x="${svgNum(l.x)}" y="${svgNum(l.y)}">${esc(l.text)}</tspan>`).join('');
      const vt = lay.vertical ? lay.lines.map((l) => `<tspan x="${svgNum(l.x)}" y="${svgNum(l.y)}">${esc(l.chars.map((c) => c.ch).join(''))}</tspan>`).join('') : '';
      return `<text transform="matrix(${m})" font-family="${fam}, sans-serif" font-size="${svgNum(it.size)}"${bold}` +
        `${lay.vertical ? ' writing-mode="vertical-rl"' : ''} ${styleAttrs(it.style)}${common(it)}>${tsp}${vt}</text>`;
    }
    if (it.kind === 'image') {
      const b = doc.images[it.image];
      if (!b) return '';
      const mime = sniffExt(b) === '.png' ? 'image/png' : 'image/jpeg';
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      return `<image width="${it.pw}" height="${it.ph}" transform="matrix(${it.matrix.map(svgNum).join(' ')})" href="data:${mime};base64,${btoa(s)}" preserveAspectRatio="none"${common(it)}/>`;
    }
    if (it.children) {
      let kids = it.children, clip = '';
      if (it.clip && kids.length) {
        const cid = uid('clip'), mask = kids[kids.length - 1];
        defs.push(`<clipPath id="${cid}">${mask.kind === 'path' ? `<path d="${svgD(mask.paths)}"/>` : ''}</clipPath>`);
        clip = ` clip-path="url(#${cid})"`;
        kids = kids.slice(0, -1);
      }
      let inner = kids.map(item).join('');
      if (it.symmetry) inner += symmetryMatrices(it.symmetry).map((m) => `<g transform="matrix(${m.map(svgNum).join(' ')})">${inner}</g>`).join('');
      const label = it.kind === 'layer' ? ` data-layer="${esc(it.name || '')}"` : '';
      return `<g${label}${clip}${common(it)}>${inner}</g>`;
    }
    return '';
  };
  let body, b;
  if (items) { body = sortByOrder(doc, items).map(item).join(''); b = selectionBBox(items, true) || [0, 0, 1, 1]; }
  else { body = doc.layers.map(item).join(''); const a = doc.artboards[artboard]; b = [a.x, a.y, a.x + a.w, a.y + a.h]; }
  const w = Math.max(b[2] - b[0], 1e-3), h = Math.max(b[3] - b[1], 1e-3);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${svgNum(w)}" height="${svgNum(h)}" ` +
    `viewBox="${svgNum(b[0])} ${svgNum(b[1])} ${svgNum(w)} ${svgNum(h)}">\n${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body}\n</svg>\n`;
}
