// 模組自製的畫面：拆解完成品、把合成存成模組、替換照片（追蹤相框）
import { S, bus, comp, edit, changed, history, openComp, firstSel, select } from './state.js';
import { h, timecode, clamp } from './util.js';
import { t } from './i18n.js';
import { modal, toast, pickFiles, dropdown, confirmBox } from './ui.js';
import { longPress } from './panels.js';
import * as M from './model.js';
import * as Media from './media.js';
import * as Mod from './modules.js';
import { renderStill } from './exporter.js';

const pct = p => Math.round(p * 100) + '%';
function progressBox(title, onCancel) {
  const bar = h('div', { style: { height: '18px', background: '#141517', border: '1px solid var(--line2)', borderRadius: '3px', overflow: 'hidden', position: 'relative' } }, h('div', { style: { position: 'absolute', inset: '0 auto 0 0', width: '0%', background: '#2b6db0' } }));
  const label = h('div', { class: 'small dim', style: { marginTop: '6px' } }, '');
  let closeFn = null;
  modal(title, h('div', null, bar, label), [{ label: t('cancel'), run: () => onCancel?.() }], { sticky: true, onOpen: (b, c) => { closeFn = c; } });
  return { set: (p, txt) => { bar.firstChild.style.width = pct(p); label.textContent = txt || pct(p); }, close: () => closeFn?.('done') };
}

// ---------------- 拆解完成品 → 多個模組 ----------------
export async function decomposeFlow() {
  const [file] = await pickFiles('video/*', false);
  if (!file) return;
  const ac = new AbortController();
  const pb = progressBox(t('modTitle'), () => ac.abort());
  let v, an;
  try {
    v = await Mod.openVideo(file);
    an = await Mod.analyzeScenes(v, p => pb.set(p, t('modAnalyzing', { pct: pct(p) })), ac.signal);
  } catch (e) {
    pb.close();
    if (e.name !== 'AbortError') toast(t(e.message === 'decode' ? 'modDecodeFail' : 'exportFail'), 'warn', 5000);
    return;
  }
  pb.close();
  let sens = 5, minLen = 2;
  let scenes = Mod.cutScenes(an, sens, minLen);
  const base = h('input', { value: Mod.baseName(file.name), style: { width: '100%' }, onkeydown: e => e.stopPropagation() });
  const info = h('div', { class: 'small dim' });
  const list = h('div', { class: 'tplgrid', style: { maxHeight: '46vh', overflow: 'auto', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' } });
  let thumbs = [];
  const names = () => { let k = 0; for (const s of scenes) s.name = s.on ? Mod.moduleName(base.value, k++) : ''; };
  const draw = () => {
    names();
    info.textContent = t('modScenes', { n: scenes.length }) + ' · ' + t('modSelected', { n: scenes.filter(s => s.on).length });
    list.innerHTML = '';
    scenes.forEach((s, i) => {
      const cb = h('input', { type: 'checkbox', checked: s.on, onchange: e => { s.on = e.target.checked; draw(); } });
      const card = h('div', { class: 'tpl', style: { opacity: s.on ? 1 : 0.45, cursor: 'default' } },
        thumbs[i] ? h('img', { src: thumbs[i], style: { width: '100%', aspectRatio: `${v.w}/${v.h}`, objectFit: 'cover', display: 'block' } }) : h('div', { style: { aspectRatio: `${v.w}/${v.h}`, background: '#000' } }),
        h('b', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, cb, s.on ? s.name.split('_').pop() : '—'),
        h('span', null, `${timecode(s.start, v.fps)} – ${timecode(s.end, v.fps)}（${(s.end - s.start).toFixed(1)}s）`),
        i < scenes.length - 1 ? h('button', { class: 'ghost small', style: { margin: '0 6px 6px' }, onclick: () => { scenes[i].end = scenes[i + 1].end; scenes.splice(i + 1, 1); thumbs.splice(i + 1, 1); draw(); } }, t('modMerge')) : null);
      list.append(card);
    });
  };
  const reThumb = async () => { thumbs = []; draw(); try { thumbs = await Mod.sceneThumbs(v, scenes); } catch (e) { console.warn(e); } draw(); };
  const sensIn = h('input', { type: 'range', min: 1, max: 10, step: 1, value: sens, oninput: e => { sens = +e.target.value; scenes = Mod.cutScenes(an, sens, minLen); reThumb(); } });
  const minIn = h('input', { type: 'number', min: 0.5, max: 30, step: 0.5, value: minLen, style: { width: '70px' }, onchange: e => { minLen = Math.max(0.5, +e.target.value || 2); scenes = Mod.cutScenes(an, sens, minLen); reThumb(); }, onkeydown: e => e.stopPropagation() });
  base.addEventListener('input', draw);
  reThumb();
  const body = h('div', null,
    h('p', { class: 'dim small', style: { marginTop: 0 } }, t('modIntro')),
    h('div', { class: 'form' },
      h('label', null, t('modName')), h('div', null, base, h('div', { class: 'small dim' }, t('modNameHint'))),
      h('label', null, t('modSensitivity')), h('div', { class: 'row2' }, sensIn),
      h('label', null, t('modMinLen')), minIn),
    h('div', { style: { margin: '10px 0 6px' } }, info), list);
  const r = await modal(t('modTitle') + ' — ' + file.name, body, [{ label: t('cancel') }, { label: t('modCreateBtn'), primary: true, value: 'go' }], { wide: true });
  if (r !== 'go' || !scenes.some(s => s.on)) return;
  names();
  // 匯入影片當素材（同一支影片已經匯入過就共用）
  const pb2 = progressBox(t('modTitle'));
  pb2.set(0, t('modCreating'));
  try {
    let f = S.project.footage.find(x => x.name === file.name && x.size === file.size && Media.footageBlob(x.id));
    if (!f) { f = await Media.importFile(file); S.project.footage.push(f); }
    history.checkpoint('modules');
    const comps = Mod.buildModules(S.project, f, v, scenes, base.value);
    changed('modules');
    // 存進「我的模組」
    let i = 0;
    for (const c of comps) {
      const thumb = thumbs[scenes.findIndex(s => s.name === c.name)] || '';
      await Mod.saveModule(S.project, c, thumb);
      pb2.set(++i / comps.length, t('modSaving', { n: i, total: comps.length }));
    }
    pb2.close();
    openComp(comps[0].id);
    bus.emit('libTab', 'modules');
    toast(t('modCreated', { n: comps.length }), '', 6000);
  } catch (e) { pb2.close(); console.error(e); toast(t('exportFail'), 'warn'); }
}

// ---------------- 把目前的合成存成模組 ----------------
export async function saveCompAsModule() {
  const c = comp(); if (!c) { toast(t('needComp'), 'warn'); return; }
  const png = await renderStill(S.project, c, Math.min(c.duration / 2, S.time || c.duration / 2), Math.min(1, 240 / c.w));
  const thumb = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(png); });
  await Mod.saveModule(S.project, c, thumb);
  changed('module');
  bus.emit('libTab', 'modules');
  toast(t('modSaved', { name: c.name }));
}

// ---------------- 替換照片（追蹤相框四角）----------------
export async function replacePhotoFlow() {
  const c = comp(); if (!c) { toast(t('needComp'), 'warn'); return; }
  const vl = (firstSel()?.type === 'video' ? firstSel() : null) || c.layers.find(l => l.type === 'video');
  const f = vl && M.getFootage(S.project, vl.source);
  const blob = f && Media.footageBlob(f.id);
  if (!vl || !blob) { toast(t('modNeedVideo'), 'warn'); return; }
  let v;
  try { v = await Mod.openVideo(blob); } catch { toast(t('modDecodeFail'), 'warn'); return; }
  // 在影片的哪一格點四個角：目前時間（在圖層範圍內）
  const ct = clamp(S.time, vl.in, vl.out - 1 / c.fps);
  const st = (ct - vl.start) * (vl.speed || 1);
  const DW = Math.min(760, innerWidth - 80), k = DW / v.w, DH = Math.round(v.h * k);
  const frame = await Mod.frameAt(v, st, v.w);
  const cv = h('canvas', { width: DW, height: DH, style: { width: DW + 'px', height: DH + 'px', cursor: 'crosshair', touchAction: 'none', borderRadius: '6px', background: '#000' } });
  const pts = [];
  let photo = null, drag = -1;
  const LABELS = ['1', '2', '3', '4'];
  const draw = () => {
    const g = cv.getContext('2d');
    g.drawImage(frame, 0, 0, DW, DH);
    if (pts.length) {
      g.strokeStyle = '#ffd24a'; g.lineWidth = 2; g.beginPath();
      pts.forEach(([x, y], i) => i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)); if (pts.length === 4) g.closePath(); g.stroke();
      if (pts.length === 4 && photoImg) { // 預覽照片貼上去的樣子（近似：用兩個三角形）
        g.save(); g.globalAlpha = 0.55; g.fillStyle = '#c04ff0'; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)); g.closePath(); g.fill(); g.restore();
      }
      pts.forEach(([x, y], i) => { g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(x * k, y * k, 7, 0, 7); g.fill(); g.fillStyle = '#000'; g.font = '700 10px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(LABELS[i], x * k, y * k); });
    }
  };
  let photoImg = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]; };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    const p = pos(e);
    drag = pts.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) * k < 12);
    if (drag < 0 && pts.length < 4) { pts.push(p); drag = pts.length - 1; }
    draw(); hint();
  });
  cv.addEventListener('pointermove', e => { if (drag < 0) return; pts[drag] = pos(e); draw(); });
  cv.addEventListener('pointerup', () => { drag = -1; });
  const hintEl = h('p', { class: 'small', style: { margin: '6px 0' } });
  const hint = () => { hintEl.textContent = pts.length < 4 ? t('modRepHint') + `（${pts.length}/4）` : t('modRepReady'); };
  const photoName = h('span', { class: 'small dim' }, t('modRepNoPhoto'));
  const pickBtn = h('button', { onclick: async () => {
    const [pf] = await pickFiles('image/*', false);
    if (!pf) return; photo = pf; photoName.textContent = pf.name; photoImg = true; draw();
  } }, t('modRepPhoto'));
  const resetBtn = h('button', { class: 'ghost', onclick: () => { pts.length = 0; draw(); hint(); } }, t('modReset'));
  draw(); hint();
  const body = h('div', null, h('p', { class: 'dim small', style: { marginTop: 0 } }, t('modRepIntro', { time: timecode(ct, c.fps) })), cv, hintEl, h('div', { class: 'row2', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, pickBtn, photoName, resetBtn));
  const r = await modal(t('modRepTitle'), body, [{ label: t('cancel') }, { label: t('modRepTrack'), primary: true, value: 'go', run: () => { if (pts.length < 4) { toast(t('modRepHint'), 'warn'); return false; } } }], { wide: true });
  if (r !== 'go') return;
  // 追蹤：整個圖層的範圍（素材時間）
  const ac = new AbortController();
  const pb = progressBox(t('modRepTitle'), () => ac.abort());
  try {
    const tA = Math.max(0, (vl.in - vl.start) * (vl.speed || 1)), tB = Math.max(tA, (vl.out - vl.start) * (vl.speed || 1) - 1 / c.fps);
    const track = await Mod.trackCorners(v, st, tA, tB, pts, c.fps, p => pb.set(p, t('modTracking', { pct: pct(p) })), ac.signal);
    const pf = photo || await Mod.placeholderPhoto(1280, Math.round(1280 * v.h / v.w), t('modPhotoLayer'));
    const pfoot = await Media.importFile(pf);
    pb.close();
    edit('replacePhoto', () => {
      S.project.footage.push(pfoot);
      const n = c.layers.filter(l => l.name.startsWith(t('modPhotoLayer'))).length + 1;
      const pl = Mod.buildPhotoLayer(S.project, c, vl, pfoot, track, `${t('modPhotoLayer')} ${n}`);
      select(pl.id);
    });
    toast(t('modRepDone', { n: track.length }), '', 6000);
  } catch (e) {
    pb.close();
    if (e.name !== 'AbortError') { console.error(e); toast(t('exportFail'), 'warn'); }
  }
}

// ---------------- 更換照片（一鍵）：選好「替換照片」圖層，挑新照片就換好，追蹤的動作不變 ----------------
export async function swapPhotoFlow(layer) {
  const c = comp(); if (!c) { toast(t('needComp'), 'warn'); return; }
  const l = layer || firstSel();
  const s = Mod.photoSlotOf(S.project, c, l) || (!l ? Mod.photoSlotOf(S.project, c, c.layers.find(x => x.photoSlot)) : null);
  if (!s) { toast(t('modSwapNeed'), 'warn', 4000); return; }
  const [file] = await pickFiles('image/*', false);
  if (!file) return;
  let f;
  try { f = await Media.importFile(file); } catch { toast(t('importFail', { name: file.name }), 'warn'); return; }
  edit('swapPhoto', () => { S.project.footage.push(f); Mod.swapPhoto(S.project, s, f); });
  toast(t('modSwapDone', { name: file.name }), '', 4000);
}

// ---------------- 素材庫的「我的模組」分頁 ----------------
// 我的模組：一般點一下＝放進合成；Ctrl／⌘、Shift 點或「選取」模式＝多選；右鍵（觸控長按）＝刪除／隱藏等
const modPick = new Set();
let modAnchor = null, modSelMode = false, modShowHidden = false;
export async function renderModuleLib(grid) {
  grid.innerHTML = '';
  let all = [];
  try { all = await Mod.listModules(); } catch (e) { console.warn(e); }
  const hiddenN = all.filter(m => m.hidden).length;
  const mods = all.filter(m => modShowHidden || !m.hidden);
  for (const id of [...modPick]) if (!mods.some(m => m.id === id)) modPick.delete(id);
  const again = () => renderModuleLib(grid);
  const picked = () => mods.filter(m => modPick.has(m.id));
  const bar = h('div', { style: { gridColumn: '1/-1', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
    h('button', { class: 'primary', onclick: () => decomposeFlow() }, '✂ ' + t('modMenu')),
    h('button', { onclick: () => saveCompAsModule() }, '＋ ' + t('modSaveComp')),
    h('button', { title: t('aepMenu'), onclick: () => importAepFlow() }, 'Ae ' + t('aepShort')));
  if (mods.length) bar.append(h('button', { class: modSelMode ? 'on' : '', title: t('modSelTip'), onclick: () => { modSelMode = !modSelMode; if (!modSelMode) modPick.clear(); again(); } }, '☑ ' + (modSelMode ? t('modSelDone') : t('modSelect'))));
  if (hiddenN) bar.append(h('button', { class: modShowHidden ? 'on' : '', title: t('showHiddenTip'), onclick: () => { modShowHidden = !modShowHidden; again(); } }, '🙈 ' + t('hiddenN', { n: hiddenN })));
  if (modPick.size) bar.append(h('span', { class: 'small' }, t('pickedN', { n: modPick.size })),
    h('button', { onclick: () => hideMods(picked(), !picked().every(m => m.hidden), again) }, picked().every(m => m.hidden) ? t('unhide') : t('hide')),
    h('button', { class: 'danger', onclick: () => deleteMods(picked(), again) }, t('delete')));
  grid.append(bar);
  if (!mods.length) { grid.append(h('p', { class: 'small dim', style: { gridColumn: '1/-1' } }, t(all.length ? 'modAllHidden' : 'modLibEmpty'))); return; }
  mods.forEach((m, i) => {
    const on = modPick.has(m.id);
    const del = h('button', { class: 'icon', title: t('delete'), style: { position: 'absolute', top: '2px', right: '2px', background: '#000a', width: '22px', height: '22px' } }, '✕');
    const it = h('div', { class: 'libitem' + (on ? ' picked' : ''), title: `${m.name}（${t('modUse')}）`, style: { position: 'relative', opacity: m.hidden ? 0.45 : 1 } },
      m.thumb ? h('img', { src: m.thumb }) : h('div', { style: { aspectRatio: '16/9', background: '#000' } }), h('span', null, (m.hidden ? '🙈 ' : '') + m.name), h('span', { class: 'dim', style: { paddingTop: 0 } }, `${(m.dur || 0).toFixed(1)}s`),
      modSelMode || modPick.size ? h('span', { class: 'pickbox' }, on ? '✓' : '') : del);
    del.addEventListener('click', e => { e.stopPropagation(); deleteMods([m], again); });
    it.addEventListener('click', e => {
      if (e.shiftKey && modAnchor) {
        const a = mods.findIndex(x => x.id === modAnchor);
        if (!(e.ctrlKey || e.metaKey)) modPick.clear();
        for (let k = Math.min(a, i); k <= Math.max(a, i); k++) modPick.add(mods[k].id);
      } else if (e.ctrlKey || e.metaKey || modSelMode || modPick.size) { if (on) modPick.delete(m.id); else modPick.add(m.id); modAnchor = m.id; }
      else return useModule(m);
      again();
    });
    const menu = (x, y) => {
      if (!modPick.has(m.id)) { modPick.clear(); modPick.add(m.id); modAnchor = m.id; again(); }
      const sel = mods.filter(z => modPick.has(z.id)), n = sel.length;
      dropdown([
        n > 1 ? { label: t('pickedN', { n }), disabled: true } : { label: t('modUse'), run: () => useModule(m) },
        '-',
        { label: t('selectAll'), run: () => { mods.forEach(z => modPick.add(z.id)); again(); } },
        { label: t('deselect'), run: () => { modPick.clear(); again(); } },
        '-',
        sel.some(z => !z.hidden) ? { label: n > 1 ? t('hideN', { n }) : t('hide'), run: () => hideMods(sel, true, again) } : null,
        sel.some(z => z.hidden) ? { label: n > 1 ? t('unhideN', { n }) : t('unhide'), run: () => hideMods(sel, false, again) } : null,
        { label: n > 1 ? t('deleteN', { n }) : t('delete'), key: 'Delete', run: () => deleteMods(sel, again) },
      ], x, y);
    };
    it.addEventListener('contextmenu', e => { e.preventDefault(); menu(e.clientX, e.clientY); });
    longPress(it, menu);
    grid.append(it);
  });
}
async function hideMods(list, v, again) {
  if (!list.length) return;
  await Mod.setModulesHidden(list.map(m => m.id), v);
  if (v && !modShowHidden) list.forEach(m => modPick.delete(m.id));
  toast(t(v ? 'hiddenDone' : 'unhiddenDone', { n: list.length }));
  again();
}
async function deleteMods(list, again) {
  if (!list.length) return;
  const msg = list.length > 1 ? t('deleteNQ', { n: list.length }) : t('modDeleteQ', { name: list[0].name });
  if (!await confirmBox(msg, t('delete'))) return;
  await Mod.deleteModules(list.map(m => m.id));
  list.forEach(m => modPick.delete(m.id));
  toast(t('deletedN', { n: list.length }));
  again();
}
// 使用模組：放進專案；目前有開著的合成就當作巢狀合成加在播放頭位置，否則直接開啟模組
export async function useModule(m) {
  const target = comp();
  history.checkpoint('useModule');
  const mc = await Mod.insertModule(S.project, m.id);
  if (!mc) return;
  if (target && target.id !== mc.id) {
    const l = M.makePrecomp(target, mc, { name: mc.name });
    const d = l.out - l.in; l.start = S.time; l.in = S.time; l.out = Math.min(target.duration, S.time + d);
    if (mc.w !== target.w || mc.h !== target.h) { const s = Math.min(target.w / mc.w, target.h / mc.h) * 100; l.transform.scale.v = [s, s, 100]; }
    target.layers.unshift(l);
    select(l.id);
    changed('module');
    toast(t('modInserted', { name: mc.name }));
  } else { changed('module'); openComp(mc.id); }
}

// ---------------- 匯入 After Effects 專案 → 我的模組 ----------------
// 桌面版（Windows／Mac）由 Python 轉換 .aep；轉好的成品主合成與各場景直接存成模組
const RELEASES = 'https://github.com/achir1015/xiaoke-effects/releases/latest';
export async function importAepFlow(test) {
  const api = test || window.pywebview?.api;
  if (!api?.import_aep) {
    const r = await modal(t('aepMenu'), h('p', null, t('aepDesktopOnly')), [{ label: t('cancel'), value: null }, { label: t('aepDownload'), primary: true, value: 'dl' }]);
    if (r === 'dl') window.open(RELEASES, '_blank');
    return;
  }
  let cancelled = false, timer = null, pb = null;
  const startProgress = () => {
    pb = progressBox(t('aepMenu'), () => { cancelled = true; });
    pb.set(0, t('aepParsing'));
    timer = setInterval(async () => {
      try { const s = await api.aep_status(); if (s?.total) pb.set(s.done / s.total * 0.8, t('aepConverting', { done: s.done, total: s.total })); } catch { }
    }, 500);
  };
  const stop = () => { clearInterval(timer); timer = null; pb?.close(); pb = null; };
  let r;
  try {
    // 選檔對話框先出來，選好了才顯示進度
    const first = api.import_aep('', '');
    setTimeout(() => { if (!r && !pb) startProgress(); }, 1200);
    r = await first;
    if (r?.status === 'ok' && r.report.missing.length && !cancelled) {
      stop();
      const names = r.report.missing.slice(0, 8).join('、') + (r.report.missing.length > 8 ? '…' : '');
      const ask = await modal(t('aepMenu'), h('p', { style: { whiteSpace: 'pre-wrap' } }, t('aepMissingQ', { n: r.report.missing.length, names })),
        [{ label: t('aepSkipMissing'), value: 'skip' }, { label: t('aepPickFolder'), primary: true, value: 'folder' }]);
      if (ask === null) return;
      if (ask === 'folder') {
        const again = api.import_aep(r.path, 'ask');
        r = null;
        setTimeout(() => { if (!r && !pb) startProgress(); }, 1200);
        r = await again;
      }
    }
  } finally { if (r?.status !== 'ok' || cancelled) stop(); }
  if (cancelled || !r || r.status === 'declined') { stop(); return; }
  if (r.status !== 'ok') { stop(); toast(t('aepFail', { msg: r.message || '' }), 'warn', 8000); return; }
  if (!pb) startProgress();
  clearInterval(timer);
  try {
    const p = M.migrate(await (await fetch(r.url, { cache: 'no-store' })).json());
    // 素材：放進素材庫並解碼（模組存檔與縮圖都要用）
    for (const f of p.footage) {
      if (!f.data) continue;
      const b = await (await fetch(f.data)).blob(); delete f.data;
      await M.Store.putBlob(f.blobKey, b); await Media.attachBlob(f, b);
    }
    const ids = (r.report.modules || []).filter(id => M.getComp(p, id));
    if (!ids.length) { stop(); toast(t('aepNoComp'), 'warn'); return; }
    const base = Mod.baseName(String(r.report.name || 'AE').replace(/\s*[（(](已转换|已轉換|converted)[)）]\s*/gi, ''));
    for (let i = 0; i < ids.length; i++) {
      if (cancelled) break;
      const c = M.getComp(p, ids[i]);
      pb.set(0.8 + 0.2 * i / ids.length, t('aepSaving', { i: i + 1, n: ids.length, name: c.name }));
      c.name = `${Mod.moduleName(base, i)}（${c.name}）`;
      let thumb = '';
      try {
        const png = await renderStill(p, c, c.duration * 0.6, Math.min(1, 240 / c.w));
        thumb = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(png); });
      } catch (e) { console.warn('thumb', e); }
      await Mod.saveModule(p, c, thumb);
    }
    stop();
    bus.emit('libTab', 'modules');
    toast(t('aepDone', { n: ids.length }), '', 5000);
    const sk = Object.keys(r.report.skipped || {}), un = r.report.unsupported || [];
    if (sk.length || un.length) toast(t('aepPartial', { list: [...sk.map(x => x.replace(/^ADBE /, '')), ...un].join('、') }), 'warn', 9000);
  } catch (e) { console.warn(e); stop(); toast(t('aepFail', { msg: e.message || '' }), 'warn', 8000); }
}
