/* ============================================================================
 * Woven — audio.js
 * A soft, procedurally-synthesised "weaving" sound (Web Audio API — no files,
 * so the piece stays self-contained). It has two blended voices driven by the
 * interaction:
 *   - a filtered-noise RUSTLE that rises as the cursor moves through / gathers
 *     the fibers (brighter the more woven it is), and
 *   - a gentle tonal SHIMMER that swells as the image weaves together and fades
 *     — plus a little airy whoosh when the fibers fly away (energy dropping).
 * Browsers block audio until a user gesture, so it starts on first interaction.
 * ========================================================================== */
(function (W) {
  'use strict';

  W.AudioSystem = class AudioSystem {
    constructor() { this.ctx = null; this.ready = false; this._prevE = 0; this._env = 0; }

    /* Lazily build the graph inside a user gesture, then resume. */
    resume() {
      if (!this.ctx) this._init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    _init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;

      // ---- looping pink-ish noise buffer (the thread rustle) ----------------
      const len = (ctx.sampleRate * 2) | 0;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99 * b0 + white * 0.05;
        b1 = 0.963 * b1 + white * 0.083;
        b2 = 0.90 * b2 + white * 0.121;
        d[i] = (b0 + b1 + b2 + white * 0.09) * 0.4;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf; noise.loop = true;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.7;
      const noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
      noise.connect(bp); bp.connect(noiseGain);

      // a stereo panner so the rustle sits where the cursor is on the canvas —
      // it sweeps left/right as you move, so the sound "follows" the hand
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const master = ctx.createGain(); master.gain.value = 1.0;
      if (panner) { noiseGain.connect(panner); panner.connect(master); }
      else noiseGain.connect(master);
      master.connect(ctx.destination);

      noise.start();
      this.bp = bp; this.noiseGain = noiseGain; this.master = master; this.panner = panner;
      this.ready = true;
    }

    /* Called every frame with the interaction state. Just the fiber rustle —
     * no tonal drone. The loudness tracks the cursor's INSTANTANEOUS motion (not
     * the slow weave energy) so the rustle rises the moment the hand moves and
     * falls the moment it stops — in sync, no swell-in or trailing tail. */
    update(energy, speed, nx, ny) {
      if (!this.ready) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const motion = Math.min(1, (speed || 0) / 14);
      // snappy attack, quick (but not abrupt) release
      const k = motion > this._env ? 0.6 : 0.22;
      this._env += (motion - this._env) * k;
      const dE = energy - this._prevE; this._prevE = energy;
      const flyAway = Math.max(0, -dE) * 6;               // scattering whoosh

      const noiseTarget = 0.17 * this._env + Math.min(0.10, flyAway * 0.5);
      // brightness rises with motion AND with how high on the canvas you are, so
      // the timbre shifts as you move around — not just louder/quieter
      const hy = (ny == null ? 0.5 : ny);
      const freq = 340 + this._env * 1400 + energy * 340 + (1 - hy) * 360;

      // short time-constants so the WebAudio ramp follows the envelope closely
      this.noiseGain.gain.setTargetAtTime(noiseTarget, t, motion > this._env ? 0.015 : 0.05);
      this.bp.frequency.setTargetAtTime(freq, t, 0.04);

      // pan the rustle to the cursor's horizontal position (soft, not hard-panned)
      if (this.panner && nx != null) {
        const pan = W.clamp((nx - 0.5) * 1.7, -0.9, 0.9);
        this.panner.pan.setTargetAtTime(pan, t, 0.04);
      }
    }
  };
})(window.WOVEN = window.WOVEN || {});
