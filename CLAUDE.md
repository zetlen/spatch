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
css/style.css        All styles (CSS custom properties, flat hybrid-bevel theme)
js/
  types.ts           Shared type definitions: branded primitives, Voice
                     (discriminated union), Fill (discriminated union),
                     TextDecoration, Envelope, branding functions
  state.ts           SigilStore (data CRUD + change notification) and
                     UndoManager (undo/redo wrapping a store)
  interaction.ts     InteractionState discriminated union (idle, dragging,
                     resizing, rotating, adsr, deco-*, pinch-rotate)
  app.ts             Entry point: init, event wiring, render loop, selection
  embed-entry.ts     Entry point for embed.html viewer
  canvas.ts          SVG DOM reconciler (voices, text decorations, selection UI)
  shapes.ts          Resize/rotate math, ADSR corner testing
  colors.ts          Color conversions (HSL↔RGB↔Hex), SVG gradient helpers
  patterns.ts        SVG pattern definitions (stripes, checker, noise, gradient)
  effects.ts         Audio effect builders: pattern effects (chorus, tremolo,
                     flanger, phaser) and blend effects (saturation,
                     compression, exciter, gating, comb filter, flanger) +
                     overlap computation
  audio.ts           Web Audio engine: AudioEngine class, mapping functions
                     (pitch, pan, gain, timbre, formants), voice building
  envelope.ts        ADSR ↔ canvas corner radius conversion
  toolbar.ts         Toolbar class: tool/pattern/color picker UI binding
  decorations.ts     DecorationTool class: text placement only
  vocoder.ts         Formant synthesis for text decorations (bandpass filter bank)
  embed.ts           Embed snippet generator + modal UI
  serialize.ts       LZ-string URL serialization (positional arrays, no keys)
dist/                Build output (gitignored)
docs/plans/              Design docs and implementation plans
                         Convention: YYYY-MM-DD-{topic}-{design|plan}.md
tests/
  unit/*.test.js         Unit tests (bun test, plain JS)
  integration/*.test.js  Playwright integration tests
```

## How to Run

```bash
bun install          # install dependencies
bun run build        # build to dist/ (minified)
bun run dev          # build to dist/ (unminified, with source maps)
bun run test         # run unit + integration tests
bun run test:unit    # unit tests only (bun test)
bun run test:e2e     # integration tests only (Playwright, needs dev server)
bun run check        # typecheck (tsc --noEmit)
bun run lint         # lint (oxlint)
bun run fmt          # format (oxfmt)
```

**Pre-commit hooks** (lefthook): auto-formats staged files with oxfmt, fixes
lint with oxlint, and runs tsc. Commits will be auto-formatted.

Serve the `dist/` directory with any static server (e.g. `bunx serve dist`).

## CI/CD

- **Gitea instance**: `got.colonpipe.org`. API token is in `$GITEA_ACCESS_TOKEN`.
- **Versioning**: CalVer (`YYYY.MM.MICRO`), bumped automatically by CI on deploy.
  Micro increments per deploy within the month, resets on month change.
- **Deploy trigger**: Push to `main` (PR merge) or `workflow_dispatch`.
  Workflow is `.gitea/workflows/deploy.yml`.
- **Deploy mechanism**: `docker cp dist/. spatch:/usr/share/nginx/html/`
  into an nginx container. Site is at `https://spatch.music`.
- **Bot user**: `tiene` (matches action runner name). Admin collaborator,
  sole user whitelisted for direct push to protected `main`. Its token is
  stored as repo secret `PUSH_TOKEN`.
- **Version bump commit**: Uses `[skip ci]` in message to avoid infinite
  workflow loop.
- **Gotcha**: Changing workflow triggers (e.g. `on: release` → `on: push`)
  won't fire on the merge that introduces the change — Gitea evaluates the
  workflow file from the target branch *before* the merge lands.

## Transforms

`SigilData` is the single source of truth. Three transforms consume it:

```
                  ┌─────────────┐
                  │  SigilData  │
                  └──────┬──────┘
                         │
            ┌────────────┼────────────┐
            │            │            │
            ▼            ▼            ▼
     ┌─────────┐  ┌─────────────┐  ┌───────┐
     │   SVG   │  │  Serializer │  │ Audio │
     │ (bijec) │  │   (bijec)   │  │ (one  │
     │ data ↔  │  │  data ↔     │  │  way) │
     │ geometry│  │  string     │  │ data →│
     │         │  │             │  │ graph │
     └─────────┘  └─────────────┘  └───────┘
```

**SVG** and **Serializer** are bijective transforms — they must go both
directions without information loss. The SVG reconciler maps state to geometry
and geometry back to state (hit testing, resize handles, rotation gestures). The
serializer maps state to a URL string and back. If either direction is lossy or
ambiguous, tools or sharing break.

**Audio** is a one-way projection. State maps to audio graph parameters, but we
never parse audio back into state. When state changes, we reconcile the graph
(update parameters, rebuild voices if topology changed). There is no
`audioToState()`.

The two bijective transforms share no code — one is data↔data, the other is
data↔geometry — but they share the same **constraint**: every field in
`SigilData` must survive the round-trip. This is tested, not abstracted.

### The Bijection Principle

**STRICT INVARIANT.** Every field in SigilData must affect both SVG rendering
and audio synthesis. No visual-only state. No hidden audio parameters.

- Two states that look identical MUST sound identical.
- Two states that sound identical MUST look identical.
- Visual equivalences (rotation symmetry) are collapsed by making audio mappings
  periodic with the shape's geometric symmetry.

Violations of this principle must be **unrepresentable in the type system**, not
merely discouraged by convention. If you add a visual field, it must have an
audio mapping. If you add an audio parameter, it must be visible in the SVG.
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
  - `timbre` (pulse/blend only) → rotation + waveform parameter. Linear sawtooth
    ramp, periodic per vertex count (90° for square, 120° for triangle). Every
    angle within the period maps to a unique timbre. Circles have no timbre and
    no rotation.
  - `blend` → CSS `mix-blend-mode` + overlap-driven audio effect.
    Default is `soft-light`. Seven modes, each mapping to an audio chain:
    soft-light (tape saturation), multiply (heavy saturation), screen (compression),
    overlay (harmonic exciter), color-burn (gating), difference (comb filter),
    exclusion (swept flanger). Intensity is derived geometrically from shape
    overlap — no stored wet/dry parameter.
  - `border` → inset stroke(s) on the shape + octave-doubled sine oscillator.
    White border = octave up, black = octave down. Single = 1 octave shift,
    double = 2 octaves. `thickness` scales both the visual stroke width and
    the doubled oscillator's gain. Null = no border, no doubling.

- **Text decorations** use vocoder synthesis. Fields: text (vocoder content),
  x (pan), y (pitch), size (carrier volume). All text renders black. Every
  field is bijective.

- **Reverb** is a global effect on `SigilData` (not per-voice). The canvas
  frame gains an inset shadow (CSS `box-shadow: inset`) that maps to master
  reverb via a ConvolverNode with algorithmic impulse response. `depth`
  controls wet/dry mix and shadow intensity. `style` is either `glow` (short
  bright IR, white shadow) or `dim` (long dark IR, black shadow).

- **Canvas frame**: The canvas is split into `#canvas-frame` (div) and
  `#sigil-canvas` (SVG, `viewBox="0 0 1 1"`). The frame div owns the dark
  background, border-radius (ADSR corners), bevel border, inset shadow
  (reverb), and audio-reactive elevation shadow (play indicator). The SVG is
  transparent and renders shapes and touch selection indicators only, ensuring
  they appear above the shadow. During playback, `updateFrameShadow` in app.ts
  composes both the reverb inset shadow and a cool dark outer shadow whose
  intensity tracks real-time RMS audio level via an AnalyserNode in the audio
  engine.

- **ADSR envelope** is encoded as the canvas frame corner radii. Drag
  corners to adjust. Bottom-left = attack, top-left = decay, top-right =
  sustain, bottom-right = release.

- **Play modes**: normal (press-and-hold), latch (click to toggle), loop
  (auto-repeating).

- **State** lives in `SigilStore` (js/state.ts). It holds voices, text
  decorations, envelope, and reverb. All mutations go through this class. `UndoManager`
  wraps the store and provides undo/redo via JSON snapshots. Selection state is
  app-level, not in the store.

- **Serialization** uses positional arrays + LZ-string compression →
  URL hash fragment. No keys, no IDs in wire format. **No backwards compatibility
  until v1.** Old URLs will break. Do not write migration code, version checks,
  or legacy deserializers. Just change the format and move on.

## Code Conventions

- TypeScript with ES modules (`import`/`export`). No framework. Bun handles TS
  compilation at build time and in tests.
- Coordinates are normalized 0–1 (shape positions, sizes), branded as `NormalizedCoord`.
  Use `normalizedCoord()`, `degrees()`, `cents()` from `types.ts` at module boundaries
  instead of raw `as` casts. SVG uses `viewBox="0 0 1 1"` so all coordinates map
  directly to normalized space. Display size is CSS-scaled to fit viewport (max 800px).
- Shape IDs are generated with a counter + random suffix (e.g., `s1a3f`).
- **Fill** is a discriminated union (`SolidFill | RadialFill | LinearFill`). The
  toolbar uses a flat `FillDraft` bag internally for mode-switching without data loss,
  converted via `fillToFillDraft()` / `fillDraftToFill()`.
- **Voice** is a discriminated union (`SineVoice | PulseVoice | BlendVoice`),
  discriminated on the `waveform` field. Sine has no `timbre`; pulse and blend do.
- **TextDecoration** has text, x, y, size — all bijective. No color, no
  squiggles, no curlicues.
- **InteractionState** is a discriminated union for the canvas interaction state
  machine (idle, dragging, resizing, rotating, etc.), replacing scattered variables.
- **BlendMode** is a string union of the 7 supported blend modes.
  Each voice has a `blend` field (default `soft-light`). SVG renders each voice
  group with CSS `mix-blend-mode` inside an isolation container. Audio routes each
  voice through a blend effect whose wet/dry is computed from geometric overlap.
- **Border** is `{ color: BorderColor, double: boolean, thickness: NormalizedCoord } | null`.
  Visual: inset stroke(s) drawn inside the clipped shape. Audio: adds a sine
  oscillator at an octave-shifted frequency. Border changes trigger full voice
  rebuild in audio engine. The border panel UI (bottom toolbar) controls all fields.
- Audio pattern effects return `{ input, output, dispose }` objects. Blend effects
  return `{ input, output, wetGain, dispose }` (wetGain is externally controlled).
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
  update `state.ts:createVoice`, `canvas.ts` SVG element creation,
  `audio.ts` voice builder, and `serialize.ts`. Hit testing is handled natively
  by SVG pointer events. The new variant MUST map every field to both a visual
  and audio interpretation.
- To add a new pattern/effect: update `patterns.ts` (visual), `effects.ts`
  (audio), and add a button in `index.html`. Both sides are required.
- To add a new blend mode: add to the `BlendMode` union in `types.ts`,
  add a case in `createBlendEffect` in `effects.ts`, add pack/unpack entries
  in `serialize.ts`, and add an `<option>` in `index.html`. The mode must
  produce a visible difference when shapes overlap and map to an audio effect.
- To modify border behavior: update `Border` type in `types.ts`, update
  `canvas.ts` voice reconciliation (visual rendering), `audio.ts:_buildVoice` (octave
  oscillator), `serialize.ts` (pack/unpack), and `toolbar.ts` (border panel
  bindings). Border changes trigger full voice rebuild via `currentBorder`
  string comparison in `updateVoices`.
- To add a new fill mode: add a variant to the `Fill` union in `types.ts`, update
  `fillToFillDraft`/`fillDraftToFill`, `colors.ts`, `toolbar.ts` picker, `audio.ts`
  formant mapping, and `serialize.ts`. Every fill field must affect the formant
  filter.
- To add a new field to any type: you MUST provide both a visual rendering path
  and an audio mapping. If either is missing, the field violates the bijection
  principle and must not be added.
- To modify reverb behavior: update `Reverb` type in `types.ts`, update
  `app.ts:updateFrameShadow` (visual rendering), `audio.ts:updateReverb`
  (ConvolverNode + IR generation), `serialize.ts` (pack/unpack), and
  `toolbar.ts` (reverb panel bindings). Reverb is global — not per-voice.
- The `embed.html` page imports the same modules as the main app but only uses
  `canvas.ts`, `audio.ts`, `serialize.ts`, and `envelope.ts`. Both pages
  use the same frame div + transparent SVG architecture.
