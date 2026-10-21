// 版本更新：比對伺服器上的 version.json，有新版就提示「重新載入」（離線快取也一起更新）
export const APP_VERSION = '1.0.1';

export async function checkWebUpdate() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return { latest: j.version, notes: j.notes || [], date: j.date, newer: cmp(j.version, APP_VERSION) > 0 };
  } catch { return null; }
}

export async function applyWebUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('xiaoke-effects')).map(k => caches.delete(k)));
  } catch { }
  location.reload();
}

export function cmp(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

export function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  if (location.hostname === '127.0.0.1' && !location.search.includes('sw=1')) return; // 本機測試不需要
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
