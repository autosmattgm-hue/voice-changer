/*
 * voice changer — js/noise.js
 * --------------------------------------------------------------------------
 * Background noise cancellation via FFT-based SPECTRAL SUBTRACTION.
 *   - Radix-2 FFT, Hann-windowed, 50% overlap-add for clean reconstruction.
 *   - Keeps an adaptive "noise profile" (average magnitude per bin); frames
 *     near the background energy update it, speech frames subtract it.
 *   - Same family used in phones/cameras for hum, hiss, fan & room tone.
 * Runs in ANY browser (script) and in Node.js (module.exports) for tests.
 * --------------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NoiseJS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- radix-2 FFT (in-place, re/im Float32Arrays) ---------- */
  function fft(re, im, inverse) {
    var n = re.length;
    var i, j, bit;
    for (i = 1, j = 0; i < n; i++) {
      bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = 2 * Math.PI / len * (inverse ? -1 : 1);
      var wpr = Math.cos(ang), wpi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var wr = 1, wi = 0;
        for (var k = 0; k < len / 2; k++) {
          var l = i + k, r = i + k + len / 2;
          var ur = re[r], ui = im[r];
          var vr = ur * wr - ui * wi;
          var vi = ur * wi + ui * wr;
          re[r] = re[l] - vr; im[r] = im[l] - vi;
          re[l] = re[l] + vr; im[l] = im[l] + vi;
          var nwr = wr * wpr - wi * wpi;
          wi = wr * wpi + wi * wpr;
          wr = nwr;
        }
      }
    }
    if (inverse) { for (i = 0; i < n; i++) { re[i] /= n; im[i] /= n; } }
  }

  function makeHann(n) {
    var w = new Float32Array(n);
    for (var i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    return w;
  }
  function nextPow2(n) { var k = 2; while (k < n) k <<= 1; return k; }

  // Map a user strength 0..1 to an over-subtraction factor (1..2.2).
  function overSubFor(strength) { return 1.0 + Math.max(0, Math.min(1, strength)) * 1.2; }
  function gateFor(strength) { return 1.5 + Math.max(0, Math.min(1, strength)) * 0.7; }

  /* ------------------------------------------------------------------ *
   *  NoiseReducer — streaming spectral-subtraction engine.
   * ------------------------------------------------------------------ */
  function NoiseReducer(opts) {
    opts = opts || {};
    this.block = nextPow2(opts.block || 2048);
    this.hop = this.block >> 1;
    this.sr = opts.sampleRate || 44100;
    this.overSub = (opts.overSub != null) ? opts.overSub : 1.5;
    this.gateRatio = (opts.gateRatio != null) ? opts.gateRatio : 2.0;
    this.spectralFloor = opts.spectralFloor != null ? opts.spectralFloor : 0.05;
    this.updateSpeed = opts.updateSpeed != null ? opts.updateSpeed : 0.5;

    this.hann = makeHann(this.block);
    this.re = new Float32Array(this.block);
    this.im = new Float32Array(this.block);
    this.mag = new Float32Array(this.block / 2 + 1);
    this.noiseMag = new Float32Array(this.block / 2 + 1);
    this.trained = false;

    this._in = new Float32Array(this.block);   // rolling input window
    this._acc = new Float32Array(this.block);  // overlap-add accumulator
    this._wacc = new Float32Array(this.block); // window-energy denominator
    this.bg = 1e-9;                            // smoothed background energy
  }

  NoiseReducer.prototype.reset = function (resetProfile) {
    this._in.fill(0); this._acc.fill(0); this._wacc.fill(0);
    this.bg = 1e-9;
    if (resetProfile) { this.noiseMag.fill(0); this.trained = false; }
  };

  // Process a chunk of mono samples (Float32Array) -> Float32Array of same length.
  NoiseReducer.prototype.process = function (samples) {
    var total = samples.length;
    if (total === 0) return samples;
    var out = new Float32Array(total);
    var oi = 0, si = 0;
    while (total - si >= this.hop) {
      this._feed(samples, si, this.hop);
      si += this.hop;
      this._processWindow(out, oi, this.hop);
      oi += this.hop;
    }
    if (si < total) {
      var rem = total - si;
      this._feed(samples, si, rem);   // pads the tail with zeros internally
      this._processWindow(out, oi, rem);
    }
    return out;
  };

  // Shift the input window left by `hop` and push new samples into the tail.
  NoiseReducer.prototype._feed = function (samples, from, count) {
    var b = this.block, h = this.hop, i;
    for (i = 0; i < b - h; i++) this._in[i] = this._in[i + h];
    for (i = 0; i < h; i++) {
      var idx = from + i;
      this._in[b - h + i] = (idx < samples.length) ? samples[idx] : 0;
    }
  };

  NoiseReducer.prototype._processWindow = function (out, offset, emit) {
    var b = this.block, hb = b >> 1, i, bin;
    // analysis: window + FFT
    for (i = 0; i < b; i++) { this.re[i] = this._in[i] * this.hann[i]; this.im[i] = 0; }
    fft(this.re, this.im, false);
    // magnitude + energy
    var E = 0;
    for (bin = 0; bin <= hb; bin++) {
      var rr = this.re[bin], ii = this.im[bin];
      var m = Math.sqrt(rr * rr + ii * ii);
      this.mag[bin] = m;
      if (bin < hb) E += 2 * m * m;          // parseval-ish energy of real spectrum
    }
    var ratio = E / (this.bg + 1e-12);
    this.bg = this.bg * 0.85 + E * 0.15;     // leaky background tracker

    // learn if untrained or this frame looks like noise
    if (!this.trained || ratio < this.gateRatio) {
      if (!this.trained) {
        for (bin = 0; bin <= hb; bin++) this.noiseMag[bin] = this.mag[bin];
        this.trained = true;
      } else {
        var sp = this.updateSpeed;
        for (bin = 0; bin <= hb; bin++) {
          this.noiseMag[bin] = this.noiseMag[bin] * (1 - sp) + this.mag[bin] * sp;
        }
      }
    }

    // subtract the noise profile (keep phase); mirror bins for a real output
    for (bin = 0; bin <= hb; bin++) {
      var nm = this.noiseMag[bin];
      var floorVal = this.spectralFloor * nm;
      var reduced = this.mag[bin] - this.overSub * nm;
      if (reduced < 0) reduced = (this.mag[bin] > floorVal) ? floorVal : 0;
      var orig = this.mag[bin] + 1e-12;
      var scale = reduced / orig;
      this.re[bin] *= scale; this.im[bin] *= scale;
      if (bin > 0 && bin < hb) { this.re[b - bin] *= scale; this.im[b - bin] *= scale; }
    }

    // inverse + synthesis window + overlap-add
    fft(this.re, this.im, true);
    for (i = 0; i < b; i++) {
      var synth = this.re[i] * this.hann[i];
      this._acc[i] += synth;
      this._wacc[i] += this.hann[i] * this.hann[i];
    }
    for (i = 0; i < emit; i++) {
      var den = this._wacc[i];
      out[offset + i] = den > 1e-6 ? this._acc[i] / den : 0;
    }
    // shift accumulators by the fixed hop
    for (i = 0; i < b - this.hop; i++) { this._acc[i] = this._acc[i + this.hop]; this._wacc[i] = this._wacc[i + this.hop]; }
    for (i = b - this.hop; i < b; i++) { this._acc[i] = 0; this._wacc[i] = 0; }
  };

  /* Convenience: reduce a whole mono channel (e.g., an audio file track). */
  function reduceChannel(ch, sr, strength) {
    var r = new NoiseReducer({ sampleRate: sr, overSub: overSubFor(strength), gateRatio: gateFor(strength) });
    return r.process(ch);
  }
  function reduceChannels(chans, sr, strength) {
    var out = [];
    for (var c = 0; c < chans.length; c++) out.push(reduceChannel(chans[c], sr, strength));
    return out;
  }

  return {
    fft: fft,
    NoiseReducer: NoiseReducer,
    reduceChannel: reduceChannel,
    reduceChannels: reduceChannels,
    overSubFor: overSubFor,
    gateFor: gateFor
  };
});