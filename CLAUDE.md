# CLAUDE.md — spatch

## What This Is

spatch is a browser instrument. You compose visual sigils from geometric shapes
and hear them as synthesized chords. Every visual property maps to an audio parameter.

## Project Structure

```
package.json         Package manifest (Bun)
bun.lock             Lockfile
build.ts             Build script (Bun.build)
tsconfig.json        TypeScript configuration
index.html           Main app (source HTML entry point)
embed.html           Standalone embed viewer (reads state from URL hash)
css/style.css        All styles (CSS custom properties, synthwave theme)
js/
  types.ts           Shared type definitions: branded primitives, Shape, Fill
                     (discriminated union), Decoration (discriminated union),
                     Envelope, branding functions (normalizedCoord, degrees, cents)
  state.ts           SigilStore (data CRUD + change notification) and
                     UndoManager (undo/redo wrapping a store)
  interaction.ts     InteractionState discriminated union (idle, dragging,
                     resizing, rotating, adsr, arpeggio, deco-*, pinch-rotate)
  app.ts             Entry point: init, event wiring, render loop, selection
  embed-entry.ts     Entry point for embed.html viewer
  canvas.ts          Canvas 2D rendering (shapes, decorations, selection UI)
  shapes.ts          Hit testing, resize/rotate math
  colors.ts          Color conversions (HSL↔RGB, Lab↔RGB), picker renderers
  patterns.ts        Visual pattern tiles (stripes, checker, noise) + procedural
  effects.ts         Audio effect builders (chorus, tremolo, flanger, phaser, bitcrusher)
  audio.ts           Web Audio engine: AudioEngine class, Voice discriminated
                     union (sine/square/triangle), mapping functions
  envelope.ts        ADSR ↔ canvas corner radius conversion
  toolbar.ts         Toolbar class: tool/pattern/color picker UI binding
  decorations.ts     DecorationTool class: squiggle/curlicue/text placement
  vocoder.ts         Formant synthesis for text decorations (bandpass filter bank)
  embed.ts           Embed snippet generator + modal UI
  serialize.ts       Versioned LZ-string URL serialization (compact single-char keys)
  worklets/
    bitcrusher.js    AudioWorkletProcessor for the "rough" pattern effect
dist/                Build output (gitignored)
plans/
  sigil-synth-design.md  Original design document
  spatch-architecture.md Runtime architecture reference
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
  one oscillator voice. Position → pitch/pan, size → volume, rotation → timbre,
  color → filter, pattern → effect.

- **ADSR envelope** is encoded as the canvas corner radii. Drag corners to adjust.
  Bottom-left = attack, top-left = decay, top-right = sustain, bottom-right = release.

- **Play modes**: normal (press-and-hold), latch (click to toggle), loop
  (auto-repeating). Shift+drag = arpeggio mode.

- **State** lives in `SigilStore` (js/state.ts). It holds shapes, decorations, and
  envelope. All mutations go through this class. `UndoManager` wraps the store and
  provides undo/redo via JSON snapshots. Selection state is app-level, not in the store.

- **Serialization** uses compact single-character keys + LZ-string compression →
  URL hash fragment. No backend needed for sharing.

## Code Conventions

- TypeScript with ES modules (`import`/`export`). No framework. Bun handles TS
  compilation at build time and in tests.
- Coordinates are normalized 0–1 (shape positions, sizes), branded as `NormalizedCoord`.
  Use `normalizedCoord()`, `degrees()`, `cents()` from `types.ts` at module boundaries
  instead of raw `as` casts. Canvas renders at 800×800 internal resolution, CSS-scaled
  to fit viewport.
- Shape IDs are generated with a counter + random suffix (e.g., `s1a3f`).
- **Fill** is a discriminated union (`SolidFill | RadialFill | LinearFill`). The
  toolbar uses a flat `FillDraft` bag internally for mode-switching without data loss,
  converted via `fillToFillDraft()` / `fillDraftToFill()`.
- **Decoration** is a discriminated union (`SquiggleDecoration | CurlicueDecoration |
  TextDecoration`), discriminated on the `type` field.
- **Voice** is a discriminated union (`SineVoice | SquareVoice | TriangleVoice`),
  discriminated on the `waveform` field.
- **InteractionState** is a discriminated union for the canvas interaction state
  machine (idle, dragging, resizing, rotating, etc.), replacing scattered variables.
- Audio effects return `{ input, output, dispose }` objects for uniform wiring.

**IMPORTANT: If you need a temporary directory for scratch files, build artifacts, or
throwaway work, use `tmp/` at the project root. It is gitignored. Do NOT create temp
files anywhere else.**

## When Making Changes

- The render loop is driven by `needsRender` flag + `requestAnimationFrame`. Set
  `needsRender = true` or call `store._notify()` to trigger a redraw.
- To add a new shape type: update `types.ts:ShapeType`, `state.ts:createShape`,
  `canvas.ts:buildShapePath`, `shapes.ts:isPointInShape`, and `audio.ts:oscillatorType`.
- To add a new pattern: update `patterns.ts` (visual), `effects.ts` (audio), and
  add a button in `index.html`.
- To add a new fill mode: add a variant to the `Fill` union in `types.ts`, update
  `fillToFillDraft`/`fillDraftToFill`, `colors.ts`, `toolbar.ts` picker, `audio.ts`
  filter mapping, and `serialize.ts` compact format.
- To add a new decoration type: add a variant to the `Decoration` union in `types.ts`,
  a factory in `state.ts`, and rendering in `canvas.ts`.
- The `embed.html` page imports the same modules as the main app but only uses
  `canvas.ts`, `audio.ts`, `serialize.ts`, and `envelope.ts`.
