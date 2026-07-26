/* The Living Land — living photographs.
 *
 * Each piece composites real timelapse footage (Adobe Stock, licensed) behind
 * a Photoshop-API sky matte, over a still photograph. Water breathes via a
 * lake matte and shader displacement. Fractions are measured from the TOP of
 * the image. ?debug draws the guides.
 */

const LOOP_MS = 16000;
const QUERY = new URLSearchParams(location.search);
const DEBUG = QUERY.has("debug");
const VERIFY = QUERY.has("verify");
const REDUCED = QUERY.has("reduce") || matchMedia("(prefers-reduced-motion: reduce)").matches;
if (REDUCED) document.documentElement.classList.add("reduced-motion");

const PIECES = {
  charyn: {
    skyVideo: "video/charyn-sky-v2.mp4", skyBand: 0.40,
    skyVideoMobile: "video/charyn-sky-v2-1280.mp4",
    skyMask: "masks/charyn-sky-refined.png", maskCurve: [0.08, 0.55],
    /* Lift the source cirrus toward the photograph without clipping it to white. */
    grade: { desat: 0.94, gamma: [0.61, 0.61, 0.61], gain: [1.44, 1.45, 1.46], lift: [0.10, 0.10, 0.105] },
    grain: 0.012,
  },
  kaindy: {
    waterMask: "masks/kaindy-water-refined.png", water: 0.82, waterGlint: 0.42, waterYMin: 0.28,
    mist: 0.24, mistY: 0.30,
  },
  bozzhyra: {
    skyVideo: "video/bozzhyra-sky-v2.mp4", skyBand: 0.68,
    skyVideoMobile: "video/bozzhyra-sky-v2-1280.mp4",
    skyMask: "masks/bozzhyra-sky-refined.png", maskCurve: [0.32, 0.76],
    grade: { desat: 0.16, gamma: [1.0, 1.01, 1.04], gain: [1.04, 1.0, 0.92], lift: [0, 0, 0] },
  },
  kolsai: {
    /* The owner-supplied animation now contributes only sky; terrain stays photographic. */
    skyVideo: "video/kolsai-sky-v2.mp4", skyBand: 1,
    skyVideoMobile: "video/kolsai-sky-v2-1280.mp4",
    skyMask: "masks/kolsai-sky-refined.png", maskCurve: [0.34, 0.78],
    grade: { desat: 0.04, gamma: [1, 1, 1], gain: [1, 1.01, 1.01], lift: [0, 0, 0] },
    grain: 0.006,
  },
  tuzbair: {
    skyVideo: "video/tuzbair-sky-v2.mp4", skyBand: 0.60,
    skyVideoMobile: "video/tuzbair-sky-v2-1280.mp4",
    skyMask: "masks/tuzbair-sky-refined.png", maskCurve: [0.38, 0.80],
    grade: { desat: 0.32, gamma: [1.02, 1.0, 0.98], gain: [1.02, 1.0, 0.96], lift: [0, 0, 0] },
    sweep: 0.5,
  },
  bao: {
    skyVideo: "video/bao-sky-v2.mp4", skyBand: 0.58,
    skyVideoMobile: "video/bao-sky-v2-1280.mp4",
    skyMask: "masks/bao-sky-refined.png", maskCurve: [0.10, 0.58], grain: 0.009,
    grade: { desat: 0.14, gamma: [0.92, 0.90, 0.88], gain: [0.88, 0.96, 1.08], lift: [0.0, 0.008, 0.018] },
    waterMask: "masks/bao-water-refined.png", water: 0.30, waterGlint: 0.08, waterYMin: 0.82,
  },
};

/* ------------------------------------------------------------------ */
/* shaders                                                             */
/* ------------------------------------------------------------------ */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex, uSkyMask, uWaterMask, uSkyVid;
uniform float uHasSkyVid, uHasWater;
uniform float uSkyBand, uWaterYMin, uWaterAmp, uWaterGlint;
uniform vec3 uGain, uLift, uGamma;
uniform float uDesat, uMist, uMistY, uSweep, uPhase, uAspect;
uniform vec2 uTexel;
uniform vec2 uMaskCurve;  /* smoothstep lo/hi for the sky matte edge */
uniform float uGrain;     /* film grain amount */
uniform float uGrainSeed; /* changes ~24x/sec */

#define TAU 6.283185307179586

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + 17.31;
    a *= 0.5;
  }
  return v;
}

/* soft 4-tap mask fetch; radius grows toward the horizon for a wider blend */
float maskSoft(sampler2D m, vec2 uv, float r) {
  vec2 o = uTexel * r;
  return (texture2D(m, uv + o).r + texture2D(m, uv - o).r
        + texture2D(m, uv + vec2(o.x, -o.y)).r + texture2D(m, uv + vec2(-o.x, o.y)).r) * 0.25;
}

void main() {
  vec2 uv = vUv;
  float yT = 1.0 - uv.y;
  vec3 base = texture2D(uTex, uv).rgb;
  vec3 col = base;
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  vec2 loopVec = vec2(cos(uPhase * TAU), sin(uPhase * TAU));

  /* ---- real-footage sky behind the matte ---- */
  if (uHasSkyVid > 0.5) {
    float feather = mix(1.4, 4.5, clamp(yT / max(uSkyBand, 0.001), 0.0, 1.0));
    float m = smoothstep(uMaskCurve.x, uMaskCurve.y, maskSoft(uSkyMask, uv, feather));
    if (m > 0.003) {
      vec2 vuv = vec2(uv.x, 1.0 - clamp(yT / uSkyBand, 0.0, 1.0));
      vec3 v = texture2D(uSkyVid, vuv).rgb;
      float vl = dot(v, vec3(0.299, 0.587, 0.114));
      v = mix(v, vec3(vl), uDesat);
      v = pow(max(v, vec3(0.0)), uGamma) * uGain + uLift;
      col = mix(col, v, m);
    }
  }

  /* ---- water breathing inside the lake matte ---- */
  if (uHasWater > 0.5) {
    float wm = maskSoft(uWaterMask, uv, 1.6);
    wm *= smoothstep(uWaterYMin, uWaterYMin + 0.03, yT);
    if (wm > 0.003) {
      float depth = smoothstep(uWaterYMin, min(1.0, uWaterYMin + 0.62), yT);
      float amp = mix(0.18, 1.0, depth) * uWaterAmp * wm;
      float p1 = sin(uv.x * 112.0 + yT * 38.0 + uPhase * TAU * 2.0);
      float p2 = sin((uv.x * 0.75 + yT * 0.25) * 74.0 - uPhase * TAU * 3.0);
      float p3 = noise(vec2(uv.x * 26.0 * uAspect, yT * 34.0) + loopVec * 0.65) - 0.5;
      vec2 woff = vec2((p1 * 0.65 + p2 * 0.35 + p3 * 0.4) * 0.0020,
                       (p2 - p1) * 0.00045) * amp;
      float wm2 = maskSoft(uWaterMask, uv + woff, 1.6);
      col = mix(col, texture2D(uTex, uv + woff).rgb, wm * wm2);
      float sparkle = noise(uv * vec2(220.0 * uAspect, 300.0) + loopVec * 1.8);
      float glint = smoothstep(0.82, 0.97, sparkle);
      col += vec3(1.0, 0.96, 0.82) * glint * 0.055 * uWaterGlint
           * wm * depth * smoothstep(0.25, 0.78, lum);
    }
  }

  /* ---- slow mist around the ridge ---- */
  if (uMist > 0.001) {
    float bandM = exp(-pow((yT - uMistY) / 0.09, 2.0));
    float m = fbm(uv * vec2(3.5 * uAspect, 2.2) + loopVec * 0.5);
    col += vec3(0.82, 0.88, 0.95) * smoothstep(0.38, 0.85, m) * bandM * uMist * 0.16;
  }

  /* ---- travelling sunlight ---- */
  if (uSweep > 0.001) {
    float s = sin(TAU * (uPhase - uv.x * 0.35 - yT * 0.1));
    col *= 1.0 + uSweep * 0.05 * s;
  }

  /* film grain — shared by photo and footage, ties the composite together */
  if (uGrain > 0.0005) {
    float gLum = dot(col, vec3(0.299, 0.587, 0.114));
    float gn = hash(gl_FragCoord.xy * 0.754 + vec2(uGrainSeed * 13.7, uGrainSeed * 7.3)) - 0.5;
    float weight = mix(0.55, 1.0, smoothstep(0.04, 0.35, gLum)) * (1.0 - 0.5 * smoothstep(0.85, 1.0, gLum));
    col += gn * uGrain * weight;
  }

  /* vignette */
  vec2 d = (uv - 0.5) * vec2(1.12, 1.0);
  col *= 1.0 - 0.13 * smoothstep(0.42, 1.0, length(d) * 1.35);

  gl_FragColor = vec4(col, 1.0);
}`;

/* ------------------------------------------------------------------ */
/* a living photograph                                                 */
/* ------------------------------------------------------------------ */

class Piece {
  constructor(fig, cfg) {
    this.fig = fig;
    this.cfg = cfg;
    this.stack = fig.querySelector(".stack");
    this.poster = fig.querySelector(".poster");
    this.visible = false;
    this.started = false;
    this.ready = false;
    this.gl = null;
    this.videos = [];
    this.pendingMasks = 0;
    this.masksReady = false;
    this.videoFrameReady = !(cfg.skyVideo || cfg.skyVideoMobile);
    this.failed = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    const img = new Image();
    const once = () => {
      if (this.gl) return;
      try {
        this.initGL(img);
      } catch (e) {
        console.error("living-land init failed:", e);
      }
    };
    img.onload = () => {
      /* decode() avoids upload jank but can stall in throttled tabs — race it */
      if (img.decode) {
        img.decode().then(once, once);
        setTimeout(once, 300);
      } else once();
    };
    img.src = this.poster.currentSrc || this.poster.src;
    if (img.complete) img.onload();
  }

  makeVideo(src) {
    const v = document.createElement("video");
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.crossOrigin = "anonymous";
    v.preload = "metadata";
    v.src = src;
    v._textureInitialized = false;
    v._lastUploadedTime = -1;
    this.videos.push(v);
    return v;
  }

  loadTexture(unit, source, done) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (source) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
      if (done) done();
    } else {
      /* 1x1 placeholder until video frames arrive */
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE,
                    new Uint8Array([0, 255, 0]));
    }
    return tex;
  }

  initGL(img) {
    const c = this.cfg;
    const glCanvas = document.createElement("canvas");
    glCanvas.className = "gl";
    glCanvas.setAttribute("aria-hidden", "true");
    const fxCanvas = DEBUG ? document.createElement("canvas") : null;
    if (fxCanvas) {
      fxCanvas.className = "fx";
      fxCanvas.setAttribute("aria-hidden", "true");
    }
    const gl = glCanvas.getContext("webgl", {
      preserveDrawingBuffer: VERIFY,
      antialias: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      this.failed = true;
      return;
    }
    glCanvas.addEventListener("webglcontextlost", () => {
      this.failed = true;
      this.ready = false;
      this.stack.classList.remove("ready");
      this.pause();
      this.gl = null;
    }, { once: true });

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.gl = gl;
    this.glCanvas = glCanvas;
    this.fxCanvas = fxCanvas;
    this.fx = fxCanvas?.getContext("2d") ?? null;

    const u = (n) => gl.getUniformLocation(prog, n);
    /* photo */
    this.loadTexture(0, img);
    gl.uniform1i(u("uTex"), 0);
    gl.uniform2f(u("uTexel"), 1 / img.naturalWidth, 1 / img.naturalHeight);
    gl.uniform1f(u("uAspect"), img.naturalWidth / img.naturalHeight);

    /* masks (async) */
    this.pendingMasks = [c.skyMask, c.waterMask].filter(Boolean).length;
    this.masksReady = this.pendingMasks === 0;
    const loadMask = (unit, src, uniform) => {
      gl.uniform1i(u(uniform), unit);
      this.loadTexture(unit, null);
      const m = new Image();
      let settled = false;
      const complete = () => {
        if (settled) return;
        settled = true;
        this.pendingMasks -= 1;
        this.masksReady = this.pendingMasks === 0;
        this.markReady();
      };
      m.onload = () => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, m);
        complete();
      };
      m.onerror = () => {
        console.warn(`living-land mask failed: ${src}`);
        complete();
      };
      m.src = src;
    };
    if (c.skyMask) loadMask(1, c.skyMask, "uSkyMask");
    if (c.waterMask) loadMask(2, c.waterMask, "uWaterMask");

    /* videos */
    this.skySource = matchMedia("(max-width: 700px)").matches && c.skyVideoMobile
      ? c.skyVideoMobile
      : c.skyVideo;
    gl.uniform1i(u("uSkyVid"), 3);
    if (this.skySource) {
      this.skyVid = this.makeVideo(this.skySource);
      this.skyTex = this.loadTexture(3, null);
    } else {
      this.loadTexture(3, null);
    }

    const g = c.grade || {};
    gl.uniform1f(u("uHasSkyVid"), this.skySource ? 1 : 0);
    gl.uniform1f(u("uHasWater"), c.waterMask ? 1 : 0);
    gl.uniform1f(u("uSkyBand"), c.skyBand ?? 0.5);
    gl.uniform1f(u("uWaterYMin"), c.waterYMin ?? 0);
    gl.uniform1f(u("uWaterAmp"), c.water ?? 0);
    gl.uniform1f(u("uWaterGlint"), c.waterGlint ?? 0);
    gl.uniform3fv(u("uGain"), g.gain ?? [1, 1, 1]);
    gl.uniform3fv(u("uLift"), g.lift ?? [0, 0, 0]);
    gl.uniform3fv(u("uGamma"), g.gamma ?? [1, 1, 1]);
    gl.uniform1f(u("uDesat"), g.desat ?? 0);
    gl.uniform1f(u("uMist"), c.mist ?? 0);
    gl.uniform1f(u("uMistY"), c.mistY ?? 0.3);
    gl.uniform1f(u("uSweep"), c.sweep ?? 0);
    /* dilated default pulls the video right up to each silhouette */
    const mc = c.maskCurve ?? [0.14, 0.55];
    gl.uniform2f(u("uMaskCurve"), mc[0], mc[1]);
    gl.uniform1f(u("uGrain"), c.grain ?? 0.016);
    this.uPhase = u("uPhase");
    this.uGrainSeed = u("uGrainSeed");
    this.prog = prog;

    this.stack.append(glCanvas);
    if (fxCanvas) this.stack.append(fxCanvas);
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stack);

    if (this.visible) this.play();
    this.draw(performance.now());
    this.markReady();
  }

  markReady() {
    if (this.ready || this.failed || !this.masksReady || !this.videoFrameReady) return;
    this.ready = true;
    this.stack.classList.add("ready");
  }

  play() {
    this.videos.forEach((v) => v.play().catch(() => {}));
  }
  pause() {
    this.videos.forEach((v) => v.pause());
  }

  uploadVideoFrame(unit, video) {
    if (!video || video.readyState < 2) return false;
    const gl = this.gl;
    if (video._textureInitialized && video._lastUploadedTime === video.currentTime) return true;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (video._textureInitialized) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, video);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      video._textureInitialized = true;
    }
    video._lastUploadedTime = video.currentTime;
    return true;
  }

  resize() {
    if (!this.gl || this.failed) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(this.stack.clientWidth * dpr);
    const h = Math.round(this.stack.clientHeight * dpr);
    if (!w || !h) return;
    for (const cv of [this.glCanvas, this.fxCanvas].filter(Boolean)) {
      if (cv.width !== w) cv.width = w;
      if (cv.height !== h) cv.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  draw(now) {
    const gl = this.gl;
    if (!gl || this.failed) return;
    if (this.skyVid && this.uploadVideoFrame(3, this.skyVid)) {
      this.videoFrameReady = true;
      this.markReady();
    }
    gl.uniform1f(this.uPhase, (now % LOOP_MS) / LOOP_MS);
    /* grain re-rolls at ~24 fps for a filmic cadence */
    gl.uniform1f(this.uGrainSeed, Math.floor(now / 41.7) % 977);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (DEBUG) this.drawDebug();
  }

  drawDebug() {
    const ctx = this.fx, w = this.fxCanvas.width, h = this.fxCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const c = this.cfg;
    const line = (frac, color, label) => {
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, frac * h); ctx.lineTo(w, frac * h); ctx.stroke();
      ctx.font = `${Math.round(h / 45)}px monospace`;
      ctx.fillText(`${label} ${frac}`, 12, frac * h - 8);
    };
    if (c.skyBand) line(c.skyBand, "rgba(255,120,80,0.9)", "skyBand");
    if (c.waterYMin) line(c.waterYMin, "rgba(80,220,255,0.9)", "waterYMin");
  }
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

const pieces = [];
for (const fig of document.querySelectorAll(".piece")) {
  const cfg = PIECES[fig.dataset.piece];
  if (cfg) pieces.push(new Piece(fig, cfg));
}

/* fullscreen lightbox */
const html = document.documentElement;
let expanded = null;
let restoreFocus = null;
const pieceName = (p) => p.fig.querySelector("h2").textContent;
const resetExpandedPiece = (p) => {
  p.lightboxActive = false;
  p.fig.classList.remove("expanded");
  const frame = p.fig.querySelector(".frame");
  frame.removeAttribute("role");
  frame.removeAttribute("aria-modal");
  frame.removeAttribute("aria-label");
  p.control.setAttribute("aria-expanded", "false");
  p.control.setAttribute("aria-label", `Open ${pieceName(p)} fullscreen`);
  p.control.title = "View fullscreen";
  p.control.querySelector("span").textContent = "⛶";
  if (!p.visible) p.pause();
};
const setBackgroundInert = (active, current = null) => {
  const set = (el, value) => {
    if (value) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  };
  set(document.querySelector(".hero"), active);
  set(document.querySelector("footer"), active);
  pieces.forEach((p) => set(p.fig, active && p !== current));
};
const collapse = () => {
  if (!expanded) return;
  resetExpandedPiece(expanded);
  setBackgroundInert(false);
  html.classList.remove("lightbox");
  expanded = null;
  restoreFocus?.focus();
  restoreFocus = null;
};

const expand = (p, source) => {
  if (expanded === p) return;
  if (expanded) {
    resetExpandedPiece(expanded);
  } else {
    restoreFocus = source;
  }
  expanded = p;
  setBackgroundInert(true, p);
  p.lightboxActive = true;
  const frame = p.fig.querySelector(".frame");
  frame.setAttribute("role", "dialog");
  frame.setAttribute("aria-modal", "true");
  frame.setAttribute("aria-label", `${pieceName(p)} living portrait`);
  p.control.setAttribute("aria-expanded", "true");
  p.control.setAttribute("aria-label", "Close fullscreen portrait");
  p.control.title = "Close fullscreen";
  p.control.querySelector("span").textContent = "×";
  p.fig.classList.add("expanded");
  html.classList.add("lightbox");
  if (!REDUCED) {
    p.start();
    if (p.gl) p.play();
  }
  p.control.focus();
};

const moveExpanded = (delta) => {
  if (!expanded) return;
  const i = pieces.indexOf(expanded);
  expand(pieces[(i + delta + pieces.length) % pieces.length], expanded.control);
};

for (const [i, p] of pieces.entries()) {
  const frame = p.fig.querySelector(".frame");
  const control = document.createElement("button");
  control.className = "expand-control";
  control.type = "button";
  control.title = "View fullscreen";
  control.setAttribute("aria-label", `Open ${pieceName(p)} fullscreen`);
  control.setAttribute("aria-expanded", "false");
  control.innerHTML = '<span aria-hidden="true">⛶</span>';
  p.control = control;

  const prev = document.createElement("button");
  prev.className = "lightbox-nav prev";
  prev.type = "button";
  prev.title = "Previous landscape";
  prev.setAttribute("aria-label", `Previous: ${pieceName(pieces[(i - 1 + pieces.length) % pieces.length])}`);
  prev.textContent = "‹";

  const next = document.createElement("button");
  next.className = "lightbox-nav next";
  next.type = "button";
  next.title = "Next landscape";
  next.setAttribute("aria-label", `Next: ${pieceName(pieces[(i + 1) % pieces.length])}`);
  next.textContent = "›";

  control.addEventListener("click", (e) => {
    e.stopPropagation();
    if (expanded === p) collapse();
    else expand(p, control);
  });
  prev.addEventListener("click", (e) => {
    e.stopPropagation();
    moveExpanded(-1);
  });
  next.addEventListener("click", (e) => {
    e.stopPropagation();
    moveExpanded(1);
  });
  frame.append(control, prev, next);
  frame.addEventListener("click", () => {
    if (expanded === p) collapse();
    else expand(p, control);
  });
}
addEventListener("keydown", (e) => {
  if (e.key === "Escape") collapse();
  if (e.key === "ArrowLeft") moveExpanded(-1);
  if (e.key === "ArrowRight") moveExpanded(1);
});

const reveal = new IntersectionObserver(
  (entries) => entries.forEach((e) => {
    if (e.isIntersecting) e.target.classList.add("in");
  }),
  { threshold: 0.12 }
);
document.querySelectorAll(".piece").forEach((f) => reveal.observe(f));

if (!REDUCED) {
  const watch = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        const p = pieces.find((p) => p.fig === e.target);
        if (!p) return;
        const was = p.visible;
        p.visible = e.isIntersecting;
        if (e.isIntersecting) {
          p.start();
          if (p.gl && !was) p.play();
        } else if (was && p.gl) {
          p.pause();
        }
      }),
    { rootMargin: "220px" }
  );
  pieces.forEach((p) => watch.observe(p.fig));

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pieces.forEach((p) => p.pause());
      return;
    }
    const live = expanded ? [expanded] : pieces;
    live.forEach((p) => {
      if (p.visible || p === expanded) p.play();
    });
  });

  const frameMs = 1000 / 30;
  let lastFrame = -frameMs;
  const tick = (now) => {
    if (!document.hidden && now - lastFrame >= frameMs) {
      lastFrame = now;
      /* while a portrait is expanded, everything else is hidden behind it */
      const live = expanded ? [expanded] : pieces;
      for (const p of live) if (p.visible || p === expanded) p.draw(now);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
