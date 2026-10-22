// 圖層屬性樹：時間軸展開、屬性面板、效果控制共用
import { t } from './i18n.js';
import { effectDef } from './render.js';

// type：num / vec2 / vec3 / scale / angle / pct / color / text / path / select / bool
const N = (path, prop, label, type, extra) => prop ? ({ path, prop, label, type, ...extra }) : null;
const G = (id, label, children, extra) => ({ group: true, path: id, label, children: children.filter(Boolean), ...extra });

export function transformNodes(l) {
  const tr = l.transform, p = 'transform.';
  const td = l.threeD;
  if (l.type === 'camera') return [
    l.camera.twoNode ? N(p + 'position', tr.position, t('pPosition'), 'vec3') : null,
    N('camera.poi', l.camera.poi, t('pPoi'), 'vec3'),
    !l.camera.twoNode ? N(p + 'position', tr.position, t('pPosition'), 'vec3') : null,
    tr.orient ? N(p + 'orient', tr.orient, t('pOrient'), 'vec3') : null,
    N(p + 'rotX', tr.rotX, t('pRotX'), 'angle'), N(p + 'rotY', tr.rotY, t('pRotY'), 'angle'), N(p + 'rotation', tr.rotation, t('pRotZ'), 'angle'),
  ];
  if (l.type === 'light') return [N(p + 'position', tr.position, t('pPosition'), 'vec3'), N('light.poi', l.light.poi, t('pPoi'), 'vec3')];
  return [
    N(p + 'anchor', tr.anchor, t('pAnchor'), td ? 'vec3' : 'vec2', { short: 'A' }),
    N(p + 'position', tr.position, t('pPosition'), td ? 'vec3' : 'vec2', { short: 'P' }),
    N(p + 'scale', tr.scale, t('pScale'), td ? 'scale3' : 'scale', { short: 'S' }),
    td && tr.orient ? N(p + 'orient', tr.orient, t('pOrient'), 'vec3', { short: 'R' }) : null,   // 方向（從 AE 匯入的圖層才有）
    td ? N(p + 'rotX', tr.rotX, t('pRotX'), 'angle', { short: 'R' }) : null,
    td ? N(p + 'rotY', tr.rotY, t('pRotY'), 'angle', { short: 'R' }) : null,
    N(p + 'rotation', tr.rotation, td ? t('pRotZ') : t('pRotation'), 'angle', { short: 'R' }),
    N(p + 'opacity', tr.opacity, t('pOpacity'), 'pct', { short: 'T', min: 0, max: 100 }),
  ];
}

export function effectParamNodes(l, e) {
  const def = effectDef(e.type);
  if (!def) return [];
  return def.params.map(pd => N(`effects.${e.id}.params.${pd.id}`, e.params[pd.id], t(`fxp.${e.type}.${pd.id}`), ptype(pd.type), { def: pd, min: pd.min, max: pd.max, step: pd.step, options: pd.options, fx: e.type, pid: pd.id }));
}
const ptype = x => ({ number: 'num', angle: 'angle', percent: 'pct', point: 'vec2', color: 'color', bool: 'bool', select: 'select', layer: 'layerRef' }[x] || 'num');

function shapeItemNodes(it) {
  const b = `shapes.${it.id}.`;
  const kids = [];
  if (it.kind === 'rect') kids.push(N(b + 'size', it.size, t('pSize'), 'vec2'), N(b + 'round', it.round, t('pRoundness'), 'num', { min: 0 }));
  if (it.kind === 'ellipse') kids.push(N(b + 'size', it.size, t('pSize'), 'vec2'));
  if (it.kind === 'star' || it.kind === 'polygon') kids.push(N(b + 'points', it.points, t('pPoints'), 'num', { min: 3, max: 100, step: 1 }), N(b + 'outerR', it.outerR, t('pOuterR'), 'num', { min: 0 }));
  if (it.kind === 'star') kids.push(N(b + 'innerR', it.innerR, t('pInnerR'), 'num', { min: 0 }));
  if (it.kind === 'path') kids.push(N(b + 'path', it.path, t('pPath'), 'path'));
  kids.push(N(b + 'pos', it.pos, t('pPosition'), 'vec2'), N(b + 'scl', it.scl, t('pScale'), 'scale'), N(b + 'rot', it.rot, t('pRotation'), 'angle'));
  if (it.fill.on) kids.push(G(b + 'fill', t('pFill'), [N(b + 'fill.color', it.fill.color, t('pColor'), 'color'), it.fill.type !== 'solid' ? N(b + 'fill.color2', it.fill.color2, t('pColor2'), 'color') : null,
    it.fill.type !== 'solid' ? N(b + 'fill.gStart', it.fill.gStart, t('pGStart'), 'vec2') : null, it.fill.type !== 'solid' ? N(b + 'fill.gEnd', it.fill.gEnd, t('pGEnd'), 'vec2') : null,
    N(b + 'fill.opacity', it.fill.opacity, t('pOpacity'), 'pct', { min: 0, max: 100 })]));
  if (it.stroke.on) kids.push(G(b + 'stroke', t('pStroke'), [N(b + 'stroke.color', it.stroke.color, t('pColor'), 'color'), N(b + 'stroke.width', it.stroke.width, t('pStrokeW'), 'num', { min: 0 }),
    N(b + 'stroke.opacity', it.stroke.opacity, t('pOpacity'), 'pct', { min: 0, max: 100 }), N(b + 'stroke.dash', it.stroke.dash, t('pDash'), 'num', { min: 0 }), N(b + 'stroke.gap', it.stroke.gap, t('pGap'), 'num', { min: 0 })]));
  if (it.trim.on) kids.push(G(b + 'trim', t('pTrim'), [N(b + 'trim.start', it.trim.start, t('pStart'), 'pct', { min: 0, max: 100 }), N(b + 'trim.end', it.trim.end, t('pEnd'), 'pct', { min: 0, max: 100 }), N(b + 'trim.offset', it.trim.offset, t('pOffset'), 'angle')]));
  if (it.repeater.on) kids.push(G(b + 'repeater', t('pRepeater'), [N(b + 'repeater.copies', it.repeater.copies, t('pCopies'), 'num', { min: 1, max: 200, step: 1 }), N(b + 'repeater.offset', it.repeater.offset, t('pPosition'), 'vec2'),
    N(b + 'repeater.rot', it.repeater.rot, t('pRotation'), 'angle'), N(b + 'repeater.scale', it.repeater.scale, t('pScale'), 'scale'), N(b + 'repeater.startOp', it.repeater.startOp, t('pStartOp'), 'pct'), N(b + 'repeater.endOp', it.repeater.endOp, t('pEndOp'), 'pct')]));
  if (it.zigzag.on) kids.push(G(b + 'zigzag', t('pZigzag'), [N(b + 'zigzag.size', it.zigzag.size, t('pSize'), 'num'), N(b + 'zigzag.ridges', it.zigzag.ridges, t('pRidges'), 'num', { min: 0, step: 1 })]));
  if (it.wiggle.on) kids.push(G(b + 'wiggle', t('pWigglePath'), [N(b + 'wiggle.size', it.wiggle.size, t('pSize'), 'num'), N(b + 'wiggle.detail', it.wiggle.detail, t('pDetail'), 'num', { min: 1, step: 1 }), N(b + 'wiggle.speed', it.wiggle.speed, t('pSpeed'), 'num')]));
  return G(b.slice(0, -1), it.name, kids, { item: it, kind: 'shapeItem' });
}

function animatorNodes(an) {
  const b = `text.animators.${an.id}.`;
  const kids = [G(b + 'range', t('pRange'), [N(b + 'range.start', an.range.start, t('pStart'), 'pct'), N(b + 'range.end', an.range.end, t('pEnd'), 'pct'), N(b + 'range.offset', an.range.offset, t('pOffset'), 'pct', { min: -100, max: 100 }), N(b + 'range.amount', an.range.amount, t('pAmount'), 'pct')])];
  const types = { opacity: 'pct', position: 'vec2', scale: 'scale', rotation: 'angle', fill: 'color', stroke: 'color', blur: 'num', tracking: 'num' };
  for (const [k, p] of Object.entries(an.props)) kids.push(N(b + 'props.' + k, p, t('ta_' + k), types[k] || 'num'));
  return G(b.slice(0, -1), an.name, kids, { kind: 'animator', item: an });
}

// 完整屬性樹
export function layerTree(l) {
  const out = [];
  if (l.type === 'text') out.push(G('text', t('grpText'), [N('text.text', l.text.text, t('pSourceText'), 'text'), ...(l.text.animators || []).map(animatorNodes)], { kind: 'textGroup' }));
  if (l.type === 'shape') out.push(G('shapes', t('grpContents'), (l.shapes || []).map(shapeItemNodes), { kind: 'contents' }));
  if (l.masks.length) out.push(G('masks', t('grpMasks'), l.masks.map(m => G('masks.' + m.id, m.name, [N(`masks.${m.id}.path`, m.path, t('pMaskPath'), 'path'), N(`masks.${m.id}.feather`, m.feather, t('pFeather'), 'num', { min: 0 }),
    N(`masks.${m.id}.opacity`, m.opacity, t('pOpacity'), 'pct'), N(`masks.${m.id}.expansion`, m.expansion, t('pExpansion'), 'num')], { kind: 'mask', item: m })), { short: 'M' }));
  if (l.effects.length) out.push(G('effects', t('grpEffects'), l.effects.map(e => G('effects.' + e.id, e.name || t('fx.' + e.type), effectParamNodes(l, e), { kind: 'effect', item: e })), { short: 'E' }));
  if (l.type === 'solid') out.push(G('solid', t('grpSolid'), [N('solid.color', l.solid.color, t('pColor'), 'color')]));
  if (l.type === 'libbg') out.push(G('lib', t('grpLibBg'), [N('lib.accent', l.lib.accent, t('pAccent'), 'color')]));
  if (l.type === 'camera') out.push(G('camera', t('grpCamera'), [N('camera.zoom', l.camera.zoom, t('pZoom'), 'num', { min: 1 })]));
  if (l.type === 'light') out.push(G('light', t('grpLight'), [N('light.intensity', l.light.intensity, t('pIntensity'), 'pct', { min: 0, max: 400 }), N('light.color', l.light.color, t('pColor'), 'color'), l.light.kind === 'spot' ? N('light.cone', l.light.cone, t('pCone'), 'angle') : null]));
  if (l.timeRemap?.on) out.push(G('timeRemap', t('grpTimeRemap'), [N('timeRemap.p', l.timeRemap.p, t('pTimeRemap'), 'num', { unit: 's' })]));
  if (l.type !== 'audio') out.push(G('transform', t('grpTransform'), transformNodes(l), { short: 'TR' }));
  if (l.audio) out.push(G('audio', t('grpAudio'), [N('audio.level', l.audio.level, t('pLevel'), 'num', { min: -48, max: 12, unit: 'dB' })], { short: 'L' }));
  return out;
}

// 走訪所有屬性節點（展開後）
export function flatProps(nodes, out = []) {
  for (const n of nodes) { if (n.group) flatProps(n.children, out); else out.push(n); }
  return out;
}

// 顯示數值
export function fmt(type, v, unit = '') {
  const f = x => (Math.abs(x) >= 1000 ? x.toFixed(0) : Math.abs(x) >= 100 ? x.toFixed(1) : x.toFixed(2)).replace(/\.?0+$/, '') || '0';
  if (v == null) return '';
  if (type === 'pct') return f(v) + '%';
  if (type === 'angle') { const turns = Math.trunc(v / 360); return `${turns}x${f(v - turns * 360)}°`; }
  if (type === 'scale' || type === 'scale3') return v.slice(0, type === 'scale' ? 2 : 3).map(x => f(x) + '%').join(', ');
  if (Array.isArray(v) && type !== 'color') return v.slice(0, type === 'vec3' ? 3 : 2).map(f).join(', ');
  if (typeof v === 'number') return f(v) + (unit ? ' ' + unit : '');
  return String(v);
}
