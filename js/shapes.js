// 形狀圖層：矩形、橢圓、星形、多邊形、鋼筆路徑；修剪路徑、重複器、鋸齒、擺動；漸層填色
// 所有形狀先轉成折線（contours），修剪、量長度、算範圍都用同一套。
import { css, noise1 } from './util.js';

const TAU = Math.PI * 2;

// 貝茲路徑（遮罩、鋼筆）→ 折線；pts: [x, y, inX, inY, outX, outY]（切線是相對頂點的位移）
export function flattenPath(path, seg = 16) {
  const P = path?.pts || [];
  if (P.length < 2) return { pts: P.map(p => [p[0], p[1]]), closed: !!path?.closed };
  const out = [];
  const n = P.length, last = path.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const x0 = a[0], y0 = a[1], x1 = a[0] + a[4], y1 = a[1] + a[5], x2 = b[0] + b[2], y2 = b[1] + b[3], x3 = b[0], y3 = b[1];
    const straight = !a[4] && !a[5] && !b[2] && !b[3];
    const steps = straight ? 1 : seg;
    for (let s = 0; s < steps; s++) {
      const t = s / steps, u = 1 - t;
      out.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
    }
  }
  if (!path.closed) out.push([P[n - 1][0], P[n - 1][1]]);
  return { pts: out, closed: !!path.closed };
}

export function tracePath(ctx, path) {
  const P = path?.pts || [];
  if (!P.length) return;
  ctx.moveTo(P[0][0], P[0][1]);
  const n = P.length, last = path.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = P[i], b = P[(i + 1) % n];
    ctx.bezierCurveTo(a[0] + a[4], a[1] + a[5], b[0] + b[2], b[1] + b[3], b[0], b[1]);
  }
  if (path.closed) ctx.closePath();
}

function rectContour(w, h, r) {
  const x = -w / 2, y = -h / 2;
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  if (r < 0.5) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const pts = [], corner = (cx, cy, a0) => { for (let i = 0; i <= 8; i++) { const a = a0 + i / 8 * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return pts;
}
function ellipseContour(w, h) {
  const n = Math.max(24, Math.min(160, Math.round((Math.abs(w) + Math.abs(h)) / 8))), pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * TAU - Math.PI / 2; pts.push([Math.cos(a) * w / 2, Math.sin(a) * h / 2]); }
  return pts;
}
function starContour(points, ro, ri, star) {
  const n = Math.max(3, Math.round(points)), pts = [];
  for (let i = 0; i < n * (star ? 2 : 1); i++) {
    const a = i / (n * (star ? 2 : 1)) * TAU - Math.PI / 2, r = star && i % 2 ? ri : ro;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function contourLength(c) {
  let L = 0; const p = c.pts;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  if (c.closed && p.length > 1) L += Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]);
  return L;
}
// 取出折線上 [a, b]（0..1）那一段；a > b 時繞回起點
function subContour(c, a, b) {
  const p = c.closed ? [...c.pts, c.pts[0]] : c.pts;
  const L = contourLength(c);
  if (L <= 0) return [];
  const pick = (s, e) => {
    const out = []; let acc = 0;
    const S = s * L, E = e * L;
    for (let i = 1; i < p.length; i++) {
      const d = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      const s0 = acc, s1 = acc + d;
      if (s1 >= S && s0 <= E && d > 0) {
        const f0 = Math.max(0, (S - s0) / d), f1 = Math.min(1, (E - s0) / d);
        const P0 = [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f0, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f0];
        const P1 = [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f1, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f1];
        if (!out.length) out.push(P0);
        out.push(P1);
      }
      acc = s1;
    }
    return out;
  };
  if (a <= b) return [{ pts: pick(a, b), closed: false }];
  return [{ pts: pick(a, 1), closed: false }, { pts: pick(0, b), closed: false }];
}

function zigzag(c, size, ridges, smooth) {
  const L = contourLength(c);
  if (L <= 0 || ridges < 1) return c;
  const p = c.closed ? [...c.pts, c.pts[0]] : c.pts;
  const segs = p.length - 1, per = Math.max(1, Math.round(ridges)) * 2;
  const out = [];
  for (let i = 0; i < segs; i++) {
    const a = p[i], b = p[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
    const n = per;   // 每一段的鋸齒數（和 After Effects 的「每段脊數」相同）
    for (let k = 0; k < n; k++) { const f = k / n, s = (k % 2 ? 1 : -1) * size; out.push([a[0] + dx * f + nx * s, a[1] + dy * f + ny * s]); }
  }
  if (!c.closed) out.push(p[p.length - 1]);
  return { pts: out, closed: c.closed, smooth };
}

function wiggleC(c, size, detail, t, seed) {
  const out = [], p = c.pts, n = p.length;
  const dense = [];
  // 先加密頂點，讓擺動看得出來
  const k = Math.max(1, Math.round(detail));
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    if (!c.closed && i === n - 1) { dense.push(a); break; }
    for (let j = 0; j < k; j++) dense.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
  }
  dense.forEach((q, i) => out.push([q[0] + noise1(t + i * .37, seed) * size, q[1] + noise1(t + i * .37 + 50, seed + 3) * size]));
  return { pts: out, closed: c.closed };
}

const xform = (pts, pos, rot, scl) => {
  const c = Math.cos(rot), s = Math.sin(rot), sx = scl[0] / 100, sy = scl[1] / 100;
  return pts.map(([x, y]) => { x *= sx; y *= sy; return [x * c - y * s + pos[0], x * s + y * c + pos[1]]; });
};

// 一個形狀項目 → 已求值的繪製資料
export function evalShapeItem(it, ev, t) {
  const pos = ev(it.pos), rot = ev(it.rot) * Math.PI / 180, scl = ev(it.scl);
  let contours;
  switch (it.kind) {
    case 'rect': { const [w, h] = ev(it.size); contours = [{ pts: rectContour(w, h, ev(it.round)), closed: true }]; break; }
    case 'ellipse': { const [w, h] = ev(it.size); contours = [{ pts: ellipseContour(w, h), closed: true }]; break; }
    case 'star': contours = [{ pts: starContour(ev(it.points), ev(it.outerR), ev(it.innerR), true), closed: true }]; break;
    case 'polygon': contours = [{ pts: starContour(ev(it.points), ev(it.outerR), 0, false), closed: true }]; break;
    case 'path': contours = [flattenPath(ev(it.path))]; break;
    default: contours = [];
  }
  if (it.zigzag?.on) contours = contours.map(c => zigzag(c, ev(it.zigzag.size), ev(it.zigzag.ridges), it.zigzag.smooth));
  if (it.wiggle?.on) contours = contours.map((c, i) => wiggleC(c, ev(it.wiggle.size), ev(it.wiggle.detail), t * ev(it.wiggle.speed), i + 7));
  contours = contours.map(c => ({ pts: xform(c.pts, pos, rot, scl), closed: c.closed }));
  let strokeContours = contours;
  if (it.trim?.on) {
    let s = ev(it.trim.start) / 100, e = ev(it.trim.end) / 100;
    if (s > e) [s, e] = [e, s];
    const off = (ev(it.trim.offset) / 360) % 1;
    if (e - s >= 0.9999) strokeContours = contours;
    else if (e - s <= 0.0001) strokeContours = [];
    else {
      let a = (s + off) % 1, b = (e + off) % 1; if (a < 0) a += 1; if (b < 0) b += 1;
      if (Math.abs(b) < 1e-6 && e + off > 0) b = 1;
      strokeContours = contours.flatMap(c => subContour(c, a, b));
    }
  }
  const f = it.fill, st = it.stroke;
  return {
    contours, strokeContours, trimmed: !!it.trim?.on,
    fill: f?.on ? { type: f.type, color: ev(f.color), color2: ev(f.color2), opacity: ev(f.opacity) / 100, g0: ev(f.gStart), g1: ev(f.gEnd) } : null,
    stroke: st?.on ? { color: ev(st.color), width: ev(st.width), opacity: ev(st.opacity) / 100, cap: st.cap, join: st.join, dash: ev(st.dash), gap: ev(st.gap) } : null,
    rep: it.repeater?.on ? { n: Math.max(1, Math.round(ev(it.repeater.copies))), off: ev(it.repeater.offset), rot: ev(it.repeater.rot), scl: ev(it.repeater.scale), op0: ev(it.repeater.startOp) / 100, op1: ev(it.repeater.endOp) / 100 } : null,
  };
}

function tracePoly(ctx, cs) {
  for (const c of cs) {
    if (!c.pts.length) continue;
    ctx.moveTo(c.pts[0][0], c.pts[0][1]);
    for (let i = 1; i < c.pts.length; i++) ctx.lineTo(c.pts[i][0], c.pts[i][1]);
    if (c.closed) ctx.closePath();
  }
}

function paint(ctx, fill) {
  if (fill.type === 'solid') return css(fill.color);
  const [x0, y0] = fill.g0, [x1, y1] = fill.g1;
  const g = fill.type === 'radial' ? ctx.createRadialGradient(x0, y0, 0, x0, y0, Math.hypot(x1 - x0, y1 - y0) || 1) : ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, css(fill.color)); g.addColorStop(1, css(fill.color2));
  return g;
}

export function drawShapeData(ctx, d) {
  const copies = d.rep ? d.rep.n : 1;
  for (let i = copies - 1; i >= 0; i--) {
    ctx.save();
    if (d.rep) {
      const k = copies > 1 ? i / (copies - 1) : 0;
      ctx.translate(d.rep.off[0] * i, d.rep.off[1] * i);
      ctx.rotate(d.rep.rot * i * Math.PI / 180);
      ctx.scale(Math.pow(d.rep.scl[0] / 100, i), Math.pow(d.rep.scl[1] / 100, i));
      ctx.globalAlpha *= d.rep.op0 + (d.rep.op1 - d.rep.op0) * k;
    }
    if (d.fill && d.fill.opacity > 0) {
      ctx.beginPath(); tracePoly(ctx, d.trimmed ? d.strokeContours.map(c => ({ ...c, closed: true })) : d.contours);
      ctx.save(); ctx.globalAlpha *= d.fill.opacity; ctx.fillStyle = paint(ctx, d.fill); ctx.fill('nonzero'); ctx.restore();
    }
    if (d.stroke && d.stroke.width > 0 && d.stroke.opacity > 0) {
      ctx.beginPath(); tracePoly(ctx, d.strokeContours);
      ctx.save(); ctx.globalAlpha *= d.stroke.opacity; ctx.strokeStyle = css(d.stroke.color); ctx.lineWidth = d.stroke.width;
      ctx.lineCap = d.stroke.cap || 'round'; ctx.lineJoin = d.stroke.join || 'round';
      ctx.setLineDash(d.stroke.dash > 0 ? [d.stroke.dash, d.stroke.gap > 0 ? d.stroke.gap : d.stroke.dash] : []);
      ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }
}

// 範圍（layer 座標），含筆畫寬度與重複器
export function shapeBounds(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of list) {
    const pad = d.stroke ? d.stroke.width / 2 + 2 : 2;
    const copies = d.rep ? d.rep.n : 1;
    for (let i = 0; i < copies; i++) {
      let m = null;
      if (d.rep) { const a = d.rep.rot * i * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), sx = Math.pow(d.rep.scl[0] / 100, i), sy = Math.pow(d.rep.scl[1] / 100, i); m = [c * sx, s * sx, -s * sy, c * sy, d.rep.off[0] * i, d.rep.off[1] * i]; }
      for (const c of d.contours) for (let [x, y] of c.pts) {
        if (m) [x, y] = [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
        if (x - pad < x0) x0 = x - pad; if (y - pad < y0) y0 = y - pad; if (x + pad > x1) x1 = x + pad; if (y + pad > y1) y1 = y + pad;
      }
    }
  }
  if (!isFinite(x0)) return [0, 0, 0, 0];
  return [x0, y0, x1 - x0, y1 - y0];
}
