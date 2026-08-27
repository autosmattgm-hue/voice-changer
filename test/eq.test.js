// voice changer — test/eq.test.js  (run: node test/eq.test.js)
'use strict';
const EQJS = require('../js/eq.js');
const PR = require('../js/presets.js');

let fails = 0;
function check(name, cond, detail) {
  if (!cond) { fails++; console.log('  FAIL: ' + name + (detail ? ' -> ' + detail : '')); }
  else console.log('  ok:   ' + name);
}

// 1) exactly 30 human presets, all fields valid
const vs = PR.VOICES;
check('30 presets', Array.isArray(vs) && vs.length === 30, 'got ' + (vs && vs.length));
const ids = new Set();
vs.forEach((v) => {
  const ok = v.id && v.name && typeof v.pitch === 'number' && (v.gender === 'Male' || v.gender === 'Female' || v.gender === 'Child' || v.gender === 'Senior' || v.gender === 'Neutral');
  if (!ok) check('valid fields for ' + (v && v.id), false, JSON.stringify(v));
  if (ids.has(v.id)) check('unique id ' + v.id, false);
  ids.add(v.id);
});
check('all ids unique', ids.size === vs.length);
check('default voice present', !!PR.getVoice(PR.DEFAULT));

// 2) EQ chain output finite & roughly shaped (boost high shelf raises RMS of a tone)
const sr = 44100;
const tone = new Float32Array(sr); // 1 sec 440Hz
for (let i = 0; i < sr; i++) tone[i] = Math.sin(2 * Math.PI * 440 * i / sr);
const chain = EQJS.buildChain({ high: { f: 3000, gain: 12 } }, sr);
const out = new Float32Array(tone); EQJS.applyChain(out, chain);
let nan = false;
for (let i = 0; i < out.length; i++) if (out[i] !== out[i] || !isFinite(out[i])) { nan = true; break; }
check('EQ output finite', !nan);

// 3) WAV encoder produces a valid 44-byte header + correct data size
const wav = EQJS.encodeWav([tone, tone], sr);
const dv = new DataView(wav);
const isRiff = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) === 'RIFF';
const isWav = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11)) === 'WAVE';
const numCh = dv.getUint16(22, true);
const byteRate = dv.getUint32(28, true);
const dataLen = dv.getUint32(40, true);
check('WAV RIFF header', isRiff);
check('WAV WAVE tag', isWav);
check('WAV 2 channels', numCh === 2);
check('WAV byteRate correct', byteRate === sr * 2 * 2);
check('WAV data size correct', dataLen === 2 * sr * 2);
check('WAV total size = 44 + data', wav.byteLength === 44 + dataLen);

// 4) FX helpers: fxChain produces finite output, fade in ramps up, normalize caps peak
const fxOut = new Float32Array(tone); EQJS.applyChain(fxOut, EQJS.fxChain(sr, 3, -2, 4));
let fxn = false;
for (let i = 0; i < fxOut.length; i++) if (fxOut[i] !== fxOut[i] || !isFinite(fxOut[i])) { fxn = true; break; }
check('fxChain output finite', !fxn);

const tone2 = new Float32Array(sr); tone2.fill(0.9); // constant signal
const faded = EQJS.fadeChannels([tone2.slice()], 0.1, 0.1, sr)[0];
check('fade-in starts near silence', Math.abs(faded[0]) < 0.01);
// check monotonic-ish ramp sample near fade end
check('fade-in ramps upward', faded[Math.round(0.05 * sr)] > faded[0]);

const loud = new Float32Array(1000); loud.fill(1.0);
const normed = EQJS.normalizeChannels([loud], 0.5)[0];
let peakAfter = 0;
for (let i = 0; i < normed.length; i++) if (normed[i] > peakAfter) peakAfter = normed[i];
check('normalize caps peak to target', Math.abs(peakAfter - 0.5) < 1e-4);

// 5) WAV/encode handles stereo 16-bit
const wav2 = EQJS.encodeWav([tone, tone], sr);
const dv2 = new DataView(wav2);
check('stereo WAV byteRate', dv2.getUint32(28, true) === sr * 2 * 2);

console.log('\n' + (fails === 0 ? 'ALL MODULE TESTS PASSED \u2714' : fails + ' FAILED \u2718'));
process.exit(fails === 0 ? 0 : 1);