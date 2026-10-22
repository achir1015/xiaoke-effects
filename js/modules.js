// 模組自製：把完成品影片拆解成多個模組（換場偵測 → 每個場景一個合成），存進「我的模組」庫跨專案使用；
// 替換照片：在畫面上點相框四個角，逐格追蹤後用「邊角釘選」把自己的照片貼進同樣的動作裡。
import { Input, BlobSource, ALL_FORMATS, CanvasSink } from '../vendor/mediabunny.min.mjs';
import { uid, clone } from './util.js';
import * as M from './model.js';
import { P, setKey } from './anim.js';
import * as Media from './media.js';
import { getEffect } from './fx.js';

// ---------------- 讀影片 ----------------
export async function openVideo(blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) throw new Error('decode');
  const dur = await input.computeDuration();
  const stats = await track.computePacketStats(120).catch(() => null);
  const fps = stats?.averagePacketRate ? Math.round(stats.averagePacketRate * 100) / 100 : 30;
  return { input, track, dur, fps: fps > 0 && fps < 121 ? fps : 30, w: track.displayWidth, h: track.displayHeight };
}

// ---------------- 換場偵測 ----------------
// 每秒取 rate 格縮小成 64×36：顏色分布（4×4×4）＋亮度格子（16×9），計算和前一格的差異
export async function analyzeScenes(v, onProgress, signal, rate = v.dur > 180 ? 5 : v.dur > 60 ? 8 : 10) {   // 長片取樣少一點，速度快一倍
  const W = 64, H = 36;
  const sink = new CanvasSink(v.track, { width: W, height: H, fit: 'fill', poolSize: 2 });
  const n = Math.max(2, Math.floor(v.dur * rate));
  const times = Array.from({ length: n }, (_, i) => i / rate);
  const feats = [];
  let i = 0;
  for await (const fr of sink.canvasesAtTimestamps(times)) {
    if (signal?.aborted) throw new DOMException('abort', 'AbortError');
    if (!fr) { feats.push(feats[feats.length - 1] || null); i++; continue; }
    const g = fr.canvas.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(0, 0, W, H).data;
    const hist = new Float32Array(64), grid = new Float32Array(144);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4, r = d[k], gg = d[k + 1], b = d[k + 2];
      hist[(r >> 6) * 16 + (gg >> 6) * 4 + (b >> 6)]++;
      grid[Math.floor(y / 4) * 16 + Math.floor(x / 4)] += (0.299 * r + 0.587 * gg + 0.114 * b) / 16;
    }
    feats.push({ hist, grid, t: times[i] });
    i++;
    if (i % 20 === 0) { onProgress?.(i / n); await new Promise(r => setTimeout(r)); }
  }
  // 差異：顏色分布的卡方距離＋亮度格子的平均差
  const diff = feats.map((f, k) => {
    const p = feats[k - 1];
    if (!f || !p) return 0;
    let hd = 0; for (let j = 0; j < 64; j++) { const a = f.hist[j], b = p.hist[j]; if (a + b) hd += (a - b) * (a - b) / (a + b); }
    hd /= W * H * 2;
    let gd = 0; for (let j = 0; j < 144; j++) gd += Math.abs(f.grid[j] - p.grid[j]);
    gd /= 144 * 255;
    return hd * 0.6 + gd * 1.4;
  });
  return { rate, diff, dur: v.dur };
}

// 依靈敏度（1～10）切出場景；短於 minLen 秒的併到前一段
export function cutScenes(an, sensitivity = 5, minLen = 2) {
  const { diff, rate, dur } = an;
  const thr = 0.42 - sensitivity * 0.035;         // 靈敏度越高，門檻越低
  const cuts = [0];
  for (let k = 1; k < diff.length; k++) {
    // 局部最大值才算（漸變轉場只切一次）
    const win = diff.slice(Math.max(0, k - 3), k + 4);
    if (diff[k] >= thr && diff[k] === Math.max(...win)) {
      const t = k / rate;
      if (t - cuts[cuts.length - 1] >= minLen) cuts.push(t);
      else if (diff[k] > diff[Math.round(cuts[cuts.length - 1] * rate)] && cuts.length > 1) cuts[cuts.length - 1] = t;   // 太近：留差異大的
    }
  }
  const scenes = cuts.map((s, i) => ({ start: s, end: i + 1 < cuts.length ? cuts[i + 1] : dur }));
  // 最後一段太短就併進前一段
  if (scenes.length > 1 && scenes[scenes.length - 1].end - scenes[scenes.length - 1].start < minLen) { const last = scenes.pop(); scenes[scenes.length - 1].end = last.end; }
  return scenes.map(s => ({ ...s, on: true }));
}

// 場景縮圖（每段中間那一格）
export async function sceneThumbs(v, scenes, w = 192) {
  const h = Math.round(w * v.h / v.w);
  const sink = new CanvasSink(v.track, { width: w, height: h, fit: 'fill', poolSize: 0 });
  const out = [];
  for await (const fr of sink.canvasesAtTimestamps(scenes.map(s => (s.start + s.end) / 2))) {
    if (!fr) { out.push(''); continue; }
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(fr.canvas, 0, 0);
    out.push(c.toDataURL('image/jpeg', 0.75));
  }
  return out;
}

// 名稱：日期＋影片名稱＋流水號，例如 20261022_轉為動畫模板01_001
export const today = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
export const moduleName = (base, i) => `${base}_${String(i + 1).padStart(3, '0')}`;
export const baseName = fileName => `${today()}_${String(fileName || '影片').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_')}`;

// 每個場景建立一個合成（影片圖層只播這一段）；回傳新的合成
export function buildModules(project, footage, v, scenes, base) {
  const out = [];
  let k = 0;
  for (const s of scenes) {
    if (!s.on) continue;
    const len = Math.max(1 / v.fps, s.end - s.start);
    const c = M.newComp({ name: s.name || moduleName(base, k), w: v.w & ~1, h: v.h & ~1, fps: v.fps, duration: Math.round(len * v.fps) / v.fps, bg: [0, 0, 0, 1] });
    const l = M.makeFootageLayer(c, footage, { name: footage.name, fit: false });
    l.start = -s.start; l.in = 0; l.out = c.duration;
    c.layers.push(l);
    c.module = { source: footage.name, start: s.start, end: s.end, index: k + 1 };
    project.comps.push(c);
    out.push(c);
    k++;
  }
  return out;
}

// ---------------- 我的模組（跨專案的模組庫）----------------
// IndexedDB 'xiaoke-modules'：mods（模組：合成＋用到的素材資料）、media（素材檔，同一支影片只存一份）
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('xiaoke-modules', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('mods', { keyPath: 'id' }); r.result.createObjectStore('media'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (store, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const r = fn(t.objectStore(store)); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); };

// 合成用到的所有合成（巢狀）與素材
function collect(project, comp, comps = new Map(), foot = new Map()) {
  if (comps.has(comp.id)) return { comps, foot };
  comps.set(comp.id, comp);
  for (const l of comp.layers) {
    if (l.source) { const f = M.getFootage(project, l.source); if (f) foot.set(f.id, f); }
    if (l.type === 'precomp') { const sub = M.getComp(project, l.comp); if (sub) collect(project, sub, comps, foot); }
  }
  return { comps, foot };
}

export async function saveModule(project, comp, thumb) {
  const { comps, foot } = collect(project, comp);
  for (const f of foot.values()) {
    const b = Media.footageBlob(f.id);
    const has = await tx('media', 'readonly', s => s.count(f.blobKey));
    if (b && !has) await tx('media', 'readwrite', s => s.put(b, f.blobKey));
  }
  const rec = { id: comp.module?.libId || uid('mod'), name: comp.name, created: Date.now(), w: comp.w, h: comp.h, fps: comp.fps, dur: comp.duration, thumb: thumb || '', main: comp.id,
    comps: clone([...comps.values()]), footage: clone([...foot.values()]) };
  comp.module = { ...(comp.module || {}), libId: rec.id };
  await tx('mods', 'readwrite', s => s.put(rec));
  return rec;
}
export async function listModules() {
  const all = (await tx('mods', 'readonly', s => s.getAll())) || [];
  // 新的一批在前面；同一批（一分鐘內建立的）依流水號排
  return all.map(({ comps, footage, ...x }) => x).sort((a, b) => Math.floor(b.created / 60000) - Math.floor(a.created / 60000) || a.name.localeCompare(b.name, 'zh-Hant', { numeric: true }));
}
export const deleteModule = id => deleteModules([id]);
export async function deleteModules(ids) {
  for (const id of ids) await tx('mods', 'readwrite', s => s.delete(id));
  // 沒有模組再用到的素材檔也刪掉
  const all = (await tx('mods', 'readonly', s => s.getAll())) || [];
  const used = new Set(all.flatMap(m => m.footage.map(f => f.blobKey)));
  for (const k of (await tx('media', 'readonly', s => s.getAllKeys())) || []) if (!used.has(k)) await tx('media', 'readwrite', s => s.delete(k));
}
// 隱藏／取消隱藏（只是不在「我的模組」顯示，資料還在）
export async function setModulesHidden(ids, v) {
  for (const id of ids) {
    const rec = await tx('mods', 'readonly', s => s.get(id));
    if (!rec) continue;
    if (v) rec.hidden = true; else delete rec.hidden;
    await tx('mods', 'readwrite', s => s.put(rec));
  }
}
// 把模組放進專案：素材（已經有的就共用）、合成換新 id；回傳模組的主合成
export async function insertModule(project, id) {
  const rec = await tx('mods', 'readonly', s => s.get(id));
  if (!rec) return null;
  const fmap = {};
  for (const f of rec.footage) {
    let have = project.footage.find(x => x.blobKey === f.blobKey);
    if (!have) {
      have = clone(f);
      const blob = await tx('media', 'readonly', s => s.get(f.blobKey));
      if (blob) { await M.Store.putBlob(have.blobKey, blob); await Media.attachBlob(have, blob); }
      project.footage.push(have);
    }
    fmap[f.id] = have.id;
  }
  const cmap = {};
  const comps = clone(rec.comps);
  for (const c of comps) { const n = uid('c'); cmap[c.id] = n; c.id = n; }
  for (const c of comps) {
    const lmap = {};
    for (const l of c.layers) { const n = uid('l'); lmap[l.id] = n; l.id = n; }
    for (const l of c.layers) {
      if (l.parent) l.parent = lmap[l.parent] ?? null;
      if (l.matteLayer) l.matteLayer = lmap[l.matteLayer] ?? null;
      if (l.source) l.source = fmap[l.source] ?? l.source;
      if (l.comp) l.comp = cmap[l.comp] ?? l.comp;
      for (const e of l.effects) e.id = uid('e');
    }
    project.comps.push(c);
  }
  return comps.find(c => c.id === cmap[rec.main]) || comps[0];
}

// ---------------- 替換照片：四角追蹤 ----------------
// 取得某個時間的畫面（追蹤用的大小）
export async function frameAt(v, t, w) {
  const h = Math.round(w * v.h / v.w);
  const sink = new CanvasSink(v.track, { width: w, height: h, fit: 'fill', poolSize: 0 });
  const fr = await sink.getCanvas(Math.max(0, t));
  return fr?.canvas || null;
}

const gray = (cv) => {
  const g = cv.getContext('2d', { willReadFrequently: true }), { width: W, height: H } = cv;
  const d = g.getImageData(0, 0, W, H).data, out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return { a: out, W, H };
};
// 以 (x,y) 為中心取 (2r+1)² 的小方塊
function patch(img, x, y, r) {
  const n = 2 * r + 1, p = new Float32Array(n * n);
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    const xx = Math.min(img.W - 1, Math.max(0, Math.round(x + i))), yy = Math.min(img.H - 1, Math.max(0, Math.round(y + j)));
    p[(j + r) * n + (i + r)] = img.a[yy * img.W + xx];
  }
  return p;
}
// 某個位置和樣板的差異（零平均的平方差）
function errAt(img, tpl, tm, cx, cy, r) {
  const n = 2 * r + 1;
  let sum = 0, cnt = 0;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const xx = Math.min(img.W - 1, Math.max(0, cx + i)), yy = Math.min(img.H - 1, Math.max(0, cy + j)); sum += img.a[yy * img.W + xx]; cnt++; }
  const m = sum / cnt;
  let e = 0;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    const xx = Math.min(img.W - 1, Math.max(0, cx + i)), yy = Math.min(img.H - 1, Math.max(0, cy + j));
    const dv = (img.a[yy * img.W + xx] - m) - (tpl[(j + r) * n + (i + r)] - tm); e += dv * dv;
  }
  return e;
}
// 整數位置找到之後，用左右、上下的差異畫拋物線，求出小數點的位置（慢慢移動的相框才追得到）
function subpixel(img, tpl, x, y, r) {
  let tm = 0; for (const v of tpl) tm += v; tm /= tpl.length;
  const e0 = errAt(img, tpl, tm, x, y, r);
  const ex1 = errAt(img, tpl, tm, x - 1, y, r), ex2 = errAt(img, tpl, tm, x + 1, y, r);
  const ey1 = errAt(img, tpl, tm, x, y - 1, r), ey2 = errAt(img, tpl, tm, x, y + 1, r);
  const dx = (ex1 + ex2 - 2 * e0) > 0 ? Math.max(-0.5, Math.min(0.5, (ex1 - ex2) / (2 * (ex1 + ex2 - 2 * e0)))) : 0;
  const dy = (ey1 + ey2 - 2 * e0) > 0 ? Math.max(-0.5, Math.min(0.5, (ey1 - ey2) / (2 * (ey1 + ey2 - 2 * e0)))) : 0;
  return [x + dx, y + dy];
}
// 在 (x,y) 附近 ±R 找和樣板最像的位置（零平均的平方差，對亮度變化不敏感）
function search(img, tpl, x, y, r, R, step = 1) {
  const n = 2 * r + 1;
  let tm = 0; for (const v of tpl) tm += v; tm /= tpl.length;
  let best = Infinity, bx = x, by = y;
  for (let dy = -R; dy <= R; dy += step) for (let dx = -R; dx <= R; dx += step) {
    const cx = Math.round(x + dx), cy = Math.round(y + dy);
    let sum = 0, cnt = 0;
    for (let j = -r; j <= r; j += 2) for (let i = -r; i <= r; i += 2) { const xx = cx + i, yy = cy + j; if (xx < 0 || yy < 0 || xx >= img.W || yy >= img.H) continue; sum += img.a[yy * img.W + xx]; cnt++; }
    if (!cnt) continue;
    const m = sum / cnt;
    let e = 0;
    for (let j = -r; j <= r; j += 2) for (let i = -r; i <= r; i += 2) {
      const xx = Math.min(img.W - 1, Math.max(0, cx + i)), yy = Math.min(img.H - 1, Math.max(0, cy + j));
      const dv = (img.a[yy * img.W + xx] - m) - (tpl[(j + r) * n + (i + r)] - tm); e += dv * dv;
      if (e >= best) break;
    }
    if (e < best) { best = e; bx = cx; by = cy; }
  }
  return { x: bx, y: by, err: best };
}

// ---- 平面追蹤：在相框裡挑幾十個有紋理的點逐格追蹤，用 RANSAC 求透視變換（homography），四個角跟著變換移動 ----
// 角落本身是白邊或跑出畫面也追得到；畫面換掉（轉場）時吻合的點太少，就停在那裡。
function solve(A, b) {             // 高斯消去法解 n×n
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
// 最小平方法求 homography（src → dst，至少 4 組）
function fitH(src, dst) {
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
  for (let i = 0; i < src.length; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    for (const [row, rhs] of [[[x, y, 1, 0, 0, 0, -u * x, -u * y], u], [[0, 0, 0, x, y, 1, -v * x, -v * y], v]]) {
      for (let a = 0; a < 8; a++) { Atb[a] += row[a] * rhs; for (let b = 0; b < 8; b++) AtA[a][b] += row[a] * row[b]; }
    }
  }
  const h = solve(AtA, Atb);
  return h ? [...h, 1] : null;
}
const applyH = (H, [x, y]) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };
function ransacH(src, dst, iters = 80, thr = 2.5) {
  const n = src.length;
  if (n < 6) return null;
  let best = null, bestIn = [];
  for (let it = 0; it < iters; it++) {
    const idx = new Set(); while (idx.size < 4) idx.add(Math.floor(Math.random() * n));
    const s = [...idx];
    const H = fitH(s.map(i => src[i]), s.map(i => dst[i]));
    if (!H) continue;
    const inl = [];
    for (let i = 0; i < n; i++) { const p = applyH(H, src[i]); if (Math.hypot(p[0] - dst[i][0], p[1] - dst[i][1]) < thr) inl.push(i); }
    if (inl.length > bestIn.length) { bestIn = inl; best = H; }
  }
  if (bestIn.length >= 6) best = fitH(bestIn.map(i => src[i]), bestIn.map(i => dst[i])) || best;
  return best ? { H: best, ratio: bestIn.length / n, inliers: bestIn.length } : null;
}
const inQuad = (q, [x, y]) => { let s = 0; for (let i = 0; i < 4; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4]; const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax); if (c !== 0) { if (s === 0) s = Math.sign(c); else if (Math.sign(c) !== s) return false; } } return true; };
// 在相框範圍內挑紋理最豐富的點（方塊亮度的變異數大）
function pickFeatures(img, quad, r, want = 60) {
  const xs = quad.map(p => p[0]), ys = quad.map(p => p[1]);
  // 座標一定要是整數（陣列索引）
  const x0 = Math.round(Math.max(r + 1, Math.min(...xs))), x1 = Math.round(Math.min(img.W - r - 2, Math.max(...xs))), y0 = Math.round(Math.max(r + 1, Math.min(...ys))), y1 = Math.round(Math.min(img.H - r - 2, Math.max(...ys)));
  const cand = [];
  const step = Math.max(6, Math.round(Math.sqrt((x1 - x0) * (y1 - y0) / (want * 4))));
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    if (!inQuad(quad, [x, y])) continue;
    let s = 0, s2 = 0, n = 0;
    for (let j = -r; j <= r; j += 2) for (let i = -r; i <= r; i += 2) { const v = img.a[(y + j) * img.W + x + i]; s += v; s2 += v * v; n++; }
    const varr = s2 / n - (s / n) ** 2;
    if (varr > 60) cand.push([x, y, varr]);
  }
  cand.sort((a, b) => b[2] - a[2]);
  return cand.slice(0, want).map(([x, y]) => [x, y]);
}

// 從 t0（素材時間）往前、往後追蹤；corners 是影片原尺寸的座標（左上、右上、右下、左下）
// 回傳 [{ t, pts }]，另外 .lostAfter／.lostBefore 表示追丟的時間（畫面換掉了）
export async function trackCorners(v, t0, tA, tB, corners, fps, onProgress, signal) {
  const TW = Math.min(640, v.w), k = TW / v.w, TH = Math.round(v.h * k);
  const r = 6, R = 18;
  const all = [];
  for (let t = tA; t <= tB + 1e-6; t += 1 / fps) all.push(Math.round(t * fps) / fps);
  const i0 = Math.max(0, Math.min(all.length - 1, Math.round((t0 - tA) * fps)));
  const result = new Array(all.length);
  const sink = new CanvasSink(v.track, { width: TW, height: TH, fit: 'fill', poolSize: 1 });
  const out = { lostAfter: null, lostBefore: null, log: [] };
  const run = async (order, dir) => {
    // 參考畫面：特徵點的樣板都取自參考畫面，每一格直接和參考畫面比（小誤差不會一格一格累積）
    let quad = corners.map(([x, y]) => [x * k, y * k]);
    let ref = null, refFeats = null, refQuad = null, Hcur = null, done = 0, sinceRef = 0, tpls = null;
    const setRef = img => { ref = img; refQuad = quad.map(p => [...p]); refFeats = pickFeatures(img, quad, r); tpls = refFeats.map(([x, y]) => patch(img, x, y, r)); Hcur = [1, 0, 0, 0, 1, 0, 0, 0, 1]; sinceRef = 0; };
    for await (const fr of sink.canvasesAtTimestamps(order.map(i => all[i]))) {
      if (signal?.aborted) throw new DOMException('abort', 'AbortError');
      const idx = order[done++];
      if (!fr) continue;
      const img = gray(fr.canvas);
      if (ref) {
        const src = [], dst = [];
        refFeats.forEach(([x, y], i) => {
          const [px, py] = applyH(Hcur, [x, y]);             // 預測位置：上一格的變換
          const c1 = search(img, tpls[i], px, py, r, R, 2);
          const c2 = search(img, tpls[i], c1.x, c1.y, r, 2, 1);
          src.push([x, y]); dst.push(subpixel(img, tpls[i], c2.x, c2.y, r));
        });
        const fit = ransacH(src, dst, 80, 1.8);
        out.log.push([all[idx], src.length, fit ? +fit.ratio.toFixed(2) : 0]);
        if (!fit || fit.ratio < 0.35) { out[dir > 0 ? 'lostAfter' : 'lostBefore'] = all[idx]; break; }   // 畫面換掉了
        Hcur = fit.H;
        quad = refQuad.map(p => applyH(Hcur, p));
        // 相框變形太多或吻合變少：改用這一格當新的參考畫面
        if (++sinceRef >= 20 || fit.ratio < 0.6) setRef(img);
      } else setRef(img);
      result[idx] = { t: all[idx], pts: quad.map(([x, y]) => [x / k, y / k]) };
      onProgress?.(result.filter(Boolean).length / all.length);
      if (done % 8 === 0) await new Promise(res => setTimeout(res));
    }
  };
  const fwd = []; for (let i = i0; i < all.length; i++) fwd.push(i);
  const back = []; for (let i = i0; i >= 0; i--) back.push(i);
  await run(fwd, 1);
  if (back.length > 1) await run(back, -1);
  const list = result.filter(Boolean);
  list.lostAfter = out.lostAfter; list.lostBefore = out.lostBefore; list.log = out.log;
  return list;
}

// 示範照片（沒選照片時用）：漸層＋「替換照片」字樣
export async function placeholderPhoto(w, h, label) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#3a6df0'); gr.addColorStop(1, '#c04ff0');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#fff'; g.lineWidth = Math.max(4, w / 80); g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  g.fillStyle = '#fff'; g.font = `700 ${Math.round(h / 8)}px "Noto Sans TC",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('📷 ' + label, w / 2, h / 2);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new File([blob], label + '.png', { type: 'image/png' });
}

// 把追蹤結果變成圖層：照片放進合成大小的巢狀合成，再用「邊角釘選」逐格貼到相框四角
export function buildPhotoLayer(project, comp, videoLayer, photoFootage, track, label) {
  const inner = M.newComp({ name: `${comp.name}_${label}`, w: comp.w, h: comp.h, fps: comp.fps, duration: comp.duration, bg: [0, 0, 0, 0] });
  const img = M.makeFootageLayer(inner, photoFootage, { name: photoFootage.name, fit: false });
  // 照片填滿整個畫面（之後四角釘選會把整個畫面對到相框）
  const k = Math.max(comp.w / (photoFootage.w || 1), comp.h / (photoFootage.h || 1)) * 100;
  img.transform.scale.v = [k, k, 100];
  img.out = inner.duration;
  inner.layers.push(img);
  project.comps.push(inner);
  const pl = M.makePrecomp(comp, inner, { name: label });
  pl.out = comp.duration;
  const def = getEffect('cornerPin');
  const e = M.makeEffect(def, pl, project);
  const ids = ['upperLeft', 'upperRight', 'lowerRight', 'lowerLeft'];   // 追蹤順序：左上、右上、右下、左下
  for (const id of ids) e.params[id] = P([0, 0]);
  // 影片圖層的時間 → 合成時間：comp t = 素材時間 + start
  for (const fr of track) {
    const ct = fr.t + videoLayer.start;
    if (ct < -1e-6 || ct > comp.duration + 1e-6) continue;
    ids.forEach((id, c) => { const kf = setKey(e.params[id], ct - pl.start, [fr.pts[c][0], fr.pts[c][1]]); kf.ti = 'linear'; });
  }
  pl.effects.push(e);
  pl.photoSlot = true;   // 之後「更換照片」認得這個圖層
  // 只在追蹤到的時間出現（追丟＝畫面換掉之後，照片就不該再釘在那裡）
  const ts = track.map(fr => fr.t + videoLayer.start);
  pl.in = Math.max(0, Math.min(...ts)); pl.out = Math.min(comp.duration, Math.max(...ts) + 1 / comp.fps);
  const at = comp.layers.indexOf(videoLayer);
  comp.layers.splice(Math.max(0, at), 0, pl);
  return pl;
}

// ---------------- 更換照片：保留追蹤好的動作，只換照片 ----------------
// 「替換照片」圖層（巢狀合成＋邊角釘選）或一般圖片圖層 → 要換的圖片圖層與它所在的合成
export function photoSlotOf(project, comp, l) {
  if (!l) return null;
  if (l.type === 'image') return { comp, img: l, slot: false };
  if (l.type === 'precomp') {
    const inner = M.getComp(project, l.comp);
    const imgs = inner?.layers.filter(x => x.type === 'image') || [];
    if (imgs.length === 1 && (l.photoSlot || l.effects.some(e => e.type === 'cornerPin'))) return { comp: inner, img: imgs[0], slot: true };
  }
  return null;
}
// 換掉圖片：替換照片的槽一律填滿整個畫面（四角釘選才會對到相框）；一般圖片維持原本在畫面上的寬度
export function swapPhoto(project, s, f) {
  const img = s.img, old = M.getFootage(project, img.source);
  img.source = f.id; img.name = f.name;
  const tr = img.transform;
  tr.anchor.v = [f.w / 2, f.h / 2, 0]; delete tr.anchor.k;
  if (s.slot) {
    const k = Math.max(s.comp.w / (f.w || 1), s.comp.h / (f.h || 1)) * 100;
    tr.scale.v = [k, k, 100]; delete tr.scale.k;
    tr.position.v = [s.comp.w / 2, s.comp.h / 2, 0]; delete tr.position.k;
  } else if (old?.w && !tr.scale.k) {
    const k = tr.scale.v[0] * old.w / (f.w || 1);
    tr.scale.v = [k, k * (tr.scale.v[1] / (tr.scale.v[0] || 1)), tr.scale.v[2] ?? 100];
  }
}
