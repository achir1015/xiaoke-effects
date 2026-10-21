// 合成檢視器：顯示畫面、選取與變形手把、遮罩／鋼筆／形狀／文字工具、鏡頭環繞、平移縮放
import { S, bus, comp, edit, changed, history, selLayers, firstSel, select, getPath } from './state.js';
import { renderComp, projector, layerBounds, layerWorld, localTime, layerActive, activeCamera } from './render.js';
import { rawAt, setValue, animated, setKey } from './anim.js';
import { M4, clamp, h, css } from './util.js';
import * as M from './model.js';
import { exec, addLayer } from './actions.js';
import { t } from './i18n.js';
import { toast } from './ui.js';
import { tracePath } from './shapes.js';
import { pauseVideos } from './media.js';

const wrap = document.getElementById('viewWrap');
const cv = document.getElementById('viewCanvas');
const ov = document.getElementById('overlay');
let view = { z: 1, x: 0, y: 0 };   // 畫面座標 = view.x + comp 座標 * view.z
let renderMs = 0, lastRes = 1;
export const getRenderMs = () => renderMs;
export const getRes = () => lastRes;

export function fit() {
  const c = comp(); if (!c) return;
  const r = wrap.getBoundingClientRect();
  const pad = r.width < 500 ? 4 : 28;
  const z = Math.min((r.width - pad * 2) / c.w, (r.height - pad * 2) / c.h);
  view = { z: Math.max(0.02, z), x: (r.width - c.w * z) / 2, y: (r.height - c.h * z) / 2 };
}
function applyZoomSetting() {
  const c = comp(); if (!c) return;
  if (S.zoom === 'fit') { fit(); return; }
  const r = wrap.getBoundingClientRect(), z = +S.zoom;
  const cx = (r.width / 2 - view.x) / view.z, cy = (r.height / 2 - view.y) / view.z;
  view = { z, x: r.width / 2 - cx * z, y: r.height / 2 - cy * z };
}
export const viewZoom = () => view.z;

function resolution() {
  const c = comp();
  if (S.res !== 'auto') return +S.res;
  const dpr = devicePixelRatio || 1;
  const need = view.z * dpr;
  let r = need >= 0.75 ? 1 : need >= 0.4 ? 0.5 : need >= 0.28 ? 1 / 3 : 0.25;
  if (S.playing && renderMs > 1000 / (c?.fps || 30) * 1.2) r = Math.min(r, 0.5);
  return r;
}

// ---- 畫面快取（播放時）----
const cache = new Map(); let cacheBytes = 0, cacheGen = 0;
export function clearCache() { for (const b of cache.values()) b.close?.(); cache.clear(); cacheBytes = 0; cacheGen++; bus.emit('cache'); }
export const cacheInfo = () => ({ n: cache.size });
bus.on('change', clearCache);

export function draw() {
  const c = comp();
  const r = wrap.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  if (ov.width !== Math.round(r.width * dpr) || ov.height !== Math.round(r.height * dpr)) { ov.width = Math.round(r.width * dpr); ov.height = Math.round(r.height * dpr); }
  if (!c) { cv.style.display = 'none'; drawOverlay(); return; }
  cv.style.display = '';
  if (S.zoom === 'fit') fit();
  const res = resolution(); lastRes = res;
  const frame = Math.round(S.time * c.fps);
  const key = frame + '@' + res;
  const t0 = performance.now();
  const cached = S.playing ? cache.get(key) : null;
  if (cached) {
    if (cv.width !== cached.width || cv.height !== cached.height) { cv.width = cached.width; cv.height = cached.height; }
    const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(cached, 0, 0);
  } else {
    const live = new Set();
    renderComp(S.project, c, S.time, cv, { scale: res, playing: S.playing, transparent: S.transparentGrid, liveVideos: live, motionBlur: true });
    pauseVideos(live);
    renderMs = performance.now() - t0;
    if (S.playing && cacheBytes < 400e6 && window.createImageBitmap) {
      const gen = cacheGen;
      createImageBitmap(cv).then(b => { if (gen !== cacheGen || cache.has(key)) { b.close(); return; } cache.set(key, b); cacheBytes += b.width * b.height * 4; bus.emit('cache'); }).catch(() => { });
    }
  }
  cv.style.width = c.w * view.z + 'px'; cv.style.height = c.h * view.z + 'px';
  cv.style.left = view.x + 'px'; cv.style.top = view.y + 'px';
  wrap.classList.toggle('checker', !!S.transparentGrid);
  drawOverlay();
}

// ---- 疊加：選取框、錨點、遮罩、動態路徑、參考線 ----
const toScreen = p => [view.x + p[0] * view.z, view.y + p[1] * view.z];
const toComp = (x, y) => [(x - view.x) / view.z, (y - view.y) / view.z];
function layerQuad(c, l) {
  const pr = projector(S.project, c, l, S.time);
  const [x, y, w, hh] = layerBounds(S.project, c, l, S.time);
  return { pr, rect: [x, y, w, hh], pts: [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]].map(p => toScreen(pr(p))) };
}
function drawOverlay() {
  const g = ov.getContext('2d'), dpr = devicePixelRatio || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, ov.width, ov.height);
  const c = comp(); if (!c) return;
  // 參考線
  if (S.showGrid) {
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1; g.beginPath();
    const step = c.w / 16;
    for (let x = step; x < c.w; x += step) { const [sx] = toScreen([x, 0]); g.moveTo(sx, view.y); g.lineTo(sx, view.y + c.h * view.z); }
    for (let y = step; y < c.h; y += step) { const [, sy] = toScreen([0, y]); g.moveTo(view.x, sy); g.lineTo(view.x + c.w * view.z, sy); }
    g.stroke();
  }
  if (S.showSafe) {
    g.strokeStyle = 'rgba(120,200,255,.5)'; g.setLineDash([4, 4]);
    for (const k of [0.9, 0.8]) { const [x, y] = toScreen([c.w * (1 - k) / 2, c.h * (1 - k) / 2]); g.strokeRect(x, y, c.w * k * view.z, c.h * k * view.z); }
    const [cx, cy] = toScreen([c.w / 2, c.h / 2]); g.beginPath(); g.moveTo(cx - 10, cy); g.lineTo(cx + 10, cy); g.moveTo(cx, cy - 10); g.lineTo(cx, cy + 10); g.stroke();
    g.setLineDash([]);
  }
  for (const l of selLayers()) {
    if (!layerActive(l, S.time) && l.type !== 'camera') continue;
    try { drawLayerOverlay(g, c, l); } catch (e) { console.warn(e); }
  }
  // 鋼筆繪製中
  if (pen && pen.pts.length) {
    g.strokeStyle = '#ffd24a'; g.lineWidth = 1.5;
    g.beginPath(); tracePath(g, { closed: false, pts: pen.pts.map(p => scrPt(pen, p)) }); g.stroke();
    for (const p of pen.pts) { const [x, y] = scrPt(pen, p); g.fillStyle = '#ffd24a'; g.fillRect(x - 3, y - 3, 6, 6); }
  }
  if (drawRect) { g.strokeStyle = '#ffd24a'; g.setLineDash([4, 3]); g.strokeRect(drawRect.x, drawRect.y, drawRect.w, drawRect.h); g.setLineDash([]); }
}
function scrPt(pen, p) { const q = pen.toComp(p); return toScreen(q); }
function scrPathPts(pr, path) { return { closed: path.closed, pts: path.pts.map(p => { const a = toScreen(pr([p[0], p[1]])), i = toScreen(pr([p[0] + p[2], p[1] + p[3]])), o = toScreen(pr([p[0] + p[4], p[1] + p[5]])); return [a[0], a[1], i[0] - a[0], i[1] - a[1], o[0] - a[0], o[1] - a[1]]; }) }; }

function drawLayerOverlay(g, c, l) {
  const col = l.label || '#2d8ceb';
  if (l.type === 'camera' || l.type === 'light') {
    const pos = rawAt(l.transform.position, S.time - l.start);
    g.fillStyle = col; g.font = '12px system-ui'; g.fillText((l.type === 'camera' ? '🎥 ' : '💡 ') + l.name, 10, 20);
    return;
  }
  const q = layerQuad(c, l);
  g.strokeStyle = col; g.lineWidth = 1;
  g.beginPath(); q.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke();
  // 手把
  if (S.tool === 'select' && !l.locked) {
    for (const p of handlePoints(q)) { g.fillStyle = col; g.fillRect(p.x - 3.5, p.y - 3.5, 7, 7); }
  }
  // 錨點
  const a = rawAt(l.transform.anchor, S.time - l.start);
  const [ax, ay] = toScreen(q.pr([a[0], a[1]]));
  g.strokeStyle = '#fff'; g.lineWidth = 1.2;
  g.beginPath(); g.arc(ax, ay, 5, 0, Math.PI * 2); g.moveTo(ax - 9, ay); g.lineTo(ax + 9, ay); g.moveTo(ax, ay - 9); g.lineTo(ax, ay + 9); g.stroke();
  // 遮罩
  for (const m of l.masks) {
    const path = rawAt(m.path, S.time - l.start);
    const sp = scrPathPts(q.pr, path);
    g.strokeStyle = m.color || '#ffd24a'; g.lineWidth = 1.3; g.beginPath(); tracePath(g, sp); g.stroke();
    if (S.selMask?.maskId === m.id) sp.pts.forEach((p, i) => { g.fillStyle = S.selMask.vi === i ? '#fff' : m.color || '#ffd24a'; g.fillRect(p[0] - 3.5, p[1] - 3.5, 7, 7); });
  }
  // 動態路徑（位置關鍵影格）
  const pk = l.transform.position.k;
  if (pk && pk.length > 1 && !l.parent) {
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.setLineDash([3, 3]); g.beginPath();
    const t0 = pk[0].t, t1 = pk[pk.length - 1].t, n = 60;
    for (let i = 0; i <= n; i++) { const v = rawAt(l.transform.position, t0 + (t1 - t0) * i / n); const [x, y] = toScreen(v); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.setLineDash([]);
    for (const k of pk) { const [x, y] = toScreen(k.v); g.fillStyle = S.selKeys.has(k) ? '#f0c040' : '#fff'; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); }
  }
}
function handlePoints(q) {
  const [a, b, c2, d] = q.pts, mid = (p, r) => [(p[0] + r[0]) / 2, (p[1] + r[1]) / 2];
  return [['tl', a], ['tr', b], ['br', c2], ['bl', d], ['t', mid(a, b)], ['r', mid(b, c2)], ['b', mid(c2, d)], ['l', mid(d, a)]].map(([id, p]) => ({ id, x: p[0], y: p[1] }));
}

// ---- 點選測試 ----
function pointInQuad(p, q) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [xi, yi] = q[i], [xj, yj] = q[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}
function hitLayer(sx, sy) {
  const c = comp(); if (!c) return null;
  for (const l of c.layers) {
    if (!l.visible || l.locked || !layerActive(l, S.time) || ['audio', 'camera', 'light'].includes(l.type)) continue;
    try { if (pointInQuad([sx, sy], layerQuad(c, l).pts)) return l; } catch { }
  }
  return null;
}

// 螢幕位移 → 父層座標位移
function parentDelta(c, l, dx, dy) {
  if (!l.parent) return [dx, dy];
  const par = M.getLayer(c, l.parent); if (!par) return [dx, dy];
  const inv = M4.invert(layerWorld(S.project, c, par, S.time));
  return [inv[0] * dx + inv[4] * dy, inv[1] * dx + inv[5] * dy];
}

// ---- 互動 ----
let drag = null, pen = null, drawRect = null;
const pointers = new Map();
function local(e) { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

wrap.addEventListener('pointerdown', e => {
  wrap.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, local(e));
  if (pointers.size === 2) { startPinch(); return; }
  if (e.button === 1 || S.tool === 'hand' || e.button === 0 && spaceDown) { drag = { kind: 'pan', s: local(e), v: { ...view } }; S.zoom = 'custom'; return; }
  if (e.button !== 0) return;
  const c = comp(); if (!c) return;
  const [sx, sy] = local(e);
  const tool = S.tool;
  if (tool === 'zoom') { zoomAt(sx, sy, e.altKey ? 0.5 : 2); return; }
  if (tool === 'pen') { penDown(c, sx, sy, e); return; }
  if (['rect', 'ellipse', 'star', 'polygon'].includes(tool)) { drag = { kind: 'draw', s: [sx, sy], tool }; drawRect = { x: sx, y: sy, w: 0, h: 0 }; return; }
  if (tool === 'text') { const l = hitLayer(sx, sy); if (l?.type === 'text') { select(l.id); editText(l); } else newTextAt(c, toComp(sx, sy)); return; }
  if (tool === 'orbit') { orbitStart(c, sx, sy, e); return; }
  // 選取工具：先看手把、遮罩頂點
  const cur = selLayers();
  for (const l of cur) {
    if (l.locked || !layerActive(l, S.time) || ['camera', 'light', 'audio'].includes(l.type)) continue;
    const q = layerQuad(c, l);
    // 遮罩頂點
    for (const m of l.masks) {
      const sp = scrPathPts(q.pr, rawAt(m.path, S.time - l.start));
      const vi = sp.pts.findIndex(p => Math.hypot(p[0] - sx, p[1] - sy) < 7);
      if (vi >= 0) { S.selMask = { layerId: l.id, maskId: m.id, vi }; history.checkpoint('mask'); drag = { kind: 'maskPt', l, m, vi, s: [sx, sy], q, path0: JSON.parse(JSON.stringify(rawAt(m.path, S.time - l.start))) }; draw(); return; }
    }
    if (tool === 'select' || tool === 'rotate' || tool === 'anchor') {
      const hp = tool === 'select' ? handlePoints(q).find(p => Math.hypot(p.x - sx, p.y - sy) < 8) : null;
      if (hp) { beginTransform('scale', c, l, sx, sy, hp.id, q); return; }
      if (tool === 'select' && !pointInQuad([sx, sy], q.pts)) {
        // 外框附近 → 旋轉
        const near = q.pts.some(p => Math.hypot(p[0] - sx, p[1] - sy) < 22);
        if (near) { beginTransform('rotate', c, l, sx, sy, null, q); return; }
      }
    }
  }
  const hit = hitLayer(sx, sy);
  if (tool === 'rotate') { if (hit && !S.sel.has(hit.id)) select(hit.id); if (firstSel()) beginTransform('rotate', c, firstSel(), sx, sy, null, layerQuad(c, firstSel())); return; }
  if (tool === 'anchor') { if (hit && !S.sel.has(hit.id)) select(hit.id); if (firstSel()) beginTransform('anchor', c, firstSel(), sx, sy, null, layerQuad(c, firstSel())); return; }
  if (!hit) { if (!e.shiftKey) select([]); S.selMask = null; draw(); return; }
  if (e.shiftKey) select(hit.id, true); else if (!S.sel.has(hit.id)) select(hit.id);
  if (S.sel.has(hit.id)) beginTransform('move', c, hit, sx, sy, null, null);
});

function beginTransform(kind, c, l, sx, sy, handle, q) {
  history.checkpoint(kind);
  const ls = kind === 'move' ? selLayers().filter(x => !x.locked) : [l];
  drag = {
    kind, s: [sx, sy], handle, q, l, moved: false,
    start: ls.map(x => ({ l: x, p: rawAt(x.transform.position, S.time - x.start), s: rawAt(x.transform.scale, S.time - x.start), r: rawAt(x.transform.rotation, S.time - x.start), a: rawAt(x.transform.anchor, S.time - x.start) })),
  };
  if (kind === 'rotate' || kind === 'scale') {
    const st = drag.start[0];
    const pr = projector(S.project, c, l, S.time);
    drag.center = toScreen(pr([st.a[0], st.a[1]]));
  }
}

wrap.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, local(e));
  if (pinch && pointers.size >= 2) { movePinch(); return; }
  const [sx, sy] = local(e);
  if (!drag) { hoverCursor(sx, sy); if (pen) { pen.hover = [sx, sy]; } return; }
  const c = comp();
  const dx = sx - drag.s[0], dy = sy - drag.s[1];
  if (drag.kind === 'pan') { view.x = drag.v.x + dx; view.y = drag.v.y + dy; draw(); return; }
  if (drag.kind === 'draw') { drawRect = { x: Math.min(sx, drag.s[0]), y: Math.min(sy, drag.s[1]), w: Math.abs(dx), h: Math.abs(dy) }; if (e.shiftKey) { const m = Math.max(drawRect.w, drawRect.h); drawRect.w = drawRect.h = m; if (sx < drag.s[0]) drawRect.x = drag.s[0] - m; if (sy < drag.s[1]) drawRect.y = drag.s[1] - m; } drawOverlay(); return; }
  if (drag.kind === 'pen') { penDrag(sx, sy); return; }
  if (drag.kind === 'orbit') { orbitMove(c, sx, sy, e); return; }
  if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
  if (!drag.moved) return;
  const lt = l => S.time - l.start;
  if (drag.kind === 'maskPt') {
    const { l, m, vi, q, path0 } = drag;
    const inv = invProjector(c, l);
    const p0 = inv(drag.s), p1 = inv([sx, sy]);
    const path = JSON.parse(JSON.stringify(path0));
    path.pts[vi][0] += p1[0] - p0[0]; path.pts[vi][1] += p1[1] - p0[1];
    setValue(m.path, lt(l), path);
    changed('drag'); return;
  }
  if (drag.kind === 'move') {
    let ddx = dx / view.z, ddy = dy / view.z;
    if (e.shiftKey) { if (Math.abs(ddx) > Math.abs(ddy)) ddy = 0; else ddx = 0; }
    for (const st of drag.start) {
      const [px, py] = parentDelta(c, st.l, ddx, ddy);
      let nx = st.p[0] + px, ny = st.p[1] + py;
      if (S.snapping && !st.l.parent) { const sn = snap(c, nx, ny); nx = sn[0]; ny = sn[1]; }
      setValue(st.l.transform.position, lt(st.l), [nx, ny, st.p[2] || 0]);
    }
    changed('drag'); return;
  }
  const st = drag.start[0], l = st.l;
  if (drag.kind === 'rotate') {
    const a0 = Math.atan2(drag.s[1] - drag.center[1], drag.s[0] - drag.center[0]), a1 = Math.atan2(sy - drag.center[1], sx - drag.center[0]);
    let d = (a1 - a0) * 180 / Math.PI;
    if (e.shiftKey) d = Math.round(d / 45) * 45;
    setValue(l.transform.rotation, lt(l), st.r + d);
    changed('drag'); return;
  }
  if (drag.kind === 'scale') {
    // 以錨點為中心：依手把方向計算縮放比例
    const inv = invProjector(c, l);
    const p0 = inv(drag.s), p1 = inv([sx, sy]);
    const ax = st.a[0], ay = st.a[1];
    const hid = drag.handle;
    let kx = 1, ky = 1;
    const fx = (p0[0] - ax) || 1e-6, fy = (p0[1] - ay) || 1e-6;
    if (hid.includes('l') || hid.includes('r')) kx = (p1[0] - ax) / fx;
    if (hid.includes('t') || hid.includes('b')) ky = (p1[1] - ay) / fy;
    if (hid.length === 2 && (e.shiftKey || l.type === 'text')) { const k = Math.abs(kx) > Math.abs(ky) ? kx : ky; kx = ky = k; }
    if (hid.length === 1) { if (hid === 't' || hid === 'b') kx = 1; else ky = 1; }
    setValue(l.transform.scale, lt(l), [st.s[0] * kx, st.s[1] * ky, st.s[2] ?? 100]);
    changed('drag'); return;
  }
  if (drag.kind === 'anchor') {
    // 移動錨點，同時補償位置，讓畫面不動
    const inv = invProjector(c, l);
    const p0 = inv(drag.s), p1 = inv([sx, sy]);
    const da = [p1[0] - p0[0], p1[1] - p0[1]];
    const na = [st.a[0] + da[0], st.a[1] + da[1], st.a[2] || 0];
    const r = st.r * Math.PI / 180, kx = st.s[0] / 100, ky = st.s[1] / 100;
    const wx = da[0] * kx, wy = da[1] * ky;
    setValue(l.transform.anchor, lt(l), na);
    setValue(l.transform.position, lt(l), [st.p[0] + wx * Math.cos(r) - wy * Math.sin(r), st.p[1] + wx * Math.sin(r) + wy * Math.cos(r), st.p[2] || 0]);
    changed('drag');
  }
});

function invProjector(c, l) {
  // 畫面 → layer 座標（只處理 2D 與 z=0 的投影平面）
  const w = layerWorld(S.project, c, l, S.time);
  const cam = l.threeD ? activeCamera(S.project, c, S.time) : null;
  if (!cam) { const inv = M4.invert(w); return ([sx, sy]) => { const p = toComp(sx, sy); const r = M4.apply(inv, [p[0], p[1], 0]); return [r[0], r[1]]; }; }
  const pr = projector(S.project, c, l, S.time);
  // 數值解：以兩個方向的偏微分近似
  return ([sx, sy]) => {
    const target = toComp(sx, sy); let x = 0, y = 0;
    for (let i = 0; i < 12; i++) {
      const p = pr([x, y]), px = pr([x + 1, y]), py = pr([x, y + 1]);
      const a = px[0] - p[0], b = py[0] - p[0], cc = px[1] - p[1], d = py[1] - p[1], det = a * d - b * cc || 1e-9;
      const ex = target[0] - p[0], ey = target[1] - p[1];
      x += (d * ex - b * ey) / det; y += (-cc * ex + a * ey) / det;
    }
    return [x, y];
  };
}

function snap(c, x, y) {
  const th = 8 / view.z;
  const xs = [0, c.w / 2, c.w], ys = [0, c.h / 2, c.h];
  for (const v of xs) if (Math.abs(x - v) < th) { x = v; break; }
  for (const v of ys) if (Math.abs(y - v) < th) { y = v; break; }
  return [x, y];
}

const end = e => {
  pointers.delete(e.pointerId);
  if (pinch && pointers.size < 2) pinch = null;
  if (!drag) return;
  const d = drag; drag = null;
  if (d.kind === 'draw') { finishDraw(d); drawRect = null; draw(); return; }
  if (d.kind === 'pen') { pen.dragging = false; draw(); return; }
  if (d.kind !== 'pan' && d.moved) changed('dragEnd');
  draw();
};
wrap.addEventListener('pointerup', end);
wrap.addEventListener('pointercancel', end);
wrap.addEventListener('dblclick', e => {
  const [sx, sy] = local(e);
  if (pen) { finishPen(false); return; }
  const l = hitLayer(sx, sy);
  if (l?.type === 'text') { select(l.id); editText(l); }
  else if (l?.type === 'precomp') { import('./state.js').then(m => m.openComp(l.comp)); }
});

function hoverCursor(sx, sy) {
  const c = comp(); let cur = '';
  if (S.tool === 'hand' || spaceDown) cur = 'grab';
  else if (S.tool === 'zoom') cur = 'zoom-in';
  else if (['pen', 'rect', 'ellipse', 'star', 'polygon'].includes(S.tool)) cur = 'crosshair';
  else if (S.tool === 'text') cur = 'text';
  else if (S.tool === 'select' && c) {
    for (const l of selLayers()) {
      if (l.locked || !layerActive(l, S.time) || ['camera', 'light', 'audio'].includes(l.type)) continue;
      const q = layerQuad(c, l);
      const hp = handlePoints(q).find(p => Math.hypot(p.x - sx, p.y - sy) < 8);
      if (hp) { cur = { tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize' }[hp.id]; break; }
      if (!pointInQuad([sx, sy], q.pts) && q.pts.some(p => Math.hypot(p[0] - sx, p[1] - sy) < 22)) { cur = 'alias'; break; }
      if (pointInQuad([sx, sy], q.pts)) cur = 'move';
    }
  }
  wrap.style.cursor = cur;
}

// 滾輪：縮放（Ctrl／觸控板捏合）或平移
wrap.addEventListener('wheel', e => {
  e.preventDefault();
  const [sx, sy] = local(e);
  if (e.ctrlKey || e.metaKey || e.altKey) zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0025));
  else { S.zoom = 'custom'; view.x -= e.deltaX; view.y -= e.deltaY; draw(); }
}, { passive: false });
export function zoomAt(sx, sy, k) {
  const z = clamp(view.z * k, 0.02, 32);
  const cx = (sx - view.x) / view.z, cy = (sy - view.y) / view.z;
  view = { z, x: sx - cx * z, y: sy - cy * z };
  S.zoom = 'custom'; bus.emit('zoomChanged'); draw();
}
export function setZoom(z) { const r = wrap.getBoundingClientRect(); if (z === 'fit') { S.zoom = 'fit'; fit(); } else { S.zoom = String(z); applyZoomSetting(); } bus.emit('zoomChanged'); draw(); }

let pinch = null;
function startPinch() {
  drag = null;
  const [a, b] = [...pointers.values()];
  pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v: { ...view } };
  S.zoom = 'custom';
}
function movePinch() {
  const [a, b] = [...pointers.values()];
  const d = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const z = clamp(pinch.v.z * d / pinch.d, 0.02, 32);
  const cx = (pinch.c[0] - pinch.v.x) / pinch.v.z, cy = (pinch.c[1] - pinch.v.y) / pinch.v.z;
  view = { z, x: c[0] - cx * z, y: c[1] - cy * z };
  draw();
}

let spaceDown = false;
addEventListener('keydown', e => { if (e.code === 'Space' && !e.target.closest?.('input,textarea,select')) { spaceDown = true; } if (pen && e.key === 'Enter') { e.preventDefault(); finishPen(false); } if (pen && e.key === 'Escape') { pen = null; draw(); } });
addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });

// ---- 畫形狀／遮罩 ----
function finishDraw(d) {
  const c = comp(); if (!c || !drawRect || drawRect.w < 4 || drawRect.h < 4) return;
  const p0 = toComp(drawRect.x, drawRect.y), p1 = toComp(drawRect.x + drawRect.w, drawRect.y + drawRect.h);
  const cx = (p0[0] + p1[0]) / 2, cy = (p0[1] + p1[1]) / 2, w = p1[0] - p0[0], hh = p1[1] - p0[1];
  const target = firstSel();
  const kind = d.tool;
  if (target && target.type === 'shape') {
    // 加到選取的形狀圖層
    const inv = invProjector(c, target);
    const a = inv([drawRect.x, drawRect.y]), b = inv([drawRect.x + drawRect.w, drawRect.y + drawRect.h]);
    edit('shape', () => target.shapes.unshift(M.shapeItem(kind, { name: t('shape_' + kind), size: [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])], pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], outerR: Math.min(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / 2, innerR: Math.min(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / 4, color: randColor() })));
    return;
  }
  if (target && (kind === 'rect' || kind === 'ellipse') && !['camera', 'light', 'audio', 'null'].includes(target.type)) {
    // 畫在選取圖層上 → 遮罩
    const inv = invProjector(c, target);
    const a = inv([drawRect.x, drawRect.y]), b = inv([drawRect.x + drawRect.w, drawRect.y + drawRect.h]);
    edit('mask', () => target.masks.push(M.makeMask(kind, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])], { name: t('mask') + ' ' + (target.masks.length + 1) })));
    return;
  }
  const l = M.makeShape(c, { kind, name: t('shapeLayer'), size: [w, hh], outerR: Math.min(w, hh) / 2, innerR: Math.min(w, hh) / 4, color: randColor() });
  l.shapes[0].name = t('shape_' + kind);
  l.transform.position.v = [cx, cy, 0];
  edit('newShape', () => addLayer(c, l));
}
const randColor = () => [[0.27, 0.55, 1, 1], [1, 0.42, 0.36, 1], [0.3, 0.8, 0.55, 1], [1, 0.8, 0.25, 1], [0.7, 0.45, 1, 1]][Math.floor(Math.random() * 5)];

// ---- 鋼筆 ----
function penDown(c, sx, sy, e) {
  if (!pen) {
    const target = firstSel();
    const mode = target?.type === 'shape' ? 'shapeItem' : target && !['camera', 'light', 'audio', 'null'].includes(target.type) ? 'mask' : 'newShape';
    let inv, toC;
    if (mode === 'newShape') { inv = ([x, y]) => toComp(x, y); toC = p => p; }
    else { inv = invProjector(c, target); const pr = projector(S.project, c, target, S.time); toC = p => pr(p); }
    pen = { mode, target, pts: [], inv, toComp: toC };
  }
  const p = pen.inv([sx, sy]);
  // 點第一個點 → 封閉
  if (pen.pts.length > 2) { const f = scrPt(pen, pen.pts[0]); if (Math.hypot(f[0] - sx, f[1] - sy) < 9) { finishPen(true); return; } }
  pen.pts.push([p[0], p[1], 0, 0, 0, 0]);
  pen.dragging = true;
  drag = { kind: 'pen', s: [sx, sy] };
  draw();
}
function penDrag(sx, sy) {
  const last = pen.pts[pen.pts.length - 1];
  const p = pen.inv([sx, sy]);
  const ox = p[0] - last[0], oy = p[1] - last[1];
  last[4] = ox; last[5] = oy; last[2] = -ox; last[3] = -oy;
  drawOverlay();
}
function finishPen(closed) {
  const c = comp(); const P = pen; pen = null;
  if (!c || !P || P.pts.length < 2) { draw(); return; }
  const path = { closed, pts: P.pts };
  if (P.mode === 'mask') edit('mask', () => {
    const m = M.makeMask('rect', [0, 0, 1, 1], { name: t('mask') + ' ' + (P.target.masks.length + 1), pts: path.pts });
    m.path.v.closed = true;   // 遮罩一定是封閉的
    P.target.masks.push(m);
  });
  else if (P.mode === 'shapeItem') edit('shape', () => P.target.shapes.unshift(M.shapeItem('path', { name: t('shape_path'), path, fill: closed, stroke: !closed, color: randColor() })));
  else {
    const l = M.makeShape(c, { kind: 'path', name: t('shapeLayer'), path: { closed, pts: P.pts.map(p => [p[0] - c.w / 2, p[1] - c.h / 2, p[2], p[3], p[4], p[5]]) }, fill: closed, stroke: !closed, color: randColor() });
    l.shapes[0].name = t('shape_path');
    edit('newShape', () => addLayer(c, l));
  }
  draw();
}

// ---- 文字 ----
function newTextAt(c, p) {
  exec('layer.newText', { text: '', pos: p }).then(l => { if (l) editText(l, true); });
}
export function editText(l, isNew = false) {
  const c = comp(); if (!c) return;
  wrap.querySelector('.textedit')?.remove();
  const q = layerQuad(c, l);
  const xs = q.pts.map(p => p[0]), ys = q.pts.map(p => p[1]);
  const ta = h('textarea', { class: 'textedit', rows: 2 });
  ta.value = rawAt(l.text.text, S.time - l.start) || '';
  Object.assign(ta.style, { left: Math.max(4, Math.min(...xs)) + 'px', top: Math.max(4, Math.min(...ys)) + 'px', width: Math.max(160, Math.max(...xs) - Math.min(...xs)) + 'px' });
  wrap.append(ta); ta.focus(); ta.select();
  if (!isNew) history.checkpoint('text');
  const upd = () => { setValue(l.text.text, S.time - l.start, ta.value); l.name = (ta.value.split('\n')[0] || t('textLayer')).slice(0, 24); changed('text'); };
  ta.addEventListener('input', upd);
  ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) ta.blur(); });
  ta.addEventListener('blur', () => { ta.remove(); if (!ta.value.trim() && isNew) { edit('removeEmpty', () => { c.layers = c.layers.filter(x => x !== l); }, { noUndo: true }); } S.tool = 'select'; bus.emit('tool'); draw(); });
}

// ---- 鏡頭環繞（Orbit）----
function orbitStart(c, sx, sy, e) {
  let cam = c.layers.find(l => l.type === 'camera');
  if (!cam) { toast(t('needCamera'), 'warn'); return; }
  history.checkpoint('orbit');
  const lt = S.time - cam.start;
  drag = { kind: 'orbit', s: [sx, sy], cam, pos: rawAt(cam.transform.position, lt), poi: rawAt(cam.camera.poi, lt), mode: e.altKey ? 'dolly' : e.shiftKey ? 'track' : 'orbit' };
}
function orbitMove(c, sx, sy, e) {
  const d = drag, dx = sx - d.s[0], dy = sy - d.s[1], lt = S.time - d.cam.start;
  const v = [d.pos[0] - d.poi[0], d.pos[1] - d.poi[1], d.pos[2] - d.poi[2]];
  if (d.mode === 'orbit') {
    const r = Math.hypot(...v), yaw = Math.atan2(v[0], -v[2]) - dx * 0.005, pitch = clamp(Math.asin(clamp(v[1] / r, -1, 1)) + dy * 0.005, -1.5, 1.5);
    const np = [d.poi[0] + r * Math.cos(pitch) * Math.sin(yaw), d.poi[1] + r * Math.sin(pitch), d.poi[2] - r * Math.cos(pitch) * Math.cos(yaw)];
    setValue(d.cam.transform.position, lt, np);
  } else if (d.mode === 'dolly') {
    const k = Math.exp(dy * 0.004);
    setValue(d.cam.transform.position, lt, [d.poi[0] + v[0] * k, d.poi[1] + v[1] * k, d.poi[2] + v[2] * k]);
  } else {
    const m = [-dx / view.z, -dy / view.z];
    setValue(d.cam.transform.position, lt, [d.pos[0] + m[0], d.pos[1] + m[1], d.pos[2]]);
    setValue(d.cam.camera.poi, lt, [d.poi[0] + m[0], d.poi[1] + m[1], d.poi[2]]);
  }
  changed('drag');
}

// 外部檔案拖到檢視器：放在指到的位置
export function dropPoint(e) { const [sx, sy] = local(e); return toComp(sx, sy); }
new ResizeObserver(() => draw()).observe(wrap);
