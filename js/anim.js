// 動畫屬性：關鍵影格（線性／貝茲／保持）、緩動曲線、表達式
// 屬性格式：{ v: 值, k?: [{ t, v, ti:'bezier'|'linear'|'hold', eo:[x,y], ei:[x,y] }], x?: '表達式', xon?: true }
//   ti/eo 是這個關鍵影格「離開」時的插值與緩動控制點，ei 是「進入」這個關鍵影格的控制點（0..1 正規化，等同 CSS cubic-bezier）
import { clamp, lerp, noise1, mulberry, strHash, isNum } from './util.js';

export const LINEAR_O = [1 / 3, 1 / 3], LINEAR_I = [2 / 3, 2 / 3];
export const EASE_O = [0.333, 0], EASE_I = [0.667, 1];

export const P = (v, extra) => Object.assign({ v }, extra);   // 建立屬性
export const animated = p => !!(p && p.k && p.k.length);
export const hasExpr = p => !!(p && p.x && p.xon !== false);

// ---- 數值插值（數字、陣列、路徑；字串與布林保持）----
export function mix(a, b, k) {
  if (isNum(a) && isNum(b)) return a + (b - a) * k;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => mix(x, b[i] ?? x, k));
  if (a && b && typeof a === 'object' && Array.isArray(a.pts) && Array.isArray(b.pts) && a.pts.length === b.pts.length) {
    return { closed: a.closed, pts: a.pts.map((p, i) => p.map((x, j) => x + (b.pts[i][j] - x) * k)) };
  }
  return k < 1 ? a : b;
}

// cubic-bezier(x1,y1,x2,y2) 在 x 時的 y（牛頓法＋二分法）
export function bezierEase(x1, y1, x2, y2, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t, dx = t => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) { const e = sx(t) - x; if (Math.abs(e) < 1e-6) break; const d = dx(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
  if (t < 0 || t > 1 || Math.abs(sx(t) - x) > 1e-4) { let lo = 0, hi = 1; t = x; for (let i = 0; i < 40; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-6) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
  return ((ay * t + by) * t + cy) * t;
}

// 兩個關鍵影格之間的進度（套用緩動）
export function segProgress(a, b, t) {
  const k = clamp((t - a.t) / ((b.t - a.t) || 1e-9), 0, 1);
  if ((a.ti || 'bezier') === 'linear') return k;
  const o = a.eo || LINEAR_O, i = b.ei || LINEAR_I;
  return bezierEase(o[0], o[1], i[0], i[1], k);
}

// 不含表達式的值
export function rawAt(p, t) {
  if (!p) return undefined;
  const K = p.k;
  if (!K || !K.length) return p.v;
  if (t <= K[0].t) return K[0].v;
  const n = K.length;
  if (t >= K[n - 1].t) return K[n - 1].v;
  let i = 0;
  while (i < n - 2 && t >= K[i + 1].t) i++;
  const a = K[i], b = K[i + 1];
  if (a.ti === 'hold') return a.v;
  return mix(a.v, b.v, segProgress(a, b, t));
}

// ---- 表達式 ----
const exprCache = new Map();
function compile(src) {
  let f = exprCache.get(src);
  if (!f) {
    try {
      // 用 with 讓表達式直接使用 time、wiggle() 等名稱；eval 取最後一個敘述的值（和 After Effects 一樣）
      f = new Function('__c', '__src', 'with (__c) { return eval(__src); }');
    } catch (e) { f = () => { throw e; }; }
    exprCache.set(src, f);
  }
  return f;
}

// 向量運算
const vop = (a, b, f) => Array.isArray(a) ? a.map((x, i) => f(x, Array.isArray(b) ? (b[i] ?? 0) : b)) : Array.isArray(b) ? b.map(y => f(a, y)) : f(a, b);
const LIB = {
  add: (a, b) => vop(a, b, (x, y) => x + y), sub: (a, b) => vop(a, b, (x, y) => x - y),
  mul: (a, b) => vop(a, b, (x, y) => x * y), div: (a, b) => vop(a, b, (x, y) => x / y),
  length: (a, b) => { const d = b ? LIB.sub(a, b) : a; return Array.isArray(d) ? Math.hypot(...d) : Math.abs(d); },
  normalize: a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); },
  dot: (a, b) => a.reduce((s, x, i) => s + x * (b[i] || 0), 0),
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  clamp: (v, a, b) => Array.isArray(v) ? v.map((x, i) => clamp(x, Array.isArray(a) ? a[i] : a, Array.isArray(b) ? b[i] : b)) : clamp(v, a, b),
  degreesToRadians: d => d * Math.PI / 180, radiansToDegrees: r => r * 180 / Math.PI,
  hslToRgb: c => { const [hh, s, l, a = 1] = c; const f = n => { const k = (n + hh * 12) % 12, q = s * Math.min(l, 1 - l); return l - q * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4), a]; },
  rgbToHsl: c => { const [r, g, b, a = 1] = c, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; if (mx === mn) return [0, 0, l, a]; const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); let hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [hh / 6, s, l, a]; },
};
for (const k of ['sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'sqrt', 'pow', 'min', 'max', 'atan2', 'exp', 'log', 'PI']) LIB[k] = Math[k];
// linear / ease：linear(t, tMin, tMax, v1, v2) 或 linear(t, v1, v2)
function interpFn(easeFn) {
  return (t, a, b, c, d) => {
    let t0 = a, t1 = b, v0 = c, v1 = d;
    if (c === undefined) { t0 = 0; t1 = 1; v0 = a; v1 = b; }
    const k = t1 === t0 ? (t >= t1 ? 1 : 0) : clamp((t - t0) / (t1 - t0), 0, 1);
    return mix(v0, v1, easeFn(k));
  };
}
LIB.linear = interpFn(k => k);
LIB.ease = interpFn(k => bezierEase(.333, 0, .667, 1, k));
LIB.easeIn = interpFn(k => bezierEase(.333, 0, 1, 1, k));
LIB.easeOut = interpFn(k => bezierEase(0, 0, .667, 1, k));

// env：{ time, layer, comp, propPath, seed, layerApi(id|name|index), compApi, fps }
export function exprValue(p, t, env) {
  const value = rawAt(p, t);
  const seedBase = strHash((env.layer?.id || '') + '|' + (env.propPath || ''));
  let rnd = mulberry(seedBase), timeless = false;
  const fps = env.fps || 30;
  const keyList = p.k || [];
  const c = Object.create(LIB);
  Object.assign(c, {
    time: t, value, fps, frameDuration: 1 / fps,
    index: env.index, thisLayer: env.layerApi?.(env.layer), thisComp: env.compApi,
    thisProperty: { value, numKeys: keyList.length, key: n => ({ time: keyList[n - 1]?.t, value: keyList[n - 1]?.v }), valueAtTime: tt => rawAt(p, tt) },
    numKeys: keyList.length, key: n => ({ time: keyList[n - 1]?.t, value: keyList[n - 1]?.v, index: n }),
    valueAtTime: tt => rawAt(p, tt),
    velocity: (() => { const d = 1 / fps; return LIB.div(LIB.sub(rawAt(p, t + d / 2), rawAt(p, t - d / 2)), d); })(),
    inPoint: env.layer?.in ?? 0, outPoint: env.layer?.out ?? 0,
    // wiggle(每秒次數, 幅度, 八度=1, 幅度倍率=0.5, 時間)
    wiggle(freq, amp, oct = 1, mult = 0.5, tt = t) {
      const w = (x, s) => { let r = 0, a = 1, f = 1; for (let o = 0; o < Math.max(1, oct | 0); o++) { r += noise1(x * f, s + o * 13) * a; a *= mult; f *= 2; } return r; };
      const x = tt * freq;
      return Array.isArray(value) ? value.map((v, i) => v + w(x, seedBase % 997 + i * 31) * amp) : value + w(x, seedBase % 997) * amp;
    },
    seedRandom(n, tl = false) { rnd = mulberry(seedBase + n * 7919); timeless = tl; },
    random(a, b) {
      const r = timeless ? rnd() : mulberry(seedBase + Math.floor(t * fps) * 131)();
      if (a === undefined) return r;
      if (b === undefined) return Array.isArray(a) ? a.map(x => x * r) : a * r;
      return Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * r) : a + (b - a) * r;
    },
    gaussRandom(a = 1, b) { const r = mulberry(seedBase + Math.floor(t * fps) * 131); const g = Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()) / 3; return b === undefined ? a * g : a + (b - a) * (g * .5 + .5); },
    noise: x => noise1(Array.isArray(x) ? x[0] : x, 1) / 2,
    posterizeTime(f) { c.time = Math.floor(t * f) / f; return c.time; },
    loopOut: (type = 'cycle', n = 0) => loop(p, t, type, n, 'out', fps),
    loopIn: (type = 'cycle', n = 0) => loop(p, t, type, n, 'in', fps),
    loopOutDuration: (type = 'cycle', d = 0) => loop(p, t, type, 0, 'out', fps, d),
    loopInDuration: (type = 'cycle', d = 0) => loop(p, t, type, 0, 'in', fps, d),
    transform: env.layerApi?.(env.layer)?.transform,
    effect: env.layerApi?.(env.layer)?.effect,
  });
  const out = compile(p.x)(c, p.x);
  if (out === undefined || out === null || (typeof out === 'number' && !isFinite(out))) return value;
  // 型別修正：陣列長度和原值一致
  if (Array.isArray(value) && isNum(out)) return value.map(() => out);
  if (Array.isArray(value) && Array.isArray(out) && out.length < value.length) return value.map((v, i) => out[i] ?? v);
  return out;
}

function loop(p, t, type, n, dir, fps, dur = 0) {
  const K = p.k;
  if (!K || K.length < 2) return rawAt(p, t);
  const last = K.length - 1;
  let a, b;
  if (dir === 'out') {
    b = K[last].t; a = dur > 0 ? b - dur : n > 0 ? K[Math.max(0, last - n)].t : K[0].t;
    if (t <= b) return rawAt(p, t);
  } else {
    a = K[0].t; b = dur > 0 ? a + dur : n > 0 ? K[Math.min(last, n)].t : K[last].t;
    if (t >= a) return rawAt(p, t);
  }
  const L = b - a;
  if (L <= 0) return rawAt(p, t);
  const va = rawAt(p, a), vb = rawAt(p, b);
  if (type === 'continue') {
    const d = 1 / fps;
    if (dir === 'out') { const vel = LIB.div(LIB.sub(vb, rawAt(p, b - d)), d); return LIB.add(vb, LIB.mul(vel, t - b)); }
    const vel = LIB.div(LIB.sub(rawAt(p, a + d), va), d); return LIB.sub(va, LIB.mul(vel, a - t));
  }
  const rel = dir === 'out' ? t - b : a - t;
  const cyc = Math.floor(rel / L), f = rel - cyc * L;
  if (type === 'pingpong') {
    const fwd = (cyc % 2 === 0) === (dir === 'out');
    return rawAt(p, dir === 'out' ? (fwd ? b - f : a + f) : (fwd ? a + f : b - f));
  }
  if (dir === 'out') {
    const v = rawAt(p, a + f);
    return type === 'offset' ? LIB.add(v, LIB.mul(LIB.sub(vb, va), cyc + 1)) : v;
  }
  const v = rawAt(p, b - f);
  return type === 'offset' ? LIB.sub(v, LIB.mul(LIB.sub(vb, va), cyc + 1)) : v;
}

// 完整取值：關鍵影格＋表達式（表達式錯誤時記在 p.__err，回傳原值）
export function valueAt(p, t, env) {
  if (!p) return undefined;
  if (!hasExpr(p) || !env) return rawAt(p, t);
  if ((env.depth || 0) > 6) return rawAt(p, t);
  try { const v = exprValue(p, t, env); if (p.__err) delete p.__err; return v; } catch (e) {
    Object.defineProperty(p, '__err', { value: String(e.message || e), configurable: true, enumerable: false, writable: true });
    return rawAt(p, t);
  }
}

// ---- 編輯關鍵影格 ----
const EPS = 1e-4;
export function keyIndexAt(p, t) { return p.k ? p.k.findIndex(k => Math.abs(k.t - t) < EPS) : -1; }
export function sortKeys(p) { if (p.k) p.k.sort((a, b) => a.t - b.t); }
export function setKey(p, t, v, opts = {}) {
  if (!p.k) p.k = [];
  const i = keyIndexAt(p, t);
  if (i >= 0) { p.k[i].v = v; return p.k[i]; }
  const hold = typeof v === 'string' || typeof v === 'boolean';
  const k = { t, v, ti: hold ? 'hold' : (opts.ti || 'bezier'), eo: [...(opts.eo || LINEAR_O)], ei: [...(opts.ei || LINEAR_I)] };
  p.k.push(k); sortKeys(p);
  return k;
}
export function removeKey(p, t) { const i = keyIndexAt(p, t); if (i >= 0) p.k.splice(i, 1); if (p.k && !p.k.length) delete p.k; }
// 切換碼錶：開啟時在目前時間建立第一個關鍵影格；關閉時保留目前值、移除所有關鍵影格
export function toggleStopwatch(p, t) {
  if (animated(p)) { p.v = rawAt(p, t); delete p.k; }
  else setKey(p, t, p.v);
}
// 設定值：有關鍵影格就在目前時間打一個，沒有就直接改
export function setValue(p, t, v) {
  if (animated(p)) setKey(p, t, v); else p.v = v;
}
export function applyEase(k, kind) {
  switch (kind) {
    case 'linear': k.ti = 'linear'; k.eo = [...LINEAR_O]; k.ei = [...LINEAR_I]; break;
    case 'hold': k.ti = 'hold'; break;
    case 'easy': k.ti = 'bezier'; k.eo = [...EASE_O]; k.ei = [...EASE_I]; break;
    case 'easeIn': k.ti = k.ti === 'hold' ? 'bezier' : k.ti; k.ei = [...EASE_I]; break;    // 進入這個關鍵影格時減速
    case 'easeOut': k.ti = 'bezier'; k.eo = [...EASE_O]; break;                            // 離開這個關鍵影格時加速
    case 'bezier': k.ti = 'bezier'; break;
  }
}
// 所有屬性逐一走訪（含效果、遮罩、形狀、文字動畫）
export function walkProps(obj, fn, path = '') {
  if (!obj || typeof obj !== 'object') return;
  if ('v' in obj && (obj.k || obj.x !== undefined || Object.keys(obj).every(k => ['v', 'k', 'x', 'xon'].includes(k)))) { fn(obj, path); return; }
  for (const [k, v] of Object.entries(obj)) if (v && typeof v === 'object' && !k.startsWith('__')) walkProps(v, fn, path ? path + '.' + k : k);
}
