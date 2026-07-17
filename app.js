/* The Living Land — WebGL living photographs.
 *
 * Each piece is a single JPEG animated in a fragment shader. All motion is
 * built from functions periodic in uPhase (0..1 over LOOP_MS), so every
 * portrait is a perfect loop. Fractions in PIECES are measured from the TOP
 * of the image. Append ?debug to the URL to see the mask lines.
 */

const LOOP_MS = 16000;
const DEBUG = new URLSearchParams(location.search).has("debug");
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

const PIECES = {
  charyn: {
    sky: 0.30, skyGate: 1, cloud: 0.85,
    birds: { y: [0.05, 0.22], tint: "rgba(18,20,24,0.55)" },
  },
  kaindy: {
    waterTop: 0.56, water: 1.0,
    mist: 0.30, mistY: 0.30,
  },
  bozzhyra: {
    sky: 0.60, skyGate: 1, cloud: 0.55,
    birds: { y: [0.04, 0.28], tint: "rgba(32,25,20,0.55)" },
  },
  kolsai: {
    sky: 0.30, skyGate: 1, cloud: 0.80,
    waterTop: 0.56, waterBot: 0.80, water: 0.70,
    mist: 0.25, mistY: 0.40,
  },
  tuzbair: {
    sweep: 0.8,
    birds: { y: [0.08, 0.34], x: [0.45, 1.0], tint: "rgba(25,24,26,0.5)" },
  },
  bao: {
    sky: 0.36, stars: 1.0,
    waterTop: 0.88, water: 0.35,
    shooting: true,
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
uniform sampler2D uTex;
uniform float uPhase;     /* 0..1, loops */
uniform float uAspect;
uniform float uSky;       /* skyline, fraction from top */
uniform float uSkyGate;   /* 1 = only displace sky-coloured pixels */
uniform float uCloud;
uniform float uWaterTop;  /* water band, fractions from top */
uniform float uWaterBot;
uniform float uWater;
uniform float uMist;
uniform float uMistY;
uniform float uStars;
uniform float uSweep;

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

void main() {
  vec2 uv = vUv;
  float yT = 1.0 - uv.y;               /* fraction from top of image */
  vec3 base = texture2D(uTex, uv).rgb;
  vec3 col = base;
  float lum = dot(base, vec3(0.299, 0.587, 0.114));

  /* circular walk through the noise field -> seamless loop */
  vec2 loopVec = vec2(cos(uPhase * TAU), sin(uPhase * TAU));

  /* ---- drifting clouds (dual-phase flow, fades out above skyline) ---- */
  if (uCloud > 0.001) {
    float band = 1.0 - smoothstep(uSky * 0.55, uSky * 0.97, yT);
    float gate = 1.0;
    if (uSkyGate > 0.5) {
      gate = smoothstep(0.02, 0.14, (base.b - base.r) * 1.4 + max(0.0, lum - 0.62) * 0.55);
    }
    float m = band * gate;
    if (m > 0.001) {
      float t1 = fract(uPhase * 2.0);
      float t2 = fract(uPhase * 2.0 + 0.5);
      float w  = abs(t1 * 2.0 - 1.0);
      float amp = 0.009 * uCloud * m;
      vec2 wind = vec2(1.0, 0.10 * sin(yT * 9.0));
      float billow = (noise(vec2(uv.x * 6.0 * uAspect, yT * 4.0) + loopVec * 0.35) - 0.5)
                     * 0.003 * uCloud * m;
      vec3 c1 = texture2D(uTex, uv + wind * (t1 - 0.5) * amp + vec2(0.0, billow)).rgb;
      vec3 c2 = texture2D(uTex, uv + wind * (t2 - 0.5) * amp + vec2(0.0, billow)).rgb;
      col = mix(col, mix(c1, c2, w), m);
    }
  }

  /* ---- breathing water (vertical ripple, sparkle) ---- */
  if (uWater > 0.001) {
    float wband = smoothstep(uWaterTop, uWaterTop + 0.05, yT)
                * (1.0 - smoothstep(uWaterBot - 0.04, uWaterBot, yT));
    if (wband > 0.001) {
      float depth = clamp((yT - uWaterTop) / max(0.001, uWaterBot - uWaterTop), 0.0, 1.0);
      float p1 = sin(uv.x * 90.0 + uPhase * TAU * 3.0 + yT * 70.0);
      float p2 = sin(uv.x * 52.0 - uPhase * TAU * 2.0 + yT * 118.0);
      float p3 = noise(vec2(uv.x * 22.0 * uAspect, yT * 30.0) + loopVec * 0.8) - 0.5;
      vec2 woff = vec2((p2 - p1) * 0.45, (p1 + p2) * 0.85 + p3)
                  * 0.0022 * uWater * wband * (0.35 + 0.65 * depth);
      col = mix(col, texture2D(uTex, uv + woff).rgb, wband);
      float spark = noise(uv * vec2(160.0 * uAspect, 220.0) + loopVec * 2.0) - 0.5;
      col += spark * 0.05 * uWater * wband * smoothstep(0.25, 0.75, lum);
    }
  }

  /* ---- slow mist around the ridge ---- */
  if (uMist > 0.001) {
    float bandM = exp(-pow((yT - uMistY) / 0.09, 2.0));
    float m = fbm(uv * vec2(3.5 * uAspect, 2.2) + loopVec * 0.5);
    col += vec3(0.82, 0.88, 0.95) * smoothstep(0.38, 0.85, m) * bandM * uMist * 0.16;
  }

  /* ---- twinkling stars (bright pixels above the ridge) ---- */
  if (uStars > 0.001) {
    float band = 1.0 - smoothstep(uSky * 0.82, uSky, yT);
    float gate = smoothstep(0.45, 0.80, lum);
    float h = hash(floor(vUv * 900.0));
    float tw = sin(TAU * (uPhase * 5.0 + h * 7.0));
    col *= 1.0 + uStars * band * gate * 0.38 * tw;
  }

  /* ---- travelling sunlight ---- */
  if (uSweep > 0.001) {
    float s = sin(TAU * (uPhase - uv.x * 0.35 - yT * 0.1));
    col *= 1.0 + uSweep * 0.05 * s;
  }

  /* vignette */
  vec2 d = (uv - 0.5) * vec2(1.12, 1.0);
  col *= 1.0 - 0.13 * smoothstep(0.42, 1.0, length(d) * 1.35);

  gl_FragColor = vec4(col, 1.0);
}`;

/* ------------------------------------------------------------------ */
/* overlay fauna: birds + shooting stars                               */
/* ------------------------------------------------------------------ */

const rand = (a, b) => a + Math.random() * (b - a);

class Bird {
  constructor(w, h, cfg) {
    const [y0, y1] = cfg.y;
    const [x0, x1] = cfg.x || [0, 1];
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.x = (this.dir > 0 ? x0 : x1) * w;
    this.spanPx = (x1 - x0) * w;
    this.y0 = rand(y0, y1) * h;
    this.speed = w / rand(17, 24);            /* px per second */
    this.size = w * rand(0.0065, 0.009);
    this.wobA = h * rand(0.006, 0.014);
    this.wobF = rand(0.4, 0.7);
    this.flapPhase = rand(0, Math.PI * 2);
    this.flapSpeed = rand(2.4, 3.1) * Math.PI * 2;
    this.glidePhase = rand(0, Math.PI * 2);
    this.t = 0;
    this.done = false;
  }
  update(dt) {
    this.t += dt;
    this.x += this.dir * this.speed * dt;
    /* alternate flapping and gliding; glide holds a shallow-V posture */
    const gliding = Math.sin(this.t * 0.55 + this.glidePhase) < -0.35;
    if (gliding) {
      const TAU = Math.PI * 2;
      const d = ((Math.PI / 3 - this.flapPhase % TAU) + Math.PI * 3) % TAU - Math.PI;
      this.flapPhase += d * Math.min(1, dt * 4);
    } else {
      this.flapPhase += this.flapSpeed * dt;
    }
    const progress = (this.dir > 0 ? this.x : this.spanPx - this.x) / this.spanPx;
    if (progress > 1.05) this.done = true;
  }
  draw(ctx, cfg, w) {
    const [x0, x1] = cfg.x || [0, 1];
    const u = (this.x / w - x0) / (x1 - x0);
    if (u < -0.02 || u > 1.02) return;
    const fade = Math.min(1, Math.min(u, 1 - u) / 0.09);
    if (fade <= 0) return;
    const y = this.y0 + this.wobA * Math.sin(this.t * this.wobF * Math.PI * 2);
    const s = this.size;
    const wingY = Math.sin(this.flapPhase) * s * 0.8;
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.strokeStyle = cfg.tint || "rgba(18,20,24,0.55)";
    ctx.lineWidth = Math.max(1, s * 0.22);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(this.x - s, y - wingY * 0.15);
    ctx.quadraticCurveTo(this.x - s * 0.45, y - wingY, this.x, y);
    ctx.quadraticCurveTo(this.x + s * 0.45, y - wingY, this.x + s, y - wingY * 0.15);
    ctx.stroke();
    ctx.restore();
  }
}

class ShootingStar {
  constructor(w, h, skyFrac) {
    this.x = rand(0.15, 0.85) * w;
    this.y = rand(0.06, skyFrac * 0.55) * h;
    const ang = rand(0.42, 0.75) * (Math.random() < 0.5 ? 1 : -1);
    this.dx = Math.cos(ang) * (Math.random() < 0.5 ? 1 : -1);
    this.dy = Math.abs(Math.sin(ang));
    this.len = h * rand(0.07, 0.11);
    this.life = rand(0.8, 1.2);
    this.t = 0;
    this.speed = this.len * 2.6 / this.life;
    this.done = false;
  }
  update(dt) {
    this.t += dt;
    this.x += this.dx * this.speed * dt;
    this.y += this.dy * this.speed * dt;
    if (this.t >= this.life) this.done = true;
  }
  draw(ctx) {
    const u = this.t / this.life;
    const a = Math.sin(Math.PI * Math.min(1, u)) * 0.85;
    if (a <= 0) return;
    const tx = this.x - this.dx * this.len;
    const ty = this.y - this.dy * this.len;
    const g = ctx.createLinearGradient(this.x, this.y, tx, ty);
    g.addColorStop(0, `rgba(235,240,255,${a})`);
    g.addColorStop(1, "rgba(235,240,255,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1.6, ctx.canvas.width / 900);
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();
  }
}

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
    this.gl = null;
    this.fauna = [];
    this.nextBird = rand(2.5, 6);
    this.nextStar = rand(4, 9);
    this.clock = 0;
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

  initGL(img) {
    const glCanvas = document.createElement("canvas");
    glCanvas.className = "gl";
    const fxCanvas = document.createElement("canvas");
    fxCanvas.className = "fx";
    const gl = glCanvas.getContext("webgl", {
      preserveDrawingBuffer: true,
      antialias: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

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

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const u = (n) => gl.getUniformLocation(prog, n);
    const c = this.cfg;
    gl.uniform1f(u("uAspect"), img.naturalWidth / img.naturalHeight);
    gl.uniform1f(u("uSky"), c.sky ?? 0.3);
    gl.uniform1f(u("uSkyGate"), c.skyGate ?? 0);
    gl.uniform1f(u("uCloud"), c.cloud ?? 0);
    gl.uniform1f(u("uWaterTop"), c.waterTop ?? 2.0);
    gl.uniform1f(u("uWaterBot"), c.waterBot ?? 1.0);
    gl.uniform1f(u("uWater"), c.water ?? 0);
    gl.uniform1f(u("uMist"), c.mist ?? 0);
    gl.uniform1f(u("uMistY"), c.mistY ?? c.sky ?? 0.3);
    gl.uniform1f(u("uStars"), c.stars ?? 0);
    gl.uniform1f(u("uSweep"), c.sweep ?? 0);
    this.uPhase = u("uPhase");

    this.gl = gl;
    this.glCanvas = glCanvas;
    this.fxCanvas = fxCanvas;
    this.fx = fxCanvas.getContext("2d");
    this.stack.append(glCanvas, fxCanvas);

    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.stack);
    /* first frame before the fade-in so there is no flash */
    this.draw(performance.now());
    this.stack.classList.add("ready");
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(this.stack.clientWidth * dpr);
    const h = Math.round(this.stack.clientHeight * dpr);
    if (!w || !h) return;
    for (const cv of [this.glCanvas, this.fxCanvas]) {
      if (cv.width !== w) cv.width = w;
      if (cv.height !== h) cv.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  draw(now, dt = 0) {
    const gl = this.gl;
    if (!gl) return;
    gl.uniform1f(this.uPhase, (now % LOOP_MS) / LOOP_MS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawFauna(dt);
  }

  drawFauna(dt) {
    const ctx = this.fx;
    const w = this.fxCanvas.width, h = this.fxCanvas.height;
    ctx.clearRect(0, 0, w, h);
    this.clock += dt;

    const c = this.cfg;
    if (c.birds && this.clock > this.nextBird) {
      this.nextBird = this.clock + rand(9, 22);
      this.fauna.push(new Bird(w, h, c.birds));
      if (Math.random() < 0.4) {
        const twin = new Bird(w, h, c.birds);
        twin.dir = this.fauna.at(-1).dir;
        twin.x = this.fauna.at(-1).x - twin.dir * w * 0.03;
        twin.y0 = this.fauna.at(-1).y0 + h * rand(0.015, 0.03);
        this.fauna.push(twin);
      }
    }
    if (c.shooting && this.clock > this.nextStar) {
      this.nextStar = this.clock + rand(12, 26);
      this.fauna.push(new ShootingStar(w, h, c.sky ?? 0.4));
    }

    for (const f of this.fauna) {
      f.update(dt);
      if (f instanceof Bird) f.draw(ctx, c.birds, w);
      else f.draw(ctx);
    }
    this.fauna = this.fauna.filter((f) => !f.done);

    if (DEBUG) this.drawDebug(ctx, w, h);
  }

  drawDebug(ctx, w, h) {
    const line = (frac, color, label, dash = []) => {
      if (frac == null) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(0, frac * h);
      ctx.lineTo(w, frac * h);
      ctx.stroke();
      ctx.font = `${Math.round(h / 45)}px monospace`;
      ctx.fillText(`${label} ${frac}`, 12, frac * h - 8);
      ctx.restore();
    };
    const c = this.cfg;
    if (c.cloud || c.stars) line(c.sky, "rgba(255,80,80,0.9)", "sky");
    if (c.water) line(c.waterTop, "rgba(80,220,255,0.9)", "waterTop");
    if (c.water && c.waterBot != null) line(c.waterBot, "rgba(80,220,255,0.9)", "waterBot", [10, 8]);
    if (c.mist) line(c.mistY, "rgba(200,120,255,0.9)", "mistY", [4, 6]);
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

const reveal = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.target.classList.toggle("in", e.isIntersecting || e.target.classList.contains("in"))),
  { threshold: 0.12 }
);
document.querySelectorAll(".piece").forEach((f) => reveal.observe(f));

if (!REDUCED) {
  const watch = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        const p = pieces.find((p) => p.fig === e.target);
        if (!p) return;
        p.visible = e.isIntersecting;
        if (e.isIntersecting) p.start();
      }),
    { rootMargin: "220px" }
  );
  pieces.forEach((p) => watch.observe(p.fig));

  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!document.hidden) {
      for (const p of pieces) if (p.visible) p.draw(now, dt);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
