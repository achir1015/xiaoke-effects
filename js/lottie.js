// 匯出 Lottie JSON（bodymovin 格式）：純色、圖片、形狀、文字、空物件、巢狀合成、關鍵影格（含緩動、保持）、遮罩、軌道遮罩、混合模式
// 表達式會逐格烘焙成關鍵影格；Lottie 不支援的內容（特效、3D、影片、文字動畫器）列在 warnings
import { rawAt, hasExpr, animated, LINEAR_O, LINEAR_I } from './anim.js';
import { evaluator } from './render.js';
import { getComp, getFootage } from './model.js';
import { imageOf } from './media.js';
import { t } from './i18n.js';

const BM = { normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, colorDodge: 6, colorBurn: 7, hardLight: 8, softLight: 9, difference: 10, exclusion: 11, hue: 12, saturation: 13, color: 14, luminosity: 15, add: 16, linearDodge: 16, hardMix: 17 };
const TT = { alpha: 1, alphaInv: 2, luma: 3, lumaInv: 4 };
const MM = { add: 'a', subtract: 's', intersect: 'i', difference: 'f', none: 'n' };
const r3 = x => Math.round(x * 1000) / 1000;
const arr = v => Array.isArray(v) ? v.map(r3) : [r3(v)];

export function exportLottie(project, comp) {
  const warnings = new Set();
  const assets = [], fonts = new Map();
  const doneComps = new Set();
  const imgCache = new Map();

  function prop(l, c, p, map = v => v, opts = {}) {
    const fr = c.fps;
    const out = v => { const m = map(v); return opts.scalar ? r3(Array.isArray(m) ? m[0] : m) : arr(m); };
    if (hasExpr(p)) {
      // 表達式：逐格取值
      const k = [];
      for (let f = Math.floor(l.in * fr); f <= Math.ceil(l.out * fr); f++) {
        const ev = evaluator(project, c, l, f / fr);
        k.push({ t: f, s: [].concat(out(ev(p))), i: { x: [1], y: [1] }, o: { x: [0], y: [0] }, h: 0 });
      }
      return { a: 1, k: k.map((x, i) => i === k.length - 1 ? { t: x.t, s: x.s } : x) };
    }
    if (!animated(p)) return { a: 0, k: out(p.v) };
    const K = p.k;
    return {
      a: 1, k: K.map((k, i) => {
        const nx = K[i + 1];
        const o = { t: r3((k.t + l.start) * fr), s: [].concat(out(k.v)) };
        if (!nx) return o;
        if (k.ti === 'hold') o.h = 1;
        const eo = k.ti === 'linear' ? LINEAR_O : k.eo || LINEAR_O, ei = k.ti === 'linear' ? LINEAR_I : nx.ei || LINEAR_I;
        const dims = o.s.length;
        o.o = { x: Array(dims).fill(r3(eo[0])), y: Array(dims).fill(r3(eo[1])) };
        o.i = { x: Array(dims).fill(r3(ei[0])), y: Array(dims).fill(r3(ei[1])) };
        return o;
      }),
    };
  }
  const color = v => [v[0], v[1], v[2], 1];

  function pathK(path) {
    return { c: !!path.closed, v: path.pts.map(p => [r3(p[0]), r3(p[1])]), i: path.pts.map(p => [r3(p[2]), r3(p[3])]), o: path.pts.map(p => [r3(p[4]), r3(p[5])]) };
  }
  function pathProp(l, c, p) {
    if (!animated(p)) return { a: 0, k: pathK(p.v) };
    return { a: 1, k: p.k.map((k, i) => { const o = { t: r3((k.t + l.start) * c.fps), s: [pathK(k.v)] }; if (p.k[i + 1]) { o.o = { x: [r3((k.eo || LINEAR_O)[0])], y: [r3((k.eo || LINEAR_O)[1])] }; o.i = { x: [r3((p.k[i + 1].ei || LINEAR_I)[0])], y: [r3((p.k[i + 1].ei || LINEAR_I)[1])] }; if (k.ti === 'hold') o.h = 1; } return o; }) };
  }

  function shapeItems(l, c) {
    return (l.shapes || []).filter(it => it.visible !== false).map(it => {
      const P = (p, m, o) => prop(l, c, p, m, o);
      const items = [];
      if (it.kind === 'rect') items.push({ ty: 'rc', nm: it.name, d: 1, s: P(it.size), p: { a: 0, k: [0, 0] }, r: P(it.round, undefined, { scalar: true }) });
      else if (it.kind === 'ellipse') items.push({ ty: 'el', nm: it.name, d: 1, s: P(it.size), p: { a: 0, k: [0, 0] } });
      else if (it.kind === 'star' || it.kind === 'polygon') items.push({ ty: 'sr', nm: it.name, d: 1, sy: it.kind === 'star' ? 1 : 2, pt: P(it.points, undefined, { scalar: true }), p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 }, or: P(it.outerR, undefined, { scalar: true }), os: { a: 0, k: 0 }, ...(it.kind === 'star' ? { ir: P(it.innerR, undefined, { scalar: true }), is: { a: 0, k: 0 } } : {}) });
      else if (it.kind === 'path') items.push({ ty: 'sh', nm: it.name, d: 1, ks: pathProp(l, c, it.path) });
      if (it.zigzag?.on || it.wiggle?.on) warnings.add(t('lw_modifiers'));
      if (it.trim?.on) items.push({ ty: 'tm', nm: 'Trim', s: P(it.trim.start, undefined, { scalar: true }), e: P(it.trim.end, undefined, { scalar: true }), o: P(it.trim.offset, undefined, { scalar: true }), m: 1 });
      if (it.stroke?.on) {
        const st = { ty: 'st', nm: 'Stroke', c: P(it.stroke.color, color), o: P(it.stroke.opacity, undefined, { scalar: true }), w: P(it.stroke.width, undefined, { scalar: true }), lc: { butt: 1, round: 2, square: 3 }[it.stroke.cap] || 2, lj: 2, ml: 4 };
        if (rawAt(it.stroke.dash, 0) > 0) st.d = [{ n: 'd', nm: 'dash', v: P(it.stroke.dash, undefined, { scalar: true }) }, { n: 'g', nm: 'gap', v: P(it.stroke.gap.v > 0 ? it.stroke.gap : it.stroke.dash, undefined, { scalar: true }) }, { n: 'o', nm: 'offset', v: { a: 0, k: 0 } }];
        items.push(st);
      }
      if (it.fill?.on) {
        if (it.fill.type !== 'solid') warnings.add(t('lw_gradient'));
        items.push({ ty: 'fl', nm: 'Fill', c: P(it.fill.color, color), o: P(it.fill.opacity, undefined, { scalar: true }), r: 1 });
      }
      if (it.repeater?.on) items.push({ ty: 'rp', nm: 'Repeater', c: P(it.repeater.copies, undefined, { scalar: true }), o: { a: 0, k: 0 }, m: 1, tr: { ty: 'tr', p: P(it.repeater.offset), a: { a: 0, k: [0, 0] }, s: P(it.repeater.scale), r: P(it.repeater.rot, undefined, { scalar: true }), so: P(it.repeater.startOp, undefined, { scalar: true }), eo: P(it.repeater.endOp, undefined, { scalar: true }) } });
      items.push({ ty: 'tr', p: P(it.pos), a: { a: 0, k: [0, 0] }, s: P(it.scl), r: P(it.rot, undefined, { scalar: true }), o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } });
      return { ty: 'gr', nm: it.name, it: items };
    });
  }

  function imageAsset(f) {
    if (imgCache.has(f.id)) return imgCache.get(f.id);
    const id = 'img_' + assets.length;
    const asset = { id, w: f.w, h: f.h, u: '', p: '', e: 1 };
    assets.push(asset);
    imgCache.set(f.id, id);
    pendingImages.push({ asset, f });
    return id;
  }
  const pendingImages = [];

  function layers(c) {
    const ind = new Map(c.layers.map((l, i) => [l.id, i + 1]));
    const out = [];
    c.layers.forEach((l, i) => {
      const fr = c.fps;
      const base = { ddd: 0, ind: i + 1, nm: l.name, sr: 1, ao: 0, ip: r3(l.in * fr), op: r3(l.out * fr), st: r3(l.start * fr), bm: BM[l.blend] ?? 0 };
      if (l.blend && BM[l.blend] === undefined) warnings.add(t('lw_blend'));
      if (l.parent && ind.has(l.parent)) base.parent = ind.get(l.parent);
      if (l.threeD) warnings.add(t('lw_3d'));
      if (l.effects.some(e => e.on !== false)) warnings.add(t('lw_effects'));
      if (!l.visible) base.hd = true;
      const tr = l.transform;
      let anchorMap = v => [v[0], v[1], 0];
      if (l.type === 'text') { const sz = rawAt(l.text.size, 0); anchorMap = v => [v[0], v[1] - sz * 0.35, 0]; }
      base.ks = { o: prop(l, c, tr.opacity, undefined, { scalar: true }), r: prop(l, c, tr.rotation, undefined, { scalar: true }), p: prop(l, c, tr.position, v => [v[0], v[1], 0]), a: prop(l, c, tr.anchor, anchorMap), s: prop(l, c, tr.scale, v => [v[0], v[1], 100]) };
      // 軌道遮罩：Lottie 是用「上一層」當遮罩
      const usedAsMatte = c.layers.some((x, j) => x.matte && x.matte !== 'none' && (x.matteLayer ? x.matteLayer === l.id : j === i + 1));
      if (usedAsMatte) base.td = 1;
      if (l.matte && l.matte !== 'none') { base.tt = TT[l.matte]; if (l.matteLayer && c.layers[i - 1]?.id !== l.matteLayer) warnings.add(t('lw_matte')); }
      if (l.masks.length) {
        base.hasMask = true;
        base.masksProperties = l.masks.map(m => ({ inv: !!m.inverted, mode: MM[m.mode] || 'a', nm: m.name, pt: pathProp(l, c, m.path), o: prop(l, c, m.opacity, undefined, { scalar: true }), x: prop(l, c, m.expansion, undefined, { scalar: true }) }));
        if (l.masks.some(m => rawAt(m.feather, 0) > 0)) warnings.add(t('lw_feather'));
      }
      switch (l.type) {
        case 'solid': { const col = rawAt(l.solid.color, 0); out.push({ ...base, ty: 1, sc: '#' + col.slice(0, 3).map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''), sw: l.solid.w, sh: l.solid.h }); if (animated(l.solid.color)) warnings.add(t('lw_solidColor')); break; }
        case 'null': case 'adjust': out.push({ ...base, ty: 3 }); if (l.type === 'adjust') warnings.add(t('lw_effects')); break;
        case 'shape': out.push({ ...base, ty: 4, shapes: shapeItems(l, c) }); break;
        case 'image': { const f = getFootage(project, l.source); if (!f) break; out.push({ ...base, ty: 2, refId: imageAsset(f) }); break; }
        case 'precomp': {
          const sub = getComp(project, l.comp); if (!sub) break;
          const id = 'comp_' + sub.id;
          if (!doneComps.has(sub.id)) { doneComps.add(sub.id); assets.push({ id, nm: sub.name, fr: sub.fps, layers: layers(sub) }); }
          const pl = { ...base, ty: 0, refId: id, w: sub.w, h: sub.h };
          if (l.timeRemap?.on) pl.tm = prop(l, c, l.timeRemap.p, undefined, { scalar: true });
          if (l.speed && l.speed !== 1) pl.sr = 1 / l.speed;
          out.push(pl); break;
        }
        case 'text': {
          const tx = l.text, fam = tx.font, fName = fam.replace(/\s+/g, '') + '-' + tx.weight;
          fonts.set(fName, { fName, fFamily: fam, fStyle: tx.weight >= 700 ? 'Bold' : 'Regular', ascent: 75, fWeight: String(tx.weight) });
          if (tx.animators.length) warnings.add(t('lw_textAnim'));
          const doc = v => ({ s: rawAt(tx.size, 0), f: fName, t: String(v).replace(/\n/g, '\r'), j: { left: 0, right: 1, center: 2 }[tx.align] ?? 2, tr: rawAt(tx.tracking, 0), lh: rawAt(tx.size, 0) * rawAt(tx.leading, 0), ls: 0, fc: rawAt(tx.fill, 0).slice(0, 3), ...(rawAt(tx.strokeW, 0) > 0 ? { sc: rawAt(tx.stroke, 0).slice(0, 3), sw: rawAt(tx.strokeW, 0) * 2, of: !tx.strokeOver } : {}) });
          const tp = tx.text;
          const kk = animated(tp) ? tp.k.map(k => ({ s: doc(k.v), t: r3((k.t + l.start) * c.fps) })) : [{ s: doc(tp.v), t: 0 }];
          if (hasExpr(tp)) warnings.add(t('lw_textExpr'));
          out.push({ ...base, ty: 5, t: { d: { k: kk }, p: {}, m: { g: 1, a: { a: 0, k: [0, 0] } }, a: [] } });
          break;
        }
        case 'video': warnings.add(t('lw_video')); break;
        case 'audio': break;
        case 'camera': case 'light': warnings.add(t('lw_3d')); break;
        default: warnings.add(t('lw_lib'));
      }
    });
    return out;
  }

  const json = { v: '5.7.4', fr: comp.fps, ip: 0, op: Math.round(comp.duration * comp.fps), w: comp.w, h: comp.h, nm: comp.name, ddd: 0, assets, layers: layers(comp), markers: [], meta: { g: '小柯機器人動態圖形和視覺特效工具' } };
  if (fonts.size) json.fonts = { list: [...fonts.values()] };
  // 圖片轉成內嵌 data URL（同步：用已解碼的圖片畫到畫布）
  for (const { asset, f } of pendingImages) {
    try {
      const cv = document.createElement('canvas'); cv.width = f.w; cv.height = f.h;
      const img = imageOf(f);
      if (img) { cv.getContext('2d').drawImage(img, 0, 0); asset.p = cv.toDataURL('image/png'); }
    } catch (e) { warnings.add(t('lw_image')); }
  }
  return { json, warnings: [...warnings] };
}
