// 專案資料模型：合成、圖層、素材；復原／重做；自動儲存（IndexedDB）
import { uid, clone, hexToRgba } from './util.js';
import { P } from './anim.js';

export const FORMAT = 'xiaoke-effects';
export const FILE_EXT = '.xke';
export const LABEL_COLORS = ['#c7484a', '#e3b33f', '#5e8fd9', '#d97ad9', '#61bf8d', '#d98d3c', '#8d6fd9', '#5cc2c9', '#b5b5b5', '#a8865c'];
// After Effects 的混合模式；canvas 支援的直接對應 globalCompositeOperation
export const BLEND_MODES = ['normal', 'dissolve', 'darken', 'multiply', 'colorBurn', 'linearBurn', 'darkerColor', 'add', 'lighten', 'screen', 'colorDodge', 'linearDodge', 'lighterColor',
  'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix', 'difference', 'exclusion', 'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity'];
export const MATTE_MODES = ['none', 'alpha', 'alphaInv', 'luma', 'lumaInv'];
export const MASK_MODES = ['add', 'subtract', 'intersect', 'difference', 'none'];
export const LAYER_TYPES = ['solid', 'shape', 'text', 'image', 'video', 'audio', 'null', 'adjust', 'precomp', 'camera', 'light', 'libbg', 'libfx', 'lottie'];

let labelIdx = 0;
const nextLabel = () => LABEL_COLORS[labelIdx++ % LABEL_COLORS.length];

export function newProject(name = '') {
  return { format: FORMAT, version: 1, name, comps: [], footage: [], folders: [], activeComp: null, renderQueue: [] };
}

export function newComp(o = {}) {
  const w = o.w || 1920, h = o.h || 1080;
  return {
    id: uid('c'), name: o.name || 'Comp', w, h, fps: o.fps || 30, duration: o.duration || 10,
    bg: o.bg || [0.05, 0.06, 0.08, 1], layers: [], workIn: 0, workOut: o.duration || 10, markers: [],
    motionBlur: false, shutter: 180, samples: 8, folder: o.folder || null,
  };
}

export function transformFor(w, h, cw, ch, centered = false) {
  return {
    anchor: P(centered ? [0, 0, 0] : [w / 2, h / 2, 0]), position: P([cw / 2, ch / 2, 0]), scale: P([100, 100, 100]),
    rotation: P(0), rotX: P(0), rotY: P(0), opacity: P(100),
  };
}

function baseLayer(type, name, comp, w, h, centered) {
  return {
    id: uid('l'), type, name, label: nextLabel(), in: 0, out: comp.duration, start: 0, speed: 1,
    visible: true, solo: false, locked: false, shy: false, audioOn: true, threeD: false, motionBlur: false, collapse: false,
    blend: 'normal', parent: null, matte: 'none', matteLayer: null, preserveAlpha: false, quality: 'best',
    transform: transformFor(w, h, comp.w, comp.h, centered), effects: [], masks: [], styles: [],
  };
}

export function makeSolid(comp, o = {}) {
  const w = o.w || comp.w, h = o.h || comp.h;
  const l = baseLayer('solid', o.name || 'Solid', comp, w, h);
  l.solid = { w, h, color: P(o.color || [0.85, 0.24, 0.25, 1]) };
  return l;
}

export function makeNull(comp, o = {}) {
  const l = baseLayer('null', o.name || 'Null', comp, 100, 100);
  return l;
}

export function makeAdjust(comp, o = {}) {
  const l = baseLayer('adjust', o.name || 'Adjustment', comp, comp.w, comp.h);
  return l;
}

export function shapeItem(kind, o = {}) {
  return {
    id: uid('s'), kind, name: o.name || kind, visible: true,
    size: P(o.size || [400, 300]), round: P(o.round || 0), pos: P(o.pos || [0, 0]), rot: P(o.rot || 0), scl: P(o.scl || [100, 100]),
    points: P(o.points || 5), outerR: P(o.outerR || 200), innerR: P(o.innerR || 90), outerRound: P(0), innerRound: P(0),
    path: P(o.path || { closed: true, pts: [] }),
    fill: { on: o.fill !== false, type: 'solid', color: P(o.color || [0.27, 0.55, 1, 1]), color2: P(o.color2 || [1, 0.4, 0.7, 1]), opacity: P(100), gStart: P([-200, 0]), gEnd: P([200, 0]) },
    stroke: { on: !!o.stroke, color: P(o.strokeColor || [1, 1, 1, 1]), width: P(o.strokeWidth || 8), opacity: P(100), cap: 'round', join: 'round', dash: P(0), gap: P(0) },
    trim: { on: false, start: P(0), end: P(100), offset: P(0) },
    repeater: { on: false, copies: P(3), offset: P([150, 0]), rot: P(0), scale: P([100, 100]), startOp: P(100), endOp: P(100) },
    zigzag: { on: false, size: P(10), ridges: P(10), smooth: false },
    wiggle: { on: false, size: P(20), detail: P(4), speed: P(2) },
  };
}

export function makeShape(comp, o = {}) {
  const l = baseLayer('shape', o.name || 'Shape', comp, 0, 0, true);
  l.shapes = o.shapes || [shapeItem(o.kind || 'rect', o)];
  return l;
}

export function makeText(comp, o = {}) {
  const l = baseLayer('text', o.name || o.text?.slice(0, 20) || 'Text', comp, 0, 0, true);
  l.text = {
    text: P(o.text ?? 'Text'), font: o.font || 'Noto Sans TC', weight: o.weight || 800, italic: false, caps: false,
    size: P(o.size || 120), fill: P(o.color || [1, 1, 1, 1]), fillOn: true, stroke: P(o.strokeColor || [0, 0, 0, 1]), strokeW: P(o.strokeW || 0), strokeOver: false,
    tracking: P(o.tracking || 0), leading: P(1.2), align: o.align || 'center', vAlign: 'middle', boxW: 0, animators: [],
  };
  return l;
}

export function textAnimator(o = {}) {
  return {
    id: uid('a'), name: o.name || 'Animator', on: true,
    props: o.props || {},       // { opacity:P, position:P, scale:P, rotation:P, fill:P, blur:P, tracking:P }
    range: { start: P(o.start ?? 0), end: P(o.end ?? 100), offset: P(o.offset ?? 0), shape: o.shape || 'square', basedOn: o.basedOn || 'chars', smooth: P(100), amount: P(100), randomize: !!o.randomize },
  };
}

export function makeFootageLayer(comp, f, o = {}) {
  const type = f.kind === 'audio' ? 'audio' : f.kind === 'video' ? 'video' : 'image';
  const l = baseLayer(type, o.name || f.name, comp, f.w || 100, f.h || 100);
  l.source = f.id;
  if (type !== 'image') { l.out = Math.min(comp.duration, f.duration || comp.duration); l.audio = { level: P(0) }; }
  // 大於合成的素材自動縮放到剛好放得下
  if (f.w && f.h && (f.w > comp.w || f.h > comp.h) && o.fit !== false) {
    const k = Math.min(comp.w / f.w, comp.h / f.h) * 100;
    l.transform.scale.v = [k, k, 100];
  }
  return l;
}

export function makePrecomp(comp, sub, o = {}) {
  const l = baseLayer('precomp', o.name || sub.name, comp, sub.w, sub.h);
  l.comp = sub.id;
  l.out = Math.min(comp.duration, sub.duration);
  l.collapseT = false;
  return l;
}

export function makeCamera(comp, o = {}) {
  const zoom = comp.w * 1.3889;   // 約等於 50mm 鏡頭
  const l = baseLayer('camera', o.name || 'Camera', comp, 0, 0, true);
  l.threeD = true;
  l.transform.position.v = [comp.w / 2, comp.h / 2, -zoom];
  l.camera = { zoom: P(zoom), poi: P([comp.w / 2, comp.h / 2, 0]), twoNode: true, dof: false, focus: P(zoom), aperture: P(25), blur: P(100) };
  return l;
}

export function makeLight(comp, o = {}) {
  const l = baseLayer('light', o.name || 'Light', comp, 0, 0, true);
  l.threeD = true;
  l.transform.position.v = [comp.w * .3, comp.h * .2, -comp.w * .5];
  l.light = { kind: o.kind || 'point', color: P([1, 1, 1, 1]), intensity: P(100), poi: P([comp.w / 2, comp.h / 2, 0]), cone: P(90), feather: P(50), shadows: false, ambient: P(20) };
  return l;
}

export function makeLibBg(comp, key, o = {}) {
  const l = baseLayer('libbg', o.name || key, comp, comp.w, comp.h);
  l.lib = { key, accent: P(hexToRgba('#f0a83a')) };
  return l;
}
export function makeLibFx(comp, key, o = {}) {
  const l = baseLayer('libfx', o.name || key, comp, comp.w, comp.h);
  l.lib = { key };
  return l;
}
export function makeLottie(comp, f, o = {}) {
  const l = baseLayer('lottie', o.name || f.name, comp, f.w, f.h);
  l.source = f.id;
  l.out = Math.min(comp.duration, f.duration || comp.duration);
  return l;
}

// 圖層原始內容的「標稱範圍」（layer 座標）：用來把相對座標（0..1）換成像素
export function layerRect(l, project) {
  const comp = findCompOfLayer(project, l);
  switch (l.type) {
    case 'solid': return [0, 0, l.solid.w, l.solid.h];
    case 'image': case 'video': case 'lottie': { const f = project.footage.find(x => x.id === l.source); return [0, 0, f?.w || 100, f?.h || 100]; }
    case 'precomp': { const c = project.comps.find(x => x.id === l.comp); return [0, 0, c?.w || 100, c?.h || 100]; }
    case 'null': return [0, 0, 100, 100];
    case 'text': case 'shape': case 'camera': case 'light': return [-(comp?.w || 1920) / 2, -(comp?.h || 1080) / 2, comp?.w || 1920, comp?.h || 1080];
    default: return [0, 0, comp?.w || 1920, comp?.h || 1080];
  }
}
export function findCompOfLayer(project, l) { return project.comps.find(c => c.layers.includes(l)); }
export const getComp = (project, id) => project.comps.find(c => c.id === id);
export const getFootage = (project, id) => project.footage.find(f => f.id === id);
export function getLayer(comp, id) { return comp?.layers.find(l => l.id === id); }

// 新的特效實例
export function makeEffect(def, l, project) {
  const [x, y, w, h] = layerRect(l, project);
  const params = {};
  for (const p of def.params) {
    let v = clone(p.def);
    if (p.type === 'point' && Array.isArray(v)) v = [x + v[0] * w, y + v[1] * h];
    params[p.id] = P(v);
  }
  return { id: uid('e'), type: def.id, on: true, params, collapse: false };
}

export function makeMask(kind, rect, o = {}) {
  const [x, y, w, h] = rect;
  let pts;
  if (kind === 'ellipse') {
    const k = 0.5523, cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
    pts = [[cx, y, -rx * k, 0, rx * k, 0], [x + w, cy, 0, -ry * k, 0, ry * k], [cx, y + h, rx * k, 0, -rx * k, 0], [x, cy, 0, ry * k, 0, -ry * k]];
  } else pts = [[x, y, 0, 0, 0, 0], [x + w, y, 0, 0, 0, 0], [x + w, y + h, 0, 0, 0, 0], [x, y + h, 0, 0, 0, 0]];
  return { id: uid('m'), name: o.name || 'Mask', mode: 'add', inverted: false, on: true, path: P({ closed: true, pts: o.pts || pts }), feather: P(0), opacity: P(100), expansion: P(0), color: nextLabel() };
}

// ---- 復原／重做 ----
export class History {
  constructor(get, set, max = 120) { this.get = get; this.set = set; this.max = max; this.undo = []; this.redo = []; this.last = null; }
  // 修改之前呼叫：保存目前狀態
  checkpoint(label = '') {
    const s = JSON.stringify(this.get());
    if (this.undo.length && this.undo[this.undo.length - 1].s === s) return;
    this.undo.push({ s, label }); if (this.undo.length > this.max) this.undo.shift();
    this.redo.length = 0;
  }
  doUndo() { const e = this.undo.pop(); if (!e) return false; this.redo.push({ s: JSON.stringify(this.get()), label: e.label }); this.set(JSON.parse(e.s)); return e.label || true; }
  doRedo() { const e = this.redo.pop(); if (!e) return false; this.undo.push({ s: JSON.stringify(this.get()), label: e.label }); this.set(JSON.parse(e.s)); return e.label || true; }
  clear() { this.undo.length = 0; this.redo.length = 0; }
}

// ---- IndexedDB：自動儲存與素材檔 ----
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('xiaoke-effects', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(store, mode); const r = fn(t.objectStore(store)); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); });
}
export const Store = {
  get: k => tx('kv', 'readonly', s => s.get(k)).catch(() => null),
  set: (k, v) => tx('kv', 'readwrite', s => s.put(v, k)).catch(e => console.warn('store', e)),
  getBlob: k => tx('blobs', 'readonly', s => s.get(k)).catch(() => null),
  putBlob: (k, b) => tx('blobs', 'readwrite', s => s.put(b, k)).catch(e => console.warn('blob', e)),
  delBlob: k => tx('blobs', 'readwrite', s => s.delete(k)).catch(() => { }),
  blobKeys: () => tx('blobs', 'readonly', s => s.getAllKeys()).catch(() => []),
};

// 清掉沒有被任何專案用到的素材檔
export async function gcBlobs(projects) {
  const used = new Set(projects.flatMap(p => p.footage.map(f => f.blobKey)));
  for (const k of await Store.blobKeys()) if (!used.has(k)) await Store.delBlob(k);
}

// 讀進來的專案補上新版本才有的欄位
export function migrate(p) {
  if (!p || p.format !== FORMAT) throw new Error('format');
  p.footage ||= []; p.folders ||= []; p.renderQueue ||= [];
  for (const c of p.comps) {
    c.markers ||= []; c.samples ||= 8;
    for (const l of c.layers) { l.effects ||= []; l.masks ||= []; l.styles ||= []; l.speed ||= 1; l.matte ||= 'none'; }
  }
  return p;
}
