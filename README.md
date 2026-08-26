# Voice Changer — 30 Real Human Voices

A fully **client-side** web app that changes the voice in **audio files**, **video
files**, and even your **live microphone** — using **30 real, human voice presets**
(no robots, no monsters).

Everything runs locally in your browser. No uploads, no servers, no accounts.

---

## Quick start

Open **`index.html`** in a modern browser (Chrome, Edge, Firefox, or Safari).

> Tip: some browsers (e.g. Chrome) let you open it by double‑clicking the file.
> If a browser blocks file access, run `python -m http.server` in this folder and
> open `http://localhost:8000` (Node also works: `npx serve`).

## How to use

1. **Pick a voice** from the 30 human presets (male, female, children, elderly, neutral).
   - Use the filters (Male / Female / Children / Elderly / Neutral) to browse.
2. **Fine‑tune** the pitch slider and output volume if you like.
3. Choose a mode:

| Mode | What to do | Output |
|------|------------|--------|
| 🎵 **Audio file** | Drop/choose an MP3, WAV, M4A, OGG, FLAC… | Preview on the spot, then **Download WAV** |
| 🎬 **Video file** | Drop/choose an MP4, WebM, MOV, MKV… | Preview with the new voice, then **Save as WebM** |
| 🎤 **Live mic** | Press **Start microphone** and speak | Hear yourself in real time with the chosen voice |

There's also a **Generate sample** button (audio tab) if you want a quick demo
without any file.

## The 30 human voices

- **Male (9):** Deep Bass Man, Hard-Hitting Man, Baritone Man, Adult Man,
  Young Adult Male, Smooth Radio Host, Mature Gentleman, Action Hero,
  Army Commander, Soft-Spoken Male
- **Young male / children (3):** Teenage Boy, Little Boy, Toddler Boy
- **Elderly (3):** Croaky Old Man, Wise Grandfather, Grandmother
- **Female (9):** Deep Female, Woman, Gentle Woman, Sweet Girl, Cheerful Woman,
  Elegant Lady, Sultry Voice, Angelic Soft Voice
- **Girls / children (3):** Princess, Little Girl, Tiny Girl Voice
- **Neutral (3):** Documentary Narrator, News Anchor, Conversational Friend

Every voice is a musical human‑sounding transformation (WSOLA pitch shifting
kept smooth + a gentle vocal‑tract EQ + optional human vibrato on the elder
voices) — deliberately **no** robotic phasing, no synthetic monster tones.

## How it's built

```
index.html          page & layout
css/style.css       dark UI styling
js/pitch.js         WSOLA + RateTransposer pitch engine (portable DSP)
js/eq.js            RBJ biquad EQ + 16-bit WAV encoder
js/presets.js       the 30 human voice definitions
js/app.js           app wiring: audio/video/mic, rendering, export
test/pitch.test.js  automated DSP test (Node)
test/eq.test.js     automated preset/EQ/WAV test (Node)
```

- **Audio:** decode → WSOLA pitch‑shift (sound‑natural, keeps duration) → EQ →
  normalize → play or download WAV.
- **Video:** read the audio track, process it the same way, then re‑render the
  video with the changed audio via `captureStream()` + `MediaRecorder` (WebM).
- **Microphone:** real‑time streaming path through the same pitch engine.
- The pitch engine is a clean re‑implementation of the well‑known
  time‑domain/WSOLA algorithm (Stretch + RateTransposer) that preserves duration
  while moving pitch.

## Tests

From this folder:

```
node test/pitch.test.js    # checks pitch up/down, duration, no NaN
node test/eq.test.js       # checks 30 presets, EQ, WAV header
```

Both should print **ALL TESTS PASSED**.

## Notes & limitations

- Video export produces **WebM** (with VP8/Opus) and is best on Chrome/Edge/Firefox.
- The clearest results come from **speech/voice** sources (the presets are tuned
  for human voices). Music with strong reverb/pitch‑insensitive content shifts
  less convincingly.
- Large pitch jumps (e.g. +16 for “Tiny Girl”) are intentionally possible but may
  sound more cartoonish on very low male voices — ease the fine‑tune slider down a
  little for the most natural result.
