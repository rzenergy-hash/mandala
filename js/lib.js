/* ============================================================================
 * Woven — lib.js
 * Small math / noise / color / spline helpers shared by every system.
 * Everything hangs off a single global namespace so the files can load as
 * plain <script> tags (works from file://, no bundler required).
 * ========================================================================== */
(function (W) {
  'use strict';

  /* ---- scalar math -------------------------------------------------------- */
  W.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  W.lerp = (a, b, t) => a + (b - a) * t;
  W.smooth = (t) => t * t * (3 - 2 * t);
  W.smoothstep = (e0, e1, x) => {
    const t = W.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  W.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  /* ---- seeded RNG (mulberry32) ------------------------------------------- */
  W.mulberry32 = function (a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---- value noise + fbm -------------------------------------------------- */
  W.makeNoise = function (seed) {
    const rng = W.mulberry32((seed * 2654435761) >>> 0);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const g = (ix, iy) => perm[(perm[ix & 255] + (iy & 255)) & 511] / 255;

    function n2(x, y) {
      const fx = Math.floor(x), fy = Math.floor(y);
      const X = fx & 255, Y = fy & 255;
      const u = fade(x - fx), v = fade(y - fy);
      const aa = g(X, Y), ba = g(X + 1, Y), ab = g(X, Y + 1), bb = g(X + 1, Y + 1);
      const x1 = aa + (ba - aa) * u, x2 = ab + (bb - ab) * u;
      return x1 + (x2 - x1) * v; // 0..1
    }
    function fbm(x, y, oct, lac, gain) {
      oct = oct || 4; lac = lac || 2; gain = gain || 0.5;
      let amp = 0.5, f = 1, sum = 0, norm = 0;
      for (let o = 0; o < oct; o++) {
        sum += amp * n2(x * f, y * f);
        norm += amp; amp *= gain; f *= lac;
      }
      return sum / norm; // 0..1
    }
    return { n2, fbm };
  };

  /* ---- colour ------------------------------------------------------------- */
  W.mixRgb = (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  W.rgba = (c, a) =>
    'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';

  /* ---- Catmull-Rom spline through control points -------------------------- */
  W.catmull = function (cps, seg) {
    seg = seg || 16;
    const n = cps.length;
    if (n < 2) return cps.slice();
    const out = [];
    for (let i = 0; i < n - 1; i++) {
      const p0 = cps[Math.max(0, i - 1)], p1 = cps[i];
      const p2 = cps[i + 1], p3 = cps[Math.min(n - 1, i + 2)];
      for (let s = 0; s < seg; s++) {
        const t = s / seg, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    out.push({ x: cps[n - 1].x, y: cps[n - 1].y });
    return out;
  };

  /* jitter a colour a little for handcrafted, thread-to-thread variation */
  W.jitter = (rng, c, amt) => [
    c[0] + (rng() - 0.5) * amt,
    c[1] + (rng() - 0.5) * amt,
    c[2] + (rng() - 0.5) * amt,
  ];

  /* ---- muted, natural palette (warm linen ground; ink / moss / clay /
   *      flax / blue-gray forms — tuned to the reference image) ------------- */
  W.PALETTE = {
    paperTop: [233, 225, 206],
    paperBot: [211, 199, 174],
    mist: [223, 214, 196],
    ink: [32, 32, 28],
    charcoal: [54, 53, 47],
    softCharcoal: [82, 80, 71],
    mtnDark: [46, 52, 44],   // dark green-ink mountain body
    moss: [98, 110, 78],
    moss2: [124, 134, 96],
    sage: [150, 158, 124],
    olive: [140, 138, 92],
    flax: [196, 182, 150],
    linen: [214, 202, 176],
    flaxLight: [216, 203, 170],
    clay: [150, 120, 86],
    clayDark: [110, 86, 60],
    clayLight: [178, 150, 114],
    river: [104, 128, 144],
    riverDeep: [70, 96, 116],
    riverLight: [150, 170, 182],
    rootPale: [176, 156, 126],
  };
})(window.WOVEN = window.WOVEN || {});
