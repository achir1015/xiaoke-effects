// 算繪輸出：MP4（H.264＋AAC）、WebM（VP9＋Opus）、GIF、PNG 單張／序列（ZIP，含透明）、WAV、Lottie
import {
  Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec,
} from '../vendor/mediabunny.min.mjs';
import { GIFEncoder, quantize, applyPalette } from '../vendor/gifenc.esm.js';
import { renderComp, prepareExact, layerActive, sourceTime } from './render.js';
import { rawAt } from './anim.js';
import { getComp, getFootage } from './model.js';
import * as Media from './media.js';
import { preloadFonts, fontString } from './text.js';
import { audioBufferToWav } from './panels.js';
import { scheduleAudio } from './audio.js';

const QUALITY_BPP = { low: 0.05, medium: 0.09, high: 0.15, max: 0.25 };

// 先載入所有用到的字型，第一格才不會用到預設字型
async function prepFonts(project) {
  const list = [];
  for (const c of project.comps) for (const l of c.layers) if (l.type === 'text') list.push([fontString(l.text, 40), String(l.text.text.v || 'A')]);
  await preloadFonts(list);
}

export async function renderStill(project, comp, t, scale = 1, transparent = false) {
  await prepFonts(project);
  await prepareExact(project, comp, t);
  const cv = document.createElement('canvas');
  renderComp(project, comp, t, cv, { scale, exact: true, transparent });
  return new Promise(r => cv.toBlob(r, 'image/png'));
}

export async function mixAudio(project, comp, t0, t1) {
  if (t1 <= t0) return null;
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil((t1 - t0) * sr) + 1, sr);
  const n = await scheduleAudio(ctx, ctx.destination, project, comp, t0, t1, 0);
  return n ? ctx.startRendering() : null;
}
function sliceBuffer(buf, start, len) {
  const out = new AudioBuffer({ length: len, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(start, start + len), c);
  return out;
}

// ---- ZIP（不壓縮，PNG 本身已壓縮）----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
export class ZipWriter {
  constructor() { this.parts = []; this.central = []; this.offset = 0; }
  add(name, u8) {
    const nb = new TextEncoder().encode(name), crc = crc32(u8);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, u8.length, true); lh.setUint32(22, u8.length, true); lh.setUint16(26, nb.length, true);
    this.parts.push(lh.buffer, nb, u8);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, u8.length, true); ch.setUint32(24, u8.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, this.offset, true);
    this.central.push(ch.buffer, nb);
    this.offset += 30 + nb.length + u8.length;
    this.count = (this.count || 0) + 1;
  }
  finish() {
    const size = this.central.reduce((s, b) => s + (b.byteLength ?? b.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, this.count, true); end.setUint16(10, this.count, true); end.setUint32(12, size, true); end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, end.buffer], { type: 'application/zip' });
  }
}

// opts：{ format, res, quality, range:'work'|'full', fps }
export async function exportComp(project, comp, opts, onProgress, signal) {
  await prepFonts(project);
  const fps = opts.fps || comp.fps;
  const t0 = opts.range === 'full' ? 0 : comp.workIn, t1 = opts.range === 'full' ? comp.duration : comp.workOut;
  const N = Math.max(1, Math.round((t1 - t0) * fps));
  let scale = opts.res || 1;
  if (opts.format === 'gif') scale = Math.min(scale, 640 / Math.max(comp.w, comp.h));
  const W = Math.max(2, Math.round(comp.w * scale) & ~1), H = Math.max(2, Math.round(comp.h * scale) & ~1);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const work = document.createElement('canvas');
  const transparent = opts.format === 'png' || opts.format === 'pngseq';
  const frameAt = async i => {
    const tt = t0 + i / fps;
    await prepareExact(project, comp, tt);
    renderComp(project, comp, tt, work, { scale: W / comp.w, exact: true, transparent });
    const g = cv.getContext('2d'); g.clearRect(0, 0, W, H); g.drawImage(work, 0, 0, W, H);
  };
  const abort = async out => { if (signal?.aborted) { if (out) await out.cancel().catch(() => { }); throw new DOMException('abort', 'AbortError'); } };
  const tick = () => new Promise(r => setTimeout(r));

  if (opts.format === 'png') {
    await frameAt(Math.round((Math.min(Math.max(opts.time ?? t0, t0), t1) - t0) * fps));
    return { blob: await new Promise(r => cv.toBlob(r, 'image/png')), ext: 'png' };
  }
  if (opts.format === 'pngseq') {
    const zip = new ZipWriter();
    for (let i = 0; i < N; i++) {
      await abort(); await frameAt(i);
      const b = await new Promise(r => cv.toBlob(r, 'image/png'));
      zip.add(`${comp.name.replace(/[\\/:*?"<>|]/g, '_')}_${String(i).padStart(5, '0')}.png`, new Uint8Array(await b.arrayBuffer()));
      onProgress?.((i + 1) / N);
    }
    return { blob: zip.finish(), ext: 'zip' };
  }
  if (opts.format === 'wav') {
    const mixed = await mixAudio(project, comp, t0, t1);
    if (!mixed) throw new Error('no-audio');
    return { blob: audioBufferToWav(mixed), ext: 'wav' };
  }
  if (opts.format === 'lottie') {
    const { exportLottie } = await import('./lottie.js');
    const r = exportLottie(project, comp);
    return { blob: new Blob([JSON.stringify(r.json)], { type: 'application/json' }), ext: 'json', warnings: r.warnings };
  }
  if (opts.format === 'gif') {
    const gif = GIFEncoder();
    const gfps = Math.min(fps, 25), n = Math.max(1, Math.round((t1 - t0) * gfps)), delay = Math.round(1000 / gfps);
    for (let i = 0; i < n; i++) {
      await abort();
      const tt = t0 + i / gfps;
      await prepareExact(project, comp, tt);
      renderComp(project, comp, tt, work, { scale: W / comp.w, exact: true });
      const g = cv.getContext('2d'); g.drawImage(work, 0, 0, W, H);
      const { data } = g.getImageData(0, 0, W, H);
      const palette = quantize(data, 256, { format: 'rgb565' });
      gif.writeFrame(applyPalette(data, palette, 'rgb565'), W, H, { palette, delay });
      onProgress?.((i + 1) / n);
      if (i % 3 === 0) await tick();
    }
    gif.finish();
    return { blob: new Blob([gif.bytes()], { type: 'image/gif' }), ext: 'gif' };
  }
  // MP4 / WebM
  const webm = opts.format === 'webm';
  const vcodec = await getFirstEncodableVideoCodec(webm ? ['vp9', 'vp8', 'av1'] : ['avc', 'hevc', 'vp9', 'av1'], { width: W, height: H });
  if (!vcodec) throw new Error('no-encoder');
  const output = new Output({ format: webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vsrc = new CanvasSource(cv, { codec: vcodec, bitrate: Math.round(W * H * fps * (QUALITY_BPP[opts.quality] || 0.15)), keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: fps });
  onProgress?.(0, 'audio');
  const mixed = await mixAudio(project, comp, t0, t1).catch(e => { console.warn('audio', e); return null; });
  let asrc = null;
  if (mixed) {
    const acodec = await getFirstEncodableAudioCodec(webm ? ['opus', 'vorbis'] : ['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000 });
    if (acodec) { asrc = new AudioBufferSource({ codec: acodec, bitrate: 192e3 }); output.addAudioTrack(asrc); }
  }
  await output.start();
  if (asrc) {
    const step = mixed.sampleRate * 5;
    for (let s = 0; s < mixed.length; s += step) await asrc.add(sliceBuffer(mixed, s, Math.min(step, mixed.length - s)));
    asrc.close();
  }
  for (let i = 0; i < N; i++) {
    await abort(output);
    await frameAt(i);
    await vsrc.add(i / fps, 1 / fps);
    onProgress?.((i + 1) / N);
  }
  vsrc.close();
  await output.finalize();
  return { blob: new Blob([output.target.buffer], { type: webm ? 'video/webm' : 'video/mp4' }), ext: webm ? 'webm' : 'mp4', codec: vcodec };
}
