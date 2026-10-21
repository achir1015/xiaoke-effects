// 小柯機器人動態圖形和視覺特效工具：離線快取（手機、iPad「加入主畫面」後沒有網路也能開）
// 網頁、程式與 version.json 網路優先（有新版就拿新版），其他檔案快取優先。原版引擎（engine/）太大，不預先快取。
const CACHE = 'xiaoke-effects-v5';
const CORE = ['./', './index.html', './version.json', './manifest.webmanifest', './css/app.css', './favicon.svg', './favicon-32.png', './favicon-16.png', './apple-touch-icon.png',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './vendor/mediabunny.min.mjs', './vendor/gifenc.esm.js', './vendor/lottie_canvas.min.js',
  './js/actions.js', './js/anim.js', './js/audio.js', './js/desktop.js', './js/dialogs.js', './js/editors.js', './js/exporter.js', './js/fx.js', './js/gl3d.js', './js/i18n.js', './js/icons.js', './js/library.js', './js/lottie.js', './js/main.js', './js/media.js', './js/model.js', './js/panels.js', './js/presets.js', './js/props.js', './js/render.js', './js/shapes.js', './js/shared.js', './js/state.js', './js/templates.js', './js/text.js', './js/timeline.js', './js/ui.js', './js/updater.js', './js/util.js', './js/viewer.js',
  './js/lang/zh-TW.js', './js/lang/en.js', './js/lang-fx/zh-TW.js', './js/lang-fx/en.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k.startsWith('xiaoke-effects')).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/engine/')) return;
  if (url.origin !== self.location.origin) {
    // Google 字型：快取優先
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.host)) e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
    return;
  }
  const fresh = req.mode === 'navigate' || /\/(index\.html|version\.json)?$/.test(url.pathname) || url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
  const save = res => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(url.pathname, copy)); } return res; };
  if (fresh) e.respondWith(fetch(req).then(save).catch(() => caches.match(url.pathname).then(r => r || caches.match('./index.html'))));
  else e.respondWith(caches.match(url.pathname).then(r => r || fetch(req).then(save)));
});
