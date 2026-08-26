/*
 * voice changer — js/pitch.js
 * --------------------------------------------------------------------------
 * A dependency-free port of the SoundTouch time-domain pitch engine
 * (WSOLA "Stretch" + linear-interpolation "RateTransposer").
 *
 * Algorithm re-implemented from the public SoundTouch algorithm (originally
 * © Olli Parviainen) so it runs in ANY browser (plain <script>) and in
 * Node.js (module.exports) for automated testing. The WSOLA overlap-add
 * engine with its cross-correlation "best offset" search is what keeps the
 * shifted voice smooth and HUMAN-sounding rather than robotic.
 *
 * Core mapping: pitch factor P  ->  tempo(stretch) = 1/P, rate = P, with the
 * pipeline order (Stretch->Rate or Rate->Stretch) chosen by P so the total
 * duration is preserved while the pitch is shifted by P.
 * --------------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VoicePitch = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_OVERLAP_MS = 8;
  var DEFAULT_SR = 44100;

  var AUTOSEQ_AT_MIN = 125.0, AUTOSEQ_AT_MAX = 50.0;
  var AUTOSEQ_K = (AUTOSEQ_AT_MAX - AUTOSEQ_AT_MIN) / 1.5;
  var AUTOSEQ_C = AUTOSEQ_AT_MIN - AUTOSEQ_K * 0.5;

  var AUTOSEEK_AT_MIN = 25.0, AUTOSEEK_AT_MAX = 15.0;
  var AUTOSEEK_K = (AUTOSEEK_AT_MAX - AUTOSEEK_AT_MIN) / 1.5;
  var AUTOSEEK_C = AUTOSEEK_AT_MIN - AUTOSEEK_K * 0.5;

  /* ---------------------------------------------------------------- *
   * FifoBuffer — FIFO with internal compaction (frames x channels).
   * ---------------------------------------------------------------- */
  function FifoBuffer(ch) {
    this._ch = ch || 1;
    this._vector = new Float32Array(0);
    this._position = 0;
    this._frameCount = 0;
  }
  FifoBuffer.prototype._start = function () { return this._position * this._ch; };
  FifoBuffer.prototype._end = function () { return (this._position + this._frameCount) * this._ch; };
  Object.defineProperty(FifoBuffer.prototype, 'frameCount', {
    get: function () { return this._frameCount; }
  });
  Object.defineProperty(FifoBuffer.prototype, 'vector', {
    get: function () { return this._vector; }
  });
  FifoBuffer.prototype.rewind = function () {
    if (this._position > 0) {
      this._vector.set(this._vector.subarray(this._start(), this._end()));
      this._position = 0;
    }
  };
  FifoBuffer.prototype.ensureCapacity = function (numFrames) {
    var min = parseInt(numFrames * this._ch, 10);
    if (this._vector.length < min) {
      var nv = new Float32Array(min);
      nv.set(this._vector.subarray(this._start(), this._end()));
      this._vector = nv;
      this._position = 0;
    } else {
      this.rewind();
    }
  };
  FifoBuffer.prototype.ensureAdditionalCapacity = function (n) {
    this.ensureCapacity(this._frameCount + n);
  };
  FifoBuffer.prototype.putArray = function (src, startFrame, numFrames) {
    var n = (typeof numFrames === 'number' && numFrames >= 0) ? numFrames
          : (src.length - startFrame) / this._ch;
    var sn = n * this._ch;
    this.ensureCapacity(n + this._frameCount);
    this._vector.set(src.subarray(startFrame * this._ch, startFrame * this._ch + sn), this._end());
    this._frameCount += n;
  };
  FifoBuffer.prototype.put = function (numFrames) { this._frameCount += numFrames; };
  FifoBuffer.prototype.receive = function (numFrames) {
    if (typeof numFrames !== 'number' || numFrames < 0 || numFrames > this._frameCount) {
      numFrames = this._frameCount;
    }
    this._frameCount -= numFrames;
    this._position += numFrames;
  };
  FifoBuffer.prototype.clear = function () {
    this.receive(this._frameCount);
    this.rewind();
  };

  /* ---------------------------------------------------------------- *
   * RateTransposer — resampling stage (linear interpolation). Output
   * frames ~= input/rate, shifting pitch; the Stretch stage re-times it.
   * ---------------------------------------------------------------- */
  function RateTransposer(ch) {
    this._ch = ch || 1;
    this.slopeCount = 0;
    this.prevSamples = new Float32Array(this._ch);
    this._rate = 1;
  }
  RateTransposer.prototype.transpose = function (input, output) {
    var ch = this._ch;
    var src = input.vector;
    var srcOffset = input._start();
    var dest = output.vector;
    var destOffset = output._end();
    var numFrames = input.frameCount;
    if (numFrames === 0) return 0;
    var rate = this._rate;
    var used = 0, i = 0, c;
    while (this.slopeCount < 1.0) {
      for (c = 0; c < ch; c++) {
        dest[destOffset + i * ch + c] =
          (1.0 - this.slopeCount) * this.prevSamples[c] + this.slopeCount * src[srcOffset + c];
      }
      i++; this.slopeCount += rate;
    }
    this.slopeCount -= 1.0;
    if (numFrames !== 1) {
      outer:
      while (true) {
        while (this.slopeCount > 1.0) {
          this.slopeCount -= 1.0; used++;
          if (used >= numFrames - 1) break outer;
        }
        var s = srcOffset + used * ch;
        for (c = 0; c < ch; c++) {
          dest[destOffset + i * ch + c] =
            (1.0 - this.slopeCount) * src[s + c] + this.slopeCount * src[s + ch + c];
        }
        i++; this.slopeCount += rate;
      }
    }
    for (c = 0; c < ch; c++) {
      this.prevSamples[c] = src[srcOffset + (numFrames - 1) * ch + c];
    }
    return i;
  };
  RateTransposer.prototype.process = function (input, output) {
    output.ensureAdditionalCapacity(Math.ceil(input.frameCount / this._rate) + 1);
    var nOut = this.transpose(input, output);
    output.put(nOut);
    input.receive(input.frameCount);
    return nOut;
  };
  Object.defineProperty(RateTransposer.prototype, 'rate', {
    get: function () { return this._rate; },
    set: function (r) { this._rate = r; }
  });
  /* ---------------------------------------------------------------- *
   * Stretch — WSOLA time-domain pitch/time engine.
   * ---------------------------------------------------------------- */
  var SCAN_OFFSETS = [
    [124, 186, 248, 310, 372, 434, 496, 558, 620, 682, 744, 806, 868, 930, 992,
     1054, 1116, 1178, 1240, 1302, 1364, 1426, 1488, 0],
    [-100, -75, -50, -25, 25, 50, 75, 100, 0],
    [-20, -15, -10, -5, 5, 10, 15, 20, 0],
    [-4, -3, -2, -1, 1, 2, 3, 4, 0]
  ];

  function Stretch(ch) {
    this._ch = ch || 1;
    this._quickSeek = true;
    this.midBufferDirty = true;
    this.midBuffer = null;
    this.refMidBuffer = null;
    this.overlapLength = 0;
    this.autoSeqSetting = true;
    this.autoSeekSetting = true;
    this._tempo = 1;
    this.sampleRate = DEFAULT_SR;
    this.overlapMs = DEFAULT_OVERLAP_MS;
    this.sequenceMs = 50;
    this.seekWindowMs = 20;
    this.seekWindowLength = 0;
    this.seekLength = 0;
    this.nominalSkip = 0;
    this.skipping = 0;
    this.sampleReq = 0;
    this.setParameters(DEFAULT_SR, 0, 0, DEFAULT_OVERLAP_MS);
  }
  Stretch.prototype.checkLimits = function (x, mi, ma) {
    return x < mi ? mi : (x > ma ? ma : x);
  };
  Stretch.prototype.calculateOverlapLength = function (ovlMs) {
    var newOvl = this.sampleRate * ovlMs / 1000;
    if (newOvl < 16) newOvl = 16;
    newOvl -= newOvl % 8;
    this.overlapLength = newOvl;
    this.refMidBuffer = new Float32Array(newOvl * this._ch);
    this.midBuffer = new Float32Array(newOvl * this._ch);
  };
  Stretch.prototype.calculateSequenceParameters = function () {
    var seq, seek;
    if (this.autoSeqSetting) {
      seq = AUTOSEQ_C + AUTOSEQ_K * this._tempo;
      seq = this.checkLimits(seq, AUTOSEQ_AT_MAX, AUTOSEQ_AT_MIN);
      this.sequenceMs = Math.floor(seq + 0.5);
    }
    if (this.autoSeekSetting) {
      seek = AUTOSEEK_C + AUTOSEEK_K * this._tempo;
      seek = this.checkLimits(seek, AUTOSEEK_AT_MAX, AUTOSEEK_AT_MIN);
      this.seekWindowMs = Math.floor(seek + 0.5);
    }
    this.seekWindowLength = Math.floor(this.sampleRate * this.sequenceMs / 1000);
    this.seekLength = Math.floor(this.sampleRate * this.seekWindowMs / 1000);
  };
  Stretch.prototype.setParameters = function (sampleRate, seqMs, seekMs, ovlMs) {
    if (sampleRate > 0) this.sampleRate = sampleRate;
    if (ovlMs > 0) this.overlapMs = ovlMs;
    if (seqMs > 0) { this.sequenceMs = seqMs; this.autoSeqSetting = false; }
    else { this.autoSeqSetting = true; }
    if (seekMs > 0) { this.seekWindowMs = seekMs; this.autoSeekSetting = false; }
    else { this.autoSeekSetting = true; }
    this.calculateSequenceParameters();
    this.calculateOverlapLength(this.overlapMs);
    this.tempo = this._tempo;
  };
  Object.defineProperty(Stretch.prototype, 'tempo', {
    get: function () { return this._tempo; },
    set: function (t) {
      this._tempo = t;
      this.calculateSequenceParameters();
      this.nominalSkip = this._tempo * (this.seekWindowLength - this.overlapLength);
      this.skipping = 0;
      var intskip = Math.floor(this.nominalSkip + 0.5);
      this.sampleReq = Math.max(intskip + this.overlapLength, this.seekWindowLength) + this.seekLength;
      this.midBufferDirty = true;
      this.midBuffer = null;
    }
  });
  Stretch.prototype._corrRef = function () {
    var ch = this._ch, ovl = this.overlapLength;
    for (var i = 0; i < ovl; i++) {
      var wi = i * (ovl - i);
      for (var c = 0; c < ch; c++) {
        this.refMidBuffer[i * ch + c] = this.midBuffer[i * ch + c] * wi;
      }
    }
  };
  Stretch.prototype.crossAt = function (input, offset) {
    var ch = this._ch, ovl = this.overlapLength;
    var m = 0, o = input._start() + offset * ch;
    for (var i = 1; i < ovl; i++) {
      for (var c = 0; c < ch; c++) {
        m += input.vector[o + i * ch + c] * this.refMidBuffer[i * ch + c];
      }
    }
    return m;
  };
  Stretch.prototype.findBestSeek = function (input) {
    var i;
    this._corrRef();
    var bestCorr = Number.MIN_VALUE, bestOffset = 0;
    if (!this._quickSeek) {
      for (i = 0; i < this.seekLength; i++) {
        var v = this.crossAt(input, i);
        if (v > bestCorr) { bestCorr = v; bestOffset = i; }
      }
      return bestOffset;
    }
    var correlationOffset = 0, tempOffset, s, scan;
    for (scan = 0; scan < 4; scan++) {
      var corr = bestCorr, off = bestOffset;
      for (s = 0; s < SCAN_OFFSETS[scan].length; s++) {
        tempOffset = correlationOffset + SCAN_OFFSETS[scan][s];
        if (tempOffset >= this.seekLength) break;
        var val = this.crossAt(input, tempOffset);
        if (val > corr) { corr = val; off = tempOffset; }
      }
      correlationOffset = off; bestCorr = corr; bestOffset = off;
    }
    return bestOffset;
  };
  Stretch.prototype.process = function (input, output) {
    if (this.midBuffer === null) {
      if (input.frameCount < this.overlapLength) return 0;
      this.midBuffer = new Float32Array(this.overlapLength * this._ch);
      for (var k = 0; k < this.overlapLength * this._ch; k++) {
        this.midBuffer[k] = input.vector[input._start() + k];
      }
      input.receive(this.overlapLength);
    }
    var ch = this._ch;
    var outFrames = 0;
    while (input.frameCount >= this.sampleReq) {
      var offset = this.findBestSeek(input);
      var ovl = this.overlapLength;
      output.ensureAdditionalCapacity(ovl);
      var out0 = output._end();
      output.put(ovl);
      for (var i = 0; i < ovl; i++) {
        var fi = i * (1 / ovl), fo = (ovl - i) * (1 / ovl);
        for (var c = 0; c < ch; c++) {
          var src = input.vector[input._start() + (offset + i) * ch + c];
          output.vector[out0 + i * ch + c] = src * fi + this.midBuffer[i * ch + c] * fo;
        }
      }
      outFrames += ovl;
      var temp = this.seekWindowLength - 2 * ovl;
      if (temp > 0) {
        output.ensureAdditionalCapacity(temp);
        var outI = output._end();
        output.put(temp);
        for (var m = 0; m < temp; m++) {
          for (c = 0; c < ch; c++) {
            output.vector[outI + m * ch + c] =
              input.vector[input._start() + (offset + ovl + m) * ch + c];
          }
        }
        outFrames += temp;
      }
      var mb0 = input._start() + (offset + this.seekWindowLength - ovl) * ch;
      for (var j = 0; j < ovl * ch; j++) {
        var g = input.vector[mb0 + j];
        this.midBuffer[j] = (g === g) ? g : 0;
      }
      this.skipping += this.nominalSkip;
      var overlapSkip = Math.floor(this.skipping);
      this.skipping -= overlapSkip;
      input.receive(overlapSkip);
    }
    if (outFrames > 0) this.midBufferDirty = false;
    return outFrames;
  };
  Stretch.prototype.clear = function () { this.midBuffer = null; };

  /* ---------------------------------------------------------------- *
   * Sonic — the public multi-stage engine combining Stretch + Rate.
   * ---------------------------------------------------------------- */
  function Sonic(ch) {
    this.ch = ch || 1;
    this.trans = new RateTransposer(this.ch);
    this.stretch = new Stretch(this.ch);
    this.input = new FifoBuffer(this.ch);
    this.inter = new FifoBuffer(this.ch);
    this.output = new FifoBuffer(this.ch);
    this.vRate = 1; this.vTempo = 1; this.vPitch = 1;
    this.effTempo = 1; this.effRate = 1;
    this._recalc();
  }
  Sonic.prototype._recalc = function () {
    this.effTempo = this.vTempo / this.vPitch;
    this.effRate = this.vRate * this.vPitch;
    this.stretch.tempo = this.effTempo;
    this.trans.rate = this.effRate;
  };
  Object.defineProperty(Sonic.prototype, 'pitch', {
    get: function () { return this.vPitch; },
    set: function (p) { this.vPitch = p; this._recalc(); }
  });
  Object.defineProperty(Sonic.prototype, 'tempo', {
    get: function () { return this.vTempo; },
    set: function (t) { this.vTempo = t; this._recalc(); }
  });
  Object.defineProperty(Sonic.prototype, 'rate', {
    get: function () { return this.vRate; },
    set: function (r) { this.vRate = r; this._recalc(); }
  });
  Object.defineProperty(Sonic.prototype, 'pitchSemitones', {
    get: function () { return 12 / Math.LN2 * Math.log(this.vPitch); },
    set: function (s) { this.pitch = Math.pow(2, s / 12); }
  });
  Sonic.prototype.feed = function (frames) {
    this.input.putArray(frames, 0, frames.length / this.ch);
  };
  Sonic.prototype.processOnce = function () {
    if (this.effRate > 1) {
      this.stretch.process(this.input, this.inter);
      this.trans.process(this.inter, this.output);
    } else {
      this.trans.process(this.input, this.inter);
      this.stretch.process(this.inter, this.output);
    }
  };
  Sonic.prototype.processUntil = function (target, maxGuard) {
    var guard = 0, g = typeof maxGuard === 'number' ? maxGuard : 100000;
    while (this.output.frameCount < target && guard++ < g) {
      var beforeIn = this.input.frameCount;
      this.processOnce();
      if (this.input.frameCount === beforeIn && this.output.frameCount < target) {
        // no forward progress possible; break to avoid infinite loop
        break;
      }
    }
  };

  /* ---------------------------------------------------------------- *
   * Offline helper — pitch-shift one mono channel (duration preserved).
   * ---------------------------------------------------------------- */
  function shiftChannel(channel, pitch, sampleRate) {
    var total = channel.length;
    if (total === 0) return new Float32Array(0);
    var sonic = new Sonic(1);
    sonic.pitch = pitch;
    sonic.feed(channel);
    sonic.processUntil(total, 1000000);
    var out = new Float32Array(total);
    var avail = sonic.output.frameCount;
    var n = Math.min(total, avail);
    var base = sonic.output._start();
    var vec = sonic.output.vector;
    for (var i = 0; i < n; i++) {
      var v = vec[base + i];
      out[i] = (v === v) ? v : 0;
    }
    return out;
  }

  function shiftChannels(channels, pitch, sampleRate) {
    var res = [];
    for (var c = 0; c < channels.length; c++) {
      res.push(shiftChannel(channels[c], pitch, sampleRate));
    }
    return res;
  }

  return {
    FifoBuffer: FifoBuffer,
    RateTransposer: RateTransposer,
    Stretch: Stretch,
    Sonic: Sonic,
    shiftChannel: shiftChannel,
    shiftChannels: shiftChannels
  };
});

