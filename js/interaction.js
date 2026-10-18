/* ============================================================================
 * Woven — interaction.js
 * Turns pointer / touch presence into an attraction field. Energy rises while
 * the pointer moves and lingers briefly, then decays — so a swept area stays
 * woven for a moment before it dissolves, letting the visitor reveal a large
 * part of the artwork by moving through it. Interaction is always local:
 * only fibers whose home lies within `radius` of the pointer are called back.
 * ========================================================================== */
(function (W) {
  'use strict';

  W.InteractionSystem = class InteractionSystem {
    constructor(canvas, cw, ch, radiusFrac) {
      this.canvas = canvas;
      this.radiusFrac = radiusFrac || 0.30;
      // vx/vy/speed feed the "touch the water" ripple; energy feeds the weave
      this.pointer = { x: -1e5, y: -1e5, energy: 0, radius: 240, vx: 0, vy: 0, speed: 0 };
      this._lastMove = -1e5;
      this._present = false;
      this.resize(cw, ch);

      const move = (cx, cy) => {
        const r = canvas.getBoundingClientRect();
        const nx = cx - r.left, ny = cy - r.top;
        if (this.pointer.x > -1e4) {
          this.pointer.vx = W.clamp(nx - this.pointer.x, -70, 70);
          this.pointer.vy = W.clamp(ny - this.pointer.y, -70, 70);
        }
        this.pointer.x = nx; this.pointer.y = ny;
        this._lastMove = performance.now();
        this._present = true;
      };
      canvas.addEventListener('pointermove', (e) => move(e.clientX, e.clientY), { passive: true });
      canvas.addEventListener('pointerdown', (e) => move(e.clientX, e.clientY), { passive: true });
      canvas.addEventListener('pointerleave', () => { this._present = false; });
      canvas.addEventListener('touchmove', (e) => {
        if (e.touches[0]) move(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: true });
    }

    resize(cw, ch) {
      // radius of the fiber-gather field around the cursor (the crisp image disc
      // inside it is smaller still — see _revealFinal)
      this.pointer.radius = Math.max(120, Math.min(cw, ch) * this.radiusFrac);
    }

    update(now) {
      const idle = now - this._lastMove;
      let target = 0;
      // hold briefly after the cursor stops, then let energy decay -> the image
      // fades and the fibers fly away together
      if (this._present && idle < 500) target = 1;
      else if (this._present) target = Math.max(0, 1 - (idle - 500) / 1600);
      // ease slowly so the gathering reads as a clear, gradual process and the
      // fibers (which gather faster) visibly lead the image reveal
      this.pointer.energy += (target - this.pointer.energy) * 0.04;
      // cursor velocity decays between moves -> speed drives ripple strength
      this.pointer.vx *= 0.8; this.pointer.vy *= 0.8;
      this.pointer.speed = Math.hypot(this.pointer.vx, this.pointer.vy);
    }
  };
})(window.WOVEN = window.WOVEN || {});
