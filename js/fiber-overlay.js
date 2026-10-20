/* ============================================================================
 * Woven — fiber-overlay.js
 * An animated fiber layer that lives ABOVE the real PNG (which main.js draws
 * directly). Fibers are sampled FROM the image: each remembers a home position,
 * color and edge orientation taken from the picture.
 *
 * Idle : fibers are scattered away from the image and faint -> you see the PNG.
 * Hover: fibers near the cursor spring home and grow opaque, landing exactly on
 *        the image content. As they arrive the PNG fades beneath them, so the
 *        fibers replace the image without the swap ever being noticed.
 * The image is never recreated procedurally — the fibers only re-present pixels
 * sampled straight from it, on top of the untouched original.
 * ========================================================================== */
(function (W) {
  'use strict';

  const SPRING = 0.16, DAMP = 0.74;
  const EASE_UP = 0.10, EASE_DOWN = 0.045; // gather on hover; fly away when the cursor stops
  const BANDS = 6;
  const BAND_ALPHA = [0.10, 0.18, 0.30, 0.46, 0.62, 0.74];
  const WIDTHS = [1.1, 1.8];

  W.FiberOverlay = class FiberOverlay {
    constructor(img, cw, ch, noise, rng, count) {
      this.noise = noise; this.rng = rng;
      this._sample(img, cw, ch, count);
      this._initDraw();
    }

    _sample(img, cw, ch, count) {
      const SW = 512, SH = Math.round((img.naturalHeight / img.naturalWidth) * SW);
      const cv = document.createElement('canvas'); cv.width = SW; cv.height = SH;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, SW, SH);
      const data = g.getImageData(0, 0, SW, SH).data;

      const lum = new Float32Array(SW * SH);
      for (let i = 0, p = 0; i < SW * SH; i++, p += 4) lum[i] = 0.3 * data[p] + 0.59 * data[p + 1] + 0.11 * data[p + 2];
      const paperLum = 0.3 * data[8] + 0.59 * data[9] + 0.11 * data[10] || 210;

      // contain-fit the image inside the canvas (main.js reveals it the same way),
      // then shrink by PAD so the artwork keeps a margin on every side. The mandala's
      // line-work runs right to the edge of its own frame, so a plain contain-fit puts
      // the outer loops exactly on the window border — where a browser with slightly
      // different chrome height or pixel rounding clips them. The margin guarantees the
      // whole piece stays visible at any viewport size, on any browser.
      const PAD = 0.9;
      const aspect = img.naturalWidth / img.naturalHeight;
      let dw = cw, dh = cw / aspect;
      if (dh > ch) { dh = ch; dw = ch * aspect; }
      dw *= PAD; dh *= PAD;
      const ox = (cw - dw) / 2, oy = (ch - dh) / 2;
      this.map = { ox, oy, dw, dh };
      this.bg = [data[8], data[9], data[10]];

      const noise = this.noise, rng = this.rng;
      const N = count;
      this.N = N;
      const hx = new Float32Array(N), hy = new Float32Array(N);
      const lx = new Float32Array(N), ly = new Float32Array(N);
      const cosH = new Float32Array(N), sinH = new Float32Array(N);
      const cosL = new Float32Array(N), sinL = new Float32Array(N);
      const len = new Float32Array(N), phase = new Float32Array(N);
      const curveMag = new Float32Array(N); // perpendicular bow for long curved threads
      const depth = new Float32Array(N);    // 0 = far/back (small, hazy), 1 = near/front
      const dlevel = new Int8Array(N);      // coarse back/mid/front band for draw order
      const cr = new Uint8Array(N), cg = new Uint8Array(N), cb = new Uint8Array(N);
      const bg = this.bg;

      const edgeAt = (x, y) => {
        const i = y * SW + x;
        if (x <= 0 || x >= SW - 1 || y <= 0 || y >= SH - 1) return { m: 0, a: 0 };
        const gx = -lum[i - SW - 1] - 2 * lum[i - 1] - lum[i + SW - 1] + lum[i - SW + 1] + 2 * lum[i + 1] + lum[i + SW + 1];
        const gy = -lum[i - SW - 1] - 2 * lum[i - SW] - lum[i - SW + 1] + lum[i + SW - 1] + 2 * lum[i + SW] + lum[i + SW + 1];
        return { m: Math.min(1, Math.hypot(gx, gy) / 380), a: Math.atan2(gy, gx) + Math.PI / 2 };
      };
      const pxPer = dw / SW;

      let n = 0, tries = 0, maxTries = N * 40;
      while (n < N && tries < maxTries) {
        tries++;
        const sx = 1 + (rng() * (SW - 2)) | 0;
        const sy = 1 + (rng() * (SH - 2)) | 0;
        const i = sy * SW + sx;
        const dark = W.clamp(1 - lum[i] / paperLum, 0, 1);
        const e = edgeAt(sx, sy);
        const weight = W.clamp(0.05 + 0.3 * dark + 0.9 * Math.pow(e.m, 0.6), 0, 1);
        if (rng() > weight) continue;

        // The source is fine light-grey line-art on white, so the raw pixels are
        // nearly white and would render as invisible threads. Instead derive an
        // INK tone from how much darker than paper the sampled line is: faint grey
        // curves become a visible cool charcoal, the darkest lines the deepest ink.
        const ink = W.clamp(dark * 3.4, 0, 1);
        const inkR = 54, inkG = 57, inkB = 66; // cool charcoal
        cr[n] = W.clamp(bg[0] + (inkR - bg[0]) * ink, 0, 255);
        cg[n] = W.clamp(bg[1] + (inkG - bg[1]) * ink, 0, 255);
        cb[n] = W.clamp(bg[2] + (inkB - bg[2]) * ink, 0, 255);

        const HX = ox + sx * pxPer, HY = oy + sy * pxPer;
        hx[n] = HX; hy[n] = HY;

        // DEPTH: top of the image reads as far (small, hazy, drawn first), bottom
        // as near (large, full, drawn last) — landscape perspective + random spread
        // so the loose net stacks into many overlapping layers.
        const vFrac = W.clamp((HY - oy) / dh, 0, 1);
        const dep = W.clamp(vFrac * 0.5 + rng() * 0.62 + 0.04, 0, 1);
        depth[n] = dep;
        dlevel[n] = dep < 0.4 ? 0 : (dep < 0.72 ? 1 : 2);
        // atmospheric haze: fade far fibers toward the paper so they recede.
        // Kept light for line-art so the receding threads stay as ink, not white.
        const haze = (1 - dep) * 0.26;
        cr[n] = W.clamp(cr[n] + (bg[0] - cr[n]) * haze, 0, 255);
        cg[n] = W.clamp(cg[n] + (bg[1] - cg[n]) * haze, 0, 255);
        cb[n] = W.clamp(cb[n] + (bg[2] - cb[n]) * haze, 0, 255);

        // orientation: along the edge, or a slow flow in flat regions
        const flow = (noise.fbm(sx * 0.02, sy * 0.02, 3) - 0.5) * Math.PI * 2;
        const t = W.smoothstep(0.05, 0.22, e.m);
        const ang = flow + Math.atan2(Math.sin(e.a - flow), Math.cos(e.a - flow)) * t;
        cosH[n] = Math.cos(ang); sinH[n] = Math.sin(ang);
        const la = rng() * Math.PI * 2; cosL[n] = Math.cos(la); sinL[n] = Math.sin(la);

        // resting place: keep fibers fairly NEAR home so the loose field reads as
        // a woven NET that still shows the landscape (mounds, river, roots) — like
        // the reference. ~15% are "wanderers" that spread into the empty margins.
        if (rng() < 0.15) {
          lx[n] = rng() * cw; ly[n] = rng() * ch;
        } else {
          const dx = (noise.fbm(HX * 0.005 + 5, HY * 0.005, 3) - 0.5) * 150 + (rng() - 0.5) * 70;
          const dy = (noise.fbm(HX * 0.005, HY * 0.005 + 9, 3) - 0.5) * 150 + (rng() - 0.5) * 70;
          lx[n] = HX + dx; ly[n] = HY + dy;
        }

        // a deliberate mix of short stitches and long threads — and some of the
        // long ones are long CURVED lines (a perpendicular bow)
        const isLong = rng() < 0.32;
        const isVeryLong = isLong && rng() < 0.35;
        const lf = isVeryLong ? (7 + rng() * 8) : isLong ? (3.2 + rng() * 3.6) : (0.7 + rng() * 1.4);
        len[n] = pxPer * lf * (0.85 + e.m * 0.6) * (0.38 + dep * 1.0);
        curveMag[n] = isVeryLong ? (rng() - 0.5) * len[n] * 0.7 : 0;
        phase[n] = rng() * Math.PI * 2;
        n++;
      }
      this.N = n;
      this.hx = hx; this.hy = hy; this.lx = lx; this.ly = ly;
      this.cosH = cosH; this.sinH = sinH; this.cosL = cosL; this.sinL = sinL;
      this.len = len; this.phase = phase; this.cr = cr; this.cg = cg; this.cb = cb;
      this.curveMag = curveMag; this.depth = depth; this.dlevel = dlevel;

      // dynamic state
      this.cx = new Float32Array(n); this.cy = new Float32Array(n);
      this.vx = new Float32Array(n); this.vy = new Float32Array(n);
      this.weave = new Float32Array(n); this.band = new Int8Array(n);
      this.ex0 = new Float32Array(n); this.ey0 = new Float32Array(n);
      this.ex1 = new Float32Array(n); this.ey1 = new Float32Array(n);
      for (let i = 0; i < n; i++) { this.cx[i] = lx[i]; this.cy[i] = ly[i]; }
      this.gw = 0;
    }

    _initDraw() {
      this.map_ = new Map(); this.buckets = []; this.style = []; this.wcls = []; this.sdepth = [];
    }

    update(dt, time, pointer) {
      const dtn = W.clamp(dt / 16.667, 0.4, 2.2);
      const N = this.N;
      const hx = this.hx, hy = this.hy, lx = this.lx, ly = this.ly;
      const cosH = this.cosH, sinH = this.sinH, cosL = this.cosL, sinL = this.sinL;
      const len = this.len, phase = this.phase, depth = this.depth;
      const cx = this.cx, cy = this.cy, vx = this.vx, vy = this.vy, weave = this.weave, band = this.band;
      const ex0 = this.ex0, ey0 = this.ey0, ex1 = this.ex1, ey1 = this.ey1;
      const pe = pointer.energy, active = pe > 0.001, pr = pointer.radius, px = pointer.x, py = pointer.y;
      // "touch the water" ripple: a cursor near LOOSE fibers shoves them aside
      const touchR = pr * 0.42, touchR2 = touchR * touchR;
      const pvx = pointer.vx || 0, pvy = pointer.vy || 0, pspeed = pointer.speed || 0;
      const touchActive = active || pspeed > 0.05;

      let sum = 0;
      for (let i = 0; i < N; i++) {
        let target = 0;
        if (active) {
          const dx = hx[i] - px, dy = hy[i] - py;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < pr) { const t = 1 - d / pr; target = pe * (t * t * (3 - 2 * t)); }
        }
        const cur = weave[i];
        const ease = target > cur ? EASE_UP : EASE_DOWN;
        const w = cur + (target - cur) * ease * dtn;
        weave[i] = w; sum += w;
        band[i] = w >= 1 ? 5 : (w * 5.999) | 0;

        const ew = w * w * (3 - 2 * w);
        // large, clearly visible idle drift so the loose field is alive & moving —
        // near fibers drift more than far ones, giving the layers a parallax feel
        const drift = (1 - ew) * 46 * (0.28 + depth[i] * 1.3);
        const lxx = lx[i] + Math.cos(time * 0.62 + phase[i]) * drift;
        const lyy = ly[i] + Math.sin(time * 0.54 + phase[i] * 1.3) * drift;
        const tx = lxx + (hx[i] - lxx) * ew;
        const ty = lyy + (hy[i] - lyy) * ew;
        let nvx = (vx[i] + (tx - cx[i]) * SPRING) * DAMP;
        let nvy = (vy[i] + (ty - cy[i]) * SPRING) * DAMP;

        // ripple: push loose fibers radially away from the cursor + a little wake
        if (touchActive && w < 0.85) {
          const dcx = cx[i] - px, dcy = cy[i] - py;
          const dc2 = dcx * dcx + dcy * dcy;
          if (dc2 < touchR2) {
            const dc = Math.sqrt(dc2) || 1;
            const fall = 1 - dc / touchR;
            const loose = 1 - w;
            const imp = fall * fall * loose * (0.25 + pspeed * 0.05);
            const invd = 1 / dc;
            nvx += dcx * invd * imp + pvx * 0.025 * fall * loose;
            nvy += dcy * invd * imp + pvy * 0.025 * fall * loose;
          }
        }
        vx[i] = nvx; vy[i] = nvy;
        const ncx = cx[i] + nvx, ncy = cy[i] + nvy;
        cx[i] = ncx; cy[i] = ncy;

        let c = cosL[i] + (cosH[i] - cosL[i]) * ew;
        let s = sinL[i] + (sinH[i] - sinL[i]) * ew;
        const inv = 1 / (Math.hypot(c, s) || 1); c *= inv; s *= inv;
        const hl = len[i] * 0.5;
        ex0[i] = ncx - c * hl; ey0[i] = ncy - s * hl;
        ex1[i] = ncx + c * hl; ey1[i] = ncy + s * hl;
      }
      this.gw = N ? sum / N : 0;
    }

    _slot(r, g, b, wc, bnd, dl) {
      // fold depth-band + colour + width-class + weave-band into one key so every
      // fiber is bucketed once and each bucket is a single stroke() at a fixed opacity
      const key = (((((r >> 4) << 9) | ((g >> 4) << 5) | ((b >> 4) << 1) | wc) * BANDS) + bnd) * 3 + dl;
      let s = this.map_.get(key);
      if (s === undefined) {
        s = this.buckets.length; this.map_.set(key, s); this.buckets.push([]);
        this.style.push('rgba(' + ((r & 0xF0) | 8) + ',' + ((g & 0xF0) | 8) + ',' + ((b & 0xF0) | 8) + ',' + BAND_ALPHA[bnd] + ')');
        this.wcls.push(wc); this.sdepth.push(dl);
      }
      return s;
    }

    draw(ctx) {
      const N = this.N, band = this.band, cr = this.cr, cg = this.cg, cb = this.cb, dlv = this.dlevel;
      const buckets = this.buckets, sdepth = this.sdepth;
      for (let s = 0; s < buckets.length; s++) buckets[s].length = 0;
      for (let i = 0; i < N; i++) {
        const lum = 0.3 * cr[i] + 0.59 * cg[i] + 0.11 * cb[i];
        buckets[this._slot(cr[i], cg[i], cb[i], lum < 120 ? 1 : 0, band[i], dlv[i])].push(i);
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const ex0 = this.ex0, ey0 = this.ey0, ex1 = this.ex1, ey1 = this.ey1, cm = this.curveMag;
      // far fibers are thinner, near ones thicker — draw back → mid → front so the
      // layers physically stack, deepening the field
      const depthW = [0.58, 1.0, 1.55];
      for (let lvl = 0; lvl < 3; lvl++) {
        const wmul = depthW[lvl];
        for (let s = 0; s < buckets.length; s++) {
          if (sdepth[s] !== lvl) continue;
          const arr = buckets[s];
          if (arr.length === 0) continue;
          ctx.strokeStyle = this.style[s];
          ctx.lineWidth = WIDTHS[this.wcls[s]] * wmul;
          ctx.beginPath();
          for (let k = 0; k < arr.length; k++) {
            const i = arr[k];
            const ax = ex0[i], ay = ey0[i], bx = ex1[i], by = ey1[i];
            ctx.moveTo(ax, ay);
            const c = cm[i];
            if (c !== 0) {
              // long curved thread: bow the segment through a perpendicular control point
              let dx = bx - ax, dy = by - ay; const il = 1 / (Math.hypot(dx, dy) || 1);
              ctx.quadraticCurveTo((ax + bx) * 0.5 - dy * il * c, (ay + by) * 0.5 + dx * il * c, bx, by);
            } else {
              ctx.lineTo(bx, by);
            }
          }
          ctx.stroke();
        }
      }
    }
  };
})(window.WOVEN = window.WOVEN || {});
