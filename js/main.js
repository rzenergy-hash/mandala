/* ============================================================================
 * Woven — main.js
 * Loads the uploaded artwork, samples it into a living fiber field, and runs
 * the animation loop:  interaction -> physics -> render.
 *
 * The image is the destination. At rest its threads are unravelled and drifting
 * (State 1: "what am I looking at?"). Move the pointer and the threads it passes
 * are called home, weaving that part of the picture back into focus (State 2).
 * Leave, and it slowly dissolves again. The cycle never ends.
 * ========================================================================== */
(function (W) {
  'use strict';

  /* ==========================================================================
   * TO REUSE THIS FOR ANOTHER IMAGE: just replace assets/artwork.png with your
   * own picture (any size/aspect). Everything else — the fiber colours, the
   * landscape structure, the reveal — is derived from that one image. The knobs
   * below are the main things worth tweaking per project.
   * (Runs on any http/https host, e.g. GitHub Pages. To also run by double-
   *  clicking index.html offline, see embed.sh.)
   * ======================================================================== */
  const CONFIG = {
    image: window.WOVEN_IMAGE || 'assets/artwork.jpg', // the artwork (swap this file; png/jpg both fine)
    fiberCount: 165000,  // density of the loose fiber field (auto-scaled to the viewport)
    cursorSize: 0.30,    // gather-field radius as a fraction of the smaller viewport side
    imageDisc: 0.62,     // crisp-image disc as a fraction of the gather field (smaller = tighter)
    revealDelay: 1.6,    // seconds of hovering before the image starts to appear
    revealDuration: 3.0, // seconds for the image to fully dissolve in
  };

  class WovenApp {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.time = 0;
      this.last = performance.now();
      this.rngSeed = 1337;

      const im = new Image();
      im.onload = () => { this.image = im; this._ready(); };
      im.onerror = () => this._error();
      im.src = CONFIG.image;
    }

    _ready() {
      this._resize();
      this.noise = W.makeNoise(this.rngSeed);
      this._build();

      const hint = document.getElementById('hint');
      if (hint) hint.classList.remove('hidden');

      // procedural weaving sound — starts on the first interaction (browsers
      // block audio until a user gesture)
      this.audio = new W.AudioSystem();
      // browsers only allow audio to start from a real gesture (click/tap/key) —
      // NOT from mouse movement — so the hint asks for one click
      const startAudio = () => this.audio.resume();
      ['pointerdown', 'click', 'touchstart', 'keydown'].forEach((ev) =>
        window.addEventListener(ev, startAudio, { passive: true }));

      window.addEventListener('resize', () => {
        clearTimeout(this._rt);
        this._rt = setTimeout(() => { this._resize(); this._build(); this.interaction.resize(this.W, this.H); }, 200);
      });

      requestAnimationFrame((t) => this._loop(t));
    }

    _error() {
      document.body.insertAdjacentHTML('beforeend',
        '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
        'font-family:Georgia,serif;color:#5a5245;text-align:center;padding:2rem">' +
        'Could not load <code>' + CONFIG.image + '</code>.<br>Serve this folder over http ' +
        '(e.g. GitHub Pages), or run <code>embed.sh</code> to bundle the image for offline use.</div>');
    }

    _resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25); // capped for the dense field
      this.dpr = dpr;
      const w = window.innerWidth, h = window.innerHeight;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;

      // offscreen layers: tmp holds the masked image, mask holds the dissolve
      // grayscale that turns the fibers INTO the image patch-by-patch
      if (!this.tmp) {
        this.tmp = document.createElement('canvas'); this.tctx = this.tmp.getContext('2d');
        this.mask = document.createElement('canvas'); this.mctx = this.mask.getContext('2d');
      }
      this.tmp.width = w * dpr; this.tmp.height = h * dpr; this.tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.mask.width = w * dpr; this.mask.height = h * dpr; this.mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* Bake a copy of the artwork whose OWN outer edges are feathered to
     * transparent, so when the picture is revealed near one of its borders it
     * melts into the surrounding threads instead of ending on the hard rectangular
     * edge of the source image. */
    _makeSoftImage() {
      const img = this.image, w = img.naturalWidth, h = img.naturalHeight;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, w, h);
      g.globalCompositeOperation = 'destination-in';
      const inset = Math.round(Math.min(w, h) * 0.08);
      const blur = Math.round(Math.min(w, h) * 0.075);
      g.filter = 'blur(' + blur + 'px)';
      g.fillStyle = '#000';
      g.fillRect(inset, inset, w - 2 * inset, h - 2 * inset);
      g.filter = 'none';
      g.globalCompositeOperation = 'source-over';
      return c;
    }

    /* (Re)build the fiber overlay for the current viewport. */
    _build() {
      // fibers sample the ORIGINAL (opaque) image; the reveal uses a copy whose
      // own outer edges are feathered so the picture melts into the threads there
      this.finalImg = this._makeSoftImage();
      const area = this.W * this.H;
      const count = Math.round(W.clamp(CONFIG.fiberCount * (area / (1280 * 800)), 85000, 180000));
      this.field = new W.FiberOverlay(this.image, this.W, this.H, this.noise, W.mulberry32(this.rngSeed), count);
      if (!this.interaction) this.interaction = new W.InteractionSystem(this.canvas, this.W, this.H, CONFIG.cursorSize);
      this.dwell = 0; this._ax = undefined; this._ay = undefined;
      this._makeDisc();
      this._makeNoiseTex();
      this._makeDust();
    }

    /* A soft radial disc baked once: SOLID in the middle, then a wide, gentle
     * feather to nothing. Combined with the noise dissolve, the edge becomes a
     * patchy fade that melts into the fibers — no hard rim, and far cheaper than
     * building radial gradients every frame. */
    _makeDisc() {
      const S = 320, c = document.createElement('canvas'); c.width = S; c.height = S;
      const g = c.getContext('2d');
      const cxp = S / 2, maxR = S * 0.48;
      const rg = g.createRadialGradient(cxp, cxp, 0, cxp, cxp, maxR);
      // A generous SOLID core so the delicate grey mandala resolves crisply on
      // white inside the window (the fibers here are inkier than the light
      // line-art, so a tiny core would let the dark threads bleed over the
      // reveal); then a smooth feather so the window still melts into the ring of
      // gathered threads around it rather than ending on a hard circle.
      const core = 0.40;
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const base = t < core ? 1 : W.smooth(1 - (t - core) / (1 - core));
        const alpha = Math.pow(base, 1.5);
        rg.addColorStop(t, 'rgba(0,0,0,' + alpha.toFixed(3) + ')');
      }
      // a gentle blur softens any residual rim into the background
      g.filter = 'blur(' + (S * 0.055) + 'px)';
      g.fillStyle = rg; g.fillRect(0, 0, S, S);
      g.filter = 'none';
      this.discTex = c; this.discMax = maxR;
    }

    /* one soft-edged dot, baked once, reused for every floating dust mote */
    _makeDot(r, g, b) {
      const S = 24, c = document.createElement('canvas'); c.width = S; c.height = S;
      const x = c.getContext('2d');
      const rg = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      rg.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',1)');
      rg.addColorStop(0.35, 'rgba(' + r + ',' + g + ',' + b + ',0.5)');
      rg.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
      x.fillStyle = rg; x.fillRect(0, 0, S, S);
      return c;
    }

    /* Fine motes of dust drifting in the air over the loose field — most are
     * faintly lighter than the paper (catching light), a few are darker specks. */
    _makeDust() {
      const bg = this.field.bg, cl = (a, d) => W.clamp(a + d, 0, 255) | 0;
      this.dotLight = this._makeDot(cl(bg[0], 24), cl(bg[1], 22), cl(bg[2], 18));
      this.dotDark = this._makeDot(cl(bg[0], -80), cl(bg[1], -74), cl(bg[2], -64));
      const area = this.W * this.H;
      const n = Math.round(W.clamp(250 * (area / (1280 * 800)), 150, 480));
      const rng = W.mulberry32(this.rngSeed ^ 0x9e37);
      const dx = new Float32Array(n), dy = new Float32Array(n), dr = new Float32Array(n);
      const ph = new Float32Array(n), amp = new Float32Array(n), spd = new Float32Array(n);
      const a = new Float32Array(n), tone = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        dx[i] = rng() * this.W; dy[i] = rng() * this.H;
        const big = rng() < 0.2;
        dr[i] = big ? (2.4 + rng() * 3.4) : (0.7 + rng() * 1.7);
        ph[i] = rng() * Math.PI * 2;
        amp[i] = 8 + rng() * 28;
        spd[i] = 0.06 + rng() * 0.3;
        tone[i] = rng() < 0.26 ? 1 : 0;
        a[i] = tone[i] ? (0.05 + rng() * 0.12) : (0.08 + rng() * 0.22);
      }
      this.dust = { n, dx, dy, dr, ph, amp, spd, a, tone };
    }

    _drawDust(time, dim) {
      const d = this.dust; if (!d || dim <= 0.01) return;
      const ctx = this.ctx, light = this.dotLight, dark = this.dotDark;
      for (let i = 0; i < d.n; i++) {
        const t = time * d.spd[i] + d.ph[i];
        const x = d.dx[i] + Math.cos(t) * d.amp[i];
        const y = d.dy[i] + Math.sin(t * 0.82 + d.ph[i]) * d.amp[i] * 0.7;
        const tw = 0.5 + 0.5 * Math.sin(time * d.spd[i] * 2.1 + d.ph[i] * 1.7); // twinkle
        const al = d.a[i] * (0.3 + 0.7 * tw) * dim;
        if (al <= 0.004) continue;
        ctx.globalAlpha = al;
        const s = d.dr[i];
        ctx.drawImage(d.tone[i] ? dark : light, x - s, y - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
    }

    /* A tiling noise texture stored in the ALPHA channel — each pixel's alpha is
     * the threshold at which that spot "turns" from fiber into image. Used as a
     * mask directly (no per-frame filters), so the dissolve is cheap. */
    _makeNoiseTex() {
      const S = 256, c = document.createElement('canvas'); c.width = S; c.height = S;
      const g = c.getContext('2d'), im = g.createImageData(S, S), nz = this.noise;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const v = nz.fbm(x / S * 3.2 + 11.3, y / S * 3.2 + 4.7, 4);
          const p = (y * S + x) * 4;
          im.data[p] = 0; im.data[p + 1] = 0; im.data[p + 2] = 0;
          im.data[p + 3] = W.clamp(v * 255, 0, 255) | 0; // alpha = noise
        }
      }
      g.putImageData(im, 0, 0);
      this.noiseTex = c;
      this.noisePattern = this.mctx.createPattern(c, 'repeat');
    }

    _drawImgBbox(cx, img, m, x0, y0, bw, bh) {
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const sx = ((x0 - m.ox) / m.dw) * iw;
      const sy = ((y0 - m.oy) / m.dh) * ih;
      const sw = (bw / m.dw) * iw;
      const sh = (bh / m.dh) * ih;
      cx.drawImage(img, sx, sy, sw, sh, x0, y0, bw, bh);
    }

    /* The reveal: the final image DISSOLVES in over the gathered fibers — image
     * patches "turn on" where noise < q, growing as q rises; the soft disc fades
     * the outer band so the patches thin into the surrounding fibers with NO hard
     * rim. The image disc is SMALLER than the fiber-gather field, so a ring of
     * gathered/aligned fibers surrounds the crisp image. */
    _revealFinal(L, travel, a, m) {
      if (!this.noisePattern || !this.discTex) return;
      const revealA = W.smoothstep(0.02, 0.16, L) * travel;
      if (revealA <= 0.004) return;
      const q = W.clamp(L * 1.15, 0, 1.12);       // dissolve progress
      const R = a.radius * CONFIG.imageDisc, s = R / this.discMax, half = Math.ceil(this.discTex.width * 0.5 * s);
      // clamp the bbox to the IMAGE region (not the whole canvas) so we never
      // sample outside the picture — that overflow was what made the reveal
      // appear to shift on the left/right when the window isn't 3:2 (letterbox)
      const x0 = Math.max(m.ox, (a.x - half) | 0), y0 = Math.max(m.oy, (a.y - half) | 0);
      const x1 = Math.min(m.ox + m.dw, Math.ceil(a.x + half)), y1 = Math.min(m.oy + m.dh, Math.ceil(a.y + half));
      const bw = x1 - x0, bh = y1 - y0;
      if (bw <= 0 || bh <= 0) return;
      const tc = this.tctx, mc = this.mctx, dpr = this.dpr, img = this.finalImg;

      // 1) final image into tmp
      tc.clearRect(x0, y0, bw, bh);
      tc.globalCompositeOperation = 'source-over';
      this._drawImgBbox(tc, img, m, x0, y0, bw, bh);

      // 2) dissolve alpha into mask: A = clamp(noise + (2q-1)) (cheap uniform),
      //    then multiply by the pre-baked soft disc for the melting radial edge
      mc.clearRect(x0, y0, bw, bh);
      mc.globalCompositeOperation = 'source-over'; mc.globalAlpha = 1;
      mc.fillStyle = this.noisePattern; mc.fillRect(x0, y0, bw, bh); // alpha = noise
      const off = 2 * q - 1;
      if (off > 0.001) {
        mc.globalCompositeOperation = 'lighter';
        mc.fillStyle = 'rgba(0,0,0,' + Math.min(off, 1) + ')'; mc.fillRect(x0, y0, bw, bh);
      } else if (off < -0.001) {
        mc.globalCompositeOperation = 'destination-out';
        mc.fillStyle = 'rgba(0,0,0,' + Math.min(-off, 1) + ')'; mc.fillRect(x0, y0, bw, bh);
      }
      mc.globalCompositeOperation = 'destination-in';
      mc.save(); mc.translate(a.x, a.y); mc.scale(s, s);
      mc.drawImage(this.discTex, -this.discTex.width / 2, -this.discTex.height / 2);
      mc.restore();
      mc.globalCompositeOperation = 'source-over';

      // 3) mask the image by the dissolve alpha
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(this.mask, x0 * dpr, y0 * dpr, bw * dpr, bh * dpr, x0, y0, bw, bh);
      tc.globalCompositeOperation = 'source-over';

      // 4) composite over the fibers
      this.ctx.globalAlpha = revealA;
      this.ctx.drawImage(this.tmp, x0 * dpr, y0 * dpr, bw * dpr, bh * dpr, x0, y0, bw, bh);
      this.ctx.globalAlpha = 1;
    }

    _loop(now) {
      const dt = Math.min(now - this.last, 50);
      this.last = now;
      this.time += dt * 0.001;

      this.interaction.update(now);
      const p = this.interaction.pointer;
      this.field.update(dt, this.time, p);
      if (this.audio) this.audio.update(p.energy, p.speed, p.x / this.W, p.y / this.H);

      // --- dwell: ~1s to play with the fibers, then the image reveals slowly.
      //     The reveal is LOCKED to the cursor position (no easing/lag), so the
      //     image reads as a fixed backdrop revealed through a moving hole — it
      //     never drifts or "catches up" after you stop moving.
      const present = p.energy > 0.25;
      if (present) {
        this._ax = p.x; this._ay = p.y;
        this.dwell = Math.min(this.dwell + dt * 0.001, 5);
      } else {
        this.dwell = Math.max(this.dwell - dt * 0.001 * 1.4, 0); // leaving -> gentle rewind
      }
      // L drives the reveal: 0 until `revealDelay`s of dwell (fiber-play + gather
      // first), then eases 0->1 over `revealDuration`s
      const L = W.smoothstep(CONFIG.revealDelay, CONFIG.revealDelay + CONFIG.revealDuration, this.dwell);
      // fade the image with cursor ENERGY (which decays when the cursor stops
      // moving) so the picture fades out AT THE SAME TIME as the fibers fly away
      const fade = W.smoothstep(0.22, 0.6, p.energy);

      const ctx = this.ctx, f = this.field, m = f.map;

      // 1) paper
      ctx.fillStyle = 'rgb(' + (f.bg[0] | 0) + ',' + (f.bg[1] | 0) + ',' + (f.bg[2] | 0) + ')';
      ctx.fillRect(0, 0, this.W, this.H);

      // 2) the fibers — a dense, drifting loose field at rest (touchable like
      //    water), gathering toward home as you hover. Drawn UNDERNEATH the image.
      f.draw(ctx);

      // 2b) fine dust drifting in the air — fades back as the image reveals so it
      //     never clutters the focal picture
      this._drawDust(this.time, 1 - 0.55 * L);

      // 3) the final image dissolves in over the gathered fibers, so the fibers
      //    appear to weave themselves INTO the picture (not a flat opacity fade).
      if (L > 0.01 && fade > 0.01 && this._ax !== undefined) {
        this._revealFinal(L, fade, { x: this._ax, y: this._ay, radius: p.radius }, m);
      }

      requestAnimationFrame((t) => this._loop(t));
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.__woven = new WovenApp(document.getElementById('woven'));
  });
})(window.WOVEN = window.WOVEN || {});
