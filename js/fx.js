// 小柯機器人動態圖形和視覺特效工具 — 效果處理器（WebGL2）與效果登錄表
// 所有效果在 GPU 上以乒乓 framebuffer 串接；紋理一律為「預乘 alpha」，座標空間 y 向下（與畫布像素一致）。

export const FX_CATEGORIES = ['blur', 'color', 'distort', 'generate', 'stylize', 'style', 'transition', 'noise', 'time', 'keying', 'perspective', 'utility'];
export const EFFECTS = [];
// 除錯用：測試頁可開啟 enabled 以檢查 GL 錯誤；errors 收集編譯錯誤與例外
export const fxDebug = { enabled: false, errors: [] };

const IMPL = new Map();
const BY_ID = new Map();
const rad = (d) => d * Math.PI / 180;

// ───────── 參數建構小工具 ─────────
const num = (id, def, min, max, step = 1, o) => ({ id, type: 'number', def, min, max, step, ...o });
const px = (id, def, min, max, step = 0.1) => num(id, def, min, max, step, { px: true });
const pct = (id, def, min = 0, max = 100) => ({ id, type: 'percent', def, min, max, step: 0.1 });
const ang = (id, def) => ({ id, type: 'angle', def });
const col = (id, def) => ({ id, type: 'color', def: def.length === 3 ? [...def, 1] : def });
const pt = (id, def = [0.5, 0.5]) => ({ id, type: 'point', def });
const bool = (id, def) => ({ id, type: 'bool', def });
const sel = (id, def, options) => ({ id, type: 'select', def, options });

// 登錄效果：impl 可為 GLSL 字串（單一 pass）或 { glsl, shaders, run, uni }
function E(id, cat, params, impl, flags = {}) {
  const def = { id, cat, params, generator: !!flags.gen, animatedByTime: !!flags.anim };
  EFFECTS.push(def);
  BY_ID.set(id, def);
  IMPL.set(id, typeof impl === 'string' ? { glsl: impl } : impl);
}

// ───────── GLSL 共用片段 ─────────
const H_VER = '#version 300 es\nprecision highp float;precision highp int;precision highp sampler2D;\n';
const H_UNI = 'uniform sampler2D uTex,uB,uC,uD;uniform vec2 uSize,uTexel;uniform float uTime,uSeed,uScale;\n';
const H_FRAG = 'in vec2 vUv;out vec4 outColor;vec2 P(){return vUv*uSize;}\n';
const H_FUN = `
#define PI 3.141592653589793
#define TAU 6.283185307179586
float ins(vec2 uv){vec2 s=step(vec2(0.),uv)*step(uv,vec2(1.));return s.x*s.y;}
vec4 T(vec2 uv){return texture(uTex,uv)*ins(uv);}
vec4 TP(vec2 p){return T(p/uSize);}
vec4 TB(vec2 uv){return texture(uB,uv)*ins(uv);}
vec4 unp(vec4 c){return c.a>1e-5?vec4(clamp(c.rgb/c.a,0.,1.),c.a):vec4(0.);}
vec4 pre(vec4 c){return vec4(c.rgb*c.a,c.a);}
vec4 over(vec4 t,vec4 b){return t+b*(1.-t.a);}
vec4 addL(vec4 s,vec3 l){vec3 c=s.rgb+max(l,0.);float a=clamp(max(s.a,max(c.r,max(c.g,c.b))),0.,1.);return vec4(min(c,vec3(a)),a);}
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
vec2 dirv(float d){float a=radians(d);return vec2(sin(a),-cos(a));}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}
uint uh(uint x){x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return x;}
float hu(uint x){return float(uh(x)>>8u)*(1./16777216.);}
uint sd(){return uh(uint(uSeed)+0x9e3779b9u);}
float h1(float n){return hu(uint(int(floor(n))+1048576)*0x27d4eb2du^sd());}
float h2(vec2 p){ivec2 i=ivec2(floor(p))+1048576;return hu(uh(uint(i.x)*0x8da6b343u)^(uint(i.y)*0xd8163841u)^sd());}
float h3(vec3 p){ivec3 i=ivec3(floor(p))+1048576;return hu(uh(uh(uint(i.x)*0x8da6b343u)^(uint(i.y)*0xd8163841u))^(uint(i.z)*0xcb1ab31fu)^sd());}
float vn2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
float vn3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*f*(f*(f*6.-15.)+10.);
 float a=h3(i),b=h3(i+vec3(1,0,0)),c=h3(i+vec3(0,1,0)),d=h3(i+vec3(1,1,0)),e=h3(i+vec3(0,0,1)),g=h3(i+vec3(1,0,1)),k=h3(i+vec3(0,1,1)),l=h3(i+vec3(1,1,1));
 return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(k,l,f.x),f.y),f.z);}
float fbm(vec3 p,float oct,bool turb){float s=0.,a=.5,n=0.;for(int i=0;i<20;i++){float fi=float(i);if(fi>=oct)break;float w=a*min(oct-fi,1.);float v=vn3(p);if(turb)v=abs(v*2.-1.);s+=v*w;n+=w;p=vec3(rot(.62)*p.xy*2.03,p.z*1.7)+vec3(17.1,31.7,7.3);a*=.5;}return s/max(n,1e-4);}
vec3 rgb2hsl(vec3 c){float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b)),l=(mx+mn)*.5,d=mx-mn,h=0.,s=0.;if(d>1e-5){s=l>.5?d/(2.-mx-mn):d/(mx+mn);if(mx==c.r)h=(c.g-c.b)/d+(c.g<c.b?6.:0.);else if(mx==c.g)h=(c.b-c.r)/d+2.;else h=(c.r-c.g)/d+4.;h/=6.;}return vec3(h,s,l);}
vec3 hsl2rgb(vec3 h){vec3 k=clamp(abs(mod(h.x*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.);return h.z+h.y*(k-.5)*(1.-abs(2.*h.z-1.));}
vec2 cbcr(vec3 c){return vec2(dot(c,vec3(-.1687,-.3313,.5)),dot(c,vec3(.5,-.4187,-.0813)));}
`;
const VS_FULL = H_VER + 'out vec2 vUv;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}';

// 內部共用 shader
const INT = {
  copy: 'vec4 fx(){return texture(uTex,vUv);}',
  final: 'vec4 fx(){vec4 c=texture(uTex,vec2(vUv.x,1.-vUv.y));c.a=clamp(c.a,0.,1.);c.rgb=clamp(c.rgb,0.,c.a);return c;}',
  blur: `uniform vec2 uDir;uniform float uSigma,uEdge;
vec4 S(vec2 uv){return uEdge>.5?texture(uTex,uv):T(uv);}
vec4 fx(){float sg=max(uSigma,.01);int n=int(ceil(sg*3.));vec4 s=S(vUv);float ws=1.;for(int i=1;i<=64;i+=2){if(i>n)break;float w1=exp(-.5*float(i*i)/(sg*sg)),w2=exp(-.5*float((i+1)*(i+1))/(sg*sg));float w=w1+w2;float o=float(i)+w2/w;s+=w*(S(vUv+uDir*o)+S(vUv-uDir*o));ws+=2.*w;}return s/ws;}`,
  dirblur: `uniform vec2 uStep;uniform int uK;
vec4 fx(){vec4 s=vec4(0.);float h=(float(uK)-1.)*.5;for(int i=0;i<64;i++){if(i>=uK)break;s+=T(vUv+uStep*(float(i)-h));}return s/float(uK);}`,
  radblur: `uniform vec2 uCen;uniform int uMode,uK;uniform float uStep,uOff;
vec4 fx(){vec2 p=P(),d=p-uCen;vec4 s=vec4(0.);for(int i=0;i<32;i++){if(i>=uK)break;float t=uOff+uStep*float(i);vec2 q=uMode==0?uCen+rot(t)*d:uCen+d*exp(t);s+=TP(q);}return s/float(uK);}`,
  keyapply: `uniform float uThin,uSoft,uMode;
vec4 fx(){vec4 s=texture(uTex,vUv);float m=texture(uB,vUv).r;if(uMode>.5){float c=.5+uThin*.08;m=smoothstep(c-uSoft,c+uSoft,m);}return s*clamp(m,0.,1.);}`,
  jfaSeed: `uniform float uInv,uEnc;
vec4 fx(){float a=texture(uTex,vUv).a;bool sd=uInv>.5?a<.5:a>=.5;return sd?vec4(uEnc>.5?vec2(.5):vec2(0.),1.,1.):vec4(0.);}`,
  jfaStep: `uniform float uStep,uEnc;
vec4 fx(){ivec2 ip=ivec2(gl_FragCoord.xy);ivec2 sz=textureSize(uTex,0);float best=1e9;vec2 bo=vec2(0.);bool f=false;int st=int(uStep);
for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){ivec2 q=ip+ivec2(i,j)*st;if(any(lessThan(q,ivec2(0)))||any(greaterThanEqual(q,sz)))continue;vec4 v=texelFetch(uTex,q,0);if(v.z<.5)continue;vec2 o=(uEnc>.5?(v.xy-.5)*254.:v.xy)+vec2(q-ip);float d=dot(o,o);if(d<best){best=d;bo=o;f=true;}}
if(!f)return vec4(0.);if(uEnc>.5){if(any(greaterThan(abs(bo),vec2(126.))))return vec4(0.);bo=bo/254.+.5;}return vec4(bo,1.,1.);}`,
};

// ───────── WebGL 狀態 ─────────
let gl = null, cv = null, lost = false, half = false, vao = null, dummy = null, maxPt = 64;
let progs = new Map(), pool = [], frame = 0, srcT = null;
let W = 0, H = 0, INFO = { time: 0, seed: 0, scale: 1 };
let CUR = null, CP = null, temps = [];

function setup() {
  progs = new Map(); pool = []; srcT = null;
  half = false;
  if (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) {
    // 測試 RGBA16F 是否可作為 render target
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    half = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f); gl.deleteTexture(t);
  }
  vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  dummy = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, dummy);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE); maxPt = r ? r[1] : 64;
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
}

function init() {
  if (lost) return false;
  if (gl) return !gl.isContextLost();
  const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true };
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      try { cv = new OffscreenCanvas(16, 16); gl = cv.getContext('webgl2', opts); } catch (e) { gl = null; }
    }
    if (!gl && typeof document !== 'undefined') {
      cv = document.createElement('canvas'); cv.width = cv.height = 16; gl = cv.getContext('webgl2', opts);
    }
    if (!gl) { cv = null; return false; }
    if (cv.addEventListener) {
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
      cv.addEventListener('webglcontextrestored', () => { lost = false; try { setup(); } catch (e) { lost = true; } });
    }
    setup();
    return true;
  } catch (e) { gl = null; cv = null; return false; }
}

export function fxAvailable() { return init(); }
export function getEffect(id) { return BY_ID.get(id); }
export function defaultParams(id) {
  const d = BY_ID.get(id); const o = {};
  if (d) for (const p of d.params) o[p.id] = Array.isArray(p.def) ? p.def.slice() : p.def;
  return o;
}

// ───────── 程式編譯與快取 ─────────
function glType(p) {
  return p.type === 'color' ? 'vec4' : p.type === 'point' ? 'vec2' : p.type === 'select' ? 'int' : 'float';
}
function paramDecl(def) { return def ? def.params.map((p) => `uniform ${glType(p)} u_${p.id};`).join('') + '\n' : ''; }
function sh(type, src, key) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s); gl.deleteShader(s);
    const err = new Error(key + ' 編譯失敗: ' + log); err.src = src; throw err;
  }
  return s;
}
function link(key, vs, fs) {
  const p = gl.createProgram();
  const a = sh(gl.VERTEX_SHADER, vs, key), b = sh(gl.FRAGMENT_SHADER, fs, key);
  gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p);
  gl.deleteShader(a); gl.deleteShader(b);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(key + ' 連結失敗: ' + gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
  gl.useProgram(p);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, '');
    u[name] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
  }
  ['uTex', 'uB', 'uC', 'uD'].forEach((s, i) => { if (u[s]) gl.uniform1i(u[s].loc, i); });
  return { p, u };
}
function getProg(key, build) {
  let pr = progs.get(key);
  if (pr) { if (pr.err) throw pr.err; return pr; }
  try { pr = build(); } catch (e) { progs.set(key, { err: e }); throw e; }
  progs.set(key, pr); return pr;
}
const fragSrc = (def, body) => H_VER + H_UNI + paramDecl(def) + H_FRAG + H_FUN + body + '\nvoid main(){outColor=fx();}';
const intProg = (k) => getProg('int:' + k, () => link('int:' + k, VS_FULL, fragSrc(null, INT[k])));
function fxProg(name) {
  const { def, impl } = CUR; const key = def.id + '.' + name;
  return getProg(key, () => link(key, VS_FULL, fragSrc(def, name === 'main' ? impl.glsl : impl.shaders[name])));
}

// 依 uniform 實際型別設定值
function su(u, v) {
  if (!u || v === undefined || v === null) return;
  switch (u.type) {
    case gl.FLOAT: if (u.size > 1) gl.uniform1fv(u.loc, v); else gl.uniform1f(u.loc, +v || 0); break;
    case gl.FLOAT_VEC2: gl.uniform2f(u.loc, +v[0] || 0, +v[1] || 0); break;
    case gl.FLOAT_VEC3: gl.uniform3f(u.loc, +v[0] || 0, +v[1] || 0, +v[2] || 0); break;
    case gl.FLOAT_VEC4: gl.uniform4f(u.loc, +v[0] || 0, +v[1] || 0, +v[2] || 0, v[3] === undefined ? 1 : +v[3]); break;
    case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, v | 0); break;
    case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
    default: break;
  }
}
function toU(p, v) {
  switch (p.type) {
    case 'bool': return v ? 1 : 0;
    case 'select': return Math.max(0, p.options.indexOf(v));
    case 'color': return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
    case 'point': return [v[0], v[1]];
    default: return Number(v) || 0;
  }
}

// ───────── render target 池 ─────────
function mkT(w, h) {
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo, w, h, busy: false, last: frame };
}
function acquire(w, h) {
  w = Math.max(1, w | 0); h = Math.max(1, h | 0);
  let t = pool.find((x) => !x.busy && x.w === w && x.h === h);
  if (!t) { t = mkT(w, h); pool.push(t); }
  t.busy = true; t.last = frame; return t;
}
function release(t) { if (t && t.fbo) t.busy = false; }
function gc() {
  pool = pool.filter((t) => {
    if (!t.busy && frame - t.last > 90) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); return false; }
    return true;
  });
}

// 繪製一個 pass
function drawProg(pr, out, texs, extra, def, P, opt) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
  gl.viewport(0, 0, out ? out.w : W, out ? out.h : H);
  gl.useProgram(pr.p);
  const names = ['uTex', 'uB', 'uC', 'uD'];
  for (let i = 0; i < 4; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    const t = texs && texs[names[i]]; gl.bindTexture(gl.TEXTURE_2D, t ? t.tex : dummy);
  }
  const u = pr.u, t0 = texs && texs.uTex;
  su(u.uSize, [W, H]); su(u.uTexel, t0 ? [1 / t0.w, 1 / t0.h] : [1 / W, 1 / H]);
  su(u.uTime, INFO.time); su(u.uSeed, INFO.seed); su(u.uScale, INFO.scale);
  if (def) for (const p of def.params) { const uu = u['u_' + p.id]; if (uu) su(uu, toU(p, P[p.id])); }
  if (extra) for (const k in extra) if (u[k]) su(u[k], extra[k]);
  if (opt && opt.blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, opt.blend === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); }
  gl.drawArrays(opt && opt.mode !== undefined ? opt.mode : gl.TRIANGLES, 0, opt && opt.count ? opt.count : 3);
  if (opt && opt.blend) gl.disable(gl.BLEND);
}

// ───────── 效果執行環境（提供給各效果 run） ─────────
const X = {
  get W() { return W; }, get H() { return H; }, get info() { return INFO; }, get half() { return half; },
  tmp(w, h) { const t = acquire(w || W, h || H); temps.push(t); return t; },
  // 執行目前效果的 shader（name 預設 main）
  fx(out, texs, extra, name = 'main') { drawProg(fxProg(name), out, texs, extra, CUR.def, CP); return out; },
  run(k, out, texs, extra) { drawProg(intProg(k), out, texs, extra); return out; },
  copy(t) { return X.run('copy', X.tmp(), { uTex: t }); },
  full(t) { return t.w === W && t.h === H ? t : X.copy(t); },
  // 縮小 f 倍（逐次減半）
  down(t, f) {
    let c = t;
    while (f > 1.01 && c.w > 2 && c.h > 2) { c = X.run('copy', X.tmp(Math.ceil(c.w / 2), Math.ceil(c.h / 2)), { uTex: c }); f /= 2; }
    return c;
  },
  // 可分離高斯模糊（sigma 以全解析度像素為單位）；大半徑時先降採樣。回傳可能為低解析度 target
  blur(t, sx, sy, edge = false) {
    sx = Math.max(0, +sx || 0); sy = Math.max(0, +sy || 0);
    if (sx < 0.3 && sy < 0.3) return t;
    let c = t, cw = t.w, ch = t.h, ax = sx * cw / W, ay = sy * ch / H;
    while ((ax > 5 && cw > 4) || (ay > 5 && ch > 4)) {
      const hx = ax > 5 && cw > 4, hy = ay > 5 && ch > 4;
      const nw = hx ? Math.ceil(cw / 2) : cw, nh = hy ? Math.ceil(ch / 2) : ch;
      c = X.run('copy', X.tmp(nw, nh), { uTex: c }); cw = nw; ch = nh;
      if (hx) ax /= 2; if (hy) ay /= 2;
    }
    if (ax >= 0.3) c = X.run('blur', X.tmp(cw, ch), { uTex: c }, { uDir: [1 / cw, 0], uSigma: ax, uEdge: edge ? 1 : 0 });
    if (ay >= 0.3) c = X.run('blur', X.tmp(cw, ch), { uTex: c }, { uDir: [0, 1 / ch], uSigma: ay, uEdge: edge ? 1 : 0 });
    return c;
  },
  // 沿方向（像素單位向量 dx,dy）的盒狀模糊，長度 L；長時用兩段 K×K 取樣
  boxDir(t, dx, dy, L) {
    if (!(L >= 0.5)) return t;
    const sx = dx / W, sy = dy / H;
    if (L <= 24) {
      const K = Math.max(2, Math.ceil(L) + 1), st = L / (K - 1);
      return X.run('dirblur', X.tmp(), { uTex: t }, { uStep: [sx * st, sy * st], uK: K });
    }
    const K = Math.min(32, Math.ceil(Math.sqrt(L)) + 1), s1 = L / (K * K - 1);
    const a = X.run('dirblur', X.tmp(), { uTex: t }, { uStep: [sx * s1, sy * s1], uK: K });
    return X.run('dirblur', X.tmp(), { uTex: a }, { uStep: [sx * s1 * K, sy * s1 * K], uK: K });
  },
  // 放射模糊兩段式（mode 0 旋轉 / 1 縮放），t 範圍 [lo, lo+span]
  radial(t, c, mode, span, lo) {
    const K = 16, s1 = span / (K * K - 1);
    const a = X.run('radblur', X.tmp(), { uTex: t }, { uCen: c, uMode: mode, uStep: s1, uOff: lo, uK: K });
    return X.run('radblur', X.tmp(), { uTex: a }, { uCen: c, uMode: mode, uStep: s1 * K, uOff: 0, uK: K });
  },
  // Jump Flooding 距離場：inv=false 種子為 alpha≥0.5 的像素
  jfa(t, inv, maxD) {
    const enc = half ? 0 : 1;
    let a = X.run('jfaSeed', X.tmp(), { uTex: t }, { uInv: inv ? 1 : 0, uEnc: enc }), b = X.tmp();
    let s = 1; while (s < maxD) s *= 2;
    const steps = []; for (; s >= 1; s /= 2) steps.push(s); steps.push(1);
    for (const st of steps) { X.run('jfaStep', b, { uTex: a }, { uStep: st, uEnc: enc }); const k = a; a = b; b = k; }
    return a;
  },
  // 套用遮罩（含邊緣收縮/羽化）
  keyApply(inp, matte, thin, feather) {
    let m = matte, mode = 0;
    if (Math.abs(thin) > 0.01 || feather > 0.01) { const s = Math.max(feather * 0.5, Math.abs(thin) * 0.7, 0.5); m = X.blur(matte, s, s); mode = 1; }
    return X.run('keyapply', X.tmp(), { uTex: inp, uB: m }, { uThin: thin, uSoft: feather > 0.01 ? 0.5 : 0.08, uMode: mode });
  },
};
const single = (impl, inp) => X.fx(X.tmp(), { uTex: inp }, impl.uni ? impl.uni(CP) : null);

function resolve(def, params) {
  const P = {};
  for (const p of def.params) {
    let v = params ? params[p.id] : undefined;
    if (v === undefined || v === null || (typeof v === 'number' && !isFinite(v))) v = p.type === 'point' ? [p.def[0] * W, p.def[1] * H] : p.def;
    if (p.px && typeof v === 'number') v *= INFO.scale;
    P[p.id] = v;
  }
  return P;
}
function pushErr(id, e) {
  const msg = String((e && e.message) || e);
  if (fxDebug.errors.length < 300) fxDebug.errors.push({ id, error: msg });
  if (!pushErr.seen.has(id)) { pushErr.seen.add(id); console.warn('[fx] ' + id + ': ' + msg); }
}
pushErr.seen = new Set();

function upload(source) {
  if (!srcT) srcT = { tex: gl.createTexture(), w: 0, h: 0 };
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcT.tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  if (srcT.w === W && srcT.h === H) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    srcT.w = W; srcT.h = H;
  }
}

export function applyEffects(source, list, info) {
  if (!source || !list || !list.length) return source;
  if (!init() || gl.isContextLost()) return source;
  const w = source.width | 0, h = source.height | 0;
  if (!w || !h) return source;
  info = info || {};
  W = w; H = h; frame++;
  INFO = { time: +info.time || 0, seed: Math.abs(info.seed | 0) % 1000003, scale: info.scale > 0 ? +info.scale : 1, fps: info.fps || 30, compTime: +info.compTime || 0 };
  try { upload(source); } catch (e) { pushErr('upload', e); return source; }
  let cur = srcT;
  for (const it of list) {
    const def = it && BY_ID.get(it.id); if (!def) continue;
    temps = [];
    try {
      CUR = { def, impl: IMPL.get(def.id) }; CP = resolve(def, it.params);
      const out = CUR.impl.run ? CUR.impl.run(X, CP, cur) : single(CUR.impl, cur);
      if (fxDebug.enabled) { const e = gl.getError(); if (e) throw new Error('GL error 0x' + e.toString(16)); }
      for (const t of temps) if (t !== out) release(t);
      if (out && out !== cur) { if (cur !== srcT) release(cur); cur = out; }
    } catch (e) { for (const t of temps) release(t); pushErr(def.id, e); }
  }
  temps = [];
  try {
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    drawProg(intProg('final'), null, { uTex: cur });
  } catch (e) { pushErr('final', e); if (cur !== srcT) release(cur); return source; }
  if (cur !== srcT) release(cur);
  gc();
  return cv;
}

// ───────── 幾何小工具 ─────────
// 單位正方形 → 四邊形（UL,UR,LR,LL）的投影矩陣（列優先）
function sq2quad(q) {
  const [x0, y0] = q[0], [x1, y1] = q[1], [x2, y2] = q[2], [x3, y3] = q[3];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; g = 0; h = 0; }
  else {
    const den = (dx1 * dy2 - dx2 * dy1) || 1e-9;
    g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return [a, b, c, d, e, f, g, h, 1];
}
// 像素 → 單位座標的反矩陣（轉成 column-major 給 mat3）
function homInv(q) {
  const m = sq2quad(q);
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  let det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) det = 1e-12;
  const r = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
  return [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
}
const keyCh = (c) => (c[1] >= c[0] && c[1] >= c[2] ? 1 : c[2] >= c[0] ? 2 : 0);
const HOM = 'uniform mat3 uH;\n';

// 中值取樣（13 點，以亮度排序取中位）
const MED = `vec4 med(vec2 p,float r){if(r<.5)return TP(p);vec4 s[13];s[0]=TP(p);int k=1;for(int i=0;i<4;i++){float a=float(i)*PI*.5;vec2 d=vec2(cos(a),sin(a));s[k++]=TP(p+d*r*.5);s[k++]=TP(p+d*r);float b=a+PI*.25;s[k++]=TP(p+vec2(cos(b),sin(b))*r*.75);}
float l[13];for(int i=0;i<13;i++)l[i]=luma(s[i].rgb)+s[i].a*.001;vec4 m=s[0];
for(int i=0;i<13;i++){int rk=0;for(int j=0;j<13;j++){if(l[j]<l[i]||(l[j]==l[i]&&j<i))rk++;}if(rk==6)m=s[i];}return m;}
`;

// ═════════ 模糊與銳利化 ═════════
E('gaussianBlur', 'blur', [px('blurriness', 10, 0, 500), sel('dimensions', 'both', ['both', 'horizontal', 'vertical']), bool('repeatEdgePixels', false)], {
  run(X, P, inp) {
    const s = P.blurriness * 0.5, d = P.dimensions;
    return X.full(X.blur(inp, d !== 'vertical' ? s : 0, d !== 'horizontal' ? s : 0, P.repeatEdgePixels));
  },
});
E('directionalBlur', 'blur', [ang('direction', 0), px('blurLength', 20, 0, 1000)], {
  run(X, P, inp) { const a = rad(P.direction); return X.boxDir(inp, Math.sin(a), -Math.cos(a), P.blurLength); },
});
E('radialBlur', 'blur', [num('amount', 10, 0, 100, 0.1), pt('center'), sel('type', 'spin', ['spin', 'zoom'])], {
  run(X, P, inp) {
    const spin = P.type !== 'zoom', span = spin ? rad(P.amount) : P.amount / 100;
    if (span <= 1e-4) return inp;
    return X.radial(inp, P.center, spin ? 0 : 1, span, -span / 2);
  },
});
E('boxBlur', 'blur', [px('blurRadius', 5, 0, 200), num('iterations', 3, 1, 10, 1), sel('dimensions', 'both', ['both', 'horizontal', 'vertical']), bool('repeatEdgePixels', false)], {
  run(X, P, inp) {
    const r = P.blurRadius, it = Math.max(1, Math.round(P.iterations)), d = P.dimensions;
    if (r < 0.1) return inp;
    if (it === 1) {
      let t = inp;
      if (d !== 'vertical') t = X.boxDir(t, 1, 0, 2 * r);
      if (d !== 'horizontal') t = X.boxDir(t, 0, 1, 2 * r);
      return t;
    }
    const s = Math.sqrt(it * ((2 * r + 1) ** 2 - 1) / 12);
    return X.full(X.blur(inp, d !== 'vertical' ? s : 0, d !== 'horizontal' ? s : 0, P.repeatEdgePixels));
  },
});
E('sharpen', 'blur', [num('sharpenAmount', 20, 0, 500, 1)],
  `vec4 fx(){vec2 e=1./uSize;vec4 c=T(vUv);vec4 n=T(vUv+vec2(e.x,0.))+T(vUv-vec2(e.x,0.))+T(vUv+vec2(0.,e.y))+T(vUv-vec2(0.,e.y));vec4 r=c+(c-n*.25)*u_sharpenAmount/25.;r.a=clamp(r.a,0.,1.);r.rgb=clamp(r.rgb,0.,r.a);return r;}`);
E('unsharpMask', 'blur', [num('amount', 80, 0, 500, 1), px('radius', 3, 0, 100), num('threshold', 0, 0, 255, 1)], {
  glsl: `vec4 fx(){vec4 c=T(vUv);vec4 b=texture(uB,vUv);vec3 d=c.rgb-b.rgb;float m=step(u_threshold/255.,abs(luma(d))+1e-6);vec4 r=vec4(c.rgb+d*u_amount/100.*m,c.a);r.rgb=clamp(r.rgb,0.,r.a);return r;}`,
  run(X, P, inp) { const b = X.blur(inp, P.radius, P.radius); return X.fx(X.tmp(), { uTex: inp, uB: b }); },
});
E('bilateralBlur', 'blur', [px('radius', 5, 0, 50), pct('threshold', 20)],
  `vec4 fx(){vec2 p=P();vec4 c0=TP(p);vec3 cu=unp(c0).rgb;float R=max(u_radius,.5);float st=R/4.;float sr=max(u_threshold/100.,.01);vec4 s=vec4(0.);float ws=0.;
for(int j=-4;j<=4;j++)for(int i=-4;i<=4;i++){vec2 o=vec2(float(i),float(j))*st;vec4 c=TP(p+o);vec3 d=unp(c).rgb-cu;float w=exp(-dot(o,o)/(.5*R*R)-dot(d,d)/(2.*sr*sr));s+=c*w;ws+=w;}return s/max(ws,1e-5);}`);
E('cameraLensBlur', 'blur', [px('blurRadius', 12, 0, 200), num('irisBlades', 6, 0, 12, 1), ang('irisRotation', 0), pct('highlightThreshold', 80), num('highlightGain', 50, 0, 500, 1)], {
  glsl: `vec4 fx(){vec2 p=P();float R=u_blurRadius;if(R<.5)return T(vUv);vec4 s=vec4(0.);float ws=0.;float n=floor(u_irisBlades);float jit=h2(p)*2.4;float ro=radians(u_irisRotation);
for(int i=0;i<80;i++){float fi=float(i)+.5;float r=sqrt(fi/80.);float a=fi*2.39996323+jit;float rr=r;if(n>=3.){float t=mod(a-ro,TAU/n)-PI/n;rr*=cos(PI/n)/cos(t);}vec2 q=(p+vec2(cos(a),sin(a))*rr*R)/uSize;vec4 c=texture(uB,q)*ins(q);float l=c.a>1e-4?luma(c.rgb/c.a):0.;float w=1.+u_highlightGain/100.*6.*smoothstep(u_highlightThreshold/100.,1.,l);s+=c*w;ws+=w;}return s/ws;}`,
  run(X, P, inp) {
    const R = P.blurRadius; if (R < 0.5) return inp;
    let f = 1; while (R / f > 16 && f < 8) f *= 2;
    return X.fx(X.tmp(), { uTex: inp, uB: f > 1 ? X.down(inp, f) : inp });
  },
});
E('channelBlur', 'blur', [px('redBlurriness', 10, 0, 500), px('greenBlurriness', 0, 0, 500), px('blueBlurriness', 20, 0, 500), px('alphaBlurriness', 0, 0, 500), bool('repeatEdgePixels', false)], {
  glsl: `vec4 fx(){vec4 r=texture(uTex,vUv),g=texture(uB,vUv),b=texture(uC,vUv),a=texture(uD,vUv);vec4 o=vec4(r.r,g.g,b.b,a.a);o.a=max(o.a,max(o.r,max(o.g,o.b)));return o;}`,
  run(X, P, inp) {
    const m = new Map();
    const g = (s) => { if (s < 0.3) return inp; if (!m.has(s)) m.set(s, X.full(X.blur(inp, s * 0.5, s * 0.5, P.repeatEdgePixels))); return m.get(s); };
    return X.fx(X.tmp(), { uTex: g(P.redBlurriness), uB: g(P.greenBlurriness), uC: g(P.blueBlurriness), uD: g(P.alphaBlurriness) });
  },
});

// ═════════ 色彩校正 ═════════
E('brightnessContrast', 'color', [num('brightness', 20, -150, 150, 1), num('contrast', 20, -100, 100, 1)],
  `vec4 fx(){vec4 c=unp(T(vUv));float k=u_contrast>=0.?1./max(1.-u_contrast/100.,.01):1.+u_contrast/100.;vec3 r=(c.rgb+u_brightness/255.-.5)*k+.5;return pre(vec4(clamp(r,0.,1.),c.a));}`);
E('hueSaturation', 'color', [ang('masterHue', 30), num('masterSaturation', 20, -100, 100, 1), num('masterLightness', 0, -100, 100, 1), bool('colorize', false), ang('colorizeHue', 0), num('colorizeSaturation', 25, 0, 100, 1), num('colorizeLightness', 0, -100, 100, 1)],
  `vec4 fx(){vec4 c=unp(T(vUv));vec3 h=rgb2hsl(c.rgb);float L=u_masterLightness/100.;
if(u_colorize>.5){h=vec3(fract(u_colorizeHue/360.),u_colorizeSaturation/100.,h.z);L=u_colorizeLightness/100.;}
else{h.x=fract(h.x+u_masterHue/360.);h.y=clamp(h.y*(1.+u_masterSaturation/100.),0.,1.);}
vec3 r=hsl2rgb(h);r=L>0.?mix(r,vec3(1.),L):r*(1.+L);return pre(vec4(clamp(r,0.,1.),c.a));}`);
E('levels', 'color', [num('inputBlack', 20, 0, 255, 1), num('inputWhite', 235, 0, 255, 1), num('gamma', 1.2, 0.1, 10, 0.01), num('outputBlack', 0, 0, 255, 1), num('outputWhite', 255, 0, 255, 1)],
  `vec4 fx(){vec4 c=unp(T(vUv));vec3 r=clamp((c.rgb-u_inputBlack/255.)/max((u_inputWhite-u_inputBlack)/255.,1e-3),0.,1.);r=pow(r,vec3(1./max(u_gamma,.01)));r=mix(vec3(u_outputBlack),vec3(u_outputWhite),r)/255.;return pre(vec4(clamp(r,0.,1.),c.a));}`);
E('curves', 'color', [sel('channel', 'master', ['master', 'red', 'green', 'blue']), num('shadows', -15, -100, 100, 1), num('midtones', 0, -100, 100, 1), num('highlights', 15, -100, 100, 1)],
  `float crv(float x){float y1=.25+u_shadows/400.,y2=.5+u_midtones/400.,y3=.75+u_highlights/400.;float k[7]=float[7](-y1,0.,y1,y2,y3,1.,2.-y3);x=clamp(x,0.,1.);float x4=min(x*4.,3.9999);int i=int(x4);float t=x4-float(i);float p0=k[i],p1=k[i+1],p2=k[i+2],p3=k[i+3];
return clamp(.5*((2.*p1)+(-p0+p2)*t+(2.*p0-5.*p1+4.*p2-p3)*t*t+(-p0+3.*p1-3.*p2+p3)*t*t*t),0.,1.);}
vec4 fx(){vec4 c=unp(T(vUv));vec3 r=c.rgb;if(u_channel==0)r=vec3(crv(r.r),crv(r.g),crv(r.b));else if(u_channel==1)r.r=crv(r.r);else if(u_channel==2)r.g=crv(r.g);else r.b=crv(r.b);return pre(vec4(r,c.a));}`);
E('exposure', 'color', [num('exposure', 1, -5, 5, 0.01), num('offset', 0, -1, 1, 0.001), num('gammaCorrection', 1, 0.1, 10, 0.01)],
  `vec4 fx(){vec4 c=unp(T(vUv));vec3 l=pow(c.rgb,vec3(2.2));l=max(l*exp2(u_exposure)+u_offset,0.);l=pow(l,vec3(1./max(u_gammaCorrection,.01)));return pre(vec4(clamp(pow(l,vec3(1./2.2)),0.,1.),c.a));}`);
E('vibrance', 'color', [num('vibrance', 50, -100, 100, 1), num('saturation', 0, -100, 100, 1)],
  `vec4 fx(){vec4 c=unp(T(vUv));vec3 r=c.rgb;float s=max(r.r,max(r.g,r.b))-min(r.r,min(r.g,r.b));float l=luma(r);r=mix(vec3(l),r,1.+u_vibrance/100.*(1.-s));l=luma(r);r=mix(vec3(l),r,1.+u_saturation/100.);return pre(vec4(clamp(r,0.,1.),c.a));}`);
E('tint', 'color', [col('mapBlackTo', [0, 0, 0]), col('mapWhiteTo', [1, 1, 1]), pct('amountToTint', 100)],
  `vec4 fx(){vec4 c=unp(T(vUv));vec3 t=mix(u_mapBlackTo.rgb,u_mapWhiteTo.rgb,luma(c.rgb));return pre(vec4(mix(c.rgb,t,u_amountToTint/100.),c.a));}`);
E('tritone', 'color', [col('highlights', [1, 0.95, 0.8]), col('midtones', [0.62, 0.42, 0.25]), col('shadows', [0.06, 0.05, 0.12]), pct('blendWithOriginal', 0)],
  `vec4 fx(){vec4 c=unp(T(vUv));float l=luma(c.rgb);vec3 t=l<.5?mix(u_shadows.rgb,u_midtones.rgb,l*2.):mix(u_midtones.rgb,u_highlights.rgb,l*2.-1.);return pre(vec4(mix(t,c.rgb,u_blendWithOriginal/100.),c.a));}`);
E('colorBalance', 'color', [num('shadowRed', 0, -100, 100, 1), num('shadowGreen', 0, -100, 100, 1), num('shadowBlue', 30, -100, 100, 1),
  num('midtoneRed', 10, -100, 100, 1), num('midtoneGreen', 0, -100, 100, 1), num('midtoneBlue', 0, -100, 100, 1),
  num('highlightRed', 25, -100, 100, 1), num('highlightGreen', 10, -100, 100, 1), num('highlightBlue', 0, -100, 100, 1), bool('preserveLuminosity', true)],
  `vec4 fx(){vec4 c=unp(T(vUv));float l=luma(c.rgb);float s=1.-smoothstep(0.,.5,l),h=smoothstep(.5,1.,l),m=1.-s-h;
vec3 d=(s*vec3(u_shadowRed,u_shadowGreen,u_shadowBlue)+m*vec3(u_midtoneRed,u_midtoneGreen,u_midtoneBlue)+h*vec3(u_highlightRed,u_highlightGreen,u_highlightBlue))/100.*.35;
vec3 r=clamp(c.rgb+d,0.,1.);if(u_preserveLuminosity>.5)r=clamp(r*(l/max(luma(r),1e-3)),0.,1.);return pre(vec4(r,c.a));}`);
E('blackWhite', 'color', [num('reds', 40, -200, 300, 1), num('yellows', 60, -200, 300, 1), num('greens', 40, -200, 300, 1), num('cyans', 60, -200, 300, 1), num('blues', 20, -200, 300, 1), num('magentas', 80, -200, 300, 1), bool('tint', false), col('tintColor', [0.88, 0.76, 0.58])],
  `vec4 fx(){vec4 c=unp(T(vUv));vec3 v=c.rgb;float mx=max(v.r,max(v.g,v.b)),mn=min(v.r,min(v.g,v.b));float md=v.r+v.g+v.b-mx-mn;float wp,ws;
if(v.r>=v.g&&v.r>=v.b){wp=u_reds;ws=v.g>=v.b?u_yellows:u_magentas;}else if(v.g>=v.b){wp=u_greens;ws=v.r>=v.b?u_yellows:u_cyans;}else{wp=u_blues;ws=v.g>=v.r?u_cyans:u_magentas;}
float g=clamp(mn+(mx-md)*wp/100.+(md-mn)*ws/100.,0.,1.);vec3 r=vec3(g);if(u_tint>.5){vec3 t=rgb2hsl(u_tintColor.rgb);r=hsl2rgb(vec3(t.x,t.y,g));}return pre(vec4(r,c.a));}`);
E('invert', 'color', [sel('channel', 'rgb', ['rgb', 'red', 'green', 'blue', 'alpha']), pct('blendWithOriginal', 0)],
  `vec4 fx(){vec4 c=unp(T(vUv));vec4 r=c;if(u_channel==0)r.rgb=1.-c.rgb;else if(u_channel==1)r.r=1.-c.r;else if(u_channel==2)r.g=1.-c.g;else if(u_channel==3)r.b=1.-c.b;else r.a=1.-c.a;return mix(pre(r),pre(c),u_blendWithOriginal/100.);}`);
E('posterize', 'color', [num('level', 6, 2, 64, 1)],
  `vec4 fx(){vec4 c=unp(T(vUv));float L=max(floor(u_level),2.)-1.;return pre(vec4(floor(c.rgb*L+.5)/L,c.a));}`);
E('threshold', 'color', [num('level', 128, 0, 255, 1)],
  `vec4 fx(){vec4 c=unp(T(vUv));return pre(vec4(vec3(step(u_level/255.,luma(c.rgb))),c.a));}`);
E('photoFilter', 'color', [col('color', [0.93, 0.55, 0.13]), pct('density', 25), bool('preserveLuminosity', true)],
  `vec4 fx(){vec4 c=unp(T(vUv));vec3 r=mix(c.rgb,c.rgb*u_color.rgb,clamp(u_density/100.*1.5,0.,1.));if(u_preserveLuminosity>.5)r*=luma(c.rgb)/max(luma(r),1e-3);return pre(vec4(clamp(r,0.,1.),c.a));}`);
E('changeToColor', 'color', [col('from', [0.85, 0.15, 0.15]), col('to', [0.15, 0.45, 1]), pct('tolerance', 15), pct('softness', 20)],
  `vec4 fx(){vec4 c=unp(T(vUv));vec3 h=rgb2hsl(c.rgb),f=rgb2hsl(u_from.rgb),t=rgb2hsl(u_to.rgb);float dh=abs(h.x-f.x);dh=min(dh,1.-dh);float tol=u_tolerance/100.*.5,sf=u_softness/100.*.5+1e-3;float m=(1.-smoothstep(tol,tol+sf,dh))*smoothstep(.04,.15,h.y);
vec3 n=hsl2rgb(vec3(fract(h.x+t.x-f.x),clamp(h.y*t.y/max(f.y,.05),0.,1.),clamp(h.z+t.z-f.z,0.,1.)));return pre(vec4(mix(c.rgb,n,m),c.a));}`);
E('leaveColor', 'color', [pct('amountToDecolor', 100), col('colorToLeave', [0.85, 0.15, 0.15]), pct('tolerance', 20), pct('edgeSoftness', 15), sel('matchColors', 'usingHue', ['usingRgb', 'usingHue'])],
  `vec4 fx(){vec4 c=unp(T(vUv));float d;if(u_matchColors==1){vec3 a=rgb2hsl(c.rgb);float b=rgb2hsl(u_colorToLeave.rgb).x;d=abs(a.x-b);d=min(d,1.-d)*2.;d=max(d,1.-smoothstep(.05,.2,a.y));}else d=length(c.rgb-u_colorToLeave.rgb)/1.732;
float t=u_tolerance/100.,s=u_edgeSoftness/100.+1e-3;float keep=1.-smoothstep(t,t+s,d);vec3 r=mix(c.rgb,vec3(luma(c.rgb)),u_amountToDecolor/100.*(1.-keep));return pre(vec4(r,c.a));}`);
E('fillColor', 'color', [col('color', [1, 0.35, 0.2]), pct('opacity', 100)],
  `vec4 fx(){vec4 c=T(vUv);return mix(c,vec4(u_color.rgb*c.a,c.a),u_opacity/100.*u_color.a);}`);
E('gradientMap', 'color', [col('shadowColor', [0.12, 0.05, 0.35]), col('highlightColor', [1, 0.82, 0.3]), bool('reverse', false), pct('blendWithOriginal', 0)],
  `vec4 fx(){vec4 c=unp(T(vUv));float l=luma(c.rgb);if(u_reverse>.5)l=1.-l;vec3 g=mix(u_shadowColor.rgb,u_highlightColor.rgb,l);return pre(vec4(mix(g,c.rgb,u_blendWithOriginal/100.),c.a));}`);
E('channelMixer', 'color', [num('redRed', 100, -200, 200, 1), num('redGreen', 0, -200, 200, 1), num('redBlue', 0, -200, 200, 1),
  num('greenRed', 0, -200, 200, 1), num('greenGreen', 100, -200, 200, 1), num('greenBlue', 0, -200, 200, 1),
  num('blueRed', 0, -200, 200, 1), num('blueGreen', 40, -200, 200, 1), num('blueBlue', 60, -200, 200, 1), bool('monochrome', false)],
  `vec4 fx(){vec4 c=unp(T(vUv));vec3 v=c.rgb;vec3 r=vec3(dot(v,vec3(u_redRed,u_redGreen,u_redBlue)),dot(v,vec3(u_greenRed,u_greenGreen,u_greenBlue)),dot(v,vec3(u_blueRed,u_blueGreen,u_blueBlue)))/100.;if(u_monochrome>.5)r=vec3(r.r);return pre(vec4(clamp(r,0.,1.),c.a));}`);
E('colorGrade', 'color', [col('lift', [0.45, 0.48, 0.56]), col('gamma', [0.5, 0.5, 0.5]), col('gain', [0.58, 0.52, 0.44]), num('temperature', 0, -100, 100, 1), num('tint', 0, -100, 100, 1), num('saturation', 110, 0, 200, 1)],
  `vec4 fx(){vec4 c=unp(T(vUv));vec3 r=c.rgb;vec3 lf=u_lift.rgb-.5,gm=1.+(u_gamma.rgb-.5),gn=1.+(u_gain.rgb-.5);
r=(r+lf*(1.-r))*gn;r=pow(max(r,0.),1./max(gm,vec3(.05)));float t=u_temperature/100.,ti=u_tint/100.;r*=vec3(1.+t*.15,1.-ti*.12,1.-t*.15);r=mix(vec3(luma(r)),r,u_saturation/100.);return pre(vec4(clamp(r,0.,1.),c.a));}`);

// ═════════ 扭曲 ═════════
E('transform', 'distort', [pt('anchorPoint'), pt('position'), num('scale', 90, 0, 1000, 0.1), num('skew', 0, -70, 70, 0.1), ang('skewAxis', 0), ang('rotation', 10), pct('opacity', 100)],
  `vec4 fx(){vec2 q=P()-u_position;q=rot(-radians(u_rotation))*q;float sa=radians(u_skewAxis);q=rot(-sa)*q;q.x+=tan(radians(clamp(u_skew,-89.,89.)))*q.y;q=rot(sa)*q;q/=max(u_scale/100.,1e-4);q+=u_anchorPoint;return TP(q)*u_opacity/100.;}`);
E('waveWarp', 'distort', [sel('waveType', 'sine', ['sine', 'square', 'triangle', 'sawtooth']), px('waveHeight', 10, -500, 500), px('waveWidth', 40, 1, 2000), ang('direction', 90), num('waveSpeed', 1, -20, 20, 0.01), ang('phase', 0)],
  `float wv(float x){x=fract(x);if(u_waveType==1)return x<.5?1.:-1.;if(u_waveType==2)return 1.-4.*abs(x-.5);if(u_waveType==3)return 2.*x-1.;return sin(x*TAU);}
vec4 fx(){vec2 p=P();vec2 d=dirv(u_direction);vec2 n=vec2(-d.y,d.x);float ph=dot(p,d)/max(u_waveWidth,1.)-uTime*u_waveSpeed+u_phase/360.;return TP(p+n*u_waveHeight*wv(ph));}`, { anim: true });
E('twirl', 'distort', [ang('angle', 50), pct('twirlRadius', 30), pt('twirlCenter')],
  `vec4 fx(){vec2 d=P()-u_twirlCenter;float R=max(u_twirlRadius/100.*max(uSize.x,uSize.y),1.);float t=clamp(1.-length(d)/R,0.,1.);d=rot(-radians(u_angle)*t*t)*d;return TP(u_twirlCenter+d);}`);
E('bulge', 'distort', [pt('bulgeCenter'), px('horizontalRadius', 100, 0, 4000), px('verticalRadius', 100, 0, 4000), num('bulgeHeight', 1, -4, 4, 0.01)],
  `vec4 fx(){vec2 d=P()-u_bulgeCenter;vec2 e=d/max(vec2(u_horizontalRadius,u_verticalRadius),vec2(1.));float r=length(e);if(r<1.&&r>1e-4){float k=exp(u_bulgeHeight*.4);float s=mix(pow(r,k),r,r*r);d*=s/r;}return TP(u_bulgeCenter+d);}`);
E('ripple', 'distort', [pt('center'), pct('radius', 60), px('waveWidth', 30, 1, 1000), px('waveHeight', 8, -200, 200), num('waveSpeed', 1, -20, 20, 0.01), ang('ripplePhase', 0)],
  `vec4 fx(){vec2 p=P();vec2 d=p-u_center;float r=length(d);float R=max(u_radius/100.*.5*length(uSize),1.);float f=1.-smoothstep(R*.5,R,r);float w=sin(TAU*(r/max(u_waveWidth,1.)-uTime*u_waveSpeed)+radians(u_ripplePhase));vec2 n=r>1e-3?d/r:vec2(0.);return TP(p+n*w*u_waveHeight*f);}`, { anim: true });
E('turbulentDisplace', 'distort', [sel('displacement', 'turbulent', ['turbulent', 'horizontal', 'vertical', 'twist']), px('amount', 50, -1000, 1000), px('size', 100, 2, 1000), num('complexity', 2, 1, 10, 0.1), ang('evolution', 0), bool('animate', false), num('animateSpeed', 1, 0, 20, 0.01)],
  `vec4 fx(){vec2 p=P();float z=u_evolution/360.+(u_animate>.5?uTime*u_animateSpeed*.25:0.);vec3 q=vec3(p/max(u_size,1.),z);float nx=fbm(q,u_complexity,false)-.5,ny=fbm(q+vec3(31.4,17.7,5.3),u_complexity,false)-.5;vec2 o;
if(u_displacement==1)o=vec2(nx,0.);else if(u_displacement==2)o=vec2(0.,ny);else if(u_displacement==3){float a=nx*TAU*2.;o=vec2(cos(a),sin(a))*.3;}else o=vec2(nx,ny);return TP(p+o*1.5*u_amount);}`, { anim: true });
E('offset', 'distort', [pt('shiftCenterTo', [0.75, 0.65]), pct('blendWithOriginal', 0)],
  `vec4 fx(){vec2 q=P()-(u_shiftCenterTo-uSize*.5);return mix(texture(uTex,fract(q/uSize)),T(vUv),u_blendWithOriginal/100.);}`);
E('mirror', 'distort', [pt('reflectionCenter'), ang('reflectionAngle', 0)],
  `vec4 fx(){vec2 p=P();float a=radians(u_reflectionAngle);vec2 n=vec2(cos(a),sin(a));float dd=dot(p-u_reflectionCenter,n);if(dd>0.)p-=2.*dd*n;return TP(p);}`);
E('polarCoordinates', 'distort', [pct('interpolation', 100), sel('typeOfConversion', 'rectToPolar', ['rectToPolar', 'polarToRect'])],
  `vec4 fx(){vec2 uv=vUv;vec2 s;if(u_typeOfConversion==0){vec2 d=(uv-.5)*2.;float a=atan(d.x,-d.y);s=vec2(fract(a/TAU),length(d));}else{float a=uv.x*TAU;s=.5+.5*uv.y*vec2(sin(a),-cos(a));}return T(mix(uv,s,u_interpolation/100.));}`);
E('spherize', 'distort', [px('radius', 120, 0, 4000), pt('center')],
  `vec4 fx(){vec2 d=P()-u_center;float r=length(d)/max(u_radius,1.);if(r<1.&&r>1e-4){float s=asin(r)/(PI*.5);d*=s/r;}return TP(u_center+d);}`);
E('cornerPin', 'distort', [pt('upperLeft', [0.08, 0.12]), pt('upperRight', [0.94, 0.02]), pt('lowerLeft', [0, 1]), pt('lowerRight', [0.88, 0.86])], {
  glsl: HOM + 'vec4 fx(){vec3 q=uH*vec3(P(),1.);if(q.z<=1e-6)return vec4(0.);return T(q.xy/q.z);}',
  uni: (P) => ({ uH: homInv([P.upperLeft, P.upperRight, P.lowerRight, P.lowerLeft]) }),
});
E('magnify', 'distort', [pt('center'), num('magnification', 200, 100, 1000, 1), sel('shape', 'circle', ['circle', 'square']), px('size', 70, 0, 2000), px('feather', 0, 0, 500), pct('opacity', 100)],
  `vec4 fx(){vec2 d=P()-u_center;float dist=u_shape==0?length(d):max(abs(d.x),abs(d.y));float f=u_feather*.5+.5;float m=(1.-smoothstep(u_size-f,u_size+f,dist))*u_opacity/100.;return mix(T(vUv),TP(u_center+d/max(u_magnification/100.,.01)),m);}`);
E('pinchPunch', 'distort', [num('amount', 50, -100, 100, 1), pt('center'), px('radius', 120, 0, 4000)],
  `vec4 fx(){vec2 d=P()-u_center;float r=length(d)/max(u_radius,1.);if(r<1.&&r>1e-4){float k=exp(-u_amount/100.*1.2);float s=mix(pow(r,k),r,r*r);d*=s/r;}return TP(u_center+d);}`);
E('kaleidoscope', 'distort', [pt('center'), num('segments', 6, 2, 32, 1), ang('rotation', 0)],
  `vec4 fx(){vec2 d=P()-u_center;float r=length(d);float ro=radians(u_rotation);float a=atan(d.y,d.x)-ro;float sg=TAU/max(floor(u_segments),1.);a=mod(a,sg);if(a>sg*.5)a=sg-a;return TP(u_center+r*vec2(cos(a+ro),sin(a+ro)));}`);
E('motionTile', 'distort', [pt('tileCenter'), pct('tileWidth', 50, 1, 400), pct('tileHeight', 50, 1, 400), pct('outputWidth', 100, 1, 400), pct('outputHeight', 100, 1, 400), bool('mirrorEdges', false), ang('phase', 0), bool('horizontalPhaseShift', false)],
  `vec4 fx(){vec2 p=P();vec2 ts=max(uSize*vec2(u_tileWidth,u_tileHeight)/100.,vec2(1.));vec2 q=(p-u_tileCenter)/ts+.5;float ph=u_phase/360.;if(u_horizontalPhaseShift>.5)q.y+=mod(floor(q.x),2.)*ph;else q.x+=mod(floor(q.y),2.)*ph;
vec2 f=fract(q);if(u_mirrorEdges>.5){vec2 m=mod(floor(q),2.);f=mix(f,1.-f,m);}vec2 o=abs(p-uSize*.5)/max(uSize*vec2(u_outputWidth,u_outputHeight)/200.,vec2(1.));return texture(uTex,f)*step(max(o.x,o.y),1.);}`);
E('lensDistortion', 'distort', [num('curvature', 30, -100, 100, 1), pt('center'), pct('scale', 100, 10, 400)],
  `vec4 fx(){vec2 d=P()-u_center;float R=.5*length(uSize);float r2=dot(d,d)/(R*R);return TP(u_center+d*(1.+u_curvature/100.*.6*r2)/max(u_scale/100.,.01));}`);

// ═════════ 產生 ═════════
E('fill', 'generate', [col('color', [0.2, 0.5, 1]), pct('opacity', 100)],
  'vec4 fx(){return mix(T(vUv),pre(u_color),u_opacity/100.);}', { gen: true });
E('gradientRamp', 'generate', [pt('startOfRamp', [0.5, 0]), col('startColor', [0.1, 0.15, 0.5]), pt('endOfRamp', [0.5, 1]), col('endColor', [1, 0.6, 0.25]), sel('rampShape', 'linear', ['linear', 'radial']), num('rampScatter', 0, 0, 100, 1), pct('blendWithOriginal', 0)],
  `vec4 fx(){vec2 p=P();vec2 ab=u_endOfRamp-u_startOfRamp;float t=u_rampShape==0?dot(p-u_startOfRamp,ab)/max(dot(ab,ab),1e-4):length(p-u_startOfRamp)/max(length(ab),1e-4);t=clamp(t+(h2(p)-.5)*u_rampScatter/200.,0.,1.);return mix(pre(mix(u_startColor,u_endColor,t)),T(vUv),u_blendWithOriginal/100.);}`, { gen: true });
E('fourColorGradient', 'generate', [pt('point1', [0.1, 0.1]), col('color1', [1, 0.9, 0.1]), pt('point2', [0.9, 0.1]), col('color2', [0.1, 0.85, 0.3]), pt('point3', [0.1, 0.9]), col('color3', [0.95, 0.15, 0.7]), pt('point4', [0.9, 0.9]), col('color4', [0.15, 0.25, 1]), num('blend', 100, 1, 1000, 1), pct('opacity', 100)],
  `vec4 fx(){vec2 p=P();float pw=clamp(200./max(u_blend,1.),.5,10.);vec2 ps[4]=vec2[4](u_point1,u_point2,u_point3,u_point4);vec4 cs[4]=vec4[4](u_color1,u_color2,u_color3,u_color4);vec4 s=vec4(0.);float ws=0.;float md=max(uSize.x,uSize.y);
for(int i=0;i<4;i++){float d=length(p-ps[i])/md+1e-3;float w=1./pow(d,pw);s+=cs[i]*w;ws+=w;}return mix(T(vUv),pre(s/ws),u_opacity/100.);}`, { gen: true });
E('fractalNoise', 'generate', [sel('fractalType', 'basic', ['basic', 'turbulent']), bool('invert', false), num('contrast', 100, 0, 1000, 1), num('brightness', 0, -200, 200, 1), px('scale', 100, 2, 2000, 1), num('complexity', 6, 1, 20, 0.1), ang('evolution', 0), bool('animate', true), num('animateSpeed', 1, 0, 20, 0.01), col('color1', [0, 0, 0]), col('color2', [1, 1, 1]), pct('opacity', 100)],
  `vec4 fx(){vec2 p=P();float z=u_evolution/360.+(u_animate>.5?uTime*u_animateSpeed*.25:0.);bool tb=u_fractalType==1;float n=fbm(vec3(p/max(u_scale,1.),z),u_complexity,tb);if(tb)n=n*1.6-.1;
n=(n-.5)*u_contrast/100.*2.+.5+u_brightness/100.;n=clamp(n,0.,1.);if(u_invert>.5)n=1.-n;return mix(T(vUv),pre(mix(u_color1,u_color2,n)),u_opacity/100.);}`, { gen: true, anim: true });
E('cellPattern', 'generate', [sel('cellPattern', 'bubbles', ['bubbles', 'crystals', 'plates']), bool('invert', false), num('contrast', 100, 0, 1000, 1), px('size', 60, 4, 1000), ang('evolution', 0), pct('blendWithOriginal', 0)],
  `vec4 fx(){vec2 p=P()/max(u_size,1.);vec2 ip=floor(p),fp=fract(p);float f1=9.,f2=9.,id=0.;float ev=u_evolution/360.;
for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 g=vec2(float(i),float(j));vec2 c=ip+g;vec2 h=vec2(h2(c),h2(c+vec2(57.,113.)));vec2 o=.5+.42*sin(TAU*(h+ev*vec2(1.,1.3)+h.yx));float d=length(g+o-fp);if(d<f1){f2=f1;f1=d;id=h2(c+vec2(7.,3.));}else if(d<f2)f2=d;}
float v=u_cellPattern==0?clamp(1.-f1*1.25,0.,1.):(u_cellPattern==1?clamp((f2-f1)*2.,0.,1.):id);v=clamp((v-.5)*u_contrast/100.+.5,0.,1.);if(u_invert>.5)v=1.-v;return mix(vec4(vec3(v),1.),T(vUv),u_blendWithOriginal/100.);}`, { gen: true });
E('checkerboard', 'generate', [pt('anchor'), px('size', 40, 1, 2000), col('color', [1, 1, 1]), pct('opacity', 100)],
  `vec4 fx(){vec2 q=floor((P()-u_anchor)/max(u_size,1.));vec4 s=T(vUv);return mod(q.x+q.y,2.)>.5?over(pre(u_color)*u_opacity/100.,s):s;}`, { gen: true });
E('grid', 'generate', [pt('anchor'), px('size', 50, 2, 2000), px('border', 2, 0, 200), bool('invertGrid', false), col('color', [1, 1, 1]), pct('opacity', 100)],
  `vec4 fx(){vec2 q=P()-u_anchor;float sz=max(u_size,1.);vec2 m=abs(mod(q+sz*.5,sz)-sz*.5);float b=u_border*.5;float l=1.-smoothstep(b-.5,b+.5,min(m.x,m.y));if(u_invertGrid>.5)l=1.-l;return over(pre(u_color)*l*u_opacity/100.,T(vUv));}`, { gen: true });
E('circle', 'generate', [pt('center'), px('radius', 80, 0, 4000), px('feather', 2, 0, 500), bool('invertCircle', false), col('color', [1, 0.85, 0.2]), pct('opacity', 100)],
  `vec4 fx(){float d=length(P()-u_center);float f=u_feather*.5+.5;float m=1.-smoothstep(u_radius-f,u_radius+f,d);if(u_invertCircle>.5)m=1.-m;return over(pre(u_color)*m*u_opacity/100.,T(vUv));}`, { gen: true });
E('ellipse', 'generate', [pt('center'), px('width', 220, 0, 4000), px('height', 130, 0, 4000), px('thickness', 10, 0, 500), pct('softness', 40), col('insideColor', [1, 1, 1]), col('outsideColor', [0.15, 0.6, 1])],
  `vec4 fx(){vec2 d=P()-u_center;vec2 ax=max(vec2(u_width,u_height)*.5,vec2(1.));float k=length(d/ax);float dist=k>1e-4?(k-1.)*length(d)/k:min(ax.x,ax.y);float ad=abs(dist);float th=max(u_thickness*.5,.5);float sf=u_softness/100.*th*2.+.75;
float core=1.-smoothstep(th*.35,th*.35+.75,ad);float a=1.-smoothstep(th,th+sf,ad);vec3 cc=mix(u_outsideColor.rgb,u_insideColor.rgb,core);a=max(a,core);return over(vec4(cc*a,a),T(vUv));}`, { gen: true });
E('lightBeam', 'generate', [pt('startPoint', [0.1, 0.3]), pt('endPoint', [0.9, 0.7]), pct('length', 40), pct('time', 60), px('startThickness', 4, 0, 500), px('endThickness', 12, 0, 500), pct('softness', 50), col('insideColor', [1, 1, 1]), col('outsideColor', [0.3, 0.6, 1]), bool('animate', false), num('speed', 1, 0, 20, 0.01)],
  `vec4 fx(){vec2 p=P();vec2 ab=u_endPoint-u_startPoint;float L2=max(dot(ab,ab),1e-4);float tm=u_animate>.5?fract(uTime*u_speed*.5):u_time/100.;float len=u_length/100.;float hd=tm*(1.+len),tl=hd-len;float lo=max(tl,0.),hi=min(hd,1.);vec4 s=T(vUv);if(hi<=lo)return s;
float t=clamp(dot(p-u_startPoint,ab)/L2,lo,hi);float d=length(p-(u_startPoint+ab*t));float th=max(mix(u_startThickness,u_endThickness,t)*.5,.5);float core=1.-smoothstep(th*.5,th,d);float sf=th*(1.+u_softness/100.*4.);float glow=exp(-d*d/(2.*sf*sf))*(.35+.65*u_softness/100.);
vec3 c=u_insideColor.rgb*core+u_outsideColor.rgb*glow*(1.-core);float a=clamp(max(core,glow),0.,1.);return over(vec4(c,a),s);}`, { gen: true, anim: true });
E('lensFlare', 'generate', [pt('flareCenter', [0.3, 0.3]), pct('flareBrightness', 100, 0, 300), sel('lensType', 'zoom50_300', ['zoom50_300', 'prime35', 'prime105']), pct('blendWithOriginal', 0)],
  `vec4 fx(){vec2 p=P();float md=min(uSize.x,uSize.y);vec2 fc=u_flareCenter;vec2 ax=uSize*.5-fc;float br=u_flareBrightness/100.;vec2 d=p-fc;float r=length(d)/md;float an=atan(d.y,d.x);
vec3 l=vec3(1.,.95,.85)*(exp(-r*18.)*1.2+exp(-r*5.)*.25);
if(u_lensType==0){l+=vec3(1.,.8,.6)*pow(abs(cos(an*6.)),40.)*exp(-r*6.)*.5;l+=vec3(.55,.75,1.)*exp(-pow((r-.22)*40.,2.))*.3;}
else if(u_lensType==1){l+=vec3(.85,.9,1.)*exp(-abs(d.y)/md*120.)*exp(-abs(d.x)/md*3.)*.7;}
else{l+=vec3(1.,.7,.5)*pow(abs(cos(an*4.+.3)),60.)*exp(-r*4.)*.6;l+=vec3(1.,.6,.3)*exp(-pow((r-.12)*60.,2.))*.25;}
float ks[6]=float[6](.45,.8,1.15,1.4,1.75,2.2);float rs[6]=float[6](.025,.06,.035,.09,.05,.13);
for(int i=0;i<6;i++){float fi=float(i);vec3 gc=.55+.45*cos(TAU*(fi*.17+vec3(0.,.33,.67)));float g=length(p-(fc+ax*ks[i]))/(md*rs[i]);l+=gc*((1.-smoothstep(.7,1.,g))*.12+exp(-pow((g-1.)*8.,2.))*.08);}
vec4 s=T(vUv);return mix(addL(s,l*br),s,u_blendWithOriginal/100.);}`, { gen: true });
E('lightRays', 'generate', [pt('center', [0.5, 0.35]), pct('intensity', 100, 0, 500), px('radius', 40, 0, 1000), pct('rayLength', 50), pct('threshold', 70), col('color', [1, 0.9, 0.7])], {
  shaders: {
    src: `vec4 fx(){vec4 c=unp(T(vUv));float th=u_threshold/100.;float m=smoothstep(th,th+.15,luma(c.rgb))*c.a;float d=length(P()-u_center);float R=max(u_radius,.5);float sr=exp(-d*d/(2.*R*R));return vec4((c.rgb*m+sr)*u_color.rgb,max(m,sr));}`,
  },
  glsl: 'vec4 fx(){vec4 s=T(vUv);vec4 r=texture(uB,vUv);return addL(s,r.rgb*u_intensity/100.);}',
  run(X, P, inp) {
    const a = X.fx(X.tmp(), { uTex: inp }, null, 'src');
    const span = Math.max(0.01, P.rayLength / 100 * 1.6);
    const r = X.radial(a, P.center, 1, span, -span);
    return X.fx(X.tmp(), { uTex: inp, uB: r });
  },
}, { gen: true });
E('particles', 'generate', [num('birthRate', 60, 0, 2000, 0.1), num('longevity', 2, 0.05, 30, 0.01), pt('producerPosition', [0.5, 0.7]), px('producerRadius', 10, 0, 2000), ang('direction', 0), ang('spread', 60),
  px('velocity', 220, 0, 5000), pct('velocityRandom', 30), px('gravity', 200, -5000, 5000), num('resistance', 0.5, 0, 20, 0.01), sel('particleType', 'fadedSphere', ['fadedSphere', 'line', 'star', 'bubble']),
  px('birthSize', 14, 0, 500), px('deathSize', 4, 0, 500), col('birthColor', [1, 0.9, 0.3]), col('deathColor', [1, 0.25, 0.1]), pct('opacity', 100), num('emitDuration', 10, 0, 3600, 0.01), sel('transferMode', 'add', ['add', 'normal'])], {
  run(X, P, inp) {
    const out = X.copy(inp);
    const rate = Math.max(P.birthRate, 1e-4), L = Math.max(P.longevity, 0.01), t = X.info.time;
    const j0 = Math.max(0, Math.floor((t - L) * rate)), j1 = Math.floor(Math.min(t, P.emitDuration) * rate);
    const n = Math.min(j1 - j0 + 1, 60000);
    if (n <= 0 || P.birthRate <= 0) return out;
    const pr = getProg(CUR.def.id + '.pts', () => link(CUR.def.id + '.pts',
      H_VER + H_UNI + paramDecl(CUR.def) + H_FUN + PART_VS, H_VER + H_UNI + paramDecl(CUR.def) + H_FUN + PART_FS));
    drawProg(pr, out, null, { uJ0: j0, uMaxPt: maxPt }, CUR.def, P, { mode: gl.POINTS, count: n, blend: P.transferMode === 'add' ? 'add' : 'over' });
    return out;
  },
}, { gen: true, anim: true });
E('rainfall', 'generate', [num('drops', 800, 0, 5000, 1), px('speed', 1200, 0, 10000), ang('angle', 10), px('dropSize', 1.5, 0.1, 50), px('dropLength', 28, 1, 500), col('color', [0.78, 0.84, 0.95]), pct('opacity', 60)],
  `vec4 fx(){vec2 p0=P();vec4 s=T(vUv);float acc=0.;vec2 p=rot(-radians(u_angle))*(p0-uSize*.5);float area=uSize.x*uSize.y*2.;float n=max(u_drops/3.,1.);
for(int L=0;L<3;L++){float fl=float(L);float f=1.-fl*.28;float len=u_dropLength*f;float ch=max(len*2.5,sqrt(area/n));float cw=max(area/n/ch,u_dropSize*4.+2.);
vec2 q=p+vec2(fl*137.3,-uTime*u_speed*f-fl*391.7);vec2 id=floor(q/vec2(cw,ch));vec2 lc=q-id*vec2(cw,ch);float h=h2(id+fl*71.),hy=h2(id+fl*71.+vec2(13.,29.));
float x0=cw*(.15+.7*h),y0=(ch-len)*hy;float dx=abs(lc.x-x0);float ty=(lc.y-y0)/max(len,1.);if(ty>0.&&ty<1.){float w=max(u_dropSize*f*.5,.35);acc+=(1.-smoothstep(w,w+.8,dx))*ty*f;}}
acc=clamp(acc,0.,1.)*u_opacity/100.*u_color.a;return over(vec4(u_color.rgb*acc,acc),s);}`, { gen: true, anim: true });
E('snowfall', 'generate', [num('flakes', 300, 0, 5000, 1), px('speed', 60, 0, 2000), px('wind', 20, -2000, 2000), px('flakeSize', 4, 0.2, 100), col('color', [1, 1, 1]), pct('opacity', 90)],
  `vec4 fx(){vec2 p=P();vec4 s=T(vUv);float acc=0.;float area=uSize.x*uSize.y;float n=max(u_flakes/3.,1.);
for(int L=0;L<3;L++){float fl=float(L);float f=1.-fl*.3;float sz=u_flakeSize*f;float cs=max(sqrt(area/n),sz*6.+4.);
vec2 q=p-vec2(u_wind,u_speed)*uTime*f+vec2(fl*91.7,fl*53.1);vec2 id=floor(q/cs);vec2 lc=q-id*cs;float h=h2(id+fl*17.),hb=h2(id+fl*17.+vec2(5.,9.));
vec2 c=cs*vec2(.25+.5*h+.18*sin(uTime*1.3*f+hb*TAU),.15+.7*hb);float r=sz*(.5+.5*h2(id+vec2(3.,1.)))*.5+.5;acc+=(1.-smoothstep(r*.3,r,length(lc-c)))*(.5+.5*f);}
acc=clamp(acc,0.,1.)*u_opacity/100.*u_color.a;return over(vec4(u_color.rgb*acc,acc),s);}`, { gen: true, anim: true });
E('starfield', 'generate', [pt('center'), num('count', 300, 0, 5000, 1), num('speed', 0.3, -5, 5, 0.01), px('starSize', 2.5, 0.2, 50), pct('twinkle', 50), col('color', [1, 1, 1])],
  `vec4 fx(){vec2 p=P();vec4 s=T(vUv);float md=min(uSize.x,uSize.y);vec2 d=(p-u_center)/md;float acc=0.;float cs=2.2/sqrt(max(u_count/4.,1.));
for(int L=0;L<4;L++){float fl=float(L);float z=fract(fl*.25+uTime*u_speed*.25);float sc=mix(3.,.4,z);vec2 w=d*sc+fl*vec2(3.7,9.1);vec2 id=floor(w/cs);vec2 lc=w-id*cs;vec2 sp=cs*vec2(.2+.6*h2(id+fl*13.),.2+.6*h2(id+fl*13.+vec2(4.,7.)));
float dp=length(lc-sp)/sc*md;float sz=u_starSize*(.5+1.5*z)*(.6+.8*h2(id+vec2(9.,2.)));float hh=h2(id+vec2(1.,8.));float tw=1.-u_twinkle/100.*(.5+.5*sin(uTime*(2.+hh*5.)+hh*TAU));
float fd=smoothstep(0.,.25,z)*(1.-smoothstep(.85,1.,z));acc+=(1.-smoothstep(sz*.25,sz,dp))*tw*fd;}
acc=clamp(acc,0.,1.)*u_color.a;return over(vec4(u_color.rgb*acc,acc),s);}`, { gen: true, anim: true });
E('radioWaves', 'generate', [pt('producerPoint'), num('frequency', 2, 0.05, 20, 0.01), px('expansion', 150, 1, 5000), num('lifespan', 2, 0.1, 30, 0.01), sel('shape', 'circle', ['circle', 'square', 'hexagon']), col('color', [0.3, 0.8, 1]), px('strokeWidth', 4, 0.5, 200)],
  `float shp(vec2 d){if(u_shape==1)return max(abs(d.x),abs(d.y));if(u_shape==2){vec2 a=abs(d);return max(a.x*.866+a.y*.5,a.y);}return length(d);}
vec4 fx(){vec4 s=T(vUv);float d=shp(P()-u_producerPoint);float sp=max(u_expansion,1e-3),f=max(u_frequency,1e-3);float k0=floor((uTime-d/sp)*f);float acc=0.;float w=u_strokeWidth*.5;
for(int i=0;i<2;i++){float k=k0+float(i);if(k<0.)continue;float age=uTime-k/f;if(age<0.||age>u_lifespan)continue;acc=max(acc,(1.-smoothstep(w-.75,w+.75,abs(d-age*sp)))*(1.-age/u_lifespan));}
return over(pre(vec4(u_color.rgb,u_color.a*acc)),s);}`, { gen: true, anim: true });

// ═════════ 風格化 ═════════
E('glow', 'stylize', [pct('glowThreshold', 60), px('glowRadius', 25, 0, 1000), num('glowIntensity', 1.5, 0, 10, 0.01), sel('glowColors', 'originalColors', ['originalColors', 'abColors']), col('colorA', [1, 1, 1]), col('colorB', [1, 0.55, 0.1])], {
  shaders: {
    thr: `vec4 fx(){vec4 c=unp(T(vUv));float l=max(c.r,max(c.g,c.b));float th=u_glowThreshold/100.;float m=clamp((l-th)/max(1.-th,.02),0.,1.)*c.a;return u_glowColors==0?vec4(c.rgb*m,m):vec4(vec3(m),m);}`,
  },
  glsl: `vec4 fx(){vec4 s=T(vUv);vec4 g=texture(uB,vUv);vec3 gc=g.rgb;if(u_glowColors==1){float v=clamp(g.r*1.5,0.,1.);gc=mix(u_colorB.rgb,u_colorA.rgb,v)*g.r;}return addL(s,gc*u_glowIntensity);}`,
  run(X, P, inp) {
    const t = X.fx(X.tmp(), { uTex: inp }, null, 'thr');
    const b = X.blur(t, P.glowRadius * 0.5, P.glowRadius * 0.5);
    return X.fx(X.tmp(), { uTex: inp, uB: b });
  },
});
E('neonGlow', 'stylize', [col('color', [0.2, 0.85, 1]), px('radius', 18, 0, 500), num('intensity', 2, 0, 20, 0.01)], {
  glsl: `vec4 fx(){vec4 s=T(vUv);float g=clamp(texture(uB,vUv).a*u_intensity,0.,1.)*u_color.a;vec4 o=s+vec4(u_color.rgb*g,g)*(1.-s.a);return addL(o,u_color.rgb*g*.25*s.a);}`,
  run(X, P, inp) { return X.fx(X.tmp(), { uTex: inp, uB: X.blur(inp, P.radius * 0.5, P.radius * 0.5) }); },
});
E('findEdges', 'stylize', [bool('invert', false), pct('blendWithOriginal', 0)],
  `vec3 U(vec2 p){return unp(TP(p)).rgb;}
vec4 fx(){vec2 p=P();vec3 tl=U(p+vec2(-1,-1)),t=U(p+vec2(0,-1)),tr=U(p+vec2(1,-1)),l=U(p+vec2(-1,0)),r=U(p+vec2(1,0)),bl=U(p+vec2(-1,1)),b=U(p+vec2(0,1)),br=U(p+vec2(1,1));
vec3 gx=(tr+2.*r+br)-(tl+2.*l+bl),gy=(bl+2.*b+br)-(tl+2.*t+tr);vec3 e=clamp(sqrt(gx*gx+gy*gy)*.5,0.,1.);vec4 c=T(vUv);vec3 o=u_invert>.5?e:1.-e;return mix(vec4(o*c.a,c.a),c,u_blendWithOriginal/100.);}`);
E('emboss', 'stylize', [ang('direction', 45), px('relief', 2, 0, 50), num('contrast', 200, 0, 1000, 1), pct('blendWithOriginal', 0)],
  `vec4 fx(){vec2 p=P();vec2 d=dirv(u_direction)*max(u_relief,.5);vec4 c=T(vUv);float a=luma(unp(TP(p+d)).rgb),b=luma(unp(TP(p-d)).rgb);float g=clamp(.5+(b-a)*u_contrast/100.,0.,1.);return mix(vec4(vec3(g)*c.a,c.a),c,u_blendWithOriginal/100.);}`);
E('mosaic', 'stylize', [num('horizontalBlocks', 40, 1, 2000, 1), num('verticalBlocks', 24, 1, 2000, 1), bool('sharpColors', false)],
  `vec4 fx(){vec2 bs=uSize/max(vec2(u_horizontalBlocks,u_verticalBlocks),vec2(1.));vec2 id=floor(P()/bs);if(u_sharpColors>.5)return TP((id+.5)*bs);vec4 s=vec4(0.);for(int j=0;j<4;j++)for(int i=0;i<4;i++)s+=TP((id+(vec2(float(i),float(j))+.5)/4.)*bs);return s/16.;}`);
E('cartoon', 'stylize', [px('detailRadius', 4, 0, 100), num('shadingSteps', 6, 2, 32, 1), pct('edgeThreshold', 40), px('edgeWidth', 1.5, 0.5, 20), pct('edgeOpacity', 100)], {
  glsl: `float BL(vec2 p){return luma(texture(uB,p/uSize).rgb);}
vec4 fx(){vec2 p=P();vec4 c=unp(texture(uB,vUv));float l=luma(c.rgb);float st=max(u_shadingSteps,2.);float lq=floor(l*st+.5)/st;vec3 col=clamp(c.rgb*(lq+.04)/(l+.04),0.,1.);
float w=max(u_edgeWidth,.5);float g=length(vec2(BL(p+vec2(w,0.))-BL(p-vec2(w,0.)),BL(p+vec2(0.,w))-BL(p-vec2(0.,w))));float th=.01+u_edgeThreshold/100.*.25;float e=smoothstep(th,th*1.6+.01,g)*u_edgeOpacity/100.;col*=1.-e;float a=T(vUv).a;return vec4(col*a,a);}`,
  run(X, P, inp) { return X.fx(X.tmp(), { uTex: inp, uB: X.blur(inp, P.detailRadius * 0.5, P.detailRadius * 0.5) }); },
});
E('colorHalftone', 'stylize', [px('maxRadius', 4, 1, 100), ang('channel1Angle', 108), ang('channel2Angle', 162), ang('channel3Angle', 90), ang('channel4Angle', 45)],
  `float dotc(vec2 p,float an,int ch,float R){float cs=R*2.;mat2 m=rot(radians(an));vec2 q=m*p;vec2 cc=(floor(q/cs)+.5)*cs;vec4 c=unp(TP(transpose(m)*cc));vec3 cmy=1.-c.rgb;float k=min(cmy.r,min(cmy.g,cmy.b));float v=ch==3?k:(cmy[ch]-k)/max(1.-k,1e-3);v*=c.a;float r=R*1.414*sqrt(clamp(v,0.,1.));return 1.-smoothstep(r-.7,r+.7,length(q-cc));}
vec4 fx(){vec2 p=P();float R=max(u_maxRadius,.5);float C=dotc(p,u_channel1Angle,0,R),M=dotc(p,u_channel2Angle,1,R),Y=dotc(p,u_channel3Angle,2,R),K=dotc(p,u_channel4Angle,3,R);vec3 r=vec3(1.-C,1.-M,1.-Y)*(1.-K);float a=T(vUv).a;return vec4(r*a,a);}`);
E('scanlines', 'stylize', [num('count', 180, 1, 2000, 1), pct('thickness', 50), pct('opacity', 35), px('speed', 30, -2000, 2000), col('color', [0, 0, 0])],
  `vec4 fx(){vec4 c=T(vUv);float per=uSize.y/max(u_count,1.);float f=fract((P().y-uTime*u_speed)/per);float th=u_thickness/100.;float aa=min(.5,1./per);float m=1.-smoothstep(th-aa,th+aa,f);return mix(c,vec4(u_color.rgb*c.a,c.a),m*u_opacity/100.);}`, { anim: true });
E('roughenEdges', 'stylize', [px('border', 8, 0, 500), num('edgeSharpness', 1, 0, 10, 0.01), pct('scale', 100, 10, 1000), num('complexity', 3, 1, 10, 0.1), ang('evolution', 0)],
  `vec4 fx(){vec2 p=P();float sc=max(u_scale/100.*40.*uScale,1.);vec3 q=vec3(p/sc,u_evolution/360.);vec2 o=vec2(fbm(q,u_complexity,false),fbm(q+vec3(21.,7.,3.),u_complexity,false))-.5;vec4 c=TP(p+o*u_border*2.5);
float a2=clamp((c.a-.5)*(1.+u_edgeSharpness*2.)+.5,0.,1.);return c.a>1e-4?c*(a2/c.a):vec4(0.);}`);
E('glitch', 'stylize', [pct('amount', 50), px('blockSize', 40, 2, 1000), px('rgbSplit', 8, 0, 500), num('speed', 8, 0, 60, 0.1)],
  `vec4 fx(){vec2 p=P();float ft=floor(uTime*max(u_speed,.01));float am=u_amount/100.;float bs=max(u_blockSize,2.);vec2 q=p;
float row=floor(p.y/(bs*.5));if(h2(vec2(row,ft))<am*.6)q.x+=(h2(vec2(row,ft+7.))-.5)*bs*3.*am;
vec2 bid=floor(p/vec2(bs*2.,bs*.6));bool blk=h2(bid+vec2(ft*13.,ft*7.))<am*.25;if(blk)q+=(vec2(h2(bid+3.1+ft),h2(bid+5.7+ft))-.5)*bs*2.;
float sp=u_rgbSplit*(.5+h1(ft))*(blk?2.:1.);vec4 cr=TP(q+vec2(sp,0.)),cg=TP(q),cb=TP(q-vec2(sp,0.));vec4 o=vec4(cr.r,cg.g,cb.b,max(cg.a,max(cr.a,cb.a)));o.rgb=min(o.rgb,vec3(o.a));
if(blk&&h2(bid+ft*3.)<.3)o.rgb=o.a-o.rgb;return o;}`, { anim: true });
E('rgbSplit', 'stylize', [px('amount', 6, -200, 200), ang('angle', 90)],
  `vec4 fx(){vec2 p=P();vec2 d=dirv(u_angle)*u_amount;vec4 r=TP(p-d),g=TP(p),b=TP(p+d);float a=max(g.a,max(r.a,b.a));return vec4(r.r,g.g,b.b,a);}`);
E('vignette', 'stylize', [pct('amount', 60), pct('roundness', 50), pct('feather', 50), col('color', [0, 0, 0])],
  `vec4 fx(){vec4 c=T(vUv);vec2 d=(vUv-.5)*2.;float sx=mix(1.,uSize.x/uSize.y,u_roundness/100.);d.x*=sx;float dist=length(d)/length(vec2(sx,1.));float f=u_feather/100.;float v=smoothstep(.9-f*.75,1.02,dist);return mix(c,vec4(u_color.rgb*c.a,c.a),clamp(v*u_amount/100.,0.,1.));}`);
E('filmGrain', 'stylize', [pct('amount', 25), px('size', 1.2, 0.5, 20), bool('colored', false), bool('animated', true)],
  `vec4 fx(){vec4 c=unp(T(vUv));vec2 p=P()/max(u_size,.5);float fr=u_animated>.5?floor(uTime*24.):0.;vec2 o=vec2(fr*37.,fr*91.);vec3 n=u_colored>.5?vec3(vn2(p+o),vn2(p+o+vec2(19.,7.)),vn2(p+o+vec2(3.,41.))):vec3(vn2(p+o));return pre(vec4(clamp(c.rgb+(n-.5)*u_amount/100.*1.2,0.,1.),c.a));}`, { anim: true });
E('oldFilm', 'stylize', [pct('sepia', 70), pct('scratches', 50), pct('flicker', 30), pct('dust', 40)],
  `vec4 fx(){vec2 p=P();vec4 c=unp(T(vUv));float fr=floor(uTime*24.);vec3 r=c.rgb;float l=luma(r);r=mix(r,vec3(l)*vec3(1.07,.92,.7)+vec3(.05,.02,0.),u_sepia/100.);r*=1.+(h1(fr)-.5)*u_flicker/100.*.6;
float sc=0.;for(int i=0;i<4;i++){float fi=float(i);float sg=floor(uTime*3.+fi*.37);if(h1(sg*7.+fi*3.)>u_scratches/100.)continue;float x=h1(sg*11.+fi)*uSize.x+(h1(fr+fi*5.)-.5)*6.*uScale;float w=(.6+h1(sg+fi*2.)*1.2)*uScale;sc+=exp(-pow((p.x-x)/w,2.))*(.4+.6*vn2(vec2(fi*9.,p.y/(40.*uScale)+fr)));}
r=mix(r,vec3(.95,.92,.85),clamp(sc,0.,1.)*.8);float cz=30.*uScale;vec2 cell=floor(p/cz);if(h2(cell+fr*17.)<u_dust/100.*.06){vec2 cp=(cell+vec2(h2(cell+fr+.3),h2(cell+fr+.7)))*cz;float rr=(1.+h2(cell+fr*2.)*2.5)*uScale;r*=mix(1.,.15,1.-smoothstep(rr*.5,rr,length(p-cp)));}
vec2 v=vUv-.5;r*=1.-dot(v,v)*.8;r+=(h2(p+fr*3.1)-.5)*.06;return pre(vec4(clamp(r,0.,1.),c.a));}`, { anim: true });

// ═════════ 圖層樣式（以 alpha 為基礎） ═════════
E('dropShadow', 'style', [col('shadowColor', [0, 0, 0]), pct('opacity', 75), ang('direction', 135), px('distance', 10, 0, 1000), px('size', 10, 0, 250), pct('spread', 0), bool('shadowOnly', false)], {
  glsl: `vec4 fx(){vec4 s=T(vUv);vec2 o=dirv(u_direction)*u_distance;float a=TB((P()-o)/uSize).a;a=clamp(a/max(1.-u_spread/100.,.01),0.,1.);vec4 sh=vec4(u_shadowColor.rgb,1.)*a*u_shadowColor.a*u_opacity/100.;return u_shadowOnly>.5?sh:s+sh*(1.-s.a);}`,
  run(X, P, inp) { return X.fx(X.tmp(), { uTex: inp, uB: X.blur(inp, P.size * 0.5, P.size * 0.5) }); },
});
E('innerShadow', 'style', [col('shadowColor', [0, 0, 0]), pct('opacity', 75), ang('direction', 120), px('distance', 6, 0, 1000), pct('choke', 0), px('size', 8, 0, 250)], {
  glsl: `vec4 fx(){vec4 s=T(vUv);vec2 o=dirv(u_direction)*u_distance;float a=1.-TB((P()-o)/uSize).a;a=clamp(a/max(1.-u_choke/100.,.01),0.,1.)*u_opacity/100.*u_shadowColor.a;return vec4(mix(s.rgb,u_shadowColor.rgb*s.a,a),s.a);}`,
  run(X, P, inp) { return X.fx(X.tmp(), { uTex: inp, uB: X.blur(inp, P.size * 0.5, P.size * 0.5) }); },
});
E('outerGlow', 'style', [col('color', [1, 1, 0.75]), pct('opacity', 75), px('size', 15, 0, 250), pct('spread', 0)], {
  glsl: `vec4 fx(){vec4 s=T(vUv);float a=texture(uB,vUv).a;a=clamp(a*1.8/max(1.-u_spread/100.,.01),0.,1.)*u_opacity/100.*u_color.a;return s+vec4(u_color.rgb*a,a)*(1.-s.a);}`,
  run(X, P, inp) { return X.fx(X.tmp(), { uTex: inp, uB: X.blur(inp, P.size * 0.5, P.size * 0.5) }); },
});
E('innerGlow', 'style', [col('color', [1, 1, 0.75]), pct('opacity', 75), px('size', 10, 0, 250), pct('choke', 0), sel('source', 'edge', ['edge', 'center'])], {
  glsl: `vec4 fx(){vec4 s=T(vUv);float b=texture(uB,vUv).a;float g=u_source==0?1.-b:b;g=clamp(g*1.6/max(1.-u_choke/100.,.01),0.,1.)*u_opacity/100.*u_color.a;vec4 c=unp(s);vec3 r=1.-(1.-c.rgb)*(1.-u_color.rgb*g);return vec4(r*s.a,s.a);}`,
  run(X, P, inp) { return X.fx(X.tmp(), { uTex: inp, uB: X.blur(inp, P.size * 0.5, P.size * 0.5) }); },
});
E('bevelEmboss', 'style', [sel('style', 'innerBevel', ['innerBevel', 'outerBevel', 'emboss', 'pillowEmboss']), pct('depth', 100, 1, 1000), sel('direction', 'up', ['up', 'down']), px('size', 6, 0, 250), ang('angle', 120), ang('altitude', 30),
  col('highlightColor', [1, 1, 1]), pct('highlightOpacity', 75), col('shadowColor', [0, 0, 0]), pct('shadowOpacity', 75)], {
  glsl: `vec4 fx(){vec2 p=P();vec4 s=T(vUv);vec2 e=vec2(1.,0.);float gx=(TB((p+e.xy)/uSize).a-TB((p-e.xy)/uSize).a)*.5,gy=(TB((p+e.yx)/uSize).a-TB((p-e.yx)/uSize).a)*.5;
float k=max(u_size,1.)*2.5*u_depth/100.;if(u_direction==1)k=-k;vec3 n=normalize(vec3(-gx*k,-gy*k,1.));float az=radians(u_angle),al=radians(u_altitude);vec3 L=vec3(cos(az)*cos(al),-sin(az)*cos(al),sin(al));float sh=dot(n,L)-sin(al);
float hi=clamp(sh*2.,0.,1.),dk=clamp(-sh*2.,0.,1.);float wi=u_style==1?0.:1.;vec4 c=unp(s);vec3 r=c.rgb;
r=mix(r,r*u_shadowColor.rgb,dk*u_shadowOpacity/100.*wi);r=mix(r,1.-(1.-r)*(1.-u_highlightColor.rgb),hi*u_highlightOpacity/100.*wi);vec4 o=vec4(r*s.a,s.a);
if(u_style!=0){float ho=u_style==3?dk:hi,dO=u_style==3?hi:dk;float oa=1.-s.a;float ha=ho*u_highlightOpacity/100.*oa,da=dO*u_shadowOpacity/100.*oa;vec4 ly=vec4(u_highlightColor.rgb*ha,ha)+vec4(u_shadowColor.rgb*da,da)*(1.-ha);o=o+ly*(1.-o.a);}return o;}`,
  run(X, P, inp) { const s = Math.max(P.size * 0.5, 0.7); return X.fx(X.tmp(), { uTex: inp, uB: X.blur(inp, s, s) }); },
});
E('satin', 'style', [col('color', [0, 0, 0]), pct('opacity', 50), ang('angle', 19), px('distance', 11, 0, 250), px('size', 14, 0, 250), bool('invert', false)], {
  glsl: `vec4 fx(){vec2 p=P();vec4 s=T(vUv);float an=radians(u_angle);vec2 o=vec2(cos(an),-sin(an))*u_distance;float v=abs(TB((p+o)/uSize).a-TB((p-o)/uSize).a);if(u_invert>.5)v=1.-v;v*=u_opacity/100.*u_color.a;vec4 c=unp(s);return pre(vec4(mix(c.rgb,c.rgb*u_color.rgb,v),c.a));}`,
  run(X, P, inp) { return X.fx(X.tmp(), { uTex: inp, uB: X.blur(inp, P.size * 0.5, P.size * 0.5) }); },
});
E('colorOverlay', 'style', [col('color', [1, 0.3, 0.3]), pct('opacity', 100)],
  `vec4 fx(){vec4 s=T(vUv);return vec4(mix(s.rgb,u_color.rgb*s.a,u_opacity/100.*u_color.a),s.a);}`);
E('gradientOverlay', 'style', [col('color1', [1, 0.45, 0.2]), col('color2', [0.35, 0.2, 1]), sel('style', 'linear', ['linear', 'radial', 'angle', 'reflected']), ang('angle', 90), pct('scale', 100, 10, 150), bool('reverse', false), pct('opacity', 100)],
  `vec4 fx(){vec2 p=P();vec4 s=T(vUv);float a=radians(u_angle);vec2 dr=vec2(cos(a),-sin(a));vec2 d=p-uSize*.5;float ext=abs(dr.x)*uSize.x*.5+abs(dr.y)*uSize.y*.5;float sc=max(u_scale/100.,.01);float t;
if(u_style==1)t=length(d)/(.5*length(uSize)*sc);else if(u_style==2)t=fract((atan(-d.y,d.x)-a)/TAU);else if(u_style==3)t=abs(dot(d,dr))/(ext*sc);else t=.5+dot(d,dr)/(2.*ext*sc);
t=clamp(t,0.,1.);if(u_reverse>.5)t=1.-t;vec4 g=mix(u_color1,u_color2,t);return vec4(mix(s.rgb,g.rgb*s.a,u_opacity/100.*g.a),s.a);}`);
E('stroke', 'style', [col('color', [1, 0.2, 0.2]), px('size', 4, 0, 250), sel('position', 'outside', ['outside', 'inside', 'center']), pct('opacity', 100)], {
  glsl: `uniform float uEnc,uHalf;
float jd(vec4 v){if(v.z<.5)return 1e5;vec2 o=uEnc>.5?(v.xy-.5)*254.:v.xy;return length(o);}
vec4 fx(){vec4 s=T(vUv);ivec2 ip=ivec2(gl_FragCoord.xy);float h=uHalf;float op=u_opacity/100.*u_color.a;vec4 o=s;
if(u_position!=1){float d=jd(texelFetch(uB,ip,0));float cov=s.a>=.5?1.:clamp(h+1.-d,0.,1.);float k=cov*op;o=s+vec4(u_color.rgb*k,k)*(1.-s.a);}
if(u_position!=0){float d=jd(texelFetch(uC,ip,0));float cov=s.a<.5?0.:clamp(h+1.-d,0.,1.);o.rgb=mix(o.rgb,u_color.rgb*o.a,cov*op);}return o;}`,
  run(X, P, inp) {
    const sz = P.size; if (sz < 0.05) return inp;
    const half = P.position === 'center' ? sz / 2 : sz;
    const jo = P.position !== 'inside' ? X.jfa(inp, false, half + 2) : inp;
    const ji = P.position !== 'outside' ? X.jfa(inp, true, half + 2) : inp;
    return X.fx(X.tmp(), { uTex: inp, uB: jo, uC: ji }, { uEnc: X.half ? 0 : 1, uHalf: half });
  },
});

// ═════════ 轉場 ═════════
E('linearWipe', 'transition', [pct('transitionCompletion', 50), ang('wipeAngle', 90), px('feather', 20, 0, 2000)],
  `vec4 fx(){vec2 dr=dirv(u_wipeAngle);vec2 d=P()-uSize*.5;float ext=abs(dr.x)*uSize.x*.5+abs(dr.y)*uSize.y*.5;float x=dot(d,dr)+ext;float f=max(u_feather,.5);float c=u_transitionCompletion/100.*(2.*ext+f);return T(vUv)*smoothstep(c-f,c,x);}`);
E('radialWipe', 'transition', [pct('transitionCompletion', 50), ang('startAngle', 0), pt('wipeCenter'), sel('wipe', 'clockwise', ['clockwise', 'counterclockwise', 'both']), px('feather', 0, 0, 2000)],
  `vec4 fx(){vec2 d=P()-u_wipeCenter;float a=fract((atan(d.x,-d.y)-radians(u_startAngle))/TAU);if(u_wipe==1)a=1.-a;else if(u_wipe==2)a=min(a,1.-a)*2.;float c=u_transitionCompletion/100.;float fw=u_feather/max(length(d),1.)/TAU;
if(c<=0.)return T(vUv);return T(vUv)*smoothstep(c,c+fw+1e-4,a);}`);
E('irisWipe', 'transition', [pt('irisCenter'), num('irisPoints', 6, 3, 32, 1), px('outerRadius', 120, 0, 4000), bool('useInnerRadius', false), px('innerRadius', 60, 0, 4000), ang('rotation', 0), px('feather', 0, 0, 2000)],
  `vec4 fx(){vec2 d=P()-u_irisCenter;float n=max(floor(u_irisPoints),3.);float sg=TAU/n;float a=mod(atan(d.x,-d.y)-radians(u_rotation),sg);if(a>sg*.5)a=sg-a;
float Ro=u_outerRadius,Ri=u_useInnerRadius>.5?u_innerRadius:Ro*cos(PI/n);vec2 A=vec2(Ro,0.),B=Ri*vec2(cos(sg*.5),sin(sg*.5));vec2 dr=vec2(cos(a),sin(a));vec2 nn=vec2(-(B-A).y,(B-A).x);float rs=dot(nn,A)/(dot(nn,dr)+1e-6);if(dot(nn,dr)*dot(nn,A)<=0.)rs=Ro;
float f=max(u_feather,.75);return T(vUv)*(1.-smoothstep(rs-f,rs,length(d)));}`);
E('venetianBlinds', 'transition', [pct('transitionCompletion', 50), ang('direction', 0), px('width', 30, 1, 2000), px('feather', 0, 0, 1000)],
  `vec4 fx(){vec2 dr=dirv(u_direction);float w=max(u_width,1.);float x=fract(dot(P(),dr)/w)*w;float c=u_transitionCompletion/100.*(w+u_feather);return T(vUv)*smoothstep(c-u_feather-1e-3,c,x);}`);
E('blockDissolve', 'transition', [pct('transitionCompletion', 50), px('blockWidth', 20, 1, 2000), px('blockHeight', 20, 1, 2000), pct('feather', 0)],
  `vec4 fx(){vec2 q=P()/max(vec2(u_blockWidth,u_blockHeight),vec2(1.));float fe=u_feather/100.;float v=mix(h2(q),vn2(q-.5),fe);float w=fe*.3+.001;float c=u_transitionCompletion/100.*(1.+w);return T(vUv)*smoothstep(c-w,c,v);}`);
E('gradientWipe', 'transition', [pct('transitionCompletion', 50), pct('transitionSoftness', 20), px('scale', 120, 4, 4000), bool('invertGradient', false)],
  `vec4 fx(){float g=fbm(vec3(P()/max(u_scale,1.),0.),4.,false);g=clamp((g-.5)*2.2+.5,0.,1.);if(u_invertGradient>.5)g=1.-g;float s=u_transitionSoftness/100.+.001;float c=u_transitionCompletion/100.*(1.+s);return T(vUv)*smoothstep(c-s,c,g);}`);
E('fadeTransition', 'transition', [pct('transitionCompletion', 50)],
  'vec4 fx(){return T(vUv)*clamp(1.-u_transitionCompletion/100.,0.,1.);}');

// ═════════ 雜訊與顆粒 ═════════
E('median', 'noise', [px('radius', 2, 0, 50)], MED + 'vec4 fx(){return med(P(),u_radius);}');
E('dustScratches', 'noise', [px('radius', 3, 0, 50), num('threshold', 10, 0, 255, 1)],
  MED + 'vec4 fx(){vec4 c=T(vUv);vec4 m=med(P(),u_radius);return abs(luma(c.rgb)-luma(m.rgb))*255.>u_threshold?m:c;}');
E('noiseHls', 'noise', [pct('hue', 20), pct('lightness', 20), pct('saturation', 20), px('grainSize', 1, 0.5, 50), bool('animated', true)],
  `vec4 fx(){vec4 c=unp(T(vUv));vec2 p=P()/max(u_grainSize,.5);float fr=u_animated>.5?floor(uTime*24.):0.;vec2 o=vec2(fr*41.,fr*17.);vec3 h=rgb2hsl(c.rgb);h.x=fract(h.x+(vn2(p+o)-.5)*u_hue/100.);h.z=clamp(h.z+(vn2(p+o+vec2(9.,3.))-.5)*u_lightness/100.,0.,1.);h.y=clamp(h.y+(vn2(p+o+vec2(2.,17.))-.5)*u_saturation/50.,0.,1.);return pre(vec4(hsl2rgb(h),c.a));}`, { anim: true });

// ═════════ 時間 ═════════
E('strobe', 'time', [col('strobeColor', [1, 1, 1]), pct('blendWithOriginal', 0), num('strobePeriod', 0.5, 0.01, 60, 0.01), pct('strobeDuration', 30), sel('strobeType', 'colorOnly', ['colorOnly', 'makeTransparent'])],
  `vec4 fx(){vec4 s=T(vUv);float ph=fract(uTime/max(u_strobePeriod,.001)+1e-4);if(ph>=u_strobeDuration/100.)return s;if(u_strobeType==1)return s*u_blendWithOriginal/100.;return mix(vec4(u_strobeColor.rgb*s.a,s.a),s,u_blendWithOriginal/100.);}`, { anim: true });
E('flicker', 'time', [pct('amount', 40), num('speed', 10, 0.1, 100, 0.1), bool('smooth', true)],
  `float tn(float x){float i=floor(x),f=fract(x);float a=h1(i),b=h1(i+1.);return u_smooth>.5?mix(a,b,smoothstep(0.,1.,f)):a;}
vec4 fx(){vec4 c=unp(T(vUv));float k=1.+(tn(uTime*u_speed)-.5)*2.*u_amount/100.;return pre(vec4(clamp(c.rgb*k,0.,1.),c.a));}`, { anim: true });

// ═════════ 去背 ═════════
E('colorKey', 'keying', [col('keyColor', [0.15, 0.35, 1]), num('colorTolerance', 60, 0, 255, 1), num('edgeThin', 0, -5, 5, 1), px('edgeFeather', 0, 0, 50)], {
  glsl: `vec4 fx(){vec4 c=unp(T(vUv));float d=length(c.rgb-u_keyColor.rgb)*255./1.732;return vec4(smoothstep(u_colorTolerance-1.,u_colorTolerance+1.,d));}`,
  run(X, P, inp) { return X.keyApply(inp, X.fx(X.tmp(), { uTex: inp }), P.edgeThin, P.edgeFeather); },
});
E('chromaKey', 'keying', [col('screenColor', [0.1, 0.85, 0.2]), pct('tolerance', 30), pct('softness', 20), pct('spillSuppression', 50)], {
  glsl: `uniform int uKeyCh;
vec4 fx(){vec4 c=unp(T(vUv));vec2 k=cbcr(u_screenColor.rgb);float d=length(cbcr(c.rgb)-k)/max(length(k),.05);float t=u_tolerance/100.,s=u_softness/100.+1e-3;float m=smoothstep(t,t+s,d);vec3 r=c.rgb;int i=uKeyCh;float lim=(r[(i+1)%3]+r[(i+2)%3])*.5;r[i]=mix(r[i],min(r[i],lim),u_spillSuppression/100.);return pre(vec4(r,c.a*m));}`,
  uni: (P) => ({ uKeyCh: keyCh(P.screenColor) }),
});
E('lumaKey', 'keying', [sel('keyType', 'keyOutDarker', ['keyOutBrighter', 'keyOutDarker', 'keyOutSimilar', 'keyOutDissimilar']), num('threshold', 90, 0, 255, 1), num('tolerance', 20, 0, 255, 1), num('edgeThin', 0, -5, 5, 1), px('edgeFeather', 2, 0, 50)], {
  glsl: `vec4 fx(){vec4 c=unp(T(vUv));float l=luma(c.rgb)*255.;float h=u_tolerance*.5+.5;float m;
if(u_keyType==0)m=1.-smoothstep(u_threshold-h,u_threshold+h,l);else if(u_keyType==1)m=smoothstep(u_threshold-h,u_threshold+h,l);else{m=smoothstep(u_tolerance-.5,u_tolerance+.5,abs(l-u_threshold));if(u_keyType==3)m=1.-m;}return vec4(m);}`,
  run(X, P, inp) { return X.keyApply(inp, X.fx(X.tmp(), { uTex: inp }), P.edgeThin, P.edgeFeather); },
});
E('linearColorKey', 'keying', [col('keyColor', [0.15, 0.35, 1]), sel('matchColors', 'usingRgb', ['usingRgb', 'usingHue', 'usingChroma']), pct('matchingTolerance', 20), pct('matchingSoftness', 10), sel('keyOperation', 'keyColors', ['keyColors', 'keepColors'])],
  `vec4 fx(){vec4 c=unp(T(vUv));float d;if(u_matchColors==1){float a=rgb2hsl(c.rgb).x,b=rgb2hsl(u_keyColor.rgb).x;d=abs(a-b);d=min(d,1.-d)*2.;}else if(u_matchColors==2)d=length(cbcr(c.rgb)-cbcr(u_keyColor.rgb))/.7;else d=length(c.rgb-u_keyColor.rgb)/1.732;
float t=u_matchingTolerance/100.,s=u_matchingSoftness/100.+1e-3;float m=smoothstep(t,t+s,d);if(u_keyOperation==1)m=1.-m;return T(vUv)*m;}`);
E('spillSuppressor', 'keying', [col('colorToSuppress', [0.1, 0.85, 0.2]), pct('suppression', 100)], {
  glsl: `uniform int uKeyCh;
vec4 fx(){vec4 c=unp(T(vUv));vec3 r=c.rgb;int i=uKeyCh;float lim=(r[(i+1)%3]+r[(i+2)%3])*.5;r[i]=mix(r[i],min(r[i],lim),u_suppression/100.);return pre(vec4(r,c.a));}`,
  uni: (P) => ({ uKeyCh: keyCh(P.colorToSuppress) }),
});

// ═════════ 透視 ═════════
E('bevelAlpha', 'perspective', [px('edgeThickness', 4, 0, 200), ang('lightAngle', -60), col('lightColor', [1, 1, 1]), num('lightIntensity', 0.5, 0, 1, 0.01)], {
  glsl: `vec4 fx(){vec2 p=P();vec4 s=T(vUv);vec2 e=vec2(1.,0.);vec2 g=vec2(TB((p+e.xy)/uSize).a-TB((p-e.xy)/uSize).a,TB((p+e.yx)/uSize).a-TB((p-e.yx)/uSize).a)*.5;float sh=clamp(dot(-g,dirv(u_lightAngle))*max(u_edgeThickness,1.)*4.,-1.,1.)*u_lightIntensity;vec4 c=unp(s);vec3 r=sh>0.?mix(c.rgb,u_lightColor.rgb,sh):c.rgb*(1.+sh);return pre(vec4(r,c.a));}`,
  run(X, P, inp) { const s = Math.max(P.edgeThickness * 0.6, 0.7); return X.fx(X.tmp(), { uTex: inp, uB: X.blur(inp, s, s) }); },
});
E('reflection', 'perspective', [pct('floorLevel', 80), px('distance', 0, 0, 2000), pct('opacity', 50), pct('fadeLength', 30)],
  `vec4 fx(){vec2 p=P();vec4 s=T(vUv);float y0=u_floorLevel/100.*uSize.y;float dy=p.y-y0-u_distance;if(dy<0.)return s;vec4 r=TP(vec2(p.x,y0-dy));float f=1.-clamp(dy/max(u_fadeLength/100.*uSize.y,1.),0.,1.);return s+r*(u_opacity/100.*f)*(1.-s.a);}`);
E('basic3D', 'perspective', [ang('swivel', 30), ang('tilt', 0), px('distanceToImage', 0, -5000, 5000), bool('specularHighlight', false)], {
  glsl: HOM + 'uniform float uSpec;\nvec4 fx(){vec3 q=uH*vec3(P(),1.);if(q.z<=1e-6)return vec4(0.);vec2 uv=q.xy/q.z;vec4 c=T(uv);float sp=uSpec*exp(-dot(uv-vec2(.35),uv-vec2(.35))*8.);return vec4(min(c.rgb+sp*c.a,vec3(c.a)),c.a);}',
  uni(P) {
    const sw = rad(P.swivel), ti = rad(P.tilt), f = Math.max(W, H) * 1.6;
    const pts = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]].map(([x, y]) => {
      const y1 = y * Math.cos(ti), z1 = y * Math.sin(ti);
      const x2 = x * Math.cos(sw) + z1 * Math.sin(sw), z2 = -x * Math.sin(sw) + z1 * Math.cos(sw);
      const zz = Math.max(f + z2 + P.distanceToImage, 1);
      return [x2 * f / zz + W / 2, y1 * f / zz + H / 2];
    });
    const nz = Math.abs(Math.cos(sw) * Math.cos(ti));
    return { uH: homInv(pts), uSpec: P.specularHighlight ? 0.6 * Math.pow(nz, 6) : 0 };
  },
});

// ═════════ 公用程式 ═════════
E('alphaFromLuma', 'utility', [bool('invert', false)],
  'vec4 fx(){vec4 c=unp(T(vUv));float l=luma(c.rgb);if(u_invert>.5)l=1.-l;return pre(vec4(c.rgb,c.a*l));}');
E('channelShift', 'utility', [sel('takeAlphaFrom', 'luminance', ['red', 'green', 'blue', 'alpha', 'luminance', 'full']), bool('invertAlpha', false)],
  `vec4 fx(){vec4 c=unp(T(vUv));int k=u_takeAlphaFrom;float a=k==0?c.r:k==1?c.g:k==2?c.b:k==3?c.a:k==4?luma(c.rgb):1.;if(u_invertAlpha>.5)a=1.-a;return pre(vec4(c.rgb,clamp(a,0.,1.)));}`);
E('solidComposite', 'utility', [col('color', [0.12, 0.35, 0.85]), pct('opacity', 100), pct('sourceOpacity', 100)],
  'vec4 fx(){vec4 s=T(vUv)*u_sourceOpacity/100.;vec4 b=pre(u_color)*u_opacity/100.;return s+b*(1.-s.a);}', { gen: true });
E('gammaAdjust', 'utility', [num('gamma', 1.6, 0.1, 5, 0.01)],
  'vec4 fx(){vec4 c=unp(T(vUv));return pre(vec4(pow(c.rgb,vec3(1./max(u_gamma,.01))),c.a));}');
E('simpleChoker', 'utility', [px('chokeMatte', 3, -100, 100)], {
  glsl: `vec4 fx(){vec4 s=T(vUv);vec4 b=texture(uB,vUv);float t=u_chokeMatte>0.?.933:.067;float a=smoothstep(t-.06,t+.06,b.a);vec3 c;if(u_chokeMatte>0.){a=min(a,s.a);c=unp(s).rgb;}else{a=max(a,s.a);c=s.a>.5?unp(s).rgb:unp(b).rgb;}return pre(vec4(c,a));}`,
  run(X, P, inp) {
    const k = P.chokeMatte; if (Math.abs(k) < 0.05) return inp;
    const s = Math.abs(k) / 1.5 + 0.5;
    return X.fx(X.tmp(), { uTex: inp, uB: X.full(X.blur(inp, s, s)) });
  },
});

// ───────── 粒子（實例化點精靈，由時間與種子解析計算，可任意拖曳時間軸） ─────────
const PART_VS = `
uniform float uJ0,uMaxPt;
out vec4 vCol;out float vSz;out vec2 vVel;
float pr(float j,float k){return hu(uh(uint(j)*0x9E3779B1u+uint(k)*0x85EBCA77u)^sd());}
void main(){float j=uJ0+float(gl_VertexID);float tb=j/max(u_birthRate,1e-4);float age=uTime-tb;
if(age<0.||age>u_longevity||tb>u_emitDuration){gl_Position=vec4(-9.,-9.,0.,1.);gl_PointSize=1.;vCol=vec4(0.);vSz=1.;vVel=vec2(1.,0.);return;}
float r1=pr(j,1.),r2=pr(j,2.),r3=pr(j,3.),r4=pr(j,4.),r5=pr(j,5.);
float ra=r1*TAU;vec2 p0=u_producerPosition+vec2(cos(ra),sin(ra))*sqrt(r2)*u_producerRadius;
float a=radians(u_direction+(r3-.5)*u_spread);vec2 v0=vec2(sin(a),-cos(a))*u_velocity*(1.+(r4-.5)*2.*u_velocityRandom/100.);
vec2 g=vec2(0.,u_gravity);float k=max(u_resistance,0.);vec2 pos,vel;
if(k<1e-3){pos=p0+v0*age+.5*g*age*age;vel=v0+g*age;}else{float e=exp(-k*age);pos=p0+(v0-g/k)*(1.-e)/k+g*age/k;vel=v0*e+g/k*(1.-e);}
float lt=clamp(age/max(u_longevity,1e-3),0.,1.);float sz=max(mix(u_birthSize,u_deathSize,lt)*(.7+.6*r5),.5);
vCol=mix(u_birthColor,u_deathColor,lt);vCol.a*=u_opacity/100.*(1.-smoothstep(.75,1.,lt))*smoothstep(0.,.04,age);
vVel=length(vel)>1e-3?normalize(vel):vec2(1.,0.);float ps=u_particleType==1?sz*4.:(u_particleType==2?sz*2.:sz);vSz=ps;
gl_PointSize=min(ps+2.,uMaxPt);gl_Position=vec4(pos/uSize*2.-1.,0.,1.);}`;
const PART_FS = `
in vec4 vCol;in float vSz;in vec2 vVel;out vec4 outColor;
void main(){vec2 q=vec2(gl_PointCoord.x,1.-gl_PointCoord.y)*2.-1.;float r=length(q);float a=0.;
if(u_particleType==0)a=exp(-r*r*3.5)*(1.-smoothstep(.85,1.,r));
else if(u_particleType==1){float t=clamp(dot(q,vVel),-.9,.9);float dd=length(q-vVel*t);float w=max(.12,1.5/max(vSz,1.));a=(1.-smoothstep(w*.5,w,dd))*(.35+.65*(t+.9)/1.8);}
else if(u_particleType==2){vec2 aq=abs(q);a=max(exp(-aq.x*10.)*(1.-aq.y),exp(-aq.y*10.)*(1.-aq.x))+exp(-r*r*12.);a=min(a,1.)*(1.-smoothstep(.9,1.,r));}
else{a=smoothstep(.6,.8,r)*(1.-smoothstep(.85,1.,r))*.9+(1.-smoothstep(0.,.3,length(q-vec2(-.35,-.35))))*.6;}
outColor=vec4(vCol.rgb,1.)*vCol.a*clamp(a,0.,1.);}`;
