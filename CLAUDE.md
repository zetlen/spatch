# CLAUDE.md — spatch

## Branch Rebase Rule

Working branches must be fully rebased on `origin/main`. Stale branches
cause conflicts and regressions that are expensive to fix. Check at session
start and before every push:

```bash
git fetch origin main && git log HEAD..origin/main --oneline
```

If this produces any output, stop and rebase before doing other work:
`git rebase origin/main` — then verify build and tests still pass.

If the branch is behind `origin/main`, confirm with the user before proceeding.
The lefthook `pre-push` hook also blocks pushes of stale branches.

## What This Is

spatch is a browser instrument. You compose visual sigils from geometric shapes
and hear them as synthesized chords. Every visual property maps to an audio parameter.

## Project Structure

```
package.json         Package manifest (Bun)
bun.lock             Lockfile
vite.config.ts       Vite build/dev config (plugins, MPA input)
tsconfig.json        TypeScript configuration
index.html           Main app (source HTML entry point)
embed.html           Standalone embed viewer (reads state from URL hash)
css/style.css        All styles (CSS custom properties, flat hybrid-bevel theme)
scripts/
  vite-plugin-svg-sprite.ts  Reusable Vite plugin: scans sources for icon refs,
                             builds SVG sprite, inlines into HTML
js/
  virtual.d.ts       Type declaration for __VIBE_DEBUG__ compile-time flag
  dom.ts             Typed DOM helper: qel() wraps querySelector with type
                     parameter and runtime null check
  types.ts           Shared type definitions: branded primitives, Voice
                     (discriminated union), Fill (discriminated union),
                     Envelope, branding functions
  state.ts           SigilStore (data CRUD + @preact/signals change notification)
                     and UndoManager (undo/redo wrapping a store)
  state/
    selection.ts     SelectionManager: app-level voice selection backed by signals
  interaction.ts     InteractionState discriminated union (idle, dragging,
                     resizing, rotating, adsr, pinch-rotate)
  app.ts             Entry point: init, event wiring, render loop, selection
  embed-entry.ts     Entry point for embed.html viewer
  keyboard.ts        Global keyboard shortcut handler (delete, copy/paste,
                     undo/redo, escape, tool switch, space play toggle)
  playback.ts        PlaybackController: play/stop/latch/loop state machine
  splash.ts          SplashController: first-visit splash screen
  canvas/
    render.ts        SVG DOM reconciler (voices, selection UI)
    interaction.ts   CanvasInteractionController: pointer/touch input on canvas
  audio/
    engine.ts        AudioEngine class: Web Audio lifecycle, voice management,
                     vibe-driven reverb/EQ/compression, analyser
    ir-loader.ts     Two-layer IR cache: fetchIR (bytes) + decodeIR (AudioBuffer)
    mapping.ts       Audio mapping functions (pitch, pan, gain, timbre, formants)
    voice-builder.ts Voice audio graph construction (oscillators, effects, borders)
    vibe.ts          Vibe class: perceptual gain tuning, reverb, mastering, synthesis params
    formants.ts      Formant filter bank for fill-driven vowel synthesis
  scenes/
    scene-types.ts   Scene interface (name, stageBackground, imageCredit, creditUrl?, vibe)
    index.ts         SCENES registry, getScene(), applyScene() crossfade,
                     initStageLayers() for two-layer background transition
    loader.ts        prefetchScene(), loadSceneIR(), preloadNextScene()
    <name>/          One directory per scene (see "Scene convention" below)
      index.ts       Default export of Scene object
      *.jpg          Stage background image
      *.m4a          Impulse response audio (optional)
  toolbar/
    toolbar.ts       Toolbar class: tool/pattern/color picker UI binding
    blend-panel.ts   Blend mode expansion panel
    border-panel.ts  Border settings expansion panel
    fill-panel.ts    Fill color/gradient expansion panel
    pattern-panel.ts Pattern effect dropdown panel
    harmonize-panel.ts Long-press scale picker for harmonize button
    dom-helpers.ts   Shared DOM construction helpers for toolbar panels
  debug/
    vibe-tuner.ts    Debug-only vibe tuner side drawer (?debug=vibe, elided in production)
  harmony.ts         Randomize (create random spatch) and harmonize (snap
                     pitches to a random musical scale). 9 scales: major/minor
                     pentatonic, mixolydian, lydian, phrygian, dorian, natural
                     minor, blues, mu. Randomize sets random scene, ADSR,
                     voices with varied properties, then harmonizes.
  shapes.ts          Resize/rotate math, ADSR corner testing
  colors.ts          Color conversions (HSL↔RGB↔Hex), SVG gradient helpers
  patterns.ts        SVG pattern definitions (stripes, checker, noise, gradient)
  effects.ts         Audio effect builders: pattern effects (chorus, tremolo,
                     flanger, phaser) and blend effects (saturation,
                     compression, exciter, gating, comb filter, flanger) +
                     overlap computation
  envelope.ts        ADSR ↔ canvas corner radius conversion
  serialize.ts       Bespoke Base64 URL serialization (bitfield-packed, no keys)
dist/                Build output (gitignored)
docs/plans/              Design docs and implementation plans
                         Convention: YYYY-MM-DD-{topic}-{design|plan}.md
tests/
  unit/*.test.js         Unit tests (bun test, plain JS)
  integration/*.test.js  Playwright integration tests
```

## How to Run

```bash
bun install          # install dependencies (MUST run before build/dev)
bun run build        # production build to dist/ (vite build)
bun run dev          # Vite dev server with HMR (port 5173)
bun run preview      # serve production build locally (vite preview)
bun run test         # run unit + integration tests
bun run test:unit    # unit tests only (bun test)
bun run test:e2e     # integration tests only (Playwright, needs dev server)
bun run check        # typecheck (tsc --noEmit)
bun run lint         # lint (oxlint)
bun run fmt          # format (oxfmt)
```

**IMPORTANT:** `bun install` must be run before `bun run build` or `bun run dev`.
The build will fail if dependencies are missing or if any referenced tabler icon
cannot be found in `node_modules`.

**Serve note:** `bun run dev` starts a Vite dev server (port 5173) with HMR.
For production testing, use `bun run build && bun run preview`.

**Pre-commit hooks** (lefthook): auto-formats staged files with oxfmt, fixes
lint with oxlint, and runs tsc. Commits will be auto-formatted.

Serve the `dist/` directory with any static server (e.g. `bunx serve dist`).

## CI/CD

- **Gitea instance**: `got.colonpipe.org`. API token is in `$GITEA_ACCESS_TOKEN`.
- **Runner**: Custom `mise-playwright` Docker image with mise, Playwright, and
  browser deps pre-installed. Tool versions (Bun, Node) pinned in `.mise.toml`.
- **CI check**: `.gitea/workflows/ci.yml` runs on PRs to `main`. Runs typecheck,
  lint, format check, unit tests, integration tests, and build.
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
  - `y` → vertical position + pitch (chromatic, 3 octaves G2–G5, magnetic
    snap during drag, hard snap to nearest note on release)
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
    the doubled oscillator's gain. Undefined = no border, no doubling.

- **Scene** is a global index on `SigilData` (not per-voice). Each scene is
  a self-contained module in `js/scenes/<name>/` containing a background image
  (`.jpg`), an optional impulse response (`.m4a`), and an `index.ts` that
  exports a `Scene` object (`{ name, stageBackground, imageCredit, vibe }`).
  The scene index is serialized as 1 B64 char (0–63) in the URL. Clicking the
  stage button advances to the next scene. The `SCENES` array in
  `js/scenes/index.ts` is the registry. Scene satisfies the bijection
  principle: scene index → background image (visual) + vibe preset (audio).
  Scene transitions use a two-layer CSS crossfade (two `.stage-bg` divs swap
  opacity). Assets (image + IR bytes) are prefetched before the crossfade
  begins, and the next scene is preloaded in the background.

- **Vibe** (`audio/vibe.ts`) encapsulates all audio tuning: gain curves,
  reverb (ConvolverNode with IR file), compressor, 3-band EQ, formant
  scaling, warmth, stereo width, and octave gain coefficients. A `vibe`
  module binding is set via `setVibe()` when the scene changes or the debug
  tuner adjusts a slider. The `Vibe` class takes `VibeOptions` with ~25
  optional params; `VIBE_DEFAULTS` provides defaults. Each scene provides
  `vibe: Partial<VibeOptions>` overrides including an `ir` field pointing
  to the scene's `.m4a` impulse response, plus EQ, compression, warmth,
  and synthesis params that give each scene a distinct sonic character.
  **Reactivity**: `vibeSignal` is a `@preact/signals-core` signal that
  `setVibe()` updates alongside the module binding. `app.ts` subscribes
  via `effect()` to push vibe changes to the audio engine in real time.
  Imperative audio code (`engine.ts`, `voice-builder.ts`, `formants.ts`)
  reads the non-reactive `vibe` export directly. IR loading uses a
  two-phase cache (`audio/ir-loader.ts`): `fetchIR()` fetches raw bytes
  (no AudioContext needed, enabling prefetch before user gesture), and
  `decodeIR()` decodes to an `AudioBuffer` on demand. The debug tuner
  (`?debug=vibe`) exposes all params in a side drawer and auto-syncs
  sliders when the scene changes externally.

- **Canvas frame**: The canvas is split into `#canvas-wrap` (div) and
  `#sigil-canvas` (SVG, `viewBox="0 0 1 1"`). The frame div owns the dark
  background, border-radius (ADSR corners), bevel border, and audio-reactive
  elevation shadow (play indicator). The SVG is transparent and renders shapes
  and touch selection indicators only, ensuring they appear above the shadow.

- **ADSR envelope** is encoded as the canvas frame corner radii. Drag
  corners to adjust. Bottom-left = attack, top-left = decay, top-right =
  sustain, bottom-right = release.

- **Play modes**: normal (press-and-hold), latch (click to toggle), loop
  (auto-repeating).

- **State** lives in `SigilStore` (js/state.ts). It holds voices,
  envelope, and scene index. All mutations go through this class. `UndoManager`
  wraps the store and provides undo/redo via JSON snapshots. Selection state is
  app-level in `SelectionManager` (js/state/selection.ts), backed by
  @preact/signals-core signals.

- **Serialization** uses a bespoke Base64 encoding with bitfield-packed flags →
  URL hash fragment. No keys, no IDs in wire format. HSL and normalized values
  are quantized to integers during packing. **No backwards compatibility
  until v1.** Old URLs will break. Do not write migration code, version checks,
  or legacy deserializers. Just change the format and move on.

## The Triple Sec Rule

If a code pattern is **more than 3 lines** and appears **more than 3 times**,
extract it into a shared function or helper. No exceptions. DRY it up.

## Code Conventions

- TypeScript with ES modules (`import`/`export`). No framework. Bun handles TS
  compilation at build time and in tests.
- Coordinates are normalized 0–1 (shape positions, sizes), branded as `NormalizedCoord`.
  Use `normalizedCoord()`, `degrees()`, `cents()` from `types.ts` at module boundaries
  instead of raw `as` casts. SVG uses `viewBox="0 0 1 1"` so all coordinates map
  directly to normalized space. Display size is CSS-scaled to fit viewport (max 800px).
- Shape IDs are generated with a counter + random suffix (e.g., `s1a3f`).
- **Fill** is a discriminated union (`SolidFill | LinearFill`). The
  toolbar uses a flat `FillDraft` bag internally for mode-switching without data loss,
  converted via `fillToFillDraft()` / `fillDraftToFill()`.
- **Voice** is a discriminated union (`SineVoice | PulseVoice | BlendVoice`),
  discriminated on the `waveform` field. Sine has no `timbre`; pulse and blend do.
- **InteractionState** is a discriminated union for the canvas interaction state
  machine (idle, dragging, resizing, rotating, etc.), replacing scattered variables.
- **BlendMode** is a string union of the 7 supported blend modes.
  Each voice has a `blend` field (default `soft-light`). SVG renders each voice
  group with CSS `mix-blend-mode` inside an isolation container. Audio routes each
  voice through a blend effect whose wet/dry is computed from geometric overlap.
- **Border** is `{ color: BorderColor, double: boolean, thickness: NormalizedCoord } | undefined`.
  Visual: inset stroke(s) drawn inside the clipped shape. Audio: adds a sine
  oscillator at an octave-shifted frequency. Border changes trigger full voice
  rebuild in audio engine. The border panel UI (bottom toolbar) controls all fields.
- Audio pattern effects return `{ input, output, dispose }` objects. Blend effects
  return `{ input, output, wetGain, dispose }` (wetGain is externally controlled).
- **Every new field must satisfy the bijection principle.** If you add a field
  to a voice, you must add both a visual rendering path and an audio mapping.
  If you cannot identify both, the field should not exist.

**IMPORTANT: If you need a temporary directory for scratch files, build artifacts, or
throwaway work, use `tmp/` at the project root. It is gitignored. Do NOT create temp
files anywhere else.**

## Browser / Device Compatibility

### iOS Safari Audio Unlock

iOS Safari (and macOS Safari to a lesser extent) only allows `AudioContext`
creation and `resume()` from **qualifying user gestures**: `touchend`, `click`,
`doubleclick`, `keydown`. Notably, `pointerdown`, `pointerup`, and `mousedown`
are **not** qualifying gestures.

Additionally, iOS Safari revokes user-gesture privileges after any microtask
boundary (including `await`). This means:

- `_init()` and `warmUp()` **must be fully synchronous** — no `async`, no
  `await`, no promises in the path from gesture handler to `AudioContext`
  creation and `resume()`.
- `play()` must not `await ctx.resume()`. Call it fire-and-forget; `warmUp()`
  already called it from the gesture handler.
- The splash handler must fire from `touchend` or `click` — **never**
  `pointerup`, which fires before `touchend` on iOS and races the audio unlock.

The current unlock strategy (in `audio.ts:_init()`) uses three layers:
1. **Silent buffer trick**: Play a 1-sample silent buffer through
   `ctx.destination` to "warm" the context.
2. **Synchronous `resume()`**: Call `ctx.resume()` without awaiting — the
   promise resolves asynchronously but the gesture privilege is consumed
   synchronously.
3. **MediaStreamDestination keep-alive**: Route audio to both `ctx.destination`
   (actual sound) and a `MediaStreamAudioDestinationNode` → hidden `<audio>`
   element. Safari treats `<audio> srcObject` streams as "real" media, preventing
   the context from being suspended during playback. The `<audio>` element does
   **not** produce audible output — it only signals to the OS that media is
   active. The element is **paused in `_cleanup()`** to release the iOS audio
   session (dropping the status bar speaker icon), and **resumed in `play()`**
   (best-effort) plus permanent `touchend`/`click` listeners on `document`
   that resume it from qualifying gestures when `isPlaying` is true.

**Event wiring rules:**
- Global warmup: `touchend`, `click`, `keydown` on `document`.
- Splash dismiss: `touchend` + `click` on `canvasArea`. Do NOT use `pointerup`.
- Play button: `pointerdown` for eager `warmUp()` (creates the context early,
  even though the gesture doesn't qualify — so it's ready when a qualifying
  event fires). Actual playback starts in the same handler.

## When Making Changes

- The render loop is driven by `needsRender` flag + `requestAnimationFrame`. Set
  `needsRender = true` or call `store._notify()` to trigger a redraw.
- To add a new waveform/shape: add a variant to the Voice union in `types.ts`,
  update `state.ts:createVoice`, `canvas/render.ts` SVG element creation,
  `audio/voice-builder.ts`, and `serialize.ts`. Hit testing is handled natively
  by SVG pointer events. The new variant MUST map every field to both a visual
  and audio interpretation.
- To add a new pattern/effect: update `patterns.ts` (visual), `effects.ts`
  (audio), and add a button in `index.html`. Both sides are required.
- To add a new blend mode: add to the `BlendMode` union in `types.ts`,
  add a case in `createBlendEffect` in `effects.ts`, add pack/unpack entries
  in `serialize.ts`, and add an `<option>` in `index.html`. The mode must
  produce a visible difference when shapes overlap and map to an audio effect.
- To modify border behavior: update `Border` type in `types.ts`, update
  `canvas/render.ts` voice reconciliation (visual rendering),
  `audio/voice-builder.ts` (octave oscillator), `serialize.ts` (pack/unpack),
  and `toolbar/border-panel.ts` (border panel UI). Border changes trigger full
  voice rebuild via `currentBorder` string comparison in `updateVoices`.
- To add a new fill mode: add a variant to the `Fill` union in `types.ts`, update
  `fillToFillDraft`/`fillDraftToFill`, `colors.ts`, `toolbar/fill-panel.ts`
  picker, `audio/mapping.ts` formant mapping, and `serialize.ts`. Every fill
  field must affect the formant filter.
- To add a new field to any type: you MUST provide both a visual rendering path
  and an audio mapping. If either is missing, the field violates the bijection
  principle and must not be added.
- To modify scene/vibe behavior: update the `Scene` interface in
  `scenes/scene-types.ts`, `VibeOptions` and `Vibe` class in
  `audio/vibe.ts` (audio params), `audio/engine.ts` (master chain wiring),
  `audio/voice-builder.ts` (per-voice params read from vibe), and
  `debug/vibe-tuner.ts` (debug UI). Scene index is serialized in
  `serialize.ts` as 1 B64 char. Stage button cycles scenes via
  `store.updateScene()` in `app.ts`. App.ts reactively calls `setVibe()`
  and `applyScene()` when scene changes.
- To add a new scene: create a directory under `js/scenes/<name>/` with a
  background `.jpg`, an optional IR `.m4a`, and an `index.ts` that default-
  exports a `Scene` object. Import and add it to `SCENES` in
  `js/scenes/index.ts`. Tune vibe params using `?debug=vibe`. See "Scene
  convention" below for the full format.
- The `embed.html` page imports the same modules as the main app but only uses
  `canvas/render.ts`, `audio/engine.ts`, `serialize.ts`, `scenes/`,
  `audio/ir-loader.ts`, and `envelope.ts`. It blocks reveal and playback
  until scene assets are loaded.

## Scene Convention

Each scene is a self-contained directory under `js/scenes/<name>/`:

```
js/scenes/chiclet/
  index.ts                   Scene definition (default export)
  chairpillows.jpg           Stage background image
  DomesticLivingRoom.m4a     Impulse response for convolution reverb
```

The `index.ts` follows a fixed pattern:

```ts
import type { Scene } from '../scene-types';
import stageBackground from './image.jpg';
import ir from './SomeImpulseResponse.m4a';

const scene: Scene = {
  name: 'scene-name',
  stageBackground,
  imageCredit: 'photographer or source',
  creditUrl: 'https://link-to-credit',  // optional; omit if no URL available
  vibe: {
    ir,                       // IR file URL (resolved by Vite)
    reverbMix: 0.7,           // + any other Partial<VibeOptions> overrides
  },
};

export default scene;
```

Vite resolves the `.jpg` and `.m4a` imports to asset URLs at build time. The
`ir` field in `vibe` points to the IR file's URL; it is fetched by
`ir-loader.ts` and decoded into an `AudioBuffer` for the ConvolverNode. Scenes
without an IR file omit the `ir` import and field.

**To add a new scene:**
1. Create `js/scenes/<name>/` with the image, optional IR, and `index.ts`.
2. Import the scene in `js/scenes/index.ts` and append it to the `SCENES` array.
3. Tune vibe overrides using `?debug=vibe` in dev mode.

**Asset loading:** `prefetchScene()` preloads both the background image (via
`new Image()`) and IR bytes (via `fetchIR()`) before a scene transition begins.
`loadSceneIR()` decodes the prefetched bytes into an `AudioBuffer` when an
`AudioContext` is available. After each scene change, the next scene's assets
are preloaded in the background via `preloadNextScene()`.
