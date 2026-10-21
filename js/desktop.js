// App 版提供的功能：直接存檔到電腦／手機、版本更新、用系統瀏覽器開網址（iPhone 版存檔時打開分享選單）
//  桌面版（Windows／Mac 的 Python 程式）：window.pywebview.api
//  Android 版（WebView）：window.XiaokeAndroid（同步、回傳 JSON 字串）→ 包成和桌面版一樣的非同步介面
// 網頁版兩個都沒有，這些功能會自動改用瀏覽器的做法。

const A = () => window.XiaokeAndroid;
const J = s => { try { return JSON.parse(s); } catch { return { status: 'error', message: String(s) }; } };
const androidApi = {
  app_info: async () => J(A().appInfo()),
  begin_save: async name => J(A().beginSave(name)),
  write_chunk: async (token, b64) => J(A().writeChunk(token, b64)),
  end_save: async token => J(A().endSave(token)),
  check_update: async () => J(A().checkUpdate()),
  install_update: async (url, ver) => J(A().installUpdate(url, ver)),
  update_status: async () => J(A().updateStatus()),
  open_url: async url => A().openUrl(url),
};

//  iPhone／iPad 版（WKWebView）：window.webkit.messageHandlers.xke.postMessage({ cmd, args }) 回傳 Promise
const I = () => window.XiaokeIOS && window.webkit?.messageHandlers?.xke;
const iosCall = (cmd, ...args) => I().postMessage({ cmd, args });
const iosApi = new Proxy({}, { get: (_, cmd) => (...args) => iosCall(cmd, ...args) });

export const Desktop = {
  get available() { return !!(A() || I() || (window.pywebview && window.pywebview.api)); },
  get android() { return !!A(); },
  get ios() { return !!I(); },
  get api() { return A() ? androidApi : I() ? iosApi : window.pywebview.api; },
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
