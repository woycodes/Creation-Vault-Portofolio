// Creation Vault page wiring: nebulae, demo players, nav, language, contact form.
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const Audio = window.AudioEngine;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const MSG = {
    id: {
      audioError: "Browser ini tidak bisa memutar demo audio. Coba Chrome, Safari, atau Firefox versi terbaru.",
      empty: "Tulis pesanmu dulu sebelum mengirim.",
      sending: "Mengirim ke WhatsApp…",
      sent: "WhatsApp dibuka di tab baru. Belum terbuka? ",
      sentLink: "Buka WhatsApp",
    },
    en: {
      audioError: "This browser can't play the audio demo. Try a recent Chrome, Safari or Firefox.",
      empty: "Write your message before sending.",
      sending: "Sending to WhatsApp…",
      sent: "WhatsApp opened in a new tab. Didn't open? ",
      sentLink: "Open WhatsApp",
    },
  };
  const t = (k) => MSG[document.documentElement.lang === "en" ? "en" : "id"][k];
  // 67000 → "67.000" (ID) or "67,000" (EN)
  function fmtCount(n) {
    return n.toLocaleString(document.documentElement.lang === "en" ? "en-US" : "id-ID");
  }

  // One audio source for the whole page: the site's own demo player when it plays, otherwise
  // the Spotify playlist. Spotify streams DRM audio inside a cross-origin iframe, so its sound
  // can't be analysed; while it plays the nebula follows a tempo-like pulse instead (kick,
  // snare, stereo hi-hats), driven by Spotify's own play/pause state.
  const Spotify = { playing: false, controller: null };
  const simBands = [0, 1, 2, 3, 4].map(() => ({
    eL: 0, eR: 0, pitch: 0.5, shapeL: new Float32Array(12), shapeR: new Float32Array(12),
  }));
  function spotifyPulse() {
    const t = performance.now() / 1000;
    const beat = (t * 104) / 60;
    const kick = Math.exp(-(beat % 1) * 6);
    const snare = Math.exp(-((beat + 1) % 2) * 5);
    const hatPhase = (beat * 2) % 1;
    const hat = Math.exp(-hatPhase * 14);
    const left = Math.floor(beat * 2) % 2 === 0;
    const levels = [
      [0.06 + 0.3 * hat * (left ? 1 : 0.35), 0.06 + 0.3 * hat * (left ? 0.35 : 1)],
      [0.14 + 0.22 * snare + 0.06 * Math.sin(t * 1.7), 0.14 + 0.22 * snare + 0.06 * Math.sin(t * 1.9 + 1)],
      [0.24 + 0.08 * Math.sin(t * 0.9) + 0.1 * snare, 0.24 + 0.08 * Math.sin(t * 1.1 + 2) + 0.1 * snare],
      [0.18 + 0.42 * kick, 0.18 + 0.42 * kick],
      [0.1 + 0.5 * kick * kick, 0.1 + 0.5 * kick * kick],
    ];
    simBands.forEach((b, k) => {
      const [l, r] = levels[k];
      b.eL = l;
      b.eR = r;
      b.pitch = 0.5 + 0.25 * Math.sin(t * 0.45 + k * 1.3);
      for (let i = 0; i < 12; i++) {
        const tilt = 1 - i / 22;
        b.shapeL[i] = l * tilt * (0.65 + 0.35 * Math.sin(i * 0.9 + t * (1 + k * 0.3)));
        b.shapeR[i] = r * tilt * (0.65 + 0.35 * Math.sin(i * 0.9 + t * (1 + k * 0.3) + 0.6));
      }
    });
    return simBands;
  }
  function globalBands() {
    return Audio.getBands() || (Spotify.playing ? spotifyPulse() : null);
  }

  // Nebulae (hero and contact card)
  const nebulae = [
    new Nebula($("#heroNebula"), {
      theme: "light",
      seed: 7,
      getBands: globalBands,
      place: (w, h) =>
        w < 860
          ? { x: w * 0.5, y: h * 0.42, R: Math.min(w * 0.42, h * 0.3) }
          : { x: w * 0.62, y: h * 0.5, R: Math.min(h * 0.42, w * 0.28) },
    }),
    new Nebula($("#contactNebula"), {
      seed: 21,
      getBands: globalBands,
      reach: 0.4,
      place: (w, h) =>
        w < 860
          ? { x: w * 0.62, y: h * 0.28, R: Math.min(w * 0.36, h * 0.2) }
          : { x: w * 0.74, y: h * 0.5, R: Math.min(h * 0.36, w * 0.17) },
    }),
  ];

  // Ambient motion (nebulae and idle EQ) stays still when the visitor asks for reduced motion.
  const motionPaused = reduceMotion;
  nebulae.forEach((n) => n.setPaused && n.setPaused(motionPaused));

  // Demo panels: pixel EQ driven by the panel's own track, and by the cursor while idle
  class PixelEQ {
    constructor(panel) {
      this.panel = panel;
      this.c = $(".panel__eq", panel);
      this.ctx = this.c.getContext("2d");
      this.tracks = panel.dataset.tracks.split(" ");
      this.bins = new Float32Array(40);
      this.vals = new Float32Array(80);
      this.peaks = new Float32Array(80);
      this.mx = -1;
      this.visible = false;
      this.idleT = 0;
      new ResizeObserver(() => this.resize()).observe(this.c);
      new IntersectionObserver((es) => (this.visible = es[es.length - 1].isIntersecting)).observe(panel);
      panel.addEventListener("pointermove", (e) => {
        const r = this.c.getBoundingClientRect();
        this.mx = (e.clientX - r.left) / r.width;
      });
      panel.addEventListener("pointerleave", () => (this.mx = -1));
      this.resize();
    }
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = this.c.getBoundingClientRect();
      this.w = r.width;
      this.h = r.height;
      this.c.width = Math.round(r.width * dpr);
      this.c.height = Math.round(r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.cell = Math.max(10, Math.min(18, this.w / 36));
      this.cols = Math.min(80, Math.floor(this.w / this.cell));
      this.rows = Math.floor((this.h - 16) / this.cell);
    }
    draw(dt) {
      if (!this.visible || !this.w) return;
      const active = Audio.playing && this.tracks.includes(Audio.preset);
      const live = active && Audio.getBins(this.bins);
      if (!motionPaused) this.idleT += dt;
      const { ctx, cols, rows, cell } = this;
      const gap = Math.max(2, cell * 0.22);
      const ox = (this.w - cols * cell) / 2;
      ctx.clearRect(0, 0, this.w, this.h);

      for (let c = 0; c < cols; c++) {
        const f = c / cols;
        let target;
        if (live) {
          target = this.bins[Math.floor(f * this.bins.length)] * 0.95;
        } else {
          const tt = this.idleT;
          target = 0.24 + 0.07 * Math.sin(tt * 1.3 + c * 0.35) + 0.05 * Math.sin(tt * 2.2 - c * 0.6);
          if (this.mx >= 0) target += 0.45 * Math.exp(-Math.pow((f - this.mx) * 7, 2));
        }
        this.vals[c] += (target - this.vals[c]) * (live ? 0.5 : 0.12);
        this.peaks[c] = Math.max(this.peaks[c] - dt * 0.35, this.vals[c]);

        const filled = Math.round(clamp(this.vals[c], 0, 1) * rows);
        const peak = Math.min(rows - 1, Math.round(clamp(this.peaks[c], 0, 1) * rows));
        const x = ox + c * cell + gap / 2;
        for (let r = 0; r < rows; r++) {
          const y = this.h - 8 - (r + 1) * cell + gap / 2;
          if (r < filled) ctx.fillStyle = `rgba(255,204,170,${active ? 0.55 + (r / rows) * 0.45 : 0.4})`;
          else if (r === peak && peak > 0) ctx.fillStyle = active ? "#ffffff" : "rgba(255,255,255,0.35)";
          else ctx.fillStyle = "rgba(255,255,255,0.045)";
          ctx.fillRect(x, y, cell - gap, cell - gap);
        }
      }
    }
  }
  const eqs = $$(".panel").map((p) => new PixelEQ(p));
  let lastT = performance.now();
  (function loop(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    eqs.forEach((e) => e.draw(dt));
    $$(".track").forEach((tr) => {
      const on = Audio.playing && tr.dataset.play === Audio.preset;
      const p = on ? Audio.progress() : 0;
      const timeEl = $(".track__time", tr);
      $(".track__bar", tr).style.width = p * 100 + "%";
      // Real tracks count down their own length; synth demos count down their 30 s preview.
      const left = on && Audio.remaining() !== null
        ? Audio.remaining()
        : timeEl.dataset.length ? +timeEl.dataset.length : Audio.previewLength * (1 - p);
      const s = Math.ceil(left);
      timeEl.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    });
    requestAnimationFrame(loop);
  })(lastT);

  // Play buttons, error state, now-playing chip
  const panelStatus = (btn, text) => {
    const s = btn.closest(".panel") && $(".panel__status", btn.closest(".panel"));
    if (s) s.textContent = text;
  };
  $$("[data-play]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      panelStatus(btn, "");
      const ok = await Audio.toggle(btn.dataset.play);
      if (ok === false) panelStatus(btn, t("audioError"));
    })
  );
  const now = $("#nowPlaying");
  $(".now__stop", now).addEventListener("click", () => Audio.stop());
  window.addEventListener("cv-audio", ({ detail }) => {
    $$("[data-play]").forEach((b) => {
      const on = detail.playing && b.dataset.play === detail.preset;
      b.classList.toggle("is-playing", on);
      b.setAttribute("aria-pressed", String(on));
    });
    $(".now__title", now).textContent = detail.title || "";
    now.classList.toggle("is-on", detail.playing);
    // Only one source at a time: a demo starting pauses the Spotify playlist.
    if (detail.playing && Spotify.playing && Spotify.controller) Spotify.controller.pause();
  });

  // Spotify iFrame API: swaps the plain embed for a controllable one so the page knows when
  // the playlist plays. If the API never loads, the plain embed simply stays.
  (function initSpotify() {
    const host = $("#spotifyPlayer");
    if (!host) return;
    window.onSpotifyIframeApiReady = (IFrameAPI) => {
      const mount = document.createElement("div");
      host.replaceChildren(mount);
      IFrameAPI.createController(
        mount,
        { uri: "spotify:playlist:4H1C8DFeVMDkgfle3dFp4M", width: "100%", height: 452 },
        (controller) => {
          Spotify.controller = controller;
          const frame = $("iframe", host);
          if (frame) frame.title = "Playlist Spotify Creation Vault";
          controller.addListener("playback_update", (e) => {
            const was = Spotify.playing;
            Spotify.playing = !e.data.isPaused && !e.data.isBuffering;
            if (Spotify.playing && !was && Audio.playing) Audio.stop();
          });
        }
      );
    };
    // Load the API only when the playlist is near the screen (no third-party script up front).
    const sio = new IntersectionObserver(
      (es) => {
        if (!es[es.length - 1].isIntersecting) return;
        sio.disconnect();
        const s = document.createElement("script");
        s.src = "https://open.spotify.com/embed/iframe-api/v1";
        s.async = true;
        document.body.appendChild(s);
      },
      { rootMargin: "600px 0px" }
    );
    sio.observe(host);
  })();

  // Before / After: applies to the track playing in this panel (or the last one played,
  // else the first), switching in place with the same playhead, or starting it.
  $$(".ab__switch").forEach((sw) => {
    const panel = sw.closest(".panel");
    $$("button[data-version]", sw).forEach((b) =>
      b.addEventListener("click", async () => {
        sw.dataset.mode = b.dataset.version;
        $$("button", sw).forEach((x) => {
          x.classList.toggle("is-active", x === b);
          x.setAttribute("aria-pressed", String(x === b));
        });
        panelStatus(b, "");
        const id = panel.dataset.current || $("[data-play]", panel).dataset.play;
        const ok = await Audio.playFile(id, b.dataset.version);
        if (ok === false) panelStatus(b, t("audioError"));
      })
    );
  });
  window.addEventListener("cv-audio", ({ detail }) => {
    if (!detail.playing) return;
    const btn = $(`.panel [data-play="${detail.preset}"]`);
    if (btn) btn.closest(".panel").dataset.current = detail.preset;
  });

  // Nav: hidden at the very top and bottom on pointer devices, shown on scroll up,
  // when the cursor nears the top edge, or while anything inside it has focus.
  const nav = $("#nav");
  const dropdown = $(".dropdown");
  const ddBtn = $(".dropdown__btn");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let lastY = window.scrollY;
  let goingDown = false;
  let peek = false;

  function updateNav() {
    const y = window.scrollY;
    const open = nav.classList.contains("is-open") || dropdown.classList.contains("is-open");
    const focused = nav.matches(":focus-within");
    const atBottom = y + window.innerHeight >= document.documentElement.scrollHeight - 4;
    // Touch screens can't "peek", so the bar stays reachable at the top there.
    const topHidden = y < 80 && finePointer.matches;
    const hide = !open && !focused && !peek && (atBottom || topHidden || goingDown);
    nav.classList.toggle("is-hidden", hide);
    nav.classList.toggle("is-scrolled", y > 10 || !hide);
  }
  window.addEventListener(
    "scroll",
    () => {
      const y = window.scrollY;
      if (Math.abs(y - lastY) > 4) {
        goingDown = y > lastY;
        lastY = y;
      }
      updateNav();
    },
    { passive: true }
  );
  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse") return;
      const p = e.clientY < (peek ? 96 : 56);
      if (p !== peek) {
        peek = p;
        updateNav();
      }
    },
    { passive: true }
  );
  nav.addEventListener("focusin", updateNav);
  nav.addEventListener("focusout", () => setTimeout(updateNav, 0));

  let ddTimer = null;
  const setDD = (open) => {
    clearTimeout(ddTimer);
    dropdown.classList.toggle("is-open", open);
    ddBtn.setAttribute("aria-expanded", open);
    updateNav();
  };
  const canHover = window.matchMedia("(hover: hover) and (min-width: 861px)");
  ddBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setDD(!dropdown.classList.contains("is-open"));
  });
  dropdown.addEventListener("mouseenter", () => canHover.matches && setDD(true));
  dropdown.addEventListener("mouseleave", () => {
    if (!canHover.matches) return;
    clearTimeout(ddTimer);
    ddTimer = setTimeout(() => setDD(false), 280);
  });
  document.addEventListener("click", (e) => !dropdown.contains(e.target) && setDD(false));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    setDD(false);
    nav.classList.remove("is-open");
  });
  updateNav();

  const toggle = $(".nav__toggle");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", open);
    updateNav();
  });
  $$(".nav__links a").forEach((a) =>
    a.addEventListener("click", () => {
      nav.classList.remove("is-open");
      setDD(false);
    })
  );

  // Language toggle (ID / EN); English copy lives in data-en attributes
  function setLang(lang) {
    $$("[data-en]").forEach((el) => {
      if (el.dataset.id === undefined) el.dataset.id = el.innerHTML;
      el.innerHTML = lang === "en" ? el.dataset.en : el.dataset.id;
    });
    $$("[data-en-placeholder]").forEach((el) => {
      if (el.dataset.idPlaceholder === undefined) el.dataset.idPlaceholder = el.placeholder;
      el.placeholder = lang === "en" ? el.dataset.enPlaceholder : el.dataset.idPlaceholder;
    });
    document.documentElement.lang = lang;
    $("#langLabel").textContent = lang.toUpperCase();
    $$("[data-count-to][data-done]").forEach((el) => (el.textContent = fmtCount(+el.dataset.countTo)));
    store.set("cv-lang", lang);
  }
  $("#langBtn").addEventListener("click", () => setLang(document.documentElement.lang === "en" ? "id" : "en"));
  if (store.get("cv-lang") === "en") setLang("en");

  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add("is-in");
        io.unobserve(en.target);
      }),
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  $$(".reveal").forEach((el) => io.observe(el));

  // Chat bubbles: tilt alternates sign per bubble, with a fresh random size (0.4-1deg) each hover.
  $$(".bubble").forEach((b, i) => {
    const sign = i % 2 ? -1 : 1;
    const roll = () => b.style.setProperty("--rot", (sign * (0.4 + Math.random() * 0.6)).toFixed(2) + "deg");
    roll();
    b.addEventListener("mouseenter", roll);
  });

  // Stream count: counts up from 0 with a shake that settles, then pops (bigger, bolder,
  // peach glow) and returns to normal. Runs once, when the number comes into view.
  const fmt = fmtCount;
  $$("[data-count-to]").forEach((el) => {
    const to = +el.dataset.countTo;
    el.textContent = fmt(reduceMotion ? to : 0);
    if (reduceMotion) {
      el.dataset.done = "1";
      return;
    }
    const run = () => {
      const dur = 2200;
      const t0 = performance.now();
      el.classList.add("is-counting");
      (function step(now) {
        const k = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - k, 3);
        el.textContent = fmt(Math.round(to * eased));
        const amp = 3.5 * (1 - k * 0.7);
        el.style.transform = `translate(${(Math.random() - 0.5) * amp}px, ${(Math.random() - 0.5) * amp}px) rotate(${(Math.random() - 0.5) * amp * 0.4}deg)`;
        if (k < 1) return requestAnimationFrame(step);
        el.style.transform = "";
        el.dataset.done = "1";
        el.classList.remove("is-counting");
        el.classList.add("is-pop");
        el.addEventListener("animationend", () => el.classList.remove("is-pop"), { once: true });
      })(t0);
    };
    const cio = new IntersectionObserver(
      (es) => {
        if (!es[es.length - 1].isIntersecting) return;
        cio.disconnect();
        run();
      },
      { threshold: 0.6 }
    );
    cio.observe(el);
  });

  // Contact form: the plane shakes and flies off, then WhatsApp opens
  const askForm = $("#askForm");
  const input = $("#askInput");
  const sendBtn = $("button", askForm);
  const status = $("#askStatus");
  const say = (text, isError) => {
    status.textContent = text;
    status.classList.toggle("is-error", !!isError);
  };

  askForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (sendBtn.classList.contains("is-sending")) return;
    const msg = input.value.trim();
    if (!msg) {
      say(t("empty"), true);
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    const url = "https://wa.me/6285926517005?text=" + encodeURIComponent(`Halo Creation Vault! ${msg}`);

    say(t("sending"));
    sendBtn.disabled = true;
    sendBtn.classList.add("is-sending");
    const plane = $(".plane", sendBtn);
    plane.addEventListener("animationend", function done(ev) {
      if (ev.animationName !== "plane-fly") return;
      plane.removeEventListener("animationend", done);
      // window.open with "noopener" always returns null, so detach the opener by hand instead.
      const win = window.open(url, "_blank");
      if (win) win.opener = null;
      else window.location.href = url;
      status.textContent = t("sent");
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = t("sentLink");
      status.appendChild(a);
      input.value = "";
      sendBtn.disabled = false;
      sendBtn.classList.remove("is-sending");
      sendBtn.classList.add("is-back");
      setTimeout(() => sendBtn.classList.remove("is-back"), 500);
    });
  });
  input.addEventListener("input", () => {
    if (status.classList.contains("is-error")) say("");
    input.removeAttribute("aria-invalid");
  });

  $("#year").textContent = new Date().getFullYear();
})();
