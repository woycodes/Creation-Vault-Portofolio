// Creation Vault 3D nebula (raw WebGL): a contained object made of 5 point-sprite layers,
// front to back: big stars, small stars, then three gas clouds (bright heart, warm filaments,
// cool haze) over a dark backdrop. Each layer spins on its own axis; the cursor tilts the
// object, pushes particles away and flicks it into a spin, and clicks send a shockwave.
(function () {
  "use strict";

  const VERT = `
    attribute vec3  aPos;
    attribute float aSize;
    attribute vec3  aCol;
    attribute float aSeed;
    uniform mat3  uRot;
    uniform vec2  uUnit;     // world unit → NDC (x, y)
    uniform vec2  uOffset;   // object centre in NDC
    uniform float uUnitPx;   // world unit → device px (for point size)
    uniform float uAspect;
    uniform vec2  uMouse;    // NDC
    uniform float uMouseOn;
    uniform vec3  uShock;    // NDC x, y, age
    uniform float uRepel;
    uniform float uMaxSize;
    uniform float uTime;
    // Audio, per layer: its frequency band's level, the layer-centre shift (stereo balance
    // on x, dominant pitch on y, level on z) and the band spectrum for each channel.
    uniform float uGain;
    uniform vec3  uShift;
    uniform float uShapeL[12];
    uniform float uShapeR[12];
    varying vec3  vCol;
    varying float vSeed;
    varying float vFade;

    float shapeAt(float u, float side) {
      float x = clamp(u, 0.0, 1.0) * 11.0;
      int i0 = int(floor(x));
      int i1 = int(min(floor(x) + 1.0, 11.0));
      float fr = fract(x);
      float l = mix(uShapeL[i0], uShapeL[i1], fr);
      float r = mix(uShapeR[i0], uShapeR[i1], fr);
      return mix(l, r, side);
    }

    void main() {
      vec3 p = uRot * aPos;
      // 3D stereo mountains, measured after rotation so screen-left always shows the left
      // channel and screen-right the right; low frequencies at the bottom, highs at the top.
      float u = atan(p.y, abs(p.x) + 0.15) / 3.14159 + 0.5;
      float side = smoothstep(-0.25, 0.25, p.x);
      float m = shapeAt(u, side);
      vec3 out3 = normalize(vec3(p.x, p.y * 0.45, p.z * 0.6) + 1e-4);
      p += out3 * m * m * 0.17 * (0.35 + length(p));
      p += uShift;
      // gentle breathing per particle
      p += 0.012 * vec3(sin(uTime * 0.7 + aSeed * 40.0), cos(uTime * 0.6 + aSeed * 31.0), 0.0);
      float persp = 3.2 / (3.2 + p.z);
      vec2 ndc = p.xy * persp * uUnit + uOffset;

      // cursor pushes particles away (stronger for nearer ones)
      vec2 d = (ndc - uMouse) * vec2(uAspect, 1.0);
      float dist = length(d);
      float f = uMouseOn * uRepel * exp(-dist * dist * 14.0) * persp;
      vec2 dir = d / (dist + 1e-4);
      ndc += dir / vec2(uAspect, 1.0) * f * 0.11;

      // click shockwave
      vec2 ds = (ndc - uShock.xy) * vec2(uAspect, 1.0);
      float sd = length(ds);
      float ring = exp(-pow((sd - uShock.z * 1.3) * 5.0, 2.0)) * exp(-uShock.z * 1.4);
      ndc += ds / (sd + 1e-4) / vec2(uAspect, 1.0) * ring * 0.07 * uRepel;

      gl_Position = vec4(ndc, 0.0, 1.0);
      gl_PointSize = min(uMaxSize, aSize * persp * uUnitPx * (1.0 + ring * 0.35 + f * 0.6));
      vCol = aCol;
      vSeed = aSeed;
      vFade = clamp(persp * persp, 0.35, 1.4) * (1.0 + ring * 0.8 + f * 0.5) * (1.0 + uGain * 0.6 + m * 0.5);
    }
  `;

  const FRAG = `
    precision highp float;
    uniform float uKind;   // 0 cloud · 1 small star · 2 big star · 3 backdrop
    uniform float uAlpha;
    uniform float uTime;
    uniform float uLight;  // 1 = ink on white (multiply), 0 = light on navy (additive)
    varying vec3  vCol;
    varying float vSeed;
    varying float vFade;

    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 1.7; a *= 0.5; } return v; }
    mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

    void main() {
      vec2 uv = gl_PointCoord * 2.0 - 1.0;
      float r = length(uv);
      if (r > 1.0) discard;

      vec3 c = vCol;
      float a;
      if (uKind < 0.5) {                       // wispy cloud puff
        vec2 q = rot(vSeed * 6.283 + uTime * 0.04 * (vSeed - 0.5)) * uv;
        float n = fbm(q * 2.2 + vSeed * 31.0 + uTime * 0.03);
        a = pow(1.0 - r, 1.6) * smoothstep(0.28, 0.9, n + (1.0 - r) * 0.3) * uAlpha * vFade;
      } else if (uKind < 1.5) {                // small star
        float tw = 0.55 + 0.45 * sin(uTime * (0.8 + vSeed * 2.5) + vSeed * 60.0);
        a = exp(-r * r * 9.0) * tw * uAlpha * vFade;
      } else if (uKind < 2.5) {                // big star with slowly rotating spikes
        vec2 q = rot(vSeed * 6.283 + uTime * 0.12 * (vSeed - 0.5)) * uv;
        float core = exp(-r * r * 60.0);
        float glow = exp(-r * r * 7.0) * 0.32;
        float sp = exp(-abs(q.x) * 55.0) * pow(1.0 - abs(q.y), 3.0) + exp(-abs(q.y) * 55.0) * pow(1.0 - abs(q.x), 3.0);
        float tw = 0.75 + 0.25 * sin(uTime * (0.6 + vSeed) + vSeed * 30.0);
        if (uLight < 0.5) c = mix(vCol, vec3(1.0), core);
        a = (core * 1.4 + glow + sp * 0.75) * tw * uAlpha * min(vFade, 1.2);
      } else {                                 // dark backdrop
        a = exp(-r * r * 3.2) * uAlpha;
      }
      // Light theme and backdrop multiply toward the colour (ink); dark theme adds light.
      if (uLight > 0.5 || uKind > 2.5) gl_FragColor = vec4(mix(vec3(1.0), c, clamp(a, 0.0, 1.0)), 1.0);
      else gl_FragColor = vec4(c * a, 1.0);
    }
  `;

  // Brand peach, white and navy, plus tints derived from them for depth.
  const PEACH = [1.0, 0.8, 0.667];
  const WHITE = [1, 1, 1];
  const NAVY = [0.114, 0.169, 0.325];
  const EMBER = [0.92, 0.4, 0.38];
  const ROSE = [0.95, 0.5, 0.6];
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  // Dark theme glows on navy; light theme is the same nebula as ink on white, so the
  // bright parts (white, ice) turn navy while peach, ember and rose keep their colour.
  const THEMES = {
    dark: {
      bright: WHITE, ice: [0.78, 0.86, 1.0], peachLight: mix(PEACH, WHITE, 0.4), peachSoft: mix(PEACH, WHITE, 0.5),
      haze: [0.42, 0.52, 0.86], haze2: [0.3, 0.4, 0.78], cloudAlpha: 1,
    },
    light: {
      // Warm stars use the brand peach pushed toward gold: mixing peach with navy read as brown.
      bright: NAVY, ice: [0.33, 0.42, 0.68], peachLight: [0.98, 0.76, 0.4], peachSoft: [1.0, 0.8, 0.5],
      haze: [0.8, 0.85, 0.96], haze2: [0.7, 0.76, 0.92], cloudAlpha: 1.6,
    },
  };

  // Column-major 3x3 helpers.
  function rotAxis(ax, a) {
    const [x, y, z] = ax, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [
      t * x * x + c, t * x * y + s * z, t * x * z - s * y,
      t * x * y - s * z, t * y * y + c, t * y * z + s * x,
      t * x * z + s * y, t * y * z - s * x, t * z * z + c,
    ];
  }
  function mul(a, b) {
    const o = new Array(9);
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++)
        o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
    return o;
  }
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  function makeRng(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  // Geometry for the 5 layers.
  function buildLayers(seed, T) {
    const rnd = makeRng(seed);
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
    const inSphere = (rx, ry, rz, power = 1) => {
      let x, y, z;
      do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
      const k = Math.pow(Math.hypot(x, y, z), power - 1);
      return [x * rx * k, y * ry * k, z * rz * k];
    };
    // lumpy structure: a few "lobes" so the clouds aren't a plain ball
    const lobes = Array.from({ length: 5 }, () => inSphere(0.55, 0.45, 0.35));
    const lumpy = (spread) => {
      const l = lobes[(rnd() * lobes.length) | 0];
      return [l[0] + gauss() * spread, l[1] + gauss() * spread * 0.85, l[2] + gauss() * spread * 0.7];
    };
    const axis = () => norm([rnd() - 0.5, 1, rnd() - 0.5]);
    const push = (arr, p, size, col) => arr.push(p[0], p[1], p[2], size, col[0], col[1], col[2], rnd());
    const L = [];

    // 1 · big stars
    const big = [];
    for (let i = 0; i < 14; i++)
      push(big, inSphere(1.35, 1.1, 0.9, 0.8), 0.12 + rnd() * 0.16, rnd() < 0.5 ? T.ice : T.peachLight);
    L.push({ kind: 2, band: 0, data: big, alpha: 1.0, repel: 1.0, spin: 0.03, axis: axis() });

    // 2 · small stars (dust)
    const small = [];
    for (let i = 0; i < 900; i++) {
      const p = rnd() < 0.6 ? inSphere(1.6, 1.3, 1.1, 1.6) : lumpy(0.45);
      push(small, p, 0.012 + rnd() * 0.022, [T.bright, T.ice, PEACH, T.peachSoft][(rnd() * 4) | 0]);
    }
    L.push({ kind: 1, band: 1, data: small, alpha: 1.0, repel: 1.0, spin: -0.04, axis: axis() });

    // 3 · nebula cloud 1: bright heart
    const c1 = [];
    for (let i = 0; i < 40; i++) push(c1, lumpy(0.22).map((v) => v * 0.75), 0.22 + rnd() * 0.3, rnd() < 0.25 ? T.bright : PEACH);
    push(c1, [0, 0, 0], 0.7, T.peachSoft); // glowing core
    L.push({ kind: 0, band: 2, data: c1, alpha: 0.11 * T.cloudAlpha, repel: 0.55, spin: 0.05, axis: axis() });

    // 4 · nebula cloud 2: warm filaments
    const c2 = [];
    for (let i = 0; i < 90; i++) push(c2, lumpy(0.4), 0.32 + rnd() * 0.45, [EMBER, ROSE, EMBER, PEACH][(rnd() * 4) | 0]);
    L.push({ kind: 0, band: 3, data: c2, alpha: 0.13 * T.cloudAlpha, repel: 0.45, spin: -0.03, axis: axis() });

    // 5 · nebula cloud 3: cool outer haze
    const c3 = [];
    for (let i = 0; i < 70; i++) push(c3, inSphere(1.15, 0.95, 0.75, 0.6), 0.6 + rnd() * 0.6, rnd() < 0.5 ? T.haze : T.haze2);
    L.push({ kind: 0, band: 4, data: c3, alpha: 0.12 * T.cloudAlpha, repel: 0.3, spin: 0.02, axis: axis() });

    // backdrop: dark disc behind everything (like the reference photo)
    const bd = [];
    push(bd, [0, 0, 0.2], 3.4, [0.05, 0.07, 0.15]);
    L.push({ kind: 3, band: -1, data: bd, alpha: 0.55, repel: 0, spin: 0, axis: [0, 1, 0] });

    return L.reverse(); // draw back → front
  }

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  class Nebula {
    constructor(canvas, opts = {}) {
      this.c = canvas;
      this.host = canvas.parentElement;
      this.o = Object.assign(
        {
          theme: "dark", // "dark": glows on navy; "light": navy ink on white
          seed: 7,
          follow: 1.2, // lazy drift after the cursor (1/s)
          reach: 0.55, // fraction of the way toward the cursor
          resolution: 0.85,
          place: (w, h) => ({ x: w / 2, y: h / 2, R: Math.min(w, h) * 0.32 }),
        },
        opts
      );
      const gl = (this.gl = canvas.getContext("webgl", { antialias: false, alpha: false }));
      if (!gl) {
        this.host.classList.add("no-webgl");
        return;
      }
      this.prog = this.build(gl);
      const P = this.prog;
      this.a = {
        pos: gl.getAttribLocation(P, "aPos"),
        size: gl.getAttribLocation(P, "aSize"),
        col: gl.getAttribLocation(P, "aCol"),
        seed: gl.getAttribLocation(P, "aSeed"),
      };
      this.u = {};
      ["uRot", "uUnit", "uOffset", "uUnitPx", "uAspect", "uMouse", "uMouseOn", "uShock", "uRepel", "uMaxSize", "uTime", "uKind", "uAlpha", "uGain", "uShift", "uShapeL", "uShapeR", "uLight"].forEach(
        (k) => (this.u[k] = gl.getUniformLocation(P, k))
      );
      this.maxPoint = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 256;

      this.light = this.o.theme === "light";
      this.bg = this.light ? [1, 1, 1] : [0.114, 0.169, 0.325];
      // The dark backdrop disc only makes sense on navy.
      this.layers = buildLayers(this.o.seed, THEMES[this.o.theme]).filter((l) => !(this.light && l.kind === 3)).map((l) => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(l.data), gl.STATIC_DRAW);
        return Object.assign(l, { buf, count: l.data.length / 8, angle: Math.random() * 6.28 });
      });

      this.pos = { x: 0, y: 0 };
      this.mouse = { x: 0, y: 0, inside: false, on: 0 };
      this.tilt = { x: 0, y: 0 };
      this.yaw = 0;
      this.yawVel = 0;
      this.shock = { x: -1e4, y: -1e4, age: 99 };
      this.t = 0;
      this.running = false;
      // Smoothed audio state per band. `peak` is a slowly decaying ceiling that normalises
      // each band, so quiet bands (sub-bass, brilliance) still move their layer.
      this.audio = Array.from({ length: 5 }, () => ({
        gain: 0, bal: 0, pitch: 0.5, peak: 0.08,
        shapeL: new Float32Array(12), shapeR: new Float32Array(12),
      }));
      this.zero = new Float32Array(12);

      this._frame = this.frame.bind(this);
      this.bind();
      this.resize();
    }

    build(gl) {
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
      gl.useProgram(p);
      return p;
    }

    bind() {
      new ResizeObserver(() => this.resize()).observe(this.c);
      const local = (e) => {
        const r = this.c.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      this.host.addEventListener(
        "pointermove",
        (e) => {
          const [x, y] = local(e);
          const m = this.mouse;
          // flick: fast horizontal moves spin the object
          if (m.inside) this.yawVel += (x - m.x) * 0.00012;
          m.x = x;
          m.y = y;
          m.inside = true;
        },
        { passive: true }
      );
      this.host.addEventListener("pointerleave", () => (this.mouse.inside = false));
      this.host.addEventListener("pointerdown", (e) => {
        if (e.target.closest("a, button, input, select, textarea, label, form")) return;
        const [x, y] = local(e);
        this.shock = { x, y, age: 0 };
        this.yawVel += (x < this.pos.x ? -1 : 1) * 0.02;
      });
      new IntersectionObserver((es) => {
        this.inView = es[es.length - 1].isIntersecting;
        this.inView ? this.start() : this.stop();
      }).observe(this.c);
    }

    resize() {
      const r = this.c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const k = Math.min(window.devicePixelRatio || 1, 2) * this.o.resolution;
      this.w = r.width;
      this.h = r.height;
      this.k = k;
      this.c.width = Math.max(1, Math.round(r.width * k));
      this.c.height = Math.max(1, Math.round(r.height * k));
      this.gl.viewport(0, 0, this.c.width, this.c.height);
      this.base = this.o.place(this.w, this.h);
      if (!this.placed) {
        this.pos.x = this.mouse.x = this.base.x;
        this.pos.y = this.mouse.y = this.base.y;
        this.placed = true;
      }
      if (!this.running) this.draw();
    }

    // Paused means one still frame and no animation loop (pause control and reduced motion).
    setPaused(paused) {
      this.paused = paused;
      if (paused) {
        this.stop();
        this.draw();
      } else if (this.inView) this.start();
    }

    start() {
      if (this.running || !this.gl || this.paused) return;
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this._frame);
    }
    stop() { this.running = false; }

    frame(now) {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      const speed = reduce ? 0.3 : 1;
      this.t += dt * speed;
      const m = this.mouse;

      m.on += ((m.inside ? 1 : 0) - m.on) * (1 - Math.exp(-dt * 6));

      // lazy drift toward the cursor (antigravity-like)
      const tx = m.inside ? this.base.x + (m.x - this.base.x) * this.o.reach : this.base.x;
      const ty = m.inside ? this.base.y + (m.y - this.base.y) * this.o.reach : this.base.y;
      const kf = 1 - Math.exp(-dt * this.o.follow);
      this.pos.x += (tx - this.pos.x) * kf;
      this.pos.y += (ty - this.pos.y) * kf;

      // responsive 3D tilt toward the cursor
      const R = this.base.R;
      const nx = m.inside ? Math.max(-1, Math.min(1, (m.x - this.pos.x) / (R * 2))) : 0;
      const ny = m.inside ? Math.max(-1, Math.min(1, (m.y - this.pos.y) / (R * 2))) : 0;
      const kt = 1 - Math.exp(-dt * 7);
      this.tilt.y += (nx * 0.9 - this.tilt.y) * kt;
      this.tilt.x += (ny * 0.7 - this.tilt.x) * kt;

      // spin: slow idle yaw + flick momentum
      this.yawVel = Math.max(-0.08, Math.min(0.08, this.yawVel)) * Math.pow(0.25, dt);
      this.yaw += 0.05 * speed * dt + this.yawVel;

      for (const l of this.layers) l.angle += l.spin * dt * speed;
      this.shock.age += dt;
      this.updateAudio(dt);

      this.draw();
      requestAnimationFrame(this._frame);
    }

    // Fast attack, slower release, so layers swell on hits and settle naturally.
    updateAudio(dt) {
      const bands = this.o.getBands ? this.o.getBands() : null;
      const atk = 1 - Math.exp(-dt * 18);
      const rel = 1 - Math.exp(-dt * 4);
      const slow = 1 - Math.exp(-dt * 3);
      const decay = Math.pow(0.85, dt);
      this.audio.forEach((s, k) => {
        const b = bands && bands[k];
        let level = 0, bal = 0, pitch = 0.5;
        if (b) {
          const e = (b.eL + b.eR) / 2;
          s.peak = Math.max(e, s.peak * decay, 0.04);
          level = Math.min(1.2, e / s.peak);
          bal = (b.eR - b.eL) / (b.eR + b.eL + 0.02);
          pitch = b.pitch;
        }
        s.gain += (level - s.gain) * (level > s.gain ? atk : rel);
        s.bal += (bal - s.bal) * slow;
        s.pitch += (pitch - s.pitch) * slow;
        for (let i = 0; i < 12; i++) {
          const tl = b ? Math.min(1.2, b.shapeL[i] / s.peak) : 0;
          const tr = b ? Math.min(1.2, b.shapeR[i] / s.peak) : 0;
          s.shapeL[i] += (tl - s.shapeL[i]) * (tl > s.shapeL[i] ? atk : rel);
          s.shapeR[i] += (tr - s.shapeR[i]) * (tr > s.shapeR[i] ? atk : rel);
        }
      });
    }

    draw() {
      const gl = this.gl, u = this.u, a = this.a;
      if (!gl || !this.w) return;
      const R = this.base.R;
      const bg = this.bg;
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);

      const toNdc = (x, y) => [(x / this.w) * 2 - 1, 1 - (y / this.h) * 2];
      const [ox, oy] = toNdc(this.pos.x, this.pos.y);
      const [mx, my] = toNdc(this.mouse.x, this.mouse.y);
      const [sx, sy] = toNdc(this.shock.x, this.shock.y);

      gl.uniform2f(u.uUnit, (R / this.w) * 2, (R / this.h) * 2);
      gl.uniform2f(u.uOffset, ox, oy);
      gl.uniform1f(u.uUnitPx, R * this.k);
      gl.uniform1f(u.uAspect, this.w / this.h);
      gl.uniform2f(u.uMouse, mx, my);
      gl.uniform1f(u.uMouseOn, this.mouse.on);
      gl.uniform3f(u.uShock, sx, sy, this.shock.age);
      gl.uniform1f(u.uMaxSize, this.maxPoint);
      gl.uniform1f(u.uTime, this.t);
      gl.uniform1f(u.uLight, this.light ? 1 : 0);

      const global = mul(rotAxis([1, 0, 0], this.tilt.x), rotAxis([0, 1, 0], this.tilt.y + this.yaw));

      for (const l of this.layers) {
        // Multiply for ink (light theme) and the backdrop; additive glow otherwise.
        if (this.light || l.kind === 3) gl.blendFunc(gl.DST_COLOR, gl.ZERO);
        else gl.blendFunc(gl.ONE, gl.ONE);
        gl.uniformMatrix3fv(u.uRot, false, new Float32Array(mul(global, rotAxis(l.axis, l.angle))));
        gl.uniform1f(u.uKind, l.kind);
        gl.uniform1f(u.uAlpha, l.alpha);
        gl.uniform1f(u.uRepel, l.repel);

        // Layer centre moves a little: stereo balance on x, dominant pitch on y, level on z.
        const s = l.band >= 0 ? this.audio[l.band] : null;
        if (s) {
          gl.uniform1f(u.uGain, s.gain);
          gl.uniform3f(u.uShift, s.bal * 0.1 * s.gain, (s.pitch - 0.5) * 0.16 * s.gain, -0.06 * s.gain);
          gl.uniform1fv(u.uShapeL, s.shapeL);
          gl.uniform1fv(u.uShapeR, s.shapeR);
        } else {
          gl.uniform1f(u.uGain, 0);
          gl.uniform3f(u.uShift, 0, 0, 0);
          gl.uniform1fv(u.uShapeL, this.zero);
          gl.uniform1fv(u.uShapeR, this.zero);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, l.buf);
        const S = 32;
        gl.enableVertexAttribArray(a.pos);
        gl.vertexAttribPointer(a.pos, 3, gl.FLOAT, false, S, 0);
        gl.enableVertexAttribArray(a.size);
        gl.vertexAttribPointer(a.size, 1, gl.FLOAT, false, S, 12);
        gl.enableVertexAttribArray(a.col);
        gl.vertexAttribPointer(a.col, 3, gl.FLOAT, false, S, 16);
        gl.enableVertexAttribArray(a.seed);
        gl.vertexAttribPointer(a.seed, 1, gl.FLOAT, false, S, 28);
        gl.drawArrays(gl.POINTS, 0, l.count);
      }
    }
  }

  window.Nebula = Nebula;
})();
