// 動畫預設集：進場、出場、循環、文字動畫、特效動畫、3D
import { P, setKey, rawAt, EASE_O, EASE_I, LINEAR_O, LINEAR_I } from './anim.js';
import { clone } from './util.js';
import { textAnimator, makeEffect } from './model.js';
import { effectDef } from './render.js';
import { S } from './state.js';

export const PRESET_CATS = ['in', 'out', 'loop', 'text', 'fx', '3d'];
const EASE = { eo: EASE_O, ei: EASE_I };
const OVER = { eo: [0.34, 0], ei: [0.64, 1] };

// 在 prop 上打一串關鍵影格：[[時間, 值, 選項], ...]（時間是圖層時間）
function keys(p, list) {
  for (const [tt, v, o] of list) { const k = setKey(p, tt, clone(v)); Object.assign(k, { ti: 'bezier', eo: [...EASE_O], ei: [...EASE_I] }, o ? clone(o) : {}); }
}
const cur = (p, tt) => clone(rawAt(p, tt));
const addFx = (l, id, vals) => { const def = effectDef(id); if (!def) return null; const e = makeEffect(def, l, S.project); for (const [k, v] of Object.entries(vals || {})) if (e.params[k]) e.params[k] = typeof v === 'object' && v && 'v' in v ? v : P(v); l.effects.push(e); return e; };
const expr = (p, x) => { p.x = x; p.xon = true; };
const textOnly = l => l.type === 'text';

function slide(dx, dy, inOut) {
  return (l, c, t0, t1) => {
    const p = l.transform.position;
    if (inOut === 'in') { const v = cur(p, t0 + 0.8); keys(p, [[t0, [v[0] + dx * c.w, v[1] + dy * c.h, v[2] || 0]], [t0 + 0.8, v]]); keys(l.transform.opacity, [[t0, 0], [t0 + 0.3, cur(l.transform.opacity, t0 + 0.3) || 100]]); }
    else { const v = cur(p, t1 - 0.8); keys(p, [[t1 - 0.8, v], [t1, [v[0] + dx * c.w, v[1] + dy * c.h, v[2] || 0]]]); }
  };
}
// 逐字視窗：rampUp 形狀的選取視窗從左往右掃過
function sweepAnimator(l, t0, dur, props, o = {}) {
  const an = textAnimator({ name: o.name || 'Animator', props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, P(v)])), start: 0, end: o.win ?? 30, shape: o.shape || 'rampUp', basedOn: o.basedOn || 'chars', randomize: o.randomize });
  keys(an.range.offset, [[t0, -(o.win ?? 30)], [t0 + dur, 100]].map(x => [...x, { eo: [...LINEAR_O], ei: [...LINEAR_I], ti: 'linear' }]));
  l.text.animators.push(an);
  return an;
}

export const PRESETS = [
  // ---- 進場 ----
  { id: 'fadeIn', cat: 'in', apply(l, c, t0) { const o = l.transform.opacity; keys(o, [[t0, 0], [t0 + 0.6, cur(o, t0 + 0.6) || 100]]); } },
  { id: 'slideInLeft', cat: 'in', apply: slide(-0.6, 0, 'in') },
  { id: 'slideInRight', cat: 'in', apply: slide(0.6, 0, 'in') },
  { id: 'slideInUp', cat: 'in', apply: slide(0, 0.5, 'in') },
  { id: 'slideInDown', cat: 'in', apply: slide(0, -0.5, 'in') },
  { id: 'popIn', cat: 'in', apply(l, c, t0) { const s = l.transform.scale, v = cur(s, t0 + 0.5); keys(s, [[t0, [0, 0, 100]], [t0 + 0.35, v.map(x => x * 1.12)], [t0 + 0.55, v]]); keys(l.transform.opacity, [[t0, 0], [t0 + 0.15, 100]]); } },
  { id: 'zoomIn', cat: 'in', apply(l, c, t0) { const s = l.transform.scale, v = cur(s, t0 + 0.7); keys(s, [[t0, v.map(x => x * 3)], [t0 + 0.7, v]]); keys(l.transform.opacity, [[t0, 0], [t0 + 0.4, 100]]); } },
  { id: 'spinIn', cat: 'in', apply(l, c, t0) { const r = l.transform.rotation, v = cur(r, t0 + 0.8); keys(r, [[t0, v - 180], [t0 + 0.8, v]]); const s = l.transform.scale, sv = cur(s, t0 + 0.8); keys(s, [[t0, [0, 0, 100]], [t0 + 0.8, sv]]); } },
  { id: 'dropBounce', cat: 'in', apply(l, c, t0) {
    const p = l.transform.position, v = cur(p, t0 + 1.2), up = [v[0], v[1] - c.h * 0.7, v[2] || 0], b = (k, y) => [t0 + k, [v[0], v[1] - y, v[2] || 0], { eo: [0.5, 0], ei: [0.5, 1] }];
    keys(p, [[t0, up, { eo: [0.6, 0], ei: [1, 1] }], [t0 + 0.45, v, { eo: [0, 0], ei: [1, 1] }], b(0.65, c.h * 0.08), [t0 + 0.85, v, { eo: [0, 0], ei: [1, 1] }], b(0.97, c.h * 0.025), [t0 + 1.1, v]]);
  } },
  { id: 'blurIn', cat: 'in', apply(l, c, t0) { const e = addFx(l, 'gaussianBlur', { blurriness: 0 }); if (e) keys(e.params.blurriness, [[t0, 60], [t0 + 0.7, 0]]); keys(l.transform.opacity, [[t0, 0], [t0 + 0.5, 100]]); } },
  { id: 'wipeIn', cat: 'in', apply(l, c, t0) { const e = addFx(l, 'linearWipe', {}); if (e) { const k = Object.keys(e.params).find(x => /complet/i.test(x)); if (k) keys(e.params[k], [[t0, 100], [t0 + 0.8, 0]]); } } },
  { id: 'flipIn3D', cat: 'in', apply(l, c, t0) { l.threeD = true; keys(l.transform.rotY, [[t0, -90], [t0 + 0.8, 0, OVER]]); keys(l.transform.opacity, [[t0, 0], [t0 + 0.2, 100]]); } },
  { id: 'revealUp', cat: 'in', apply(l, c, t0) { const p = l.transform.position, v = cur(p, t0 + 0.7); keys(p, [[t0, [v[0], v[1] + 80, v[2] || 0]], [t0 + 0.7, v]]); keys(l.transform.opacity, [[t0, 0], [t0 + 0.7, 100]]); } },
  // ---- 出場 ----
  { id: 'fadeOut', cat: 'out', apply(l, c, t0, t1) { const o = l.transform.opacity; keys(o, [[t1 - 0.6, cur(o, t1 - 0.6) || 100], [t1, 0]]); } },
  { id: 'slideOutLeft', cat: 'out', apply: slide(-0.7, 0, 'out') },
  { id: 'slideOutRight', cat: 'out', apply: slide(0.7, 0, 'out') },
  { id: 'popOut', cat: 'out', apply(l, c, t0, t1) { const s = l.transform.scale, v = cur(s, t1 - 0.45); keys(s, [[t1 - 0.45, v], [t1 - 0.25, v.map(x => x * 1.12)], [t1, [0, 0, 100]]]); } },
  { id: 'zoomOut', cat: 'out', apply(l, c, t0, t1) { const s = l.transform.scale, v = cur(s, t1 - 0.6); keys(s, [[t1 - 0.6, v], [t1, v.map(x => x * 2.5)]]); keys(l.transform.opacity, [[t1 - 0.4, 100], [t1, 0]]); } },
  { id: 'blurOut', cat: 'out', apply(l, c, t0, t1) { const e = addFx(l, 'gaussianBlur', { blurriness: 0 }); if (e) keys(e.params.blurriness, [[t1 - 0.7, 0], [t1, 60]]); keys(l.transform.opacity, [[t1 - 0.5, 100], [t1, 0]]); } },
  { id: 'spinOut', cat: 'out', apply(l, c, t0, t1) { const r = l.transform.rotation, v = cur(r, t1 - 0.8); keys(r, [[t1 - 0.8, v], [t1, v + 180]]); const s = l.transform.scale, sv = cur(s, t1 - 0.8); keys(s, [[t1 - 0.8, sv], [t1, [0, 0, 100]]]); } },
  // ---- 循環（表達式）----
  { id: 'wiggle', cat: 'loop', apply(l) { expr(l.transform.position, 'wiggle(2, 30)'); } },
  { id: 'shake', cat: 'loop', apply(l) { expr(l.transform.position, 'wiggle(18, 12)'); } },
  { id: 'spin', cat: 'loop', apply(l) { expr(l.transform.rotation, 'value + time * 90'); } },
  { id: 'pulse', cat: 'loop', apply(l) { expr(l.transform.scale, 'var s = 1 + Math.sin(time * Math.PI * 2) * 0.06;\nmul(value, s)'); } },
  { id: 'float', cat: 'loop', apply(l) { expr(l.transform.position, 'add(value, [0, Math.sin(time * 2) * 20, 0])'); } },
  { id: 'swing', cat: 'loop', apply(l) { expr(l.transform.rotation, 'value + Math.sin(time * 3) * 12'); } },
  { id: 'blink', cat: 'loop', apply(l) { expr(l.transform.opacity, 'Math.floor(time * 4) % 2 ? 100 : 20'); } },
  { id: 'loopKeys', cat: 'loop', apply(l) { for (const k of ['position', 'scale', 'rotation', 'opacity']) { const p = l.transform[k]; if (p.k && p.k.length > 1) expr(p, "loopOut('cycle')"); } } },
  // ---- 文字 ----
  { id: 'typewriter', cat: 'text', test: textOnly, apply(l, c, t0) { const an = textAnimator({ name: 'Typewriter', props: { opacity: P(0) }, start: 0, end: 100 }); keys(an.range.start, [[t0, 0, { ti: 'linear' }], [t0 + Math.max(1, String(l.text.text.v).length * 0.06), 100, { ti: 'linear' }]]); l.text.animators.push(an); } },
  { id: 'fadeByChar', cat: 'text', test: textOnly, apply(l, c, t0) { sweepAnimator(l, t0, 1.4, { opacity: 0 }, { name: 'Fade' }); } },
  { id: 'popByChar', cat: 'text', test: textOnly, apply(l, c, t0) { sweepAnimator(l, t0, 1.2, { scale: [0, 0], opacity: 0 }, { name: 'Pop', win: 20 }); } },
  { id: 'dropByChar', cat: 'text', test: textOnly, apply(l, c, t0) { sweepAnimator(l, t0, 1.2, { position: [0, -160], opacity: 0, rotation: -25 }, { name: 'Drop', win: 25 }); } },
  { id: 'riseByWord', cat: 'text', test: textOnly, apply(l, c, t0) { sweepAnimator(l, t0, 1.2, { position: [0, 60], opacity: 0, blur: 12 }, { name: 'Rise', basedOn: 'words', win: 40 }); } },
  { id: 'blurByChar', cat: 'text', test: textOnly, apply(l, c, t0) { sweepAnimator(l, t0, 1.4, { blur: 30, opacity: 0, scale: [160, 160] }, { name: 'Blur', win: 40 }); } },
  { id: 'randomFade', cat: 'text', test: textOnly, apply(l, c, t0) { const an = textAnimator({ name: 'Random', props: { opacity: P(0) }, start: 0, end: 100, randomize: true }); keys(an.range.start, [[t0, 0], [t0 + 1.4, 100]]); l.text.animators.push(an); } },
  { id: 'trackingIn', cat: 'text', test: textOnly, apply(l, c, t0) { const an = textAnimator({ name: 'Tracking', props: { tracking: P(0), opacity: P(100) }, start: 0, end: 100 }); keys(an.props.tracking, [[t0, 600], [t0 + 1.2, 0]]); keys(an.props.opacity, [[t0, 0], [t0 + 0.6, 100]]); l.text.animators.push(an); } },
  { id: 'colorSweep', cat: 'text', test: textOnly, apply(l, c, t0) { const an = textAnimator({ name: 'Color', props: { fill: P([1, 0.78, 0.2, 1]) }, start: 0, end: 25, shape: 'smooth' }); expr(an.range.offset, '(time * 70) % 150 - 25'); l.text.animators.push(an); } },
  { id: 'wave', cat: 'text', test: textOnly, apply(l) { const an = textAnimator({ name: 'Wave', props: { position: P([0, -45]) }, start: 0, end: 30, shape: 'smooth' }); expr(an.range.offset, '(time * 80) % 160 - 30'); l.text.animators.push(an); } },
  { id: 'glitchText', cat: 'text', test: textOnly, apply(l) { const an = textAnimator({ name: 'Glitch', props: { position: P([30, 0]), opacity: P(40) }, start: 0, end: 15, randomize: true }); expr(an.range.offset, 'Math.floor(random() * 100)'); expr(an.props.position, '[random(-40, 40), random(-10, 10)]'); l.text.animators.push(an); } },
  // ---- 特效動畫 ----
  { id: 'glowPulse', cat: 'fx', apply(l) { const e = addFx(l, 'glow', {}); if (e) { const k = Object.keys(e.params).find(x => /intens/i.test(x)); if (k) expr(e.params[k], 'value * (1 + Math.sin(time * 4) * 0.5)'); } } },
  { id: 'colorCycle', cat: 'fx', apply(l) { const e = addFx(l, 'hueSaturation', {}); if (e) { const k = Object.keys(e.params).find(x => /hue/i.test(x)); if (k) expr(e.params[k], 'time * 120'); } } },
  { id: 'glitchHit', cat: 'fx', apply(l, c, t0) { const e = addFx(l, 'glitch', {}); if (e) { const k = Object.keys(e.params).find(x => /amount/i.test(x)); if (k) keys(e.params[k], [[t0, 0, { ti: 'hold' }], [t0 + 0.1, rawAt(e.params[k], 0) || 50, { ti: 'hold' }], [t0 + 0.5, 0, { ti: 'hold' }]]); } } },
  { id: 'rgbSplitShake', cat: 'fx', apply(l) { const e = addFx(l, 'rgbSplit', {}) || addFx(l, 'chromaticAberration', {}); if (e) { const k = Object.keys(e.params).find(x => /amount/i.test(x)); if (k) expr(e.params[k], 'Math.abs(wiggle(6, value))'); } } },
  { id: 'flashWhite', cat: 'fx', apply(l, c, t0) { const e = addFx(l, 'fill', {}) || addFx(l, 'fillColor', {}); if (e) { const k = Object.keys(e.params).find(x => /opac/i.test(x)); if (k) keys(e.params[k], [[t0, 100], [t0 + 0.4, 0]]); } } },
  { id: 'noiseBg', cat: 'fx', apply(l) { addFx(l, 'fractalNoise', {}); } },
  // ---- 3D ----
  { id: 'spin3D', cat: '3d', apply(l) { l.threeD = true; expr(l.transform.rotY, 'value + time * 90'); } },
  { id: 'tiltIn3D', cat: '3d', apply(l, c, t0) { l.threeD = true; keys(l.transform.rotX, [[t0, 75], [t0 + 0.9, 0, OVER]]); keys(l.transform.opacity, [[t0, 0], [t0 + 0.3, 100]]); } },
  { id: 'cardFlip3D', cat: '3d', apply(l, c, t0) { l.threeD = true; keys(l.transform.rotY, [[t0, 0], [t0 + 1, 180]]); } },
  { id: 'swing3D', cat: '3d', apply(l) { l.threeD = true; expr(l.transform.rotY, 'value + Math.sin(time * 2) * 25'); expr(l.transform.rotX, 'value + Math.cos(time * 1.6) * 10'); } },
];

export function applyPreset(id, l, c, compTime) {
  const pr = PRESETS.find(p => p.id === id);
  if (!pr) return false;
  if (pr.test && !pr.test(l)) return false;
  const t0 = Math.max(l.in, Math.min(compTime, l.out - 0.1)) - l.start;
  const t1 = l.out - l.start - 1 / c.fps;
  pr.apply(l, c, t0, t1);
  return true;
}
