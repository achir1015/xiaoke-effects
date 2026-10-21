// 面板：專案、效果控制、屬性、效果與預設集、素材庫、預覽、算繪佇列
import { S, bus, comp, edit, changed, history, selLayers, firstSel, select, setTime, openComp, getPath } from './state.js';
import { h, clamp, fmtBytes, timecode, rgbaToHex, hexToRgba, css, clone } from './util.js';
import { t, has } from './i18n.js';
import { ic, TYPE_ICON } from './icons.js';
import { sel, scrub, colorInput, dropdown, toast, confirmBox, promptBox, modal } from './ui.js';
import * as M from './model.js';
import { P, rawAt, setValue, animated, hasExpr } from './anim.js';
import { layerTree, transformNodes, effectParamNodes, flatProps, fmt } from './props.js';
import { valueEditor, stopwatch, keyNav, exprBox } from './editors.js';
import { exec, addLayer, addFootageLayer, importFiles } from './actions.js';
import { EFFECTS, FX_CATEGORIES } from './fx.js';
import { CONTROL_EFFECTS, effectDef, renderComp } from './render.js';
import { FONT_LIST } from './text.js';
import * as Media from './media.js';
import * as LIB from './library.js';
import { PRESET_CATS, PRESETS } from './presets.js';

// 面板頁籤
export function tabbed(container, tabs, initial) {
  const bar = h('div', { class: 'ptabs' }), body = h('div', { class: 'pbody' });
  container.append(bar, body);
  const pages = {};
  let cur = null;
  for (const tb of tabs) {
    const b = h('button', { class: 'ptab', onclick: () => show(tb.id) }, tb.label());
    tb.btn = b; bar.append(b);
    pages[tb.id] = h('div', { class: 'page hidden' });
    body.append(pages[tb.id]);
  }
  function show(id) {
    if (!pages[id]) return;
    cur = id;
    for (const tb of tabs) { tb.btn.classList.toggle('on', tb.id === id); pages[tb.id].classList.toggle('hidden', tb.id !== id); }
    tabs.find(x => x.id === id)?.render?.(pages[id]);
  }
  show(initial || tabs[0].id);
  return { show, current: () => cur, refresh: () => tabs.find(x => x.id === cur)?.render?.(pages[cur]), relabel: () => tabs.forEach(tb => { tb.btn.textContent = tb.label(); }), has: id => !!pages[id] };
}

// ================= 專案面板 =================
let projSearch = '';
export function renderProject(el) {
  el.innerHTML = '';
  const p = S.project;
  const info = h('div', { class: 'proj-info' });
  const item = S.projSel && (M.getComp(p, S.projSel) || M.getFootage(p, S.projSel));
  if (item) {
    const isComp = !!item.layers;
    const th = h('canvas', { width: 192, height: 108 });
    if (isComp) { try { const tmp = document.createElement('canvas'); renderComp(p, item, Math.min(item.duration / 2, 1), tmp, { scale: Math.min(1, 192 / item.w) }); th.getContext('2d').drawImage(tmp, 0, 0, 192, 108); } catch { } }
    else if (item.kind === 'image') { const img = Media.imageOf(item); if (img) th.getContext('2d').drawImage(img, 0, 0, 192, 108); }
    info.append(th, h('div', { class: 'small' }, h('b', null, item.name), h('br'), item.w ? `${item.w} × ${item.h}` : '', item.fps ? ` · ${item.fps} fps` : '', h('br'), item.duration ? t('durationIs', { d: timecode(item.duration, item.fps || 30) }) : '', item.size ? ' · ' + fmtBytes(item.size) : ''));
  } else info.append(h('span', { class: 'dim small', style: { margin: 'auto' } }, t('selectItemHint')));
  const search = h('div', { class: 'search' }, ic('zoom'), h('input', { placeholder: t('searchProject'), value: projSearch, oninput: e => { projSearch = e.target.value.toLowerCase(); renderList(); }, onkeydown: e => e.stopPropagation() }));
  const list = h('div', { class: 'list' });
  const renderList = () => {
    list.innerHTML = '';
    const items = [...p.comps.map(c => ({ c, kind: 'comp' })), ...p.footage.map(f => ({ f, kind: f.kind }))].filter(x => !projSearch || (x.c || x.f).name.toLowerCase().includes(projSearch));
    if (!items.length) list.append(h('div', { class: 'empty' }, t('projectEmpty'), h('br'), h('br'), h('button', { class: 'primary', onclick: () => exec('comp.new') }, t('newComp')), ' ', h('button', { onclick: () => exec('file.import') }, t('import'))));
    for (const x of items) {
      const o = x.c || x.f;
      const row = h('div', { class: 'row' + (S.projSel === o.id ? ' on' : ''), draggable: true }, ic(x.kind === 'comp' ? 'comp' : TYPE_ICON[x.kind] || 'image'), h('span', { class: 'nm' }, o.name), h('span', { class: 'ty' }, t('kind_' + x.kind)));
      if (x.f && Media.isMissing(x.f)) row.append(h('span', { class: 'small', style: { color: 'var(--warn)' } }, '⚠'));
      row.addEventListener('click', () => { S.projSel = o.id; renderProject(el); });
      row.addEventListener('dblclick', () => { if (x.c) openComp(o.id); else { const c = comp(); if (c) edit('addLayer', () => addFootageLayer(c, o)); } });
      row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-xke-item', o.id); e.dataTransfer.effectAllowed = 'copy'; });
      row.addEventListener('contextmenu', e => { e.preventDefault(); S.projSel = o.id; projectItemMenu(e.clientX, e.clientY, x, el); });
      list.append(row);
    }
  };
  renderList();
  const foot = h('div', { class: 'pfoot' },
    h('button', { class: 'icon', title: t('newComp'), onclick: () => exec('comp.new') }, ic('newcomp')),
    h('button', { class: 'icon', title: t('import'), onclick: () => exec('file.import') }, ic('import')),
    h('span', { class: 'grow small dim' }, `${p.comps.length} ${t('comps')} · ${p.footage.length} ${t('footageN')}`),
    h('button', { class: 'icon', title: t('delete'), onclick: () => deleteProjectItem(S.projSel, el) }, ic('trash')));
  el.append(info, search, list, foot);
}
function projectItemMenu(x, y, it, el) {
  const o = it.c || it.f;
  dropdown([
    it.c ? { label: t('open'), run: () => openComp(o.id) } : { label: t('addToComp'), run: () => { const c = comp(); if (c) edit('addLayer', () => addFootageLayer(c, o)); } },
    it.c ? { label: t('compSettings'), run: () => { openComp(o.id); exec('comp.settings'); } } : null,
    it.c ? { label: t('duplicate'), run: () => { openComp(o.id); exec('comp.duplicate'); } } : null,
    it.c ? { label: t('addToRQ'), run: () => { openComp(o.id); exec('comp.addToRQ'); } } : null,
    it.f && Media.isMissing(it.f) ? { label: t('relink'), run: () => relink(it.f, el) } : null,
    { label: t('rename'), run: async () => { const n = await promptBox(t('rename'), o.name); if (n) edit('rename', () => { o.name = n; }); renderProject(el); } },
    '-',
    { label: t('delete'), run: () => deleteProjectItem(o.id, el) },
  ], x, y);
}
async function relink(f, el) {
  const { pickFiles } = await import('./ui.js');
  const [file] = await pickFiles('*/*', false);
  if (!file) return;
  await M.Store.putBlob(f.blobKey, file);
  await Media.attachBlob(f, file);
  changed('relink'); renderProject(el);
}
async function deleteProjectItem(id, el) {
  if (!id) return;
  const p = S.project;
  const c = M.getComp(p, id), f = M.getFootage(p, id);
  const used = p.comps.some(cc => cc.layers.some(l => l.source === id || l.comp === id));
  if (used && !await confirmBox(t('itemInUse'))) return;
  edit('deleteItem', () => {
    if (c) { p.comps = p.comps.filter(x => x !== c); for (const cc of p.comps) cc.layers = cc.layers.filter(l => l.comp !== id); S.openComps = S.openComps.filter(x => x !== id); if (S.compId === id) S.compId = p.comps[0]?.id || null; p.renderQueue = p.renderQueue.filter(r => r.compId !== id); }
    if (f) { p.footage = p.footage.filter(x => x !== f); for (const cc of p.comps) cc.layers = cc.layers.filter(l => l.source !== id); Media.forget(id); }
  });
  S.projSel = null;
  bus.emit('comp');
  renderProject(el);
}

// ================= 效果控制 =================
export function renderEffectControls(el) {
  el.innerHTML = '';
  const l = firstSel();
  if (!l) { el.append(h('div', { class: 'empty' }, t('selectLayerForFx'))); return; }
  const box = h('div', { class: 'props' });
  box.append(h('div', { class: 'small dim', style: { padding: '2px 10px 6px' } }, `${comp()?.name} • ${l.name}`));
  if (!l.effects.length) box.append(h('div', { class: 'empty' }, t('noEffects'), h('br'), h('br'), h('button', { onclick: () => bus.emit('showPanel', 'effects') }, t('browseEffects'))));
  l.effects.forEach((e, i) => {
    const def = effectDef(e.type);
    const sec = h('div', { class: 'psec' + (e.collapse ? ' closed' : '') });
    const en = h('input', { type: 'checkbox', checked: e.on !== false, title: t('effectOnOff') });
    en.addEventListener('change', () => edit('fx', () => { e.on = en.checked; }));
    const head = h('div', { class: 'fxhead' + (S.selEffectId === e.id ? ' on' : '') },
      h('span', { class: 'tw', style: { cursor: 'pointer' }, onclick: () => { e.collapse = !e.collapse; renderEffectControls(el); } }, e.collapse ? '▸' : '▾'),
      en, h('span', { class: 'nm', title: e.type }, e.name || t('fx.' + e.type)),
      h('button', { class: 'ghost small', onclick: () => edit('reset', () => { const fresh = M.makeEffect(def, l, S.project); e.params = fresh.params; }) }, t('reset')),
      h('button', { class: 'icon', title: t('moreActions'), onclick: ev => dropdown([
        { label: t('moveUp'), disabled: i === 0, run: () => edit('fxOrder', () => { l.effects.splice(i, 1); l.effects.splice(i - 1, 0, e); }) },
        { label: t('moveDown'), disabled: i === l.effects.length - 1, run: () => edit('fxOrder', () => { l.effects.splice(i, 1); l.effects.splice(i + 1, 0, e); }) },
        { label: t('duplicate'), run: () => edit('fxDup', () => { const n = clone(e); n.id = 'e' + Math.random().toString(36).slice(2, 9); l.effects.splice(i + 1, 0, n); }) },
        { label: t('rename'), run: async () => { const n = await promptBox(t('rename'), e.name || t('fx.' + e.type)); if (n) edit('rename', () => { e.name = n; }); } },
        '-', { label: t('delete'), run: () => edit('fxDel', () => { l.effects.splice(i, 1); }) },
      ], ev.clientX, ev.clientY) }, ic('more')));
    head.addEventListener('click', ev => { if (ev.target === head) { S.selEffectId = e.id; el.querySelectorAll('.fxhead').forEach(x => x.classList.remove('on')); head.classList.add('on'); } });
    sec.append(head);
    const pc = h('div', { class: 'pc' });
    if (!e.collapse) for (const n of effectParamNodes(l, e)) pc.append(...propRow(l, n, { slider: true, alpha: true }));
    sec.append(pc);
    box.append(sec);
  });
  el.append(box);
}

// 一列屬性（屬性面板、效果控制）
const liveEditors = new Set();
function propRow(l, n, opts = {}) {
  const isSel = S.selProp?.layerId === l.id && S.selProp.path === n.path;
  const ed = valueEditor(l, n, opts);
  const kn = n.type !== 'path' ? keyNav(l, n, setTime) : h('span');
  const row = h('div', { class: 'prow' + (isSel ? ' on' : '') }, n.type === 'select' || n.type === 'bool' || n.type === 'layerRef' ? h('span', { class: 'watch' }) : stopwatch(l, n), h('span', { class: 'pl', title: n.label }, n.label), h('span', { class: 'pv' }, ed, kn));
  row.addEventListener('pointerdown', e => { if (!e.target.closest('.scrub,input,select,textarea,.watch,.kn')) { S.selProp = { layerId: l.id, path: n.path }; bus.emit('propSelected'); } });
  row.addEventListener('contextmenu', e => { e.preventDefault(); S.selProp = { layerId: l.id, path: n.path }; bus.emit('propMenu', e.clientX, e.clientY, l, n); });
  liveEditors.add(ed); liveEditors.add(kn);
  const out = [row];
  if (hasExpr(n.prop)) { const b = exprBox(l, n); liveEditors.add(b); out.push(b); }
  return out;
}
bus.on('time', () => { for (const e of liveEditors) { if (!e.isConnected) { liveEditors.delete(e); continue; } e.refresh?.(); } });

// ================= 屬性面板 =================
const closed = new Set(['layer', 'time']);
function section(id, title, kids, extra) {
  const s = h('div', { class: 'psec' + (closed.has(id) ? ' closed' : '') });
  const head = h('div', { class: 'ph' }, h('span', { class: 'tw' }, '▾'), h('span', { class: 'grow' }, title), extra || null);
  head.addEventListener('click', e => { if (e.target.closest('button,input,select')) return; if (closed.has(id)) closed.delete(id); else closed.add(id); s.classList.toggle('closed'); });
  s.append(head, h('div', { class: 'pc' }, kids));
  return s;
}
const row = (label, ...kids) => h('div', { class: 'prow' }, h('span', { class: 'watch' }), h('span', { class: 'pl' }, label), h('span', { class: 'pv' }, ...kids));
const chk = (label, v, fn) => h('label', { class: 'small', style: { display: 'inline-flex', gap: '4px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: !!v, onchange: e => fn(e.target.checked) }), label);
const num = (get, set, o = {}) => scrub({ get, set: (v, f) => { set(v); changed(f ? 'value' : 'drag'); if (f) S.uiDrag = false; }, begin: () => { history.checkpoint('value'); S.uiDrag = true; }, ...o });

export function renderProps(el) {
  el.innerHTML = '';
  const c = comp(), l = firstSel();
  if (!c) { el.append(h('div', { class: 'empty' }, t('noComp'))); return; }
  const box = h('div', { class: 'props' });
  if (!l) {
    // 沒選圖層：顯示合成設定
    box.append(section('comp', t('compSettings') + ': ' + c.name, [
      row(t('size'), `${c.w} × ${c.h}`), row(t('frameRate'), `${c.fps} fps`), row(t('duration'), timecode(c.duration, c.fps)),
      row(t('bgColor'), colorInput(() => c.bg, (v, f, first) => { if (first) history.checkpoint('bg'); c.bg = v; changed(f ? 'value' : 'drag'); })),
      row(t('motionBlur'), chk(t('enable'), c.motionBlur, v => edit('mb', () => { c.motionBlur = v; }))),
      h('div', { class: 'chips' }, h('button', { onclick: () => exec('comp.settings') }, t('compSettings') + '…')),
    ]));
    box.append(h('div', { class: 'empty small' }, t('selectLayerHint')));
    el.append(box); return;
  }
  const lt = S.time - l.start;
  box.append(h('div', { class: 'fxhead' }, ic(TYPE_ICON[l.type] || 'layers'), h('span', { class: 'nm' }, l.name), h('span', { class: 'fxi' }, t('type_' + l.type))));
  // 替換照片圖層／圖片圖層：一鍵更換照片（追蹤好的動作不變）
  if (l.type === 'image' || (l.type === 'precomp' && (l.photoSlot || l.effects.some(e => e.type === 'cornerPin'))))
    box.append(h('div', { class: 'chips' }, h('button', { class: 'primary', onclick: () => exec('module.swapPhoto', l) }, '🖼 ' + t('modSwap'))));
  // 圖層
  const layerKids = [
    row(t('name'), h('input', { value: l.name, style: { width: '100%' }, onkeydown: e => e.stopPropagation(), onchange: e => edit('rename', () => { l.name = e.target.value; }) })),
    row(t('inOut'), num(() => l.in, v => { l.in = Math.min(v, l.out - 1 / c.fps); }, { step: 1 / c.fps, fmt: v => timecode(v, c.fps) }), '→', num(() => l.out, v => { l.out = Math.max(v, l.in + 1 / c.fps); }, { step: 1 / c.fps, fmt: v => timecode(v, c.fps) })),
    row(t('startTime'), num(() => l.start, v => { const d = v - l.start; l.start = v; l.in += d; l.out += d; }, { step: 1 / c.fps, fmt: v => timecode(v, c.fps) })),
  ];
  if (!['audio', 'camera', 'light', 'null'].includes(l.type)) {
    layerKids.push(row(t('blendMode'), sel(M.BLEND_MODES.map(b => [b, t('blend_' + b)]), l.blend, v => edit('blend', () => { l.blend = v; }))));
    layerKids.push(row(t('trackMatte'), sel(M.MATTE_MODES.map(m => [m, t('matte_' + m)]), l.matte || 'none', v => edit('matte', () => { l.matte = v; const i = c.layers.indexOf(l); if (v !== 'none' && !l.matteLayer && i > 0) l.matteLayer = c.layers[i - 1].id; })),
      l.matte && l.matte !== 'none' ? sel(c.layers.filter(x => x !== l).map(x => [x.id, x.name]), l.matteLayer || '', v => edit('matte', () => { l.matteLayer = v; })) : null));
    layerKids.push(row(t('switches'), chk('3D', l.threeD, v => edit('3d', () => { l.threeD = v; })), chk(t('motionBlur'), l.motionBlur, v => edit('mb', () => { l.motionBlur = v; if (v) c.motionBlur = true; })), chk(t('preserveAlpha'), l.preserveAlpha, v => edit('pa', () => { l.preserveAlpha = v; }))));
  }
  if (l.type !== 'audio') layerKids.push(row(t('parent'), sel([['', t('none')], ...c.layers.filter(x => x !== l).map(x => [x.id, x.name])], l.parent || '', v => edit('parent', () => { l.parent = v || null; }))));
  box.append(section('layer', t('grpLayer'), layerKids));
  // 依類型
  if (l.type === 'text') box.append(textSection(l));
  if (l.type === 'shape') box.append(shapeSection(l));
  if (l.type === 'solid') box.append(section('solid', t('grpSolid'), [
    ...propRows(l, [{ path: 'solid.color', prop: l.solid.color, label: t('pColor'), type: 'color' }]),
    row(t('size'), num(() => l.solid.w, v => { l.solid.w = Math.max(1, Math.round(v)); }), '×', num(() => l.solid.h, v => { l.solid.h = Math.max(1, Math.round(v)); }), h('button', { class: 'ghost small', onclick: () => edit('size', () => { l.solid.w = c.w; l.solid.h = c.h; l.transform.anchor.v = [c.w / 2, c.h / 2, 0]; }) }, t('compSize'))),
  ]));
  if (l.type === 'camera') box.append(section('camera', t('grpCamera'), [
    row(t('cameraType'), sel([['two', t('twoNode')], ['one', t('oneNode')]], l.camera.twoNode ? 'two' : 'one', v => edit('cam', () => { l.camera.twoNode = v === 'two'; }))),
    ...propRows(l, [{ path: 'camera.zoom', prop: l.camera.zoom, label: t('pZoom'), type: 'num', min: 1 }]),
    h('div', { class: 'small dim', style: { padding: '2px 10px' } }, t('orbitHint')),
  ]));
  if (l.type === 'light') box.append(section('light', t('grpLight'), [
    row(t('lightType'), sel(['point', 'spot', 'parallel', 'ambient'].map(k => [k, t('light_' + k)]), l.light.kind, v => edit('light', () => { l.light.kind = v; }))),
    ...propRows(l, [{ path: 'light.intensity', prop: l.light.intensity, label: t('pIntensity'), type: 'pct', min: 0, max: 400 }, { path: 'light.color', prop: l.light.color, label: t('pColor'), type: 'color' }, l.light.kind === 'spot' ? { path: 'light.cone', prop: l.light.cone, label: t('pCone'), type: 'angle' } : null].filter(Boolean)),
  ]));
  if (l.type === 'libbg') box.append(section('lib', t('grpLibBg'), [...propRows(l, [{ path: 'lib.accent', prop: l.lib.accent, label: t('pAccent'), type: 'color' }])]));
  if (l.audio) box.append(section('audio', t('grpAudio'), [...propRows(l, [{ path: 'audio.level', prop: l.audio.level, label: t('pLevel'), type: 'num', min: -48, max: 12, unit: 'dB' }]), row(t('audio'), chk(t('enable'), l.audioOn !== false, v => edit('audio', () => { l.audioOn = v; })))]));
  // 變形
  if (l.type !== 'audio') box.append(section('transform', t('grpTransform'), propRows(l, transformNodes(l).filter(Boolean)), h('button', { class: 'ghost small', onclick: () => edit('resetTr', () => { const fresh = M.transformFor(...resetSize(l, c), c.w, c.h, ['text', 'shape', 'camera', 'light'].includes(l.type)); for (const k of ['anchor', 'position', 'scale', 'rotation', 'rotX', 'rotY', 'opacity']) l.transform[k] = fresh[k]; }) }, t('reset'))));
  // 遮罩
  if (l.masks.length) box.append(section('masks', t('grpMasks'), l.masks.map(m => h('div', null,
    h('div', { class: 'prow' }, h('span', { class: 'watch' }), h('span', { class: 'pl' }, m.name), h('span', { class: 'pv' },
      sel(M.MASK_MODES.map(x => [x, t('mask_' + x)]), m.mode, v => edit('maskMode', () => { m.mode = v; })),
      chk(t('inverted'), m.inverted, v => edit('maskInv', () => { m.inverted = v; })),
      h('button', { class: 'icon', title: t('delete'), onclick: () => edit('delMask', () => { l.masks.splice(l.masks.indexOf(m), 1); }) }, ic('trash')))),
    ...propRows(l, [{ path: `masks.${m.id}.feather`, prop: m.feather, label: t('pFeather'), type: 'num', min: 0 }, { path: `masks.${m.id}.opacity`, prop: m.opacity, label: t('pOpacity'), type: 'pct' }, { path: `masks.${m.id}.expansion`, prop: m.expansion, label: t('pExpansion'), type: 'num' }, { path: `masks.${m.id}.path`, prop: m.path, label: t('pMaskPath'), type: 'path' }]),
  ))));
  // 時間
  if (['video', 'precomp', 'lottie', 'audio'].includes(l.type)) box.append(section('time', t('grpTime'), [
    row(t('speed'), num(() => (l.speed || 1) * 100, v => { l.speed = Math.max(0.01, v / 100); }, { step: 1, fmt: v => fmt('pct', v) })),
    row(t('timeRemap'), chk(t('enable'), l.timeRemap?.on, () => exec('layer.timeRemap'))),
    l.timeRemap?.on ? propRows(l, [{ path: 'timeRemap.p', prop: l.timeRemap.p, label: t('pTimeRemap'), type: 'num', unit: 's' }]) : null,
    h('div', { class: 'chips' }, h('button', { onclick: () => exec('layer.freeze') }, t('freezeFrame')), h('button', { onclick: () => exec('layer.reverse') }, t('reverseTime'))),
  ]));
  // 效果（簡短列表）
  box.append(section('fxlist', t('grpEffects') + ` (${l.effects.length})`, [
    ...l.effects.map(e => h('div', { class: 'prow' }, h('span', { class: 'watch' }), h('span', { class: 'pl', style: { width: 'auto', flex: 1 } }, e.name || t('fx.' + e.type)), h('button', { class: 'ghost small', onclick: () => { S.selEffectId = e.id; bus.emit('showPanel', 'effectControls'); } }, t('edit')))),
    h('div', { class: 'chips' }, h('button', { onclick: () => bus.emit('showPanel', 'effects') }, '+ ' + t('addEffect')), h('button', { onclick: () => bus.emit('showPanel', 'presets') }, '+ ' + t('animPresets'))),
  ]));
  el.append(box);
}
function resetSize(l, c) {
  if (l.type === 'solid') return [l.solid.w, l.solid.h];
  if (['image', 'video', 'lottie'].includes(l.type)) { const f = M.getFootage(S.project, l.source); return [f?.w || 100, f?.h || 100]; }
  if (l.type === 'precomp') { const s = M.getComp(S.project, l.comp); return [s?.w || c.w, s?.h || c.h]; }
  if (l.type === 'null') return [100, 100];
  return [c.w, c.h];
}
function propRows(l, nodes, opts = { slider: false, alpha: true }) { return nodes.flatMap(n => propRow(l, n, opts)); }

function textSection(l) {
  const tx = l.text;
  const fonts = [...new Set([tx.font, ...FONT_LIST, ...(localFonts || [])])];
  const fontSel = sel(fonts.map(f => [f, f]), tx.font, v => edit('font', () => { tx.font = v; }), { style: { maxWidth: '170px' } });
  const kids = [
    ...propRows(l, [{ path: 'text.text', prop: tx.text, label: t('pSourceText'), type: 'text' }]),
    row(t('font'), fontSel, h('button', { class: 'ghost small', title: t('loadLocalFonts'), onclick: loadLocalFonts }, '…')),
    row(t('weight'), sel([[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']].map(([v, n]) => [String(v), n]), String(tx.weight), v => edit('weight', () => { tx.weight = +v; })),
      chk(t('italic'), tx.italic, v => edit('italic', () => { tx.italic = v; })), chk(t('allCaps'), tx.caps, v => edit('caps', () => { tx.caps = v; }))),
    ...propRows(l, [
      { path: 'text.size', prop: tx.size, label: t('fontSize'), type: 'num', min: 1, step: 1 },
      { path: 'text.fill', prop: tx.fill, label: t('pFill'), type: 'color' },
      { path: 'text.stroke', prop: tx.stroke, label: t('pStroke'), type: 'color' },
      { path: 'text.strokeW', prop: tx.strokeW, label: t('pStrokeW'), type: 'num', min: 0, step: 0.5 },
      { path: 'text.tracking', prop: tx.tracking, label: t('tracking'), type: 'num', step: 5 },
      { path: 'text.leading', prop: tx.leading, label: t('leading'), type: 'num', step: 0.01, min: 0.5 },
    ]),
    row(t('align'), sel([['left', t('alignLeft')], ['center', t('alignCenter')], ['right', t('alignRight')]], tx.align, v => edit('align', () => { tx.align = v; })),
      chk(t('fillOn'), tx.fillOn !== false, v => edit('fillOn', () => { tx.fillOn = v; })), chk(t('strokeOver'), tx.strokeOver, v => edit('so', () => { tx.strokeOver = v; }))),
    row(t('paragraphWidth'), num(() => tx.boxW, v => { tx.boxW = Math.max(0, Math.round(v)); }, { step: 2, fmt: v => v ? Math.round(v) + ' px' : t('auto') })),
  ];
  // 文字動畫器
  for (const an of tx.animators) {
    kids.push(h('div', { class: 'fxhead' }, h('input', { type: 'checkbox', checked: an.on !== false, onchange: e => edit('an', () => { an.on = e.target.checked; }) }), h('span', { class: 'nm' }, an.name),
      h('button', { class: 'ghost small', onclick: ev => dropdown(Object.keys(ANIM_PROPS).filter(k => !(k in an.props)).map(k => ({ label: t('ta_' + k), run: () => edit('anProp', () => { an.props[k] = P(clone(ANIM_PROPS[k])); }) })), ev.clientX, ev.clientY) }, '+ ' + t('property')),
      h('button', { class: 'icon', title: t('delete'), onclick: () => edit('anDel', () => { tx.animators.splice(tx.animators.indexOf(an), 1); }) }, ic('trash'))));
    kids.push(row(t('basedOn'), sel(['chars', 'charsNoSpace', 'words', 'lines'].map(k => [k, t('based_' + k)]), an.range.basedOn, v => edit('an', () => { an.range.basedOn = v; })),
      sel(['square', 'rampUp', 'rampDown', 'triangle', 'round', 'smooth'].map(k => [k, t('rshape_' + k)]), an.range.shape, v => edit('an', () => { an.range.shape = v; })),
      chk(t('randomize'), an.range.randomize, v => edit('an', () => { an.range.randomize = v; }))));
    const b = `text.animators.${an.id}.`;
    kids.push(...propRows(l, [
      { path: b + 'range.start', prop: an.range.start, label: t('pStart'), type: 'pct' }, { path: b + 'range.end', prop: an.range.end, label: t('pEnd'), type: 'pct' },
      { path: b + 'range.offset', prop: an.range.offset, label: t('pOffset'), type: 'pct' },
      ...Object.entries(an.props).map(([k, p]) => ({ path: b + 'props.' + k, prop: p, label: t('ta_' + k), type: ANIM_TYPES[k] })),
    ]));
  }
  return section('text', t('grpText'), kids, h('button', { class: 'ghost small', onclick: ev => dropdown(Object.keys(ANIM_PROPS).map(k => ({ label: t('ta_' + k), run: () => exec('anim.addTextAnimator', k) })), ev.clientX, ev.clientY) }, '+ ' + t('addAnimator')));
}
const ANIM_PROPS = { opacity: 0, position: [0, 100], scale: [0, 0], rotation: 90, fill: [1, 0.3, 0.3, 1], stroke: [1, 1, 1, 1], blur: 20, tracking: 200 };
const ANIM_TYPES = { opacity: 'pct', position: 'vec2', scale: 'scale', rotation: 'angle', fill: 'color', stroke: 'color', blur: 'num', tracking: 'num' };
let localFonts = null;
async function loadLocalFonts() {
  if (!window.queryLocalFonts) { toast(t('localFontsUnsupported'), 'warn'); return; }
  try { const fs = await queryLocalFonts(); localFonts = [...new Set(fs.map(f => f.family))].sort(); toast(t('localFontsLoaded', { n: localFonts.length })); bus.emit('select'); } catch (e) { toast(t('localFontsUnsupported'), 'warn'); }
}

function shapeSection(l) {
  const kids = [];
  for (const it of l.shapes) {
    const b = `shapes.${it.id}.`;
    kids.push(h('div', { class: 'fxhead' }, h('input', { type: 'checkbox', checked: it.visible !== false, onchange: e => edit('vis', () => { it.visible = e.target.checked; }) }), h('span', { class: 'nm' }, it.name), h('span', { class: 'fxi' }, t('shape_' + it.kind)),
      h('button', { class: 'ghost small', onclick: ev => dropdown([
        { label: t('pFill'), checked: it.fill.on, run: () => edit('fill', () => { it.fill.on = !it.fill.on; }) },
        { label: t('pStroke'), checked: it.stroke.on, run: () => edit('stroke', () => { it.stroke.on = !it.stroke.on; }) },
        { label: t('pTrim'), checked: it.trim.on, run: () => edit('trim', () => { it.trim.on = !it.trim.on; }) },
        { label: t('pRepeater'), checked: it.repeater.on, run: () => edit('rep', () => { it.repeater.on = !it.repeater.on; }) },
        { label: t('pZigzag'), checked: it.zigzag.on, run: () => edit('zz', () => { it.zigzag.on = !it.zigzag.on; }) },
        { label: t('pWigglePath'), checked: it.wiggle.on, run: () => edit('wg', () => { it.wiggle.on = !it.wiggle.on; }) },
      ], ev.clientX, ev.clientY) }, '+ ' + t('add')),
      h('button', { class: 'icon', title: t('delete'), onclick: () => edit('delShape', () => { l.shapes.splice(l.shapes.indexOf(it), 1); }) }, ic('trash'))));
    const nodes = [];
    if (it.kind === 'rect') nodes.push({ path: b + 'size', prop: it.size, label: t('pSize'), type: 'vec2' }, { path: b + 'round', prop: it.round, label: t('pRoundness'), type: 'num', min: 0 });
    if (it.kind === 'ellipse') nodes.push({ path: b + 'size', prop: it.size, label: t('pSize'), type: 'vec2' });
    if (it.kind === 'star' || it.kind === 'polygon') nodes.push({ path: b + 'points', prop: it.points, label: t('pPoints'), type: 'num', min: 3, step: 1 }, { path: b + 'outerR', prop: it.outerR, label: t('pOuterR'), type: 'num', min: 0 });
    if (it.kind === 'star') nodes.push({ path: b + 'innerR', prop: it.innerR, label: t('pInnerR'), type: 'num', min: 0 });
    nodes.push({ path: b + 'pos', prop: it.pos, label: t('pPosition'), type: 'vec2' }, { path: b + 'rot', prop: it.rot, label: t('pRotation'), type: 'angle' }, { path: b + 'scl', prop: it.scl, label: t('pScale'), type: 'scale' });
    kids.push(...propRows(l, nodes));
    if (it.fill.on) {
      kids.push(row(t('pFill'), sel([['solid', t('fillSolid')], ['linear', t('fillLinear')], ['radial', t('fillRadial')]], it.fill.type, v => edit('fillType', () => { it.fill.type = v; }))));
      kids.push(...propRows(l, [{ path: b + 'fill.color', prop: it.fill.color, label: t('pColor'), type: 'color' }, it.fill.type !== 'solid' ? { path: b + 'fill.color2', prop: it.fill.color2, label: t('pColor2'), type: 'color' } : null,
        it.fill.type !== 'solid' ? { path: b + 'fill.gStart', prop: it.fill.gStart, label: t('pGStart'), type: 'vec2' } : null, it.fill.type !== 'solid' ? { path: b + 'fill.gEnd', prop: it.fill.gEnd, label: t('pGEnd'), type: 'vec2' } : null,
        { path: b + 'fill.opacity', prop: it.fill.opacity, label: t('fillOpacity'), type: 'pct' }].filter(Boolean)));
    }
    if (it.stroke.on) {
      kids.push(...propRows(l, [{ path: b + 'stroke.color', prop: it.stroke.color, label: t('strokeColor'), type: 'color' }, { path: b + 'stroke.width', prop: it.stroke.width, label: t('pStrokeW'), type: 'num', min: 0 }, { path: b + 'stroke.dash', prop: it.stroke.dash, label: t('pDash'), type: 'num', min: 0 }, { path: b + 'stroke.gap', prop: it.stroke.gap, label: t('pGap'), type: 'num', min: 0 }]));
      kids.push(row(t('lineCap'), sel(['butt', 'round', 'square'].map(x => [x, t('cap_' + x)]), it.stroke.cap, v => edit('cap', () => { it.stroke.cap = v; }))));
    }
    if (it.trim.on) kids.push(...propRows(l, [{ path: b + 'trim.start', prop: it.trim.start, label: t('trimStart'), type: 'pct' }, { path: b + 'trim.end', prop: it.trim.end, label: t('trimEnd'), type: 'pct' }, { path: b + 'trim.offset', prop: it.trim.offset, label: t('trimOffset'), type: 'angle' }]));
    if (it.repeater.on) kids.push(...propRows(l, [{ path: b + 'repeater.copies', prop: it.repeater.copies, label: t('pCopies'), type: 'num', min: 1, step: 1 }, { path: b + 'repeater.offset', prop: it.repeater.offset, label: t('repOffset'), type: 'vec2' }, { path: b + 'repeater.rot', prop: it.repeater.rot, label: t('repRotation'), type: 'angle' }, { path: b + 'repeater.scale', prop: it.repeater.scale, label: t('repScale'), type: 'scale' }, { path: b + 'repeater.startOp', prop: it.repeater.startOp, label: t('pStartOp'), type: 'pct' }, { path: b + 'repeater.endOp', prop: it.repeater.endOp, label: t('pEndOp'), type: 'pct' }]));
    if (it.zigzag.on) kids.push(...propRows(l, [{ path: b + 'zigzag.size', prop: it.zigzag.size, label: t('zigSize'), type: 'num' }, { path: b + 'zigzag.ridges', prop: it.zigzag.ridges, label: t('pRidges'), type: 'num', min: 0, step: 1 }]));
    if (it.wiggle.on) kids.push(...propRows(l, [{ path: b + 'wiggle.size', prop: it.wiggle.size, label: t('wigSize'), type: 'num' }, { path: b + 'wiggle.detail', prop: it.wiggle.detail, label: t('pDetail'), type: 'num', min: 1, step: 1 }, { path: b + 'wiggle.speed', prop: it.wiggle.speed, label: t('pSpeed'), type: 'num' }]));
  }
  return section('shape', t('grpContents'), kids, h('button', { class: 'ghost small', onclick: ev => dropdown(['rect', 'ellipse', 'star', 'polygon'].map(k => ({ label: t('shape_' + k), run: () => edit('addShape', () => { l.shapes.unshift(M.shapeItem(k, { name: t('shape_' + k), size: [300, 300], outerR: 150, innerR: 70 })); }) })), ev.clientX, ev.clientY) }, '+ ' + t('add')));
}

// ================= 效果與預設集 =================
let fxSearch = '';
const fxClosed = new Set();
export function renderEffectsPanel(el, mode = 'effects') {
  el.innerHTML = '';
  const search = h('div', { class: 'search' }, ic('zoom'), h('input', { placeholder: t('searchEffects'), value: fxSearch, oninput: e => { fxSearch = e.target.value.toLowerCase(); fill(); }, onkeydown: e => e.stopPropagation() }));
  const list = h('div', { class: 'list' });
  const hint = h('div', { class: 'small dim', style: { padding: '0 10px 6px' } }, t('effectsHint'));
  const fill = () => {
    list.innerHTML = '';
    const cats = mode === 'presets'
      ? PRESET_CATS.map(cat => ({ id: 'p_' + cat, label: t('pcat_' + cat), items: PRESETS.filter(p => p.cat === cat).map(p => ({ id: p.id, name: t('preset_' + p.id), run: () => exec('anim.preset', p.id), icon: 'preset' })) }))
      : [...FX_CATEGORIES.map(cat => ({ id: cat, label: t('fxcat.' + cat), items: EFFECTS.filter(e => e.cat === cat).map(e => ({ id: e.id, name: t('fx.' + e.id), run: () => exec('effect.apply', e.id), icon: 'fx', fx: e.id, gen: e.generator })) })),
        { id: 'control', label: t('fxcat.control'), items: CONTROL_EFFECTS.map(e => ({ id: e.id, name: t('fx.' + e.id), run: () => exec('effect.apply', e.id), icon: 'fx', fx: e.id })) }];
    let total = 0;
    for (const cat of cats) {
      const items = cat.items.filter(it => !fxSearch || it.name.toLowerCase().includes(fxSearch) || it.id.toLowerCase().includes(fxSearch));
      if (!items.length) continue;
      total += items.length;
      const isClosed = !fxSearch && fxClosed.has(cat.id);
      const box = h('div', { class: 'fxcat' + (isClosed ? ' closed' : '') });
      const ch = h('div', { class: 'ch' }, h('span', { class: 'tw' }, '▾'), cat.label, h('span', { class: 'dim small' }, ` (${items.length})`));
      ch.addEventListener('click', () => { if (fxClosed.has(cat.id)) fxClosed.delete(cat.id); else fxClosed.add(cat.id); box.classList.toggle('closed'); });
      const its = h('div', { class: 'items' });
      for (const it of items) {
        const row = h('div', { class: 'fxitem', draggable: true, title: t('dblClickApply') }, ic(it.icon), it.name, it.gen ? h('span', { class: 'badge' }, t('generator')) : null);
        row.addEventListener('dblclick', it.run);
        row.addEventListener('click', e => { if (matchMedia('(pointer: coarse)').matches) it.run(); });
        row.addEventListener('dragstart', e => { e.dataTransfer.setData(it.fx ? 'text/x-xke-fx' : 'text/x-xke-preset', it.id); e.dataTransfer.effectAllowed = 'copy'; });
        its.append(row);
      }
      box.append(ch, its); list.append(box);
    }
    if (!total) list.append(h('div', { class: 'empty' }, t('noMatch')));
  };
  fill();
  el.append(search, hint, list);
}

// ================= 素材庫 =================
let libTab = 'templates';
export const setLibTab = id => { libTab = id; };
export function renderLibrary(el) {
  el.innerHTML = '';
  const tabs = h('div', { class: 'libtabs' });
  const grid = h('div', { class: 'libgrid' });
  const TABS = [['modules', t('lib_modules')], ['templates', t('lib_templates')], ['bg', t('lib_bg')], ['fx', t('lib_fx')], ['stickers', t('lib_stickers')], ['music', t('lib_music')]];
  for (const [id, label] of TABS) tabs.append(h('button', { class: libTab === id ? 'on' : '', onclick: () => { libTab = id; renderLibrary(el); } }, label));
  el.append(tabs, h('div', { class: 'small dim', style: { padding: '0 10px' } }, t('libHint')), h('div', { style: { overflow: 'auto', flex: 1 } }, grid));
  const thumb = (w, hh, fn) => { const cv = h('canvas', { width: w, height: hh }); requestIdleCallback?.(() => { try { fn(cv.getContext('2d'), w, hh); } catch { } }) ?? setTimeout(() => { try { fn(cv.getContext('2d'), w, hh); } catch { } }); return cv; };
  const needC = () => { const c = comp(); if (!c) toast(t('needComp'), 'warn'); return c; };
  if (libTab === 'modules') {
    import('./modules-ui.js').then(m => m.renderModuleLib(grid));
  } else if (libTab === 'templates') {
    import('./templates.js').then(({ TEMPLATES, thumbFor }) => {
      for (const tp of TEMPLATES) {
        const it = h('div', { class: 'libitem', title: t('tpl_' + tp.id + '_d') }, thumbFor(tp.id), h('span', null, t('tpl_' + tp.id)));
        it.addEventListener('click', () => bus.emit('useTemplate', tp.id));
        grid.append(it);
      }
    });
  } else if (libTab === 'bg') {
    for (const k of Object.keys(LIB.BASIC)) {
      const it = h('div', { class: 'libitem' }, thumb(160, 90, (g, w, hh) => LIB.BASIC[k]({ g, W: w, H: hh, t: 1.3, D: 5, acc: '#f0a83a', tw: 0, ty: hh / 2, ts: 0 })), h('span', null, t('libbg_name', { n: Object.keys(LIB.BASIC).indexOf(k) + 1 })));
      it.addEventListener('click', () => { const c = needC(); if (!c) return; edit('addLib', () => { const l = M.makeLibBg(c, k, { name: t('lib_bg') + ' ' + (Object.keys(LIB.BASIC).indexOf(k) + 1) }); addLayer(c, l, { index: c.layers.length }); }); });
      grid.append(it);
    }
  } else if (libTab === 'fx') {
    for (const [key, v] of Object.entries(LIB.GSCR)) {
      const it = h('div', { class: 'libitem' }, thumb(160, 90, (g, w, hh) => { g.fillStyle = '#111'; g.fillRect(0, 0, w, hh); v.fn({ g, W: w, H: hh, t: Math.min(v.dur || 2, 1.2), D: v.dur || 3 }); }), h('span', null, v.name));
      it.addEventListener('click', () => { const c = needC(); if (!c) return; edit('addLib', () => { const l = M.makeLibFx(c, key, { name: v.name }); l.out = Math.min(c.duration, S.time + (v.dur || 3)); l.in = S.time; l.start = S.time; addLayer(c, l); }); });
      grid.append(it);
    }
  } else if (libTab === 'stickers') {
    LIB.STK.forEach(([name], i) => {
      const it = h('div', { class: 'libitem sq' }, (() => { const cv = h('canvas', { width: 96, height: 96 }); setTimeout(() => { const s = Media.stickerCanvas(i); if (s) cv.getContext('2d').drawImage(s, 0, 0, 96, 96); }); return cv; })(), h('span', null, name));
      it.addEventListener('click', async () => { const c = needC(); if (!c) return; const f = await Media.stickerFootage(i); f.name = name; edit('addSticker', () => { S.project.footage.push(f); const l = addFootageLayer(c, f); l.transform.scale.v = [60, 60, 100]; }); });
      grid.append(it);
    });
  } else if (libTab === 'music') {
    const cats = Object.fromEntries(LIB.MUSIC_CATS);
    for (const m of LIB.MUSIC_LIST) {
      const it = h('div', { class: 'libitem' }, h('div', { style: { aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', background: '#14161a' } }, '♪'), h('span', null, `${m.name} · ${cats[m.cat] || ''}`));
      it.addEventListener('click', async () => {
        const c = needC(); if (!c) return;
        toast(t('musicRendering'));
        const buf = await Media.libMusic(m.id);
        if (!buf) return;
        const wav = audioBufferToWav(buf);
        const f = await Media.importFile(new File([wav], m.name + '.wav', { type: 'audio/wav' }));
        edit('addMusic', () => { S.project.footage.push(f); const l = M.makeFootageLayer(c, f); l.out = Math.min(c.duration, f.duration); addLayer(c, l, { index: c.layers.length }); });
      });
      grid.append(it);
    }
  }
}
export function audioBufferToWav(buf) {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const ws = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  ws(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); ws(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([out], { type: 'audio/wav' });
}

// ================= 預覽面板 =================
export function renderPreview(el, ctx) {
  el.innerHTML = '';
  const c = comp();
  const ctrl = h('div', { class: 'pv-ctrl' },
    h('button', { class: 'icon', title: t('firstFrame'), onclick: () => exec('play.first') }, ic('first')),
    h('button', { class: 'icon', title: t('prevFrame'), onclick: () => exec('play.prev') }, ic('prev')),
    h('button', { class: 'icon', title: t('playPause') + ' (Space)', onclick: () => exec('play.toggle') }, ic(S.playing ? 'pause' : 'play')),
    h('button', { class: 'icon', title: t('nextFrame'), onclick: () => exec('play.next') }, ic('next')),
    h('button', { class: 'icon', title: t('lastFrame'), onclick: () => exec('play.last') }, ic('last')));
  const meter = h('div', { class: 'meter' }, h('div'));
  const cacheTxt = h('div', { class: 'small dim', style: { padding: '0 12px' } });
  const update = () => {
    const cc = comp(); if (!cc) return;
    const n = ctx.cacheInfo().n, total = Math.round((cc.workOut - cc.workIn) * cc.fps);
    meter.firstChild.style.width = Math.min(100, n / Math.max(1, total) * 100) + '%';
    cacheTxt.textContent = t('framesCached', { n, total });
  };
  update();
  el.append(ctrl,
    h('div', { class: 'kv' },
      h('span', null, t('shortcut')), h('span', null, 'Space'),
      h('span', null, t('loop')), h('label', null, h('input', { type: 'checkbox', checked: S.loop, onchange: e => { S.loop = e.target.checked; } }), ' ', t('enable')),
      h('span', null, t('range')), h('span', null, t('workArea')),
      h('span', null, t('frameRate')), h('span', null, c ? `(${c.fps})` : '-'),
      h('span', null, t('resolution')), sel([['auto', t('auto')], ['1', t('full')], ['0.5', t('half')], ['0.333', t('third')], ['0.25', t('quarter')]], String(S.res), v => exec('view.res', v)),
      h('span', null, t('renderTime')), h('span', { class: 'rt' }, Math.round(ctx.renderMs()) + ' ms'),
    ), meter, cacheTxt,
    c ? h('div', { class: 'kv' }, h('span', null, t('composition')), h('span', null, c.name), h('span', null, t('size')), h('span', null, `${c.w} × ${c.h}`), h('span', null, t('duration')), h('span', null, timecode(c.duration, c.fps)), h('span', null, t('layers')), h('span', null, String(c.layers.length))) : null);
  el._update = update;
}

// ================= 算繪佇列 =================
export function renderQueue(el) {
  el.innerHTML = '';
  const p = S.project;
  const rq = h('div', { class: 'rq' });
  const prog = h('div', { class: 'bar' }, h('div', { style: { width: '0%' } }), h('span', null, t('rqItems', { n: p.renderQueue.length })));
  const renderBtn = h('button', { class: 'primary', onclick: () => bus.emit('renderQueue', prog, renderBtn) }, t('render'));
  rq.append(h('div', { class: 'top' }, h('b', null, t('currentRender')), h('span', { style: { flex: 1 } }), h('button', { onclick: () => exec('comp.addToRQ') }, '+ ' + t('addToRQ'))), h('div', { class: 'top' }, prog, renderBtn));
  const table = h('table', null, h('thead', null, h('tr', null, ...[t('render'), '#', t('compName'), t('format'), t('resolution'), t('range'), t('status'), ''].map(x => h('th', null, x)))));
  const tb = h('tbody');
  p.renderQueue.forEach((r, i) => {
    const c = M.getComp(p, r.compId);
    tb.append(h('tr', null,
      h('td', null, h('input', { type: 'checkbox', checked: r.on, onchange: e => edit('rq', () => { r.on = e.target.checked; }) })),
      h('td', null, String(i + 1)),
      h('td', null, c?.name || '?'),
      h('td', null, sel(FORMATS.map(f => [f, t('fmt_' + f)]), r.format, v => edit('rq', () => { r.format = v; }))),
      h('td', null, sel([['1', t('full')], ['0.5', t('half')], ['0.25', t('quarter')]], String(r.res), v => edit('rq', () => { r.res = +v; }))),
      h('td', null, sel([['work', t('workArea')], ['full', t('fullComp')]], r.range, v => edit('rq', () => { r.range = v; }))),
      h('td', { class: 'st' }, t('status_' + (r.status || 'queued'))),
      h('td', null, h('button', { class: 'icon', title: t('delete'), onclick: () => edit('rq', () => { p.renderQueue.splice(i, 1); }) }, ic('trash')))));
  });
  table.append(tb);
  if (!p.renderQueue.length) rq.append(h('div', { class: 'empty' }, t('rqEmpty')));
  else rq.append(table);
  rq.append(h('div', { class: 'small dim' }, t('rqHint')));
  el.append(rq);
}
export const FORMATS = ['mp4', 'webm', 'gif', 'png', 'pngseq', 'lottie', 'wav'];
