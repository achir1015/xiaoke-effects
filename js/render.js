// 合成算繪：圖層來源 → 遮罩 → 特效 → 變形（2D／3D）→ 軌道遮罩 → 混合模式；動態模糊；巢狀合成；調整圖層
import { M4, css, rgbaToHex, strHash, clamp } from './util.js';
import { valueAt, rawAt } from './anim.js';
import { getComp, getFootage, getLayer } from './model.js';
import { evalShapeItem, drawShapeData, shapeBounds, tracePath } from './shapes.js';
import { layoutText, textBounds, drawText } from './text.js';
import { render3D } from './gl3d.js';
import * as Media from './media.js';
import * as LIB from './library.js';
import { applyEffects, getEffect } from './fx.js';

// 表達式控制項：不經過特效處理器，只給表達式讀值
export const CONTROL_EFFECTS = [
  { id: 'sliderControl', cat: 'control', params: [{ id: 'slider', type: 'number', def: 0, min: 0, max: 100 }] },
  { id: 'angleControl', cat: 'control', params: [{ id: 'angle', type: 'angle', def: 0 }] },
  { id: 'pointControl', cat: 'control', params: [{ id: 'point', type: 'point', def: [0.5, 0.5] }] },
  { id: 'colorControl', cat: 'control', params: [{ id: 'color', type: 'color', def: [1, 0, 0, 1] }] },
  { id: 'checkboxControl', cat: 'control', params: [{ id: 'checkbox', type: 'bool', def: false }] },
  { id: 'layerControl', cat: 'control', params: [{ id: 'layer', type: 'layer', def: '' }] },
];
export const effectDef = id => getEffect(id) || CONTROL_EFFECTS.find(e => e.id === id);

const BLEND = {
  normal: 'source-over', dissolve: 'source-over', darken: 'darken', multiply: 'multiply', colorBurn: 'color-burn', linearBurn: 'multiply', darkerColor: 'darken',
  add: 'lighter', lighten: 'lighten', screen: 'screen', colorDodge: 'color-dodge', linearDodge: 'lighter', lighterColor: 'lighten',
  overlay: 'overlay', softLight: 'soft-light', hardLight: 'hard-light', vividLight: 'hard-light', linearLight: 'hard-light', pinLight: 'hard-light', hardMix: 'hard-light',
  difference: 'difference', exclusion: 'exclusion', subtract: 'difference', divide: 'color-dodge', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};

// ---- 畫布池 ----
const pool = new Map();
export function poolCanvas(key, w, h) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  let c = pool.get(key);
  if (!c) { c = document.createElement('canvas'); pool.set(key, c); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  g.clearRect(0, 0, w, h);
  return c;
}

// ---- 時間 ----
export const layerActive = (l, t) => t >= l.in - 1e-9 && t < l.out - 1e-9;
export const localTime = (l, t) => t - l.start;            // 關鍵影格用的圖層時間
export function sourceTime(l, t, env) {                     // 素材／巢狀合成的時間
  const lt = localTime(l, t);
  if (l.timeRemap?.on) return valueAt(l.timeRemap.p, lt, env);
  return lt * (l.speed || 1);
}

// ---- 表達式環境 ----
function makeEnv(project, comp, l, t, depth = 0) {
  const env = { project, comp, layer: l, time: localTime(l, t), fps: comp.fps, index: comp.layers.indexOf(l) + 1, depth };
  env.layerApi = x => layerApi(project, comp, x, t, depth + 1);
  env.compApi = compApi(project, comp, t, depth + 1);
  return env;
}
function compApi(project, comp, t, depth) {
  return {
    name: comp.name, width: comp.w, height: comp.h, duration: comp.duration, frameDuration: 1 / comp.fps, numLayers: comp.layers.length,
    layer: x => { const l = typeof x === 'number' ? comp.layers[x - 1] : comp.layers.find(y => y.name === x); if (!l) throw new Error('layer ' + x); return layerApi(project, comp, l, t, depth); },
  };
}
function layerApi(project, comp, l, t, depth) {
  if (!l) return undefined;
  const env = () => makeEnv(project, comp, l, t, depth);
  const v = p => valueAt(p, localTime(l, t), env());
  const tr = l.transform;
  const T = {
    get position() { return v(tr.position); }, get anchorPoint() { return v(tr.anchor); }, get scale() { return v(tr.scale); },
    get rotation() { return v(tr.rotation); }, get opacity() { return v(tr.opacity); }, get xRotation() { return v(tr.rotX); }, get yRotation() { return v(tr.rotY); }, get zRotation() { return v(tr.rotation); },
  };
  return {
    name: l.name, index: comp.layers.indexOf(l) + 1, inPoint: l.in, outPoint: l.out, startTime: l.start, transform: T,
    get position() { return T.position; }, get scale() { return T.scale; }, get rotation() { return T.rotation; }, get opacity() { return T.opacity; }, get anchorPoint() { return T.anchorPoint; },
    effect: name => {
      const e = typeof name === 'number' ? l.effects[name - 1] : l.effects.find(x => x.name === name || x.type === name);
      if (!e) throw new Error('effect ' + name);
      const def = effectDef(e.type);
      return p => { const id = typeof p === 'number' ? def?.params[p - 1]?.id : p; const prop = e.params[id] || Object.values(e.params)[0]; return v(prop); };
    },
    text: l.text ? { get sourceText() { return v(l.text.text); } } : undefined,
    // 3D 圖層：和 AE 一樣投影到合成畫面上的 2D 位置
    toComp: p => {
      const w = M4.apply(layerWorld(project, comp, l, t), [p[0] || 0, p[1] || 0, p[2] || 0]);
      if (!l.threeD) return w;
      const cam = activeCamera(project, comp, t), c = M4.apply(cam.view, w);
      const z = c[2] || 1e-6;
      return [cam.cw / 2 + c[0] * cam.zoom / z, cam.ch / 2 + c[1] * cam.zoom / z, 0];
    },
    width: l.solid?.w || comp.w, height: l.solid?.h || comp.h,
  };
}

// 求值器：ev(prop) → 目前時間的值
export function evaluator(project, comp, l, t, depth = 0) {
  const env = makeEnv(project, comp, l, t, depth);
  const lt = env.time;
  return (p, path) => { if (!p) return undefined; if (!p.x) return rawAt(p, lt); env.propPath = path; return valueAt(p, lt, env); };
}

// ---- 變形矩陣 ----
export function localMatrix(l, ev) {
  const tr = l.transform;
  const a = ev(tr.anchor, 'a'), p = ev(tr.position, 'p'), s = ev(tr.scale, 's');
  const rz = ev(tr.rotation, 'r') * Math.PI / 180;
  let m = M4.trans(p[0], p[1], l.threeD ? p[2] || 0 : 0);
  if (l.threeD) {
    // 和 After Effects 相同：方向（Orientation）再 X、Y、Z 旋轉（點先轉 Z，最後轉 X）
    if (tr.orient) { const o = ev(tr.orient, 'or'); m = M4.mul(m, M4.rotX(o[0] * Math.PI / 180)); m = M4.mul(m, M4.rotY(o[1] * Math.PI / 180)); m = M4.mul(m, M4.rotZ(o[2] * Math.PI / 180)); }
    m = M4.mul(m, M4.rotX(ev(tr.rotX, 'rx') * Math.PI / 180));
    m = M4.mul(m, M4.rotY(ev(tr.rotY, 'ry') * Math.PI / 180));
    m = M4.mul(m, M4.rotZ(rz));
  } else m = M4.mul(m, M4.rotZ(rz));
  m = M4.mul(m, M4.scale(s[0] / 100, s[1] / 100, l.threeD ? (s[2] ?? 100) / 100 : 1));
  return M4.mul(m, M4.trans(-a[0], -a[1], l.threeD ? -(a[2] || 0) : 0));
}
export function layerWorld(project, comp, l, t, seen = 0) {
  const m = localMatrix(l, evaluator(project, comp, l, t));
  if (l.parent && seen < 32) {
    const par = getLayer(comp, l.parent);
    if (par && par !== l) return M4.mul(layerWorld(project, comp, par, t, seen + 1), m);
  }
  return m;
}
const is3D = m => Math.abs(m[2]) > 1e-9 || Math.abs(m[6]) > 1e-9 || Math.abs(m[8]) > 1e-9 || Math.abs(m[9]) > 1e-9 || Math.abs(m[14]) > 1e-9 || Math.abs(m[3]) > 1e-9 || Math.abs(m[7]) > 1e-9;

// 鏡頭
export function activeCamera(project, comp, t) {
  const cam = comp.layers.find(l => l.type === 'camera' && l.visible && layerActive(l, t));
  const def = { view: M4.lookAt([comp.w / 2, comp.h / 2, -comp.w * 1.3889], [comp.w / 2, comp.h / 2, 0]), zoom: comp.w * 1.3889, cw: comp.w, ch: comp.h };
  if (!cam) return def;
  const ev = evaluator(project, comp, cam, t);
  const zoom = ev(cam.camera.zoom);
  let view;
  const parentM = cam.parent ? layerWorld(project, comp, getLayer(comp, cam.parent), t) : M4.ident();
  if (cam.camera.twoNode) {
    const eye = M4.apply(parentM, ev(cam.transform.position)), poi = M4.apply(parentM, ev(cam.camera.poi));
    view = M4.lookAt(eye, poi);
    const roll = ev(cam.transform.rotation) * Math.PI / 180;
    if (roll) view = M4.mul(M4.rotZ(-roll), view);
  } else {
    const p = ev(cam.transform.position);
    let m = M4.mul(parentM, M4.trans(p[0], p[1], p[2] || 0));
    if (cam.transform.orient) { const o = ev(cam.transform.orient); m = M4.mul(m, M4.rotX(o[0] * Math.PI / 180)); m = M4.mul(m, M4.rotY(o[1] * Math.PI / 180)); m = M4.mul(m, M4.rotZ(o[2] * Math.PI / 180)); }
    m = M4.mul(m, M4.rotX(ev(cam.transform.rotX) * Math.PI / 180));
    m = M4.mul(m, M4.rotY(ev(cam.transform.rotY) * Math.PI / 180));
    m = M4.mul(m, M4.rotZ(ev(cam.transform.rotation) * Math.PI / 180));
    view = M4.invert(m);
  }
  return { view, zoom, cw: comp.w, ch: comp.h, layer: cam };
}
function activeLights(project, comp, t) {
  const out = [];
  for (const l of comp.layers) {
    if (l.type !== 'light' || !l.visible || !layerActive(l, t)) continue;
    const ev = evaluator(project, comp, l, t), L = l.light;
    const parentM = l.parent ? layerWorld(project, comp, getLayer(comp, l.parent), t) : M4.ident();
    const pos = M4.apply(parentM, ev(l.transform.position)), poi = M4.apply(parentM, ev(L.poi));
    const d = [poi[0] - pos[0], poi[1] - pos[1], poi[2] - pos[2]];
    out.push({ kind: L.kind, pos, dir: d, color: ev(L.color), intensity: ev(L.intensity) / 100, cone: ev(L.cone) });
  }
  return out;
}

// ---- 圖層來源（layer 座標的內容）----
// 回傳 { canvas, ox, oy, s }：畫布像素 (i,j) 對應 layer 座標 (ox + i/s, oy + j/s)
function layerSource(project, comp, l, t, ev, o, key) {
  const s = o.scale;
  switch (l.type) {
    case 'solid': {
      const c = poolCanvas(key + 'src', l.solid.w * s, l.solid.h * s), g = c.getContext('2d');
      g.fillStyle = css(ev(l.solid.color)); g.fillRect(0, 0, c.width, c.height);
      return { canvas: c, ox: 0, oy: 0, s };
    }
    case 'shape': {
      const items = (l.shapes || []).filter(it => it.visible !== false).map(it => evalShapeItem(it, (p) => ev(p), localTime(l, t)));
      const [bx, by, bw, bh] = shapeBounds(items);
      if (bw <= 0 || bh <= 0) return null;
      const pad = padFor(l);
      const ox = bx - pad, oy = by - pad;
      const c = poolCanvas(key + 'src', (bw + pad * 2) * s, (bh + pad * 2) * s), g = c.getContext('2d');
      g.setTransform(s, 0, 0, s, -ox * s, -oy * s);
      for (let i = items.length - 1; i >= 0; i--) drawShapeData(g, items[i]);
      return { canvas: c, ox, oy, s };
    }
    case 'text': {
      const L = layoutText(l.text, p => ev(p));
      const [bx, by, bw, bh] = textBounds(L);
      if (bw <= 0 || bh <= 0) return null;
      const pad = padFor(l);
      const ox = bx - pad, oy = by - pad;
      const c = poolCanvas(key + 'src', (bw + pad * 2) * s, (bh + pad * 2) * s), g = c.getContext('2d');
      g.setTransform(s, 0, 0, s, -ox * s, -oy * s);
      drawText(g, L, l.text);
      return { canvas: c, ox, oy, s };
    }
    case 'image': {
      const f = getFootage(project, l.source); const img = f && Media.imageOf(f);
      return img ? { canvas: img, ox: 0, oy: 0, s: (img.naturalWidth || img.width) / (f.w || 1) } : null;
    }
    case 'video': {
      const f = getFootage(project, l.source); if (!f) return null;
      const st = sourceTime(l, t, makeEnv(project, comp, l, t));
      const v = o.exact ? Media.videoEl(l.id + key) : Media.videoFrame(l.id + key, f, st, o.playing, l.speed || 1);
      if (o.liveVideos) o.liveVideos.add(l.id + key);
      return v && v.readyState >= 2 ? { canvas: v, ox: 0, oy: 0, s: (v.videoWidth || f.w) / (f.w || 1) } : null;
    }
    case 'lottie': {
      const f = getFootage(project, l.source); if (!f) return null;
      const c = Media.lottieFrame(f, sourceTime(l, t, makeEnv(project, comp, l, t)));
      return c ? { canvas: c, ox: 0, oy: 0, s: c.width / (f.w || 1) } : null;
    }
    case 'precomp': {
      const sub = getComp(project, l.comp);
      if (!sub || o.depth > 8) return null;
      const st = sourceTime(l, t, makeEnv(project, comp, l, t));
      if (l.collapse && sub.layers.some(x => x.threeD && x.type !== 'camera' && x.type !== 'light')) {
        // 塌陷變形（AE 的 Collapse Transformations）：裡面的 3D 圖層用外層的鏡頭與燈光直接畫在外層畫面上，
        // 這個圖層的變形併入每個子圖層的世界矩陣；畫好的結果再當成一張「已在合成座標」的來源（之後不再變形）
        const cam = o.cam || activeCamera(project, comp, t);
        const pre = M4.mul(o.pre || M4.ident(), layerWorld(project, comp, l, t));
        const c = poolCanvas(key + 'src', comp.w * s, comp.h * s);
        renderComp(project, sub, st, c, { ...o, depth: o.depth + 1, key: key + '>', transparent: true, collapse: { cam, lights: o.lights || activeLights(project, comp, t), pre, w: comp.w, h: comp.h } });
        return { canvas: c, ox: 0, oy: 0, s, collapsed: true };
      }
      const c = poolCanvas(key + 'src', sub.w * s, sub.h * s);
      renderComp(project, sub, st, c, { ...o, depth: o.depth + 1, key: key + '>', transparent: true, collapse: null, pre: null, cam: null, lights: null });
      return { canvas: c, ox: 0, oy: 0, s };
    }
    case 'libbg': case 'libfx': {
      const c = poolCanvas(key + 'src', comp.w * s, comp.h * s), g = c.getContext('2d');
      const lt = localTime(l, t), D = l.out - l.in;
      try {
        if (l.type === 'libbg') LIB.BASIC[l.lib.key]?.({ g, W: c.width, H: c.height, t: lt, D, acc: rgbaToHex(ev(l.lib.accent)), tw: 0, ty: c.height / 2, ts: 0 });
        else LIB.GSCR[l.lib.key]?.fn({ g, W: c.width, H: c.height, t: lt, D });
      } catch { }
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
      return { canvas: c, ox: 0, oy: 0, s };
    }
    default: return null;
  }
}
// 文字、形狀圖層四周留白，讓發光、陰影等特效有空間
function padFor(l) {
  if (!l.effects.length) return 4;
  return l.effects.some(e => e.on !== false && ['style', 'stylize', 'blur', 'generate', 'distort'].includes(effectDef(e.type)?.cat)) ? 120 : 16;
}

// 一般大小的空白來源（只有特效的純色／生成器圖層）
function ensureCanvasSource(src, key) {
  if (src.canvas instanceof HTMLCanvasElement && src.owned) return src;
  const c = poolCanvas(key + 'own', src.canvas.width || src.canvas.videoWidth, src.canvas.height || src.canvas.videoHeight);
  c.getContext('2d').drawImage(src.canvas, 0, 0, c.width, c.height);
  return { ...src, canvas: c, owned: true };
}

// ---- 遮罩 ----
function applyMasks(src, l, ev, key, o) {
  const masks = l.masks.filter(m => m.on !== false && m.mode !== 'none');
  if (!masks.length) return src;
  src = ensureCanvasSource(src, key);
  const w = src.canvas.width, h = src.canvas.height;
  const mc = poolCanvas(key + 'mask', w, h), g = mc.getContext('2d');
  masks.forEach((m, i) => {
    const tmp = poolCanvas(key + 'm1', w, h), tg = tmp.getContext('2d');
    tg.setTransform(src.s, 0, 0, src.s, -src.ox * src.s, -src.oy * src.s);
    const path = ev(m.path), exp = ev(m.expansion), feather = ev(m.feather) * src.s, op = ev(m.opacity) / 100;
    tg.beginPath(); tracePath(tg, path);
    tg.fillStyle = '#fff'; tg.fill();
    if (exp) { tg.lineWidth = Math.abs(exp) * 2; tg.lineJoin = 'round'; tg.globalCompositeOperation = exp > 0 ? 'source-over' : 'destination-out'; tg.strokeStyle = '#fff'; tg.stroke(); tg.globalCompositeOperation = 'source-over'; }
    let shape = tmp;
    if (feather > 0.5) {
      const r = applyEffects(tmp, [{ id: 'gaussianBlur', params: { blurriness: feather, dimensions: 'both', repeatEdge: false } }], { time: 0, compTime: 0, fps: 30, width: w, height: h, scale: 1, seed: 0 });
      const f2 = poolCanvas(key + 'm2', w, h); f2.getContext('2d').drawImage(r, 0, 0); shape = f2;
    }
    if (m.inverted) { const inv = poolCanvas(key + 'm3', w, h), ig = inv.getContext('2d'); ig.fillStyle = '#fff'; ig.fillRect(0, 0, w, h); ig.globalCompositeOperation = 'destination-out'; ig.drawImage(shape, 0, 0); shape = inv; }
    g.globalAlpha = op;
    const mode = i === 0 && m.mode !== 'subtract' ? 'add' : m.mode;
    if (i === 0 && m.mode === 'subtract') { g.globalAlpha = 1; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.globalAlpha = op; }
    g.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : mode === 'intersect' ? 'destination-in' : 'xor';
    g.drawImage(shape, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  });
  const sg = src.canvas.getContext('2d');
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.globalCompositeOperation = 'destination-in'; sg.drawImage(mc, 0, 0); sg.globalCompositeOperation = 'source-over';
  return src;
}

// ---- 特效 ----
function effectList(l, ev, src) {
  const list = [];
  for (const e of l.effects) {
    if (e.on === false) continue;
    const def = getEffect(e.type);
    if (!def) continue;
    const params = {};
    for (const p of def.params) {
      let v = ev(e.params[p.id], e.id + '.' + p.id);
      if (v === undefined) v = p.def;
      if (p.type === 'point' && Array.isArray(v)) v = [(v[0] - src.ox) * src.s, (v[1] - src.oy) * src.s];
      params[p.id] = v;
    }
    list.push({ id: e.type, params });
  }
  return list;
}
// 圖層原本沒有內容（例如空的純色＋生成器），也要有畫布給特效用
function blankSource(project, comp, l, o, key) {
  const c = poolCanvas(key + 'blank', comp.w * o.scale, comp.h * o.scale);
  return { canvas: c, ox: l.type === 'text' || l.type === 'shape' ? -comp.w / 2 : 0, oy: l.type === 'text' || l.type === 'shape' ? -comp.h / 2 : 0, s: o.scale, owned: true };
}

// 把圖層畫成「已處理好的來源」（遮罩＋特效）
function processedSource(project, comp, l, t, ev, o, key) {
  let src = layerSource(project, comp, l, t, ev, o, key);
  const hasFx = l.effects.some(e => e.on !== false && getEffect(e.type));
  if (!src) { if (!hasFx) return null; src = blankSource(project, comp, l, o, key); }
  src = applyMasks(src, l, ev, key, o);
  if (hasFx) {
    const list = effectList(l, ev, src);
    if (list.length) {
      const cw = src.canvas.width || src.canvas.videoWidth, ch = src.canvas.height || src.canvas.videoHeight;
      let input = src.canvas;
      if (!(input instanceof HTMLCanvasElement)) { input = ensureCanvasSource(src, key).canvas; }
      const r = applyEffects(input, list, { time: localTime(l, t), compTime: t, fps: comp.fps, width: cw, height: ch, scale: src.s, seed: strHash(l.id) % 100000 });
      if (r !== input) {
        const c = poolCanvas(key + 'fx', cw, ch); c.getContext('2d').drawImage(r, 0, 0, cw, ch);
        src = { ...src, canvas: c, owned: true };
      }
    }
  }
  return src;
}

// 把來源依變形畫到 ctx（comp 座標，已含輸出倍率 S）
function drawTransformed(ctx, src, world, opacity, S, cam, lights, outW, outH) {
  if (opacity <= 0.0005) return;
  if (cam && is3D(world)) {
    const cv = render3D(src, world, cam, outW, outH, opacity, lights);
    if (cv) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cv, 0, 0); ctx.restore(); }
    return;
  }
  ctx.save();
  ctx.globalAlpha *= opacity;
  const m = world;
  // 2D 仿射：x' = m0 x + m4 y + m12
  ctx.setTransform(S * m[0], S * m[1], S * m[4], S * m[5], S * m[12], S * m[13]);
  ctx.transform(1 / src.s, 0, 0, 1 / src.s, src.ox, src.oy);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src.canvas, 0, 0);
  ctx.restore();
}

// 是否被當成軌道遮罩
function matteUsers(comp) {
  const set = new Set();
  comp.layers.forEach((l, i) => { if (l.matte && l.matte !== 'none') { const m = l.matteLayer ? getLayer(comp, l.matteLayer) : comp.layers[i - 1]; if (m) set.add(m.id); } });
  return set;
}

// 單一圖層畫到 ctx（含動態模糊）
function drawLayer(project, comp, l, t, ctx, o, cam, lights, key) {
  const S = o.scale, outW = ctx.canvas.width, outH = ctx.canvas.height;
  const ev = evaluator(project, comp, l, t, o.depth);
  const src = processedSource(project, comp, l, t, ev, o, key);
  if (!src) return;
  const mb = comp.motionBlur && l.motionBlur && o.motionBlur !== false;
  const op = clamp(ev(l.transform.opacity) / 100, 0, 1);
  const use3D = l.threeD ? cam : null;
  // 塌陷的巢狀合成已經畫在合成座標上；塌陷合成裡的圖層要先套外層圖層的矩陣
  const world = tt => src.collapsed ? M4.ident() : o.pre ? M4.mul(o.pre, layerWorld(project, comp, l, tt)) : layerWorld(project, comp, l, tt);
  if (!mb) { drawTransformed(ctx, src, world(t), op, S, use3D, lights, outW, outH); return; }
  // 動態模糊：在快門時間內取多個時間點，平均疊加
  const N = Math.max(2, o.playing ? Math.min(4, comp.samples) : comp.samples);
  const sh = (comp.shutter || 180) / 360 / comp.fps;
  const acc = poolCanvas(key + 'mb', outW, outH), ag = acc.getContext('2d');
  ag.globalCompositeOperation = 'lighter';
  for (let i = 0; i < N; i++) {
    const tt = t + (i / (N - 1) - 0.5) * sh;
    const evi = evaluator(project, comp, l, tt, o.depth);
    drawTransformed(ag, src, world(tt), clamp(evi(l.transform.opacity) / 100, 0, 1) / N, S, use3D, lights, outW, outH);
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(acc, 0, 0); ctx.restore();
}

// 亮度 → 透明度（亮度遮罩用）
function lumaToAlpha(c, invert) {
  const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const al = a[i + 3] / 255;
    let y = al > 0 ? (0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]) / al / 255 : 0;
    y = clamp(y * al, 0, 1);
    a[i] = a[i + 1] = a[i + 2] = 255; a[i + 3] = Math.round((invert ? 1 - y : y) * 255);
  }
  g.putImageData(d, 0, 0);
}

// ---- 合成 ----
// opts：{ scale, playing, exact, depth, transparent, motionBlur, liveVideos, hideLayers:Set }
export function renderComp(project, comp, t, out, opts = {}) {
  const o = { scale: 1, depth: 0, key: '', ...opts };
  const S = o.scale, C = o.collapse;
  // 塌陷時畫布是外層合成的大小，鏡頭／燈光用外層的
  const W = Math.max(1, Math.round((C ? C.w : comp.w) * S)), H = Math.max(1, Math.round((C ? C.h : comp.h) * S));
  if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
  const ctx = out.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  if (!o.transparent) { ctx.fillStyle = css(comp.bg); ctx.fillRect(0, 0, W, H); }
  const anySolo = comp.layers.some(l => l.solo && l.visible);
  const mattes = matteUsers(comp);
  const has3D = comp.layers.some(l => l.threeD && l.type !== 'camera' && l.type !== 'light');
  const cam = C ? C.cam : has3D ? activeCamera(project, comp, t) : null;
  const lights = C ? C.lights : has3D ? activeLights(project, comp, t) : null;
  o.pre = C ? C.pre : null; o.cam = cam; o.lights = lights;
  // 3D 圖層依鏡頭距離由遠到近排序（連續的 3D 圖層一組）
  const order = [];
  for (let i = comp.layers.length - 1; i >= 0; i--) order.push(comp.layers[i]);
  if (cam) sort3D(project, comp, order, t, cam, o.pre);
  for (const l of order) {
    if (!l.visible || (anySolo && !l.solo) || !layerActive(l, t) || mattes.has(l.id) || o.hideLayers?.has(l.id)) continue;
    if (['null', 'camera', 'light', 'audio'].includes(l.type)) continue;
    const key = o.key + l.id;
    try {
      if (l.type === 'adjust') { drawAdjust(project, comp, l, t, ctx, o, key); continue; }
      const blend = l.preserveAlpha ? 'source-atop' : BLEND[l.blend] || 'source-over';
      const hasMatte = l.matte && l.matte !== 'none';
      if (!hasMatte && blend === 'source-over') { drawLayer(project, comp, l, t, ctx, o, cam, lights, key); continue; }
      // 先畫到暫存畫布，再套軌道遮罩／混合模式
      const tmp = poolCanvas(key + 'tmp', W, H);
      drawLayer(project, comp, l, t, tmp.getContext('2d'), o, cam, lights, key);
      if (hasMatte) {
        const idx = comp.layers.indexOf(l);
        const ml = l.matteLayer ? getLayer(comp, l.matteLayer) : comp.layers[idx - 1];
        if (ml && layerActive(ml, t)) {
          const mc = poolCanvas(key + 'matte', W, H);
          drawLayer(project, comp, ml, t, mc.getContext('2d'), o, ml.threeD ? cam : null, lights, key + 'M');
          if (l.matte === 'luma' || l.matte === 'lumaInv') lumaToAlpha(mc, l.matte === 'lumaInv');
          const tg = tmp.getContext('2d');
          tg.setTransform(1, 0, 0, 1, 0, 0);
          tg.globalCompositeOperation = l.matte === 'alphaInv' ? 'destination-out' : 'destination-in';
          tg.drawImage(mc, 0, 0); tg.globalCompositeOperation = 'source-over';
        } else if (l.matte === 'alpha' || l.matte === 'luma') continue;
      }
      ctx.save(); ctx.globalCompositeOperation = blend; ctx.drawImage(tmp, 0, 0); ctx.restore();
    } catch (e) { console.warn('render layer', l.name, e); }
  }
}

function sort3D(project, comp, order, t, cam, pre) {
  // 連續的 3D 圖層依鏡頭空間深度排序（遠的先畫）
  let i = 0;
  while (i < order.length) {
    if (!order[i].threeD) { i++; continue; }
    let j = i; while (j < order.length && order[j].threeD) j++;
    const seg = order.slice(i, j).map(l => {
      let z = 0;
      try { const w = pre ? M4.mul(pre, layerWorld(project, comp, l, t)) : layerWorld(project, comp, l, t); const c = M4.apply(M4.mul(cam.view, w), [l.transform.anchor.v[0], l.transform.anchor.v[1], 0]); z = c[2]; } catch { }
      return { l, z };
    });
    seg.sort((a, b) => b.z - a.z);
    seg.forEach((s, k) => { order[i + k] = s.l; });
    i = j;
  }
}

// 調整圖層：把下面已經合成好的畫面套用特效
function drawAdjust(project, comp, l, t, ctx, o, key) {
  const ev = evaluator(project, comp, l, t, o.depth);
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const list = [];
  const fakeSrc = { ox: 0, oy: 0, s: o.scale };
  for (const x of effectList(l, ev, fakeSrc)) list.push(x);
  if (!list.length) return;
  const below = poolCanvas(key + 'below', W, H); below.getContext('2d').drawImage(ctx.canvas, 0, 0);
  const r = applyEffects(below, list, { time: localTime(l, t), compTime: t, fps: comp.fps, width: W, height: H, scale: o.scale, seed: strHash(l.id) % 100000 });
  const res = poolCanvas(key + 'adjres', W, H), rg = res.getContext('2d');
  rg.drawImage(r, 0, 0);
  // 範圍：圖層本身（整個合成大小）＋遮罩＋變形
  const shape = { canvas: poolCanvas(key + 'adjshape', comp.w * o.scale, comp.h * o.scale), ox: 0, oy: 0, s: o.scale, owned: true };
  const sg = shape.canvas.getContext('2d'); sg.fillStyle = '#fff'; sg.fillRect(0, 0, shape.canvas.width, shape.canvas.height);
  applyMasks(shape, l, ev, key + 'adj', o);
  const mask = poolCanvas(key + 'adjmask', W, H);
  drawTransformed(mask.getContext('2d'), shape, layerWorld(project, comp, l, t), clamp(ev(l.transform.opacity) / 100, 0, 1), o.scale, null, null, W, H);
  rg.globalCompositeOperation = 'destination-in'; rg.drawImage(mask, 0, 0); rg.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(res, 0, 0);
  ctx.restore();
}

// ---- 檢視器用：圖層範圍（layer 座標）----
export function layerBounds(project, comp, l, t) {
  const ev = evaluator(project, comp, l, t);
  switch (l.type) {
    case 'solid': return [0, 0, l.solid.w, l.solid.h];
    case 'shape': { const items = (l.shapes || []).map(it => evalShapeItem(it, p => ev(p), localTime(l, t))); const b = shapeBounds(items); return b[2] ? b : [-50, -50, 100, 100]; }
    case 'text': { const b = textBounds(layoutText(l.text, p => ev(p))); return b[2] ? b : [-50, -50, 100, 100]; }
    case 'image': case 'video': case 'lottie': { const f = getFootage(project, l.source); return [0, 0, f?.w || 100, f?.h || 100]; }
    case 'precomp': { const c = getComp(project, l.comp); return [0, 0, c?.w || 100, c?.h || 100]; }
    case 'null': return [0, 0, 100, 100];
    case 'camera': case 'light': return [-40, -40, 80, 80];
    default: return [0, 0, comp.w, comp.h];
  }
}

// 圖層座標 → 畫面（comp）座標；3D 圖層經過鏡頭投影
export function projector(project, comp, l, t) {
  const world = layerWorld(project, comp, l, t);
  const cam = (l.threeD || is3D(world)) ? activeCamera(project, comp, t) : null;
  if (!cam) return p => { const r = M4.apply(world, p); return [r[0], r[1]]; };
  const mv = M4.mul(cam.view, world);
  return p => { const c = M4.apply(mv, [p[0], p[1], 0]); const z = Math.max(1e-3, c[2]); return [cam.cw / 2 + c[0] * cam.zoom / z, cam.ch / 2 + c[1] * cam.zoom / z]; };
}

// ---- 匯出前：把所有影片圖層精準跳到這一格 ----
export async function prepareExact(project, comp, t, key = '', depth = 0) {
  const jobs = [];
  for (const l of comp.layers) {
    if (!layerActive(l, t) || !l.visible) continue;
    if (l.type === 'video') {
      const f = getFootage(project, l.source);
      if (f) jobs.push(Media.seekExact(l.id + key + l.id, f, sourceTime(l, t, makeEnv(project, comp, l, t))));
    } else if (l.type === 'precomp' && depth < 8) {
      const sub = getComp(project, l.comp);
      if (sub) jobs.push(prepareExact(project, sub, sourceTime(l, t, makeEnv(project, comp, l, t)), key + l.id + '>', depth + 1));
    }
  }
  await Promise.all(jobs);
}
