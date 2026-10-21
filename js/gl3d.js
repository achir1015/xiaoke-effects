// 3D 圖層：把圖層畫成 3D 空間中的一張卡片（透視投影＋燈光），再疊回 2D 合成畫面
let gl = null, prog = null, tex = null, vbo = null, cv = null, failed = false;
const VS = `#version 300 es
in vec2 aPos; in vec2 aUv;
uniform mat4 uModel, uView; uniform vec2 uHalf; uniform float uZoom;
out vec2 vUv; out vec3 vWorld;
void main() {
  vec4 w = uModel * vec4(aPos, 0.0, 1.0);
  vec4 c = uView * w;
  vWorld = w.xyz / w.w; vUv = aUv;
  float n = 1.0, f = 1000000.0;
  gl_Position = vec4(c.x * uZoom / uHalf.x, -c.y * uZoom / uHalf.y, c.z * (f + n) / (f - n) - 2.0 * f * n / (f - n), c.z);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vWorld; uniform sampler2D uTex; uniform float uOpacity;
uniform int uNL; uniform vec4 uLPos[4]; uniform vec3 uLCol[4]; uniform vec4 uLDir[4]; uniform vec3 uNormal; uniform float uAmbient; uniform int uLit;
out vec4 o;
void main() {
  vec4 c = texture(uTex, vUv);
  if (uLit == 1) {
    vec3 L = vec3(uAmbient);
    for (int i = 0; i < 4; i++) {
      if (i >= uNL) break;
      vec3 d = uLPos[i].w > 0.5 ? normalize(uLPos[i].xyz - vWorld) : normalize(-uLDir[i].xyz);
      float k = abs(dot(uNormal, d));
      if (uLDir[i].w > 0.0) { // 聚光燈：錐角
        float cs = dot(-d, normalize(uLDir[i].xyz));
        k *= smoothstep(uLDir[i].w, uLDir[i].w + 0.08, cs);
      }
      L += uLCol[i] * k;
    }
    c.rgb *= L;
  }
  o = c * uOpacity;
}`;

function init() {
  if (gl || failed) return !!gl;
  try {
    cv = document.createElement('canvas');
    gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('no webgl2');
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    vbo = gl.createBuffer();
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; failed = false; });
    return true;
  } catch (e) { console.warn('3D', e); failed = true; gl = null; return false; }
}
export const gl3dAvailable = () => init();

// src：{ canvas, ox, oy, s }（圖層座標 → 畫布像素 = (x-ox)*s）
// cam：{ view, zoom, cw, ch }；model：圖層座標 → 世界座標的 4x4；lights：[{ kind, pos, dir, color:[r,g,b], intensity, cone }]
// 回傳一張和輸出同大小、已畫好這個圖層的畫布（下次呼叫前有效）
export function render3D(src, model, cam, outW, outH, opacity, lights) {
  if (!init()) return null;
  if (cv.width !== outW || cv.height !== outH) { cv.width = outW; cv.height = outH; }
  gl.viewport(0, 0, outW, outH);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(prog);
  const sw = src.canvas.videoWidth || src.canvas.naturalWidth || src.canvas.width, sh = src.canvas.videoHeight || src.canvas.naturalHeight || src.canvas.height;
  const w = sw / src.s, h = sh / src.s, x0 = src.ox, y0 = src.oy;
  const data = new Float32Array([x0, y0, 0, 0, x0 + w, y0, 1, 0, x0, y0 + h, 0, 1, x0 + w, y0 + h, 1, 1]);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos'), aUv = gl.getAttribLocation(prog, 'aUv');
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.canvas);
  const U = n => gl.getUniformLocation(prog, n);
  gl.uniformMatrix4fv(U('uModel'), false, new Float32Array(model));
  gl.uniformMatrix4fv(U('uView'), false, new Float32Array(cam.view));
  gl.uniform2f(U('uHalf'), cam.cw / 2, cam.ch / 2);
  gl.uniform1f(U('uZoom'), cam.zoom);
  gl.uniform1f(U('uOpacity'), opacity);
  gl.uniform1i(U('uTex'), 0);
  const L = (lights || []).filter(l => l.kind !== 'ambient').slice(0, 4);
  const amb = (lights || []).filter(l => l.kind === 'ambient').reduce((s, l) => s + l.intensity, 0);
  gl.uniform1i(U('uLit'), lights && lights.length ? 1 : 0);
  gl.uniform1i(U('uNL'), L.length);
  gl.uniform1f(U('uAmbient'), amb);
  // 法向量：圖層的 -z 方向（面向預設鏡頭）
  const nx = -model[8], ny = -model[9], nz = -model[10], nl = Math.hypot(nx, ny, nz) || 1;
  gl.uniform3f(U('uNormal'), nx / nl, ny / nl, nz / nl);
  const pos = new Float32Array(16), col = new Float32Array(12), dir = new Float32Array(16);
  L.forEach((l, i) => {
    pos.set([l.pos[0], l.pos[1], l.pos[2], l.kind === 'parallel' ? 0 : 1], i * 4);
    col.set(l.color.slice(0, 3).map(c => c * l.intensity), i * 3);
    dir.set([l.dir[0], l.dir[1], l.dir[2], l.kind === 'spot' ? Math.cos(l.cone / 2 * Math.PI / 180) : 0], i * 4);
  });
  gl.uniform4fv(U('uLPos'), pos); gl.uniform3fv(U('uLCol'), col); gl.uniform4fv(U('uLDir'), dir);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return cv;
}
