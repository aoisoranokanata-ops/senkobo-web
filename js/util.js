/* 線工房 Web — 共通の小道具: 行列・色・ZIP・ダウンロード */
'use strict';

const APP_VERSION = '0.2.0';
const LS = 'senkobo-web.';
const PT_PER = { mm: 72 / 25.4, pt: 1, px: 1, cm: 72 / 2.54, in: 72, Q: 72 / 25.4 / 4 };

// ---- 行列 [a, b, c, d, e, f]（x' = a x + c y + e,  y' = b x + d y + f）------------------
const M = {
  I: () => [1, 0, 0, 1, 0, 0],
  t: (x, y) => [1, 0, 0, 1, x, y],
  s: (sx, sy = sx, cx = 0, cy = 0) => [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy],
  r: (deg, cx = 0, cy = 0) => {      // 画面で時計回りが正（exe と同じ）
    const a = deg * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    return [co, si, -si, co, cx - co * cx + si * cy, cy - si * cx - co * cy];
  },
  /** m を当ててから n を当てる */
  then: (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]],
  map: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
  inv: (m) => {
    const d = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(d) < 1e-12) return M.I();
    const a = m[3] / d, b = -m[1] / d, c = -m[2] / d, e = m[0] / d;
    return [a, b, c, e, -(a * m[4] + c * m[5]), -(b * m[4] + e * m[5])];
  },
  scale: (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])),
  isI: (m) => !m || (Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 &&
    Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[4]) < 1e-9 && Math.abs(m[5]) < 1e-9),
  round: (m) => m.map((v) => Math.round(v * 1e6) / 1e6),
};

// ---- 色（exe の Color.to_dict と同じ {m, v, name?, spot?}、値は 0..1）----------------------
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function colorRGB(c) {
  if (!c) return null;
  const v = c.v;
  if (c.m === 'rgb') return [v[0], v[1], v[2]];
  if (c.m === 'gray') return [1 - v[0], 1 - v[0], 1 - v[0]];
  return [(1 - v[0]) * (1 - v[3]), (1 - v[1]) * (1 - v[3]), (1 - v[2]) * (1 - v[3])];
}
function colorCSS(c, alpha = 1) {
  const [r, g, b] = colorRGB(c);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}
function colorHex(c) {
  const [r, g, b] = colorRGB(c);
  return '#' + [r, g, b].map((x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0')).join('');
}
function hexColor(h, cmyk = false) {
  let s = String(h).trim().replace('#', '');
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
  const r = parseInt(s.slice(0, 2), 16) / 255, g = parseInt(s.slice(2, 4), 16) / 255, b = parseInt(s.slice(4, 6), 16) / 255;
  const c = { m: 'rgb', v: [r, g, b].map((x) => Math.round(x * 1e5) / 1e5) };
  return cmyk ? toCMYK(c) : c;
}
function toCMYK(c) {
  if (c.m === 'cmyk') return { ...c, v: [...c.v] };
  const [r, g, b] = colorRGB(c);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1 - 1e-9) return { m: 'cmyk', v: [0, 0, 0, 1] };
  return { m: 'cmyk', v: [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map((x) => Math.round(x * 1e5) / 1e5) };
}
function colorLabel(c) {
  if (!c) return 'なし';
  if (c.spot) return '特色 ' + c.name;
  if (c.m === 'cmyk') { const [a, b, d, k] = c.v.map((x) => Math.round(x * 100)); return `C${a} M${b} Y${d} K${k}`; }
  if (c.m === 'gray') return 'K' + Math.round(c.v[0] * 100) + '%';
  return colorHex(c).toUpperCase();
}
const isGradient = (p) => p && p.type === 'gradient';
function paintCopy(p) { return p == null ? null : JSON.parse(JSON.stringify(p)); }
function defaultSwatches(mode) {
  if (mode === 'cmyk') {
    return [[0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 0, .8], [0, 0, 0, .6], [0, 0, 0, .4], [0, 0, 0, .2], [0, 1, 1, 0], [0, .5, 1, 0],
      [0, 0, 1, 0], [.5, 0, 1, 0], [1, 0, 1, 0], [1, 0, 0, 0], [1, .5, 0, 0], [1, 1, 0, 0], [.5, 1, 0, 0], [0, 1, 0, 0],
      [0, 1, .5, 0], [.3, .5, .75, .1], [.15, .3, .5, 0], [.6, .4, .4, .2], [.5, .5, .6, .25], [0, .4, .2, 0], [.25, 0, .1, 0],
      [.2, .1, 0, 0]].map((v) => ({ m: 'cmyk', v }));
  }
  return ['#ffffff', '#000000', '#333333', '#666666', '#999999', '#cccccc', '#e60012', '#f39800', '#fff100', '#8fc31f',
    '#009944', '#009e96', '#00a0e9', '#0068b7', '#1d2088', '#920783', '#e4007f', '#e5004f', '#c69c6d', '#8c6239',
    '#603813', '#f6b4c6', '#b3e0f2', '#d9e7a5'].map((h) => hexColor(h));
}

// ---- ZIP（.snk）-----------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosDateTime(d = new Date()) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
/** entries: [{name, data: Uint8Array}] → 無圧縮の ZIP（Blob）。exe の zipfile はこれを読める */
function zipStore(entries) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime();
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data), size = e.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, e.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
/** ZIP → {名前: Uint8Array}。無圧縮と deflate（DecompressionStream）に対応 */
async function unzip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP ではありません（.snk が壊れている可能性）');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = {};
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP の目次が読めません');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loff = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const dstart = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    const raw = buf.subarray(dstart, dstart + csize);
    if (method === 0) out[name] = raw.slice();
    else if (method === 8) {
      if (!window.DecompressionStream) throw new Error('このブラウザでは圧縮された ZIP を開けません');
      const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out[name] = new Uint8Array(await new Response(s).arrayBuffer());
    } else throw new Error('対応していない圧縮方式です（' + method + '）');
  }
  return out;
}

// ---- ファイルを渡す（iPad は共有シート、ほかはダウンロード）-----------------------------------
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPad|iPhone|Macintosh/.test(navigator.userAgent) &&
      'ontouchend' in document) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}
function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
async function sha1hex(bytes) {
  const h = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
