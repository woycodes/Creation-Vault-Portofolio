// Small Web Audio engine that synthesises the example demos in the browser.
// Swap the presets for real portfolio files once they exist.
(function () {
  "use strict";

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Real portfolio tracks. Mixing demos have Before/After versions of the same take (30 s
  // clips with a 1 s fade-out, AAC with WAV fallback); all versions play together and
  // switching only moves the volume. BGM tracks have a single full-length version.
  const FILE_TRACKS = {
    ohkamu: {
      title: "Caby - OH KAMU (Prod By WOY)",
      versions: { main: ["assets/sounds/oh-kamu.m4a", "assets/sounds/Caby - OH KAMU (Prod By WOY) .wav"] },
    },
    whatami: {
      title: "anak baek, LuminiX, Akmal - What Am I To You",
      versions: { main: ["assets/sounds/anak baek, LuminiX, Akmal - What Am I To You.mp3"] },
    },
    dark: {
      title: "Dark Orchestra (Stein von Astran Ending Screen)",
      versions: { main: ["assets/sounds/Dark Orchestra (Stein Von Astran Ending Screen).mp3"] },
    },
    memories: {
      title: "Past Memories (Lo-fi/Chill Beat)",
      versions: { main: ["assets/sounds/Past Memories.mp3"] },
    },
    kokoro: {
      title: "Buono! - Kokoro no Tamago (Mega Fan Cover 28 Vtubers)",
      versions: {
        before: ["assets/sounds/kokoro-before-30s.m4a", "assets/sounds/kokoro-before-30s.wav"],
        after: ["assets/sounds/kokoro-after-30s.m4a", "assets/sounds/kokoro-after-30s.wav"],
      },
    },
    souls: {
      title: "Melissa McCarthy - Poor Unfortunate Souls (Sergie Vergio Cover)",
      versions: {
        before: ["assets/sounds/souls-before-30s.m4a", "assets/sounds/souls-before-30s.wav"],
        after: ["assets/sounds/souls-after-30s.m4a", "assets/sounds/souls-after-30s.wav"],
      },
    },
  };
  const XFADE = 0.25; // seconds for the Before / After volume crossfade

  // Nebula layers 1-5: brilliance, presence, low mids, bass, sub-bass (Hz).
  const BANDS = [[7000, 20000], [1500, 7000], [250, 1500], [60, 250], [20, 60]];
  const SHAPE_N = 12;

  // chord helpers (MIDI note numbers)
  const C = [48, 52, 55, 59], G = [43, 47, 50, 55], Am = [45, 48, 52, 55], F = [41, 45, 48, 52];
  const Dm7 = [50, 53, 57, 60], G7 = [43, 47, 50, 53], Cmaj7 = [48, 52, 55, 59], Am7 = [45, 48, 52, 55];
  const Em = [40, 43, 47, 52];

  const PRESETS = {
    pop: {
      title: "Contoh demo: indie pop",
      bpm: 108, swing: 0,
      chords: [C, G, Am, F],
      kick: "x.....x.x.......", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.",
      bassWave: "triangle", bassPat: "x..x..x.x..x..x.",
      lead: { wave: "triangle", pat: "x.x.x.x.x.x.x.x.", oct: 24, gain: 0.07 },
      pad: { wave: "sawtooth", gain: 0.035, cutoff: 1600 },
    },
    synthwave: {
      title: "Contoh demo: synthwave",
      bpm: 100, swing: 0,
      chords: [Am, F, C, G],
      kick: "x...x...x...x...", snare: "....x.......x...", hat: "xxxxxxxxxxxxxxxx",
      bassWave: "sawtooth", bassPat: "x.x.x.x.x.x.x.x.",
      lead: { wave: "square", pat: "xxxxxxxxxxxxxxxx", oct: 24, gain: 0.04 },
      pad: { wave: "sawtooth", gain: 0.05, cutoff: 2400 },
    },
    lofi: {
      title: "Contoh demo: lo-fi vlog",
      bpm: 78, swing: 0.18,
      chords: [Dm7, G7, Cmaj7, Am7],
      kick: "x......x..x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.",
      bassWave: "sine", bassPat: "x.......x.....x.",
      lead: { wave: "triangle", pat: "x..x..x...x..x..", oct: 12, gain: 0.08 },
      pad: { wave: "triangle", gain: 0.07, cutoff: 1100 },
      crackle: true,
    },
    chip: {
      title: "Contoh demo: chiptune game",
      bpm: 140, swing: 0,
      chords: [C, Am, F, G],
      kick: "x.......x.x.....", snare: "....x.......x...", hat: "..x...x...x...x.",
      bassWave: "square", bassPat: "x.x.x.x.x.x.x.x.",
      lead: { wave: "square", pat: "xxxxxxxxxxxxxxxx", oct: 24, gain: 0.05 },
      pad: null,
    },
    cinema: {
      title: "Contoh demo: sinematik",
      bpm: 64, swing: 0,
      chords: [Am, F, Em, Am],
      kick: "x...............", snare: "................", hat: "....x.......x...",
      bassWave: "sine", bassPat: "x...............",
      lead: null,
      pad: { wave: "sawtooth", gain: 0.06, cutoff: 900 },
      boom: true,
    },
  };

  const AudioEngine = {
    ctx: null,
    playing: false,
    preset: null,
    mode: "after",
    step: 0,
    nextTime: 0,
    timer: null,
    freq: null,
    startedAt: 0,
    previewLength: 30, // seconds

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());

      this.bus = ctx.createGain();
      // "before" mix colouring: muddy low-mids + dull top
      this.mud = ctx.createBiquadFilter();
      this.mud.type = "peaking";
      this.mud.frequency.value = 280;
      this.mud.Q.value = 0.9;
      this.dull = ctx.createBiquadFilter();
      this.dull.type = "lowpass";
      this.dull.Q.value = 0.5;
      // "after" mix: glue compression + air
      this.comp = ctx.createDynamicsCompressor();
      this.air = ctx.createBiquadFilter();
      this.air.type = "highshelf";
      this.air.frequency.value = 7000;
      this.master = ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.72;
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);

      this.bus.connect(this.mud).connect(this.dull).connect(this.comp).connect(this.air).connect(this.master);
      this.master.connect(this.analyser).connect(ctx.destination);

      // Left and right analysers for the nebula's stereo band meter. The large FFT gives
      // about 6 Hz per bin, enough to resolve the 20-60 Hz sub-bass band.
      this.split = ctx.createChannelSplitter(2);
      this.master.connect(this.split);
      this.aL = ctx.createAnalyser();
      this.aR = ctx.createAnalyser();
      [this.aL, this.aR].forEach((a, ch) => {
        a.fftSize = 8192;
        a.smoothingTimeConstant = 0.6;
        a.minDecibels = -95;
        a.maxDecibels = -25;
        this.split.connect(a, ch);
      });
      this.fL = new Uint8Array(this.aL.frequencyBinCount);
      this.fR = new Uint8Array(this.aR.frequencyBinCount);
      this.bands = BANDS.map(([lo, hi]) => ({
        lo, hi, eL: 0, eR: 0, pitch: 0.5,
        shapeL: new Float32Array(SHAPE_N), shapeR: new Float32Array(SHAPE_N),
      }));

      // shared noise buffer
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      this.setMix(this.mode, true);
    },

    setMix(mode, instant) {
      this.mode = mode;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const tc = instant ? 0.001 : 0.12;
      const after = mode === "after";
      this.mud.gain.setTargetAtTime(after ? 0 : 7, t, tc);
      this.dull.frequency.setTargetAtTime(after ? 20000 : 1500, t, tc);
      this.comp.threshold.setTargetAtTime(after ? -20 : 0, t, tc);
      this.comp.ratio.setTargetAtTime(after ? 3.5 : 1, t, tc);
      this.comp.attack.value = 0.01;
      this.comp.release.value = 0.2;
      this.air.gain.setTargetAtTime(after ? 4 : -2, t, tc);
      this.master.gain.setTargetAtTime(after ? 0.9 : 0.6, t, tc);
    },

    // Resolves false when the browser can't produce audio, so the page can show an error state.
    async play(name) {
      try {
        this.init();
      } catch (e) {
        return false;
      }
      if (!this.ctx) return false;
      if (this.ctx.state === "suspended") {
        try {
          await this.ctx.resume();
        } catch (e) {
          return false;
        }
      }
      if (this.playing && this.preset === name) return true;
      this.stop(true);
      this.kind = "synth";
      this.preset = name;
      this.p = PRESETS[name] || PRESETS.pop;
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.15;
      this.startedAt = this.ctx.currentTime;
      this.playing = true;
      this.timer = setInterval(() => this.schedule(), 25);
      this.schedule();
      this.emit();
      return true;
    },

    async toggle(name) {
      if (this.playing && (!name || this.preset === name)) {
        this.stop();
        return true;
      }
      if (FILE_TRACKS[name]) return this.playFile(name, this.pickVersion(name));
      return this.play(name || this.preset || "pop");
    },

    // Keeps the chosen Before/After across mixing tracks; single-version tracks use "main".
    pickVersion(id) {
      const versions = FILE_TRACKS[id].versions;
      if (versions[this.fileVersion]) return this.fileVersion;
      return versions.after ? "after" : Object.keys(versions)[0];
    },

    // File tracks: one <audio> element per version, each through its own gain into the
    // master bus so the analysers (EQ and nebula) hear whichever version is audible.
    fileVoices(id) {
      this.voices = this.voices || {};
      if (this.voices[id]) return this.voices[id];
      const aac = document.createElement("audio").canPlayType('audio/mp4; codecs="mp4a.40.2"');
      const v = {};
      for (const [name, srcs] of Object.entries(FILE_TRACKS[id].versions)) {
        const el = new Audio(aac || !srcs[1] ? srcs[0] : srcs[1]);
        el.preload = "auto";
        const src = this.ctx.createMediaElementSource(el);
        const g = this.ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(this.master);
        v[name] = { el, g };
      }
      // All versions end together, so listening to one is enough.
      Object.values(v)[0].el.addEventListener("ended", () => this.preset === id && this.kind === "file" && this.stop());
      return (this.voices[id] = v);
    },

    setFileGains(voices, version, fade) {
      const t = this.ctx.currentTime;
      for (const [name, v] of Object.entries(voices)) {
        const g = v.g.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(name === version ? 1 : 0, t + fade);
      }
    },

    // Muted versions drift a few ms over time; nudge them back to the audible one.
    resync(voices, version) {
      const lead = voices[version].el;
      for (const [name, v] of Object.entries(voices)) {
        if (name !== version && Math.abs(v.el.currentTime - lead.currentTime) > 0.04) v.el.currentTime = lead.currentTime;
      }
    },

    // Starts all versions together (or just changes which one is audible).
    // Resolves false if the browser cannot play the file (error state in the page).
    async playFile(id, version) {
      try {
        this.init();
        if (!this.ctx) return false;
        if (this.ctx.state === "suspended") await this.ctx.resume();
        const voices = this.fileVoices(id);

        if (this.playing && this.preset === id) {
          this.resync(voices, this.fileVersion);
          this.setFileGains(voices, version, XFADE);
        } else {
          if (this.playing) this.stop(true);
          const els = Object.values(voices).map((v) => v.el);
          await Promise.all(
            els.map((el) =>
              el.readyState >= 3
                ? null
                : new Promise((res, rej) => {
                    el.addEventListener("canplay", res, { once: true });
                    el.addEventListener("error", rej, { once: true });
                  })
            )
          );
          const from = this.fileId === id ? this.fileTime || 0 : 0;
          els.forEach((el) => (el.currentTime = from));
          await Promise.all(els.map((el) => el.play()));
          this.setFileGains(voices, version, 0.06);
          clearInterval(this.syncTimer);
          this.syncTimer = setInterval(() => this.kind === "file" && this.resync(voices, this.fileVersion), 1000);
        }

        this.kind = "file";
        this.preset = id;
        this.fileId = id;
        this.fileVersion = version;
        const label = version === "main" ? "" : " · " + version[0].toUpperCase() + version.slice(1);
        this.p = { title: FILE_TRACKS[id].title + label };
        this.playing = true;
        this.emit();
        return true;
      } catch (e) {
        return false;
      }
    },

    // Seconds left in the playing file track (null for synth demos).
    remaining() {
      if (this.kind !== "file") return null;
      const el = this.voices[this.preset][this.fileVersion].el;
      return Math.max(0, (el.duration || 0) - el.currentTime);
    },

    stop(silent) {
      if (this.kind === "file" && this.voices && this.voices[this.preset]) {
        const t = this.ctx.currentTime;
        const active = this.voices[this.preset][this.fileVersion];
        this.fileTime = active.el.ended ? 0 : active.el.currentTime;
        clearInterval(this.syncTimer);
        for (const v of Object.values(this.voices[this.preset])) {
          v.g.gain.cancelScheduledValues(t);
          v.g.gain.setValueAtTime(v.g.gain.value, t);
          v.g.gain.linearRampToValueAtTime(0, t + 0.06);
          const el = v.el;
          setTimeout(() => el.pause(), 80);
        }
        this.kind = null;
        this.playing = false;
        if (!silent) this.emit();
        return;
      }
      clearInterval(this.timer);
      this.timer = null;
      if (this.playing && this.ctx) {
        // quick fade so nothing clicks
        const t = this.ctx.currentTime;
        const g = this.bus.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(0, t + 0.08);
        g.setValueAtTime(1, t + 0.12);
      }
      this.playing = false;
      if (!silent) this.emit();
    },

    progress() {
      if (!this.playing || !this.ctx) return 0;
      if (this.kind === "file") {
        const el = this.voices[this.preset][this.fileVersion].el;
        return el.duration ? el.currentTime / el.duration : 0;
      }
      return Math.min(1, (this.ctx.currentTime - this.startedAt) / this.previewLength);
    },

    emit() {
      window.dispatchEvent(
        new CustomEvent("cv-audio", {
          detail: { playing: this.playing, preset: this.preset, title: this.p && this.p.title },
        })
      );
    },

    /* Fill `out` (length N) with log-spaced 0..1 bins. Returns false if silent. */
    getBins(out) {
      if (!this.playing || !this.analyser) return false;
      this.analyser.getByteFrequencyData(this.freq);
      const N = out.length;
      const sr = this.ctx.sampleRate;
      const binHz = sr / this.analyser.fftSize;
      const fMin = 35, fMax = 14000;
      for (let i = 0; i < N; i++) {
        const f0 = fMin * Math.pow(fMax / fMin, i / N);
        const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / N);
        let a = Math.floor(f0 / binHz), b = Math.max(a + 1, Math.ceil(f1 / binHz));
        let s = 0;
        for (let j = a; j < b && j < this.freq.length; j++) s = Math.max(s, this.freq[j]);
        // gentle tilt so highs still show up
        const v = (s / 255) * (0.85 + (i / N) * 0.5);
        out[i] = Math.pow(v, 1.6) * 1.15;
      }
      return true;
    },

    // Five bands for the nebula, each with left/right energy (0..1), its dominant pitch as a
    // 0..1 position inside the band (log scale), and a SHAPE_N-point spectrum per channel.
    // Returns null while nothing plays.
    getBands() {
      if (!this.playing || !this.aL) return null;
      this.aL.getByteFrequencyData(this.fL);
      this.aR.getByteFrequencyData(this.fR);
      const binHz = this.ctx.sampleRate / this.aL.fftSize;
      const last = this.fL.length - 1;
      for (const b of this.bands) {
        const ratio = b.hi / b.lo;
        let sumL = 0, sumR = 0, wsum = 0, w = 0;
        for (let i = 0; i < SHAPE_N; i++) {
          const f0 = b.lo * Math.pow(ratio, i / SHAPE_N);
          const f1 = b.lo * Math.pow(ratio, (i + 1) / SHAPE_N);
          const a = Math.min(last, Math.max(1, Math.floor(f0 / binHz)));
          const z = Math.min(last, Math.max(a, Math.ceil(f1 / binHz)));
          let l = 0, r = 0;
          for (let j = a; j <= z; j++) {
            l += this.fL[j];
            r += this.fR[j];
          }
          const n = (z - a + 1) * 255;
          b.shapeL[i] = l / n;
          b.shapeR[i] = r / n;
          sumL += b.shapeL[i];
          sumR += b.shapeR[i];
          const m = b.shapeL[i] + b.shapeR[i];
          wsum += m * i;
          w += m;
        }
        b.eL = sumL / SHAPE_N;
        b.eR = sumR / SHAPE_N;
        b.pitch = w > 1e-4 ? wsum / w / (SHAPE_N - 1) : 0.5;
      }
      return this.bands;
    },

    // Stereo output: each voice goes through its own panner (falls back to centre if unsupported).
    out(pan) {
      if (!pan || !this.ctx.createStereoPanner) return this.bus;
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(this.bus);
      return p;
    },

    // Sequencer
    schedule() {
      if (!this.playing) return;
      if (this.ctx.currentTime - this.startedAt > this.previewLength) {
        this.stop();
        return;
      }
      const p = this.p;
      const sixteenth = 60 / p.bpm / 4;
      while (this.nextTime < this.ctx.currentTime + 0.12) {
        const s = this.step % 16;
        const bar = Math.floor(this.step / 16);
        const chord = p.chords[bar % p.chords.length];
        let t = this.nextTime;
        if (p.swing && s % 2) t += sixteenth * p.swing;

        if (p.kick[s] === "x") this.kick(t);
        if (p.snare[s] === "x") this.snare(t);
        // Hats alternate sides; the lead arpeggio ping-pongs, so the stereo image keeps moving.
        if (p.hat[s] === "x") this.hat(t, s % 4 === 2 ? 0.07 : 0.04, s % 4 < 2 ? -0.55 : 0.55);
        if (p.bassPat[s] === "x") this.bass(t, chord[0] - 12, sixteenth * 1.8, p.bassWave);
        if (p.lead && p.lead.pat[s] === "x") {
          const arp = [0, 1, 2, 3, 2, 1];
          const n = chord[arp[(this.step >> (p.bpm > 120 ? 0 : 1)) % arp.length]] + p.lead.oct;
          this.lead(t, n, sixteenth * 0.9, p.lead.wave, p.lead.gain, Math.sin(this.step * 0.9) * 0.6);
        }
        if (s === 0) {
          if (p.pad) this.pad(t, chord, sixteenth * 16, p.pad);
          if (p.boom && bar % 2 === 0) this.boom(t);
          if (p.crackle) this.crackle(t, sixteenth * 16);
        }
        this.nextTime += sixteenth;
        this.step++;
      }
    },

    // Instruments
    env(g, t, a, peak, d) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    },

    kick(t) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      this.env(g, t, 0.003, 0.9, 0.38);
      o.connect(g).connect(this.bus);
      o.start(t);
      o.stop(t + 0.45);
    },

    snare(t) {
      const c = this.ctx;
      const n = c.createBufferSource(); n.buffer = this.noise;
      const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.8;
      const g = c.createGain(); this.env(g, t, 0.002, 0.35, 0.18);
      n.connect(f).connect(g).connect(this.out(0.12));
      n.start(t, Math.random()); n.stop(t + 0.22);
      const o = c.createOscillator(), og = c.createGain();
      o.type = "triangle"; o.frequency.value = 190;
      this.env(og, t, 0.002, 0.25, 0.08);
      o.connect(og).connect(this.bus); o.start(t); o.stop(t + 0.12);
    },

    hat(t, vol, pan) {
      const c = this.ctx;
      const n = c.createBufferSource(); n.buffer = this.noise;
      const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7500;
      const g = c.createGain(); this.env(g, t, 0.001, vol, 0.045);
      n.connect(f).connect(g).connect(this.out(pan));
      n.start(t, Math.random()); n.stop(t + 0.07);
    },

    bass(t, midi, dur, wave) {
      const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = wave; o.frequency.value = mtof(midi);
      f.type = "lowpass"; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(220, t + dur);
      this.env(g, t, 0.005, wave === "sine" ? 0.5 : 0.22, dur);
      o.connect(f).connect(g).connect(this.bus);
      o.start(t); o.stop(t + dur + 0.05);
    },

    lead(t, midi, dur, wave, vol, pan) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = wave; o.frequency.value = mtof(midi);
      this.env(g, t, 0.004, vol, dur);
      o.connect(g).connect(this.out(pan));
      o.start(t); o.stop(t + dur + 0.05);
    },

    pad(t, chord, dur, cfg) {
      const c = this.ctx;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cfg.cutoff; f.Q.value = 0.6;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(cfg.gain, t + Math.min(0.6, dur * 0.3));
      g.gain.setValueAtTime(cfg.gain, t + dur * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
      f.connect(g).connect(this.bus);
      // The two detuned voices of each chord note sit left and right for a wide pad.
      const sides = [-0.6, 0.6].map((v) => {
        if (!c.createStereoPanner) return f;
        const pn = c.createStereoPanner();
        pn.pan.value = v;
        pn.connect(f);
        return pn;
      });
      chord.forEach((m) => {
        [-6, 6].forEach((det, k) => {
          const o = c.createOscillator();
          o.type = cfg.wave; o.frequency.value = mtof(m + 12); o.detune.value = det;
          o.connect(sides[k]); o.start(t); o.stop(t + dur * 1.1);
        });
      });
    },

    boom(t) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(80, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 1.6);
      this.env(g, t, 0.01, 0.9, 2.2);
      o.connect(g).connect(this.bus);
      o.start(t); o.stop(t + 2.4);
      const n = c.createBufferSource(); n.buffer = this.noise;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(120, t + 1.5);
      const ng = c.createGain(); this.env(ng, t, 0.01, 0.25, 1.4);
      n.connect(f).connect(ng).connect(this.bus); n.start(t); n.stop(t + 1.5);
    },

    crackle(t, dur) {
      const c = this.ctx;
      for (let i = 0; i < 10; i++) {
        const tt = t + Math.random() * dur;
        const n = c.createBufferSource(); n.buffer = this.noise;
        const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 3000;
        const g = c.createGain(); this.env(g, tt, 0.001, 0.03 + Math.random() * 0.04, 0.01);
        n.connect(f).connect(g).connect(this.out(Math.random() * 1.6 - 0.8)); n.start(tt, Math.random()); n.stop(tt + 0.02);
      }
    },
  };

  window.AudioEngine = AudioEngine;
})();
