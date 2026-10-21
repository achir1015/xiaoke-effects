// 專案範本：片頭標題、下標字幕、粒子、3D 卡片、標誌顯示、直式短影音、倒數、霓虹、故障風、動態文字
import * as M from './model.js';
import { P, setKey, EASE_O, EASE_I } from './anim.js';
import { clone, h } from './util.js';
import { effectDef, renderComp } from './render.js';
import { applyPreset } from './presets.js';
import { t } from './i18n.js';

const K = (p, list) => { for (const [tt, v, o] of list) { const k = setKey(p, tt, clone(v)); Object.assign(k, { ti: 'bezier', eo: [...EASE_O], ei: [...EASE_I] }, o || {}); } return p; };
const rgb = (hex, a = 1) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, a]; };
function fx(project, l, id, vals = {}) {
  const def = effectDef(id); if (!def) return null;
  const e = M.makeEffect(def, l, project);
  for (const [k, v] of Object.entries(vals)) if (e.params[k]) e.params[k] = v && typeof v === 'object' && 'v' in v ? v : P(v);
  l.effects.push(e); return e;
}
// 依照參數名稱片段找參數（特效庫的參數名稱可能略有不同）
const fp = (e, re) => e && Object.keys(e.params).find(k => re.test(k));
function bgGradient(c, c1, c2) {
  const l = M.makeShape(c, { kind: 'rect', name: 'Background', size: [c.w * 1.1, c.h * 1.1], color: c1 });
  const it = l.shapes[0]; it.fill.type = 'radial'; it.fill.color2.v = c2; it.fill.gStart.v = [0, -c.h * 0.05]; it.fill.gEnd.v = [c.w * 0.62, 0];
  return l;
}
function text(c, s, o = {}) {
  const l = M.makeText(c, { text: s, size: o.size || 120, color: o.color || [1, 1, 1, 1], font: o.font || 'Montserrat', weight: o.weight || 900, tracking: o.tracking || 0 });
  l.name = o.name || s.slice(0, 24);
  l.transform.position.v = [o.x ?? c.w / 2, o.y ?? c.h / 2, 0];
  return l;
}
function ring(c, r, o = {}) {
  const l = M.makeShape(c, { kind: 'ellipse', name: o.name || 'Ring', size: [r * 2, r * 2], fill: false, stroke: true, strokeColor: o.color || rgb('#3d7bff'), strokeWidth: o.width || 6 });
  l.transform.position.v = [c.w / 2, c.h / 2, 0];
  return l;
}
function ticks(c, r, n, o = {}) {
  const l = M.makeShape(c, { kind: 'rect', name: o.name || 'Ticks', size: [o.w || 6, o.len || 26], color: o.color || rgb('#9fb6ff', 0.85) });
  const it = l.shapes[0]; it.pos.v = [0, -r];
  it.repeater.on = true; it.repeater.copies.v = n; it.repeater.offset.v = [0, 0]; it.repeater.rot.v = 360 / n;
  l.transform.position.v = [c.w / 2, c.h / 2, 0];
  return l;
}

export const TEMPLATES = [
  { id: 'intro', w: 1920, h: 1080, fps: 30, dur: 6, thumbT: 2.5, build(p, c) {
    const bg = bgGradient(c, rgb('#26338f'), rgb('#070a1f'));
    const r1 = ring(c, 330, { name: 'Orbit Ring', width: 5, color: rgb('#3f7dff') });
    const s1 = r1.shapes[0]; s1.trim.on = true; K(s1.trim.end, [[0.2, 0], [1.6, 100]]); K(r1.transform.rotation, [[0, -90], [6, 30]]);
    const r2 = ring(c, 390, { name: 'Dashed Ring', width: 3, color: rgb('#8aa4ff', 0.6) }); r2.shapes[0].stroke.dash.v = 14; r2.shapes[0].stroke.gap.v = 16; r2.transform.rotation.x = 'time * -12';
    const tk = ticks(c, 470, 72, { name: 'Tick Burst' }); K(tk.transform.scale, [[0.3, [40, 40, 100]], [1.4, [100, 100, 100]]]); K(tk.transform.opacity, [[0.3, 0], [1, 100]]); tk.transform.rotation.x = 'time * 8';
    const title = text(c, 'EFFECT KK', { size: 170, tracking: 120, name: 'Title' });
    const an = M.textAnimator({ name: 'Tracking', props: { tracking: P(0), opacity: P(100), blur: P(0) }, start: 0, end: 100 }); K(an.props.tracking, [[0.4, 500], [1.8, 0]]); K(an.props.opacity, [[0.4, 0], [1.2, 100]]); K(an.props.blur, [[0.4, 30], [1.6, 0]]); title.text.animators.push(an);
    fx(p, title, 'glow', {});
    const sub = text(c, 'MOTION GRAPHICS  ·  VISUAL EFFECTS  ·  小柯機器人', { size: 34, weight: 500, tracking: 380, y: c.h / 2 + 110, color: rgb('#c8d3ff'), name: 'Tagline' });
    applyPreset('fadeByChar', sub, c, 1.4);
    const line = M.makeShape(c, { kind: 'rect', name: 'Accent Line', size: [520, 4], color: rgb('#5b8cff') }); line.transform.position.v = [c.w / 2, c.h / 2 + 70, 0]; K(line.transform.scale, [[1.2, [0, 100, 100]], [2, [100, 100, 100]]]);
    c.layers = [title, sub, line, tk, r2, r1, bg];
  } },
  { id: 'lowerThird', w: 1920, h: 1080, fps: 30, dur: 6, thumbT: 2, build(p, c) {
    const bg = bgGradient(c, rgb('#3a4250'), rgb('#14171c'));
    const bar = M.makeShape(c, { kind: 'rect', name: 'Bar', size: [760, 120], color: rgb('#ffffff', 0.95), round: 6 }); bar.transform.anchor.v = [-380, 0, 0]; bar.transform.position.v = [140, 820, 0];
    K(bar.transform.scale, [[0.2, [0, 100, 100]], [0.8, [100, 100, 100]], [5.2, [100, 100, 100]], [5.7, [0, 100, 100]]]);
    const acc = M.makeShape(c, { kind: 'rect', name: 'Accent', size: [16, 120], color: rgb('#ff5a4f') }); acc.transform.position.v = [140, 820, 0];
    K(acc.transform.scale, [[0, [100, 0, 100]], [0.3, [100, 100, 100]]]);
    const name = text(c, '小柯機器人', { size: 64, weight: 900, color: rgb('#15181d'), x: 180, y: 806, name: 'Name', font: 'Noto Sans TC' }); name.text.align = 'left';
    applyPreset('revealUp', name, c, 0.5);
    const role = text(c, 'MOTION DESIGNER · 動態設計師', { size: 28, weight: 700, tracking: 120, color: rgb('#ffffff'), x: 180, y: 906, name: 'Role' }); role.text.align = 'left';
    applyPreset('fadeByChar', role, c, 0.8);
    name.matte = 'none';
    c.layers = [name, role, acc, bar, bg];
  } },
  { id: 'particles', w: 1920, h: 1080, fps: 30, dur: 8, thumbT: 3, build(p, c) {
    const bg = M.makeSolid(c, { name: 'Background', color: rgb('#04050a') });
    const part = M.makeSolid(c, { name: 'Particles', color: [0, 0, 0, 0] });
    fx(p, part, 'particles', {});
    const title = text(c, 'SPARK', { size: 220, tracking: 200, name: 'Title' });
    applyPreset('blurByChar', title, c, 1); fx(p, title, 'glow', {});
    c.layers = [title, part, bg];
  } },
  { id: 'cards3d', w: 1920, h: 1080, fps: 30, dur: 8, thumbT: 2, build(p, c) {
    const bg = bgGradient(c, rgb('#2a2e44'), rgb('#0a0b12'));
    const cam = M.makeCamera(c, { name: 'Camera 1' });
    K(cam.transform.position, [[0, [c.w / 2 - 1000, c.h / 2 - 450, -2700]], [8, [c.w / 2 + 1000, c.h / 2 - 350, -2700]]]);
    const light = M.makeLight(c, { name: 'Key Light', kind: 'point' }); light.light.intensity.v = 110;
    const amb = M.makeLight(c, { name: 'Fill Light', kind: 'ambient' }); amb.light.intensity.v = 45;
    const card = (name, col, x, z, ry) => { const l = M.makeSolid(c, { name, color: col, w: 440, h: 300 }); l.threeD = true; l.transform.position.v = [x, c.h / 2 - 60, z]; l.transform.rotY.v = ry; return l; };
    const a = card('Card Blue', rgb('#3a5cff'), c.w / 2 - 420, 120, 20), b = card('Card Coral', rgb('#ff6a4d'), c.w / 2 + 420, 260, -25), cc = card('Card Teal', rgb('#1fc4b1'), c.w / 2, -120, 0);
    fx(p, a, 'gradientRamp', {}); fx(p, cc, 'fourColorGradient', {});
    for (const [l, d] of [[a, 0.2], [b, 0.5], [cc, 0.8]]) K(l.transform.rotX, [[d, 90], [d + 1, 0, { eo: [0.3, 0], ei: [0.6, 1.25] }]]);
    const floor = M.makeSolid(c, { name: 'Floor', color: rgb('#1b1e2c'), w: 4000, h: 4000 }); floor.threeD = true; floor.transform.position.v = [c.w / 2, c.h / 2 + 200, 600]; floor.transform.rotX.v = 90;
    fx(p, floor, 'grid', {});
    const title = text(c, 'CLASSIC 3D', { size: 150, tracking: 60, name: '3D Title' }); title.threeD = true; title.transform.position.v = [c.w / 2, c.h / 2 + 120, -200];
    const cap = text(c, 'CAMERAS  ·  LIGHTS  ·  3D LAYERS', { size: 34, weight: 600, tracking: 400, y: c.h - 120, name: 'Caption' });
    c.layers = [cap, cam, light, amb, title, a, b, cc, floor, bg];
  } },
  { id: 'logoReveal', w: 1920, h: 1080, fps: 30, dur: 5, thumbT: 2, build(p, c) {
    const bg = M.makeSolid(c, { name: 'Background', color: rgb('#0f1013') });
    const dot = M.makeShape(c, { kind: 'ellipse', name: 'Logo Circle', size: [260, 260], color: rgb('#ffcc33') }); dot.transform.position.v = [c.w / 2, c.h / 2 - 60, 0];
    K(dot.transform.scale, [[0.2, [0, 0, 100]], [0.7, [118, 118, 100]], [0.95, [100, 100, 100]]]);
    const star = M.makeShape(c, { kind: 'star', name: 'Star', outerR: 90, innerR: 40, color: rgb('#15161a') }); star.transform.position.v = [c.w / 2, c.h / 2 - 60, 0];
    K(star.transform.rotation, [[0.5, -120], [1.3, 0]]); K(star.transform.scale, [[0.5, [0, 0, 100]], [1.1, [100, 100, 100]]]);
    const rr = ring(c, 200, { width: 4, color: rgb('#ffcc33') }); rr.transform.position.v = [c.w / 2, c.h / 2 - 60, 0]; rr.shapes[0].trim.on = true; K(rr.shapes[0].trim.start, [[0.6, 0], [1.6, 100]]); K(rr.shapes[0].trim.end, [[0.3, 0], [1.2, 100]]);
    const name = text(c, 'XIAOKE', { size: 110, tracking: 200, y: c.h / 2 + 200, name: 'Brand' }); applyPreset('trackingIn', name, c, 1);
    c.layers = [name, star, dot, rr, bg];
  } },
  { id: 'story', w: 1080, h: 1920, fps: 30, dur: 6, thumbT: 2.2, build(p, c) {
    const bg = M.makeShape(c, { kind: 'rect', name: 'Gradient', size: [c.w * 1.2, c.h * 1.2], color: rgb('#ff6a88') }); bg.shapes[0].fill.type = 'linear'; bg.shapes[0].fill.color2.v = rgb('#5d3cff'); bg.shapes[0].fill.gStart.v = [0, -c.h / 2]; bg.shapes[0].fill.gEnd.v = [0, c.h / 2]; bg.transform.position.v = [c.w / 2, c.h / 2, 0];
    const blob = M.makeShape(c, { kind: 'ellipse', name: 'Blob', size: [700, 700], color: rgb('#ffffff', 0.15) }); blob.transform.position.v = [c.w * 0.75, c.h * 0.25, 0]; blob.shapes[0].wiggle.on = true; blob.shapes[0].wiggle.size.v = 30; blob.shapes[0].wiggle.detail.v = 3; applyPreset('float', blob, c, 0);
    const l1 = text(c, '新品上市', { size: 170, font: 'Noto Sans TC', y: c.h * 0.42, name: 'Line 1' }); applyPreset('popByChar', l1, c, 0.3);
    const l2 = text(c, 'NEW ARRIVAL', { size: 70, tracking: 300, y: c.h * 0.42 + 150, name: 'Line 2' }); applyPreset('fadeByChar', l2, c, 0.9);
    const btn = M.makeShape(c, { kind: 'rect', name: 'Button', size: [520, 120], round: 60, color: rgb('#ffffff') }); btn.transform.position.v = [c.w / 2, c.h * 0.72, 0]; applyPreset('popIn', btn, c, 1.6); applyPreset('pulse', btn, c, 0);
    const bt = text(c, '立即查看 →', { size: 54, font: 'Noto Sans TC', color: rgb('#5d3cff'), y: c.h * 0.72, name: 'Button Text' }); bt.parent = btn.id; bt.transform.position.v = [0, 0, 0]; btn.transform.anchor.v = [0, 0, 0];
    c.layers = [bt, btn, l2, l1, blob, bg];
  } },
  { id: 'countdown', w: 1920, h: 1080, fps: 30, dur: 5, thumbT: 1.5, build(p, c) {
    const bg = bgGradient(c, rgb('#1c2333'), rgb('#07090d'));
    const r = ring(c, 280, { width: 18, color: rgb('#33d1ff') }); r.shapes[0].trim.on = true; r.shapes[0].trim.end.x = '100 - (time % 1) * 100'; r.shapes[0].trim.end.xon = true;
    const r0 = ring(c, 280, { width: 18, color: rgb('#ffffff', 0.12), name: 'Track' });
    const num = text(c, '5', { size: 300, name: 'Number' }); num.text.text.x = 'String(Math.max(1, Math.ceil(5 - time)))'; num.text.text.xon = true;
    num.transform.scale.x = 'var k = 1 - (time % 1); mul(value, 1 + Math.pow(k, 6) * 0.25)'; num.transform.scale.xon = true;
    c.layers = [num, r, r0, bg];
  } },
  { id: 'neon', w: 1920, h: 1080, fps: 30, dur: 6, thumbT: 2, build(p, c) {
    const bg = M.makeSolid(c, { name: 'Wall', color: rgb('#0b0612') });
    fx(p, bg, 'fractalNoise', { color1: [0.02, 0.01, 0.04, 1], color2: [0.16, 0.08, 0.22, 1], scale: 300, contrast: 60 });
    const t1 = text(c, 'OPEN', { size: 260, font: 'Pacifico', weight: 400, color: rgb('#ff4fd8'), name: 'Neon' });
    fx(p, t1, 'glow', {});
    t1.transform.opacity.x = 'time < 1.2 ? (random() > 0.5 ? 100 : 25) : (random() > 0.97 ? 50 : 100)'; t1.transform.opacity.xon = true;
    const t2 = text(c, '24 HOURS', { size: 80, font: 'Orbitron', weight: 700, tracking: 300, color: rgb('#35f2ff'), y: c.h / 2 + 200, name: 'Neon Sub' });
    fx(p, t2, 'glow', {}); applyPreset('fadeIn', t2, c, 1.4);
    c.layers = [t1, t2, bg];
  } },
  { id: 'glitch', w: 1920, h: 1080, fps: 30, dur: 5, thumbT: 1.1, build(p, c) {
    const bg = M.makeSolid(c, { name: 'Background', color: rgb('#050505') });
    fx(p, bg, 'scanlines', {});
    const t1 = text(c, 'SYSTEM ERROR', { size: 180, font: 'Bungee', weight: 400, name: 'Glitch Title' });
    const g = fx(p, t1, 'glitch', {}); fx(p, t1, 'rgbSplit', {}) || fx(p, t1, 'chromaticAberration', {});
    const sub = text(c, '小柯機器人 · 故障風標題', { size: 48, font: 'Noto Sans TC', y: c.h / 2 + 150, color: rgb('#00ffc8'), name: 'Sub' }); applyPreset('glitchText', sub, c, 0);
    c.layers = [t1, sub, bg];
  } },
  { id: 'kinetic', w: 1920, h: 1080, fps: 30, dur: 6, thumbT: 3, build(p, c) {
    const bg = M.makeSolid(c, { name: 'Background', color: rgb('#f4f1ea') });
    const words = [['MAKE', 0.2, -170, '#111111'], ['IT', 0.7, -10, '#ff5233'], ['MOVE', 1.2, 150, '#111111']];
    const ls = words.map(([w, d, y, col]) => { const l = text(c, w, { size: 200, weight: 900, color: rgb(col), y: c.h / 2 + y, name: w }); applyPreset('slideInLeft', l, c, d); return l; });
    const bar = M.makeShape(c, { kind: 'rect', name: 'Underline', size: [700, 22], color: rgb('#ff5233') }); bar.transform.position.v = [c.w / 2, c.h / 2 + 250, 0]; K(bar.transform.scale, [[1.6, [0, 100, 100]], [2.2, [100, 100, 100]]]);
    c.layers = [...ls, bar, bg];
  } },
  { id: 'blank1080', w: 1920, h: 1080, fps: 30, dur: 10, thumbT: 0, blank: true, build() { } },
  { id: 'blankVertical', w: 1080, h: 1920, fps: 30, dur: 10, thumbT: 0, blank: true, build() { } },
  { id: 'blankSquare', w: 1080, h: 1080, fps: 30, dur: 10, thumbT: 0, blank: true, build() { } },
];

// 建立範本：加到 project，回傳主合成
export function buildTemplate(id, project) {
  const tp = TEMPLATES.find(x => x.id === id);
  if (!tp) return null;
  const c = M.newComp({ name: t('tpl_' + id), w: tp.w, h: tp.h, fps: tp.fps, duration: tp.dur, bg: [0.05, 0.06, 0.08, 1] });
  tp.build(project, c);
  project.comps.push(c);
  return c;
}

const thumbs = new Map();
export function thumbFor(id) {
  const cv = h('canvas', { width: 192, height: 108 });
  const draw = () => {
    if (thumbs.has(id)) { cv.getContext('2d').drawImage(thumbs.get(id), 0, 0, 192, 108); return; }
    const tp = TEMPLATES.find(x => x.id === id);
    const tmp = M.newProject();
    const c = buildTemplate(id, tmp);
    const out = document.createElement('canvas');
    try { renderComp(tmp, c, tp.thumbT, out, { scale: Math.min(0.2, 192 / c.w) }); } catch (e) { console.warn('thumb', id, e); }
    const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 192, 108);
    const k = Math.min(192 / out.width, 108 / out.height), w = out.width * k, hh = out.height * k;
    g.drawImage(out, (192 - w) / 2, (108 - hh) / 2, w, hh);
    if (tp.blank) { g.strokeStyle = '#555'; g.setLineDash([4, 4]); g.strokeRect((192 - w) / 2 + 4, (108 - hh) / 2 + 4, w - 8, hh - 8); g.fillStyle = '#888'; g.font = '12px system-ui'; g.textAlign = 'center'; g.fillText(`${tp.w}×${tp.h}`, 96, 58); }
    const snap = document.createElement('canvas'); snap.width = 192; snap.height = 108; snap.getContext('2d').drawImage(cv, 0, 0);
    thumbs.set(id, snap);
  };
  setTimeout(draw, 30);
  document.fonts?.ready.then(() => { thumbs.delete(id); setTimeout(draw, 50); });
  return cv;
}
