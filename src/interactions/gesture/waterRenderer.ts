/**
 * WaterRenderer - WebGL water ripple overlay for gesture mode.
 *
 * Renders a LIQUID-style water ripple effect on a transparent canvas,
 * meant to be layered over the main UI. No camera background is used;
 * the ripple color is blended directly over the underlying page.
 *
 * Adapted from ref/water/water_ripple.html.
 */

const VS_QUAD = `
attribute vec2 a_position;
varying vec2 v_uv;
void main(){
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FS_WAVE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform sampler2D u_prev;
uniform sampler2D u_curr;
uniform vec2 u_resolution;
uniform float u_damping;
uniform vec2 u_tips[10];
uniform vec2 u_tipsPrev[10];
uniform float u_tipStrength[10];
uniform int u_tipCount;
vec2 encode(float v){
  v = v * 0.5 + 0.5;
  vec2 enc = vec2(1.0, 255.0) * v;
  enc = fract(enc);
  enc.x -= enc.y / 255.0;
  return enc;
}
float decode(vec2 rg){
  return dot(rg, vec2(1.0, 1.0 / 255.0)) * 2.0 - 1.0;
}
void main(){
  vec2 delta = 1.0 / u_resolution;
  float c = decode(texture2D(u_curr, v_uv).rg);
  float p = decode(texture2D(u_prev, v_uv).rg);
  float n = decode(texture2D(u_curr, v_uv + vec2(0.0, delta.y)).rg);
  float s = decode(texture2D(u_curr, v_uv - vec2(0.0, delta.y)).rg);
  float e = decode(texture2D(u_curr, v_uv + vec2(delta.x, 0.0)).rg);
  float w = decode(texture2D(u_curr, v_uv - vec2(delta.x, 0.0)).rg);
  float ne = decode(texture2D(u_curr, v_uv + vec2(delta.x, delta.y)).rg);
  float nw = decode(texture2D(u_curr, v_uv + vec2(-delta.x, delta.y)).rg);
  float se = decode(texture2D(u_curr, v_uv + vec2(delta.x, -delta.y)).rg);
  float sw = decode(texture2D(u_curr, v_uv + vec2(-delta.x, -delta.y)).rg);
  float lap = (4.0 * (n + s + e + w) + (ne + nw + se + sw) - 20.0 * c) / 6.0;
  float next = 2.0 * c - p + 0.18 * lap;
  next *= u_damping;
  for (int i = 0; i < 10; i++){
    if (i >= u_tipCount) break;
    vec2 a = u_tipsPrev[i] * u_resolution;
    vec2 b = u_tips[i] * u_resolution;
    vec2 px = v_uv * u_resolution;
    vec2 ab = b - a;
    float t = dot(px - a, ab) / max(dot(ab, ab), 0.001);
    t = clamp(t, 0.0, 1.0);
    vec2 nearest = a + ab * t;
    float dist = length(px - nearest);
    if (dist < 26.0){
      next += u_tipStrength[i] * exp(-dist * dist / (2.0 * 6.0 * 6.0));
    }
  }
  next = clamp(next, -1.0, 1.0);
  gl_FragColor = vec4(encode(next), 0.0, 1.0);
}
`;

const FS_RENDER_OVERLAY = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform sampler2D u_bg;
uniform sampler2D u_height;
uniform vec2 u_simRes;
uniform vec2 u_resolution;
uniform vec2 u_bgRes;
uniform float u_time;
float decode(vec2 rg){
  return dot(rg, vec2(1.0, 1.0 / 255.0)) * 2.0 - 1.0;
}
void main(){
  vec2 hDelta = 1.0 / u_simRes;
  float h = decode(texture2D(u_height, v_uv).rg);
  float hn = decode(texture2D(u_height, v_uv + vec2(0.0, hDelta.y)).rg);
  float hs = decode(texture2D(u_height, v_uv - vec2(0.0, hDelta.y)).rg);
  float he = decode(texture2D(u_height, v_uv + vec2(hDelta.x, 0.0)).rg);
  float hw = decode(texture2D(u_height, v_uv - vec2(hDelta.x, 0.0)).rg);
  vec2 grad = vec2(he - hw, hn - hs) * 80.0;
  vec3 normal = normalize(vec3(-grad.x, -grad.y, 1.0));

  // LIQUID style constants
  float refraction = 0.035;
  float dispersion = 0.003;
  vec3 overlay = vec3(0.0, 0.14, 0.22);
  vec3 tint = vec3(1.0, 0.995, 0.985);
  vec3 peakTint = vec3(1.0, 1.0, 1.0);
  float specInt = 0.42;
  float shininess = 36.0;
  float vignette = 0.35;
  float dispFactor = smoothstep(0.0, 0.35, length(grad));

  float slope = length(grad);

  // Background UV: cover-fit the snapshot texture to the screen.
  // html2canvas captures the DOM with Y pointing down, matching WebGL's texture
  // storage, but v_uv has Y pointing up. Flip v vertically when sampling.
  float screenAspect = u_resolution.x / max(u_resolution.y, 1.0);
  float bgAspect = u_bgRes.x / max(u_bgRes.y, 1.0);
  vec2 scale = vec2(max(screenAspect / bgAspect, 1.0), max(bgAspect / screenAspect, 1.0));
  vec2 bgUV = (vec2(v_uv.x, 1.0 - v_uv.y) - 0.5) * scale + 0.5;

  float actualDisp = dispersion * dispFactor;
  vec2 rUV = bgUV - grad * refraction;
  vec2 gUV = bgUV - grad * (refraction + actualDisp * 0.25);
  vec2 bUV = bgUV - grad * (refraction + actualDisp);
  vec3 bg = vec3(texture2D(u_bg, rUV).r, texture2D(u_bg, gUV).g, texture2D(u_bg, bUV).b);

  vec3 view = vec3(0.0, 0.0, 1.0);
  float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
  vec3 color = mix(bg, overlay, fresnel * 0.28);
  vec3 light = normalize(vec3(0.3, 0.3, 1.0));
  vec3 R = reflect(-light, normal);
  float spec = pow(max(dot(R, view), 0.0), shininess) * specInt;
  color += vec3(spec);
  color += smoothstep(0.32, 0.58, h) * vec3(0.12) * peakTint;
  color *= tint;

  float v = 1.0 - smoothstep(0.5, 1.5, length(v_uv - 0.5) * 2.0);
  color = mix(color, color * v, vignette);

  // Slight alpha reduction where there is no ripple so the original UI can breathe
  float alpha = 0.92 + smoothstep(0.02, 0.18, abs(h)) * 0.08 + smoothstep(0.0, 0.45, slope) * 0.05;
  alpha = clamp(alpha, 0.0, 1.0);

  gl_FragColor = vec4(color, alpha);
}
`;

const MAX_TIPS = 10;

interface Tip {
  id: string;
  x: number;
  y: number;
  px: number;
  py: number;
  strength: number;
}

export class WaterRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;

  private programUpdate: WebGLProgram | null = null;
  private programRender: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;

  private fbo: WebGLFramebuffer[] = [];
  private tex: WebGLTexture[] = [];
  private currIndex = 0;
  private prevIndex = 1;
  private writeIndex = 2;

  private simW = 512;
  private simH = 512;

  private activeTips: Tip[] = [];
  private prevTips: Tip[] = [];
  private extraInjections: Array<{ x: number; y: number; strength: number }> = [];

  private bgTexture: WebGLTexture | null = null;
  private bgWidth = 1;
  private bgHeight = 1;

  private disposed = false;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.init();
  }

  private init(): void {
    const gl = this.canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    if (!gl) {
      throw new Error("WebGL not supported for water renderer.");
    }
    this.gl = gl;

    this.programUpdate = this.createProgram(VS_QUAD, FS_WAVE);
    this.programRender = this.createProgram(VS_QUAD, FS_RENDER_OVERLAY);
    if (!this.programUpdate || !this.programRender) {
      throw new Error("Failed to compile water shaders.");
    }

    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    this.bgTexture = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

    this.resize(this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight);
  }

  private createShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const name = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
      console.error(`Water ${name} shader compile error:`, gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private createProgram(vsSrc: string, fsSrc: string): WebGLProgram | null {
    const gl = this.gl!;
    const vs = this.createShader(gl.VERTEX_SHADER, vsSrc);
    const fs = this.createShader(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Water program link error:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;

    const gl = this.gl!;
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;

    const aspect = width / Math.max(height, 1);
    this.simW = Math.max(64, Math.round(512 * this.dpr * aspect));
    this.simH = Math.round(512 * this.dpr);

    this.initFBOs();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private initFBOs(): void {
    const gl = this.gl!;

    // Clean up previous FBOs/textures
    this.fbo.forEach((fbo) => fbo && gl.deleteFramebuffer(fbo));
    this.tex.forEach((tex) => tex && gl.deleteTexture(tex));
    this.fbo = [];
    this.tex = [];

    for (let i = 0; i < 3; i++) {
      const tex = this.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.simW, this.simH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("Water FBO creation failed");
      }
      gl.clearColor(0.5, 0.5, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      this.tex.push(tex);
      this.fbo.push(fbo);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.currIndex = 0;
    this.prevIndex = 1;
    this.writeIndex = 2;
  }

  /**
   * Set the background snapshot texture from a canvas, image, or image bitmap.
   * This snapshot should cover the whole screen and is used for refraction.
   */
  setBackground(source: HTMLCanvasElement | HTMLImageElement | ImageBitmap): void {
    const gl = this.gl;
    if (!gl || !this.bgTexture) return;

    this.bgWidth = source.width || 1;
    this.bgHeight = source.height || 1;

    gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
  }

  /**
   * Update the active tip list. Each tip should be in normalized [0,1] UV coords.
   * The renderer tracks previous positions internally to compute velocity-based
   * ripple strength.
   */
  setTips(tips: Array<{ id: string; x: number; y: number }>): void {
    const nextTips: Tip[] = [];

    for (const tip of tips) {
      const prev = this.prevTips.find((p) => p.id === tip.id);
      let strength = 0.0;
      let px = tip.x;
      let py = tip.y;

      if (prev) {
        const dx = tip.x - prev.x;
        const dy = tip.y - prev.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.0015) {
          strength = 0.030 * Math.min(d / 0.008, 2.0);
          px = prev.x;
          py = prev.y;
        }
      } else {
        strength = 0.030;
      }

      nextTips.push({
        id: tip.id,
        x: tip.x,
        y: tip.y,
        px,
        py,
        strength,
      });
    }

    this.activeTips = nextTips;
    this.prevTips = nextTips.map((t) => ({ id: t.id, x: t.x, y: t.y, px: t.px, py: t.py, strength: 0 }));
  }

  /**
   * Inject a ripple at a specific normalized position. Used for continuous
   * feedback from the currently selected macro control point.
   */
  injectRipple(x: number, y: number, strength: number): void {
    this.extraInjections.push({ x: clamp01(x), y: clamp01(y), strength });
  }

  private updateSimulation(): void {
    const gl = this.gl!;
    const next = this.writeIndex;

    gl.useProgram(this.programUpdate);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[next]);
    gl.viewport(0, 0, this.simW, this.simH);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.currIndex]);
    gl.uniform1i(gl.getUniformLocation(this.programUpdate, "u_curr"), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.prevIndex]);
    gl.uniform1i(gl.getUniformLocation(this.programUpdate, "u_prev"), 1);

    gl.uniform2f(gl.getUniformLocation(this.programUpdate, "u_resolution"), this.simW, this.simH);
    gl.uniform1f(gl.getUniformLocation(this.programUpdate, "u_damping"), 0.985);

    const tipArr = new Float32Array(MAX_TIPS * 2);
    const tipPrevArr = new Float32Array(MAX_TIPS * 2);
    const strArr = new Float32Array(MAX_TIPS);

    const allTips: Tip[] = [...this.activeTips];
    for (const inj of this.extraInjections) {
      allTips.push({
        id: `inject_${Math.random()}`,
        x: inj.x,
        y: inj.y,
        px: inj.x,
        py: inj.y,
        strength: inj.strength,
      });
    }

    const count = Math.min(allTips.length, MAX_TIPS);
    for (let i = 0; i < count; i++) {
      const tip = allTips[i];
      tipArr[i * 2] = tip.x;
      tipArr[i * 2 + 1] = tip.y;
      tipPrevArr[i * 2] = tip.px;
      tipPrevArr[i * 2 + 1] = tip.py;
      strArr[i] = tip.strength;
    }

    gl.uniform2fv(gl.getUniformLocation(this.programUpdate, "u_tips"), tipArr);
    gl.uniform2fv(gl.getUniformLocation(this.programUpdate, "u_tipsPrev"), tipPrevArr);
    gl.uniform1fv(gl.getUniformLocation(this.programUpdate, "u_tipStrength"), strArr);
    gl.uniform1i(gl.getUniformLocation(this.programUpdate, "u_tipCount"), count);

    this.bindQuad(this.programUpdate);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    this.writeIndex = this.prevIndex;
    this.prevIndex = this.currIndex;
    this.currIndex = next;

    // Reset one-shot injections
    this.extraInjections = [];
    for (const tip of this.activeTips) {
      tip.strength = 0;
    }
  }

  private renderScreen(): void {
    const gl = this.gl!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.useProgram(this.programRender);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.currIndex]);
    gl.uniform1i(gl.getUniformLocation(this.programRender, "u_height"), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
    gl.uniform1i(gl.getUniformLocation(this.programRender, "u_bg"), 1);

    gl.uniform2f(gl.getUniformLocation(this.programRender, "u_simRes"), this.simW, this.simH);
    gl.uniform2f(gl.getUniformLocation(this.programRender, "u_resolution"), this.canvas.width, this.canvas.height);
    gl.uniform2f(gl.getUniformLocation(this.programRender, "u_bgRes"), this.bgWidth, this.bgHeight);
    gl.uniform1f(gl.getUniformLocation(this.programRender, "u_time"), performance.now() * 0.001);

    this.bindQuad(this.programRender);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private bindQuad(program: WebGLProgram): void {
    const gl = this.gl!;
    const loc = gl.getAttribLocation(program, "a_position");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  render(): void {
    if (this.disposed || !this.gl) return;
    this.updateSimulation();
    this.renderScreen();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    if (!gl) return;

    this.fbo.forEach((fbo) => fbo && gl.deleteFramebuffer(fbo));
    this.tex.forEach((tex) => tex && gl.deleteTexture(tex));
    if (this.bgTexture) gl.deleteTexture(this.bgTexture);
    gl.deleteBuffer(this.positionBuffer);
    if (this.programUpdate) gl.deleteProgram(this.programUpdate);
    if (this.programRender) gl.deleteProgram(this.programRender);
    this.gl = null;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
