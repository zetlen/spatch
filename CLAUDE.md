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

## The Bijection Principle

**STRICT INVARIANT.** The canvas and the patch are bijective. Every field in the
canonical state must affect both canvas rendering and audio synthesis. No
visual-only state. No hidden audio parameters.

- Two states that look identical MUST sound identical.
- Two states that sound identical MUST look identical.
- Visual equivalences (rotation symmetry) are collapsed by making audio mappings
  periodic with the shape's geometric symmetry.

Violations of this principle must be **unrepresentable in the type system**, not
merely discouraged by convention. If you add a visual field, it must have an
audio mapping. If you add an audio parameter, it must be visible on the canvas.
No exceptions.

See `docs/plans/2026-03-01-bijective-audio-visual-design.md` for the full
design rationale and enumeration of past violations.

## Key Concepts

- **Voices** are the primary objects: circle (sine), square (pulse), triangle
  (saw/tri blend). Each voice is a discriminated union on `waveform`. Every field
  maps to both a visual property and an audio parameter:
  - `x` → horizontal position + stereo pan
  - `y` → vertical position + pitch (pentatonic with micro-detuning)
  - `size` → shape area + gain
  - `fill` → color/gradient + formant filter (hue→vowel, sat→Q, light→brightness)
  - `effect` → pattern overlay + audio effect chain
  - `timbre` (pulse/blend only) → rotation + waveform parameter. Rotation maps
    via symmetric half-sine, periodic per vertex count (90° for square, 120° for
    triangle). Circles have no timbre and no rotation.

- **Text decorations** use vocoder synthesis. Fields: text (vocoder content),
  x (pan), y (pitch), size (carrier volume), color (carrier formant filter,
  same hue→formant mapping as voice fills).

- **ADSR envelope** is encoded as the canvas corner radii. Drag corners to adjust.
  Bottom-left = attack, top-left = decay, top-right = sustain, bottom-right = release.

- **Play modes**: normal (press-and-hold), latch (click to toggle), loop
  (auto-repeating). Shift+drag = arpeggio mode.

- **State** lives in `SigilStore` (js/state.ts). It holds voices, text
  decorations, and envelope. All mutations go through this class. `UndoManager`
  wraps the store and provides undo/redo via JSON snapshots. Selection state is
  app-level, not in the store.

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
- **Voice** is a discriminated union (`SineVoice | PulseVoice | BlendVoice`),
  discriminated on the `waveform` field. Sine has no `timbre`; pulse and blend do.
- **TextDecoration** has text, x, y, size, and color fields — all with both
  visual and audio roles. No squiggles or curlicues.
- **InteractionState** is a discriminated union for the canvas interaction state
  machine (idle, dragging, resizing, rotating, etc.), replacing scattered variables.
- Audio effects return `{ input, output, dispose }` objects for uniform wiring.
- **Every new field must satisfy the bijection principle.** If you add a field
  to a voice or text decoration, you must add both a visual rendering path and
  an audio mapping. If you cannot identify both, the field should not exist.

**IMPORTANT: If you need a temporary directory for scratch files, build artifacts, or
throwaway work, use `tmp/` at the project root. It is gitignored. Do NOT create temp
files anywhere else.**

## When Making Changes

- The render loop is driven by `needsRender` flag + `requestAnimationFrame`. Set
  `needsRender = true` or call `store._notify()` to trigger a redraw.
- To add a new waveform/shape: add a variant to the Voice union in `types.ts`,
  update `state.ts:createVoice`, `canvas.ts:buildShapePath`,
  `shapes.ts:isPointInShape`, `audio.ts` voice builder, and `serialize.ts`.
  The new variant MUST map every field to both a visual and audio interpretation.
- To add a new pattern/effect: update `patterns.ts` (visual), `effects.ts`
  (audio), and add a button in `index.html`. Both sides are required.
- To add a new fill mode: add a variant to the `Fill` union in `types.ts`, update
  `fillToFillDraft`/`fillDraftToFill`, `colors.ts`, `toolbar.ts` picker, `audio.ts`
  formant mapping, and `serialize.ts`. Every fill field must affect the formant
  filter.
- To add a new field to any type: you MUST provide both a visual rendering path
  and an audio mapping. If either is missing, the field violates the bijection
  principle and must not be added.
- The `embed.html` page imports the same modules as the main app but only uses
  `canvas.ts`, `audio.ts`, `serialize.ts`, and `envelope.ts`.
