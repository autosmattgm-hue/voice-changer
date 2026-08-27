/*
 * voice changer — js/eq.js
 * --------------------------------------------------------------------------
 * Lightweight RBJ-standard biquad filters (used for OFFLINE rendering so the
 * downloaded file matches the live preview's EQ). During LIVE playback the
 * native WebAudio BiquadFilterNodes are used for efficiency and zero-glitch.
 * Also includes a 16-bit PCM WAV encoder for exporting audio.
 * --------------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EQJS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Returns [b0,b1,b2,a0,a1,a2] before normalization (a0 included).
  function calcCoeffs(type, freq, Q, gainDb, sr) {
    var A = Math.pow(10, gainDb / 40);
    var w0 = 2 * Math.PI * freq / sr;
    var cosw = Math.cos(w0);
    var sinw = Math.sin(w0);
    var alphaS = sinw / (2 * Q);
    var a0, a1, a2, b0, b1, b2;
    switch (type) {
      case 'lowshelf': {
        var al = sinw / 2 * Math.sqrt((A + 1 / A) * (1 / (Q || 0.707) - 1) + 2);
        var twoSqA = 2 * Math.sqrt(A) * al;
        b0 = A * ((A + 1) - (A - 1) * cosw + twoSqA);
        b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
        b2 = A * ((A + 1) - (A - 1) * cosw - twoSqA);
        a0 = (A + 1) + (A - 1) * cosw + twoSqA;
        a1 = -2 * ((A - 1) + (A + 1) * cosw);
        a2 = (A + 1) + (A - 1) * cosw - twoSqA;
        break;
      }
      case 'highshelf': {
        var ah = sinw / 2 * Math.sqrt((A + 1 / A) * (1 / (Q || 0.707) - 1) + 2);
        var twoSqAh = 2 * Math.sqrt(A) * ah;
        b0 = A * ((A + 1) + (A - 1) * cosw + twoSqAh);
        b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
        b2 = A * ((A + 1) + (A - 1) * cosw - twoSqAh);
        a0 = (A + 1) - (A - 1) * cosw + twoSqAh;
        a1 = 2 * ((A - 1) - (A + 1) * cosw);
        a2 = (A + 1) - (A - 1) * cosw - twoSqAh;
        break;
      }
      case 'highpass': {
        b0 = (1 + cosw) / 2;
        b1 = -(1 + cosw);
        b2 = (1 + cosw) / 2;
        a0 = 1 + alphaS;
        a1 = -2 * cosw;
        a2 = 1 - alphaS;
        break;
      }
      case 'lowpass': {
        b0 = (1 - cosw) / 2;
        b1 = 1 - cosw;
        b2 = (1 - cosw) / 2;
        a0 = 1 + alphaS;
        a1 = -2 * cosw;
        a2 = 1 - alphaS;
        break;
      }
      case 'peaking':
      default: {
        b0 = 1 + alphaS * A;
        b1 = -2 * cosw;
        b2 = 1 - alphaS * A;
        a0 = 1 + alphaS / A;
        a1 = -2 * cosw;
        a2 = 1 - alphaS / A;
      }
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  function Biquad(coefs) {
    this.b0 = coefs.b0; this.b1 = coefs.b1; this.b2 = coefs.b2;
    this.a1 = coefs.a1; this.a2 = coefs.a2;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
  Biquad.prototype.process = function (buf) {
    var b0 = this.b0, b1 = this.b1, b2 = this.b2, a1 = this.a1, a2 = this.a2;
    var x1 = this.x1, x2 = this.x2, y1 = this.y1, y2 = this.y2;
    for (var i = 0; i < buf.length; i++) {
      var x = buf[i];
      var y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      buf[i] = y;
    }
    this.x1 = x1; this.x2 = x2; this.y1 = y1; this.y2 = y2;
  };

  // Build an offline EQ pipeline from a preset's {eq} descriptor.
  function buildChain(eq, sr) {
    var filters = [];
    sr = sr || 44100;
    if (!eq) eq = {};
    if (eq.highpass) filters.push(new Biquad(calcCoeffs('highpass', eq.highpass.f, eq.highpass.Q || 0.707, 0, sr)));
    ['low', 'mid', 'high'].forEach(function (band) {
      var b = eq[band];
      if (!b || b.gain === 0) return;
      var type = band === 'mid' ? 'peaking' : (band === 'low' ? 'lowshelf' : 'highshelf');
      filters.push(new Biquad(calcCoeffs(type, b.f, b.Q || 0.707, b.gain, sr)));
    });
    return filters;
  }

  function applyChain(buf, chain) {
    for (var i = 0; i < chain.length; i++) chain[i].process(buf);
    return buf;
  }

  // ---- WAV encoder (16-bit PCM, multi channel) ---------------------
  function encodeWav(channels, sampleRate) {
    var numCh = channels.length;
    var frames = channels[0].length;
    var bytesPerSample = 2;
    var dataSize = frames * numCh * bytesPerSample;
    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);
    function writeStr(offset, str) {
      for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);            // PCM
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numCh * bytesPerSample, true);
    view.setUint16(32, numCh * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    var offset = 44;
    for (var f = 0; f < frames; f++) {
      for (var c = 0; c < numCh; c++) {
        var s = channels[c][f];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        var v = s < 0 ? s * 0x8000 : s * 0x7FFF;
        view.setInt16(offset, v, true);
        offset += 2;
      }
    }
    return buffer;
  }

  /* ---------------- FX helpers (fade / fx-EQ / normalize) ---------- */
  // Apply equal-power fade-in/[out] (in seconds) to every channel.
  function fadeChannels(chans, fadeInSec, fadeOutSec, sr) {
    if ((!fadeInSec && !fadeOutSec) || !chans.length) return chans;
    sr = sr || 44100;
    var n = chans[0].length;
    var fi = Math.min(fadeInSec || 0, n / sr);
    var fo = Math.min(fadeOutSec || 0, n / sr);
    var fiN = Math.round(fi * sr);
    var foN = Math.round(fo * sr);
    if (fiN > 1 || foN > 1) {
      for (var c = 0; c < chans.length; c++) {
        var buf = chans[c];
        for (var i = 0; i < fiN && i < n; i++) buf[i] *= (i / fiN) * (i / fiN);
        for (i = 0; i < foN && i < n; i++) {
          var j = n - 1 - i;
          if (j < 0) break;
          var g = (i / foN) * (i / foN);
          buf[j] *= g;
        }
      }
    }
    return chans;
  }

  // Extra voice/EQ sweetening bands (bass/mid/treble gains in dB). Returns a
  // biquad chain in the same "peaking / shelf" family used elsewhere.
  function fxChain(sr, bassDb, midDb, trebleDb) {
    var list = [];
    if (bassDb) list.push(new Biquad(calcCoeffs('lowshelf', 120, 0.707, bassDb, sr)));
    if (midDb) list.push(new Biquad(calcCoeffs('peaking', 1500, 1.0, midDb, sr)));
    if (trebleDb) list.push(new Biquad(calcCoeffs('highshelf', 6500, 0.707, trebleDb, sr)));
    return list;
  }
  function applyFxBuffer(chans, bassDb, midDb, trebleDb, sr) {
    if (!bassDb && !midDb && !trebleDb) return chans;
    var chain = fxChain(sr, bassDb, midDb, trebleDb);
    chans.forEach(function (ch) { applyChain(ch, chain); });
    return chans;
  }

  // Peak-normalize to a target (default ~0.96). No-op if already quiet.
  function normalizeChannels(chans, target) {
    target = target || 0.96;
    var peak = 0;
    chans.forEach(function (ch) { for (var i = 0; i < ch.length; i++) { var a = Math.abs(ch[i]); if (a > peak) peak = a; } });
    if (peak <= 1e-6) return chans;
    var g = (peak > target) ? target / peak : 1;
    if (g >= 1) return chans;
    chans.forEach(function (ch) { for (var i = 0; i < ch.length; i++) ch[i] *= g; });
    return chans;
  }

  return {
    calcCoeffs: calcCoeffs,
    Biquad: Biquad,
    buildChain: buildChain,
    applyChain: applyChain,
    encodeWav: encodeWav,
    fadeChannels: fadeChannels,
    fxChain: fxChain,
    applyFxBuffer: applyFxBuffer,
    normalizeChannels: normalizeChannels
  };
});