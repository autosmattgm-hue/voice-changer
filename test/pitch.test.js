// voice changer — test/pitch.test.js
// Run:  node test/pitch.test.js
// Verifies the WSOLA pitch shifter:
//   1. output length (duration) is preserved,
//   2. shifting UP raises the fundamental, shifting DOWN lowers it (measured
//      via zero-crossing rate on a pure tone),
//   3. no NaN/Infinity samples are produced.
'use strict';
const VP = require('../js/pitch.js');

function makeTone(freq, sr, seconds) {
  const n = Math.round(sr * seconds);
  const buff = new Float32Array(n);
  // a tone with a couple of harmonics so the WSOLA has structure to lock onto
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    buff[i] =
      0.8 * Math.sin(2 * Math.PI * freq * t) +
      0.3 * Math.sin(2 * Math.PI * 2 * freq * t) +
      0.15 * Math.sin(2 * Math.PI * 3 * freq * t);
  }
  return buff;
}

// Estimate fundamental using zero-crossings (robust for a near-pure tone).
function estimateFreq(buf, sr) {
  let crossings = 0;
  for (let i = 1; i < buf.length; i++) {
    if ((buf[i - 1] < 0 && buf[i] >= 0) || (buf[i - 1] >= 0 && buf[i] < 0)) crossings++;
  }
  return (crossings / 2) / (buf.length / sr);
}

function hasNaN(buf) {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== buf[i] || !isFinite(buf[i])) return true;
  }
  return false;
}

const SR = 44100;
const FREQ = 220; // A3
const IN = makeTone(FREQ, SR, 2.0);

let failures = 0;
function check(name, cond, detail) {
  if (!cond) {
    failures++;
    console.log('  FAIL: ' + name + (detail ? '  -> ' + detail : ''));
  } else {
    console.log('  ok:   ' + name);
  }
}

function expectShift(semis, label) {
  const P = Math.pow(2, semis / 12);
  const out = VP.shiftChannel(IN, P, SR);
  const inF = estimateFreq(IN, SR);
  const outF = estimateFreq(out, SR);
  const expected = FREQ * P;
  const ratio = outF / inF;
  console.log(`\n[${label}] pitch factor ${P.toFixed(4)}  in=${inF.toFixed(1)}Hz  out=${outF.toFixed(1)}Hz  (expect ~${expected.toFixed(1)}Hz)`);
  check(`${label}: duration preserved`, Math.abs(out.length - IN.length) <= 16, `${out.length} vs ${IN.length}`);
  check(`${label}: frequency moved correctly`,
    Math.abs(ratio / P - 1) < 0.09, `${ratio.toFixed(4)} vs expected ${P.toFixed(4)}`);
  check(`${label}: no NaN/Infinity`, !hasNaN(out), 'has NaN/Inf');
  return out;
}

console.log('PitchShifter tests (sr=' + SR + ', base=' + FREQ + 'Hz)...');
console.log('Reference input fundamental ~= ' + estimateFreq(IN, SR).toFixed(1) + 'Hz');

expectShift(0, 'identity');
const up = expectShift(7, 'up +7 semis');
const down = expectShift(-7, 'down -7 semis');
const female = expectShift(12, 'up +1 octave (girl-like)');

// Sanity: global direction ordering
check('ordering: up > identity > down',
  estimateFreq(up, SR) > estimateFreq(IN, SR) && estimateFreq(down, SR) < estimateFreq(IN, SR));

// Sanity: quiet/DC input does not blow up
const quiet = new Float32Array(22050); // silence
const qOut = VP.shiftChannel(quiet, 1.5, SR);
check('silence stays silent/finite', !hasNaN(qOut) && qOut.length === quiet.length);

console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED ✔' : failures + ' TEST(S) FAILED ✘'));
process.exit(failures === 0 ? 0 : 1);