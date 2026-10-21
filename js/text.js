// 文字圖層：點文字／段落文字、字距、行距、描邊；文字動畫器（範圍選取器：開始／結束／偏移、形狀、依字元／單字／行）
import { css, clamp, hash } from './util.js';
import { mix } from './anim.js';

export const FALLBACK_FONTS = '"Noto Sans TC","PingFang TC","Microsoft JhengHei","Heiti TC",sans-serif';
export const FONT_LIST = ['Noto Sans TC', 'Noto Serif TC', 'Inter', 'Montserrat', 'Oswald', 'Bebas Neue', 'Orbitron', 'Playfair Display', 'Pacifico', 'Lobster', 'Bungee', 'Press Start 2P',
  'Zen Maru Gothic', 'LXGW WenKai TC', 'Microsoft JhengHei', 'PingFang TC', 'Arial', 'Georgia', 'Courier New', 'Impact'];

export function fontString(tx, size) {
  return `${tx.italic ? 'italic ' : ''}${tx.weight || 400} ${size}px "${tx.font}",${FALLBACK_FONTS}`;
}

// 字型還沒載入時先觸發下載，載入後通知重畫
const pending = new Set();
let onFontReady = () => { };
export const setFontReadyHandler = fn => { onFontReady = fn; };
function ensureFont(f, text) {
  if (!document.fonts || pending.has(f)) return;
  try {
    if (document.fonts.check(f, text)) return;
    pending.add(f);
    document.fonts.load(f, text).then(() => onFontReady()).catch(() => { });
  } catch { }
}
export async function preloadFonts(texts) { await Promise.all(texts.map(([f, s]) => document.fonts?.load(f, s).catch(() => { }))); }

let measureCtx = null;
const mctx = () => measureCtx ||= (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas')).getContext('2d');

// 每個字元的選取量 0..1
function selector(range, idx, n, ev, seedOrder) {
  if (!range) return 1;
  let s = ev(range.start) / 100, e = ev(range.end) / 100;
  const off = ev(range.offset) / 100, amt = ev(range.amount) / 100;
  if (s > e) [s, e] = [e, s];
  s += off; e += off;
  const i = seedOrder ? seedOrder[idx] : idx;
  const c0 = i / n, c1 = (i + 1) / n, cm = (c0 + c1) / 2;
  let k;
  switch (range.shape) {
    case 'rampUp': k = e > s ? clamp((cm - s) / (e - s), 0, 1) : (cm >= e ? 1 : 0); break;
    case 'rampDown': k = e > s ? clamp((e - cm) / (e - s), 0, 1) : (cm <= s ? 1 : 0); break;
    case 'triangle': { const m = (s + e) / 2, hw = (e - s) / 2; k = hw > 0 ? clamp(1 - Math.abs(cm - m) / hw, 0, 1) : 0; break; }
    case 'round': { const m = (s + e) / 2, hw = (e - s) / 2; const x = hw > 0 ? (cm - m) / hw : 2; k = Math.abs(x) <= 1 ? Math.sqrt(1 - x * x) : 0; break; }
    case 'smooth': { const m = (s + e) / 2, hw = (e - s) / 2; const x = hw > 0 ? clamp(1 - Math.abs(cm - m) / hw, 0, 1) : 0; k = x * x * (3 - 2 * x); break; }
    default: { // square：字元被範圍蓋住的比例
      const ov = Math.max(0, Math.min(c1, e) - Math.max(c0, s));
      k = clamp(ov / (c1 - c0), 0, 1);
    }
  }
  return k * amt;
}

// 排版並套用動畫器，回傳每個字元的位置與樣式
export function layoutText(tx, ev) {
  const text = String(ev(tx.text) ?? '');
  const size = Math.max(1, ev(tx.size));
  const g = mctx();
  const font = fontString(tx, size);
  ensureFont(font, text || 'A');
  g.font = font;
  const track = ev(tx.tracking) * size / 1000, lead = ev(tx.leading) * size;
  const src = tx.caps ? text.toUpperCase() : text;
  // 段落文字：寬度超過就換行（中文逐字，英文以單字）
  let lines = src.split('\n');
  if (tx.boxW > 0) {
    const out = [];
    for (const ln of lines) {
      let cur = '';
      for (const tok of ln.match(/[⺀-鿿豈-﫿＀-￯]|[^\s⺀-鿿]+|\s+/g) || ['']) {
        const w = g.measureText(cur + tok).width + track * (cur + tok).length;
        if (cur && w > tx.boxW) { out.push(cur.trimEnd()); cur = tok.trimStart(); } else cur += tok;
      }
      out.push(cur);
    }
    lines = out;
  }
  const chars = [];
  let wordIdx = 0;
  lines.forEach((ln, li) => {
    const arr = Array.from(ln);
    const ws = arr.map(c => g.measureText(c).width);
    const total = ws.reduce((a, b) => a + b, 0) + track * Math.max(0, arr.length - 1);
    let x = tx.align === 'left' ? 0 : tx.align === 'right' ? -total : -total / 2;
    if (tx.boxW > 0) x = tx.align === 'left' ? -tx.boxW / 2 : tx.align === 'right' ? tx.boxW / 2 - total : -total / 2;
    const y = li * lead;
    let prevSpace = true;
    arr.forEach((c, i) => {
      const sp = /\s/.test(c);
      if (!sp && prevSpace) wordIdx++;
      prevSpace = sp;
      chars.push({ c, x: x + ws[i] / 2, y, w: ws[i], line: li, word: sp ? -1 : wordIdx - 1, space: sp });
      x += ws[i] + track;
    });
    if (!arr.length) chars.push({ c: '', x: 0, y, w: 0, line: li, word: -1, space: true, empty: true });
  });
  // 垂直置中：整段文字的中心在 y=0（基線位置 = 字高約 0.35em 往下）
  const blockH = (lines.length - 1) * lead;
  const dy = tx.vAlign === 'top' ? size * 0.8 : tx.vAlign === 'bottom' ? -blockH : -blockH / 2 + size * 0.35;
  for (const ch of chars) ch.y += dy;

  const fill = ev(tx.fill), stroke = ev(tx.stroke), sw = ev(tx.strokeW);
  const nWords = wordIdx, nLines = lines.length;
  for (const ch of chars) Object.assign(ch, { op: 1, dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, fill: fill, stroke, sw, blur: 0, tr: 0 });
  // 動畫器
  for (const an of tx.animators || []) {
    if (an.on === false) continue;
    const by = an.range?.basedOn || 'chars';
    const units = by === 'words' ? nWords : by === 'lines' ? nLines : by === 'charsNoSpace' ? chars.filter(c => !c.space).length : chars.length;
    let order = null;
    if (an.range?.randomize) { order = Array.from({ length: units }, (_, i) => i).sort((a, b) => hash(a + 3.1) - hash(b + 3.1)); }
    const pr = an.props || {};
    const vals = {};
    for (const k of Object.keys(pr)) vals[k] = ev(pr[k]);
    let ci = 0, trAcc = 0, curLine = -1;
    chars.forEach(ch => {
      if (ch.line !== curLine) { curLine = ch.line; trAcc = 0; }
      let idx;
      if (by === 'words') idx = ch.word; else if (by === 'lines') idx = ch.line; else if (by === 'charsNoSpace') idx = ch.space ? -1 : ci++; else idx = chars.indexOf(ch);
      const k = idx < 0 ? 0 : selector(an.range, idx, Math.max(1, units), ev, order);
      ch.x += trAcc;
      if (!k) return;
      if ('opacity' in vals) ch.op *= 1 + (vals.opacity / 100 - 1) * k;
      if ('position' in vals) { ch.dx += vals.position[0] * k; ch.dy += vals.position[1] * k; }
      if ('scale' in vals) { ch.sx *= 1 + (vals.scale[0] / 100 - 1) * k; ch.sy *= 1 + (vals.scale[1] / 100 - 1) * k; }
      if ('rotation' in vals) ch.rot += vals.rotation * k;
      if ('fill' in vals) ch.fill = mix(ch.fill, vals.fill, k);
      if ('stroke' in vals) ch.stroke = mix(ch.stroke, vals.stroke, k);
      if ('blur' in vals) ch.blur += vals.blur * k;
      if ('tracking' in vals) { const add = vals.tracking * size / 1000 * k; trAcc += add; }
    });
  }
  return { chars, font, size, lines: lines.length, lead };
}

export function textBounds(L) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ch of L.chars) {
    if (ch.empty) continue;
    const r = Math.max(ch.w, L.size) * Math.max(Math.abs(ch.sx), Math.abs(ch.sy)) * 0.75 + ch.sw + ch.blur * 2 + 4;
    const cx = ch.x + ch.dx, cy = ch.y + ch.dy - L.size * 0.35;
    x0 = Math.min(x0, cx - r); x1 = Math.max(x1, cx + r); y0 = Math.min(y0, cy - r); y1 = Math.max(y1, cy + r);
  }
  if (!isFinite(x0)) return [0, 0, 0, 0];
  return [x0, y0, x1 - x0, y1 - y0];
}

export function drawText(ctx, L, tx) {
  ctx.font = L.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const canFilter = 'filter' in ctx;
  for (const ch of L.chars) {
    if (ch.empty || ch.space || ch.op <= 0.001) continue;
    ctx.save();
    ctx.globalAlpha *= clamp(ch.op, 0, 1);
    // 以字元中心（基線上方約 0.35em）旋轉縮放
    const cy = ch.y - L.size * 0.35;
    ctx.translate(ch.x + ch.dx, cy + ch.dy);
    if (ch.rot) ctx.rotate(ch.rot * Math.PI / 180);
    if (ch.sx !== 1 || ch.sy !== 1) ctx.scale(ch.sx, ch.sy);
    if (ch.blur > 0.3 && canFilter) ctx.filter = `blur(${ch.blur}px)`;
    const y = L.size * 0.35;
    const drawStroke = () => { if (ch.sw > 0) { ctx.strokeStyle = css(ch.stroke); ctx.lineWidth = ch.sw * 2; ctx.strokeText(ch.c, 0, y); } };
    if (!tx.strokeOver) drawStroke();
    if (tx.fillOn !== false) { ctx.fillStyle = css(ch.fill); ctx.fillText(ch.c, 0, y); }
    if (tx.strokeOver) drawStroke();
    ctx.restore();
  }
}
