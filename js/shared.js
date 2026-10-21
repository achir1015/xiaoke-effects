// 小柯共用動畫素材庫：小柯特效做好的動畫 → 小柯影音剪輯助手的素材箱「特效動畫」
//
// 網頁版：兩個網站都在 https://achir1015.github.io（同一個來源），共用瀏覽器裡的 IndexedDB
//   資料庫 'xiaoke-shared'（第 1 版）、資料表 'anims'（keyPath 'id'）
//   每筆：{ id, name, mime, blob, w, h, dur(秒), fps, alpha, thumb(dataURL), size, created(毫秒), from:'xiaoke-effects' }
//   有變動時 BroadcastChannel('xiaoke-shared') 送出 { type: 'anims' }，開著的影音剪輯助手會自動重新整理
// 桌面版：兩個 App 的網址（本機埠號）不同、不能共用資料庫，改用共用資料夾
//   Windows：影片\小柯動畫素材　Mac：影片（Movies）/小柯動畫素材
//   每個動畫一個 .webm，旁邊一個同名的 .webm.json（上面的欄位，沒有 blob）
// 這份格式兩邊程式要一致（小柯影音剪輯助手 index.html 的 SharedAnims）。

export const SHARED_DB = 'xiaoke-shared', SHARED_STORE = 'anims', SHARED_CHANNEL = 'xiaoke-shared';
export const VIDEO_APP_URL = 'https://achir1015.github.io/xiaoke-video/';

let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(SHARED_DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(SHARED_STORE)) r.result.createObjectStore(SHARED_STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(SHARED_STORE, mode); const r = fn(t.objectStore(SHARED_STORE)); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); };
const notify = () => { try { const c = new BroadcastChannel(SHARED_CHANNEL); c.postMessage({ type: 'anims' }); c.close(); } catch { } };

// 這個環境用哪一種方式：'idb'（網頁版）、'folder'（桌面版）、'file'（手機 App：存到相簿／分享）
export function sharedMode() {
  if (window.pywebview?.api?.shared_begin) return 'folder';
  if (window.XiaokeAndroid || window.XiaokeIOS) return 'file';
  return 'idb';
}
// 線上版兩個網站同一個來源才看得到彼此的資料庫
export const sameSiteAsVideo = () => location.origin === new URL(VIDEO_APP_URL).origin;

export async function listShared() {
  if (sharedMode() === 'folder') { const r = await window.pywebview.api.shared_list(); return (r.items || []).map(x => ({ ...x, id: x.id || x.file })); }
  const all = (await tx('readonly', s => s.getAll())) || [];
  return all.map(({ blob, ...x }) => x).sort((a, b) => b.created - a.created);
}

export async function deleteShared(item) {
  if (sharedMode() === 'folder') { await window.pywebview.api.shared_delete(item.file); return; }
  await tx('readwrite', s => s.delete(item.id));
  notify();
}

// 存進共用素材庫；回傳 { mode, where }
export async function saveShared(meta, blob, onProgress) {
  const rec = { id: 'fx' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), mime: blob.type || 'video/webm', size: blob.size, created: Date.now(), from: 'xiaoke-effects', ...meta };
  const mode = sharedMode();
  const fname = safeFile(rec.name) + '.webm';
  if (mode === 'folder') {
    const api = window.pywebview.api;
    const r = await api.shared_begin(fname, JSON.stringify(rec));
    if (r.status !== 'ok') throw new Error(r.message || 'save failed');
    const CH = 4 * 1024 * 1024;
    for (let off = 0; off < blob.size; off += CH) {
      const buf = new Uint8Array(await blob.slice(off, off + CH).arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      const w = await api.write_chunk(r.token, btoa(bin));
      if (w.status !== 'ok') throw new Error(w.message);
      onProgress?.(Math.min(1, (off + CH) / blob.size));
    }
    const e = await api.end_save(r.token);
    if (e.status !== 'ok') throw new Error(e.message);
    return { mode, where: e.path };
  }
  if (mode === 'file') {
    const { download } = await import('./util.js');
    const p = await download(blob, fname);
    return { mode, where: p };
  }
  await tx('readwrite', s => s.put({ ...rec, blob }));
  notify();
  return { mode, where: '' };
}
export const safeFile = s => String(s || 'animation').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || 'animation';
export function onSharedChange(fn) { try { const c = new BroadcastChannel(SHARED_CHANNEL); c.onmessage = e => { if (e.data?.type === 'anims') fn(); }; return () => c.close(); } catch { return () => { }; } }
