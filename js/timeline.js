// 時間軸：圖層列、開關、混合模式、軌道遮罩、父層；屬性展開與關鍵影格；圖層條拖曳／修剪；圖表編輯器
import { S, bus, comp, edit, changed, history, selLayers, firstSel, select, setTime, getPath } from './state.js';
import { layerTree, flatProps, fmt } from './props.js';
import { valueEditor, stopwatch, keyNav, exprBox, curVal } from './editors.js';
import { rawAt, animated, hasExpr, applyEase, segProgress, setKey, sortKeys, walkProps, LINEAR_O, LINEAR_I } from './anim.js';
import { h, clamp, timecode, parseTimecode, css } from './util.js';
import * as M from './model.js';
import { ic, TYPE_ICON } from './icons.js';
import { t } from './i18n.js';
import { sel, dropdown, promptBox } from './ui.js';
import { exec } from './actions.js';

let root, head, ruler, rulerCv, left, right, rows, track, playhead, foot, zoomIn;
let pps = 100;          // 每秒幾個像素
let autoFit = true;
const open = new Set(); // 展開的列：`${layerId}` 或 `${layerId}:${groupPath}`
let rowList = [];       // 目前畫出來的列（給軌道用）
let editors = [];       // 需要隨時間更新的編輯器
let rebuildPending = false;
let searchText = '';

export function mountTimeline(container) {
  root = h('div', { id: 'tl' });
  head = h('div', { id: 'tlHead' });
  ruler = h('div', { id: 'tlRuler' }); rulerCv = h('canvas'); ruler.append(rulerCv, h('div', { class: 'phead' }));
  left = h('div', { id: 'tlLeft' }); rows = h('div', { id: 'tlRows' }); left.append(rows);
  right = h('div', { id: 'tlRight' }); track = h('div', { id: 'tlTrack' }); playhead = h('div', { id: 'playhead' }); right.append(track, playhead);
  foot = h('div', { id: 'tlFoot' });
  root.append(head, ruler, left, right, foot);
  container.append(root);
  buildHead(); buildFoot();
  right.addEventListener('scroll', () => { left.scrollTop = right.scrollTop; drawRuler(); placePlayhead(); });
  left.addEventListener('wheel', e => { right.scrollTop += e.deltaY; e.preventDefault(); }, { passive: false });
  right.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) { e.preventDefault(); const r = right.getBoundingClientRect(); const x = e.clientX - r.left + right.scrollLeft; const tt = x / pps; autoFit = false; setPps(pps * Math.exp(-e.deltaY * 0.003)); right.scrollLeft = tt * pps - (e.clientX - r.left); }
  }, { passive: false });
  rulerDrag();
  trackPointer();
  new ResizeObserver(() => { if (autoFit) fitZoom(); drawRuler(); renderTrack(); }).observe(right);
  bus.on('change', w => schedule(w));
  bus.on('select', () => schedule('select'));
  bus.on('comp', () => { autoFit = true; open.clear(); schedule('comp'); });
  bus.on('time', onTime);
  bus.on('timelineMode', () => schedule('mode'));
  bus.on('reveal', () => schedule('reveal'));
  schedule();
}

function schedule() {
  if (rebuildPending) return;
  rebuildPending = true;
  requestAnimationFrame(() => {
    rebuildPending = false;
    if (S.uiDrag || tlDrag) { refreshValues(); renderTrack(); return; }
    rebuild();
  });
}
function onTime() { placePlayhead(); refreshValues(); head.querySelector('.tc').textContent = timecode(S.time, comp()?.fps || 30); head.querySelector('.fr').textContent = `${String(Math.round(S.time * (comp()?.fps || 30))).padStart(5, '0')} (${(comp()?.fps || 30)} fps)`; }
function refreshValues() { for (const e of editors) e.refresh?.(); }

function buildHead() {
  const tc = h('div', { class: 'tc', title: t('goToTime') }, '0:00:00:00');
  tc.addEventListener('click', async () => {
    const c = comp(); if (!c) return;
    const v = await promptBox(t('goToTime'), timecode(S.time, c.fps), { hint: t('timeHint') });
    if (v != null) { const tt = parseTimecode(v, c.fps); if (tt != null) setTime(tt); }
  });
  const search = h('div', { class: 'search' }, ic('zoom'), h('input', { placeholder: t('search'), oninput: e => { searchText = e.target.value.toLowerCase(); schedule(); }, onkeydown: e => e.stopPropagation() }));
  const graphBtn = h('button', { class: 'icon', title: t('graphEditor') + ' (Shift+F3)', onclick: () => exec('view.graph') }, ic('graph'));
  const mbBtn = h('button', { class: 'icon', title: t('compMotionBlur'), onclick: () => exec('comp.motionBlur') }, ic('mb'));
  head.append(h('div', null, tc, h('div', { class: 'fr' }, '')), search, mbBtn, graphBtn);
  head.refreshBtns = () => { const c = comp(); graphBtn.classList.toggle('on', S.graph); mbBtn.classList.toggle('on', !!c?.motionBlur); };
}
function buildFoot() {
  zoomIn = h('input', { type: 'range', min: 0, max: 1000, value: 0 });
  zoomIn.addEventListener('input', () => { autoFit = false; const c = comp(); if (!c) return; const minP = fitPps(); setPps(minP * Math.pow(600 / minP, zoomIn.value / 1000)); });
  foot.append(h('span', null, t('toggleSwitches')), h('span', { style: { flex: 1 } }), h('span', null, t('zoom')), zoomIn, h('button', { class: 'ghost small', onclick: () => { autoFit = true; fitZoom(); } }, t('fit')));
}
function fitPps() { const c = comp(); const w = right.clientWidth - 20; return c ? Math.max(1, w / c.duration) : 100; }
function fitZoom() { pps = fitPps(); if (zoomIn) zoomIn.value = 0; renderTrack(); drawRuler(); placePlayhead(); }
function setPps(v) { pps = clamp(v, 1, 2000); drawRuler(); renderTrack(); placePlayhead(); }
const X = tt => tt * pps + 10;
const T = x => (x - 10) / pps;

// ---- 尺規 ----
function drawRuler() {
  const c = comp(); const dpr = devicePixelRatio || 1;
  const w = ruler.clientWidth, hh = ruler.clientHeight;
  if (rulerCv.width !== Math.round(w * dpr) || rulerCv.height !== Math.round(hh * dpr)) { rulerCv.width = Math.round(w * dpr); rulerCv.height = Math.round(hh * dpr); rulerCv.style.width = w + 'px'; rulerCv.style.height = hh + 'px'; }
  const g = rulerCv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
  if (!c) return;
  const sl = right.scrollLeft;
  // 工作區域
  g.fillStyle = '#3a3c42'; g.fillRect(X(0) - sl, 4, c.duration * pps, 8);
  g.fillStyle = '#5a5d65'; g.fillRect(X(c.workIn) - sl, 4, (c.workOut - c.workIn) * pps, 8);
  g.fillStyle = '#9da0a8'; g.fillRect(X(c.workIn) - sl - 2, 2, 4, 12); g.fillRect(X(c.workOut) - sl - 2, 2, 4, 12);
  // 刻度
  const steps = [1 / c.fps, 2 / c.fps, 5 / c.fps, 10 / c.fps, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
  const major = steps.find(s => s * pps >= 64) || 600;
  const minor = steps.slice().reverse().find(s => s * pps <= major * pps / 4 && s * pps >= 6) || major / 2;
  g.strokeStyle = '#555861'; g.fillStyle = '#9da0a8'; g.font = '10.5px ' + getComputedStyle(document.body).fontFamily; g.lineWidth = 1;
  g.beginPath();
  const t0 = Math.max(0, T(sl)), t1 = Math.min(c.duration, T(sl + w));
  for (let tt = Math.floor(t0 / minor) * minor; tt <= t1 + 1e-9; tt += minor) { const x = Math.round(X(tt) - sl) + .5; g.moveTo(x, hh - 6); g.lineTo(x, hh); }
  for (let tt = Math.floor(t0 / major) * major; tt <= t1 + 1e-9; tt += major) {
    const x = Math.round(X(tt) - sl) + .5; g.moveTo(x, hh - 12); g.lineTo(x, hh);
    const s = Math.floor(tt + 1e-6), f = Math.round((tt - s) * c.fps);
    g.fillText(`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${major < 1 ? ':' + String(f).padStart(2, '0') : ''}f`.replace(/^00:/, '0:'), x + 3, hh - 14);
  }
  g.stroke();
  // 標記
  for (const m of c.markers || []) { const x = X(m.t) - sl; g.fillStyle = '#7bd389'; g.beginPath(); g.moveTo(x - 4, 14); g.lineTo(x + 4, 14); g.lineTo(x, 20); g.fill(); }
  ruler.querySelector('.phead').style.left = (X(S.time) - sl) + 'px';
}
function rulerDrag() {
  ruler.addEventListener('pointerdown', e => {
    const c = comp(); if (!c) return;
    ruler.setPointerCapture(e.pointerId);
    const r = ruler.getBoundingClientRect();
    const x0 = e.clientX - r.left + right.scrollLeft;
    const y = e.clientY - r.top;
    let mode = 'scrub';
    if (y < 15) { if (Math.abs(X(c.workIn) - x0) < 6) mode = 'wi'; else if (Math.abs(X(c.workOut) - x0) < 6) mode = 'wo'; else if (x0 > X(c.workIn) && x0 < X(c.workOut)) mode = 'wa'; }
    const wi0 = c.workIn, wo0 = c.workOut;
    if (mode !== 'scrub') history.checkpoint('workArea');
    const mv = ev => {
      const x = ev.clientX - r.left + right.scrollLeft, tt = clamp(T(x), 0, c.duration), snapT = Math.round(tt * c.fps) / c.fps;
      if (mode === 'scrub') setTime(tt);
      else if (mode === 'wi') { c.workIn = Math.min(snapT, c.workOut - 1 / c.fps); drawRuler(); }
      else if (mode === 'wo') { c.workOut = Math.max(snapT, c.workIn + 1 / c.fps); drawRuler(); }
      else { const d = Math.round((T(x) - T(x0)) * c.fps) / c.fps; const dd = clamp(d, -wi0, c.duration - wo0); c.workIn = wi0 + dd; c.workOut = wo0 + dd; drawRuler(); }
    };
    mv(e);
    const up = () => { ruler.removeEventListener('pointermove', mv); ruler.removeEventListener('pointerup', up); if (mode !== 'scrub') changed('workArea'); };
    ruler.addEventListener('pointermove', mv); ruler.addEventListener('pointerup', up);
  });
}
function placePlayhead() { playhead.style.left = X(S.time) + 'px'; ruler.querySelector('.phead').style.left = (X(S.time) - right.scrollLeft) + 'px'; }

// ---- 列 ----
function rebuild() {
  const c = comp();
  head.refreshBtns?.();
  rows.innerHTML = ''; editors = []; rowList = [];
  if (!c) { rows.append(h('div', { class: 'empty' }, t('noComp'))); renderTrack(); drawRuler(); return; }
  if (autoFit) pps = fitPps();
  head.querySelector('.tc').textContent = timecode(S.time, c.fps);
  onTime();
  const layers = c.layers.filter(l => !searchText || l.name.toLowerCase().includes(searchText) || (searchText && layerTree(l).some(g => JSON.stringify(g.label).toLowerCase().includes(searchText))));
  if (!c.layers.length) rows.append(h('div', { class: 'empty' }, t('emptyComp')));
  layers.forEach(l => {
    const idx = c.layers.indexOf(l) + 1;
    rows.append(layerRow(c, l, idx));
    rowList.push({ kind: 'layer', l });
    const revealed = S.revealed && (S.sel.size ? S.sel.has(l.id) : true);
    if (revealed) {
      const nodes = flatProps(layerTree(l)).filter(n => S.revealed === 'U' ? animated(n.prop) || hasExpr(n.prop) : S.revealed.some(r => (n.short && r === n.short) || n.path.startsWith(r)));
      for (const n of nodes) addPropRow(c, l, n, 1);
      if (S.revealed !== 'U' && S.revealed.includes('M')) for (const m of l.masks) addPropRow(c, l, { path: `masks.${m.id}.path`, prop: m.path, label: m.name, type: 'path' }, 1);
    } else if (open.has(l.id)) {
      for (const g of layerTree(l)) addNode(c, l, g, 1);
    }
  });
  rows.style.height = track.style.height = (rowList.length * rowH() + 40) + 'px';
  renderTrack(); drawRuler(); placePlayhead();
}
const rowH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rowh')) || 24;

function sw(icon, on, title, fn, cls = '') {
  const s = h('span', { class: 'sw ' + cls + (on ? '' : ' off'), title }, ic(icon));
  s.addEventListener('click', e => { e.stopPropagation(); fn(e); });
  return s;
}

function layerRow(c, l, idx) {
  const on = S.sel.has(l.id);
  const r = h('div', { class: 'tlr layer' + (on ? ' on' : ''), draggable: false });
  const tw = h('span', { class: 'tw' + (open.has(l.id) ? ' open' : '') }, '▸');
  tw.addEventListener('click', e => { e.stopPropagation(); if (open.has(l.id)) open.delete(l.id); else open.add(l.id); if (S.revealed) { S.revealed = null; } schedule(); });
  const name = h('span', { class: 'nm', title: l.name }, h('span', { class: 'tyi' }, ic(TYPE_ICON[l.type] || 'layers')), l.name);
  name.addEventListener('dblclick', async e => { e.stopPropagation(); const n = await promptBox(t('rename'), l.name); if (n) edit('rename', () => { l.name = n; }); });
  const hasAudio = l.type === 'audio' || l.type === 'video';
  r.append(
    sw('eye', l.visible, t('visible'), () => edit('visible', () => { l.visible = !l.visible; }), l.type === 'audio' ? 'hidden' : ''),
    hasAudio ? sw('speaker', l.audioOn !== false, t('audio'), () => edit('audio', () => { l.audioOn = l.audioOn === false; })) : h('span', { class: 'sw' }),
    sw('solo', l.solo, t('solo'), () => edit('solo', () => { l.solo = !l.solo; })),
    sw('lock', l.locked, t('lock'), () => edit('lock', () => { l.locked = !l.locked; })),
    h('span', { class: 'lbl', style: { background: l.label } }),
    h('span', { class: 'num' }, idx), tw, name,
  );
  const ctl = h('span', { class: 'ctl' });
  if (!['audio', 'camera', 'light', 'null'].includes(l.type)) {
    ctl.append(
      sw('fx', l.effects.length && l.effects.some(e => e.on !== false), t('effectsOnOff'), () => edit('fx', () => { const any = l.effects.some(e => e.on !== false); l.effects.forEach(e => { e.on = !any; }); })),
      sw('mb', l.motionBlur, t('motionBlur'), () => edit('mb', () => { l.motionBlur = !l.motionBlur; if (l.motionBlur) c.motionBlur = true; })),
      sw('cube', l.threeD, t('layer3D'), () => edit('3d', () => { l.threeD = !l.threeD; })),
    );
    ctl.append(sel(M.BLEND_MODES.map(b => [b, t('blend_' + b)]), l.blend, v => edit('blend', () => { l.blend = v; }), { title: t('blendMode') }));
    const idxL = c.layers.indexOf(l);
    ctl.append(sel(M.MATTE_MODES.map(m => [m, t('matte_' + m)]), l.matte || 'none', v => edit('matte', () => { l.matte = v; if (v === 'none') l.matteLayer = null; else if (!l.matteLayer && idxL > 0) l.matteLayer = c.layers[idxL - 1].id; }), { title: t('trackMatte') }));
  }
  if (l.type !== 'audio') ctl.append(sel([['', t('none')], ...c.layers.filter(x => x !== l && !isDescendant(c, x, l)).map(x => [x.id, (c.layers.indexOf(x) + 1) + '. ' + x.name])], l.parent || '', v => edit('parent', () => setParent(c, l, v || null)), { title: t('parent') }));
  r.append(ctl);
  r.addEventListener('pointerdown', e => {
    if (e.target.closest('select,.sw,.tw')) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (e.shiftKey && S.sel.size) { const ids = c.layers.map(x => x.id), a = ids.indexOf([...S.sel][0]), b = ids.indexOf(l.id); select(ids.slice(Math.min(a, b), Math.max(a, b) + 1)); }
      else select(l.id, true);
    } else if (!S.sel.has(l.id)) select(l.id);
    S.selProp = null;
    rowReorder(e, c, l, r);
  });
  r.addEventListener('contextmenu', e => { e.preventDefault(); if (!S.sel.has(l.id)) select(l.id); bus.emit('layerMenu', e.clientX, e.clientY); });
  return r;
}
function isDescendant(c, x, l) { let p = x; for (let i = 0; i < 40 && p; i++) { if (p.parent === l.id) return true; p = M.getLayer(c, p.parent); } return false; }
// 設定父層：保持目前畫面位置不跳動（只處理 2D 的位置／縮放／旋轉）
function setParent(c, l, pid) {
  l.parent = pid;
}

function rowReorder(e, c, l, r) {
  const y0 = e.clientY; let moved = false, target = -1;
  const ind = h('div', { style: { position: 'absolute', left: 0, right: 0, height: '2px', background: 'var(--acc)', zIndex: 5, display: 'none' } });
  rows.append(ind);
  const mv = ev => {
    if (!moved && Math.abs(ev.clientY - y0) < 5) return;
    moved = true;
    const rr = rows.getBoundingClientRect(), y = ev.clientY - rr.top;
    // 只能落在圖層列之間
    const layerRows = rowList.map((x, i) => ({ ...x, i })).filter(x => x.kind === 'layer');
    let best = layerRows.length;
    for (let k = 0; k < layerRows.length; k++) { if (y < (layerRows[k].i + 0.5) * rowH()) { best = k; break; } }
    target = best;
    const yy = best < layerRows.length ? layerRows[best].i * rowH() : rowList.length * rowH();
    ind.style.display = ''; ind.style.top = yy - 1 + 'px';
  };
  const up = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up); ind.remove();
    if (!moved || target < 0) return;
    const ls = selLayers();
    edit('reorder', () => {
      const rest = c.layers.filter(x => !ls.includes(x));
      const layerRowsL = rowList.filter(x => x.kind === 'layer').map(x => x.l);
      const before = layerRowsL[target];
      let at = before ? rest.indexOf(before) : rest.length;
      if (at < 0) at = rest.length;
      rest.splice(at, 0, ...ls);
      c.layers = rest;
    });
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}

function addNode(c, l, node, depth) {
  if (!node.group) { addPropRow(c, l, node, depth); return; }
  const key = l.id + ':' + node.path;
  const r = h('div', { class: 'tlr group', style: { paddingLeft: (depth * 16 + 96) + 'px' } });
  const tw = h('span', { class: 'tw' + (open.has(key) ? ' open' : '') }, '▸');
  tw.addEventListener('click', e => { e.stopPropagation(); if (open.has(key)) open.delete(key); else open.add(key); schedule(); });
  r.append(tw, h('span', { class: 'nm' }, node.label));
  if (node.kind === 'effect') {
    const e = node.item;
    r.append(sw('fx', e.on !== false, t('effectOnOff'), () => edit('fx', () => { e.on = e.on === false; })));
    r.addEventListener('click', () => { S.selEffectId = e.id; select(l.id); S.selEffectId = e.id; bus.emit('showPanel', 'effectControls'); });
  }
  if (node.kind === 'mask') {
    const m = node.item;
    r.append(h('span', { class: 'ctl' },
      sel(M.MASK_MODES.map(x => [x, t('mask_' + x)]), m.mode, v => edit('maskMode', () => { m.mode = v; })),
      h('label', { class: 'small dim' }, h('input', { type: 'checkbox', checked: m.inverted, onchange: ev => edit('maskInv', () => { m.inverted = ev.target.checked; }) }), t('inverted'))));
    r.addEventListener('click', () => { S.selMask = { layerId: l.id, maskId: m.id, whole: true }; bus.emit('select'); });
  }
  if (node.kind === 'shapeItem' || node.kind === 'contents' || node.kind === 'textGroup' || node.kind === 'animator') {
    const add = h('span', { class: 'sw', title: t('add') }, ic('plus'));
    add.addEventListener('click', ev => { ev.stopPropagation(); bus.emit('addMenu', ev.clientX, ev.clientY, l, node); });
    r.append(add);
  }
  r.addEventListener('contextmenu', ev => { ev.preventDefault(); bus.emit('nodeMenu', ev.clientX, ev.clientY, l, node); });
  rows.append(r); rowList.push({ kind: 'group', l, node });
  if (open.has(key)) for (const ch of node.children) addNode(c, l, ch, depth + 1);
}

function addPropRow(c, l, node, depth) {
  const isSel = S.selProp?.layerId === l.id && S.selProp.path === node.path;
  const r = h('div', { class: 'tlr prop' + (isSel ? ' on' : ''), style: { paddingLeft: (depth * 16 + 80) + 'px' } });
  const kn = keyNav(l, node, setTime);
  const val = node.type === 'text' || node.type === 'path' ? h('span', { class: 'val' }, node.type === 'text' ? String(rawAt(node.prop, S.time - l.start) ?? '').slice(0, 24) : '') : valueEditor(l, node);
  val.classList?.add('val');
  if (hasExpr(node.prop)) val.classList.add('expr');
  r.append(stopwatch(l, node), h('span', { class: 'nm', title: node.label }, node.label), kn, val);
  editors.push(kn, val);
  r.addEventListener('pointerdown', e => { if (e.target.closest('.scrub,.watch,.kn,input,select')) return; S.selProp = { layerId: l.id, path: node.path }; if (!S.sel.has(l.id)) select(l.id); else bus.emit('select'); });
  r.addEventListener('contextmenu', e => { e.preventDefault(); S.selProp = { layerId: l.id, path: node.path }; bus.emit('propMenu', e.clientX, e.clientY, l, node); });
  rows.append(r); rowList.push({ kind: 'prop', l, node });
  if (hasExpr(node.prop)) {
    const box = exprBox(l, node); box.classList.add('tlr'); box.style.height = 'auto';
    // 表達式框在時間軸只顯示一行提示
    const hint = h('div', { class: 'tlr prop', style: { paddingLeft: (depth * 16 + 98) + 'px', color: '#f3c09a', fontFamily: 'var(--mono)', fontSize: '11.5px' } }, '= ' + node.prop.x.split('\n')[0].slice(0, 60));
    hint.addEventListener('click', () => { S.selProp = { layerId: l.id, path: node.path }; bus.emit('showPanel', 'props'); bus.emit('select'); });
    rows.append(hint); rowList.push({ kind: 'expr', l, node });
  }
}

// ---- 軌道（右側）----
function renderTrack() {
  const c = comp();
  track.innerHTML = '';
  if (!c) return;
  track.style.width = (X(c.duration) + 40) + 'px';
  if (S.graph) { renderGraph(c); return; }
  const H = rowH();
  rowList.forEach((r, i) => {
    const y = i * H;
    if (r.kind === 'layer') {
      const l = r.l;
      track.append(h('div', { class: 'rowbg' + (S.sel.has(l.id) ? ' on' : ''), style: { top: y + 'px' } }));
      const bar = h('div', { class: 'bar' + (S.sel.has(l.id) ? ' on' : ''), style: { left: X(l.in) + 'px', width: Math.max(2, (l.out - l.in) * pps) + 'px', top: y + 3 + 'px', background: barColor(l) } }, h('div', { class: 'h l' }), h('div', { class: 'h r' }));
      bar.dataset.layer = l.id;
      track.append(bar);
      // 收合時在圖層列顯示所有關鍵影格的位置
      if (!open.has(l.id) && !S.revealed) {
        const times = new Set();
        walkProps(l, p => { for (const k of p.k || []) times.add(k.t + l.start); });
        for (const tt of times) track.append(h('div', { style: { position: 'absolute', left: X(tt) - 2 + 'px', top: y + H - 7 + 'px', width: '4px', height: '4px', background: '#dfe1e5', transform: 'rotate(45deg)', pointerEvents: 'none' } }));
      }
    } else if (r.kind === 'prop') {
      const { l, node } = r;
      const on = S.selProp?.layerId === l.id && S.selProp.path === node.path;
      track.append(h('div', { class: 'rowbg' + (on ? ' on' : ''), style: { top: y + 'px' } }));
      for (const k of node.prop.k || []) {
        const kd = h('div', { class: 'key' + (S.selKeys.has(k) ? ' on' : '') + (k.ti === 'hold' ? ' hold' : (k.eo && k.eo[1] === 0) || (k.ei && k.ei[1] === 1) ? ' ease' : ''), style: { left: X(k.t + l.start) + 'px', top: y + H / 2 + 'px' } });
        kd._k = k; kd._l = l; kd._path = node.path;
        track.append(kd);
      }
    } else {
      track.append(h('div', { class: 'rowbg', style: { top: y + 'px' } }));
    }
  });
}
function barColor(l) { const c = l.label || '#5e8fd9'; return c; }

// 軌道上的滑鼠操作：圖層條拖曳／修剪、關鍵影格選取與拖曳、框選
let tlDrag = null;
function trackPointer() {
  right.addEventListener('pointerdown', e => {
    if (S.graph) return;
    const c = comp(); if (!c || e.button !== 0) return;
    const r = right.getBoundingClientRect();
    const x = e.clientX - r.left + right.scrollLeft, y = e.clientY - r.top + right.scrollTop;
    const key = e.target.closest('.key');
    if (key) {
      const k = key._k;
      if (e.shiftKey || e.ctrlKey || e.metaKey) { if (S.selKeys.has(k)) S.selKeys.delete(k); else S.selKeys.set(k, { layerId: key._l.id, path: key._path }); }
      else if (!S.selKeys.has(k)) { S.selKeys.clear(); S.selKeys.set(k, { layerId: key._l.id, path: key._path }); }
      S.selProp = { layerId: key._l.id, path: key._path };
      if (!S.sel.has(key._l.id)) { S.sel.clear(); S.sel.add(key._l.id); }
      history.checkpoint('moveKeys');
      tlDrag = { kind: 'keys', x0: x, items: [...S.selKeys.keys()].map(kk => ({ k: kk, t0: kk.t })) };
      right.setPointerCapture(e.pointerId);
      bus.emit('select'); renderTrack();
      return;
    }
    const bar = e.target.closest('.bar');
    if (bar) {
      const l = M.getLayer(c, bar.dataset.layer);
      if (!S.sel.has(l.id)) select(l.id, e.shiftKey);
      if (l.locked) return;
      const part = e.target.classList.contains('l') ? 'in' : e.target.classList.contains('r') ? 'out' : 'move';
      history.checkpoint('layerTime');
      const ls = part === 'move' ? selLayers().filter(x => !x.locked) : [l];
      tlDrag = { kind: 'bar', part, x0: x, items: ls.map(x2 => ({ l: x2, in: x2.in, out: x2.out, start: x2.start })) };
      right.setPointerCapture(e.pointerId);
      return;
    }
    // 空白處：框選關鍵影格、移動播放頭
    if (!e.shiftKey) { S.selKeys.clear(); }
    tlDrag = { kind: 'rubber', x0: x, y0: y, box: h('div', { class: 'rubber' }) };
    track.append(tlDrag.box);
    right.setPointerCapture(e.pointerId);
    setTime(T(x));
  });
  right.addEventListener('pointermove', e => {
    if (!tlDrag) return;
    const c = comp();
    const r = right.getBoundingClientRect();
    const x = e.clientX - r.left + right.scrollLeft, y = e.clientY - r.top + right.scrollTop;
    const fr = 1 / c.fps;
    if (tlDrag.kind === 'keys') {
      let d = (x - tlDrag.x0) / pps; d = Math.round(d * c.fps) / c.fps;
      if (S.snapping && !e.shiftKey) { const first = tlDrag.items[0]; const l = S.selKeys.get(first.k); const lay = M.getLayer(c, l.layerId); const abs = first.t0 + d + lay.start; if (Math.abs(abs - S.time) * pps < 6) d = S.time - lay.start - first.t0; }
      for (const it of tlDrag.items) it.k.t = Math.max(-1000, it.t0 + d);
      tlDrag.moved = true;
      renderTrack(); changed('tldrag');
      return;
    }
    if (tlDrag.kind === 'bar') {
      let d = Math.round((x - tlDrag.x0) / pps * c.fps) / c.fps;
      for (const it of tlDrag.items) {
        const l = it.l;
        if (tlDrag.part === 'move') {
          if (S.snapping && !e.shiftKey) { if (Math.abs(it.in + d - S.time) * pps < 6) d = S.time - it.in; else if (Math.abs(it.out + d - S.time) * pps < 6) d = S.time - it.out; else if (Math.abs(it.in + d) * pps < 6) d = -it.in; }
          l.in = it.in + d; l.out = it.out + d; l.start = it.start + d;
        } else if (tlDrag.part === 'in') { l.in = clamp(it.in + d, srcMin(l), l.out - fr); }
        else { l.out = clamp(it.out + d, l.in + fr, srcMax(l, c)); }
      }
      tlDrag.moved = true;
      renderTrack(); changed('tldrag');
      return;
    }
    if (tlDrag.kind === 'rubber') {
      const x0 = Math.min(x, tlDrag.x0), y0 = Math.min(y, tlDrag.y0), w = Math.abs(x - tlDrag.x0), hh = Math.abs(y - tlDrag.y0);
      Object.assign(tlDrag.box.style, { left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: hh + 'px' });
      if (w > 4 || hh > 4) {
        tlDrag.rub = true;
        for (const kd of track.querySelectorAll('.key')) {
          const kx = parseFloat(kd.style.left), ky = parseFloat(kd.style.top);
          const inside = kx >= x0 && kx <= x0 + w && ky >= y0 && ky <= y0 + hh;
          if (inside) S.selKeys.set(kd._k, { layerId: kd._l.id, path: kd._path });
          kd.classList.toggle('on', S.selKeys.has(kd._k));
        }
      } else setTime(T(x));
    }
  });
  const up = () => {
    if (!tlDrag) return;
    const d = tlDrag; tlDrag = null;
    d.box?.remove();
    if (d.kind === 'keys' && d.moved) { for (const it of d.items) { const info = S.selKeys.get(it.k); const l = M.getLayer(comp(), info.layerId); const p = l && getPath(l, info.path); if (p) sortKeys(p); } changed('keys'); }
    if (d.kind === 'bar' && d.moved) changed('layerTime');
    if (d.kind === 'rubber') bus.emit('select');
    schedule();
  };
  right.addEventListener('pointerup', up); right.addEventListener('pointercancel', up);
  right.addEventListener('contextmenu', e => {
    const key = e.target.closest('.key');
    if (key) { e.preventDefault(); if (!S.selKeys.has(key._k)) { S.selKeys.clear(); S.selKeys.set(key._k, { layerId: key._l.id, path: key._path }); renderTrack(); } bus.emit('keyMenu', e.clientX, e.clientY); return; }
    const bar = e.target.closest('.bar');
    if (bar) { e.preventDefault(); const l = M.getLayer(comp(), bar.dataset.layer); if (!S.sel.has(l.id)) select(l.id); bus.emit('layerMenu', e.clientX, e.clientY); }
  });
  right.addEventListener('dblclick', e => {
    const key = e.target.closest('.key');
    if (key) { setTime(key._k.t + key._l.start); }
  });
}
// 影片、音訊、巢狀合成不能拉超過素材長度（除非有時間重映射）
function srcMin(l) { return ['video', 'audio', 'precomp', 'lottie'].includes(l.type) && !l.timeRemap?.on ? l.start : -1e6; }
function srcMax(l, c) {
  if (!['video', 'audio', 'precomp', 'lottie'].includes(l.type) || l.timeRemap?.on) return 1e6;
  let dur = 1e6;
  if (l.type === 'precomp') dur = M.getComp(S.project, l.comp)?.duration || 1e6;
  else dur = M.getFootage(S.project, l.source)?.duration || 1e6;
  return l.start + dur / (l.speed || 1);
}

// ---- 圖表編輯器 ----
let gcv = null, gdrag = null;
function renderGraph(c) {
  const sp = S.selProp && M.getLayer(c, S.selProp.layerId);
  const prop = sp && getPath(sp, S.selProp.path);
  const W = Math.max(X(c.duration) + 40, right.clientWidth), H = Math.max(160, right.clientHeight - 40);
  gcv = h('canvas', { id: 'graphCv' });
  const dpr = devicePixelRatio || 1;
  gcv.width = W * dpr; gcv.height = H * dpr; gcv.style.width = W + 'px'; gcv.style.height = H + 'px';
  track.style.height = H + 40 + 'px';
  track.append(gcv);
  const tools = h('div', { class: 'gtools', style: { position: 'absolute', top: H + 'px', left: right.scrollLeft + 'px', width: right.clientWidth + 'px' } },
    ...[['anim.easyEase', t('easyEase')], ['anim.easeIn', t('easeIn')], ['anim.easeOut', t('easeOut')], ['anim.linear', t('linear')], ['anim.hold', t('hold')]].map(([id, lb]) => h('button', { onclick: () => exec(id) }, lb)),
    h('button', { onclick: () => presetCurve([0.7, 0], [0.3, 1]) }, t('curveStrong')),
    h('button', { onclick: () => presetCurve([0.34, 1.56], [0.64, 1]) }, t('curveOvershootOut')),
    h('button', { onclick: () => presetCurve([0.36, 0], [0.66, -0.56]) }, t('curveAnticipate')),
  );
  track.append(tools);
  const g = gcv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#1b1c1f'; g.fillRect(0, 0, W, H);
  if (!prop || !prop.k || prop.k.length < 1 || typeof rawAt(prop, 0) === 'string') {
    g.fillStyle = '#8d9097'; g.font = '13px system-ui'; g.fillText(t('graphHint'), right.scrollLeft + 20, 30);
    return;
  }
  const l = sp;
  const v0 = rawAt(prop, 0), dims = Array.isArray(v0) ? Math.min(v0.length, prop === l.transform.scale || prop === l.transform.position ? (l.threeD ? 3 : 2) : v0.length === 4 ? 3 : v0.length) : 1;
  const tA = 0, tB = c.duration;
  // 值的範圍
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 300; i++) { const v = rawAt(prop, tA - l.start + (tB - tA) * i / 300 + 0); const arr = Array.isArray(v) ? v.slice(0, dims) : [v]; for (const x of arr) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }
  for (const k of prop.k) { const arr = Array.isArray(k.v) ? k.v.slice(0, dims) : [k.v]; for (const x of arr) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
  const Y = v => H - 20 - (v - lo) / (hi - lo) * (H - 40);
  const V = y => lo + (H - 20 - y) / (H - 40) * (hi - lo);
  // 格線
  g.strokeStyle = '#2a2c31'; g.fillStyle = '#6b6e75'; g.font = '10px system-ui'; g.lineWidth = 1;
  for (let i = 0; i <= 5; i++) { const v = lo + (hi - lo) * i / 5, y = Math.round(Y(v)) + .5; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.fillText(fmt('num', v), right.scrollLeft + 4, y - 2); }
  const cols = ['#ff6b6b', '#7bd389', '#5aa9ff', '#f0c040'];
  for (let d = 0; d < dims; d++) {
    g.strokeStyle = dims === 1 ? '#f0c040' : cols[d]; g.lineWidth = 1.6; g.beginPath();
    for (let x = 0; x <= W; x += 2) { const tt = T(x) - l.start; const v = rawAt(prop, tt); const y = Y(Array.isArray(v) ? v[d] : v); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  // 關鍵影格與手把（手把表示緩動：在正規化空間 eo/ei）
  const K = prop.k, handles = [];
  for (let i = 0; i < K.length; i++) {
    const k = K[i], x = X(k.t + l.start);
    for (let d = 0; d < dims; d++) {
      const v = Array.isArray(k.v) ? k.v[d] : k.v, y = Y(v);
      g.fillStyle = S.selKeys.has(k) ? '#f0c040' : '#fff'; g.fillRect(x - 4, y - 4, 8, 8);
      handles.push({ type: 'key', k, i, d, x, y });
    }
    // 手把：只畫第一個維度
    const val = kk => Array.isArray(kk.v) ? kk.v[0] : kk.v;
    if (i < K.length - 1 && k.ti !== 'hold') {
      const b = K[i + 1], dt = b.t - k.t, dv = (val(b) - val(k)) || (hi - lo) * 0.25;
      const eo = k.eo || LINEAR_O, ei = b.ei || LINEAR_I;
      const ho = [X(k.t + l.start + eo[0] * dt), Y(val(k) + eo[1] * dv)], hiP = [X(k.t + l.start + ei[0] * dt), Y(val(k) + ei[1] * dv)];
      g.strokeStyle = '#8d9097'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, Y(val(k))); g.lineTo(ho[0], ho[1]); g.moveTo(X(b.t + l.start), Y(val(b))); g.lineTo(hiP[0], hiP[1]); g.stroke();
      g.fillStyle = '#cfd1d6'; g.beginPath(); g.arc(ho[0], ho[1], 4, 0, 7); g.arc(hiP[0], hiP[1], 4, 0, 7); g.fill();
      handles.push({ type: 'eo', k, b, x: ho[0], y: ho[1], dt, dv, k0v: val(k) }, { type: 'ei', k, b, x: hiP[0], y: hiP[1], dt, dv, k0v: val(k) });
    }
  }
  gcv.onpointerdown = e => {
    const r = gcv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = handles.find(hd => Math.hypot(hd.x - x, hd.y - y) < 7);
    if (!hit) { S.selKeys.clear(); setTime(T(x)); renderTrack(); return; }
    history.checkpoint('graph');
    if (hit.type === 'key') { if (!S.selKeys.has(hit.k)) { if (!e.shiftKey) S.selKeys.clear(); S.selKeys.set(hit.k, { layerId: l.id, path: S.selProp.path }); } }
    gdrag = { hit, x0: x, y0: y, t0: hit.k.t, v0: JSON.parse(JSON.stringify(hit.k.v)) };
    gcv.setPointerCapture(e.pointerId);
  };
  gcv.onpointermove = e => {
    if (!gdrag) return;
    const r = gcv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hd = gdrag.hit;
    if (hd.type === 'key') {
      const nt = Math.round((gdrag.t0 + (x - gdrag.x0) / pps) * c.fps) / c.fps;
      hd.k.t = nt;
      const nv = V(y) - V(gdrag.y0);
      if (Array.isArray(hd.k.v)) hd.k.v[hd.d] = gdrag.v0[hd.d] + nv; else if (typeof hd.k.v === 'number') hd.k.v = gdrag.v0 + nv;
    } else {
      const fx = clamp((T(x) - l.start - hd.k.t) / hd.dt, 0, 1), fy = (V(y) - hd.k0v) / hd.dv;
      if (hd.type === 'eo') { hd.k.eo = [fx, fy]; hd.k.ti = 'bezier'; } else { hd.b.ei = [fx, fy]; hd.k.ti = 'bezier'; }
    }
    changed('tldrag');
    renderTrack();
  };
  gcv.onpointerup = () => { if (gdrag) { sortKeys(prop); gdrag = null; changed('graph'); } };
}
function presetCurve(eo, ei) {
  if (!S.selKeys.size) return;
  edit('ease', () => {
    for (const [k, info] of S.selKeys) {
      const l = M.getLayer(comp(), info.layerId), p = getPath(l, info.path);
      const i = p.k.indexOf(k); if (i < 0) continue;
      k.ti = 'bezier'; k.eo = [...eo];
      if (p.k[i + 1]) p.k[i + 1].ei = [...ei];
    }
  });
}

// 屬性快捷鍵：P、S、R、T、A、M、E、L、U（Shift 累加）
export function reveal(key, add = false) {
  const map = { P: ['transform.position'], S: ['transform.scale'], R: ['transform.rotation', 'transform.rotX', 'transform.rotY'], T: ['transform.opacity'], A: ['transform.anchor'], M: ['M'], E: ['effects'], L: ['audio'], F: ['masks'] };
  if (key === 'U') { S.revealed = S.revealed === 'U' ? null : 'U'; bus.emit('reveal'); return; }
  const v = map[key]; if (!v) return;
  if (add && Array.isArray(S.revealed)) { const set = new Set(S.revealed); v.forEach(x => set.has(x) ? set.delete(x) : set.add(x)); S.revealed = set.size ? [...set] : null; }
  else S.revealed = JSON.stringify(S.revealed) === JSON.stringify(v) ? null : v;
  bus.emit('reveal');
}
export function collapseAll() { open.clear(); S.revealed = null; schedule(); }
export function expandLayer(id) { open.add(id); schedule(); }
export function expandPath(lid, path) { open.add(lid); let p = ''; for (const seg of path.split('.')) { p = p ? p + '.' + seg : seg; open.add(lid + ':' + p); } schedule(); }
