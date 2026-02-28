# Sigil Synth — Roadmap

## Bugs

### High Severity

- [x] **Embed snippet URL points to main app instead of `embed.html`** — `js/embed.js:5-8` — **XS**
  `generateEmbedSnippet` uses `window.location.pathname` (resolves to `/index.html` or `/`), so the generated `<iframe>` loads the full editor instead of the lightweight `embed.html` viewer. The `host` parameter is never passed by any caller.

- [x] **Arpeggio `_init()` not awaited** — `js/app.js:144` — **XS**
  `audio._init()` is async but not awaited. If this is the first user interaction, `this.audioCtx` will still be `null` when `triggerArpeggio` runs on the next `mousemove`, silently failing.

- [x] **Arpeggio audio double-routes to destination** — `js/audio.js:242-243` — **S**
  `_buildVoice` connects panner directly to `ctx.destination` (since `masterGain` is null during arpeggio). Then `triggerArpeggio` also connects the same output through `miniGain` → compressor → destination. Audio goes through two paths, doubling volume. Fix requires rethinking arpeggio's audio graph setup to use a dedicated gain/compressor chain without the duplicate path.

- [x] **Delayed `_cleanup` from `release()` can kill a new play session** — `js/audio.js:208` — **S**
  `setTimeout(() => this._cleanup(), releaseTime * 1000 + 100)` — if the user starts a new `play()` before this timeout fires, it kills the new session's voices. Fix: track a generation/session counter and check it in the timeout callback.

- [x] **Arpeggio voices never tracked for cleanup** — `js/audio.js:211-252` — **S**
  Arpeggio oscillators, gain nodes, and effect dispose callbacks are never added to `activeVoices`, so `_cleanup()` never reaches them. Nodes leak every arpeggio interaction.

- [x] **Audio nodes never disconnected** — `js/audio.js:259-267` — **S**
  `_cleanup()` stops oscillators and calls effect dispose, but never calls `.disconnect()` on any nodes (oscillators, gains, filters, panners, masterGain, compressor). These hold resources until the AudioContext is garbage collected. Fix: iterate all voice nodes and disconnect, then null out the master chain.

### Medium Severity

- [ ] **Bitcrusher worklet shares state across stereo channels** — `js/worklets/bitcrusher.js:13-14` — **S**
  `_phase` and `_lastSample` are single instance variables but the loop iterates over multiple channels. Right channel starts from where left channel's phase ended, causing inconsistent bitcrushing. Fix: use per-channel arrays.

- [ ] **`embed.html` has no render loop** — `embed.html:72-96` — **S**
  Canvas is rendered exactly once. During playback, shape glow effects (checked via `isPlaying` in `canvas.js`) never appear because there's no `requestAnimationFrame` loop.

- [ ] **`embed.html` play button only uses `mousedown`/`mouseup`** — `embed.html:82-95` — **XS**
  No touch events. The play button won't work on mobile. A `click`-based toggle would be simpler and cross-platform.

- [ ] **Touch events don't forward `shiftKey`** — `js/app.js:321-340` — **XS**
  The synthetic `MouseEvent` from touch never sets `shiftKey: true`, making arpeggio mode inaccessible on touch devices.

- [ ] **ADSR corner drag reference point mismatch** — `js/app.js:432-440` vs `js/shapes.js:117-136` — **M**
  `getCornerPosition` returns the exact canvas corner, but the visual handle dot is drawn at the arc midpoint, and hit testing uses yet another offset. Drag distance is calculated from the wrong point, causing unintuitive behavior. Fix requires unifying the three coordinate systems.

### Low Severity / Dead Code

- [ ] **Dead code in `pointInTriangle`** — `js/shapes.js:54-60` — **XS**
  Five computed `dot()` results are never used. Delete them and the `dot` helper.

- [ ] **`layers.js` is dead code** — **XS**
  Never imported anywhere. `audio.js` has its own inline `createLayerEQ`. Delete the file.

- [ ] **`vocoder.js` is dead code** — **XS**
  Never imported anywhere. Text decorations don't produce any vocoder audio. Delete or wire up.

- [ ] **Unused import in `app.js`** — **XS**
  `serializeState` imported on line 12 but never referenced directly. Remove it.

- [ ] **Unstable shape IDs across save/load** — `js/serialize.js` vs `js/state.js` — **S**
  Two separate `genId` functions with different prefixes (`'r'` vs `'s'`) and different random char lengths. Shape IDs change every deserialization cycle. Fix: preserve original IDs through serialization, or use a single shared `genId`.

---

## Features

- [ ] **Auto-switch to select mode after shape creation** — `js/app.js`, `js/toolbar.js` — **XS**
  After a shape is placed (end of the shape-creation mouseup handler), automatically switch `toolbar.currentTool` to `'select'` and select the newly created shape. This matches typical drawing-app UX where you create then immediately adjust. Set the tool and `selectedId` at the end of the creation flow in `app.js`.

- [ ] **Glow behind canvas when playing** — `css/style.css`, `js/app.js` — **S**
  Add a CSS glow effect (e.g. `box-shadow` with a neon/synthwave color) on the canvas container element while audio is playing. Toggle a class like `.playing` on the canvas wrapper during `play()`/`release()`. Should pulse or breathe to match the synthwave aesthetic.

- [ ] **Two-octave chromatic scale guide lines** — `js/canvas.js`, `js/audio.js` — **S**
  Draw very light dotted horizontal lines across the canvas at Y positions corresponding to each semitone across two octaves (24 notes). Use the same pitch-mapping math from `audio.js` to compute Y positions. Add slightly heavier dotted lines at octave breaks (the note C boundaries) to visually denote where octaves change. Lines should be subtle enough not to compete with the grid or shapes.

- [ ] **Latch button for continuous playback** — `js/audio.js`, `js/app.js`, `js/toolbar.js`, `index.html` — **M**
  Add a toggle button that keeps sound playing after mouseup (skips `release()`). When latched, show a slider that picks a normalized position along the ADSR curve (0 = start of attack, through decay, to 1 = end of sustain) and holds the envelope gain at that value. Stop on second click or unlatch. Main work: skip release when latched, compute gain at arbitrary envelope position, add UI.

- [ ] **Drop shadow on shapes → chorus effect** — `js/canvas.js`, `js/audio.js`, `js/state.js`, `js/toolbar.js`, `index.html` — **L**
  Add an adjustable drop shadow to shapes (offset, blur, color via canvas `shadowOffsetX/Y`, `shadowBlur`, `shadowColor`). Map shadow parameters to a chorus audio effect: shadow offset → chorus delay/depth, shadow blur → chorus rate, shadow color → wet/dry mix. Needs UI for adjusting shadow (could be a sub-panel when a shape is selected, or drag handles on the shadow itself). The chorus effect builder already exists in `effects.js` — wire it up per-shape based on shadow values. Add shadow data to shape state and serialization.

- [ ] **Make decorations movable and resizable** — `js/decorations.js`, `js/state.js`, `js/canvas.js`, `js/shapes.js`, `js/app.js` — **L**
  Currently decorations (squiggles, curlicues, text) are placed once and can't be moved or resized. They should be selectable, movable, and resizable in select mode — but they don't need the full shape treatment (no color picker, no pattern, no audio mapping). They're still stamps, just adjustable stamps. Needs: hit-testing for decorations, bounding-box drag to move, resize handles to scale, and tracking position/size in state. Also add more curlicue variants and an adjustable size parameter at creation time.

---

## Size Key

| Size | Meaning |
|------|---------|
| **XS** | One-liner or a few lines, < 15 min |
| **S** | Localized change in 1–2 files, < 1 hr |
| **M** | Touches 3–4 files, new UI + logic, 1–3 hrs |
| **L** | Cross-cutting, new state/serialization/UI/audio wiring, 3–8 hrs |
