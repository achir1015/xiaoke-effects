// 主程式：版面、選單、工具列、快捷鍵、播放、拖放、算繪佇列、更新
import { t, LANGS, getLang, setLang, onLangChange } from './i18n.js';
import { S, bus, comp, edit, changed, history, selLayers, firstSel, select, setTime, openComp, loadAutosave, getPath } from './state.js';
import { h, timecode, download, clamp, isMobile } from './util.js';
import { ic } from './icons.js';
import { dropdown, closeMenus, menuOpen, modal, toast, confirmBox, sel, splitter } from './ui.js';
import * as M from './model.js';
import { exec, cmd, COMMANDS, importFiles, loadProject, addFootageLayer, automationAPI, openProjectFile } from './actions.js';
import { mountTimeline, reveal, collapseAll, expandPath } from './timeline.js';
import { tabbed, renderProject, renderEffectControls, renderProps, renderEffectsPanel, renderLibrary, renderPreview, renderQueue } from './panels.js';
import * as Viewer from './viewer.js';
import * as Media from './media.js';
import { setFontReadyHandler } from './text.js';
import { scheduleAudio } from './audio.js';
import { checkWebUpdate, applyWebUpdate, registerSW, APP_VERSION } from './updater.js';
import { applyEase } from './anim.js';
import { fxAvailable } from './fx.js';
import { Desktop, openExternal, whenDesktopReady } from './desktop.js';

const $ = id => document.getElementById(id);
let left, right, bottom, needDraw = true;
const requestDraw = () => { needDraw = true; };
Media.setRedraw(requestDraw);
setFontReadyHandler(() => { requestDraw(); bus.emit('change', 'font'); });

// ================= 選單列 =================
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const K = s => isMac ? s.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : s;
function menus() {
  const c = comp();
  const ls = selLayers();
  return [
    ['menuFile', [
      { label: t('newProject'), key: K('Ctrl+Alt+N'), run: newProject },
      { label: t('open') + '…', key: K('Ctrl+O'), run: () => exec('file.open') },
      { label: t('save'), key: K('Ctrl+S'), run: () => exec('file.save') },
      '-',
      { label: t('import') + '…', key: K('Ctrl+I'), run: () => exec('file.import') },
      { label: t('importLottie') + '…', run: () => exec('file.import') },
      '-',
      { label: t('exportLottie') + '…', disabled: !c, run: () => quickExport('lottie') },
      { label: t('exportVideo') + '…', key: K('Ctrl+M'), disabled: !c, run: () => exportFlow() },
      { label: t('tvMenu') + '…', disabled: !c, run: () => exec('file.toVideo') },
      '-',
      { label: t('modMenu') + '…', run: () => exec('module.decompose') },
      { label: t('modSaveComp'), disabled: !c, run: () => exec('module.saveComp') },
      { label: t('addToRQ'), key: K('Ctrl+Shift+/'), disabled: !c, run: () => exec('comp.addToRQ') },
      '-',
      { label: t('openEngine'), run: openEngine },
    ]],
    ['menuEdit', [
      { label: t('undo'), key: K('Ctrl+Z'), disabled: !history.undo.length, run: () => exec('edit.undo') },
      { label: t('redo'), key: K('Ctrl+Shift+Z'), disabled: !history.redo.length, run: () => exec('edit.redo') },
      '-',
      { label: t('cut'), key: K('Ctrl+X'), run: () => exec('edit.cut') },
      { label: t('copy'), key: K('Ctrl+C'), run: () => exec('edit.copy') },
      { label: t('paste'), key: K('Ctrl+V'), run: () => exec('edit.paste') },
      { label: t('duplicate'), key: K('Ctrl+D'), run: () => exec('edit.duplicate') },
      { label: t('splitLayer'), key: K('Ctrl+Shift+D'), run: () => exec('edit.split') },
      { label: t('delete'), key: 'Delete', run: () => exec('edit.delete') },
      '-',
      { label: t('selectAll'), key: K('Ctrl+A'), run: () => exec('edit.selectAll') },
      { label: t('deselect'), key: 'F2', run: () => exec('edit.deselect') },
      '-',
      { label: t('language'), sub: LANGS.map(l => ({ label: l.name, checked: getLang() === l.code, run: () => setLang(l.code) })) },
    ]],
    ['menuComp', [
      { label: t('newComp') + '…', key: K('Ctrl+N'), run: () => exec('comp.new') },
      { label: t('compSettings') + '…', key: K('Ctrl+K'), disabled: !c, run: () => exec('comp.settings') },
      { label: t('duplicateComp'), disabled: !c, run: () => exec('comp.duplicate') },
      '-',
      { label: t('addToRQ'), disabled: !c, run: () => exec('comp.addToRQ') },
      { label: t('trimToWork'), disabled: !c, run: () => exec('comp.trimToWork') },
      { label: t('snapshot'), key: K('Ctrl+Alt+S'), disabled: !c, run: () => exec('comp.snapshot') },
      { label: t('compMotionBlur'), checked: !!c?.motionBlur, disabled: !c, run: () => exec('comp.motionBlur') },
    ]],
    ['menuLayer', layerMenuItems(ls, c)],
    ['menuEffect', [
      { label: t('applyLastFx'), key: K('Ctrl+Alt+Shift+E'), run: () => exec('effect.last') },
      { label: t('removeAllFx'), key: K('Ctrl+Shift+E'), disabled: !ls.length, run: () => exec('effect.removeAll') },
      '-',
      ...effectSubmenus(),
    ]],
    ['menuAnimation', [
      { label: t('addKeyframe'), disabled: !ls.length, run: () => exec('anim.addKey') },
      { label: t('easyEase'), key: 'F9', run: () => exec('anim.easyEase') },
      { label: t('easeIn'), key: 'Shift+F9', run: () => exec('anim.easeIn') },
      { label: t('easeOut'), key: K('Ctrl+Shift+F9'), run: () => exec('anim.easeOut') },
      { label: t('toggleHold'), key: K('Ctrl+Alt+H'), run: () => exec('anim.hold') },
      { label: t('linear'), run: () => exec('anim.linear') },
      '-',
      { label: t('addExpression'), key: K('Alt+Shift+='), run: () => exec('anim.addExpression') },
      { label: t('addTextAnimator'), disabled: ls[0]?.type !== 'text', sub: ['opacity', 'position', 'scale', 'rotation', 'fill', 'blur', 'tracking'].map(k => ({ label: t('ta_' + k), run: () => exec('anim.addTextAnimator', k) })) },
      { label: t('animPresets'), sub: () => presetSubmenus() },
      '-',
      { label: t('prevKey'), key: 'J', run: () => exec('anim.prevKey') },
      { label: t('nextKey'), key: 'K', run: () => exec('anim.nextKey') },
      { label: t('revealAnimated'), key: 'U', run: () => reveal('U') },
    ]],
    ['menuView', [
      { label: t('zoomIn'), key: '.', run: () => Viewer.setZoom(Viewer.viewZoom() * 1.25) },
      { label: t('zoomOut'), key: ',', run: () => Viewer.setZoom(Viewer.viewZoom() / 1.25) },
      { label: t('fitView'), key: 'Shift+/', run: () => Viewer.setZoom('fit') },
      { label: t('zoom100'), run: () => Viewer.setZoom(1) },
      '-',
      { label: t('resolution'), sub: [['auto', t('auto')], ['1', t('full')], ['0.5', t('half')], ['0.333', t('third')], ['0.25', t('quarter')]].map(([v, l]) => ({ label: l, checked: String(S.res) === v, run: () => exec('view.res', v) })) },
      { label: t('showGrid'), key: "'", checked: S.showGrid, run: () => exec('view.toggle', 'showGrid') },
      { label: t('showSafe'), checked: S.showSafe, run: () => exec('view.toggle', 'showSafe') },
      { label: t('transparencyGrid'), checked: S.transparentGrid, run: () => exec('view.toggle', 'transparentGrid') },
      { label: t('snapping'), checked: S.snapping, run: () => exec('view.toggle', 'snapping') },
      { label: t('graphEditor'), key: 'Shift+F3', checked: S.graph, run: () => exec('view.graph') },
      '-',
      { label: t('workspace'), sub: ['default', 'animation', 'effects', 'small'].map(w => ({ label: t('ws_' + w), run: () => setWorkspace(w) })) },
    ]],
    ['menuHelp', [
      { label: t('shortcuts'), key: '?', run: () => import('./dialogs.js').then(m => m.shortcutsDialog()) },
      { label: t('checkUpdate'), run: () => checkUpdate(true) },
      Desktop.available ? null : { label: t('downloadDesktop'), run: () => openExternal('https://github.com/achir1015/xiaoke-effects/releases/latest') },
      { label: t('openEngine'), run: openEngine },
      { label: t('about'), run: () => import('./dialogs.js').then(m => m.aboutDialog()) },
    ]],
  ];
}
function layerMenuItems(ls, c) {
  const l = ls[0];
  const dis = !ls.length;
  return [
    { label: t('newLayer'), sub: [
      { label: t('newText'), key: K('Ctrl+Alt+Shift+T'), disabled: !c, run: () => exec('layer.newText') },
      { label: t('newSolid') + '…', key: K('Ctrl+Y'), disabled: !c, run: () => exec('layer.newSolid') },
      { label: t('newShape'), disabled: !c, run: () => exec('layer.newShape', { kind: 'rect', size: [500, 300] }) },
      { label: t('newNull'), key: K('Ctrl+Alt+Shift+Y'), disabled: !c, run: () => exec('layer.newNull') },
      { label: t('newAdjust'), key: K('Ctrl+Alt+Y'), disabled: !c, run: () => exec('layer.newAdjust') },
      { label: t('newCamera'), key: K('Ctrl+Alt+Shift+C'), disabled: !c, run: () => exec('layer.newCamera') },
      { label: t('newLight'), sub: ['point', 'spot', 'parallel', 'ambient'].map(k => ({ label: t('light_' + k), disabled: !c, run: () => exec('layer.newLight', k) })) },
    ] },
    { label: t('layerSettings') + '…', disabled: dis, run: () => exec('layer.settings') },
    { label: t('rename'), key: 'Enter', disabled: dis, run: () => exec('layer.rename') },
    '-',
    { label: t('modReplace') + '…', disabled: !c, run: () => exec('module.replacePhoto') },
    { label: t('mask'), disabled: dis, sub: [{ label: t('newMaskRect'), run: () => exec('layer.newMaskRect') }, { label: t('newMaskEllipse'), run: () => exec('layer.newMaskEllipse') }] },
    { label: t('layer3D'), checked: !!l?.threeD, disabled: dis, run: () => exec('layer.toggle3D') },
    { label: t('motionBlur'), checked: !!l?.motionBlur, disabled: dis, run: () => exec('layer.toggleMB') },
    { label: t('time'), disabled: dis, sub: [
      { label: t('timeRemap'), key: K('Ctrl+Alt+T'), checked: !!l?.timeRemap?.on, run: () => exec('layer.timeRemap') },
      { label: t('freezeFrame'), run: () => exec('layer.freeze') },
      { label: t('reverseTime'), run: () => exec('layer.reverse') },
    ] },
    { label: t('transform'), disabled: dis, sub: [
      { label: t('fitToComp'), key: K('Ctrl+Alt+F'), run: () => exec('layer.fitToComp') },
      { label: t('centerAnchor'), key: K('Ctrl+Alt+Home'), run: () => exec('layer.centerAnchor') },
    ] },
    { label: t('blendMode'), disabled: dis, sub: M.BLEND_MODES.map(b => ({ label: t('blend_' + b), checked: l?.blend === b, run: () => edit('blend', () => ls.forEach(x => { x.blend = b; })) })) },
    { label: t('arrange'), disabled: dis, sub: [
      { label: t('bringFront'), key: K('Ctrl+Shift+]'), run: () => exec('layer.front') },
      { label: t('bringForward'), key: K('Ctrl+]'), run: () => exec('layer.forward') },
      { label: t('sendBackward'), key: K('Ctrl+['), run: () => exec('layer.backward') },
      { label: t('sendBack'), key: K('Ctrl+Shift+['), run: () => exec('layer.back') },
    ] },
    '-',
    { label: t('precompose') + '…', key: K('Ctrl+Shift+C'), disabled: dis, run: () => exec('comp.precompose') },
    { label: t('splitLayer'), key: K('Ctrl+Shift+D'), disabled: dis, run: () => exec('edit.split') },
    { label: t('duplicate'), key: K('Ctrl+D'), disabled: dis, run: () => exec('edit.duplicate') },
    { label: t('delete'), key: 'Delete', disabled: dis, run: () => exec('edit.delete') },
  ];
}
let fxMod = null;
function effectSubmenus() {
  if (!fxMod) return [];
  const cats = [...fxMod.FX_CATEGORIES.map(cat => ({ label: t('fxcat.' + cat), sub: fxMod.EFFECTS.filter(e => e.cat === cat).map(e => ({ label: t('fx.' + e.id), run: () => exec('effect.apply', e.id) })) }))];
  return cats.filter(c => c.sub.length);
}
let presetMod = null;
function presetSubmenus() {
  if (!presetMod) return [];
  return presetMod.PRESET_CATS.map(cat => ({ label: t('pcat_' + cat), sub: presetMod.PRESETS.filter(p => p.cat === cat).map(p => ({ label: t('preset_' + p.id), run: () => exec('anim.preset', p.id) })) }));
}
import('./fx.js').then(m => { fxMod = m; });
import('./presets.js').then(m => { presetMod = m; });

function buildMenubar() {
  const mb = $('menubar');
  mb.innerHTML = '';
  mb.append(h('div', { class: 'logo' }, h('img', { src: 'icons/icon-192.png', alt: '' }), h('span', null, t('appShort'))));
  const defs = menus();
  for (const [key] of defs) {
    const b = h('button', { class: 'menu-btn' }, t(key));
    const openIt = () => { const d = menus().find(x => x[0] === key); const r = b.getBoundingClientRect(); dropdown(d[1], r.left, r.bottom + 2); b.classList.add('open'); };
    b.addEventListener('click', e => { e.stopPropagation(); if (b.classList.contains('open')) { closeMenus(); return; } openIt(); });
    b.addEventListener('pointerenter', () => { if (menuOpen() && document.querySelector('.menu-btn.open') && !b.classList.contains('open')) { closeMenus(); openIt(); } });
    mb.append(b);
  }
  mb.append(h('div', { class: 'spacer' }));
  mb.append(sel(LANGS.map(l => [l.code, l.name]), getLang(), v => setLang(v), { title: t('language'), style: { maxWidth: '110px' } }));
  mb.append(h('button', { class: 'icon', title: t('engineTitle'), onclick: openEngine }, ic('engine')));
  mb.append(h('button', { class: 'icon', title: t('shortcuts'), onclick: () => import('./dialogs.js').then(m => m.shortcutsDialog()) }, ic('help')));
}

// ================= 工具列 =================
const TOOLS = [['select', 'V'], ['hand', 'H'], ['zoom', 'Z'], ['rotate', 'W'], ['anchor', 'Y'], ['orbit', 'C'], null, ['rect', 'Q'], ['ellipse', 'Q'], ['star', 'Q'], ['polygon', 'Q'], ['pen', 'G'], ['text', K('Ctrl+T')]];
const TOOL_ICON = { select: 'select', hand: 'hand', zoom: 'zoom', rotate: 'rotate', anchor: 'anchor', orbit: 'orbit', rect: 'rect', ellipse: 'ellipse', star: 'star', polygon: 'polygon', pen: 'pen', text: 'text' };
function buildToolbar() {
  const tb = $('toolbar');
  tb.innerHTML = '';
  tb.append(h('button', { class: 'icon', title: t('newProject'), onclick: newProject }, ic('plus')),
    h('button', { class: 'icon', title: t('open'), onclick: () => exec('file.open') }, ic('folder')),
    h('button', { class: 'icon', title: t('save'), onclick: () => exec('file.save') }, ic('save')),
    h('button', { class: 'icon', title: t('undo'), onclick: () => exec('edit.undo') }, ic('undo')),
    h('button', { class: 'icon', title: t('redo'), onclick: () => exec('edit.redo') }, ic('redo')),
    h('div', { class: 'sep' }));
  for (const tl of TOOLS) {
    if (!tl) { tb.append(h('div', { class: 'sep' })); continue; }
    const [id, key] = tl;
    const b = h('button', { class: 'icon' + (S.tool === id ? ' on' : ''), title: `${t('tool_' + id)} (${key})`, 'data-tool': id, onclick: () => setTool(id) }, ic(TOOL_ICON[id]));
    tb.append(b);
  }
  tb.append(h('div', { class: 'sep' }),
    h('label', null, h('input', { type: 'checkbox', checked: S.snapping, onchange: e => { S.snapping = e.target.checked; } }), t('snapping')),
    h('div', { class: 'sep' }),
    h('button', { class: 'primary', style: { padding: '3px 12px' }, onclick: () => exportFlow() }, ic('export'), ' ', t('exportShort')),
    h('button', { style: { padding: '3px 10px', marginLeft: '4px' }, title: t('tvMenu'), onclick: () => exec('file.toVideo') }, ic('video'), ' ', t('tvShort')));
  const ws = h('div', { class: 'ws' });
  for (const w of ['default', 'animation', 'effects', 'small']) ws.append(h('button', { class: (localStorage.getItem('xke.ws') || 'default') === w ? 'on' : '', onclick: () => setWorkspace(w) }, t('ws_' + w)));
  tb.append(ws);
}
function setTool(id) {
  S.tool = id;
  document.querySelectorAll('#toolbar [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
  requestDraw();
}
bus.on('tool', () => setTool(S.tool));
function setWorkspace(w) {
  try { localStorage.setItem('xke.ws', w); } catch { }
  const r = document.documentElement.style;
  const sizes = { default: ['270px', '310px', '38%'], animation: ['230px', '300px', '50%'], effects: ['300px', '340px', '34%'], small: ['0px', '280px', '42%'] };
  const [lw, rw, bh] = sizes[w] || sizes.default;
  $('work').style.setProperty('--lw', lw); $('work').style.setProperty('--rw', rw); $('work').style.setProperty('--bh', bh);
  if (w === 'animation') { S.graph = true; bus.emit('timelineMode'); } else if (S.graph && w !== 'animation') { S.graph = false; bus.emit('timelineMode'); }
  if (w === 'effects') right.show('effects');
  buildToolbar();
  requestDraw();
}

// ================= 面板 =================
function buildPanels() {
  for (const id of ['pLeft', 'pRight', 'pBottom']) $(id).innerHTML = '';
  left = tabbed($('pLeft'), [
    { id: 'project', label: () => t('panelProject'), render: renderProject },
    { id: 'effectControls', label: () => t('panelEffectControls'), render: renderEffectControls },
  ]);
  const ctx = { cacheInfo: Viewer.cacheInfo, renderMs: Viewer.getRenderMs };
  right = tabbed($('pRight'), [
    { id: 'props', label: () => t('panelProps'), render: renderProps },
    { id: 'effects', label: () => t('panelEffects'), render: el => renderEffectsPanel(el, 'effects') },
    { id: 'presets', label: () => t('panelPresets'), render: el => renderEffectsPanel(el, 'presets') },
    { id: 'library', label: () => t('panelLibrary'), render: renderLibrary },
    { id: 'preview', label: () => t('panelPreview'), render: el => renderPreview(el, ctx) },
  ]);
  const tlHost = h('div', { style: { height: '100%' } });
  bottom = tabbed($('pBottom'), [
    { id: 'timeline', label: () => comp()?.name || t('panelTimeline'), render: () => { } },
    { id: 'render', label: () => t('panelRenderQueue'), render: renderQueue },
  ]);
  $('pBottom').querySelector('.pbody .page').append(tlHost);
  mountTimeline(tlHost);
  // 手機下方分頁
  const mt = $('mtabs'); mt.innerHTML = '';
  for (const [id, icon, label] of [['timeline', 'timeline', 'panelTimeline'], ['props', 'props', 'panelProps'], ['effects', 'fx', 'panelEffects'], ['library', 'library', 'panelLibrary'], ['project', 'folder', 'panelProject'], ['render', 'render', 'panelRenderQueue']]) {
    mt.append(h('button', { class: document.body.dataset.mtab === id ? 'on' : '', 'data-m': id, onclick: () => mobileTab(id) }, ic(icon), t(label)));
  }
}
function mobileTab(id) {
  document.body.dataset.mtab = id;
  document.querySelectorAll('#mtabs button').forEach(b => b.classList.toggle('on', b.dataset.m === id));
  if (id === 'props' || id === 'effects' || id === 'library') right.show(id);
  if (id === 'timeline' || id === 'render') bottom.show(id);
  if (id === 'project') left.show('project');
  requestDraw();
}
bus.on('showPanel', id => {
  if (id === 'effectControls') { left.show('effectControls'); if (isMobile()) { right.show('props'); mobileTab('props'); } }
  else if (id === 'render') { bottom.show('render'); if (isMobile()) mobileTab('render'); }
  else if (right.has(id)) { right.show(id); if (isMobile()) mobileTab(id === 'presets' ? 'effects' : id); }
});

// 面板內容更新（避免拖曳中重建）
let panelPending = false;
function refreshPanels() {
  if (panelPending) return;
  panelPending = true;
  requestAnimationFrame(() => {
    panelPending = false;
    if (S.uiDrag) return;
    if (document.activeElement?.closest?.('#pRight textarea, #pLeft textarea, #pRight input:not([type=checkbox]), #pLeft input:not([type=checkbox])')) return;
    if (left.current() === 'effectControls') left.refresh();
    if (left.current() === 'project') left.refresh();
    if (right.current() === 'props') right.refresh();
    if (bottom.current() === 'render') bottom.refresh();
  });
}
bus.on('change', w => { requestDraw(); if (w !== 'drag' && w !== 'tldrag' && w !== 'text' && w !== 'expr') refreshPanels(); bottom?.relabel(); updateStatus(); });
bus.on('select', () => { requestDraw(); refreshPanels(); });
bus.on('propSelected', () => refreshPanels());
bus.on('comp', () => { buildCompTabs(); buildViewFoot(); Viewer.setZoom('fit'); bottom?.relabel(); refreshPanels(); requestDraw(); });
bus.on('time', () => { requestDraw(); updateTC(); });
bus.on('view', () => { buildViewFoot(); requestDraw(); });
bus.on('zoomChanged', () => { const z = $('viewFoot').querySelector('.zsel'); if (z) z.value = S.zoom === 'fit' ? 'fit' : ''; });
bus.on('libTab', async id => { (await import('./panels.js')).setLibTab(id); right.show('library'); if (isMobile()) mobileTab('library'); });
bus.on('cache', () => { if (right.current() === 'preview') { const el = $('pRight').querySelector('.page:not(.hidden)'); el?._update?.(); } });

// 檢視器上方的合成頁籤與下方工具列
function buildCompTabs() {
  const el = $('compTabs'); el.innerHTML = '';
  S.openComps = S.openComps.filter(id => M.getComp(S.project, id));
  for (const id of S.openComps) {
    const c = M.getComp(S.project, id);
    const b = h('button', { class: id === S.compId ? 'on' : '', onclick: () => openComp(id) }, c.name);
    b.addEventListener('auxclick', e => { if (e.button === 1) { S.openComps = S.openComps.filter(x => x !== id); buildCompTabs(); } });
    el.append(b);
  }
  el.classList.toggle('single', S.openComps.length <= 1);
  $('pViewer').classList.toggle('tall', !!comp() && comp().h > comp().w);
  const vt = $('viewerTabs'); vt.innerHTML = '';
  vt.append(h('button', { class: 'ptab on' }, t('composition') + (comp() ? ': ' + comp().name : '')));
}
function buildViewFoot() {
  const f = $('viewFoot'); f.innerHTML = '';
  const c = comp();
  const zs = sel([['fit', t('fit')], ['', t('custom')], ['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['2', '200%'], ['4', '400%']], S.zoom === 'fit' ? 'fit' : (['0.25', '0.5', '0.75', '1', '2', '4'].includes(String(S.zoom)) ? String(S.zoom) : ''), v => { if (v) Viewer.setZoom(v === 'fit' ? 'fit' : +v); }, { class: 'zsel', title: t('zoom') });
  f.append(zs,
    h('button', { class: 'icon' + (S.showGrid ? ' on' : ''), title: t('showGrid'), onclick: () => exec('view.toggle', 'showGrid') }, ic('grid')),
    h('button', { class: 'icon' + (S.showSafe ? ' on' : ''), title: t('showSafe'), onclick: () => exec('view.toggle', 'showSafe') }, ic('safe')),
    h('span', { class: 'tc', title: t('goToTime'), onclick: () => $('tlHead')?.querySelector('.tc')?.click() }, c ? timecode(S.time, c.fps) : ''),
    h('button', { class: 'icon', title: t('snapshot'), onclick: () => exec('comp.snapshot') }, ic('snapshot')),
    sel([['auto', t('auto')], ['1', t('full')], ['0.5', t('half')], ['0.333', t('third')], ['0.25', t('quarter')]], String(S.res), v => exec('view.res', v), { title: t('resolution') }),
    h('button', { class: 'icon' + (S.transparentGrid ? ' on' : ''), title: t('transparencyGrid'), onclick: () => exec('view.toggle', 'transparentGrid') }, ic('checker')),
    h('button', { class: 'icon', title: t('playPause'), onclick: () => exec('play.toggle') }, ic(S.playing ? 'pause' : 'play')),
    h('span', { class: 'grow' }),
    h('span', { class: 'small dim rms' }, ''));
}
function updateTC() { const c = comp(); const el = $('viewFoot').querySelector('.tc'); if (el && c) el.textContent = timecode(S.time, c.fps); }
function updateStatus() {
  const sb = $('statusbar'); const c = comp();
  sb.innerHTML = '';
  sb.append(h('span', { class: 'grow' }, S.statusMsg || (c ? `${c.name} · ${c.w}×${c.h} · ${c.fps} fps · ${c.layers.length} ${t('layers')}` : t('appName'))),
    h('span', null, t('renderTime') + ': ' + Math.round(Viewer.getRenderMs()) + ' ms'), h('span', null, 'v' + APP_VERSION));
}

// ================= 播放 =================
let playStart = 0, clockStart = 0, audioNodes = [], usingAudio = false;
async function startPlay() {
  const c = comp(); if (!c) return;
  if (S.time >= c.workOut - 1 / c.fps || S.time < c.workIn) setTime(c.workIn, { force: true });
  S.playing = true;
  playStart = S.time; clockStart = performance.now() / 1000;
  buildViewFoot(); if (right.current() === 'preview') right.refresh();
  await startAudio();
}
async function startAudio() {
  stopAudio();
  const c = comp(); if (!c) return;
  try {
    const ac = Media.audioCtx();
    if (ac.state === 'suspended') await ac.resume();
    const when = ac.currentTime + 0.06;
    const n = await scheduleAudio(ac, ac.destination, S.project, c, S.time, c.workOut, when, audioNodes);
    if (n && S.playing) { usingAudio = true; playStart = S.time; clockStart = when; }
  } catch (e) { console.warn('audio', e); }
}
function stopAudio() { for (const n of audioNodes) { try { n.stop(); } catch { } } audioNodes = []; usingAudio = false; }
function stopPlay() { S.playing = false; stopAudio(); Media.pauseVideos(); buildViewFoot(); requestDraw(); if (right.current() === 'preview') right.refresh(); bus.emit('change', 'stopPlay'); }
bus.on('playToggle', () => S.playing ? stopPlay() : startPlay());
bus.on('change', w => { if (S.playing && w !== 'stopPlay' && w !== 'drag' && w !== 'tldrag') { /* 編輯時繼續播放 */ } });

function loop() {
  const c = comp();
  if (S.playing && c) {
    const now = usingAudio ? Media.audioCtx().currentTime : performance.now() / 1000;
    let tt = playStart + Math.max(0, now - clockStart);
    if (tt >= c.workOut - 1e-6) {
      if (S.loop) { tt = c.workIn; S.time = tt; playStart = tt; clockStart = performance.now() / 1000; bus.emit('time', tt); startAudio(); }
      else { setTime(c.workOut - 1 / c.fps); stopPlay(); }
    } else {
      const f = Math.floor(tt * c.fps) / c.fps;
      if (f !== S.time) { S.time = f; bus.emit('time', f); }
    }
  }
  if (needDraw) { needDraw = false; Viewer.draw(); const r = $('viewFoot').querySelector('.rms'); if (r) r.textContent = `${Math.round(Viewer.getRenderMs())} ms · ${Math.round(Viewer.getRes() * 100)}%`; }
  requestAnimationFrame(loop);
}

// ================= 快捷鍵 =================
let lastKey = '', lastKeyT = 0;
addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (document.querySelector('.modal-bg')) return;
  const k = e.key, ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey, alt = e.altKey;
  const run = (id, ...a) => { e.preventDefault(); exec(id, ...a); };
  const combo = (ctrl ? 'C' : '') + (alt ? 'A' : '') + (sh ? 'S' : '') + '+' + (k.length === 1 ? k.toUpperCase() : k);
  const map = {
    'C+Z': 'edit.undo', 'CS+Z': 'edit.redo', 'C+Y': 'layer.newSolid', 'C+S': 'file.save', 'C+O': 'file.open', 'C+I': 'file.import', 'C+N': 'comp.new', 'C+K': 'comp.settings', 'C+M': '__export',
    'C+C': 'edit.copy', 'C+X': 'edit.cut', 'C+V': 'edit.paste', 'C+D': 'edit.duplicate', 'CS+D': 'edit.split', 'C+A': 'edit.selectAll', '+F2': 'edit.deselect',
    'CAS+T': 'layer.newText', 'CAS+Y': 'layer.newNull', 'CA+Y': 'layer.newAdjust', 'CAS+C': 'layer.newCamera', 'CS+C': 'comp.precompose', 'CA+T': 'layer.timeRemap', 'CA+F': 'layer.fitToComp', 'CA+Home': 'layer.centerAnchor',
    'C+]': 'layer.forward', 'C+[': 'layer.backward', 'CS+]': 'layer.front', 'CS+[': 'layer.back', 'CS+}': 'layer.front', 'CS+{': 'layer.back', 'A+[': 'layer.trimIn', 'A+]': 'layer.trimOut', '+[': 'layer.moveInTo', '+]': 'layer.moveOutTo',
    '+F9': 'anim.easyEase', 'S+F9': 'anim.easeIn', 'CS+F9': 'anim.easeOut', 'CA+H': 'anim.hold', 'AS+=': 'anim.addExpression', 'AS++': 'anim.addExpression', 'CS+E': 'effect.removeAll', 'CAS+E': 'effect.last',
    '+J': 'anim.prevKey', '+K': 'anim.nextKey', '+I': 'play.layerIn', '+O': 'play.layerOut', '+B': 'comp.workIn', '+N': 'comp.workOut', '+Home': 'play.first', '+End': 'play.last',
    'S+=': 'layer.blendNext', 'S++': 'layer.blendNext', 'S+-': 'layer.blendPrev', 'S+_': 'layer.blendPrev', 'CA+S': 'comp.snapshot', 'S+F3': 'view.graph', 'CS+/': 'comp.addToRQ', 'CS+?': 'comp.addToRQ',
    '+Delete': 'edit.delete', '+Backspace': 'edit.delete',
  };
  if (k === ' ' && !ctrl) { e.preventDefault(); if (!e.repeat) exec('play.toggle'); return; }
  if (combo === 'C+M') { e.preventDefault(); exportFlow(); return; }
  if (map[combo]) { run(map[combo]); return; }
  if (k === 'PageUp' || (ctrl && k === 'ArrowLeft')) { run('play.prev', sh ? 10 : 1); return; }
  if (k === 'PageDown' || (ctrl && k === 'ArrowRight')) { run('play.next', sh ? 10 : 1); return; }
  if (k === 'Enter' && !ctrl && firstSel()) { run('layer.rename'); return; }
  if (sh && (k === '?' || k === '/')) { e.preventDefault(); Viewer.setZoom('fit'); return; }
  if (k === '.' && !ctrl) { e.preventDefault(); Viewer.setZoom(Viewer.viewZoom() * 1.25); return; }
  if (k === ',' && !ctrl) { e.preventDefault(); Viewer.setZoom(Viewer.viewZoom() / 1.25); return; }
  if (k === "'" && !ctrl) { e.preventDefault(); exec('view.toggle', 'showGrid'); return; }
  if (ctrl && k.toLowerCase() === 't') { e.preventDefault(); setTool('text'); return; }
  // 方向鍵：微移選取的圖層
  if (k.startsWith('Arrow') && !ctrl && selLayers().length) {
    e.preventDefault();
    const d = sh ? 10 : 1, dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
    import('./anim.js').then(({ rawAt, setValue }) => edit('nudge', () => { for (const l of selLayers()) { const p = rawAt(l.transform.position, S.time - l.start); setValue(l.transform.position, S.time - l.start, [p[0] + dx, p[1] + dy, p[2] || 0]); } }));
    return;
  }
  if (ctrl || e.repeat) return;
  const up = k.toUpperCase();
  // 屬性顯示：P S R T A M E L F U（Alt+Shift＝加關鍵影格）
  if ('PSRTAMELFU'.includes(up) && k.length === 1) {
    e.preventDefault();
    if (alt && sh && 'PSRT'.includes(up)) {
      const prop = { P: 'position', S: 'scale', R: 'rotation', T: 'opacity' }[up];
      import('./anim.js').then(({ setKey, rawAt }) => edit('key', () => { for (const l of selLayers()) { const p = l.transform[prop]; setKey(p, S.time - l.start, JSON.parse(JSON.stringify(rawAt(p, S.time - l.start)))); } }));
      return;
    }
    const now = performance.now();
    if (up === 'E' && lastKey === 'E' && now - lastKeyT < 400) { /* EE：顯示有表達式的屬性 */ S.revealed = 'U'; bus.emit('reveal'); return; }
    if (up === 'U' && lastKey === 'U' && now - lastKeyT < 400) { S.revealed = 'U'; bus.emit('reveal'); }
    lastKey = up; lastKeyT = now;
    // 沒有工具快捷鍵衝突的才當屬性鍵；R、T 等同時也是工具時，以屬性為主（和 After Effects 相同）
    reveal(up, sh);
    return;
  }
  const tool = { V: 'select', H: 'hand', Z: 'zoom', W: 'rotate', Y: 'anchor', G: 'pen', C: 'orbit' }[up];
  if (tool) { e.preventDefault(); setTool(tool); return; }
  if (up === 'Q') { e.preventDefault(); const cyc = ['rect', 'ellipse', 'star', 'polygon']; const i = cyc.indexOf(S.tool); setTool(cyc[(i + 1) % cyc.length]); return; }
  if (k === 'Escape') { if (S.revealed) { S.revealed = null; bus.emit('reveal'); } }
});

// ================= 右鍵選單 =================
bus.on('layerMenu', (x, y) => dropdown(layerMenuItems(selLayers(), comp()), x, y));
bus.on('keyMenu', (x, y) => dropdown([
  { label: t('easyEase'), key: 'F9', run: () => exec('anim.easyEase') },
  { label: t('easeIn'), run: () => exec('anim.easeIn') },
  { label: t('easeOut'), run: () => exec('anim.easeOut') },
  { label: t('linear'), run: () => exec('anim.linear') },
  { label: t('toggleHold'), run: () => exec('anim.hold') },
  '-',
  { label: t('copy'), run: () => exec('edit.copy') },
  { label: t('delete'), run: () => exec('edit.delete') },
], x, y));
bus.on('propMenu', (x, y, l, n) => dropdown([
  { label: t('addKeyframe'), run: () => exec('anim.addKey') },
  { label: t('addExpression'), run: () => exec('anim.addExpression') },
  { label: t('exprWiggle'), run: () => edit('expr', () => { n.prop.x = 'wiggle(2, 30)'; n.prop.xon = true; }) },
  { label: t('exprLoop'), run: () => edit('expr', () => { n.prop.x = "loopOut('cycle')"; n.prop.xon = true; }) },
  { label: t('exprTime'), run: () => edit('expr', () => { n.prop.x = typeof n.prop.v === 'number' ? 'value + time * 60' : 'value'; n.prop.xon = true; }) },
  '-',
  { label: t('selectAllKeys'), run: () => { S.selKeys.clear(); for (const k of n.prop.k || []) S.selKeys.set(k, { layerId: l.id, path: n.path }); bus.emit('select'); } },
  { label: t('removeKeys'), disabled: !n.prop.k, run: () => edit('rmKeys', () => { const v = n.prop.k[0]?.v; delete n.prop.k; n.prop.v = JSON.parse(JSON.stringify(v ?? n.prop.v)); }) },
  { label: t('showInTimeline'), run: () => expandPath(l.id, n.path) },
], x, y));
bus.on('nodeMenu', (x, y, l, node) => {
  const items = [];
  if (node.kind === 'effect') items.push({ label: t('delete'), run: () => edit('fxDel', () => { l.effects = l.effects.filter(e => e !== node.item); }) }, { label: t('reset'), run: () => edit('reset', () => { node.item.params = M.makeEffect(fxMod.getEffect(node.item.type) || { params: [] }, l, S.project).params; }) });
  if (node.kind === 'mask') items.push({ label: t('delete'), run: () => edit('delMask', () => { l.masks = l.masks.filter(m => m !== node.item); }) });
  if (node.kind === 'shapeItem') items.push({ label: t('delete'), run: () => edit('delShape', () => { l.shapes = l.shapes.filter(s => s !== node.item); }) });
  if (node.kind === 'animator') items.push({ label: t('delete'), run: () => edit('delAn', () => { l.text.animators = l.text.animators.filter(a => a !== node.item); }) });
  if (items.length) dropdown(items, x, y);
});
bus.on('addMenu', (x, y, l, node) => {
  if (node.kind === 'textGroup' || node.kind === 'animator') { dropdown(['opacity', 'position', 'scale', 'rotation', 'fill', 'blur', 'tracking'].map(k => ({ label: t('ta_' + k), run: () => exec('anim.addTextAnimator', k) })), x, y); return; }
  if (node.kind === 'contents') { dropdown(['rect', 'ellipse', 'star', 'polygon'].map(k => ({ label: t('shape_' + k), run: () => edit('addShape', () => l.shapes.unshift(M.shapeItem(k, { name: t('shape_' + k), size: [300, 300], outerR: 150, innerR: 70 }))) })), x, y); return; }
  if (node.kind === 'shapeItem') { const it = node.item; dropdown([['fill', 'pFill'], ['stroke', 'pStroke'], ['trim', 'pTrim'], ['repeater', 'pRepeater'], ['zigzag', 'pZigzag'], ['wiggle', 'pWigglePath']].map(([k, lb]) => ({ label: t(lb), checked: it[k].on, run: () => edit('toggle', () => { it[k].on = !it[k].on; }) })), x, y); }
});

// ================= 拖放 =================
let dz = null;
addEventListener('dragover', e => {
  e.preventDefault();
  if (e.dataTransfer.types.includes('Files') && !dz) { dz = h('div', { class: 'dropzone' }, t('dropHere')); document.body.append(dz); }
});
addEventListener('dragleave', e => { if (!e.relatedTarget && dz) { dz.remove(); dz = null; } });
addEventListener('drop', async e => {
  e.preventDefault(); dz?.remove(); dz = null;
  const dt = e.dataTransfer;
  const overViewer = e.target.closest?.('#viewWrap');
  const fxId = dt.getData('text/x-xke-fx'), preset = dt.getData('text/x-xke-preset'), item = dt.getData('text/x-xke-item');
  if (fxId || preset) {
    // 拖到時間軸的圖層列或檢視器：套用在該圖層
    const row = e.target.closest?.('.tlr.layer');
    if (row) { const idx = [...row.parentNode.querySelectorAll('.tlr.layer')].indexOf(row); const l = comp()?.layers[idx]; if (l) select(l.id); }
    if (fxId) exec('effect.apply', fxId); else exec('anim.preset', preset);
    return;
  }
  if (item) {
    const c = comp(); if (!c) return;
    const f = M.getFootage(S.project, item), sub = M.getComp(S.project, item);
    const at = overViewer ? Viewer.dropPoint(e) : null;
    if (f) edit('addLayer', () => addFootageLayer(c, f, at));
    else if (sub && sub !== c) edit('addLayer', () => { const l = M.makePrecomp(c, sub); if (at) l.transform.position.v = [at[0], at[1], 0]; c.layers.unshift(l); select(l.id); });
    return;
  }
  if (dt.files?.length) await importFiles([...dt.files], true);
});

// ================= 匯出與算繪佇列 =================
async function exportFlow(fmt) {
  const c = comp(); if (!c) { toast(t('needComp'), 'warn'); return; }
  const { exportDialog } = await import('./dialogs.js');
  const r = await exportDialog(c, fmt);
  if (!r) return;
  if (r.action === 'rq') { edit('rq', () => S.project.renderQueue.push({ id: 'r' + Date.now(), compId: c.id, on: true, format: r.format, res: r.res, quality: r.quality, range: r.range, status: 'queued' })); bus.emit('showPanel', 'render'); return; }
  await runExport(c, r);
}
async function quickExport(fmt) { const c = comp(); if (c) await runExport(c, { format: fmt, res: 1, quality: 'high', range: 'full' }); }
async function runExport(c, opts, prog) {
  if (S.playing) stopPlay();
  const ac = new AbortController();
  const bar = h('div', { class: 'bar', style: { height: '18px', background: '#141517', border: '1px solid var(--line2)', borderRadius: '3px', overflow: 'hidden', position: 'relative' } }, h('div', { style: { position: 'absolute', inset: '0 auto 0 0', width: '0%', background: '#2b6db0' } }));
  const label = h('div', { class: 'small dim', style: { marginTop: '6px' } }, t('rendering'));
  let closeFn = null;
  const dlg = prog ? null : modal(t('rendering'), h('div', null, bar, label), [{ label: t('cancel'), run: () => ac.abort() }], { sticky: true, onOpen: (box, close) => { closeFn = close; } });
  const t0 = performance.now();
  try {
    const { exportComp } = await import('./exporter.js');
    const res = await exportComp(S.project, c, opts, (p, stage) => {
      const pct = Math.round(p * 100);
      if (prog) { prog.firstChild.style.width = pct + '%'; prog.lastChild.textContent = `${c.name} · ${pct}%`; }
      else { bar.firstChild.style.width = pct + '%'; label.textContent = stage === 'audio' ? t('mixingAudio') : `${pct}% · ${((performance.now() - t0) / 1000).toFixed(1)} s`; }
    }, ac.signal);
    const name = `${c.name.replace(/[\\/:*?"<>|]/g, '_')}.${res.ext}`;
    closeFn?.('done');
    const path = await download(res.blob, name);
    if (path === null) { toast(t('cancelled')); return false; }
    toast(path ? t('savedTo', { path }) : t('exported', { name, size: (res.blob.size / 1e6).toFixed(1) + ' MB' }), '', 5000);
    if (res.warnings?.length) modal(t('lottieWarnings'), h('ul', null, res.warnings.map(w => h('li', null, w))), [{ label: t('ok'), primary: true }]);
    return true;
  } catch (e) {
    closeFn?.('err');
    if (e.name === 'AbortError') { toast(t('cancelled')); return false; }
    console.error(e);
    toast(t(e.message === 'no-encoder' ? 'noEncoder' : e.message === 'no-audio' ? 'noAudio' : 'exportFail'), 'warn', 5000);
    return false;
  }
}
// 匯出到小柯影音剪輯助手：算成（透明）WebM，放進共用動畫素材庫
async function exportToVideo() {
  const c = comp(); if (!c) { toast(t('needComp'), 'warn'); return; }
  if (S.playing) stopPlay();
  const { toVideoDialog } = await import('./dialogs.js');
  const o = await toVideoDialog(c);
  if (!o) return;
  const ac = new AbortController();
  const bar = h('div', { style: { height: '18px', background: '#141517', border: '1px solid var(--line2)', borderRadius: '3px', overflow: 'hidden', position: 'relative' } }, h('div', { style: { position: 'absolute', inset: '0 auto 0 0', width: '0%', background: '#2b6db0' } }));
  const label = h('div', { class: 'small dim', style: { marginTop: '6px' } }, t('rendering'));
  let closeFn = null;
  modal(t('tvTitle'), h('div', null, bar, label), [{ label: t('cancel'), run: () => ac.abort() }], { sticky: true, onOpen: (box, close) => { closeFn = close; } });
  try {
    const [{ exportComp, renderStill }, Sh] = await Promise.all([import('./exporter.js'), import('./shared.js')]);
    const res = await exportComp(S.project, c, { format: 'webm', res: o.res, quality: 'high', range: o.range, alpha: o.alpha }, p => {
      bar.firstChild.style.width = Math.round(p * 100) + '%'; label.textContent = Math.round(p * 100) + '%';
    }, ac.signal);
    // 縮圖：動畫中間那一格（透明的部分保留，素材箱會顯示在深色背景上）
    const t0 = o.range === 'full' ? 0 : c.workIn, t1 = o.range === 'full' ? c.duration : c.workOut;
    const png = await renderStill(S.project, c, (t0 + t1) / 2, Math.min(1, 240 / c.w), o.alpha);
    const thumb = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(png); });
    label.textContent = t('tvSaving');
    const saved = await Sh.saveShared({ name: o.name, w: res.W, h: res.H, dur: res.dur, fps: res.fps, alpha: res.alpha, thumb, comp: c.name }, res.blob);
    closeFn?.('done');
    if (saved.mode === 'file' && saved.where === null) { toast(t('cancelled')); return; }
    const btns = [{ label: t('close') }];
    if (saved.mode === 'idb') btns.push({ label: t('tvOpenVideo'), primary: true, run: () => { window.open(Sh.VIDEO_APP_URL + '?bt=fxanim', 'xiaoke-video'); } });
    if (saved.mode === 'folder') btns.push({ label: t('tvOpenFolder'), primary: true, run: () => { Desktop.api.open_shared_dir(); } });
    modal(t('tvDone'), h('div', null, h('p', null, t('tvDone_' + saved.mode, { name: o.name, size: (res.blob.size / 1e6).toFixed(1) + ' MB', where: saved.where || '' })),
      res.alpha ? h('p', { class: 'small dim' }, t('tvAlphaNote')) : null), btns);
  } catch (e) {
    closeFn?.('err');
    if (e.name === 'AbortError') { toast(t('cancelled')); return; }
    console.error(e); toast(t(e.message === 'no-encoder' ? 'noEncoder' : 'exportFail'), 'warn', 5000);
  }
}
cmd('file.toVideo', exportToVideo);

bus.on('renderQueue', async (prog, btn) => {
  const items = S.project.renderQueue.filter(r => r.on && r.status !== 'done');
  if (!items.length) { toast(t('rqNothing')); return; }
  btn.disabled = true;
  for (const r of items) {
    const c = M.getComp(S.project, r.compId); if (!c) continue;
    r.status = 'rendering'; bottom.refresh();
    const ok = await runExport(c, r, document.querySelector('.rq .bar') || prog);
    r.status = ok ? 'done' : 'failed';
    bottom.refresh();
  }
  btn.disabled = false;
  changed('rq');
});

// ================= 新專案、範本 =================
async function newProject() {
  const { newProjectDialog } = await import('./dialogs.js');
  const id = await newProjectDialog();
  if (!id) return;
  await useTemplate(id, true);
}
async function useTemplate(id, fresh) {
  const { buildTemplate } = await import('./templates.js');
  if (fresh) { await loadProject(M.newProject(t('untitled'))); }
  history.checkpoint('template');
  const c = buildTemplate(id, S.project);
  changed('template');
  openComp(c.id);
  setTime(0, { force: true });
}
bus.on('useTemplate', id => useTemplate(id, false));

// ================= 原版 EffectCraft 引擎 =================
async function openEngine() {
  const ok = await modal(t('engineTitle'), h('div', null, h('p', null, t('engineText')), h('p', { class: 'small dim' }, t('engineNote'))), [{ label: t('cancel'), value: false }, { label: t('openEngineBtn'), primary: true, value: true }]);
  if (ok !== true) return;
  if (Desktop.available) openExternal('https://achir1015.github.io/xiaoke-effects/engine/');
  else window.open('engine/', '_blank', 'noopener');
}

// ================= 更新 =================
async function checkUpdate(manual) {
  if (await whenDesktopReady(manual ? 500 : 3000)) return checkDesktopUpdate(manual);
  const r = await checkWebUpdate();
  if (!r) { if (manual) toast(t('updateFail'), 'warn'); return; }
  if (!r.newer) { if (manual) toast(t('upToDate', { v: APP_VERSION })); return; }
  const bar = h('div', { class: 'updbar' }, h('span', null, t('updateAvail', { v: r.latest })), h('button', { class: 'primary', onclick: () => applyWebUpdate() }, t('reload')), h('button', { class: 'icon', onclick: () => bar.remove() }, '✕'));
  document.body.append(bar);
}
// 桌面版：查 GitHub Releases，一鍵下載安裝（Windows 裝好自動重開；Mac 打開 .dmg）
async function checkDesktopUpdate(manual) {
  let r;
  try { r = await Desktop.api.check_update(); } catch (e) { r = { status: 'error', message: String(e) }; }
  if (r.status !== 'ok') { if (manual) toast(t('updateFail'), 'warn'); return; }
  const { cmp } = await import('./updater.js');
  if (!r.latest || cmp(r.latest, r.current) <= 0) { if (manual) toast(t('upToDate', { v: r.current })); return; }
  document.querySelector('.updbar')?.remove();
  const msg = h('span', null, t('updateAvail', { v: r.latest }));
  const btn = h('button', { class: 'primary' }, t('installUpdate'));
  const bar = h('div', { class: 'updbar' }, msg, btn, h('button', { class: 'icon', onclick: () => bar.remove() }, '✕'));
  btn.addEventListener('click', async () => {
    if (!r.url) { openExternal(r.page || 'https://github.com/achir1015/xiaoke-effects/releases'); return; }
    btn.disabled = true;
    await Desktop.api.install_update(r.url, r.latest);
    const poll = setInterval(async () => {
      const st = await Desktop.api.update_status();
      if (st.state === 'downloading') msg.textContent = t('downloadingUpdate', { pct: st.pct });
      else if (st.state === 'launching') msg.textContent = t('installingUpdate');
      else if (st.state === 'manual') { clearInterval(poll); msg.textContent = t('macUpdateHint'); }
      else if (st.state === 'permission') { clearInterval(poll); msg.textContent = t('androidInstallPerm'); btn.disabled = false; }
      else if (st.state === 'error') { clearInterval(poll); msg.textContent = t('updateFail'); btn.disabled = false; }
    }, 500);
  });
  document.body.append(bar);
}

// ================= 啟動 =================
function buildAll() {
  document.title = t('appName');
  buildMenubar(); buildToolbar(); buildPanels(); buildCompTabs(); buildViewFoot(); updateStatus();
  setWorkspaceSizes();
}
function setWorkspaceSizes() {
  const w = localStorage.getItem('xke.ws') || 'default';
  const sizes = { default: ['270px', '310px', '38%'], animation: ['230px', '300px', '50%'], effects: ['300px', '340px', '34%'], small: ['0px', '280px', '42%'] }[w];
  if (sizes) { $('work').style.setProperty('--lw', sizes[0]); $('work').style.setProperty('--rw', sizes[1]); $('work').style.setProperty('--bh', sizes[2]); }
}
onLangChange(() => { buildAll(); bus.emit('comp'); });

// 面板分隔線
splitter($('splitL'), 'x', () => $('pLeft').getBoundingClientRect().width, v => { $('work').style.setProperty('--lw', clamp(v, 0, 600) + 'px'); requestDraw(); });
splitter($('splitR'), 'x', () => -$('pRight').getBoundingClientRect().width, v => { $('work').style.setProperty('--rw', clamp(-v, 200, 700) + 'px'); requestDraw(); });
splitter($('splitB'), 'y', () => -$('pBottom').getBoundingClientRect().height, v => { $('work').style.setProperty('--bh', clamp(-v, 120, innerHeight - 220) + 'px'); requestDraw(); });

addEventListener('beforeunload', e => { if (S.dirty && S.project.comps.length) { /* 已自動儲存在瀏覽器，不攔截 */ } });

async function boot() {
  buildAll();
  if (!fxAvailable()) toast(t('noWebGL'), 'warn', 8000);
  const saved = await loadAutosave();
  const params = new URLSearchParams(location.search);
  if (saved?.project?.comps?.length && !params.has('new')) {
    await loadProject(saved.project, saved.compId);
    setTime(saved.time || 0, { force: true });
  } else if (params.get('template')) {
    await useTemplate(params.get('template'), true);
  } else {
    await useTemplate('intro', true);
    setTimeout(() => toast(t('welcome'), '', 6000), 600);
  }
  if (params.get('action') === 'import') exec('file.import');
  if (params.get('action') === 'new') newProject();
  history.clear();
  requestAnimationFrame(loop);
  registerSW();
  setTimeout(() => checkUpdate(false), 4000);
  window.xiaokeFX = automationAPI();
}
boot();
