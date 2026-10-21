// 素材：匯入圖片／影片／音訊／Lottie，存進 IndexedDB；預覽與匯出時提供畫面與聲音
import { uid } from './util.js';
import { Store } from './model.js';
import * as LIB from './library.js';

const cache = new Map();      // footageId → { blob, url, img, dur, lottieData, audio }
const videos = new Map();     // layerId → HTMLVideoElement（同一個影片素材可以放成好幾個圖層）
let onRedraw = () => { };
export const setRedraw = fn => { onRedraw = fn; };

let actx = null;
export function audioCtx() { return actx ||= new (window.AudioContext || window.webkitAudioContext)(); }

export function kindOf(file) {
  const n = file.name.toLowerCase(), t = file.type || '';
  if (n.endsWith('.json') || n.endsWith('.lottie')) return 'lottie';
  if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(n)) return 'image';
  if (t.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv|ogv)$/.test(n)) return 'video';
  if (t.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/.test(n)) return 'audio';
  return null;
}

function loadImage(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
function loadVideoMeta(url) {
  return new Promise((res, rej) => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.playsInline = true;
    v.onloadedmetadata = () => res(v); v.onerror = () => rej(new Error('video')); v.src = url;
  });
}

// 匯入一個檔案 → 素材資料（加進 project.footage 由呼叫端處理）
export async function importFile(file) {
  const kind = kindOf(file);
  if (!kind) throw new Error('unsupported');
  const f = { id: uid('f'), name: file.name, kind, blobKey: uid('b'), size: file.size, type: file.type };
  if (kind === 'lottie') {
    const data = JSON.parse(await file.text());
    if (!data.w || !data.layers) throw new Error('lottie');
    Object.assign(f, { w: data.w, h: data.h, fps: data.fr || 30, duration: ((data.op || 60) - (data.ip || 0)) / (data.fr || 30) });
    await Store.putBlob(f.blobKey, file);
    cache.set(f.id, { blob: file, lottieData: data });
    return f;
  }
  const url = URL.createObjectURL(file);
  if (kind === 'image') {
    const img = await loadImage(url);
    Object.assign(f, { w: img.naturalWidth || 512, h: img.naturalHeight || 512 });
    cache.set(f.id, { blob: file, url, img });
  } else if (kind === 'video') {
    const v = await loadVideoMeta(url);
    Object.assign(f, { w: v.videoWidth || 1280, h: v.videoHeight || 720, duration: isFinite(v.duration) ? v.duration : 10, hasAudio: true });
    cache.set(f.id, { blob: file, url });
  } else {
    const buf = await decodeBlob(file).catch(() => null);
    Object.assign(f, { duration: buf?.duration || 10 });
    cache.set(f.id, { blob: file, url, audio: buf });
  }
  await Store.putBlob(f.blobKey, file);
  return f;
}

async function decodeBlob(blob) { return audioCtx().decodeAudioData(await blob.arrayBuffer()); }

// 開啟專案後：從 IndexedDB 把素材讀回來
export async function restore(project) {
  const missing = [];
  await Promise.all(project.footage.map(async f => {
    if (cache.has(f.id) && cache.get(f.id).blob) return;
    const blob = await Store.getBlob(f.blobKey);
    if (!blob) { missing.push(f); return; }
    await attachBlob(f, blob);
  }));
  return missing;
}
export async function attachBlob(f, blob) {
  if (f.kind === 'lottie') { cache.set(f.id, { blob, lottieData: JSON.parse(await blob.text()) }); return; }
  const url = URL.createObjectURL(blob);
  const e = { blob, url };
  if (f.kind === 'image') e.img = await loadImage(url).catch(() => null);
  cache.set(f.id, e);
}
export const footageBlob = id => cache.get(id)?.blob || null;
export const isMissing = f => !cache.get(f.id)?.blob && !f.lib;

export function imageOf(f) { return cache.get(f.id)?.img || null; }

// ---- 影片：預覽用 <video>，每個圖層一個 ----
function videoFor(layerId, f) {
  let v = videos.get(layerId);
  const e = cache.get(f.id);
  if (!e?.url) return null;
  if (!v || v.dataset.src !== f.id) {
    v?.pause();
    v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.dataset.src = f.id; v.src = e.url;
    v.addEventListener('seeked', () => onRedraw());
    v.addEventListener('loadeddata', () => onRedraw());
    videos.set(layerId, v);
  }
  return v;
}
// 預覽時取畫面：暫停時跳到正確時間；播放時讓影片自己播、偏差太大才校正
export function videoFrame(layerId, f, t, playing, rate = 1) {
  const v = videoFor(layerId, f);
  if (!v) return null;
  const tt = Math.max(0, Math.min(t, (v.duration || f.duration || 0) - 0.001));
  if (playing) {
    if (v.paused) { v.currentTime = tt; v.playbackRate = Math.min(4, Math.max(0.25, rate)); v.play().catch(() => { }); }
    else if (Math.abs(v.currentTime - tt) > 0.25) v.currentTime = tt;
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - tt) > 0.5 / 60 && !v.seeking) v.currentTime = tt;
  }
  return v.readyState >= 2 ? v : null;
}
export function pauseVideos(except) { for (const [id, v] of videos) if (!except?.has(id)) { if (!v.paused) v.pause(); } }
// 匯出時：精準跳到每一格，等畫面準備好
export function seekExact(layerId, f, t) {
  const v = videoFor(layerId, f);
  if (!v) return Promise.resolve();
  v.pause();
  const tt = Math.max(0, Math.min(t, (v.duration || f.duration || 0) - 0.001));
  return new Promise(res => {
    const ready = () => { if (v.readyState >= 2 && !v.seeking) { cleanup(); res(); } };
    const cleanup = () => { v.removeEventListener('seeked', ready); v.removeEventListener('loadeddata', ready); clearTimeout(tm); };
    const tm = setTimeout(() => { cleanup(); res(); }, 3000);
    v.addEventListener('seeked', ready); v.addEventListener('loadeddata', ready);
    if (Math.abs(v.currentTime - tt) < 1e-4 && v.readyState >= 2) { cleanup(); res(); return; }
    v.currentTime = tt;
  });
}
export const videoEl = layerId => videos.get(layerId) || null;

// ---- 聲音 ----
export async function audioBuffer(f) {
  const e = cache.get(f.id);
  if (!e) return null;
  if (e.audio !== undefined) return e.audio;
  e.audio = e.blob ? await decodeBlob(e.blob).catch(() => null) : null;
  return e.audio;
}
const musicCache = new Map();
export async function libMusic(id) {
  if (!musicCache.has(id)) {
    const m = LIB.MUSIC_LIST.find(x => x.id === id);
    musicCache.set(id, m ? LIB.renderMusicBuffer(m.plan) : Promise.resolve(null));
  }
  return musicCache.get(id);
}

// ---- Lottie（用 lottie-web 的 canvas 繪製器）----
let lottieLib = null;
function loadLottieLib() {
  if (!lottieLib) lottieLib = new Promise((res, rej) => {
    if (window.lottie) return res(window.lottie);
    const s = document.createElement('script'); s.src = 'vendor/lottie_canvas.min.js';
    s.onload = () => res(window.lottie); s.onerror = rej; document.head.append(s);
  });
  return lottieLib;
}
const lotties = new Map();   // footageId → { anim, canvas }
export function lottieFrame(f, t) {
  const e = cache.get(f.id);
  if (!e?.lottieData) return null;
  let L = lotties.get(f.id);
  if (!L) {
    L = { canvas: document.createElement('canvas'), anim: null };
    L.canvas.width = f.w; L.canvas.height = f.h;
    lotties.set(f.id, L);
    loadLottieLib().then(lottie => {
      const ctx = L.canvas.getContext('2d');
      L.anim = lottie.loadAnimation({ renderer: 'canvas', loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(e.lottieData)), rendererSettings: { context: ctx, clearCanvas: true, preserveAspectRatio: 'none' } });
      L.anim.addEventListener('DOMLoaded', () => onRedraw());
      onRedraw();
    }).catch(err => console.warn('lottie', err));
  }
  if (!L.anim) return null;
  const fr = f.fps || 30, total = L.anim.totalFrames || 1;
  L.anim.goToAndStop(Math.min(total - 0.01, Math.max(0, t * fr)), true);
  return L.canvas;
}

// ---- 素材庫（小柯影音剪輯助手）----
const stkCache = new Map();
export function stickerCanvas(i) {
  if (!stkCache.has(i)) {
    const def = LIB.STK[i];
    if (!def) return null;
    const [, fn, size] = def, [w, h] = size || [512, 512];
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    try { fn(c.getContext('2d')); } catch { }
    stkCache.set(i, c);
  }
  return stkCache.get(i);
}
// 把貼圖變成一般圖片素材（可以存檔、匯出 Lottie）
export async function stickerFootage(i) {
  const c = stickerCanvas(i);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], (LIB.STK[i]?.[0] || 'sticker') + '.png', { type: 'image/png' });
  return importFile(file);
}

export function forget(footageId) {
  const e = cache.get(footageId);
  if (e?.url) URL.revokeObjectURL(e.url);
  cache.delete(footageId);
}
export function resetVideos() { for (const v of videos.values()) { v.pause(); v.removeAttribute('src'); v.load(); } videos.clear(); }
