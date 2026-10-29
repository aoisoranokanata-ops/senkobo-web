/* 線工房 Web — PDF 書き出し（自前。exe の core/pdf.py と同じ考え方）。アートボード 1 枚が 1 ページ。

   - 色は書類のまま（CMYK の書類は DeviceCMYK、RGB は DeviceRGB）。特色は Separation、トンボはレジストレーション（/All）。
   - 文字はアウトライン（outline.js）。グラデーションはシェーディング（なめらか）。
   - 効果（影・光彩・ぼかし）は 300ppi の画像。画像は RGB か CMYK（CMYK の書類で透明が無いとき）＋透明は SMask。
   - 座標: ページごとに (1 0 0 -1 -x y+h) を掛けて、文書の座標（y 下向き）のまま描く。
*/
'use strict';

const PDF_MM = 72 / 25.4;
const MARK_BLEED = 3 * PDF_MM, MARK_LEN = 10 * PDF_MM, MARK_WIDTH = 0.1 * PDF_MM;
const PDF_BLEND = { normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten',
  'color-dodge': 'ColorDodge', 'color-burn': 'ColorBurn', 'hard-light': 'HardLight', 'soft-light': 'SoftLight', difference: 'Difference', exclusion: 'Exclusion' };
const REGISTRATION = { m: 'cmyk', v: [1, 1, 1, 1], name: 'レジストレーション' };

/** 日本式のトンボ（exe の printmarks.crop_marks と同じ線） */
function cropMarks(r, b = MARK_BLEED, L = MARK_LEN, center = true) {
  const [x0, y0, x1, y1] = r, segs = [];
  for (const [cx, sx] of [[x0, -1], [x1, 1]]) for (const [cy, sy] of [[y0, -1], [y1, 1]]) {
    segs.push([cx + sx * b, cy, cx + sx * (b + L), cy], [cx, cy + sy * b, cx + sx * (b + L), cy + sy * b],
      [cx, cy + sy * b, cx, cy + sy * (b + L)], [cx + sx * b, cy, cx + sx * b, cy + sy * (b + L)]);
  }
  if (center) {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, half = L / 2;
    for (const [px, py, dx, dy] of [[mx, y0, 0, -1], [mx, y1, 0, 1], [x0, my, -1, 0], [x1, my, 1, 0]]) {
      segs.push([px + dx * b, py + dy * b, px + dx * (b + L), py + dy * (b + L)]);
      const c = [px + dx * (b + L / 2), py + dy * (b + L / 2)];
      segs.push(dx === 0 ? [c[0] - half, c[1], c[0] + half, c[1]] : [c[0], c[1] - half, c[0], c[1] + half]);
    }
  }
  return segs;
}
function marksExtent() { return MARK_BLEED + MARK_LEN + 4 * PDF_MM; }

const pn = (v) => { const s = (Math.round(v * 1e4) / 1e4).toString(); return s === '-0' ? '0' : s; };
function pdfName(s) { return '/' + [...new TextEncoder().encode(s)].map((b) => (b > 0x20 && b < 0x7f && !'()<>[]{}/%#'.includes(String.fromCharCode(b)) ? String.fromCharCode(b) : '#' + b.toString(16).padStart(2, '0'))).join(''); }
function pdfText(s) { let h = 'FEFF'; for (const c of String(s)) { const cp = c.codePointAt(0); if (cp > 0xffff) { const v = cp - 0x10000; h += ((0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16)).toUpperCase(); } else h += cp.toString(16).padStart(4, '0').toUpperCase(); } return '<' + h + '>'; }
async function deflate(bytes) {
  if (!window.CompressionStream) return null;
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

class PdfFile {
  constructor() { this.objs = []; }
  reserve() { this.objs.push(null); return this.objs.length; }
  set(id, dict, stream = null) { this.objs[id - 1] = { dict, stream }; return id; }
  add(dict, stream = null) { return this.set(this.reserve(), dict, stream); }
  async addStream(dict, bytes, compress = true) {
    const z = compress ? await deflate(bytes) : null;
    const body = z || bytes;
    const d = `<< ${dict}${z ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>`;
    return this.add(d, body);
  }
  build(rootId, infoId) {
    const enc = new TextEncoder(), parts = [], offs = [];
    let len = 0;
    const push = (b) => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); len += u.length; };
    push('%PDF-1.6\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    this.objs.forEach((o, i) => {
      offs.push(len);
      push(`${i + 1} 0 obj\n`);
      if (o.stream) { push(o.dict + '\nstream\n'); push(o.stream); push('\nendstream'); } else push(o.dict);
      push('\nendobj\n');
    });
    const xref = len;
    let x = `xref\n0 ${this.objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offs) x += String(o).padStart(10, '0') + ' 00000 n \n';
    push(x);
    push(`trailer\n<< /Size ${this.objs.length + 1} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }
}

class PdfWriter {
  constructor(doc, file, opts) {
    this.doc = doc; this.f = file; this.o = opts;
    this.force = doc.data.color_mode === 'cmyk' ? 'cmyk' : null;
    this.res = { ExtGState: new Map(), ColorSpace: new Map(), Shading: new Map(), XObject: new Map() };
    this.gsCache = new Map(); this.csCache = new Map();
    this.pending = [];          // 非同期で作る物（画像）
    this.ops = [];
    this.renderer = new Renderer(doc);
  }
  put(s) { this.ops.push(s); }
  // ---- 色
  sepSpace(name, cmyk) {
    const key = name + JSON.stringify(cmyk);
    if (!this.csCache.has(key)) {
      const fn = this.f.add(`<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${cmyk.map(pn).join(' ')}] /N 1 >>`);
      const id = this.f.add(`[/Separation ${pdfName(name)} /DeviceCMYK ${fn} 0 R]`);
      this.csCache.set(key, 'CS' + this.csCache.size);
      this.res.ColorSpace.set(this.csCache.get(key), id);
    }
    return this.csCache.get(key);
  }
  colorOp(c, stroke) {
    const S = stroke;
    if (c.name === 'レジストレーション' || (c.spot && c.name)) {
      const cs = this.sepSpace(c.name === 'レジストレーション' ? 'All' : c.name, c.name === 'レジストレーション' ? [1, 1, 1, 1] : toCMYK(c).v);
      return `/${cs} ${S ? 'CS' : 'cs'} 1 ${S ? 'SCN' : 'scn'}`;
    }
    const model = this.force || c.m;
    if (model === 'cmyk' || model === 'gray') { const v = c.m === 'gray' ? [0, 0, 0, c.v[0]] : toCMYK(c).v; return `${v.map(pn).join(' ')} ${S ? 'K' : 'k'}`; }
    return `${colorRGB(c).map(pn).join(' ')} ${S ? 'RG' : 'rg'}`;
  }
  gs({ ca = 1, CA = 1, bm = 'Normal', opf = false, ops = false } = {}) {
    const key = [ca, CA, bm, opf, ops].join('|');
    if (!this.gsCache.has(key)) {
      let d = `<< /Type /ExtGState /ca ${pn(ca)} /CA ${pn(CA)} /BM /${bm}`;
      if (opf || ops) d += ` /op ${opf} /OP ${ops} /OPM 1`;
      const id = this.f.add(d + ' >>');
      const name = 'GS' + this.gsCache.size;
      this.gsCache.set(key, name);
      this.res.ExtGState.set(name, id);
    }
    return `/${this.gsCache.get(key)} gs`;
  }
  isK100(c) { if (!c || c.spot || isGradient(c)) return false; const v = c.m === 'gray' ? [0, 0, 0, c.v[0]] : c.m === 'cmyk' ? c.v : null; return !!v && v[3] > 0.995 && Math.max(v[0], v[1], v[2]) < 0.005; }
  // ---- 形
  pathOps(sps) {
    let s = '';
    for (const c of toCmds(sps)) {
      if (c[0] === 'M') s += `${pn(c[1])} ${pn(c[2])} m\n`;
      else if (c[0] === 'L') s += `${pn(c[1])} ${pn(c[2])} l\n`;
      else if (c[0] === 'C') s += `${pn(c[1])} ${pn(c[2])} ${pn(c[3])} ${pn(c[4])} ${pn(c[5])} ${pn(c[6])} c\n`;
      else if (c[0] === 'Z') s += 'h\n';
    }
    return s;
  }
  shading(g) {
    const stops = g.stops.slice().sort((a, b) => a[0] - b[0]);
    const cmyk = this.force === 'cmyk' || stops.some((s) => s[1].m === 'cmyk');
    const val = (c) => (cmyk ? (c.m === 'gray' ? [0, 0, 0, c.v[0]] : toCMYK(c).v) : colorRGB(c)).map(pn).join(' ');
    const fn2 = (a, b) => `<< /FunctionType 2 /Domain [0 1] /C0 [${val(a)}] /C1 [${val(b)}] /N 1 >>`;
    let fn;
    if (stops.length === 1) fn = fn2(stops[0][1], stops[0][1]);
    else if (stops.length === 2 && stops[0][0] <= 0 && stops[1][0] >= 1) fn = fn2(stops[0][1], stops[1][1]);
    else {
      // 0 と 1 にも色を置いて、間を区切りの関数でつなぐ
      const pts = [[0, stops[0][1]], ...stops.map((s) => [clamp01(s[0]), s[1]]), [1, stops[stops.length - 1][1]]];
      const fns = [], bounds = [], encode = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        if (pts[i + 1][0] - pts[i][0] < 1e-6 && !(i === 0 && pts.length === 2)) continue;
        fns.push(fn2(pts[i][1], pts[i + 1][1]));
        if (fns.length > 1) bounds.push(pn(pts[i][0]));
        encode.push('0 1');
      }
      fn = fns.length === 1 ? fns[0] : `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${encode.join(' ')}] >>`;
    }
    const cs = cmyk ? '/DeviceCMYK' : '/DeviceRGB';
    const p0 = g.p0, p1 = g.p1, r = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const d = g.kind === 'radial'
      ? `<< /ShadingType 3 /ColorSpace ${cs} /Coords [${pn(p0[0])} ${pn(p0[1])} 0 ${pn(p0[0])} ${pn(p0[1])} ${pn(Math.max(r, 0.01))}] /Function ${fn} /Extend [true true] >>`
      : `<< /ShadingType 2 /ColorSpace ${cs} /Coords [${pn(p0[0])} ${pn(p0[1])} ${pn(p1[0])} ${pn(p1[1])}] /Function ${fn} /Extend [true true] >>`;
    const name = 'SH' + this.res.Shading.size;
    this.res.Shading.set(name, this.f.add(d));
    return name;
  }
  /** 形を塗る・線を引く（文書座標） */
  drawShape(sps, st, a, evenodd) {
    if (!sps.length) return;
    const P = this.pathOps(sps);
    for (const e of (st.extra || []).slice().reverse()) {
      if (!e.paint || !(e.width > 0)) continue;
      this.drawShape(sps, { fill: null, stroke: e.paint, width: e.width, cap: 'round', join: e.join || 'round' }, a, false);
    }
    let fill = st.fill, stroke = st.stroke && st.width > 0 ? st.stroke : null;
    if (isGradient(fill)) {
      this.put(`q ${this.gs({ ca: a, CA: a })}\n${P}W${evenodd ? '*' : ''} n\n/${this.shading(fill)} sh\nQ\n`);
      fill = null;
    }
    if (isGradient(stroke)) {
      const o = strokeOutline(sps, st.width, st.join || 'miter', st.miter || 10, st.cap || 'butt', st.dash, st.dash_offset || 0);
      if (o.length) this.put(`q ${this.gs({ ca: a, CA: a })}\n${this.pathOps(o)}W* n\n/${this.shading(stroke)} sh\nQ\n`);
      stroke = null;
    }
    if (!fill && !stroke) return;
    const opf = !!fill && (st.op_fill || (this.o.opBlack && this.isK100(fill)));
    const ops = !!stroke && (st.op_stroke || (this.o.opBlack && this.isK100(stroke)));
    let s = `q ${this.gs({ ca: a, CA: a, opf, ops })}\n`;
    if (fill) s += this.colorOp(fill, false) + '\n';
    if (stroke) {
      s += this.colorOp(stroke, true) + `\n${pn(st.width)} w ${{ butt: 0, round: 1, square: 2 }[st.cap || 'butt']} J ${{ miter: 0, round: 1, bevel: 2 }[st.join || 'miter']} j ${pn(st.miter || 10)} M\n`;
      if (st.dash && st.dash.length) s += `[${st.dash.map(pn).join(' ')}] ${pn(st.dash_offset || 0)} d\n`;
    }
    s += P + (fill && stroke ? (evenodd ? 'B*' : 'B') : fill ? (evenodd ? 'f*' : 'f') : 'S') + '\nQ\n';
    this.put(s);
  }
  // ---- 物
  item(it, alpha = 1) {
    if (it.visible === false) return;
    const fx = activeEffects(it);
    if (fx.length) {
      this.rasterPart(it, 'under', fx);
      if (fx.some((e) => e.type === 'blur')) this.rasterPart(it, 'item', fx, alpha);
      else this._item(it, alpha);
      this.rasterPart(it, 'over', fx);
      return;
    }
    this._item(it, alpha);
  }
  _item(it, alpha) {
    const a = alpha * (it.opacity ?? 1), bm = PDF_BLEND[it.blend] || 'Normal';
    if (bm !== 'Normal') this.put(`q ${this.gs({ ca: 1, CA: 1, bm })}\n`);
    if (it.kind === 'path') this.drawShape(it.paths, it.style, a, it.fill_rule === 'evenodd');
    else if (it.kind === 'text') {
      for (const p of textOutlinePaths(it, true)) this.drawShape(p.sps, p.style, a, false);
    } else if (it.kind === 'image') this.image(it, a);
    else if (it.children) {
      const kids = it.children;
      const body = () => {
        if (it.clip && kids.length) {
          const cs = this.clipSps(kids[kids.length - 1]);
          this.put('q\n' + (cs.length ? this.pathOps(cs) + 'W n\n' : ''));
          for (const k of kids.slice(0, -1)) this.item(k, a);
          this.put('Q\n');
        } else for (const k of kids) this.item(k, a);
      };
      body();
      if (it.symmetry) for (const m of symmetryMatrices(it.symmetry)) { this.put(`q ${m.map(pn).join(' ')} cm\n`); body(); this.put('Q\n'); }
    }
    if (bm !== 'Normal') this.put('Q\n');
  }
  clipSps(it) {
    if (it.kind === 'path') return it.paths;
    if (it.kind === 'text') return textOutlinePaths(it).flatMap((p) => p.sps);
    if (it.kind === 'image') return [rectSp(0, 0, it.pw, it.ph)].map((sp) => { spsTransform([sp], it.matrix); return sp; });
    if (it.children) return it.children.flatMap((c) => this.clipSps(c));
    return [];
  }
  /** 画像を置く（読み込みは後でまとめて） */
  image(it, a) {
    const bytes = this.doc.images[it.image];
    if (!bytes) return;
    const name = 'IM' + it.image;
    if (!this.res.XObject.has(name)) { this.res.XObject.set(name, null); this.pending.push(this.imageObj(name, bytes)); }
    const m = M.then([it.pw, 0, 0, -it.ph, 0, it.ph], it.matrix);
    this.put(`q ${this.gs({ ca: a, CA: a })} ${m.map(pn).join(' ')} cm /${name} Do Q\n`);
  }
  async imageObj(name, bytes) {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const cv = newCanvas(bmp.width, bmp.height), ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    this.res.XObject.set(name, await this.pixelsObj(ctx.getImageData(0, 0, cv.width, cv.height), sniffExt(bytes) === '.jpg' ? bytes : null));
  }
  /** 画素 → 画像の物（CMYK の書類で透明が無ければ CMYK、それ以外は RGB ＋ SMask） */
  async pixelsObj(img, jpeg = null) {
    const { width: w, height: h, data } = img, n = w * h;
    let opaque = true;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { opaque = false; break; }
    const cmyk = this.force === 'cmyk' && this.o.imagesCmyk && opaque;
    if (jpeg && opaque && !cmyk) return this.f.add(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
    let px;
    if (cmyk) {
      px = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255, k = 1 - Math.max(r, g, b), d = k < 0.9999 ? 1 - k : 1;
        px[i * 4] = Math.round((1 - r - k) / d * 255); px[i * 4 + 1] = Math.round((1 - g - k) / d * 255); px[i * 4 + 2] = Math.round((1 - b - k) / d * 255); px[i * 4 + 3] = Math.round(k * 255);
      }
    } else {
      px = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) { px[i * 3] = data[i * 4]; px[i * 3 + 1] = data[i * 4 + 1]; px[i * 3 + 2] = data[i * 4 + 2]; }
    }
    let smask = '';
    if (!opaque) {
      const al = new Uint8Array(n);
      for (let i = 0; i < n; i++) al[i] = data[i * 4 + 3];
      const sid = await this.f.addStream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8`, al);
      smask = ` /SMask ${sid} 0 R`;
    }
    return this.f.addStream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /${cmyk ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8${smask}`, px);
  }
  /** 効果の部分を 300ppi の画像に（under: 影・外側の光彩、item: ぼかした物、over: 内側の光彩） */
  rasterPart(it, part, fx, alpha = 1) {
    const want = part === 'under' ? fx.filter((e) => e.type === 'drop_shadow' || e.type === 'outer_glow') : part === 'over' ? fx.filter((e) => e.type === 'inner_glow') : fx;
    if (!want.length) return;
    const b0 = itemVisualBBox(it);
    if (!b0) return;
    const rim = Math.max(0, ...((it.style && it.style.extra) || []).map((e) => e.width || 0)) / 2;
    const mg = effectMargin(fx) + rim + 2, b = [b0[0] - mg, b0[1] - mg, b0[2] + mg, b0[3] + mg];
    let sc = 300 / 72;
    const area = (b[2] - b[0]) * (b[3] - b[1]) * sc * sc;
    if (area > 2.4e7) sc *= Math.sqrt(2.4e7 / area);
    const w = Math.max(1, Math.ceil((b[2] - b[0]) * sc)), h = Math.max(1, Math.ceil((b[3] - b[1]) * sc));
    const cv = newCanvas(w, h), ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(sc, 0, 0, sc, -b[0] * sc, -b[1] * sc);
    this.renderer.drawRasterFx(ctx, it, alpha * (it.opacity ?? 1), fx, new Set([part]));
    const name = 'FX' + this.res.XObject.size;
    this.res.XObject.set(name, null);
    const img = ctx.getImageData(0, 0, w, h);
    this.pending.push(this.pixelsObj(img).then((id) => this.res.XObject.set(name, id)));
    const mode = part === 'item' ? it.blend : (want[0].mode || 'normal');
    const bm = PDF_BLEND[mode] || 'Normal';
    this.put(`q ${this.gs({ bm })} ${pn(b[2] - b[0])} 0 0 ${pn(-(b[3] - b[1]))} ${pn(b[0])} ${pn(b[3])} cm /${name} Do Q\n`);
  }
}

/** PDF を作る → Blob。opts: {artboards, bleed, marks, pageInfo, opBlack, imagesCmyk, title} */
async function exportPdf(doc, opts) {
  await preloadImages(doc);
  const f = new PdfFile(), pagesId = f.reserve(), kids = [];
  const idx = opts.artboards || doc.artboards.map((_, i) => i);
  const bleed = opts.bleed ?? doc.data.bleed ?? 0, title = opts.title || doc.name || '線工房';
  const margin = opts.marks ? Math.max(marksExtent(), bleed + 2 * PDF_MM) : bleed;
  for (let n = 0; n < idx.length; n++) {
    const ab = doc.artboards[idx[n]];
    const pw = ab.w + 2 * margin, ph = ab.h + 2 * margin;
    const w = new PdfWriter(doc, f, opts);
    const page = `1 0 0 -1 ${pn(-(ab.x - margin))} ${pn(ab.y - margin + ph)} cm\n`;
    w.put('q\n' + page);
    if (opts.marks) w.put(`${pn(ab.x - bleed)} ${pn(ab.y - bleed)} ${pn(ab.w + 2 * bleed)} ${pn(ab.h + 2 * bleed)} re W n\n`);
    for (const l of doc.layers) w.item(l);
    w.put('Q\n');
    if (opts.marks) {
      w.put('q\n' + page + w.colorOp(REGISTRATION, true) + `\n${pn(MARK_WIDTH)} w 0 J 0 j\n`);
      for (const [x1, y1, x2, y2] of cropMarks([ab.x, ab.y, ab.x + ab.w, ab.y + ab.h])) w.put(`${pn(x1)} ${pn(y1)} m ${pn(x2)} ${pn(y2)} l S\n`);
      w.put('Q\n');
      if (opts.pageInfo !== false) {
        // ページ情報（ファイル名・日時）: 字はアウトラインにして、レジストレーションで塗る
        const d = new Date(), z = (x) => String(x).padStart(2, '0');
        const info = makeText(`${title}　${ab.name}　${n + 1}/${idx.length}　${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}　線工房`, 'Yu Gothic', 6, newStyle(null, null));
        info.matrix = M.t(ab.x - margin + margin, ab.y - margin + ph - 2.2 * PDF_MM);
        w.put('q\n' + page + w.colorOp(REGISTRATION, false) + '\n');
        for (const p of textOutlinePaths(info)) w.put(w.pathOps(p.sps) + 'f\n');
        w.put('Q\n');
      }
    }
    await Promise.all(w.pending);
    const content = await f.addStream('', new TextEncoder().encode(w.ops.join('')));
    const dict = (m) => [...m].map(([k, v]) => `/${k} ${v} 0 R`).join(' ');
    const res = `<< /ProcSet [/PDF /ImageB /ImageC] ${Object.entries(w.res).filter(([, m]) => m.size).map(([k, m]) => `/${k} << ${dict(m)} >>`).join(' ')} >>`;
    let box = `/MediaBox [0 0 ${pn(pw)} ${pn(ph)}]`;
    if (margin > 0) box += ` /TrimBox [${pn(margin)} ${pn(margin)} ${pn(margin + ab.w)} ${pn(margin + ab.h)}] /BleedBox [${pn(margin - bleed)} ${pn(margin - bleed)} ${pn(margin + ab.w + bleed)} ${pn(margin + ab.h + bleed)}]`;
    kids.push(f.add(`<< /Type /Page /Parent ${pagesId} 0 R ${box} /Resources ${res} /Contents ${content} 0 R /Group << /S /Transparency /CS /Device${doc.data.color_mode === 'cmyk' ? 'CMYK' : 'RGB'} >> >>`));
  }
  f.set(pagesId, `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
  const root = f.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const d = new Date(), z = (x) => String(x).padStart(2, '0');
  const info = f.add(`<< /Title ${pdfText(title)} /Creator ${pdfText('線工房 Web')} /Producer ${pdfText('線工房 Web ' + APP_VERSION)} /CreationDate (D:${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}) >>`);
  return f.build(root, info);
}
