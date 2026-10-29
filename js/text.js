/* 線工房 Web — 文字の組版（exe の core/text.py の _do_layout と同じ手順を、端末のフォントで）。

   字は 1 つずつ「字の行列」g.m（ローカル座標へ）で置く。字は 100px のフォントで描き、大きさは行列に入れる。
   書式の範囲（runs）: 字ごとに font / font_style / size / tracking / kern / baseline / hscale / vscale / fill / stroke / width / ruby。
   runs の s・e は exe（Python）と同じ「コードポイント」の番号。textarea の位置（UTF-16）とは cpIndex で行き来する。
   縦書き: 全角は正立、半角と括弧・長音などは寝かせる、句読点と小書きの仮名は右上へずらす（フォントの vert の代わり）。
*/
'use strict';

const FONT_FALLBACK_SANS = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif';
const FONT_FALLBACK_SERIF = '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", serif';
const FONT_METRICS = { Meiryo: [1.06, 0.44], 'BIZ UDPGothic': [0.88, 0.12], 'BIZ UDGothic': [0.88, 0.12] };
const NO_START = new Set('、。，．,.・：；:;？！?!ー‐-–—～〜）)］]｝}〕〉》」』】〙〗〟’”ゝゞヽヾ々〻ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ');
const NO_END = new Set('（(［[｛{〔〈《「『【〘〖〝‘“');
const HANG = new Set('、。，．,.');
const V_SHIFT = new Set('、。，．');
const V_SMALL = new Set('ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ');
const V_ROTATE = new Set('ー～〜―‐－—…‥（）［］｛｝〔〕〈〉《》「」『』【】〘〙〖〗＝→←＜＞');
const WARPS = { arc: '円弧', arch: 'アーチ', bulge: '膨張', flag: '旗', wave: '波形', rise: '上昇', squeeze: '絞り込み' };
const RUN_KEYS = ['font', 'font_style', 'size', 'tracking', 'kern', 'baseline', 'hscale', 'vscale', 'fill', 'stroke', 'width', 'ruby'];

function cssFont(family, style, size) {
  const serif = /mincho|明朝|serif|song|ming/i.test(family || '');
  const bold = /bold|heavy|black|太|w6|w7|w8|w9/i.test(style || '');
  const fam = `"${String(family || '').replace(/"/g, '')}", ${serif ? FONT_FALLBACK_SERIF : FONT_FALLBACK_SANS}`;
  return `${bold ? '700' : '400'} ${size}px ${fam}`;
}
function fontMetrics(family) { return FONT_METRICS[family] || [0.88, 0.22]; }

const _measure = document.createElement('canvas').getContext('2d');
const _widths = new Map();
/** 100px で組んだときの字の幅 */
function charWidth100(font100, s) {
  const k = font100 + '\u0000' + s;
  let w = _widths.get(k);
  if (w == null) {
    _measure.font = font100;
    w = _measure.measureText(s).width;
    if (_widths.size > 20000) _widths.clear();
    _widths.set(k, w);
  }
  return w;
}

// ---- コードポイントと UTF-16 ----------------------------------------------------------------
const cps = (s) => Array.from(String(s || ''));
function cpIndex(s, u16) { let n = 0; for (let i = 0; i < u16 && i < s.length; i++) { const c = s.charCodeAt(i); if (!(c >= 0xdc00 && c <= 0xdfff)) n++; } return n; }
function u16Index(s, cp) { let i = 0, n = 0; while (i < s.length && n < cp) { const c = s.charCodeAt(i); i += c >= 0xd800 && c <= 0xdbff ? 2 : 1; n++; } return i; }

// ---- 書式の範囲（exe の runs_set / runs_normalize / runs_edit と同じ）------------------------------
const runAttrs = (r) => { const o = {}; for (const k of Object.keys(r)) if (k !== 's' && k !== 'e') o[k] = r[k]; return o; };
function runsNormalize(runs) {
  const rs = runs.filter((r) => r.e > r.s).sort((a, b) => a.s - b.s || a.e - b.e);
  const out = [];
  for (const r of rs) {
    const last = out[out.length - 1];
    if (last && last.e === r.s && JSON.stringify(sortKeys(runAttrs(last))) === JSON.stringify(sortKeys(runAttrs(r)))) last.e = r.e;
    else out.push({ ...r });
  }
  return out;
}
function sortKeys(o) { const r = {}; for (const k of Object.keys(o).sort()) r[k] = o[k]; return r; }
function runsSet(runs, a, b, key, value, remove = false) {
  runs = runs || [];
  if (b <= a) return runs;
  const cuts = [...new Set([a, b, ...runs.map((r) => r.s), ...runs.map((r) => r.e)])].sort((x, y) => x - y);
  const pieces = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const s0 = cuts[i], e0 = cuts[i + 1];
    const at = {};
    for (const r of runs) if (r.s <= s0 && e0 <= r.e) Object.assign(at, runAttrs(r));
    if (a <= s0 && e0 <= b) { if (remove) delete at[key]; else at[key] = value; }
    if (Object.keys(at).length) pieces.push({ ...at, s: s0, e: e0 });
  }
  return runsNormalize(pieces);
}
function runsEdit(runs, a, removed, inserted) {
  const b = a + removed, n = inserted, out = [];
  const m = (p) => (p < a ? p : p <= b ? a : p - removed);
  for (const r of runs || []) {
    const s1 = m(r.s), e1 = m(r.e);
    if (e1 <= s1) continue;
    let ns, ne;
    if (a === 0) [ns, ne] = s1 === 0 ? [0, e1 + n] : [s1 + n, e1 + n];
    else if (s1 >= a) [ns, ne] = [s1 + n, e1 + n];
    else if (e1 >= a) [ns, ne] = [s1, e1 + n];
    else [ns, ne] = [s1, e1];
    out.push({ ...r, s: ns, e: ne });
  }
  return runsNormalize(out);
}
/** 文字列が old → now に変わったときの runs（前後の一致から、置き換えた所を見つける） */
function runsAfterTextChange(runs, old, now) {
  if (!runs || !runs.length) return runs;
  const A = cps(old), B = cps(now);
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let q = 0;
  while (q < A.length - p && q < B.length - p && A[A.length - 1 - q] === B[B.length - 1 - q]) q++;
  return runsEdit(runs, p, A.length - p - q, B.length - p - q);
}

// ---- 線を細かい点に（パス上文字・エリアの形に使う）--------------------------------------------------
function flattenSp(sp, step = 1) {
  const pts = [];
  if (!sp.n.length) return pts;
  pts.push([sp.n[0].x, sp.n[0].y]);
  for (let i = 0; i < spSegCount(sp); i++) {
    const s = spSeg(sp, i);
    const est = Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) + Math.hypot(s[2][0] - s[1][0], s[2][1] - s[1][1]) + Math.hypot(s[3][0] - s[2][0], s[3][1] - s[2][1]);
    const straight = s[1][0] === s[0][0] && s[1][1] === s[0][1] && s[2][0] === s[3][0] && s[2][1] === s[3][1];
    const k = straight ? 1 : Math.max(2, Math.min(200, Math.ceil(est / step)));
    for (let j = 1; j <= k; j++) pts.push(cubicPoint(...s, j / k));
  }
  return pts;
}
function scanIntervals(polys, v, axis) {
  const xs = [], o = 1 - axis;
  for (const pts of polys) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      if ((p[o] > v) !== (q[o] > v)) xs.push(p[axis] + (q[axis] - p[axis]) * (v - p[o]) / (q[o] - p[o]));
    }
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}
function slotIn(polys, lo, hi, axis) {
  let res = null;
  for (const v of hi - lo > 1e-6 ? [lo, (lo + hi) / 2, hi] : [lo]) {
    const ivs = scanIntervals(polys, v, axis);
    if (res == null) res = ivs;
    else { const nx = []; for (const [a0, a1] of res) for (const [b0, b1] of ivs) { const l = Math.max(a0, b0), h = Math.min(a1, b1); if (h > l) nx.push([l, h]); } res = nx; }
    if (!res.length) return null;
  }
  return res && res.length ? res.reduce((m, t) => (t[1] - t[0] > m[1] - m[0] ? t : m)) : null;
}

// ---- 組版 ------------------------------------------------------------------------------
function textKey(it) {
  return JSON.stringify([it.text, it.font, it.font_style, it.size, it.tracking, it.leading, it.align, it.vertical, it.text_kind,
    it.path_offset, it.tcy, it.indent, it.kinsoku, it.runs, it.warp, it.frame && it.frame.map((s) => [s.c, s.n.map((n) => [n.x, n.y, n.ix, n.iy, n.ox, n.oy])])]);
}
function wordish(ch) { return /^[\x21-\x7e’]$/.test(ch) && !/[\s]/.test(ch) && /[A-Za-z0-9'’\-_.,!?;:)("]/.test(ch); }

function textLayout(it) {
  const key = textKey(it);
  if (it._lay && it._lay.key === key) return it._lay;
  const chars = cps(it.text), n = chars.length;
  const kind = it.text_kind || 'point';
  const vertical = !!it.vertical && kind !== 'path';
  const baseSize = it.size || 24;
  const [ascR, descR] = fontMetrics(it.font);
  // 1. 字ごとの書式
  const base = { font: it.font, font_style: it.font_style || '', size: baseSize, tracking: it.tracking || 0 };
  let attrs = new Array(n).fill(base);
  if (it.runs && it.runs.length) {
    attrs = chars.map(() => ({ ...base }));
    for (const r of it.runs) { const up = runAttrs(r); for (let i = Math.max(0, r.s); i < Math.min(n, r.e); i++) Object.assign(attrs[i], up); }
  }
  // 2. 段落ごとに「字」を作る
  const tcy = it.tcy | 0;
  const unitsFor = (ps, pe) => {
    const out = [];
    for (let i = ps; i < pe; i++) {
      const a = attrs[i], ch = chars[i], size = +a.size || baseSize;
      const hs = a.hscale ?? 1, vs = a.vscale ?? 1;
      const track = (+a.tracking || 0) / 1000 * size + (+a.kern || 0) / 1000 * size;
      const f100 = cssFont(a.font, a.font_style, 100);
      const u = { ci: i, ch, a, size, hs, vs, f100, adv: 0, mode: 'h', w100: 0 };
      if (vertical && tcy && /[0-9]/.test(ch) && (i === ps || !/[0-9]/.test(chars[i - 1]))) {
        let j = i;
        while (j < pe && /[0-9]/.test(chars[j])) j++;
        if (j - i <= tcy) {
          u.ch = chars.slice(i, j).join(''); u.mode = 'tcy'; u.w100 = charWidth100(f100, u.ch); u.adv = size + track;
          out.push(u); i = j - 1; continue;
        }
      }
      u.w100 = charWidth100(f100, ch);
      if (!vertical) { u.adv = u.w100 / 100 * size * hs + track; }
      else if (/[\x20-\x7e]/.test(ch) || V_ROTATE.has(ch)) { u.mode = 'side'; u.adv = u.w100 / 100 * size * hs + track; }
      else { u.mode = 'up'; u.adv = size * vs + track; }
      out.push(u);
    }
    return out;
  };
  const kinsoku = it.kinsoku !== false;
  const canBreak = (units, b) => {
    const prev = units[b - 1], nxt = units[b];
    if (kinsoku && (NO_START.has(nxt.ch[0]) || NO_END.has(prev.ch[prev.ch.length - 1]))) return false;
    if (wordish(prev.ch) && wordish(nxt.ch)) return false;
    return true;
  };
  const breakAt = (units, k, width) => {
    let pos = 0;
    for (let j = k; j < units.length; j++) {
      const u = units[j];
      if (pos + u.adv > width + 1e-6 && j > k) {
        if (kinsoku && HANG.has(u.ch)) return j + 1;
        let b = j;
        while (b > k && !canBreak(units, b)) b--;
        return b === k ? j : b;
      }
      pos += u.adv;
    }
    return units.length;
  };
  // 3. 行に分けて置く
  const lhFixed = it.leading > 0 ? it.leading : 0;
  const paras = [];
  { let p = 0; for (const line of String(it.text || '').split('\n')) { const L = cps(line).length; paras.push([p, p + L]); p += L + 1; } }
  const frame = it.frame && it.frame.length ? it.frame : null;
  const area = kind === 'area' && frame;
  const polys = area ? frame.filter((sp) => sp.c || sp.n.length > 2).map((sp) => flattenSp(sp, 2)) : [];
  const fbox = area ? spsBBox(frame) || [0, 0, 100, 100] : null;
  const placed = [], lines = [];
  let block = area ? (vertical ? fbox[2] : fbox[1]) : 0, blockEnd = area ? (vertical ? fbox[0] : fbox[3]) : null;
  let firstLine = true, stop = false, shown = n;
  for (const [ps, pe] of paras) {
    const units = unitsFor(ps, pe);
    let k = 0, firstInPara = true;
    for (;;) {
      if (stop) break;
      const sizeHere = Math.max(...units.slice(k, k + 8).map((u) => u.size), ps < n ? +attrs[ps].size || baseSize : baseSize);
      const lh = lhFixed || sizeHere * 1.5, asc = ascR * sizeHere, dsc = descR * sizeHere;
      let center, start, width;
      if (area) {
        let iv = null;
        for (;;) {
          center = vertical ? block - (firstLine ? sizeHere / 2 : lh) : block + (firstLine ? asc : lh);
          if (vertical ? center - sizeHere / 2 < blockEnd - 1e-6 : center + dsc > blockEnd + 1e-6) { stop = true; break; }
          iv = vertical ? slotIn(polys, center - sizeHere / 2, center + sizeHere / 2, 1) : slotIn(polys, center - asc, center + dsc, 0);
          block = center; firstLine = false;
          if (iv && iv[1] - iv[0] > sizeHere * 0.5) break;
        }
        if (stop) break;
        start = iv[0]; width = iv[1] - iv[0];
      } else {
        center = firstLine ? 0 : block + (vertical ? -lh : lh);
        firstLine = false;
        block = center; start = 0; width = Infinity;
      }
      const indent = firstInPara ? +it.indent || 0 : 0;
      const end = area ? breakAt(units, k, width - indent) : units.length;
      const lu = units.slice(k, end);
      let trail = lu.length;
      while (trail > 0 && (lu[trail - 1].ch === ' ' || lu[trail - 1].ch === '　')) trail--;
      const sumAdv = (arr) => arr.reduce((s, u) => s + u.adv, 0);
      const hang = area && trail > 0 && HANG.has(lu[trail - 1].ch) && sumAdv(lu.slice(0, trail)) > width - indent + 1e-6 ? 1 : 0;
      const lw = sumAdv(lu.slice(0, trail));
      const last = end >= units.length;
      let off = 0, gap = 0;
      const align = it.align || 'left';
      if (kind === 'point') off = align === 'center' ? -lw / 2 : align === 'right' ? -lw : 0;
      else if (kind === 'area') {
        const room = width - indent - (lw - (hang ? lu[trail - 1].adv : 0));
        if (align === 'center') off = room / 2;
        else if (align === 'right') off = room;
        else if (align === 'justify' && !last && trail - hang > 1) gap = Math.max(0, room) / (trail - hang - 1);
        off += indent;
      }
      let p = start + off;
      lu.forEach((u, idx) => { placed.push([u, p, center]); p += u.adv + (idx < trail - hang - 1 ? gap : 0); });
      const lwAll = Math.max(p - (start + off), 0);
      if (vertical) lines.push([center - sizeHere / 2, start + off, center + sizeHere / 2, start + off + lwAll]);
      else lines.push([start + off, center - asc, start + off + lwAll, center + dsc]);
      shown = lu.length ? lu[lu.length - 1].ci + 1 : shown;
      k = end; firstInPara = false;
      if (k >= units.length) break;
    }
    if (stop) break;
  }
  const overflow = !!(area && stop && placed.length && placed[placed.length - 1][0].ci < n - 1);
  // 字の行列
  const glyphs = [];
  const sty = (a) => (('fill' in a) || ('stroke' in a) || ('width' in a) ? { fill: a.fill, stroke: a.stroke, width: a.width, has: ['fill', 'stroke', 'width'].filter((k2) => k2 in a) } : null);
  for (const [u, ip, cp] of placed) {
    if (u.ch === ' ' || u.ch === '　') continue;
    const a = u.a, k = u.size / 100, bs = +a.baseline || 0, s = u.size;
    let m;
    if (!vertical) m = [u.hs * k, 0, 0, u.vs * k, ip, cp - bs];
    else if (u.mode === 'up') {
      let dx = 0, dy = 0;
      if (V_SHIFT.has(u.ch)) { dx = 0.58 * s; dy = -0.6 * s; } else if (V_SMALL.has(u.ch)) { dx = 0.1 * s; dy = -0.1 * s; }
      const w = u.w100 * k * u.hs;
      m = [u.hs * k, 0, 0, u.vs * k, cp - w / 2 + bs + dx, ip + 0.88 * s * u.vs + dy];
    } else if (u.mode === 'side') m = [0, u.hs * k, -u.vs * k, 0, cp + bs - u.vs * s * (ascR - descR) / 2, ip];
    else {
      const W = u.w100 * k, sx = W > 0 ? Math.min(1, s * 0.95 / W) : 1;
      m = [sx * k, 0, 0, k, cp - W * sx / 2 + bs, ip + s * (0.5 + (ascR - descR) / 2)];
    }
    glyphs.push({ ch: u.ch, m, font: u.f100, w100: u.w100, st: sty(a), ci: u.ci, adv: u.adv });
  }
  // 4. ルビ（隣り合う同じルビはまとめる）
  if (kind !== 'path' && it.runs) {
    const rubies = [];
    for (const r of it.runs) {
      if (!r.ruby) continue;
      const last = rubies[rubies.length - 1];
      if (last && last.e === r.s && last.ruby === r.ruby) last.e = r.e; else rubies.push({ s: r.s, e: r.e, ruby: r.ruby });
    }
    for (const r of rubies) {
      let mine = placed.filter(([u]) => r.s <= u.ci && u.ci < r.e);
      if (!mine.length) continue;
      const cp0 = mine[0][2];
      mine = mine.filter((x) => Math.abs(x[2] - cp0) < 1e-6);
      const p0 = Math.min(...mine.map((x) => x[1])), p1 = Math.max(...mine.map((x) => x[1] + x[0].adv));
      const a = mine[0][0].a, bsize = +a.size || baseSize, rs = bsize * 0.5, f100 = cssFont(a.font, a.font_style, 100);
      const rch = cps(r.ruby);
      const advs = rch.map((c) => (vertical ? rs : charWidth100(f100, c) / 100 * rs));
      const tw = advs.reduce((x, y) => x + y, 0), span = p1 - p0;
      let gap = 0, q = (p0 + p1) / 2 - tw / 2;
      if (tw < span && rch.length > 1) { gap = (span - tw) / rch.length; q = p0 + gap / 2; }
      rch.forEach((c, i) => {
        const k = rs / 100, w = charWidth100(f100, c) * k;
        const m = vertical ? [k, 0, 0, k, cp0 + bsize / 2 + rs / 2 + bsize * 0.02 - w / 2, q + 0.88 * rs]
          : [k, 0, 0, k, q, cp0 - bsize * 0.88 - rs * 0.12 - bsize * 0.02];
        glyphs.push({ ch: c, m, font: f100, w100: charWidth100(f100, c), st: glyphs.find((g) => g.ci === mine[0][0].ci)?.st || null, ci: mine[0][0].ci, adv: advs[i] });
        q += advs[i] + gap;
      });
    }
  }
  let bbox = null, warpBox = null;
  // パス上文字
  if (kind === 'path' && frame) {
    const sp = frame[0], pts = flattenSp(sp, 0.5);
    if (sp.c && pts.length) pts.push(pts[0]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1] || 0;
    const at = (s) => {
      if (total <= 0 || pts.length < 2) return [pts[0] || [0, 0], [1, 0]];
      if (sp.c) s = ((s % total) + total) % total;
      s = Math.max(0, Math.min(total, s));
      let lo = 0, hi = cum.length - 1;
      while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
      const seg = cum[hi] - cum[lo] || 1e-9, t = (s - cum[lo]) / seg, P = pts[lo], Q = pts[hi];
      const dx = Q[0] - P[0], dy = Q[1] - P[1], ln = Math.hypot(dx, dy) || 1;
      return [[P[0] + dx * t, P[1] + dy * t], [dx / ln, dy / ln]];
    };
    const width = placed.reduce((s, x) => s + x[0].adv, 0);
    let baseOff = +it.path_offset || 0;
    if (it.align === 'center') baseOff += (total - width) / 2; else if (it.align === 'right') baseOff += total - width;
    const byCi = new Map(placed.map(([u, ip]) => [u.ci, [u, ip]]));
    const out = [];
    for (const g of glyphs) {
      const pu = byCi.get(g.ci);
      if (!pu) continue;
      const [u, ip] = pu, half = u.adv / 2, s = baseOff + ip + half;
      if (!sp.c && (s < -1e-6 || s > total + 1e-6)) continue;
      const [[px, py], [tx, ty]] = at(s), nx = -ty, ny = tx;
      // 字の中の座標 (x, y) → p + t (x - half) + n y
      const L = [tx, ty, nx, ny, px - tx * half, py - ty * half];
      g.m = M.then([g.m[0], g.m[1], g.m[2], g.m[3], g.m[4] - ip, g.m[5]], L);
      out.push(g);
    }
    glyphs.length = 0; glyphs.push(...out);
    bbox = glyphsBBox(glyphs, ascR, descR);
  } else if (it.warp && WARPS[it.warp.type] && glyphs.length) {
    let b = glyphsBBox(glyphs, ascR, descR);
    if (lines.length) b = unionBBox([b, [Math.min(...lines.map((l) => l[0])), Math.min(...lines.map((l) => l[1])), Math.max(...lines.map((l) => l[2])), Math.max(...lines.map((l) => l[3]))]]);
    const f = warpFn(it.warp, b);
    for (const g of glyphs) {
      // 字の中心で f を一次近似（字の形はそのまま、位置・向き・伸び縮みを曲げに合わせる）
      const [cx, cy] = M.map(g.m, g.w100 / 2, -(ascR - descR) * 50);
      const e = Math.max(0.5, (g.w100 * M.scale(g.m)) / 4);
      const [fx, fy] = f(cx, cy), [ax, ay] = f(cx + e, cy), [bx, by] = f(cx, cy + e);
      const J = [(ax - fx) / e, (ay - fy) / e, (bx - fx) / e, (by - fy) / e, fx, fy];
      g.m = M.then(M.then(g.m, M.t(-cx, -cy)), J);
    }
    warpBox = glyphsBBox(glyphs, ascR, descR);
  }
  if (!bbox) bbox = warpBox || (lines.length ? [Math.min(...lines.map((l) => l[0])), Math.min(...lines.map((l) => l[1])), Math.max(...lines.map((l) => l[2])), Math.max(...lines.map((l) => l[3]))] : null);
  if (area) bbox = unionBBox([fbox, warpBox]);
  if (!bbox) bbox = vertical ? [-baseSize / 2, 0, baseSize / 2, baseSize] : [0, -ascR * baseSize, baseSize * 0.5, descR * baseSize];
  it._lay = { key, glyphs, lines, vertical, bbox, size: baseSize, lh: lhFixed || baseSize * 1.5, asc: ascR * baseSize, desc: descR * baseSize, overflow, shown };
  return it._lay;
}
function glyphsBBox(glyphs, ascR, descR) {
  return unionBBox(glyphs.map((g) => mapBBox(g.m, [0, -ascR * 100, g.w100, descR * 100])));
}
function warpFn(warp, b) {
  const [x0, y0, x1, y1] = b, w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const k = Math.max(-1, Math.min(1, +(warp.bend ?? 0.5))), t = warp.type, PI = Math.PI;
  return (x, y) => {
    const u = (x - x0) / w, v = (y - y0) / h;
    if (t === 'arc') {
      if (Math.abs(k) < 1e-4) return [x, y];
      const ang = k * PI * 0.9, R = w / ang, a = (u - 0.5) * ang, r = R + (y1 - y);
      return [cx + r * Math.sin(a), y1 + R - r * Math.cos(a)];
    }
    if (t === 'arch') return [x, y - k * h * 0.6 * Math.sin(PI * u)];
    if (t === 'bulge') return [x, cy + (y - cy) * (1 + k * 0.8 * Math.sin(PI * u))];
    if (t === 'squeeze') return [x, cy + (y - cy) * (1 - k * 0.6 * Math.sin(PI * u))];
    if (t === 'flag') return [x, y + k * h * 0.3 * Math.sin(2 * PI * u)];
    if (t === 'wave') return [x + k * w * 0.02 * Math.sin(2 * PI * v), y + k * h * 0.3 * Math.sin(2 * PI * u) * (1 - v * 0.5)];
    if (t === 'rise') return [x, y - k * h * (u - 0.5)];
    return [x, y];
  };
}
function textLocalBBox(it) { return textLayout(it).bbox; }
/** 字ごとのスタイル（書式の範囲の fill / stroke / width を当てた物。exe の group_style と同じ） */
function glyphStyle(base, g) {
  if (!g.st) return base;
  const st = { ...base, extra: [] };
  for (const k of g.st.has) st[k] = g.st[k];
  return st;
}
