// 編輯器共用狀態與事件
import { History, newProject, getComp, Store, migrate } from './model.js';
import { debounce } from './util.js';

const listeners = {};
export const bus = {
  on(ev, fn) { (listeners[ev] ||= new Set()).add(fn); return () => listeners[ev].delete(fn); },
  emit(ev, ...a) { listeners[ev]?.forEach(fn => { try { fn(...a); } catch (e) { console.error(ev, e); } }); },
};

export const S = {
  project: newProject(),
  compId: null,
  openComps: [],          // 檢視器上方的合成頁籤
  time: 0,
  playing: false,
  sel: new Set(),         // 選取的圖層 id
  selKeys: new Map(),     // 選取的關鍵影格：keyframe 物件 → { layerId, path }
  selProp: null,          // 選取的屬性 { layerId, path }
  selEffect: null,        // 效果控制面板顯示的圖層
  selMask: null,          // 編輯中的遮罩 { layerId, maskId }
  tool: 'select',
  res: 'auto',            // 預覽解析度：auto / 1 / 0.5 / 0.333 / 0.25
  zoom: 'fit',
  loop: true,
  snapping: true,
  showGrid: false, showSafe: false, showRulers: false, transparentGrid: false,
  graph: false,           // 時間軸圖表編輯器
  revealed: null,         // 屬性快捷鍵（P/S/R/T/A…）只顯示的屬性
  dirty: false,
  autoKey: false,
};

export const comp = () => getComp(S.project, S.compId);
export const selLayers = () => { const c = comp(); return c ? c.layers.filter(l => S.sel.has(l.id)) : []; };
export const firstSel = () => selLayers()[0] || null;

export const history = new History(() => S.project, p => { S.project = p; if (!getComp(p, S.compId)) S.compId = p.comps[0]?.id || null; bus.emit('change', 'history'); });

// 修改專案：先存復原點，再改，最後通知畫面更新
export function edit(label, fn, opts = {}) {
  if (!opts.noUndo) history.checkpoint(label);
  const r = fn();
  changed(opts.what || 'edit');
  return r;
}
export function changed(what = 'edit') {
  S.dirty = true;
  bus.emit('change', what);
  autosave();
}
export const autosave = debounce(() => {
  try { Store.set('autosave', JSON.stringify({ project: S.project, compId: S.compId, time: S.time })); } catch (e) { console.warn(e); }
}, 800);
export async function loadAutosave() {
  const s = await Store.get('autosave');
  if (!s) return null;
  try { const j = JSON.parse(s); j.project = migrate(j.project); return j; } catch { return null; }
}

export function setTime(t, opts = {}) {
  const c = comp();
  if (!c) return;
  const fr = 1 / c.fps;
  t = Math.max(0, Math.min(c.duration - fr, t));
  if (!opts.raw) t = Math.round(t * c.fps) / c.fps;
  if (t === S.time && !opts.force) return;
  S.time = t;
  bus.emit('time', t);
}

export function select(ids, add = false) {
  if (!add) S.sel.clear();
  for (const id of [].concat(ids || [])) { if (add && S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); }
  S.selKeys.clear();
  bus.emit('select');
}

export function openComp(id) {
  if (!getComp(S.project, id)) return;
  S.compId = id;
  if (!S.openComps.includes(id)) S.openComps.push(id);
  S.project.activeComp = id;
  S.sel.clear(); S.selKeys.clear(); S.selProp = null; S.selMask = null;
  const c = comp();
  if (S.time >= c.duration) S.time = 0;
  bus.emit('comp');
  bus.emit('change', 'comp');
}

// 取得屬性路徑：'transform.position'、'effects.e123.params.blurriness'、'shapes.s1.fill.color'…（陣列用 id）
export function getPath(obj, path) {
  for (const seg of path.split('.')) {
    if (obj == null) return undefined;
    obj = Array.isArray(obj) ? obj.find(x => x.id === seg) : obj[seg];
  }
  return obj;
}
