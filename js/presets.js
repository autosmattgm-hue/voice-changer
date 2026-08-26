/*
 * voice changer — js/presets.js
 * --------------------------------------------------------------------------
 * 30 REAL, HUMAN voice presets (no robots, no monsters). Each voice is built
 * from:
 *   pitch :  semitone offset (the core vocal-fold change)
 *   eq    :  gentle EQ to model the vocal-tract / timbre of a real person
 *   vibrato : optional slow, human-sounding pitch waver (elderly / emotive)
 * --------------------------------------------------------------------------
 */
(function (root) {
  'use strict';
  var P = (typeof module === 'object' && module.exports) ? module.exports : (root.VOICES = root.VOICES || {});

  function eq(low, mid, hi, highpass) {
    var o = {};
    if (low) o.low = { f: low[0], gain: low[1] };
    if (mid) o.mid = { f: mid[0], gain: mid[1], Q: mid[2] || 1.1 };
    if (hi) o.high = { f: hi[0], gain: hi[1] };
    if (highpass) o.highpass = { f: highpass, Q: 0.707 };
    return o;
  }
  function v(rate, depth) { return { rate: rate, depth: depth }; }

  var VOICES = [
    // ------------------------- M A L E -----------------------------
    { id: 'deepBass',   name: 'Deep Bass Man',        emoji: '🧔', gender: 'Male',    pitch: -8,
      eq: eq([120, +4], [500, -1, 1.4], [5000, -6]), desc: 'Big, dark & rumbling.' },
    { id: 'hardMan',    name: 'Hard-Hitting Man',     emoji: '💪', gender: 'Male',    pitch: -9,
      eq: eq([150, +3], [350, +2, 1.6], [6000, -7]), desc: 'Heavy and powerful.' },
    { id: 'baritone',   name: 'Baritone Man',         emoji: '🎺', gender: 'Male',    pitch: -5,
      eq: eq([140, +3], [700, -1, 1.2], [6500, -3]), desc: 'Warm, rich and round.' },
    { id: 'adultMan',   name: 'Adult Man',            emoji: '🧑', gender: 'Male',    pitch: -2,
      eq: eq([160, +2], [900, 0, 1], [7000, -1]), desc: 'Everyday natural guy.' },
    { id: 'youngAdult', name: 'Young Adult Male',     emoji: '🧑‍🦱', gender: 'Male',   pitch: -1,
      eq: eq([180, +1], [1200, +1, 1.1], [8000, 0]), desc: 'Fresh, easy-going.' },
    { id: 'radio',      name: 'Smooth Radio Host',    emoji: '🎙️', gender: 'Male',    pitch: -3,
      eq: eq([130, +3], [250, +2, 1.1], [4000, -2]), desc: 'Velvet studio voice.' },
    { id: 'gentleman',  name: 'Mature Gentleman',     emoji: '🎩', gender: 'Male',    pitch: -4,
      eq: eq([120, +3], [800, -1, 1], [5000, -4]), desc: 'Composed, classic.' },
    { id: 'hero',       name: 'Action Hero',          emoji: '🦸', gender: 'Male',    pitch: -6,
      eq: eq([140, +4], [400, +2, 1.4], [5500, -5]), desc: 'Gravelly lead-man.' },
    { id: 'army',       name: 'Army Commander',       emoji: '🎖️', gender: 'Male',    pitch: -7,
      eq: eq([130, +3], [500, +1, 1.3], [6000, -4]), desc: 'Commanding & firm.' },
    { id: 'croaky',     name: 'Croaky Old Man',       emoji: '👴', gender: 'Senior',  pitch: -8,
      eq: eq([100, +2], [900, -2, 1], [3500, +1]), vibrato: v(5.0, 30), desc: 'Rough, worn-in elder.' },
    { id: 'grandpa',    name: 'Wise Grandfather',     emoji: '👨‍🦳', gender: 'Senior', pitch: -6,
      eq: eq([130, +3], [700, -1, 1], [4500, -3]), vibrato: v(4.6, 25), desc: 'Gentle and knowing.' },
    { id: 'teenBoy',    name: 'Teenage Boy',          emoji: '🧑‍🎤', gender: 'Male',   pitch: +5,
      eq: eq([200, -1], [1400, +1, 1.2], [9000, +2]), desc: 'Youthful, lighter.' },
    { id: 'littleBoy',  name: 'Little Boy',           emoji: '👦', gender: 'Child',   pitch: +9,
      eq: eq([250, -1], [1600, +1, 1.2], [10000, +2]), desc: 'Bright boyhood.' },
    { id: 'toddler',    name: 'Toddler Boy',          emoji: '🧸', gender: 'Child',   pitch: +13,
      eq: eq([350, -2], [1800, +2, 1.1], [11000, +3]), desc: 'High and playful.' },
    { id: 'softMale',   name: 'Soft-Spoken Male',     emoji: '🗣️', gender: 'Male',    pitch: -2,
      eq: eq([180, +2], [1200, +1, 1.4], [8000, -1]), desc: 'Quiet and intimate.' },

    // ------------------------ F E M A L E ---------------------------
    { id: 'deepFemale', name: 'Deep Female Voice',    emoji: '👩', gender: 'Female',  pitch: -3,
      eq: eq([170, +2], [1000, 0, 1], [8000, +1]), desc: 'Low, confident woman.' },
    { id: 'woman',      name: 'Woman',                emoji: '👩‍🦱', gender: 'Female', pitch: +1,
      eq: eq([200, +1], [1100, 0, 1], [9000, +1]), desc: 'Natural mature woman.' },
    { id: 'gentleWoman',name: 'Gentle Woman',         emoji: '🌸', gender: 'Female',  pitch: +3,
      eq: eq([220, +1], [900, +1, 1.2], [9500, +2]), desc: 'Warm and kind.' },
    { id: 'sweetGirl',  name: 'Sweet Girl',           emoji: '🎀', gender: 'Female',  pitch: +6,
      eq: eq([260, -1], [1200, +1, 1.2], [10000, +2]), desc: 'Light, pleasant.' },
    { id: 'cheerful',   name: 'Cheerful Woman',       emoji: '😄', gender: 'Female',  pitch: +4,
      eq: eq([230, +1], [1000, +1, 1.1], [9500, +2]), desc: 'Bright and sunny.' },
    { id: 'elegant',    name: 'Elegant Lady',         emoji: '👜', gender: 'Female',  pitch: +3,
      eq: eq([180, +2], [700, +1, 1.2], [7000, +1]), desc: 'Poised and refined.' },
    { id: 'princess',   name: 'Princess',             emoji: '👑', gender: 'Female',  pitch: +8,
      eq: eq([280, -1], [1400, +1, 1.1], [10500, +2]), desc: 'Graceful high soprano.' },
    { id: 'littleGirl', name: 'Little Girl',          emoji: '🤗', gender: 'Child',   pitch: +12,
      eq: eq([320, -2], [1600, +2, 1.1], [11000, +3]), desc: 'Bright, girlish.' },
    { id: 'babyGirl',   name: 'Tiny Girl Voice',      emoji: '🍼', gender: 'Child',   pitch: +16,
      eq: eq([400, -2], [1900, +2, 1.1], [12000, +3]), desc: 'Very high, soft child.' },
    { id: 'sultry',     name: 'Sultry Voice',         emoji: '💋', gender: 'Female',  pitch: +2,
      eq: eq([160, +3], [500, +2, 1.3], [6000, -2]), desc: 'Low, smoky and smooth.' },
    { id: 'granny',     name: 'Grandmother',          emoji: '👵', gender: 'Senior',  pitch: +5,
      eq: eq([180, +2], [1100, -2, 1], [8000, +1]), vibrato: v(4.8, 35), desc: 'Warm, caring elder.' },
    { id: 'angelic',    name: 'Angelic Soft Voice',   emoji: '👼', gender: 'Female',  pitch: +10,
      eq: eq([300, -2], [1500, +1, 1.2], [10000, +2]), desc: 'Ethereal and gentle.' },

    // ----------------------- N E U T R A L --------------------------
    { id: 'narrator',   name: 'Documentary Narrator', emoji: '🎬', gender: 'Neutral', pitch: 0,
      eq: eq([140, +2], [2800, +2, 1.3], [9000, +3]), desc: 'Clear, engaging storyteller.' },
    { id: 'news',       name: 'News Anchor',          emoji: '📺', gender: 'Neutral', pitch: +1,
      eq: eq([180, +1], [3000, +2, 1.2], [10000, +2]), desc: 'Crisp and professional.' },
    { id: 'friend',     name: 'Conversational Friend',emoj: '🙂', gender: 'Neutral', pitch: +1,
      eq: eq([190, +2], [1200, +1, 1.1], [9000, +1]), desc: 'Real, talkative & friendly.' }
  ];

  for (var i = 0; i < VOICES.length; i++) { if (VOICES[i].emoj) { VOICES[i].emoji = VOICES[i].emoj; delete VOICES[i].emoj; } }

  P.VOICES = VOICES;
  P.getVoice = function (id) {
    return VOICES.find(function (x) { return x.id === id; });
  };
  P.pitchFactor = function (semis) { return Math.pow(2, semis / 12); };
  P.DEFAULT = 'adultMan';
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
