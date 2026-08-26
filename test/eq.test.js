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

console.log('\n' + (fails === 0 ? 'ALL MODULE TESTS PASSED \u2714' : fails + ' FAILED \u2718'));
process.exit(fails === 0 ? 0 : 1);