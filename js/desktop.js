// 桌面版（Windows／Mac 的 Python 程式）提供的功能：直接存檔到電腦、版本更新、用系統瀏覽器開網址
// 網頁版沒有 window.pywebview，這些功能會自動改用瀏覽器的做法。

export const Desktop = {
  get available() { return !!(window.pywebview && window.pywebview.api); },
  get api() { return window.pywebview.api; },
};

export function whenDesktopReady(timeout = 2500) {
  return new Promise(res => {
    if (Desktop.available) return res(true);
    const t = setTimeout(() => res(false), timeout);
    window.addEventListener('pywebviewready', () => { clearTimeout(t); res(true); }, { once: true });
  });
}

// 把 Blob 分段（每段 4MB，base64）傳給 Python 寫進使用者選的檔案；使用者取消時回傳 null
export async function desktopSave(filename, blob, onProgress) {
  const api = Desktop.api;
  const r = await api.begin_save(filename);
  if (r.status === 'declined') return null;
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
  return e.path;
}

export function openExternal(url) {
  if (Desktop.available) return Desktop.api.open_url(url);
  window.open(url, '_blank', 'noopener');
  return true;
}
