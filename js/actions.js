// 命令登錄表：選單、快捷鍵、右鍵選單、自動化（window.xiaokeFX.execute）都走同一套命令
import { S, bus, comp, edit, changed, history, selLayers, firstSel, select, setTime, openComp, getPath, autosave } from './state.js';
import * as M from './model.js';
import { animated, setKey, removeKey, applyEase, toggleStopwatch, rawAt, keyIndexAt, P, walkProps } from './anim.js';
import { uid, clone, timecode, download, h } from './util.js';
import { t } from './i18n.js';
import { toast, confirmBox, promptBox, pickFiles } from './ui.js';
import { effectDef, layerBounds } from './render.js';
import * as Media from './media.js';

export const COMMANDS = {};
export function cmd(id, run, opts = {}) { COMMANDS[id] = { id, run, ...opts }; }
export function exec(id, ...args) {
  const c = COMMANDS[id];
  if (!c) { console.warn('no command', id); return; }
  if (c.enabled && !c.enabled()) return;
  return c.run(...args);
}

// ---- 共用 ----
function needComp() { const c = comp(); if (!c) toast(t('needComp'), 'warn'); return c; }
export function addLayer(c, l, opts = {}) {
  const sel = selLayers();
  const idx = opts.index ?? (sel.length && opts.aboveSel !== false ? Math.max(0, c.layers.indexOf(sel[0])) : 0);
  c.layers.splice(idx, 0, l);
  if (opts.select !== false) select(l.id);
  return l;
}
function uniqueName(c, base) {
  const names = new Set(c.layers.map(l => l.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}
// 圖層換新 id（複製、貼上用），保留圖層之間的父子／遮罩關係
function reId(layers) {
  const map = {};
  for (const l of layers) { const n = uid('l'); map[l.id] = n; l.id = n; }
  for (const l of layers) {
    if (l.parent) l.parent = map[l.parent] ?? l.parent;
    if (l.matteLayer) l.matteLayer = map[l.matteLayer] ?? l.matteLayer;
    for (const e of l.effects) e.id = uid('e');
    for (const m of l.masks) m.id = uid('m');
    for (const s of l.shapes || []) s.id = uid('s');
    for (const a of l.text?.animators || []) a.id = uid('a');
  }
  return layers;
}

// ---- 檔案 ----
cmd('file.import', async () => {
  const files = await pickFiles('image/*,video/*,audio/*,.json,.lottie,.svg');
  if (files.length) await importFiles(files, true);
});
export async function importFiles(files, addToComp = false) {
  const added = [];
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(M.FILE_EXT)) { await openProjectFile(f); return; }
    try {
      const ft = await Media.importFile(f);
      edit('import', () => { S.project.footage.push(ft); });
      added.push(ft);
    } catch (e) { toast(t('importFail', { name: f.name }), 'warn'); console.warn(e); }
  }
  if (!added.length) return;
  let c = comp();
  if (!c && addToComp) {
    const f0 = added.find(f => f.w) || added[0];
    c = M.newComp({ name: f0.name.replace(/\.[^.]+$/, ''), w: f0.w ? f0.w & ~1 : 1920, h: f0.h ? f0.h & ~1 : 1080, duration: Math.max(5, Math.min(600, f0.duration || 10)), fps: 30 });
    edit('newComp', () => S.project.comps.push(c));
    openComp(c.id);
  }
  if (c && addToComp) edit('addLayer', () => { for (const f of added.reverse()) addFootageLayer(c, f); });
  toast(t('imported', { n: added.length }));
}
export function addFootageLayer(c, f, at) {
  const l = f.kind === 'lottie' ? M.makeLottie(c, f) : M.makeFootageLayer(c, f);
  l.name = uniqueName(c, l.name);
  if (at) { l.transform.position.v = [at[0], at[1], 0]; }
  if (S.time > 0 && f.kind !== 'image') { const d = l.out - l.in; l.start = S.time; l.in = S.time; l.out = Math.min(c.duration, S.time + d); }
  return addLayer(c, l);
}

export function serializeProject() { return JSON.stringify(S.project); }
cmd('file.save', async () => {
  // 專案檔：JSON＋內嵌素材（base64）。大的素材檔另外提醒
  const p = clone(S.project);
  const big = [];
  for (const f of p.footage) {
    const b = Media.footageBlob(f.id);
    if (!b) continue;
    if (b.size > 200e6) { big.push(f.name); continue; }
    f.data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
  }
  const name = (p.name || comp()?.name || 'project').replace(/[\\/:*?"<>|]/g, '_') + M.FILE_EXT;
  const blob = new Blob([JSON.stringify(p)], { type: 'application/json' });
  if (window.showSaveFilePicker && !window.pywebview?.api && !window.XiaokeAndroid && !window.XiaokeIOS) {
    try {
      const hnd = await showSaveFilePicker({ suggestedName: name, types: [{ description: t('projectFile'), accept: { 'application/json': [M.FILE_EXT] } }] });
      const w = await hnd.createWritable(); await w.write(blob); await w.close();
      S.dirty = false; toast(t('saved')); return;
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  const path = await download(blob, name);
  if (path === null) return;
  S.dirty = false;
  if (big.length) toast(t('bigNotSaved', { names: big.join(', ') }), 'warn', 6000);
  else toast(path ? t('savedTo', { path }) : t('saved'), '', 4000);
});
cmd('file.open', async () => {
  const [f] = await pickFiles(M.FILE_EXT + ',.json', false);
  if (f) await openProjectFile(f);
});
export async function openProjectFile(file) {
  try {
    const p = M.migrate(JSON.parse(await file.text()));
    for (const f of p.footage) {
      if (f.data) { const b = await (await fetch(f.data)).blob(); delete f.data; await M.Store.putBlob(f.blobKey, b); await Media.attachBlob(f, b); }
    }
    await loadProject(p);
    toast(t('opened', { name: file.name }));
  } catch (e) { console.warn(e); toast(t('openFail'), 'warn'); }
}
export async function loadProject(p, compId) {
  Media.resetVideos();
  S.project = p; S.openComps = []; history.clear();
  const missing = await Media.restore(p);
  const id = compId && M.getComp(p, compId) ? compId : p.activeComp && M.getComp(p, p.activeComp) ? p.activeComp : p.comps[0]?.id;
  S.compId = null;
  if (id) openComp(id); else { bus.emit('comp'); changed('load'); }
  if (missing.length) toast(t('missingFootage', { names: missing.map(f => f.name).join(', ') }), 'warn', 6000);
  S.dirty = false;
  autosave();   // 開啟的專案馬上存一份，下次打開 App 才會是這個專案
}

// ---- 編輯 ----
cmd('edit.undo', () => { const r = history.doUndo(); if (r) { S.sel.clear(); S.selKeys.clear(); toast(t('undone')); } });
cmd('edit.redo', () => { const r = history.doRedo(); if (r) { S.sel.clear(); S.selKeys.clear(); toast(t('redone')); } });
let clip = null;
cmd('edit.copy', () => {
  if (S.selKeys.size) {
    const list = [...S.selKeys].map(([k, v]) => ({ path: v.path, layerId: v.layerId, k: clone(k) }));
    const t0 = Math.min(...list.map(x => x.k.t));
    clip = { kind: 'keys', list: list.map(x => ({ ...x, dt: x.k.t - t0 })) };
    toast(t('copiedKeys', { n: list.length })); return;
  }
  const ls = selLayers(); if (!ls.length) return;
  clip = { kind: 'layers', layers: clone(ls) };
  try { navigator.clipboard?.writeText(JSON.stringify({ format: 'xiaoke-effects-layers', layers: clip.layers })); } catch { }
  toast(t('copiedLayers', { n: ls.length }));
});
cmd('edit.cut', () => { exec('edit.copy'); if (clip?.kind === 'layers') exec('edit.delete'); });
cmd('edit.paste', async () => {
  const c = needComp(); if (!c) return;
  if (!clip) { try { const s = await navigator.clipboard.readText(); const j = JSON.parse(s); if (j.format === 'xiaoke-effects-layers') clip = { kind: 'layers', layers: j.layers }; } catch { } }
  if (!clip) return;
  if (clip.kind === 'keys') {
    const l = firstSel(); if (!l) { toast(t('selectLayerFirst'), 'warn'); return; }
    edit('pasteKeys', () => {
      for (const x of clip.list) {
        const p = getPath(l, x.path) || (x.layerId !== l.id ? null : null);
        if (!p || !('v' in p)) continue;
        const k = setKey(p, S.time - l.start + x.dt, clone(x.k.v));
        Object.assign(k, { ti: x.k.ti, eo: x.k.eo, ei: x.k.ei });
      }
    });
    return;
  }
  edit('paste', () => {
    const ls = reId(clone(clip.layers));
    for (const l of ls.reverse()) { l.name = uniqueName(c, l.name); addLayer(c, l, { select: false }); }
    select(ls.map(l => l.id));
  });
});
cmd('edit.duplicate', () => {
  const c = comp(), ls = selLayers(); if (!ls.length) return;
  edit('duplicate', () => {
    const copies = reId(clone(ls));
    copies.forEach((l, i) => { l.name = uniqueName(c, l.name); c.layers.splice(c.layers.indexOf(ls[i]), 0, l); });
    select(copies.map(l => l.id));
  });
});
cmd('edit.delete', () => {
  const c = comp(); if (!c) return;
  if (S.selKeys.size) {
    edit('deleteKeys', () => { for (const [k, v] of S.selKeys) { const l = M.getLayer(c, v.layerId); const p = l && getPath(l, v.path); if (p?.k) { p.k = p.k.filter(x => x !== k); if (!p.k.length) { p.v = k.v; delete p.k; } } } S.selKeys.clear(); });
    return;
  }
  if (S.selEffectId) {
    const l = firstSel(); const e = l?.effects.find(x => x.id === S.selEffectId);
    if (e) { edit('deleteEffect', () => { l.effects.splice(l.effects.indexOf(e), 1); S.selEffectId = null; }); return; }
  }
  if (S.selMask) {
    const l = M.getLayer(c, S.selMask.layerId); const m = l?.masks.find(x => x.id === S.selMask.maskId);
    if (m && S.selMask.whole) { edit('deleteMask', () => { l.masks.splice(l.masks.indexOf(m), 1); S.selMask = null; }); return; }
  }
  const ids = new Set(S.sel); if (!ids.size) return;
  edit('delete', () => {
    c.layers = c.layers.filter(l => !ids.has(l.id));
    for (const l of c.layers) { if (ids.has(l.parent)) l.parent = null; if (ids.has(l.matteLayer)) l.matteLayer = null; }
    S.sel.clear();
  });
  bus.emit('select');
});
cmd('edit.selectAll', () => { const c = comp(); if (c) select(c.layers.map(l => l.id)); });
cmd('edit.deselect', () => { select([]); });
cmd('edit.split', () => {
  const c = comp(), ls = selLayers(); if (!ls.length) return;
  edit('split', () => {
    const news = [];
    for (const l of ls) {
      if (S.time <= l.in || S.time >= l.out) continue;
      const [n] = reId([clone(l)]);
      n.in = S.time; l.out = S.time;
      c.layers.splice(c.layers.indexOf(l), 0, n); news.push(n.id);
    }
    if (news.length) select(news);
  });
});

// ---- 合成 ----
cmd('comp.new', async (o) => {
  const { compSettingsDialog } = await import('./dialogs.js');
  const r = o || await compSettingsDialog(null);
  if (!r) return;
  const c = M.newComp(r);
  edit('newComp', () => S.project.comps.push(c));
  openComp(c.id);
  return c;
});
cmd('comp.settings', async () => {
  const c = needComp(); if (!c) return;
  const { compSettingsDialog } = await import('./dialogs.js');
  const r = await compSettingsDialog(c);
  if (!r) return;
  edit('compSettings', () => {
    const k = r.duration / c.duration;
    Object.assign(c, { name: r.name, w: r.w, h: r.h, fps: r.fps, bg: r.bg, motionBlur: r.motionBlur, shutter: r.shutter, samples: r.samples });
    if (r.duration !== c.duration) { c.duration = r.duration; c.workOut = Math.min(c.workOut, r.duration); if (k > 1) for (const l of c.layers) if (Math.abs(l.out - r.duration / k) < 1e-6) l.out = r.duration; }
  });
  bus.emit('comp');
});
cmd('comp.workIn', () => { const c = needComp(); if (c) edit('workArea', () => { c.workIn = Math.min(S.time, c.workOut - 1 / c.fps); }); });
cmd('comp.workOut', () => { const c = needComp(); if (c) edit('workArea', () => { c.workOut = Math.max(S.time + 1 / c.fps, c.workIn + 1 / c.fps); }); });
cmd('comp.trimToWork', () => {
  const c = needComp(); if (!c) return;
  edit('trimComp', () => {
    const a = c.workIn, d = c.workOut - c.workIn;
    for (const l of c.layers) { l.start -= a; l.in -= a; l.out -= a; }
    c.duration = d; c.workIn = 0; c.workOut = d;
  });
  setTime(0, { force: true });
});
cmd('comp.motionBlur', () => { const c = needComp(); if (c) edit('motionBlur', () => { c.motionBlur = !c.motionBlur; }); });
cmd('comp.precompose', async () => {
  const c = needComp(), ls = selLayers(); if (!c || !ls.length) return;
  const name = await promptBox(t('precomposeName'), uniqueNameComp(ls.length === 1 ? ls[0].name + ' ' + t('comp') : t('precomp')));
  if (!name) return;
  edit('precompose', () => {
    const sub = M.newComp({ name, w: c.w, h: c.h, fps: c.fps, duration: c.duration, bg: c.bg });
    const ids = new Set(ls.map(l => l.id));
    sub.layers = c.layers.filter(l => ids.has(l.id));
    const top = Math.min(...sub.layers.map(l => c.layers.indexOf(l)));
    c.layers = c.layers.filter(l => !ids.has(l.id));
    S.project.comps.push(sub);
    const pl = M.makePrecomp(c, sub, { name });
    c.layers.splice(top, 0, pl);
    for (const l of c.layers) if (ids.has(l.parent)) l.parent = null;
    select(pl.id);
  });
});
function uniqueNameComp(base) { const names = new Set(S.project.comps.map(c => c.name)); if (!names.has(base)) return base; for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`; }
cmd('comp.snapshot', async () => {
  const c = needComp(); if (!c) return;
  const { renderStill } = await import('./exporter.js');
  const blob = await renderStill(S.project, c, S.time, 1);
  const path = await download(blob, `${c.name}_${timecode(S.time, c.fps).replace(/:/g, '-')}.png`);
  if (path) toast(t('savedTo', { path }), '', 4000);
});
cmd('comp.duplicate', () => {
  const c = needComp(); if (!c) return;
  edit('dupComp', () => { const n = clone(c); n.id = uid('c'); n.name = uniqueNameComp(c.name); reId(n.layers); S.project.comps.push(n); });
});
cmd('comp.addToRQ', () => {
  const c = needComp(); if (!c) return;
  edit('rq', () => S.project.renderQueue.push({ id: uid('r'), compId: c.id, on: true, format: 'mp4', res: 1, quality: 'high', range: 'work', status: 'queued' }));
  bus.emit('showPanel', 'render');
});

// ---- 圖層 ----
function newLayerCmd(id, make) {
  cmd(id, async (...a) => {
    const c = needComp(); if (!c) return;
    const l = await make(c, ...a);
    if (!l) return;
    l.name = uniqueName(c, l.name);
    edit('newLayer', () => addLayer(c, l));
    return l;
  });
}
newLayerCmd('layer.newSolid', async (c, o) => {
  if (o) return M.makeSolid(c, o);
  const { solidDialog } = await import('./dialogs.js');
  const r = await solidDialog(c); return r && M.makeSolid(c, r);
});
newLayerCmd('layer.newText', (c, o = {}) => { const l = M.makeText(c, { text: o.text ?? t('defaultText'), ...o }); l.name = o.name || l.text.text.v.slice(0, 24); if (o.pos) l.transform.position.v = [...o.pos, 0]; return l; });
newLayerCmd('layer.newShape', (c, o = {}) => { const l = M.makeShape(c, { kind: o.kind || 'rect', name: t('shapeLayer'), ...o }); l.name = t('shapeLayer'); if (o.at) l.transform.position.v = [o.at[0], o.at[1], 0]; return l; });
newLayerCmd('layer.newNull', c => M.makeNull(c, { name: t('nullName') }));
newLayerCmd('layer.newAdjust', c => M.makeAdjust(c, { name: t('adjustName') }));
newLayerCmd('layer.newCamera', c => M.makeCamera(c, { name: t('cameraName') }));
newLayerCmd('layer.newLight', (c, kind = 'point') => M.makeLight(c, { name: t('lightName'), kind }));

function forSel(label, fn, needSel = true) {
  const ls = selLayers();
  if (needSel && !ls.length) { toast(t('selectLayerFirst'), 'warn'); return; }
  edit(label, () => ls.forEach(fn));
}
cmd('layer.toggle3D', () => forSel('3d', l => { if (!['camera', 'light', 'audio'].includes(l.type)) l.threeD = !l.threeD; }));
cmd('layer.toggleMB', () => forSel('mb', l => { l.motionBlur = !l.motionBlur; const c = comp(); if (l.motionBlur && !c.motionBlur) c.motionBlur = true; }));
cmd('layer.toggleVisible', () => forSel('visible', l => { l.visible = !l.visible; }));
cmd('layer.toggleSolo', () => forSel('solo', l => { l.solo = !l.solo; }));
cmd('layer.toggleLock', () => forSel('lock', l => { l.locked = !l.locked; }));
cmd('layer.timeRemap', () => forSel('timeRemap', l => {
  if (!['video', 'precomp', 'lottie'].includes(l.type)) return;
  if (l.timeRemap?.on) { l.timeRemap.on = false; return; }
  const p = P(0); setKey(p, l.in - l.start, (l.in - l.start) * l.speed, { ti: 'linear' }); setKey(p, l.out - l.start, (l.out - l.start) * l.speed, { ti: 'linear' });
  l.timeRemap = { on: true, p };
}));
cmd('layer.freeze', () => forSel('freeze', l => {
  if (!['video', 'precomp', 'lottie'].includes(l.type)) return;
  const p = P(0); setKey(p, S.time - l.start, (S.time - l.start) * l.speed, { ti: 'hold' }); l.timeRemap = { on: true, p };
}));
cmd('layer.reverse', () => forSel('reverse', l => {
  if (!['video', 'precomp', 'lottie'].includes(l.type)) return;
  const p = P(0); const a = l.in - l.start, b = l.out - l.start;
  setKey(p, a, b * l.speed, { ti: 'linear' }); setKey(p, b, a * l.speed, { ti: 'linear' }); l.timeRemap = { on: true, p };
}));
const order = (fn) => () => { const c = comp(); const ls = selLayers(); if (!ls.length) return; edit('order', () => fn(c, ls)); };
cmd('layer.forward', order((c, ls) => { for (const l of ls) { const i = c.layers.indexOf(l); if (i > 0) { c.layers.splice(i, 1); c.layers.splice(i - 1, 0, l); } } }));
cmd('layer.backward', order((c, ls) => { for (const l of [...ls].reverse()) { const i = c.layers.indexOf(l); if (i < c.layers.length - 1) { c.layers.splice(i, 1); c.layers.splice(i + 1, 0, l); } } }));
cmd('layer.front', order((c, ls) => { c.layers = [...ls, ...c.layers.filter(l => !ls.includes(l))]; }));
cmd('layer.back', order((c, ls) => { c.layers = [...c.layers.filter(l => !ls.includes(l)), ...ls]; }));
cmd('layer.trimIn', () => forSel('trim', l => { if (S.time < l.out) l.in = S.time; }));
cmd('layer.trimOut', () => forSel('trim', l => { if (S.time > l.in) l.out = S.time + 1 / comp().fps; }));
cmd('layer.moveInTo', () => forSel('move', l => { const d = S.time - l.in; l.in += d; l.out += d; l.start += d; }));
cmd('layer.moveOutTo', () => forSel('move', l => { const d = S.time + 1 / comp().fps - l.out; l.in += d; l.out += d; l.start += d; }));
cmd('layer.fitToComp', () => { const c = comp(); forSel('fit', l => {
  const [x, y, w, h] = layerBounds(S.project, c, l, S.time);
  if (!w || !h) return;
  const k = Math.max(c.w / w, c.h / h) * 100;
  l.transform.anchor.v = [x + w / 2, y + h / 2, 0]; l.transform.position.v = [c.w / 2, c.h / 2, 0]; l.transform.scale.v = [k, k, 100]; delete l.transform.scale.k; delete l.transform.position.k; delete l.transform.anchor.k;
}); });
cmd('layer.centerAnchor', () => { const c = comp(); forSel('anchor', l => {
  const [x, y, w, h] = layerBounds(S.project, c, l, S.time);
  const a = rawAt(l.transform.anchor, S.time - l.start), na = [x + w / 2, y + h / 2, a[2] || 0];
  const p = rawAt(l.transform.position, S.time - l.start), s = rawAt(l.transform.scale, S.time - l.start), r = rawAt(l.transform.rotation, S.time - l.start) * Math.PI / 180;
  const dx = (na[0] - a[0]) * s[0] / 100, dy = (na[1] - a[1]) * s[1] / 100;
  l.transform.anchor.v = na; delete l.transform.anchor.k;
  if (!animated(l.transform.position)) l.transform.position.v = [p[0] + dx * Math.cos(r) - dy * Math.sin(r), p[1] + dx * Math.sin(r) + dy * Math.cos(r), p[2] || 0];
}); });
cmd('layer.blendNext', () => forSel('blend', l => { const i = M.BLEND_MODES.indexOf(l.blend); l.blend = M.BLEND_MODES[(i + 1) % M.BLEND_MODES.length]; }));
cmd('layer.blendPrev', () => forSel('blend', l => { const i = M.BLEND_MODES.indexOf(l.blend); l.blend = M.BLEND_MODES[(i - 1 + M.BLEND_MODES.length) % M.BLEND_MODES.length]; }));
cmd('layer.rename', async () => {
  const l = firstSel(); if (!l) return;
  const n = await promptBox(t('rename'), l.name);
  if (n) edit('rename', () => { l.name = n; });
});
cmd('layer.newMaskRect', () => { const c = comp(); forSel('mask', l => { const b = layerBounds(S.project, c, l, S.time); l.masks.push(M.makeMask('rect', b, { name: t('mask') + ' ' + (l.masks.length + 1) })); }); });
cmd('layer.newMaskEllipse', () => { const c = comp(); forSel('mask', l => { const b = layerBounds(S.project, c, l, S.time); l.masks.push(M.makeMask('ellipse', b, { name: t('mask') + ' ' + (l.masks.length + 1) })); }); });
cmd('layer.settings', async () => {
  const l = firstSel(); if (!l) return;
  const { layerSettingsDialog } = await import('./dialogs.js');
  await layerSettingsDialog(l);
});
cmd('layer.convertText', () => { /* 保留：文字轉形狀 */ });

// ---- 特效 ----
let lastEffect = null;
cmd('effect.apply', (id, layers) => {
  const def = effectDef(id); if (!def) return;
  const ls = layers || selLayers();
  if (!ls.length) { toast(t('selectLayerFirst'), 'warn'); return; }
  lastEffect = id;
  edit('effect', () => { for (const l of ls) { const e = M.makeEffect(def, l, S.project); l.effects.push(e); S.selEffectId = e.id; } });
  bus.emit('showPanel', 'effectControls');
});
cmd('effect.last', () => { if (lastEffect) exec('effect.apply', lastEffect); });
cmd('effect.removeAll', () => forSel('removeFx', l => { l.effects = []; }));

// ---- 動畫 ----
// 在目前時間為選取的屬性加關鍵影格（沒有選屬性時：位置／縮放／旋轉／不透明度）
cmd('anim.addKey', () => {
  const l = firstSel(); if (!l) return;
  const lt = S.time - l.start;
  const path = S.selProp?.layerId === l.id ? S.selProp.path : null;
  edit('key', () => {
    const props = path ? [getPath(l, path)] : [l.transform.position, l.transform.scale, l.transform.rotation, l.transform.opacity];
    for (const p of props) if (p && 'v' in p) setKey(p, lt, clone(rawAt(p, lt)));
  });
});
function easeSel(kind) {
  return () => {
    if (!S.selKeys.size) { toast(t('selectKeysFirst'), 'warn'); return; }
    edit('ease', () => { for (const k of S.selKeys.keys()) applyEase(k, kind); });
  };
}
cmd('anim.easyEase', easeSel('easy'));
cmd('anim.easeIn', easeSel('easeIn'));
cmd('anim.easeOut', easeSel('easeOut'));
cmd('anim.linear', easeSel('linear'));
cmd('anim.hold', easeSel('hold'));
cmd('anim.bezier', easeSel('bezier'));
function keyTimes() {
  const c = comp(); if (!c) return [];
  const ls = selLayers().length ? selLayers() : c.layers;
  const out = [];
  for (const l of ls) walkProps(l, p => { for (const k of p.k || []) out.push(k.t + l.start); });
  return [...new Set(out.map(x => Math.round(x * c.fps) / c.fps))].sort((a, b) => a - b);
}
cmd('anim.nextKey', () => { const ts = keyTimes().filter(x => x > S.time + 1e-6); if (ts.length) setTime(ts[0]); });
cmd('anim.prevKey', () => { const ts = keyTimes().filter(x => x < S.time - 1e-6); if (ts.length) setTime(ts[ts.length - 1]); });
cmd('anim.selectAllKeys', () => {
  const c = comp(); if (!c) return;
  S.selKeys.clear();
  for (const l of selLayers()) walkProps(l, (p, path) => { for (const k of p.k || []) S.selKeys.set(k, { layerId: l.id, path }); });
  bus.emit('select');
});
cmd('anim.addExpression', () => {
  const l = firstSel(); if (!l || !S.selProp) { toast(t('selectPropFirst'), 'warn'); return; }
  const p = getPath(l, S.selProp.path);
  if (p && 'v' in p) edit('expr', () => { p.x = p.x || 'value'; p.xon = true; });
});
cmd('anim.preset', async (id) => {
  const ls = selLayers(); if (!ls.length) { toast(t('selectLayerFirst'), 'warn'); return; }
  const { applyPreset } = await import('./presets.js');
  edit('preset', () => ls.forEach(l => applyPreset(id, l, comp(), S.time)));
});
cmd('anim.addTextAnimator', (prop = 'opacity') => forSel('animator', l => {
  if (l.type !== 'text') return;
  const defs = { opacity: 0, position: [0, 100], scale: [0, 0], rotation: 90, fill: [1, 0.3, 0.3, 1], blur: 20, tracking: 200, stroke: [1, 1, 1, 1] };
  l.text.animators.push(M.textAnimator({ name: t('animator') + ' ' + (l.text.animators.length + 1), props: { [prop]: P(clone(defs[prop])) } }));
}));

// ---- 播放 ----
cmd('play.toggle', () => bus.emit('playToggle'));
cmd('play.first', () => setTime(comp()?.workIn ?? 0));
cmd('play.last', () => { const c = comp(); if (c) setTime(c.workOut - 1 / c.fps); });
cmd('play.prev', (n = 1) => { const c = comp(); if (c) setTime(S.time - n / c.fps); });
cmd('play.next', (n = 1) => { const c = comp(); if (c) setTime(S.time + n / c.fps); });
cmd('play.layerIn', () => { const l = firstSel(); if (l) setTime(l.in); });
cmd('play.layerOut', () => { const l = firstSel(); const c = comp(); if (l) setTime(l.out - 1 / c.fps); });

// ---- 檢視 ----
cmd('view.toggle', (k) => { S[k] = !S[k]; bus.emit('view'); });
cmd('view.zoom', z => { S.zoom = z; bus.emit('view'); });
cmd('view.res', r => { S.res = r; bus.emit('view'); });
cmd('view.graph', () => { S.graph = !S.graph; bus.emit('timelineMode'); });

// 給外部（自動化、測試）用
export function automationAPI() {
  return {
    commands: () => Object.keys(COMMANDS),
    execute: (id, ...a) => exec(id, ...a),
    state: () => ({ compId: S.compId, time: S.time, selection: [...S.sel] }),
    project: () => JSON.parse(JSON.stringify(S.project)),
    setTime: tt => setTime(tt),
    // 桌面版雙擊專案檔：從本機伺服器讀取後開啟（.xke）或匯入（其他檔案）
    async openUrl(url, name) {
      const b = await (await fetch(url)).blob();
      const f = new File([b], name || 'project' + M.FILE_EXT);
      if (f.name.toLowerCase().endsWith(M.FILE_EXT)) await openProjectFile(f); else await importFiles([f], true);
    },
  };
}
