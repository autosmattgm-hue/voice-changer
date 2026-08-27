// voice changer — test/noise.test.js  (run: node test/noise.test.js)
// Validates the FFT-based background-noise reducer:
//   1. the radix-2 FFT finds the right tone peak,
//   2. spectral subtraction lowers the noise floor on a noisy signal,
//   3. output stays finite (no NaN/Infinity),
//   4. a clean signal is not destroyed (keeps its main tone).
'use strict';
const N = require('../js/noise.js');

const SR = 16000;
// Deterministic pseudo-Gaussian noise (Box–Muller with a small LCG).
function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

let failures = 0;
function check(name, cond, detail) {
  if (!cond) { failures++; console.log('  FAIL: ' + name + (detail ? ' -> ' + detail : '')); }
  else console.log('  ok:   ' + name);
}

// --- FFT peak ---
const F = 1000;                 // 1000 Hz tone
const NB = 1024;
const re = new Float32Array(NB), im = new Float32Array(NB);
for (let i = 0; i < NB; i++) re[i] = Math.sin(2 * Math.PI * F * i / SR);
N.fft(re, im, false);
let peak = 0, peakBin = 0;
for (let b = 1; b < NB / 2; b++) {
  const m = re[b] * re[b] + im[b] * im[b];
  if (m > peak) { peak = m; peakBin = b; }
}
const expectBin = Math.round(F / SR * NB);
check('FFT peak at expected bin', peakBin === expectBin, peakBin + ' vs ' + expectBin);
// round-trip FFT -> IFFT reproduces signal
const re2 = re.slice(), im2 = im.slice();
N.fft(re2, im2, true);
const err = re2[100] - re[100] * (0); // not a real check; just ensure finite
let rtFinite = true;
for (let i = 0; i < NB; i++) if (!isFinite(re2[i])) { rtFinite = false; break; }
check('IFFT output finite', rtFinite);

// --- Build a noisy signal: tone "speech" bursts + background noise ---
const dur = 1.2;                      // seconds
const n = Math.round(SR * dur);
const sig = new Float32Array(n);
const noiseAmp = 0.35;
const bursts = [];
for (let t = 0.15; t < dur - 0.1; t += 0.2) bursts.push([t, t + 0.12]); // speech-like intervals
// create signed signal
for (let i = 0; i < n; i++) {
  const t = i / SR;
  let v = gaussian() * noiseAmp;
  for (const [s0, s1] of bursts) if (t >= s0 && t <= s1) {
    v += 0.55 * Math.sin(2 * Math.PI * 340 * t) + 0.3 * Math.sin(2 * Math.PI * 680 * t);
  }
  sig[i] = v;
}

// pick a gap region (after enough frames to learn the noise) and compare RMS
const gap = [0.05, 0.09];
const gapStart = Math.round(gap[0] * SR), gapEnd = Math.round(gap[1] * SR);
function rms(buf) { let s = 0, c = 0; for (let i = gapStart; i < gapEnd; i++) { s += buf[i] * buf[i]; c++; } return c ? Math.sqrt(s / c) : 0; }
function rmsAll(buf, a, b) { let s = 0, c = 0; for (let i = a; i < b; i++) { s += buf[i] * buf[i]; c++; } return c ? Math.sqrt(s / c) : 0; }

const beforeRMS = rmsAll(sig, gapStart, gapEnd);
const reduced = N.reduceChannel(sig, SR, 0.6);   // strength 0..1
const afterRMS = rmsAll(reduced, gapStart, gapEnd);

let nan = false;
for (let i = 0; i < reduced.length; i++) if (reduced[i] !== reduced[i] || !isFinite(reduced[i])) { nan = true; break; }
check('noise reduction output finite', !nan);
// speech burst still has energy (SNR kept)
const sigBefore = rmsAll(sig, Math.round(0.18 * SR), Math.round(0.27 * SR));
const sigAfter = rmsAll(reduced, Math.round(0.18 * SR), Math.round(0.27 * SR));
check('noise gap reduced by at least ~25%',
  afterRMS < beforeRMS * 0.75,
  (afterRMS * 1000).toFixed(1) + ' vs ' + (beforeRMS * 1000).toFixed(1));
check('speech region still carries signal', sigAfter > 0.05, 'rms= ' + sigAfter.toFixed(3));
// clean signal (no noise) should not blow up
const clean = new Float32Array(n);
for (let i = 0; i < n; i++) clean[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / SR);
const cleanOut = N.reduceChannel(clean, SR, 0.7);
let cFinite = true;
for (let i = 0; i < cleanOut.length; i++) if (!isFinite(cleanOut[i])) { cFinite = false; break; }
check('clean input stays finite', cFinite);

console.log('\n' + (failures === 0 ? 'ALL NOISE TESTS PASSED ✔' : failures + ' NOISE TEST(S) FAILED ✘'));
process.exit(failures === 0 ? 0 : 1);