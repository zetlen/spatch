# spatch — Roadmap

## Bugs

### High Severity

- [x] ~~Embed snippet URL points to main app instead of `embed.html`~~
- [x] ~~Arpeggio `_init()` not awaited~~
- [x] ~~Arpeggio audio double-routes to destination~~
- [x] ~~Delayed `_cleanup` from `release()` can kill a new play session~~
- [x] ~~Arpeggio voices never tracked for cleanup~~
- [x] ~~Audio nodes never disconnected~~

- [ ] **Rotation has no audible effect** — `js/audio.js` — **M**
  Rotation maps to 0–50 cents of detune, which is inaudible. Triangle (sawtooth) should crossfade toward triangle wave at 180°. Square should adjust pulse width/phase. Circle (sine) could modulate harmonic content.

- [ ] **Radial and linear gradient colors not choosable** — `js/toolbar.js`, `js/colors.js` — **M**
  The Lab picker and linear HSL stop inputs aren't properly wired to update shape fill. Two of three fill modes are effectively broken.

- [ ] **Volume inconsistent across shape types** — `js/audio.js` — **S**
  Square and sawtooth oscillators are inherently louder than sine at the same `sizeToGain` value. Needs per-waveform gain normalization.

- [ ] **Latch mode doesn't play newly added shapes** — `js/audio.js`, `js/app.js` — **M**
  Adding a shape while latched and playing doesn't add it to the playing voices. `updateVoices` only updates existing voices by shape ID.

- [ ] **Play/latch UI is confusing** — `index.html`, `js/app.js`, `css/style.css` — **M**
  Separate play and latch buttons are unclear. Replace with three play button variants: normal play (press-and-hold), latched play (click-toggle with lock icon), and loop (auto-repeat).

### Medium Severity

- [ ] **Curlicues and text decorations have no audio effect** — `js/decorations.js`, `js/audio.js` — **M**
  Decorations are visual-only. Text should trigger text-to-speech or vocoder. Curlicues should map to an audio parameter. `vocoder.js` exists but is never wired up.

- [ ] **No copy and paste for shapes** — `js/app.js`, `js/state.js` — **M**
  No way to duplicate a shape. Ctrl+C/V should copy/paste with offset. Ctrl+D for duplicate-in-place.

- [ ] **Bitcrusher worklet shares state across stereo channels** — `js/worklets/bitcrusher.js` — **S**
  `_phase` and `_lastSample` are single variables but loop iterates multiple channels. Fix: per-channel arrays.

- [ ] **`embed.html` has no render loop** — `embed.html` — **S**
  Canvas rendered once. Playback glow effects never appear.

- [ ] **`embed.html` play button only uses `mousedown`/`mouseup`** — `embed.html` — **XS**
  No touch events. Won't work on mobile.

- [ ] **Touch events don't forward `shiftKey`** — `js/app.js` — **XS**
  Arpeggio mode inaccessible on touch devices.

- [ ] **Unstable shape IDs across save/load** — `js/serialize.js`, `js/state.js` — **S**
  Two separate `genId` functions with different prefixes. IDs change every deserialization cycle.

### Low Severity / Polish

- [ ] **Rename from "Sigil Synth" to "spatch"** — `index.html`, `embed.html`, `package.json` — **XS**

- [ ] **Remove share/embed buttons for now** — `index.html`, `js/app.js` — **XS**

- [ ] **Layer buttons should use overlapping-square icons** — `index.html` — **XS**
  Replace generic arrow symbols (⇧/⇩) with Photoshop-style arrange icons.

- [ ] **Remove text labels from toolbar, use symbols only** — `index.html`, `css/style.css` — **S**
  Remove "Fill", "Pattern", "Layers" labels. Use only icons with `title`/`alt` attributes.

- [ ] **Patterns should be a dropdown menu** — `index.html`, `js/toolbar.js`, `css/style.css` — **S**
  Replace button row with a dropdown or popup menu.

- [ ] **Duration should be a slider (1–5s)** — `index.html`, `js/app.js`, `js/audio.js` — **S**
  Simpler mental model than raw ADSR timing.

- [ ] **Dead code cleanup** — **XS**
  Remove: unused `dot()` in `shapes.js`, dead `layers.js`, unused `app.js` import.

---

## Features

- [x] ~~Auto-switch to select mode after shape creation~~
- [x] ~~Glow behind canvas when playing~~
- [x] ~~Chromatic scale guide lines~~
- [x] ~~Latch button for continuous playback~~

- [ ] **Drop shadow on shapes → chorus effect** — **L**
  Map shadow offset → chorus delay/depth, blur → rate, color → wet/dry. Effect builder exists in `effects.js`.

- [ ] **Make decorations movable and resizable** — **L**
  Hit-testing, drag-to-move, resize handles for squiggles/curlicues/text.

---

## Tech Debt

- [ ] **Migrate to TypeScript** — **L**
- [x] ~~Add bundling and minification~~
- [x] ~~Use `package.json` and Bun instead of vendoring libs~~
- [ ] **Do a not-invented-here audit** — **M**

---

## Size Key

| Size | Meaning |
|------|---------|
| **XS** | One-liner or a few lines, < 15 min |
| **S** | Localized change in 1–2 files, < 1 hr |
| **M** | Touches 3–4 files, new UI + logic, 1–3 hrs |
| **L** | Cross-cutting, new state/serialization/UI/audio wiring, 3–8 hrs |
