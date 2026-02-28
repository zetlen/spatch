# CLAUDE.md — Sigil Synth

## What This Is

Sigil Synth is a browser instrument. You compose visual sigils from geometric shapes
and hear them as synthesized chords. Every visual property maps to an audio parameter.

## Project Structure

```
package.json         Package manifest (Bun)
bun.lock             Lockfile
build.ts             Build script (Bun.build)
index.html           Main app (source HTML entry point)
embed.html           Standalone embed viewer (reads state from URL hash)
css/style.css        All styles (CSS custom properties, synthwave theme)
js/
  app.js             Entry point: init, event wiring, render loop
  embed-entry.js     Entry point for embed.html viewer
  state.js           SigilState class: data model, undo/redo, CRUD
  canvas.js          Canvas 2D rendering (shapes, decorations, selection UI)
  shapes.js          Hit testing, resize/rotate math
  colors.js          Color conversions (HSL↔RGB, Lab↔RGB), picker renderers
  patterns.js        Visual pattern tiles (stripes, checker, noise) + procedural
  effects.js         Audio effect builders (chorus, tremolo, flanger, phaser, bitcrusher)
  audio.js           Web Audio engine: AudioEngine class, mapping functions
  envelope.js        ADSR ↔ canvas corner radius conversion
  toolbar.js         Toolbar class: tool/pattern/color picker UI binding
  decorations.js     DecorationTool class: squiggle/curlicue/text placement
  vocoder.js         Formant vocoder (vowel/consonant → bandpass filter bank)
  embed.js           Embed snippet generator + modal UI
  serialize.js       LZ-string URL serialization (compact single-char keys)
  layers.js          Layer EQ shelving helper
  worklets/
    bitcrusher.js    AudioWorkletProcessor for the "rough" pattern effect
dist/                Build output (gitignored)
plans/
  sigil-synth-design.md  Full design document
```

## How to Run

```bash
bun install          # install dependencies
bun run build        # build to dist/ (minified)
bun run dev          # build to dist/ (unminified, with source maps)
```

Serve the `dist/` directory with any static server (e.g. `bunx serve dist`).

## Key Concepts

- **Shapes** are the primary objects: triangle, square, circle. Each shape maps to
  one oscillator voice. Position → pitch/pan, size → volume, rotation → detune,
  color → filter, pattern → effect.

- **ADSR envelope** is encoded as the canvas corner radii. Drag corners to adjust.
  Bottom-left = attack, top-left = decay, top-right = sustain, bottom-right = release.

- **Play is press-and-hold**: mousedown = gate on (attack → decay → sustain),
  mouseup = gate off (release). Shift+drag = arpeggio mode.

- **State** lives in `SigilState` (js/state.js). It holds shapes, decorations, and
  envelope. All mutations go through this class. Undo/redo uses JSON snapshots.

- **Serialization** uses compact single-character keys + LZ-string compression →
  URL hash fragment. No backend needed for sharing.

## Code Conventions

- Vanilla JS with ES modules (`import`/`export`). No TypeScript, no framework.
- Coordinates are normalized 0–1 (shape positions, sizes). Canvas renders at 800×800
  internal resolution, CSS-scaled to fit viewport.
- Shape IDs are generated with a counter + random suffix (e.g., `s1a3f`).
- Fill objects carry all three mode's parameters at once (solid HSL, radial Lab,
  linear HSL pair). The `mode` field selects which set is active.
- Audio effects return `{ input, output, dispose }` objects for uniform wiring.

## When Making Changes

- The render loop is driven by `needsRender` flag + `requestAnimationFrame`. Set
  `needsRender = true` or call `state._notify()` to trigger a redraw.
- To add a new shape type: update `state.js:createShape`, `canvas.js:buildShapePath`,
  `shapes.js:isPointInShape`, and `audio.js:oscillatorType`.
- To add a new pattern: update `patterns.js` (visual), `effects.js` (audio), and
  add a button in `index.html`.
- To add a new fill mode: update `colors.js`, `toolbar.js` picker, `audio.js` filter
  mapping, and `serialize.js` compact format.
- The `embed.html` page imports the same modules as the main app but only uses
  `canvas.js`, `audio.js`, `serialize.js`, and `envelope.js`.
