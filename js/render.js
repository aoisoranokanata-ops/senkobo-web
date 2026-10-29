/* 線工房 Web — 描画（Canvas 2D）。画面・PNG 書き出し・サムネイルで同じ描き方。

   文字は端末のフォントで描く（exe の harfbuzz の組版とは字の形・幅が少し違う）。
   効果: ドロップシャドウ・外側の光彩は canvas の shadow、ぼかしは filter、内側の光彩は省略（フェーズ2で）。
*/
'use strict';

const FONT_FALLBACK_SANS = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif';
const FONT_FALLBACK_SERIF = '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", serif';
const _measure = document.createElement('canvas').getContext('2d');
const _imageCache = new Map();      // image id → ImageBitmap / HTMLImageElement（読み込み中は 'loading'）

function cssFont(family, style, size) {
  const serif = /mincho|明朝|serif|song|ming/i.test(family || '');
  const bold = /bold|heavy|black|太|w6|w7|w8|w9/i.test(style || '');
  const fam = `"${String(family || '').replace(/"/g, '')}", ${serif ? FONT_FALLBACK_SERIF : FONT_FALLBACK_SANS}`;
  return `${bold ? '700' : '400'} ${size}px ${fam}`;
}

/** 文字の並び（ローカル座標）: 行ごとの {text, x, y, w}、外枠、行の高さ。縦書き・エリア内も簡単に組む */
function textLayout(it) {
  const key = JSON.stringify([it.text, it.font, it.font_style, it.size, it.tracking, it.leading, it.align, it.vertical,
    it.text_kind, it.frame && it.frame.map((s) => s.n.map((n) => [n.x, n.y]))]);
  if (it._lay && it._lay.key === key) return it._lay;
  const size = it.size || 24, lh = it.leading > 0 ? it.leading : size * 1.5;
  const asc = size * 0.88, desc = size * 0.12;
  _measure.font = cssFont(it.font, it.font_style, size);
  const track = (it.tracking || 0) / 1000 * size;
  const width = (s) => _measure.measureText(s).width + track * [...s].length;
  const lines = [];
  const paras = String(it.text || '').split('\n');
  const vertical = !!it.vertical && it.text_kind !== 'path';
  let frameBox = null;
  if (it.text_kind === 'area' && it.frame && it.frame.length) frameBox = spsBBox(it.frame);
  if (vertical) {
    // 縦書き: 1 字ずつ下へ、列は右から左
    let col = 0;
    const colLen = frameBox ? frameBox[3] - frameBox[1] : Infinity;
    const x0 = frameBox ? frameBox[2] - size / 2 : 0, y0 = frameBox ? frameBox[1] : 0;
    for (const p of paras) {
      let y = 0, chars = [];
      const flush = () => { lines.push({ chars, x: x0 - col * lh, y: y0 }); col++; chars = []; y = 0; };
      for (const ch of p) {
        const adv = size + track;
        if (y + size > colLen && chars.length) flush();
        chars.push({ ch, y });
        y += adv;
      }
      flush();
    }
    const b = lines.length ? [Math.min(...lines.map((l) => l.x)) - size / 2, y0, x0 + size / 2,
      y0 + Math.max(size, ...lines.map((l) => (l.chars.length ? l.chars[l.chars.length - 1].y + size : size)))] : null;
    it._lay = { key, lines, vertical: true, bbox: frameBox || b, size, lh, asc, desc };
    return it._lay;
  }
  const maxW = frameBox ? frameBox[2] - frameBox[0] : Infinity;
  const NO_START = '、。，．・：；？！ー）」』】〕〉》っゃゅょァィゥェォッャュョ';
  let y = frameBox ? frameBox[1] + asc : 0;
  for (const p of paras) {
    // 折り返し（エリア内文字）: 日本語は 1 字ずつ・英単語は語ごと
    const tokens = p.match(/[A-Za-z0-9'’\-_.,!?]+\s*|\s+|./gu) || [''];
    let cur = '';
    for (const tk of tokens) {
      if (frameBox && cur && width(cur + tk) > maxW && !NO_START.includes(tk[0])) { lines.push({ text: cur, y }); cur = tk.trimStart(); y += lh; }
      else cur += tk;
    }
    lines.push({ text: cur, y });
    y += lh;
  }
  for (const l of lines) {
    l.w = width(l.text);
    const left = frameBox ? frameBox[0] : 0, room = frameBox ? maxW : 0;
    l.x = it.align === 'center' ? (frameBox ? left + (room - l.w) / 2 : -l.w / 2) : it.align === 'right' ? (frameBox ? left + room - l.w : -l.w) : left;
  }
  const b = lines.length ? [Math.min(...lines.map((l) => l.x)), lines[0].y - asc, Math.max(...lines.map((l) => l.x + l.w)),
    lines[lines.length - 1].y + desc] : null;
  it._lay = { key, lines, vertical: false, bbox: frameBox || b, size, lh, asc, desc };
  return it._lay;
}
function textLocalBBox(it) { return textLayout(it).bbox; }

function paintStyle(ctx, p, alpha, inv) {
  if (!p) return null;
  if (isGradient(p)) {
    let p0 = p.p0, p1 = p.p1;
    if (inv) { p0 = M.map(inv, ...p0); p1 = M.map(inv, ...p1); }
    const g = p.kind === 'radial' ? ctx.createRadialGradient(p0[0], p0[1], 0, p0[0], p0[1], Math.max(0.01, Math.hypot(p1[0] - p0[0], p1[1] - p0[1])))
      : ctx.createLinearGradient(p0[0], p0[1], p1[0], p1[1]);
    for (const [pos, c, o] of p.stops.slice().sort((a, b) => a[0] - b[0])) g.addColorStop(clamp01(pos), colorCSS(c, o * alpha));
    return g;
  }
  return colorCSS(p, alpha);
}
function applyStroke(ctx, st, scale = 1) {
  ctx.lineWidth = st.width / scale;
  ctx.lineCap = st.cap || 'butt';
  ctx.lineJoin = st.join || 'miter';
  ctx.miterLimit = st.miter || 10;
  ctx.setLineDash(st.dash && st.dash.length ? st.dash.map((d) => d / scale) : []);
  ctx.lineDashOffset = (st.dash_offset || 0) / scale;
}
function imageFor(doc, id, onload) {
  const hit = _imageCache.get(id);
  if (hit && hit !== 'loading') return hit;
  if (!hit && doc.images[id]) {
    _imageCache.set(id, 'loading');
    createImageBitmap(new Blob([doc.images[id]])).then((bmp) => { _imageCache.set(id, bmp); onload && onload(); })
      .catch(() => _imageCache.delete(id));
  }
  return null;
}

class Renderer {
  constructor(doc, onImage) { this.doc = doc; this.outline = false; this.onImage = onImage; }

  drawDoc(ctx) { for (const l of this.doc.layers) this.drawItem(ctx, l, 1); }

  drawItem(ctx, it, alpha) {
    if (it.visible === false || it._editing) return;
    const a = alpha * (it.opacity ?? 1);
    if (a <= 0.001 && !this.outline) return;
    const blend = it.blend && it.blend !== 'normal' && !this.outline ? it.blend : null;
    const fx = !this.outline && it.effects ? it.effects.filter((e) => e.on !== false) : [];
    if (blend || fx.length) {
      ctx.save();
      if (blend) ctx.globalCompositeOperation = blend;
      for (const e of fx) {
        if (e.type === 'drop_shadow' || e.type === 'outer_glow') this.drawShadowed(ctx, it, a, e);
      }
      const blur = fx.find((e) => e.type === 'blur');
      if (blur && 'filter' in ctx) ctx.filter = `blur(${(blur.radius || 4) / 2 * Math.sqrt(Math.abs(ctx.getTransform().a * ctx.getTransform().d))}px)`;
      this.draw(ctx, it, a);
      ctx.restore();
    } else this.draw(ctx, it, a);
  }
  drawShadowed(ctx, it, a, e) {
    // 影だけ: 画面の外に描いた物の影を元の位置へ落とす（shadowOffset は変換に影響されないので画素で）
    const t = ctx.getTransform(), sc = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;
    const col = e.color ? colorCSS(e.color, (e.opacity ?? 0.75)) : 'rgba(0,0,0,0.75)';
    const far = 100000;
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = (e.blur || 0) * sc;
    ctx.shadowOffsetX = far + (e.dx || 0) * t.a + (e.dy || 0) * t.c;
    ctx.shadowOffsetY = (e.dx || 0) * t.b + (e.dy || 0) * t.d;
    if (e.mode && e.mode !== 'normal') ctx.globalCompositeOperation = e.mode;
    ctx.translate(-far / t.a, 0);
    this.draw(ctx, it, a, true);
    ctx.restore();
  }

  draw(ctx, it, a, flat = false) {
    if (it.kind === 'path') return this.drawPath(ctx, it, a, flat);
    if (it.kind === 'text') return this.drawText(ctx, it, a, flat);
    if (it.kind === 'image') {
      const im = imageFor(this.doc, it.image, this.onImage);
      ctx.save();
      ctx.transform(...it.matrix);
      if (im && !this.outline) { ctx.globalAlpha *= a; ctx.drawImage(im, 0, 0, it.pw, it.ph); }
      else { ctx.strokeStyle = '#888'; ctx.lineWidth = 1 / M.scale(it.matrix); ctx.strokeRect(0, 0, it.pw, it.ph); }
      ctx.restore();
      return;
    }
    if (it.children) {
      const kids = it.children;
      const body = () => {
        if (it.clip && kids.length) {
          ctx.save();
          if (!this.outline) ctx.clip(this.shapeOf(kids[kids.length - 1]), 'nonzero');
          for (const k of kids.slice(0, -1)) this.drawItem(ctx, k, a);
          ctx.restore();
          if (this.outline) this.drawItem(ctx, kids[kids.length - 1], a);
        } else for (const k of kids) this.drawItem(ctx, k, a);
      };
      body();
      if (it.symmetry) for (const m of symmetryMatrices(it.symmetry)) { ctx.save(); ctx.transform(...m); body(); ctx.restore(); }
    }
  }
  drawPath(ctx, it, a, flat) {
    if (!it.paths.length) return;
    const p = spsPath2D(it.paths), st = it.style;
    if (this.outline) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1 / M.scale(toArr(ctx.getTransform())); ctx.setLineDash([]); ctx.stroke(p); return; }
    for (const e of (st.extra || []).slice().reverse()) {
      if (!e.paint || !(e.width > 0)) continue;
      ctx.strokeStyle = paintStyle(ctx, e.paint, a);
      applyStroke(ctx, { width: e.width, cap: 'round', join: e.join || 'round' });
      ctx.stroke(p);
    }
    if (st.fill) { ctx.fillStyle = paintStyle(ctx, st.fill, a); ctx.fill(p, it.fill_rule === 'evenodd' ? 'evenodd' : 'nonzero'); }
    if (st.stroke && st.width > 0) {
      if (st.profile && window.variableOutline) {
        ctx.fillStyle = paintStyle(ctx, st.stroke, a);
        ctx.fill(spsPath2D(variableOutline(it)), 'evenodd');
      } else {
        ctx.strokeStyle = paintStyle(ctx, st.stroke, a);
        applyStroke(ctx, st);
        ctx.stroke(p);
      }
    }
  }
  drawText(ctx, it, a) {
    const lay = textLayout(it), st = it.style;
    ctx.save();
    ctx.transform(...it.matrix);
    const inv = M.inv(it.matrix), sc = M.scale(it.matrix) || 1;
    ctx.font = cssFont(it.font, it.font_style, lay.size);
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = ((it.tracking || 0) / 1000 * lay.size) + 'px';
    const each = (fn) => {
      if (lay.vertical) {
        ctx.textAlign = 'center';
        for (const l of lay.lines) for (const c of l.chars) {
          if (/[\x21-\x7e]/.test(c.ch)) {      // 半角は寝かせる
            ctx.save(); ctx.translate(l.x, l.y + c.y + lay.size / 2); ctx.rotate(Math.PI / 2); fn(c.ch, 0, lay.size * 0.35); ctx.restore();
          } else fn(c.ch, l.x, l.y + c.y + lay.asc);
        }
      } else { ctx.textAlign = 'left'; for (const l of lay.lines) fn(l.text, l.x, l.y); }
    };
    if (this.outline) { ctx.strokeStyle = '#000'; ctx.lineWidth = 0.6 / sc; each((s, x, y) => ctx.strokeText(s, x, y)); ctx.restore(); return; }
    for (const e of (st.extra || []).slice().reverse()) {
      if (!e.paint || !(e.width > 0)) continue;
      ctx.strokeStyle = paintStyle(ctx, e.paint, a, inv);
      ctx.lineWidth = e.width / sc;
      ctx.lineJoin = 'round';
      each((s, x, y) => ctx.strokeText(s, x, y));
    }
    if (st.fill) { ctx.fillStyle = paintStyle(ctx, st.fill, a, inv); each((s, x, y) => ctx.fillText(s, x, y)); }
    if (st.stroke && st.width > 0) {
      ctx.strokeStyle = paintStyle(ctx, st.stroke, a, inv);
      applyStroke(ctx, st, sc);
      each((s, x, y) => ctx.strokeText(s, x, y));
    }
    ctx.restore();
  }
  /** 文書座標での形（クリップ・当たり判定用） */
  shapeOf(it) {
    const p = new Path2D();
    if (it.kind === 'path') p.addPath(spsPath2D(it.paths));
    else if (it.kind === 'text' || it.kind === 'image') {
      const b = it.kind === 'text' ? textLocalBBox(it) : [0, 0, it.pw, it.ph];
      if (b) { const r = new Path2D(); r.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]); p.addPath(r, new DOMMatrix(it.matrix)); }
    } else if (it.children) for (const c of it.children) p.addPath(this.shapeOf(c));
    return p;
  }
}
function toArr(t) { return [t.a, t.b, t.c, t.d, t.e, t.f]; }

/** rect（文書座標）を scale 倍の画像に（background null で透明） */
function renderToCanvas(doc, rect, scale, background = null, items = null) {
  const [x0, y0, x1, y1] = rect;
  const w = Math.max(1, Math.ceil((x1 - x0) * scale - 1e-6)), h = Math.max(1, Math.ceil((y1 - y0) * scale - 1e-6));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
  ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
  const r = new Renderer(doc);
  if (items) for (const it of sortByOrder(doc, items)) r.drawItem(ctx, it, 1);
  else r.drawDoc(ctx);
  return cv;
}
/** 画像の読み込みを待ってから描く（書き出し用） */
async function preloadImages(doc) {
  const ids = [...doc.iterTree()].filter((x) => x.kind === 'image').map((x) => x.image);
  await Promise.all(ids.map(async (id) => {
    if (_imageCache.get(id) && _imageCache.get(id) !== 'loading') return;
    if (!doc.images[id]) return;
    try { _imageCache.set(id, await createImageBitmap(new Blob([doc.images[id]]))); } catch { /* 読めない画像は枠だけ */ }
  }));
}
function canvasToBlob(cv, type = 'image/png', q = 0.92) { return new Promise((res) => cv.toBlob(res, type, q)); }
