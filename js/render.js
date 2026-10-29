/* 線工房 Web — 描画（Canvas 2D）。画面・PNG 書き出し・サムネイルで同じ描き方。

   文字は端末のフォントで描く（組版は text.js、exe の harfbuzz とは字の形・幅が少し違う）。
   効果（exe の ui/render.py と同じ値の意味。ぼかしの σ = blur / 2）:
   - ドロップシャドウ・外側の光彩だけなら canvas の shadow でそのまま描く（速い）
   - ぼかし・内側の光彩があるときは、物を画面の画素の大きさの別の canvas に描いて作る
   iPad の Safari は ctx.filter が効かないので、ぼかしは自前（ボックスぼかし 3 回 ≒ ガウス）。
*/
'use strict';

const _imageCache = new Map();      // image id → ImageBitmap（読み込み中は 'loading'）

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

// ---- 効果 ------------------------------------------------------------------------------
const EFFECTS = {
  drop_shadow: { label: 'ドロップシャドウ', defaults: { dx: 7, dy: 7, blur: 5, opacity: 0.75, mode: 'multiply', color: { m: 'rgb', v: [0, 0, 0] } } },
  outer_glow: { label: '光彩（外側）', defaults: { blur: 10, opacity: 0.75, mode: 'screen', color: { m: 'rgb', v: [1, 0.94902, 0.47843] } } },
  inner_glow: { label: '光彩（内側）', defaults: { blur: 8, opacity: 0.75, mode: 'screen', color: { m: 'rgb', v: [1, 1, 1] } } },
  blur: { label: 'ぼかし（ガウス）', defaults: { radius: 4 } },
};
function newEffect(type) { return { type, on: true, ...JSON.parse(JSON.stringify(EFFECTS[type].defaults)) }; }
function activeEffects(it) { return (it.effects || []).filter((e) => e.on !== false && EFFECTS[e.type]); }
function effectMargin(fx) {
  let m = 0;
  for (const e of fx) {
    if (e.type === 'drop_shadow') m = Math.max(m, Math.max(Math.abs(e.dx || 0), Math.abs(e.dy || 0)) + (e.blur || 0) * 1.6);
    else if (e.type === 'outer_glow') m = Math.max(m, (e.blur || 0) * 1.6);
    else if (e.type === 'blur') m = Math.max(m, (e.radius || 0) * 1.6);
  }
  return m;
}
function effectColor(e, a) { const c = e.color && e.color.v ? e.color : { m: 'rgb', v: [0, 0, 0] }; return colorCSS(c, clamp01((e.opacity ?? 0.75) * a)); }
const COMP_OK = new Set(['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion']);

/** RGBA（乗算していない）の画素をガウスに近くぼかす（σ は画素） */
function blurImageData(img, sigma) {
  if (!(sigma > 0.3)) return img;
  const { width: w, height: h, data } = img;
  const n = w * h, buf = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    buf[i * 4] = data[i * 4] * a; buf[i * 4 + 1] = data[i * 4 + 1] * a; buf[i * 4 + 2] = data[i * 4 + 2] * a; buf[i * 4 + 3] = a * 255;
  }
  // 3 回のボックスの大きさ（W. Jarosz の方法）
  const wIdeal = Math.sqrt(12 * sigma * sigma / 3 + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const mIdeal = (12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4), mm = Math.round(mIdeal);
  const sizes = [0, 1, 2].map((i) => (i < mm ? wl : wl + 2));
  const tmp = new Float32Array(n * 4);
  const pass = (src, dst, r, horiz) => {
    const len = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 4 : w * 4, iarr = 1 / (r + r + 1);
    for (let L = 0; L < lines; L++) {
      const base = horiz ? L * w * 4 : L * 4;
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += src[base + Math.min(len - 1, Math.max(0, k)) * step + c] * (k < 0 || k >= len ? 0 : 1);
        for (let x = 0; x < len; x++) {
          dst[base + x * step + c] = acc * iarr;
          const add = x + r + 1, sub = x - r;
          if (add < len) acc += src[base + add * step + c];
          if (sub >= 0) acc -= src[base + sub * step + c];
        }
      }
    }
  };
  for (const s of sizes) { const r = (s - 1) >> 1; pass(buf, tmp, r, true); pass(tmp, buf, r, false); }
  for (let i = 0; i < n; i++) {
    const a = buf[i * 4 + 3];
    data[i * 4 + 3] = a;
    const k = a > 0.01 ? 255 / a : 0;
    data[i * 4] = buf[i * 4] * k; data[i * 4 + 1] = buf[i * 4 + 1] * k; data[i * 4 + 2] = buf[i * 4 + 2] * k;
  }
  return img;
}
function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

class Renderer {
  constructor(doc, onImage) { this.doc = doc; this.outline = false; this.onImage = onImage; }

  drawDoc(ctx) { for (const l of this.doc.layers) this.drawItem(ctx, l, 1); }

  drawItem(ctx, it, alpha) {
    if (it.visible === false) return;
    const pv = this.preview;
    if (pv && pv.ids.has(it.id)) {
      this.preview = null;
      ctx.save(); ctx.transform(...pv.m);
      try { this.drawItem(ctx, it, alpha); } finally { ctx.restore(); this.preview = pv; }
      return;
    }
    const a = alpha * (it.opacity ?? 1);
    if (a <= 0.001 && !this.outline) return;
    const blend = it.blend && it.blend !== 'normal' && !this.outline && COMP_OK.has(it.blend) ? it.blend : null;
    const fx = this.outline ? [] : activeEffects(it);
    if (!blend && !fx.length) { this.draw(ctx, it, a); return; }
    ctx.save();
    if (blend) ctx.globalCompositeOperation = blend;
    if (fx.some((e) => e.type === 'blur' || e.type === 'inner_glow')) this.drawRasterFx(ctx, it, a, fx);
    else {
      for (const e of fx) this.drawShadowed(ctx, it, a, e, null);
      this.draw(ctx, it, a);
    }
    ctx.restore();
  }
  /** 影・外側の光彩だけ: 画面の外に描いた物の影を元の位置へ落とす（shadowOffset は変換に影響されないので画素で） */
  drawShadowed(ctx, it, a, e, image) {
    const t = ctx.getTransform(), sc = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;
    const far = 100000;
    const ddx = e.type === 'drop_shadow' ? (e.dx || 0) * t.a + (e.dy || 0) * t.c : 0;
    const ddy = e.type === 'drop_shadow' ? (e.dx || 0) * t.b + (e.dy || 0) * t.d : 0;
    ctx.save();
    ctx.shadowColor = effectColor(e, a);
    ctx.shadowBlur = (e.blur || 0) * sc;
    ctx.shadowOffsetX = far + ddx;
    ctx.shadowOffsetY = ddy;
    if (e.mode && COMP_OK.has(e.mode)) ctx.globalCompositeOperation = e.mode;
    if (image) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(image.cv, image.x - far, image.y, image.w, image.h);
    } else {
      ctx.setTransform(new DOMMatrix([1, 0, 0, 1, -far, 0]).multiply(t));
      this.draw(ctx, it, 1, true);
    }
    ctx.restore();
  }
  /** ぼかし・内側の光彩: 物を画素に描いてから作る。parts で描く部分を選べる（PDF: under=影・外側の光彩、item=物、over=内側の光彩） */
  drawRasterFx(ctx, it, a, fx, parts = null) {
    const P = (k) => !parts || parts.has(k);
    const b0 = itemVisualBBox(it);
    if (!b0) return;
    const rim = Math.max(0, ...((it.style && it.style.extra) || []).map((e) => e.width || 0)) / 2;
    const m = effectMargin(fx) + rim + 2;
    const t = ctx.getTransform(), sc = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;
    const corners = [[b0[0] - m, b0[1] - m], [b0[2] + m, b0[1] - m], [b0[2] + m, b0[3] + m], [b0[0] - m, b0[3] + m]].map(([x, y]) => [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f]);
    const W = ctx.canvas.width, H = ctx.canvas.height, pad = Math.ceil(effectMargin(fx) * sc) + 2;
    let x0 = Math.floor(Math.max(-pad, Math.min(...corners.map((p) => p[0])))), y0 = Math.floor(Math.max(-pad, Math.min(...corners.map((p) => p[1]))));
    let x1 = Math.ceil(Math.min(W + pad, Math.max(...corners.map((p) => p[0])))), y1 = Math.ceil(Math.min(H + pad, Math.max(...corners.map((p) => p[1]))));
    if (x1 <= x0 || y1 <= y0) return;
    const dw = x1 - x0, dh = y1 - y0, down = Math.min(1, Math.sqrt(3e6 / (dw * dh)));
    const w = Math.max(1, Math.round(dw * down)), h = Math.max(1, Math.round(dh * down));
    const blur = fx.filter((e) => e.type === 'blur').reduce((s, e) => s + (e.radius || 0), 0);
    const src = newCanvas(w, h), sx = src.getContext('2d', { willReadFrequently: blur > 0 });
    sx.setTransform(t.a * down, t.b * down, t.c * down, t.d * down, (t.e - x0) * down, (t.f - y0) * down);
    this.draw(sx, it, 1);
    let shape = src;
    if (blur > 0) {
      const img = sx.getImageData(0, 0, w, h);
      blurImageData(img, blur * sc * down / 2);
      shape = newCanvas(w, h); shape.getContext('2d').putImageData(img, 0, 0);
    }
    const target = { cv: shape, x: x0, y: y0, w: dw, h: dh };
    if (P('under')) for (const e of fx) if (e.type === 'drop_shadow' || e.type === 'outer_glow') this.drawShadowed(ctx, it, a, e, target);
    if (P('item')) {
      if (blur > 0) {
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= a; ctx.drawImage(shape, x0, y0, dw, dh); ctx.restore();
      } else this.draw(ctx, it, a);
    }
    for (const e of fx) {
      if (e.type !== 'inner_glow' || !P('over')) continue;
      // 形の外側を塗った物に影を付け、形の中だけ残す → 縁ほど強い光
      const inv = newCanvas(w, h), ix = inv.getContext('2d');
      ix.fillStyle = '#000'; ix.fillRect(0, 0, w, h);
      ix.globalCompositeOperation = 'destination-out'; ix.drawImage(shape, 0, 0);
      const glow = newCanvas(w, h), gx = glow.getContext('2d'), far = 100000;
      gx.shadowColor = colorCSS(e.color && e.color.v ? e.color : { m: 'rgb', v: [1, 1, 1] }, 1);
      gx.shadowBlur = (e.blur || 0) * sc * down;
      gx.shadowOffsetX = far;
      gx.drawImage(inv, -far, 0); gx.drawImage(inv, -far, 0);
      gx.globalCompositeOperation = 'destination-in'; gx.shadowColor = 'transparent'; gx.drawImage(shape, 0, 0);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (e.mode && COMP_OK.has(e.mode)) ctx.globalCompositeOperation = e.mode;
      ctx.globalAlpha *= clamp01((e.opacity ?? 0.75) * a);
      ctx.drawImage(glow, x0, y0, dw, dh);
      ctx.restore();
    }
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
  drawPath(ctx, it, a) {
    if (!it.paths.length) return;
    const p = itemPath2D(it), st = it.style;
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
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const sc = M.scale(it.matrix) || 1;
    const each = (fn) => {
      for (const g of lay.glyphs) {
        ctx.save();
        ctx.transform(...g.m);
        ctx.font = g.font;
        fn(g, M.scale(g.m) || 1);
        ctx.restore();
      }
    };
    const inv = (g) => M.inv(M.then(g.m, it.matrix));
    if (this.outline) { ctx.strokeStyle = '#000'; each((g, k) => { ctx.lineWidth = 0.6 / sc / k; ctx.strokeText(g.ch, 0, 0); }); ctx.restore(); return; }
    for (const e of (st.extra || []).slice().reverse()) {
      if (!e.paint || !(e.width > 0)) continue;
      each((g, k) => {
        ctx.strokeStyle = paintStyle(ctx, e.paint, a, inv(g));
        ctx.lineWidth = e.width / sc / k;
        ctx.lineJoin = e.join || 'round';
        ctx.setLineDash([]);
        ctx.strokeText(g.ch, 0, 0);
      });
    }
    each((g, k) => {
      const gs = glyphStyle(st, g);
      if (gs.fill) { ctx.fillStyle = paintStyle(ctx, gs.fill, a, inv(g)); ctx.fillText(g.ch, 0, 0); }
      if (gs.stroke && gs.width > 0) {
        ctx.strokeStyle = paintStyle(ctx, gs.stroke, a, inv(g));
        applyStroke(ctx, gs, sc * k);
        ctx.strokeText(g.ch, 0, 0);
      }
    });
    ctx.restore();
  }
  /** 文書座標での形（クリップ・当たり判定用） */
  shapeOf(it) {
    const p = new Path2D();
    if (it.kind === 'path') p.addPath(itemPath2D(it));
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
  const cv = newCanvas(w, h);
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
