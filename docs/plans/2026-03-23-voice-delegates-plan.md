# Voice Delegates Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `WaveformStrategy` into three delegates (UI, Player,
Serializer) with a declarative registry, and replace the v1 wire format with
a register-based v2 that is 31% shorter on production URLs.

**Spec:** `docs/plans/2026-03-23-voice-delegates-design.md`

**Tech Stack:** TypeScript, Bun (test runner), Vite (build), no frameworks.

### File layout

Voices follow the same per-type folder convention as scenes and stamples.
Each voice type is a folder with co-located UI, Player, and registry entry.
Shared serializers live in a sibling `serializers/` folder.

```
js/voices/
  types.ts              Delegate interfaces, VoiceRegistryEntry
  registry.ts           Registry table, get(), all(), createVoice()
  b64.ts                Base64 encode/decode utilities
  serializers/
    oscillator.ts       Shared serializer for oscillator voices
    sample.ts           Shared serializer for sample voices
  sine/
    index.ts            Registry entry: { ui, player, serializer }
    ui.ts               Circle rendering + handles
    player.ts           Sine oscillator + warmth shaper
  pulse/
    index.ts
    ui.ts               Square rendering + rotation handles
    player.ts           Sawtooth + PWM waveshaper
  blend/
    index.ts
    ui.ts               Triangle rendering + rotation handles
    player.ts           Dual oscillator crossfade
  astroid/
    index.ts
    ui.ts               Astroid path + rotation handles
    player.ts           6-oscillator supersaw
  stamp/
    index.ts
    ui.ts               <use>/<symbol> + hull hit-testing
    player.ts           AudioBufferSource + FM osc
    lifecycle.ts        initStampSymbols, prefetch, decode, default index
```

Adding a new voice: create `js/voices/<name>/` with `index.ts`, `ui.ts`,
`player.ts`, add one import + entry in `registry.ts`.

---

## Chunk 1: Delegate Interfaces and Registry Shell

Create the new type definitions and registry alongside the existing
`WaveformStrategy` system. Nothing changes at runtime yet — this chunk only
adds new files.

### Task 1.1: Define delegate interfaces

**File:** `js/voices/types.ts`

- [ ] Define `VoiceUI` interface:
  - `readonly svgTag: string`
  - `readonly shapeName: string`
  - `readonly rotationPeriod: number`
  - `createSvgElement(voice: Voice): SVGElement`
  - `updateSvgElement(el: SVGElement, voice: Voice): void`
  - `createSelectionElement?(voice: Voice): SVGElement`
  - `selectionHandles(voice: Voice): SVGElement[]`

- [ ] Define `VoicePlayer` interface:
  - `buildAudioGraph(ctx: AudioContext, voice: Voice, shared: AudioSharedNodes): AudioVoice`

- [ ] Define `VoiceSerializer` interface:
  - `readonly width: number`
  - `pack(voice: Voice): string`
  - `unpack(registers: string): Voice`

- [ ] Define `VoiceRegistryEntry` type:
  - `readonly waveform: WaveformType`
  - `readonly id: number`
  - `readonly rotationPeriod: number`
  - `readonly ui: VoiceUI`
  - `readonly player: VoicePlayer`
  - `readonly serializer: VoiceSerializer`

- [ ] Re-export `AudioSharedNodes` and `AudioVoice` from
  `js/waveforms/types.ts` (these interfaces stay unchanged).

### Task 1.2: Create registry module

**File:** `js/voices/registry.ts`

- [ ] Define `VoiceRegistry` class or module:
  - `get(waveform: WaveformType): VoiceRegistryEntry`
  - `getById(id: number): VoiceRegistryEntry`
  - `all(): VoiceRegistryEntry[]` (sorted by id)
  - `createVoice(waveform, base: VoiceBase): Voice` — derived from entry's
    serializer field declarations
  - `hasTimbre(waveform): boolean` — derived from
    `entry.rotationPeriod > 0`

- [ ] Initially populate with empty/stub entries that will be filled in
  Chunk 2. The registry module should compile but is not yet wired to
  any call sites.

### Task 1.3: Verify build

- [ ] `bun run check` passes (no type errors from new files).
- [ ] `bun run test` passes (no runtime changes yet).

---

## Chunk 2: Extract UI Delegates

Move SVG rendering and interaction code from each `WaveformStrategy` into
standalone `VoiceUI` objects. Each strategy file becomes thinner; the new UI
delegate files are created in `js/voices/`.

### Task 2.1: Extract circle UI (sine)

**File:** `js/voices/sine/ui.ts`

- [ ] Move `circleAttrs()`, `createSvgElement()`, `updateSvgElement()`,
  `selectionHandles()` from `js/waveforms/sine.ts` into `circleUI` object
  implementing `VoiceUI`.
- [ ] Set `svgTag: 'circle'`, `shapeName: 'circle'`, `rotationPeriod: 0`.

### Task 2.2: Extract square UI (pulse)

**File:** `js/voices/pulse/ui.ts`

- [ ] Move `rectAttrs()`, rendering, and handle code from
  `js/waveforms/pulse.ts`. Includes rotation handle via `rotationHandleEls`.
- [ ] Set `rotationPeriod: 90`.

### Task 2.3: Extract triangle UI (blend)

**File:** `js/voices/blend/ui.ts`

- [ ] Move polygon rendering and handle code from `js/waveforms/blend.ts`.
- [ ] Set `rotationPeriod: 120`.

### Task 2.4: Extract astroid UI

**File:** `js/voices/astroid/ui.ts`

- [ ] Move path rendering and handle code from `js/waveforms/astroid.ts`.
- [ ] Set `rotationPeriod: 90`.

### Task 2.5: Extract stamp UI

**File:** `js/voices/stamp/ui.ts`

- [ ] Move `<use>`/`<symbol>` rendering, hull hit-testing, `stampBounds()`,
  `transformHullPath()`, `createSelectionElement()` from
  `js/waveforms/stamp.ts`.
- [ ] Set `rotationPeriod: 0`.

**File:** `js/voices/stamp/lifecycle.ts`

- [ ] Move `initStampSymbols()`, `prefetchStampSamples()`,
  `decodeStampSamples()`, `setDefaultStampleIndex()`,
  `getDefaultStampleIndex()` — lifecycle concerns, not UI.

### Task 2.6: Verify

- [ ] `bun run check` — new UI delegate files type-check.
- [ ] `bun run test` — all existing tests still pass.

---

## Chunk 3: Extract Player Delegates

Move audio graph construction from each `WaveformStrategy` into standalone
`VoicePlayer` objects. Audio tuning constants become constructor args.

### Task 3.1: Extract sine player

**File:** `js/voices/sine/player.ts`

- [ ] Move `buildAudioGraph()` from `js/waveforms/sine.ts`.
- [ ] Constructor receives `{ oscillatorType: 'sine', shapeAreaCoeff: Math.PI, formantMaxQ: 4, gainExponent: 1.0 }`.

### Task 3.2: Extract pulse player

**File:** `js/voices/pulse/player.ts`

- [ ] Move `buildAudioGraph()` and PWM setup from `js/waveforms/pulse.ts`.
- [ ] Constructor receives `{ oscillatorType: 'square', shapeAreaCoeff: 4, formantMaxQ: 8, gainExponent: 1.6 }`.

### Task 3.3: Extract blend player

**File:** `js/voices/blend/player.ts`

- [ ] Move dual-oscillator crossfade graph from `js/waveforms/blend.ts`.

### Task 3.4: Extract astroid player

**File:** `js/voices/astroid/player.ts`

- [ ] Move 6-oscillator supersaw graph from `js/waveforms/astroid.ts`.

### Task 3.5: Extract stamp player

**File:** `js/voices/stamp/player.ts`

- [ ] Move AudioBufferSource + FM oscillator graph from
  `js/waveforms/stamp.ts`.

### Task 3.6: Verify

- [ ] `bun run check` passes.
- [ ] `bun run test` passes.

---

## Chunk 4: Build Serializer Delegates and v2 Format

Implement the register-based serialization as `VoiceSerializer` classes.
This is the core format change.

### Task 4.1: Create base64 utility module

**File:** `js/voices/b64.ts`

- [ ] Move `B64_CHARS`, `B64_MAP`, `encodeInt()`, `decodeInt()` from
  `js/serialize.ts` into a shared utility module.
- [ ] `js/serialize.ts` re-exports from this module for backwards compat
  (existing waveform files import from serialize.ts).

### Task 4.2: Implement OscillatorSerializer

**File:** `js/voices/serializers/oscillator.ts`

- [ ] Implements `VoiceSerializer` for sine, pulse, blend, astroid.
- [ ] `width`: 10 (solid) or 15 (gradient) register chars.
- [ ] `pack(voice)`: Encodes CP1, (CP2 if gradient), SP1–SP6 per the
  register layout in the design doc.
- [ ] `unpack(registers)`: Decodes register string back to a `Voice`.
  Calls `genId('v')` for the voice ID.
- [ ] SP4 = timbre (0 for sine, quantized to 6 bits for others).

### Task 4.3: Implement SampleSerializer

**File:** `js/voices/serializers/sample.ts`

- [ ] Implements `VoiceSerializer` for stamp voices.
- [ ] Same register layout as OscillatorSerializer except SP4 = stamp
  index (3b) + trigger (2b) + spare (1b).

### Task 4.4: Write serializer unit tests

**File:** `tests/unit/serialize-v2.test.js`

- [ ] Round-trip tests for every voice type (all waveforms × solid/gradient
  × border/no-border).
- [ ] Canonical ordering: permuted voices produce identical strings.
- [ ] Quantization accuracy: encode → decode stays within expected step
  size for each parameter.
- [ ] Edge cases: max/min values for each register, all-zero voice.
- [ ] Format structure: verify version byte, scene byte, envelope packing.

### Task 4.5: Verify

- [ ] `bun run check` passes.
- [ ] New v2 serializer tests pass.
- [ ] Old v1 serializer tests still pass (v1 code untouched).

---

## Chunk 5: Wire Registry and Replace getStrategy()

Connect the delegate objects into the registry and migrate all 14 consumer
files from `getStrategy(wf).method()` to `registry.get(wf).delegate.method()`.

### Task 5.1: Populate registry entries

**Modify:** `js/voices/registry.ts`

- [ ] Wire each entry with its UI, Player, and Serializer delegates:
  ```
  sine    → circleUI,   sinePlayer,    oscillatorSerializer
  pulse   → squareUI,   pulsePlayer,   oscillatorSerializer
  blend   → triangleUI, blendPlayer,   oscillatorSerializer
  astroid → astroidUI,  astroidPlayer, oscillatorSerializer
  stamp   → stampUI,    stampPlayer,   sampleSerializer
  ```
- [ ] Implement `createVoice()` as a generic factory that applies the
  entry's extra field defaults.

### Task 5.2: Migrate UI consumers

**Modify:** `js/canvas/render.ts`

- [ ] Replace `getStrategy(wf).createSvgElement()` →
  `registry.get(wf).ui.createSvgElement()`
- [ ] Same for `updateSvgElement()`, `svgTag`, `selectionHandles()`,
  `createSelectionElement()`.

**Modify:** `js/shapes.ts`

- [ ] Replace `getStrategy(wf).getTimbre()` / `.rotationPeriod` →
  `registry.get(wf).ui.rotationPeriod` + inline timbre read.

**Modify:** `js/canvas/interaction.ts`

- [ ] Replace `getStrategy(wf).hasTimbre` →
  `registry.hasTimbre(wf)`.
- [ ] Replace `ALL_STRATEGIES.map(s => [s.shapeName, s.waveform])` →
  `registry.all().map(...)`.

### Task 5.3: Migrate Player consumers

**Modify:** `js/audio/voice-builder.ts`

- [ ] Replace `getStrategy(wf).oscillatorType` →
  access via registry entry's player constructor args (or a method on the
  registry entry that exposes the constant).
- [ ] Replace `getStrategy(wf).buildAudioGraph()` →
  `registry.get(wf).player.buildAudioGraph()`.

**Modify:** `js/audio/formants.ts`

- [ ] Replace `getStrategy(wf).formantMaxQ` → access via registry.

**Modify:** `js/audio/mapping.ts`

- [ ] Replace `getStrategy(wf).rotationPeriod` →
  `registry.get(wf).rotationPeriod` (bijection constant on entry) or
  `registry.get(wf).ui.rotationPeriod`.

**Modify:** `js/audio/vibe.ts`

- [ ] Replace `ALL_STRATEGIES` iteration → `registry.all()`.
- [ ] Replace `strategy.gainExponent` / `.shapeAreaCoeff` / `.waveform` →
  access via registry entries.

### Task 5.4: Migrate State consumers

**Modify:** `js/state.ts`

- [ ] Replace `getStrategy(wf).createVoice(base)` →
  `registry.createVoice(wf, base)`.

### Task 5.5: Migrate App/Harmony/Debug consumers

**Modify:** `js/app.ts`

- [ ] Replace `ALL_STRATEGIES` → `registry.all()` for tool map.

**Modify:** `js/harmony.ts`

- [ ] Replace `ALL_STRATEGIES` → `registry.all()`.
- [ ] Replace `getStrategy(wf).withTimbre()` → inline timbre update (the
  registry's `createVoice` knows the field name).

**Modify:** `js/debug/vibe-tuner.ts`

- [ ] Replace `ALL_STRATEGIES` → `registry.all()`.

### Task 5.6: Delete old WaveformStrategy files

- [ ] Once all consumers are migrated: delete `js/waveforms/types.ts`,
  `js/waveforms/index.ts`, `js/waveforms/sine.ts`, `js/waveforms/pulse.ts`,
  `js/waveforms/blend.ts`, `js/waveforms/astroid.ts`.
- [ ] `js/waveforms/stamp.ts` may remain if stamp lifecycle functions
  (`initStampSymbols`, etc.) haven't been relocated yet. If they have,
  delete it too.
- [ ] Grep for any remaining imports of `getStrategy` or `ALL_STRATEGIES`
  and fix.

### Task 5.7: Verify

- [ ] `bun run check` — no type errors.
- [ ] `bun run test` — all unit tests pass.
- [ ] `bun run test:e2e` — all integration tests pass.
- [ ] Manual smoke test: create voices of each type, serialize/deserialize
  via URL, verify audio plays correctly.

---

## Chunk 6: X-Axis Grid Snap

V2 quantizes X to 64 positions. This requires adding snap behavior to X
to match the existing Y snap behavior.

### Task 6.1: Add X-axis snap functions

**Modify:** `js/audio/mapping.ts` (or create `js/grid.ts`)

- [ ] Implement `snapXToGrid(x: NormalizedCoord): NormalizedCoord` —
  magnetic pull toward nearest grid position (reuse Y snap quintic curve
  with 64 steps instead of 37).
- [ ] Implement `hardSnapXToGrid(x: NormalizedCoord): NormalizedCoord` —
  hard snap on drag release.

### Task 6.2: Wire snap into interaction

**Modify:** `js/canvas/interaction.ts`

- [ ] Apply `snapXToGrid()` during drag (same as `snapYToNote()`).
- [ ] Apply `hardSnapXToGrid()` on pointer release (same as
  `hardSnapYToNote()`).

### Task 6.3: Verify

- [ ] `bun run test:e2e` — drag tests still pass.
- [ ] Manual test: drag a voice horizontally, verify magnetic snap feel.

---

## Chunk 7: Activate v2 Format

Replace the v1 serializer with v2 as the active format. Update serialize.ts
to use the new serializer delegates.

### Task 7.1: Rewrite serialize.ts

**Modify:** `js/serialize.ts`

- [ ] `serializeState()`: Pack version (1 char) + scene (1 char) +
  envelope (2 chars) + voices (registry serializer per voice).
  Voice header = type ID (3b) + fill mode (1b) + spare (2b).
  Sort voice strings lexicographically before joining.
- [ ] `deserializeState()`: Read version → dispatch to v2 parser.
  v1 URLs return `undefined` (no migration).
- [ ] Keep `stateToPath()`, `pathToState()`, `saveToURL()`, `loadFromURL()`,
  `resetDirty()` unchanged (they call serialize/deserialize internally).
- [ ] `encodeInt()` / `decodeInt()` continue to be exported from b64.ts
  via this module for any remaining consumers.

### Task 7.2: Update serialization tests

**Modify:** `tests/unit/serialize.test.js`

- [ ] Rewrite round-trip tests for v2 format.
- [ ] Remove v1-specific tests (variable-length voices, flags bitfield).
- [ ] Add tests: version byte present, scene byte, 3-bit envelope params,
  6-bit spatial quantization, type header with fill mode flag.
- [ ] Verify `pathToState` returns `undefined` for old v1 URLs.

### Task 7.3: Update embed entry

**Modify:** `js/embed-entry.ts`

- [ ] Verify embed still reads from `/embed/<data>` and parses v2 format.

### Task 7.4: Full verification

- [ ] `bun run check` — no type errors.
- [ ] `bun run test` — all unit tests pass.
- [ ] `bun run test:e2e` — all integration tests pass.
- [ ] `bun run build` — production build succeeds.
- [ ] Manual test: full workflow — create sigil, copy URL, paste in new tab,
  verify identical visual and audio.

---

## Chunk 8: Cleanup

### Task 8.1: Remove dead code

- [ ] Delete `js/waveforms/` directory entirely (if not already done in 5.6).
- [ ] Remove `round3()` if no longer used.
- [ ] Remove any v1-only serialization helpers.
- [ ] Grep for dead imports across all files.

### Task 8.2: Update CLAUDE.md

- [ ] Update "Project Structure" section: `js/waveforms/` → `js/voices/`.
- [ ] Update serialization policy description to reflect v2 format.
- [ ] Update "Add a new waveform/shape" recipe to reflect delegate model:
  create a UI, Player, and registry entry (serializer is shared).
- [ ] Remove any references to `packExtra`/`unpackExtra`.

### Task 8.3: Final verification

- [ ] `bun run check && bun run lint && bun run test && bun run build`
- [ ] `bun run test:e2e`
