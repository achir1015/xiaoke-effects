// 聲音排程：預覽播放與匯出混音共用。收集所有會發聲的圖層（含巢狀合成），排進 AudioContext
import { rawAt } from './anim.js';
import { getComp, getFootage } from './model.js';
import * as Media from './media.js';

async function gather(project, comp, map, out, depth = 0) {
  for (const l of comp.layers) {
    if (depth > 8 || l.audioOn === false) continue;
    if ((l.type === 'audio' || l.type === 'video') && !l.timeRemap?.on) {
      const f = getFootage(project, l.source); if (!f) continue;
      const buf = await Media.audioBuffer(f); if (!buf) continue;
      out.push({ buf, l, map });
    } else if (l.type === 'precomp' && l.visible && !l.timeRemap?.on) {
      const sub = getComp(project, l.comp); if (!sub) continue;
      await gather(project, sub, { parent: map, l, sp: l.speed || 1 }, out, depth + 1);
    }
  }
}
// map 鏈：子合成時間 ↔ 最外層時間
const chain = map => { const c = []; for (let m = map; m; m = m.parent) c.push(m); return c; };
function toOuter(map, a, b) {
  for (const m of chain(map)) {
    a = m.l.start + a / m.sp; b = m.l.start + b / m.sp;
    a = Math.max(a, m.l.in); b = Math.min(b, m.l.out);
    if (b <= a) return null;
  }
  return [a, b];
}
function toInner(map, x) { const c = chain(map); for (let i = c.length - 1; i >= 0; i--) x = (x - c[i].l.start) * c[i].sp; return x; }

// 把 [t0, t1] 這段合成時間的聲音排進 ctx，從 when 開始播；回傳排了幾個聲音
export async function scheduleAudio(ctx, dest, project, comp, t0, t1, when = 0, nodes = []) {
  const list = [];
  await gather(project, comp, null, list);
  let count = 0;
  for (const { buf, l, map } of list) {
    const r = toOuter(map, l.in, l.out); if (!r) continue;
    let [a, b] = r;
    a = Math.max(a, t0); b = Math.min(b, t1);
    if (b <= a) continue;
    const rate = (l.speed || 1) * chain(map).reduce((k, m) => k * m.sp, 1);
    const srcOff = (toInner(map, a) - l.start) * (l.speed || 1);
    if (srcOff >= buf.duration) continue;
    const n = ctx.createBufferSource(); n.buffer = buf; n.playbackRate.value = rate;
    const g = ctx.createGain();
    for (let tt = a; tt <= b + 1e-6; tt += 1 / 30) {
      const db = l.audio ? rawAt(l.audio.level, toInner(map, tt) - l.start) : 0;
      g.gain.setValueAtTime(Math.pow(10, db / 20), when + tt - t0);
    }
    n.connect(g).connect(dest);
    n.start(when + a - t0, Math.max(0, srcOff), Math.min(buf.duration - srcOff, (b - a) * rate));
    nodes.push(n);
    count++;
  }
  return count;
}
