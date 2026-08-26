/*
 * voice changer — js/app.js
 * --------------------------------------------------------------------------
 * Orchestrates everything: 30 human-voice presets, audio file / video file /
 * live-microphone modes, offline rendering (WAV + WebM export) and a
 * real-time streaming path for the microphone.
 * --------------------------------------------------------------------------
 */
(function () {
  'use strict';
  var VP = window.VoicePitch;
  var EQJS = window.EQJS;
  var V = window.VOICES;

  /* ----------------------------- state ----------------------------- */
  var ctx = null;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch (e) { ctx = null; }

  var currentVoice = V.getVoice(V.DEFAULT) || V.VOICES[0];
  var pitchFine = 0;
  var fileAudioBuffer = null;   // decoded source for audio mode
  var videoAudioBuffer = null;  // decoded audio track for video mode
  var activeMode = 'audio';

  var master = null, eqIn = null, eqOut = null;
  var nativeFilters = { hp: null, low: null, mid: null, hi: null };

  if (ctx) {
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    // live EQ chain:  input -> hp -> lowshelf -> peaking -> highshelf -> master
    eqIn = ctx.createGain();
    eqOut = ctx.createGain();
    nativeFilters.hp = ctx.createBiquadFilter(); nativeFilters.hp.type = 'highpass'; nativeFilters.hp.frequency.value = 25;
    nativeFilters.low = ctx.createBiquadFilter(); nativeFilters.low.type = 'lowshelf';
    nativeFilters.mid = ctx.createBiquadFilter(); nativeFilters.mid.type = 'peaking'; nativeFilters.mid.Q.value = 1.1;
    nativeFilters.hi = ctx.createBiquadFilter(); nativeFilters.hi.type = 'highshelf';
    eqIn.connect(nativeFilters.hp);
    nativeFilters.hp.connect(nativeFilters.low);
    nativeFilters.low.connect(nativeFilters.mid);
    nativeFilters.mid.connect(nativeFilters.hi);
    nativeFilters.hi.connect(eqOut);
    eqOut.connect(master);
  }

  function applyVoiceToNative(v) {
    if (!ctx || !nativeFilters.hp) return;
    var e = v.eq || {};
    nativeFilters.hp.frequency.value = (e.highpass && e.highpass.f) || 25;
    nativeFilters.low.frequency.value = (e.low && e.low.f) || 160;
    nativeFilters.low.gain.value = (e.low && e.low.gain) || 0;
    nativeFilters.mid.frequency.value = (e.mid && e.mid.f) || 1000;
    nativeFilters.mid.gain.value = (e.mid && e.mid.gain) || 0;
    nativeFilters.mid.Q.value = (e.mid && e.mid.Q) || 1.1;
    nativeFilters.hi.frequency.value = (e.high && e.high.f) || 6500;
    nativeFilters.hi.gain.value = (e.high && e.high.gain) || 0;
  }

  function effectivePitch(voice) {
    return V.pitchFactor((voice.pitch || 0) + (pitchFine || 0));
  }

  /* --------------------------- helpers ----------------------------- */
  function toast(msg, ms) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, ms || 2600);
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1200);
  }

  /* ------------- real-time streaming pitch (mic / live) ------------- */
  function RealtimeShift() {
    this.L = new VP.Sonic(1);
    this.R = new VP.Sonic(1);
    this.phase = 0;
  }
  RealtimeShift.prototype.setPitch = function (p) { this.L.pitch = p; this.R.pitch = p; };
  RealtimeShift.prototype.setVibrato = function (vo, tSec) {
    if (!vo) { this.phase = 0; return; }
    this.phase += 2 * Math.PI * vo.rate * (1 / 60); // approx 60fps steps scaled by rate
    var depthSemi = vo.depth / 100;
    var p = effectivePitch(currentVoice) * Math.pow(2, depthSemi * Math.sin(this.phase) / 12);
    this.L.pitch = p; this.R.pitch = p;
  };
  RealtimeShift.prototype.process = function (inL, inR, outL, outR, n) {
    // append a monotone of zeros not needed; feed the (sub)array
    var fL = inL.subarray ? inL : inL;
    var fR = inR.subarray ? inR : inR;
    this.L.feed(fL.subarray(0, n));
    this.R.feed(fR.subarray(0, n));
    this.L.processUntil(n, 6000);
    this.R.processUntil(n, 6000);
    this.drain(this.L, outL, n);
    this.drain(this.R, outR, n);
  };
  RealtimeShift.prototype.drain = function (sonic, out, n) {
    var avail = sonic.output.frameCount;
    var k = avail < n ? avail : n;
    var base = sonic.output._start();
    var vec = sonic.output.vector;
    for (var i = 0; i < k; i++) { var v = vec[base + i]; out[i] = (v === v) ? v : 0; }
    for (i = k; i < n; i++) out[i] = 0;
    sonic.output.receive(k);
  };

  /* --------------------------- playback ---------------------------- */
  var sourceNode = null;
  var micStream = null, micSP = null, micRT = null, micRec = null;
  var videoRec = null;

  function stopPlayback() {
    if (sourceNode) { try { sourceNode.stop(); } catch (e) {} try { sourceNode.disconnect(); } catch (e) {} sourceNode = null; }
    var ve = document.getElementById('videoEl');
    if (ve) { ve.pause(); }
  }
  function playBuffer(buf) {
    stopPlayback();
    if (!ctx) { toast('Audio not supported in this browser.'); return; }
    var s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(master);
    s.start();
    sourceNode = s;
  }

  function volumeValue() {
    var v = document.getElementById('volume').value / 100;
    return v;
  }

  /* -------------------------- AUDIO mode -------------------------- */
  function loadAudioFile(file) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      ctx.decodeAudioData(ev.target.result, function (ab) {
        fileAudioBuffer = ab;
        hideDrop('audio');
        document.getElementById('audioEl').src = URL.createObjectURL(file);
        document.getElementById('audioEl').load();
        toast('Audio loaded — pick a voice and press Preview.');
      }, function () { toast('Could not decode that audio file.'); });
    };
    reader.onerror = function () { toast('Could not read the file.'); };
    reader.readAsArrayBuffer(file);
  }
  function audioPreview() {
    if (!fileAudioBuffer) { toast('Load an audio file first.'); return; }
    toast('Rendering changed voice…');
    setTimeout(function () {
      try {
        var buf = renderToBuffer(fileAudioBuffer, currentVoice);
        applyVoiceToNative({ eq: {} }); // no double-EQ for offline render
        master.gain.value = volumeValue();
        playBuffer(buf);
      } catch (e) { toast('Render failed: ' + e.message); }
    }, 30);
  }
  function audioExport() {
    if (!fileAudioBuffer) { toast('Load an audio file first.'); return; }
    toast('Rendering WAV…');
    setTimeout(function () {
      try {
        var chans = renderChannels(channelsFromBuffer(fileAudioBuffer), currentVoice, fileAudioBuffer.sampleRate);
        var wav = EQJS.encodeWav(chans, fileAudioBuffer.sampleRate);
        download(new Blob([wav], { type: 'audio/wav' }), currentVoice.id + '-changed-voice.wav');
        toast('WAV downloaded ✔');
      } catch (e) { toast('Export failed: ' + e.message); }
    }, 30);
  }
  /* -------------------------- VIDEO mode -------------------------- */
  function loadVideoFile(file) {
    var ve = document.getElementById('videoEl');
    ve.src = URL.createObjectURL(file);
    ve.load();
    // try to decode its audio track for offline rendering
    var reader = new FileReader();
    reader.onload = function (ev) {
      ctx.decodeAudioData(ev.target.result, function (ab) {
        videoAudioBuffer = ab;
        document.getElementById('videoHint').textContent =
          'Audio track read successfully (' + (ab.duration || 0).toFixed(1) + 's). Pick a voice, preview, then save.';
      }, function () {
        videoAudioBuffer = null;
        document.getElementById('videoHint').textContent =
          'This file’s audio wasn’t readable for offline rendering (codec may be unsupported). You can still watch it; video saving is limited.';
      });
    };
    reader.onerror = function () { videoAudioBuffer = null; };
    reader.readAsArrayBuffer(file);
    hideDrop('video');
  }
  function videoPreview() {
    var ve = document.getElementById('videoEl');
    if (!ve.src) { toast('Load a video file first.'); return; }
    if (videoAudioBuffer) {
      toast('Rendering changed voice…');
      setTimeout(function () {
        try {
          var buf = renderToBuffer(videoAudioBuffer, currentVoice);
          master.gain.value = volumeValue();
          ve.muted = true; // original audio off — we play the changed voice instead
          playBuffer(buf);
          ve.play();
        } catch (e) { toast('Render failed: ' + e.message); }
      }, 30);
    } else {
      // fallback: live-route the video element audio through the realtime graph
      ve.muted = false;
      startLiveVideoRealtime(ve);
      ve.play();
    }
  }
  function videoExport() {
    var ve = document.getElementById('videoEl');
    if (!ve.src) { toast('Load a video file first.'); return; }
    if (videoAudioBuffer && (!ve.captureStream)) {
      toast('This browser can\u2019t save videos. Use Chrome/Firefox.');
      return;
    }
    toast('Rendering video… (this plays the video once)');
    setTimeout(function () { runVideoExport(ve); }, 30);
  }

  function runVideoExport(ve) {
    if (!videoAudioBuffer) {
      // realtime capture: route video element audio through live graph + record
      exportVideoRealtime(ve);
      return;
    }
    var buf;
    try { buf = renderToBuffer(videoAudioBuffer, currentVoice); }
    catch (e) { toast('Render failed: ' + e.message); return; }
    ve.muted = true;
    var dest = ctx.createMediaStreamDestination();
    var s = ctx.createBufferSource();
    s.buffer = buf; s.connect(dest);
    // grab the video frames track
    var videoTrack = ve.captureStream ? ve.captureStream().getVideoTracks()[0] : null;
    if (!videoTrack) { toast('Video capture not supported in this browser.'); return; }
    var combined = new MediaStream([videoTrack, dest.stream.getAudioTracks()[0]]);
    var rec = new MediaRecorder(combined, { mimeType: 'video/webm' });
    var chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      var blob = new Blob(chunks, { type: 'video/webm' });
      download(blob, currentVoice.id + ('-changed-voice.webm'));
      toast('Video saved as WebM ✔');
    };
    rec.start();
    ve.currentTime = 0;
    s.start();
    ve.play();
    s.onended = function () { try { rec.stop(); } catch (e) {} };
  }
  // Slow, human-sounding vibrato applied by overlapping short chunks.
  function modulateChannel(ch, base, rateHz, depthCents, sr) {
    var n = ch.length;
    if (n < sr * 0.1) { // too short to modulate meaningfully
      return VP ? VP.shiftChannel(ch, base, sr) : ch.slice();
    }
    var frame = Math.round(sr * 0.05);
    var hop = Math.round(frame / 4);
    var out = new Float32Array(n);
    var occ = new Float32Array(n);
    for (var pos = 0; pos < n; pos += hop) {
      var t = pos / sr;
      var depthSemi = depthCents / 100;
      var factor = base * Math.pow(2, depthSemi * Math.sin(2 * Math.PI * rate * t) / 12);
      var seg = new Float32Array(frame);
      var lim = Math.min(frame, n - pos);
      for (var i = 0; i < lim; i++) seg[i] = ch[pos + i];
      var shifted = VP.shiftChannel(seg, factor, sr);
      for (i = 0; i < lim; i++) {
        var w = i < frame / 2 ? (2 * i / frame) : (2 * (frame - i) / frame);
        out[pos + i] += shifted[i] * w;
        occ[pos + i] += w;
      }
    }
    for (i = 0; i < n; i++) out[i] = occ[i] > 0 ? out[i] / (occ[i] + 1e-9) : 0;
    return out;
  }

  function renderChannels(chans, voice, sr) {
    var p = effectivePitch(voice);
    var shifted;
    if (voice.vibrato) {
      shifted = chans.map(function (ch) { return modulateChannel(ch, p, voice.vibrato.rate, voice.vibrato.depth, sr); });
    } else {
      shifted = VP.shiftChannels(chans, p, sr);
    }
    // EQ
    var eqd = shifted.map(function (ch) {
      var c = ch.slice();
      EQJS.applyChain(c, EQJS.buildChain(voice.eq, sr));
      return c;
    });
    // gentle normalize to a safe peak
    var peak = 0;
    eqd.forEach(function (ch) { for (var i = 0; i < ch.length; i++) { var a = Math.abs(ch[i]); if (a > peak) peak = a; } });
    if (peak > 1e-6 && peak > 0.98) {
      var s = 0.97 / peak;
      eqd.forEach(function (ch) { for (var i = 0; i < ch.length; i++) ch[i] *= s; });
    }
    return eqd;
  }

  function channelsFromBuffer(ab) {
    var chans = [];
    var n = ab.numberOfChannels || 1;
    for (var c = 0; c < n; c++) chans.push(ab.getChannelData(c));
    return chans;
  }
  function renderToBuffer(ab, voice) {
    var chans = renderChannels(channelsFromBuffer(ab), voice || currentVoice, ab.sampleRate);
    var buf = ctx.createBuffer(chans.length, chans[0].length, ab.sampleRate);
    chans.forEach(function (ch, c) { buf.copyToChannel(ch, c); });
    return buf;
  }

  /* ------------- live realtime graph (mic / video fallback) ---------- */
  var live = null;
  function createLiveSP() {
    var sp = ctx.createScriptProcessor(4096, 2, 2);
    var rt = new RealtimeShift();
    rt.setPitch(effectivePitch(currentVoice));
    sp.onaudioprocess = function (ev) {
      applyVoiceToNative(currentVoice);
      rt.setVibrato(currentVoice.vibrato, 0);
      var il = ev.inputBuffer.getChannelData(0), ir = ev.inputBuffer.getChannelData(1);
      var ol = ev.outputBuffer.getChannelData(0), orr = ev.outputBuffer.getChannelData(1);
      rt.process(il, ir, ol, orr, ev.inputBuffer.length);
    };
    return { sp: sp, rt: rt };
  }
  function stopLive() {
    if (live) {
      try { live.src.disconnect(); } catch (e) {}
      try { live.sp.disconnect(); live.sp.onaudioprocess = null; } catch (e) {}
      live = null;
    }
  }
  function wireRealtime(sourceNode, toDest) {
    stopLive();
    var p = createLiveSP();
    sourceNode.connect(p.sp);
    p.sp.connect(eqIn);
    if (toDest) p.sp.connect(toDest);
    live = { sp: p.sp, rt: p.rt, src: sourceNode };
  }

  /* ----------------------------- MIC ------------------------------- */
  function micToggle() {
    if (micStream) { micStop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Microphone is not supported in this browser.'); return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      micStream = stream;
      var src = ctx.createMediaStreamSource(stream);
      wireRealtime(src, null);
      document.getElementById('micToggle').textContent = '\u25a0 Stop microphone';
      document.getElementById('micStatus').textContent = 'Live \u2014 speak and you\u2019ll hear your changed human voice.';
      toast('Microphone live \u2714');
    }).catch(function (e) { toast('Microphone access denied: ' + e.message); });
  }
  function micStop() {
    try { micStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    micStream = null; stopLive();
    document.getElementById('micToggle').textContent = 'Start microphone';
    document.getElementById('micStatus').textContent = '';
  }

  function startLiveVideoRealtime(ve) {
    if (!ve.__src) { try { ve.__src = ctx.createMediaElementSource(ve); } catch (e) { toast('Could not route video audio: ' + e.message); return; } }
    wireRealtime(ve.__src, null);
  }
  function exportVideoRealtime(ve) {
    if (!ve.__src) { try { ve.__src = ctx.createMediaElementSource(ve); } catch (e) { toast('Could not route video audio: ' + e.message); return; } }
    var videoTrack = ve.captureStream ? ve.captureStream().getVideoTracks()[0] : null;
    if (!videoTrack) { toast('Video capture not supported here.'); return; }
    var dest = ctx.createMediaStreamDestination();
    wireRealtime(ve.__src, dest);
    var combined = new MediaStream([videoTrack, dest.stream.getAudioTracks()[0]]);
    var rec = new MediaRecorder(combined, { mimeType: 'video/webm' });
    var chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () { download(new Blob(chunks, { type: 'video/webm' }), currentVoice.id + '-changed-voice.webm'); };
    rec.start(); ve.muted = false; ve.currentTime = 0; ve.play();
    ve.onended = function () { try { rec.stop(); } catch (e) {} };
  }

  /* -------------------------- demo synth --------------------------- */
  function synthDemo() {
    var sr = ctx.sampleRate, dur = 3.6, n = Math.round(sr * dur);
    var ch = new Float32Array(n);
    var notes = [196, 0.42, 247, 0.85, 294, 1.25, 392, 1.55, 330, 1.95, 262, 2.25, 196, 2.55];
    for (var k = 0; k < notes.length; k += 2) {
      var freq = notes[k], start = notes[k + 1], T = 0.4;
      var a = Math.round(start * sr), b = Math.round((start + T) * sr);
      for (var i = a; i < b && i < n; i++) {
        var t = i / sr;
        var env = Math.min(1, (t - start) * 8) * Math.min(1, ((start + T) - t) * 8);
        var v = 0.5 * Math.sin(2 * Math.PI * freq * t)
              + 0.22 * Math.sin(2 * Math.PI * freq * 2 * t)
              + 0.1 * Math.sin(2 * Math.PI * freq * 3 * t);
        ch[i] += v * env;
      }
    }
    var ab = ctx.createBuffer(1, n, sr); ab.copyToChannel(ch, 0);
    fileAudioBuffer = ab;
    var ae = document.getElementById('audioEl'); ae.pause(); ae.removeAttribute('src');
    hideDrop('audio');
    toast('Sample generated \u2014 now pick a voice and press Preview.');
  }

  /* --------------------------- UI wiring --------------------------- */
  function $(id) { return document.getElementById(id); }
  function hideDrop(mode) {
    if (mode === 'audio') { $('audioDrop').style.display = 'none'; $('audioPlayer').style.display = 'block'; }
    if (mode === 'video') { $('videoDrop').style.display = 'none'; $('videoPlayer').style.display = 'block'; }
  }
  function buildPresets(filter) {
    var grid = $('presetGrid');
    grid.innerHTML = '';
    V.VOICES.forEach(function (v) {
      if (filter && filter !== 'all' && v.gender !== filter) return;
      var el = document.createElement('div');
      el.className = 'preset' + (v.id === currentVoice.id ? ' active' : '');
      el.dataset.id = v.id;
      var emoji = v.emoji || '\u{1F399}\uFE0F';
      el.innerHTML =
        '<span class="p-emoji">' + emoji + '</span>' +
        '<div class="p-gender">' + v.gender + '</div>' +
        '<div class="p-name"></div>' +
        '<div class="p-desc">' + (v.desc || '') + '</div>' +
        '<div class="p-pitch">' + (v.pitch > 0 ? '+' : '') + v.pitch + ' st</div>';
      el.querySelector('.p-name').textContent = v.name;
      el.addEventListener('click', function () { selectVoice(v.id); });
      grid.appendChild(el);
    });
  }
  function selectVoice(id) {
    var v = V.getVoice(id); if (!v) return;
    currentVoice = v;
    $('currentEmoji').textContent = v.emoji || '\u{1F399}\uFE0F';
    $('currentName').textContent = v.name;
    $('currentDesc').textContent = v.desc || '';
    if (live && live.rt) live.rt.setPitch(effectivePitch(v));
    document.querySelectorAll('.preset').forEach(function (c) {
      c.classList.toggle('active', c.dataset.id === id);
    });
    toast('Voice: ' + v.name);
  }
  function setMode(mode) {
    activeMode = mode;
    document.querySelectorAll('.mode-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    document.querySelectorAll('.panel').forEach(function (p) { p.style.display = 'none'; });
    $('panel-' + mode).style.display = 'block';
    if (mode === 'mic') applyVoiceToNative(currentVoice);
  }
  function bindEvents() {
    document.querySelectorAll('.mode-btn').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode); });
    });
    document.querySelectorAll('.chip').forEach(function (c) {
      c.addEventListener('click', function () {
        document.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active'); });
        c.classList.add('active'); buildPresets(c.dataset.filter);
      });
    });
    ['audio', 'video'].forEach(function (m) {
      var drop = $(m + 'Drop'), input = $(m + 'File');
      drop.addEventListener('click', function () { input.click(); });
      drop.querySelector('.link').addEventListener('click', function (e) { e.stopPropagation(); input.click(); });
      ['dragenter', 'dragover'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('dragover'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('dragover'); });
      });
      drop.addEventListener('drop', function (e) {
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          if (m === 'audio') loadAudioFile(e.dataTransfer.files[0]); else loadVideoFile(e.dataTransfer.files[0]);
        }
      });
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) { if (m === 'audio') loadAudioFile(input.files[0]); else loadVideoFile(input.files[0]); }
      });
    });
    $('audioPreview').addEventListener('click', audioPreview);
    $('audioExport').addEventListener('click', audioExport);
    $('audioDemo').addEventListener('click', synthDemo);
    $('videoPreview').addEventListener('click', videoPreview);
    $('videoExport').addEventListener('click', videoExport);
    $('micToggle').addEventListener('click', micToggle);
    $('pitchFine').addEventListener('input', function () {
      pitchFine = parseFloat(this.value);
      $('pitchFineVal').textContent = (pitchFine > 0 ? '+' : '') + pitchFine + ' st';
      if (live && live.rt) live.rt.setPitch(effectivePitch(currentVoice));
    });
    $('volume').addEventListener('input', function () {
      var v = parseFloat(this.value) / 100;
      $('volumeVal').textContent = this.value + '%';
      if (master) master.gain.value = v;
    });
    window.addEventListener('beforeunload', function () { try { micStop(); } catch (e) {} });
  }

  // boot
  bindEvents();
  buildPresets('all');
  setMode('audio');
  selectVoice(currentVoice.id);
  applyVoiceToNative(currentVoice);
})();
