# Total Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Decompose the three monolith files (app.ts 1253 lines, audio.ts 1135 lines, toolbar.ts 953 lines) into focused, documented, testable modules. Adopt reactive signals for state propagation. Add JSDoc coverage to all public APIs.

**Architecture:** Extract pure functions and state machines from the monoliths into single-responsibility modules. Replace `SigilStore`'s manual listener/notify pattern with `@preact/signals-core` for fine-grained reactivity. Keep the SVG reconciler and audio engine imperative (they are domain-specific and already well-optimized). Decompose the toolbar into per-panel modules with shared DOM helpers.

**Tech Stack:** TypeScript, Bun, Vite 7, `@preact/signals-core` (1.6KB, reactive state), `lz-string` (existing). No component framework — the SVG canvas and audio engine are fundamentally imperative. Signals address the root cause (reactive state propagation) without imposing DOM opinions on the parts that don't need them.

---

## Architectural Vision

### Current State

```
app.ts (1253)  ←→  toolbar.ts (953)
    ↓                   ↓
canvas.ts (766)    state.ts (242)  ←  audio.ts (1135)
    ↓                                     ↓
shapes.ts         types.ts            effects.ts
colors.ts                             vocoder.ts
patterns.ts
```

Three monolith files contain 90% of the complexity:

- **app.ts**: 14 distinct concerns, 17 mutable module-scope variables, a play
  state machine using 11 scattered `let` variables, a 190-line pointer event
  handler, and an initialization sequence that interleaves phases
- **audio.ts**: Pure mapping functions mixed with stateful AudioEngine class,
  a 230-line `_buildVoice` method covering three waveform topologies, iOS
  Safari audio unlock, and reverb management
- **toolbar.ts**: Five expansion panels built imperatively with ~200 lines of
  `createElement`/`setAttribute` boilerplate, bidirectional coupling with app.ts,
  and no store subscription (entirely push-updated)

### Target State

```
app.ts (~150 lines, thin wiring)
    │
    ├── state/
    │   ├── store.ts          Reactive SigilStore (signals-based)
    │   ├── undo.ts           UndoManager (wraps store)
    │   └── selection.ts      Selection state (signal-based)
    │
    ├── canvas/
    │   ├── render.ts         SVG DOM reconciler (existing canvas.ts, renamed)
    │   ├── interaction.ts    Pointer event dispatch + coordinate transform
    │   └── frame-shadow.ts   Canvas frame shadow computation
    │
    ├── audio/
    │   ├── engine.ts         AudioEngine class (orchestration only, ~400 lines)
    │   ├── mapping.ts        Pure pitch/spatial mapping functions
    │   ├── formants.ts       Fill-to-formant mapping
    │   └── voice-builder.ts  Per-waveform audio graph construction
    │
    ├── toolbar/
    │   ├── toolbar.ts        Toolbar controller (orchestration, ~150 lines)
    │   ├── fill-panel.ts     Fill color picker expansion
    │   ├── blend-panel.ts    Blend mode expansion
    │   ├── border-panel.ts   Border expansion
    │   ├── pattern-panel.ts  Pattern dropdown
    │   ├── reverb-panel.ts   Reverb panel
    │   └── dom-helpers.ts    createIconButton, createSvgElement, etc.
    │
    ├── playback.ts           Play state machine (idle/latched/looping + fan gesture)
    ├── keyboard.ts           Keyboard shortcut handler
    ├── splash.ts             First-load splash screen
    ├── share.ts              Share menu + embed snippet
    ├── types.ts              (existing, unchanged)
    ├── shapes.ts             (existing, unchanged)
    ├── colors.ts             (existing, unchanged)
    ├── patterns.ts           (existing, unchanged)
    ├── effects.ts            (existing, unchanged)
    ├── vocoder.ts            (existing, unchanged)
    ├── envelope.ts           (existing, unchanged)
    ├── serialize.ts          (existing, unchanged)
    └── embed.ts              (existing, unchanged)
```

### Design Principles

1. **Extract, don't rewrite.** Every extraction is a move + rename, not a
   reimplementation. Tests must pass after every commit. No behavior changes
   during extraction.

2. **Signals for state, imperative for DOM/Audio.** `@preact/signals-core`
   provides `signal()`, `computed()`, and `effect()` — reactive primitives
   without DOM opinions. The SVG reconciler and audio engine stay imperative.
   Signals replace the manual `_notify()` / `onChange()` / `needsRender` pattern.

3. **Each module has a documented public API.** Every exported function, class,
   and type gets a JSDoc comment explaining what it does, its parameters, and
   its return value. Internal functions do not need JSDoc unless the logic is
   non-obvious.

4. **Subdirectories for related modules.** `state/`, `canvas/`, `audio/`, and
   `toolbar/` group files that share a concern. Leaf modules (`playback.ts`,
   `keyboard.ts`, etc.) stay flat in `js/`.

5. **No backwards compatibility.** We are on a dedicated `total-refactor` branch.
   All changes land atomically. There is no migration period.

### Why Not a Full Framework?

The research compared Solid.js (7KB), Preact (5.6KB), Svelte 5 (3-5KB), Lit
(5.8KB), Alpine.js (7KB), and vanilla+signals (1.6KB). Key findings:

- **The SVG canvas is a domain-specific reconciler** that no framework improves.
  The current `canvas.ts` does targeted attribute updates keyed by voice ID —
  exactly what a virtual DOM would do, but with domain knowledge that eliminates
  the diffing overhead. Solid/Preact/Svelte would add a generic diffing layer
  on top of already-optimized code.
- **The audio engine is fundamentally imperative** with strict iOS Safari
  synchronous initialization constraints. No framework helps here.
- **SVG namespace bugs** affect Svelte 5 (known issue #11993) and Solid.js
  (discussion #2021). Since spatch is SVG-first, these are deal-breakers.
- **The only framework-shaped problem is the toolbar** (953 lines of imperative
  DOM construction). But adding a 5-7KB framework to fix 953 lines in a 6,174-line
  project is disproportionate.
- **Signals address the root cause.** The toolbar's verbosity comes from two
  sources: (1) lack of reactive state propagation (it's entirely push-updated
  by app.ts), and (2) repetitive DOM construction boilerplate. Signals fix (1).
  DOM helper functions fix (2). Together they cut the toolbar code by ~60%
  without framework weight.

The decision: **`@preact/signals-core` (1.6KB) for reactive state, DOM helpers
for toolbar templating, everything else stays imperative.**

---

## Phased Implementation

### Phase 0: Setup

Install signals, create directory structure, verify the build still works.

### Phase 1: Extract Pure Modules from audio.ts

The safest extractions. Pure functions with no side effects, already independently
tested via `audio-mapping.test.js`. Moving them changes no behavior.

### Phase 2: Extract AudioEngine Internals

Extract `_buildVoice` into a standalone function. This is the largest single
method (230 lines) and is already internally structured by waveform type.

### Phase 3: Extract Modules from app.ts

Decompose the 14 concerns in app.ts into focused modules. Each extraction
moves code, re-exports from the original location temporarily, and verifies
all tests pass.

### Phase 4: Adopt Signals for State

Replace `SigilStore`'s manual `_notify()` / `onChange()` pattern with
`@preact/signals-core`. This is the one behavior change — the notification
mechanism changes from push to reactive — but the external API stays the same.

### Phase 5: Toolbar Decomposition

Extract each toolbar panel into its own module. Create shared DOM helpers.
Wire panels to reactive state via signal effects instead of push-updates.

### Phase 6: Documentation and Test Coverage

Add JSDoc to all public APIs. Add unit tests for previously untested modules
(canvas.ts, decorations.ts, vocoder.ts).

---

## Phase 0: Setup

### Task 0.1: Install @preact/signals-core

**Files:**
- Modify: `package.json`
- Modify: `bun.lock` (auto)

**Step 1: Install the dependency**

Run: `bun add @preact/signals-core`

**Step 2: Verify build still works**

Run: `bun run build`
Expected: Build succeeds with no errors.

**Step 3: Verify tests still pass**

Run: `bun run test:unit`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add @preact/signals-core for reactive state"
```

### Task 0.2: Create directory structure

**Files:**
- Create directories: `js/state/`, `js/canvas/`, `js/audio/`, `js/toolbar/`

**Step 1: Create directories**

```bash
mkdir -p js/state js/canvas js/audio js/toolbar
```

**Step 2: Verify lint/typecheck still work**

Run: `bun run check && bun run lint`
Expected: No errors.

**Step 3: Commit**

```bash
git add js/state/.gitkeep js/canvas/.gitkeep js/audio/.gitkeep js/toolbar/.gitkeep
git commit -m "chore: create subdirectory structure for module extraction"
```

Note: If git doesn't track empty directories, create `.gitkeep` files. These
will be removed as real modules are added.

---

## Phase 1: Extract Pure Modules from audio.ts

### Task 1.1: Extract audio mapping functions → js/audio/mapping.ts

**Files:**
- Create: `js/audio/mapping.ts`
- Modify: `js/audio.ts` (remove extracted code, add re-exports)
- Move: `tests/unit/audio-mapping.test.js` (update import paths)

**What moves:**

All pure pitch/spatial mapping functions and their constants:

```typescript
// js/audio/mapping.ts

// Constants
CHROMATIC_SEMITONES, BASE_MIDI, MAX_DETUNE_CENTS, WAVEFORM_PERIOD

// Pure functions
midiToFreq(midi: number): number
yToFrequency(y: NormalizedCoord): number
snapYToNote(rawY: number, magnetism?: number): NormalizedCoord
xToPan(x: NormalizedCoord): number
shapeAreaFraction(waveform: WaveformType, size: NormalizedCoord): number
areaToGain(areaFraction: number): number
rotationToTimbre(rotation: Degrees, waveform: WaveformType): NormalizedCoord
waveformGain(waveform: WaveformType): number
```

**Step 1: Create js/audio/mapping.ts**

Move lines 24-148 from `audio.ts` into the new file. Add JSDoc comments to
every exported function. The file should import only from `../types.ts`.

**Step 2: Update audio.ts to import and re-export**

In `audio.ts`, replace the removed code with:
```typescript
export {
  areaToGain,
  midiToFreq,
  rotationToTimbre,
  shapeAreaFraction,
  snapYToNote,
  waveformGain,
  WAVEFORM_PERIOD,
  xToPan,
  yToFrequency,
} from './audio/mapping.ts';
```

This preserves the public API — all existing importers continue to work.

**Step 3: Update test imports**

In `tests/unit/audio-mapping.test.js`, change the import path from
`../../js/audio.ts` to `../../js/audio/mapping.ts`.

**Step 4: Run tests**

Run: `bun run test:unit`
Expected: All tests pass (especially `audio-mapping.test.js`).

**Step 5: Run typecheck**

Run: `bun run check`
Expected: No type errors.

**Step 6: Commit**

```bash
git add js/audio/mapping.ts js/audio.ts tests/unit/audio-mapping.test.js
git commit -m "refactor: extract audio mapping functions to js/audio/mapping.ts"
```

### Task 1.2: Extract formant mapping → js/audio/formants.ts

**Files:**
- Create: `js/audio/formants.ts`
- Modify: `js/audio.ts` (remove extracted code, add re-exports)

**What moves:**

```typescript
// js/audio/formants.ts

// Constants
OCTAVE_GAIN_COEFF, FORMANT_ANCHORS

// Pure functions
borderOctaveGain(border: Border | undefined): number
hueToFormants(hue: number): { f1: number; f2: number }
lightnessToCutoff(l: number): number

// Web Audio helper (near-pure: deterministic mapping, mutates nodes)
applyFormantFilter(fill: Fill, nodes: { formantF1, formantF2, brightness }): void
```

**Step 1: Create js/audio/formants.ts**

Move lines 150-281 from `audio.ts`. Add JSDoc to all exports. Import from
`../types.ts`.

**Step 2: Update audio.ts**

Replace removed code with re-exports:
```typescript
export {
  applyFormantFilter,
  borderOctaveGain,
  hueToFormants,
  lightnessToCutoff,
} from './audio/formants.ts';
```

**Step 3: Run tests**

Run: `bun run test:unit`
Expected: All pass. The `audio-mapping.test.js` file tests `borderOctaveGain`,
`hueToFormants`, and `lightnessToCutoff`.

**Step 4: Commit**

```bash
git add js/audio/formants.ts js/audio.ts
git commit -m "refactor: extract formant mapping to js/audio/formants.ts"
```

### Task 1.3: Extract audio type definitions → js/audio/voice-types.ts

**Files:**
- Create: `js/audio/voice-types.ts`
- Modify: `js/audio.ts`

**What moves:**

The audio voice type definitions and utility functions used by the voice builder:

```typescript
// js/audio/voice-types.ts

// Types
AudioVoiceBase, SineAudioVoice, SquareAudioVoice, TriangleAudioVoice,
AudioVoice, TextAudioVoice, AnyAudioVoice

// Utility functions
createPWMWaveshaper(ctx: AudioContext): WaveShaperNode
safeStop(node: AudioScheduledSourceNode): void
safeDisconnect(node: AudioNode): void
generateImpulseResponse(ctx: AudioContext, style: ReverbStyle): AudioBuffer
```

**Step 1: Create js/audio/voice-types.ts**

Move the type definitions (lines 283-366) and utility functions. Add JSDoc.

**Step 2: Update audio.ts imports**

Audio.ts should import these types and functions from the new module.

**Step 3: Run tests and typecheck**

Run: `bun run test:unit && bun run check`

**Step 4: Commit**

```bash
git add js/audio/voice-types.ts js/audio.ts
git commit -m "refactor: extract audio voice types to js/audio/voice-types.ts"
```

---

## Phase 2: Extract AudioEngine Internals

### Task 2.1: Extract _buildVoice → js/audio/voice-builder.ts

**Files:**
- Create: `js/audio/voice-builder.ts`
- Modify: `js/audio.ts` (AudioEngine._buildVoice becomes a delegation)

**What moves:**

The `_buildVoice` method (230 lines) becomes a standalone exported function:

```typescript
// js/audio/voice-builder.ts
export function buildVoice(
  ctx: AudioContext,
  voice: Voice,
  masterGain: GainNode,
  patternEffectFactory: (effect: PatternType) => AudioEffect | undefined,
): AudioVoice
```

The function takes explicit dependencies instead of reaching into `this`. The
`AudioEngine._buildVoice` method becomes a one-line delegation:

```typescript
_buildVoice(voice: Voice): AudioVoice {
  return buildVoice(this.audioCtx!, voice, this.masterGain!,
    (effect) => effect ? createEffect(this.audioCtx!, effect) : undefined);
}
```

**Step 1: Write the failing test**

Create `tests/unit/voice-builder.test.js` that tests `buildVoice` with a mock
AudioContext. Test all three waveform types (sine, pulse, blend) and border
handling. Use the existing `audio-engine.test.js` mock pattern as reference.

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/voice-builder.test.js`
Expected: FAIL — module not found.

**Step 3: Create js/audio/voice-builder.ts**

Extract the `_buildVoice` body into the standalone function. Import dependencies
from `./mapping.ts`, `./formants.ts`, `./voice-types.ts`, and `../effects.ts`.

**Step 4: Run tests**

Run: `bun run test:unit`
Expected: All pass, including new voice-builder tests and existing
audio-engine tests.

**Step 5: Commit**

```bash
git add js/audio/voice-builder.ts js/audio.ts tests/unit/voice-builder.test.js
git commit -m "refactor: extract voice builder to js/audio/voice-builder.ts"
```

### Task 2.2: Rename remaining audio.ts → js/audio/engine.ts

**Files:**
- Move: `js/audio.ts` → `js/audio/engine.ts`
- Create: `js/audio.ts` (barrel re-export for backwards compatibility)
- Modify: all importers of `audio.ts` (update paths or use barrel)

**Step 1: Move and create barrel**

```typescript
// js/audio.ts (barrel)
export { AudioEngine } from './audio/engine.ts';
export * from './audio/mapping.ts';
export * from './audio/formants.ts';
export * from './audio/voice-types.ts';
export * from './audio/voice-builder.ts';
```

**Step 2: Run tests and typecheck**

Run: `bun run test:unit && bun run check`

**Step 3: Commit**

```bash
git add js/audio.ts js/audio/engine.ts
git commit -m "refactor: move AudioEngine to js/audio/engine.ts with barrel re-export"
```

### Task 2.3: Update direct importers to use specific modules

**Files:**
- Modify: `js/app.ts` (imports `AudioEngine`, `rotationToTimbre`, `snapYToNote`)
- Modify: `js/embed-entry.ts` (imports `AudioEngine`)
- Modify: test files

Change imports from `'./audio.ts'` to the specific submodules. Then remove
the barrel file `js/audio.ts`.

**Step 1: Update imports**

```typescript
// app.ts
import { AudioEngine } from './audio/engine.ts';
import { rotationToTimbre, snapYToNote } from './audio/mapping.ts';

// embed-entry.ts
import { AudioEngine } from './audio/engine.ts';
```

**Step 2: Remove barrel**

Delete `js/audio.ts`.

**Step 3: Run tests and typecheck**

Run: `bun run test:unit && bun run check`

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: update audio imports to use specific submodules, remove barrel"
```

---

## Phase 3: Extract Modules from app.ts

Each task extracts one concern from app.ts into its own module. The strategy:
move the code, wire the dependencies explicitly, verify tests pass.

### Task 3.1: Extract frame shadow → js/canvas/frame-shadow.ts

**Files:**
- Create: `js/canvas/frame-shadow.ts`
- Modify: `js/app.ts`

**What moves:**

`updateFrameShadow()` — a near-pure function taking DOM element + state →
applies CSS box-shadow. ~30 lines, zero entanglement.

```typescript
// js/canvas/frame-shadow.ts

/** Compose reverb inset shadow + audio-reactive outer glow on the canvas frame. */
export function updateFrameShadow(
  frame: HTMLElement,
  reverb: Reverb | undefined,
  canvasSize: number,
  audioLevel: number,
): void
```

**Step 1: Create the module**

Move the function, add JSDoc.

**Step 2: Update app.ts**

Import and call the extracted function.

**Step 3: Run integration tests** (this function is only exercised by integration)

Run: `bun run test`

**Step 4: Commit**

```bash
git add js/canvas/frame-shadow.ts js/app.ts
git commit -m "refactor: extract frame shadow to js/canvas/frame-shadow.ts"
```

### Task 3.2: Extract selection state → js/state/selection.ts

**Files:**
- Create: `js/state/selection.ts`
- Modify: `js/app.ts`

**What moves:**

`selectedId`, `selectedDecoId`, `setSelection()`, `getSelected()`,
`getSelectedDeco()`. ~20 lines. This becomes a `SelectionManager` class
(or just exported functions + module-scope state) with explicit dependencies.

```typescript
// js/state/selection.ts

export interface SelectionState {
  voiceId: string | undefined;
  decoId: string | undefined;
}

export class SelectionManager {
  constructor(store: SigilStore, onSelectionChange: (sel: SelectionState) => void);
  select(voiceId?: string, decoId?: string): void;
  getSelectedVoice(): Voice | undefined;
  getSelectedDeco(): TextDecoration | undefined;
  get voiceId(): string | undefined;
  get decoId(): string | undefined;
  clear(): void;
}
```

**Step 1: Write failing test**

Create `tests/unit/selection.test.js`.

**Step 2: Implement**

**Step 3: Wire into app.ts** (replace the module-scope variables)

**Step 4: Run all tests**

**Step 5: Commit**

### Task 3.3: Extract play state machine → js/playback.ts

**Files:**
- Create: `js/playback.ts`
- Modify: `js/app.ts`

**What moves:**

The 11 play-related mutable variables, the play/latch/loop state machine,
the fan gesture sub-state machine, all play button event handlers, and
all DOM queries for play-related elements.

```typescript
// js/playback.ts

export type PlayMode = 'idle' | 'latched' | 'looping';

export class PlaybackController {
  constructor(deps: {
    audio: AudioEngine;
    getState: () => SigilData;
    requestRender: () => void;
    playBtn: HTMLElement;
    playFan: HTMLElement;
    fanLock: HTMLElement;
    fanLoop: HTMLElement;
    playModeLock: HTMLElement;
    playModeLoop: HTMLElement;
  });

  /** Start playback. Returns promise that resolves when audio starts. */
  start(): Promise<void>;

  /** Stop playback immediately. */
  stop(): void;

  /** Current play mode. */
  get mode(): PlayMode;

  /** Whether any playback is active. */
  get isPlaying(): boolean;

  /** Call from the render loop to update loop progress indicators. */
  renderTick(): void;

  /** Bind all play button pointer events. Call once during init. */
  bindEvents(): void;

  /** Clean up timers and listeners. */
  dispose(): void;
}
```

This is the largest extraction (~250 lines) but also the most self-contained.
The play state machine has exactly three touchpoints with the outside world:
spacebar toggle (keyboard handler), the render loop (progress indicator), and
the `requestRender` callback.

**Step 1: Write failing test**

Create `tests/unit/playback.test.js`. Test state transitions:
idle → latched → idle, idle → looping → idle. Mock the AudioEngine.

**Step 2: Implement PlaybackController**

Move the code, replacing module-scope variables with class properties. Replace
DOM queries with constructor-injected elements.

**Step 3: Wire into app.ts**

Replace the 11 module-scope variables with a single
`const playback = new PlaybackController({...})`.

**Step 4: Run all tests** (unit + integration, since play-modes.test.js exercises this)

**Step 5: Commit**

### Task 3.4: Extract canvas interaction → js/canvas/interaction.ts

**Files:**
- Create: `js/canvas/interaction.ts`  (note: this is different from the existing
  `js/interaction.ts` which defines the discriminated union type — that file
  stays where it is and keeps its name)
- Modify: `js/app.ts`

**What moves:**

The `interaction` state variable, `activePointers` map, `svgCoordsFromClient()`,
`svgCoords()`, and all three pointer event handlers (pointerdown ~190 lines,
pointermove ~130 lines, pointerup ~25 lines). Also the helper functions
`cornerDiagonal()`, `envelopeValueToDist()`, `pointerDist()`, `pointerAngle()`.

```typescript
// js/canvas/interaction.ts

export class CanvasInteractionController {
  constructor(deps: {
    canvasWrap: HTMLElement;
    canvas: SVGSVGElement;
    store: SigilStore;
    undo: UndoManager;
    selection: SelectionManager;
    toolbar: Toolbar;
    audio: { rotationToTimbre: typeof rotationToTimbre };
    requestRender: () => void;
    isSplashActive: () => boolean;
  });

  bindEvents(): void;
  dispose(): void;
}
```

**Step 1: Move the code**

All pointer handlers move into this class. The `InteractionState` discriminated
union type stays in `js/interaction.ts` (it's already a separate file and is
correct there).

**Step 2: Run integration tests**

Run: `bun run test` — the shape-placement, adsr-drag, and playback integration
tests exercise this code.

**Step 3: Commit**

### Task 3.5: Extract keyboard shortcuts → js/keyboard.ts

**Files:**
- Create: `js/keyboard.ts`
- Modify: `js/app.ts`

**What moves:**

The `clipboard` variable and the entire `document.keydown` handler (~90 lines).

```typescript
// js/keyboard.ts

export function bindKeyboardShortcuts(deps: {
  store: SigilStore;
  undo: UndoManager;
  selection: SelectionManager;
  toolbar: Toolbar;
  playback: PlaybackController;
  requestRender: () => void;
  isSplashActive: () => boolean;
  shareMenu: HTMLElement;
}): void
```

**Step 1: Move the code**

**Step 2: Run integration tests**

**Step 3: Commit**

### Task 3.6: Extract share menu → js/share.ts

**Files:**
- Modify: `js/embed.ts` (merge share menu logic into it — they are the same concern)
- Modify: `js/app.ts`

The existing `js/embed.ts` (32 lines) already handles embed snippet generation.
The share menu UI (~50 lines in app.ts) is the other half of the same concern.
Merge them into a single `share.ts` module.

```typescript
// js/share.ts (replaces js/embed.ts)

export function bindShareMenu(deps: {
  shareBtn: HTMLElement;
  shareMenu: HTMLElement;
  store: SigilStore;
}): void;

export function generateEmbedSnippet(state: SigilData): string;
export function copyToClipboard(text: string): Promise<void>;
```

**Step 1: Merge and move**

**Step 2: Run share-menu integration tests**

**Step 3: Commit**

### Task 3.7: Extract splash screen → js/splash.ts

**Files:**
- Create: `js/splash.ts`
- Modify: `js/app.ts`

**What moves:**

`splashActive`, the splash localStorage check, all splash interaction handlers,
and `splashReveal()` (~120 lines).

```typescript
// js/splash.ts

export class SplashController {
  constructor(deps: {
    canvasArea: HTMLElement;
    audio: AudioEngine;
    getState: () => SigilData;
    playback: PlaybackController;
    requestRender: () => void;
  });

  get isActive(): boolean;
  bindEvents(): void;
  dispose(): void;
}
```

**Step 1: Move the code**

**Step 2: Run splash integration tests**

**Step 3: Commit**

### Task 3.8: Move canvas.ts → js/canvas/render.ts

**Files:**
- Move: `js/canvas.ts` → `js/canvas/render.ts`
- Create: `js/canvas.ts` (barrel re-export, then remove after updating importers)
- Modify: `js/app.ts`, `js/embed-entry.ts`

**Step 1: Move file**

**Step 2: Update importers**

**Step 3: Remove barrel**

**Step 4: Run all tests**

**Step 5: Commit**

### Task 3.9: Verify app.ts is now thin (~150 lines)

After all extractions, `app.ts` should contain only:

1. Core object instantiation (store, undo, selection, toolbar, audio, playback)
2. Audio warmup listeners (one-shot touchend/click/keydown)
3. URL state loading
4. `resizeCanvas()` + window resize listener + stage init
5. `needsRender` flag + `renderLoop()`
6. `store.onChange()` listener (triggers render + audio update)
7. Toolbar callback wiring (`onToolChange`, `onDuplicate`)
8. Canvas area background deselect (single listener)
9. `debouncedSave()`
10. New button + splash preview button (2 click handlers)

If `app.ts` is under 200 lines, the decomposition is complete. If not,
identify remaining extractable concerns and add tasks.

**Step 1: Count lines**

Run: `wc -l js/app.ts`
Expected: 100-200 lines.

**Step 2: Run full test suite**

Run: `bun run test`
Expected: All unit and integration tests pass.

**Step 3: Run typecheck and lint**

Run: `bun run check && bun run lint`

**Step 4: Commit** (if any cleanup was needed)

---

## Phase 4: Adopt Signals for State

### Task 4.1: Replace SigilStore with signal-based store

**Files:**
- Modify: `js/state.ts` (or create `js/state/store.ts` and move)
- Modify: test files

**Design:**

The current `SigilStore` uses `listeners[]` + `_notify()`. Replace with
`@preact/signals-core`:

```typescript
import { signal, computed, effect, batch } from '@preact/signals-core';

export class SigilStore {
  // The root signal
  private _data = signal<SigilData>(createDefaultState());

  /** Reactive accessor — subscribe with effect() */
  get data(): SigilData { return this._data.value; }

  /** Subscribe to all state changes (backwards compat with old onChange API) */
  onChange(fn: (data: SigilData) => void): () => void {
    return effect(() => fn(this._data.value));
  }

  // Mutations use batch() for atomic updates
  addVoice(waveform: WaveformType, x: NormalizedCoord, y: NormalizedCoord): Voice {
    const voice = createVoice(waveform, x, y);
    this._data.value = {
      ...this._data.value,
      voices: [...this._data.value.voices, voice],
    };
    return voice;
  }

  // ... etc. Each mutation creates a new reference so the signal fires.
}
```

Key change: mutations must create new state references (immutable update pattern)
so signals detect the change. The current code mutates in place + calls `_notify()`.
With signals, we either:
- (a) Use immutable updates (`{ ...state, voices: [...state.voices, voice] }`), or
- (b) Mutate in place and manually trigger the signal (`this._data.value = this._data.value`)

Option (a) is cleaner and makes undo snapshots free (the old reference IS the
snapshot). But it changes the semantics of `getVoice()` — the returned object
is no longer live-mutable.

**Decision: Use option (a) — immutable updates.** This eliminates the need for
`structuredClone` in undo snapshots and makes the data flow unidirectional.
The `UndoManager` simplifies: snapshots are just previous signal values.

**Step 1: Write failing test**

Add a test to `state.test.js` that uses `effect()` from `@preact/signals-core`
to verify reactive notification works.

**Step 2: Implement the signal-based store**

Rewrite `SigilStore` mutations as immutable updates. Keep the same public API
methods so callers don't change.

**Step 3: Update UndoManager**

Simplify undo snapshots — instead of `structuredClone`, just save the previous
signal value (which is already a separate object due to immutable updates).

**Step 4: Run all tests**

Run: `bun run test`

**Step 5: Commit**

### Task 4.2: Replace needsRender with signal effect

**Files:**
- Modify: `js/app.ts`

Replace the `needsRender` flag + `requestAnimationFrame` polling with a signal
effect that schedules a render when state changes:

```typescript
import { effect } from '@preact/signals-core';

let rafId = 0;
effect(() => {
  // Reading store.data subscribes to state changes
  const _data = store.data;
  // Schedule a render on the next animation frame
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    render(canvas, _data, selection.voiceId, selection.decoId);
    updateFrameShadow(frame, _data.reverb, canvasSize, audio.getLevel());
  });
});
```

This eliminates the `needsRender` flag and all the places that set it.

**Step 1: Implement**

**Step 2: Remove all `needsRender = true` assignments** across all modules.
Remove the `requestRender` callback from all module constructors.

**Step 3: Run all tests**

**Step 4: Commit**

### Task 4.3: Make selection state reactive

**Files:**
- Modify: `js/state/selection.ts`

Replace the `SelectionManager` internals with signals:

```typescript
import { signal } from '@preact/signals-core';

export const selectedVoiceId = signal<string | undefined>(undefined);
export const selectedDecoId = signal<string | undefined>(undefined);
```

The toolbar can use `effect()` to auto-sync when selection changes, eliminating
the push-update calls from app.ts.

**Step 1: Implement**

**Step 2: Update toolbar** to subscribe to selection signals via `effect()`

**Step 3: Remove push-update calls** from app.ts (`toolbar.syncToSelectedShape()`,
`toolbar.updateBottomBar()`, etc.)

**Step 4: Run all tests**

**Step 5: Commit**

---

## Phase 5: Toolbar Decomposition

### Task 5.1: Create shared DOM helpers → js/toolbar/dom-helpers.ts

**Files:**
- Create: `js/toolbar/dom-helpers.ts`

Extract the repeated patterns into reusable helpers:

```typescript
// js/toolbar/dom-helpers.ts

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create a button with an SVG icon from the sprite sheet. */
export function createIconButton(opts: {
  className: string;
  symbol: string;
  title?: string;
  size?: number;
  dataset?: Record<string, string>;
}): HTMLButtonElement;

/** Create an SVG element with attributes. */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  ...children: SVGElement[]
): SVGElementTagNameMap[K];

/** Create an HTML element with attributes and children. */
export function htmlEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  ...children: (HTMLElement | SVGElement | string)[]
): HTMLElementTagNameMap[K];
```

**Step 1: Write failing test**

Create `tests/unit/dom-helpers.test.js`. Test `createIconButton`, `svgEl`.

**Step 2: Implement**

**Step 3: Run tests**

**Step 4: Commit**

### Task 5.2: Extract blend panel → js/toolbar/blend-panel.ts

**Files:**
- Create: `js/toolbar/blend-panel.ts`
- Modify: `js/toolbar.ts`

**What moves:**

`_bindBlendButton`, `_openBlendExpansion`, `_updateBlendExpansion` (~75 lines).

```typescript
// js/toolbar/blend-panel.ts

export interface ExpansionPanel {
  open(): void;
  close(): void;
  update(): void;
}

export function createBlendPanel(deps: {
  container: HTMLElement;
  store: SigilStore;
  undo: UndoManager;
  getSelectedId: () => string | undefined;
}): ExpansionPanel;
```

**Step 1: Define the `ExpansionPanel` interface**

**Step 2: Implement `createBlendPanel` using the DOM helpers**

**Step 3: Wire into toolbar**

**Step 4: Run integration tests**

**Step 5: Commit**

### Task 5.3: Extract fill panel → js/toolbar/fill-panel.ts

**What moves:** `_bindFillSwatch`, `_openFillExpansion`, `_bindExpansionColorPicker`,
`_syncColorInputs`, `_syncAngleToggles`, `_setColorInput`, `_commitFill`,
`_bindNativeColorInput`, `updateSwatchFromSelected`, and the `_fillDraft` state
(~230 lines → ~150 lines with DOM helpers).

Same `ExpansionPanel` interface.

### Task 5.4: Extract border panel → js/toolbar/border-panel.ts

**What moves:** `_bindBorderButton`, `_openBorderExpansion`,
`_bindExpansionBorderControls`, `_updateBorderExpansion`, `_updateBorderButton`
(~250 lines → ~120 lines with DOM helpers).

Same `ExpansionPanel` interface.

### Task 5.5: Extract pattern dropdown → js/toolbar/pattern-panel.ts

**What moves:** `_populatePatternDropdown`, `_bindPatternDropdown`,
`_updatePatternDropdown` (~70 lines).

### Task 5.6: Extract reverb panel → js/toolbar/reverb-panel.ts

**What moves:** `_bindReverbPanel`, `_updateReverbPanel` (~95 lines).

### Task 5.7: Move toolbar.ts → js/toolbar/toolbar.ts

After all panels are extracted, the remaining toolbar code should be ~150 lines:
constructor, `updateBottomBar`, `_bindToolButtons`, `_updateToolActive`,
`_bindActionButtons`, `syncToSelectedShape`, expansion mutex management,
and public API.

Move it to `js/toolbar/toolbar.ts` and update importers.

### Task 5.8: Wire panels to reactive state

Once signals are in place (Phase 4) and panels are extracted, each panel
subscribes to the relevant state signals via `effect()`:

```typescript
// In blend-panel.ts
effect(() => {
  const voice = store.getVoice(selectedVoiceId.value);
  if (voice && isOpen) {
    updateActiveClass(voice.blend);
  }
});
```

This eliminates the push-update pattern where app.ts calls
`toolbar.syncToSelectedShape()` after every interaction.

---

## Phase 6: Lint Rules and Quality Gates

Currently enforced: oxlint `correctness`/`perf`/`style`/`suspicious` as errors,
`tsc --noEmit` with `strict: true`, oxfmt formatting. That's a solid foundation,
but nothing prevents the monolith problem from recurring. This phase adds lint
rules that make the refactor's goals *enforceable*.

### Task 6.1: Enable file and function size limits

**Files:**
- Modify: `oxlint.config.mjs`

Enable the pedantic rules that oxlint supports for code size:

```javascript
// Add to rules:
'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
'max-depth': ['error', { max: 4 }],
'complexity': ['error', { max: 15 }],
```

**Rationale for thresholds:**
- `max-lines-per-function: 80` — the largest functions after refactor should be
  ~50-60 lines. 80 gives headroom without allowing 230-line monsters.
- `max-lines: 400` — matches the plan's success criterion. Catches file bloat
  before it reaches monolith scale.
- `max-depth: 4` — prevents deeply nested conditionals/loops. Forces extraction
  of helper functions.
- `complexity: 15` — cyclomatic complexity limit. The pointer event dispatch
  (after extraction) should be ~10. 15 gives buffer.

**Step 1: Add rules to oxlint.config.mjs**

**Step 2: Run lint to find any violations**

Run: `bun run lint`

If there are violations, they indicate code that still needs decomposition
(which means earlier phases weren't thorough enough). Fix them before
committing the rule.

**Step 3: Verify CI passes**

Run: `bun run check && bun run lint && bun run fmt:check`

**Step 4: Commit**

```bash
git add oxlint.config.mjs
git commit -m "chore: enable lint rules for file/function size and complexity"
```

### Task 6.2: Enable JSDoc enforcement for exports

**Files:**
- Modify: `oxlint.config.mjs`

oxlint supports jsdoc rules natively. Enable enforcement for exported functions:

```javascript
// Add to rules:
'jsdoc/require-param': 'error',
'jsdoc/require-param-description': 'warn',
'jsdoc/require-returns': 'error',
'jsdoc/require-returns-description': 'warn',
'jsdoc/check-tag-names': 'error',
'jsdoc/check-property-names': 'error',
```

**Note:** oxlint's jsdoc rules (as of v1.50) only check functions that *already
have* a JSDoc block — they don't require every function to have one. The
enforcement is: "if you write JSDoc, write it correctly." A `require-jsdoc`
rule does not exist in oxlint yet. This means the Phase 7 JSDoc effort is
enforced by code review and convention, not lint. If oxlint adds `require-jsdoc`
later, enable it.

**Step 1: Add jsdoc rules**

**Step 2: Run lint — fix any malformed existing JSDoc**

**Step 3: Commit**

```bash
git add oxlint.config.mjs
git commit -m "chore: enable jsdoc lint rules for documentation quality"
```

### Task 6.3: Re-enable max-params with a reasonable limit

**Files:**
- Modify: `oxlint.config.mjs`

Currently `max-params: 'off'`. After the refactor, dependency injection objects
replace long parameter lists (e.g., `PlaybackController` takes a `deps` object
instead of 8 positional params). Re-enable with a reasonable limit:

```javascript
'max-params': ['error', { max: 4 }],
```

This forces the `deps: { ... }` pattern for functions needing >4 parameters,
which is self-documenting and order-independent.

**Step 1: Add rule**

**Step 2: Fix any violations** (wrap long param lists into option objects)

**Step 3: Commit**

### Task 6.4: Add CI quality summary step

**Files:**
- Modify: `.gitea/workflows/ci.yml`

Add a step that prints a quality summary after tests pass:

```yaml
      - name: Quality summary
        run: |
          echo "=== File sizes ==="
          wc -l js/**/*.ts | sort -rn | head -20
          echo ""
          echo "=== Largest functions ==="
          # oxlint with max-lines-per-function catches violations, but a summary is useful
          echo "If this step shows files > 400 lines, the refactor has regressed."
```

This is informational, not blocking (the lint step already blocks). But it
makes regressions visible in PR review without running lint locally.

**Step 1: Add the step**

**Step 2: Commit**

---

## Phase 7: Documentation and Test Coverage

### Task 7.1: Add JSDoc to all public APIs

Go through every exported function, class, type, and interface in every module.
Add JSDoc with:
- One-line summary
- `@param` for each parameter
- `@returns` description
- `@example` where non-obvious

Priority order (most-consumed first):
1. `types.ts` (imported by everything)
2. `js/state/store.ts`
3. `js/audio/mapping.ts`
4. `js/audio/formants.ts`
5. `js/canvas/render.ts`
6. All toolbar modules
7. All extracted app modules

**Verification:** After adding JSDoc, run `bun run lint` — the jsdoc rules from
Task 6.2 will catch malformed docs.

### Task 7.2: Add unit tests for canvas reconciler

The SVG reconciler (`js/canvas/render.ts`, 766 lines) has zero direct unit tests.

**Test file:** `tests/unit/canvas-render.test.js`

**What to test:**

The reconciler is DOM-dependent. Bun's test environment includes a minimal DOM
via `happy-dom`. Tests should:

1. **Voice creation:** Call `render()` with one voice of each waveform type.
   Assert the SVG contains the expected element type (`circle`, `rect`,
   `polygon`) with correct attributes (`cx`/`cy`/`r`, `x`/`y`/`width`/`height`,
   `points`).

2. **Voice update:** Render, change a voice's position/size/fill in state, render
   again. Assert attributes updated without creating new elements (reconciliation,
   not rebuild). Verify the element count didn't change.

3. **Voice removal:** Render with 2 voices, remove one from state, render again.
   Assert only 1 voice element remains.

4. **Fill rendering:** Test solid fill (sets `fill` attribute to HSL string) and
   linear fill (creates `<linearGradient>` in `<defs>`, sets `fill="url(#...)"`).

5. **Pattern overlay:** Set a voice's `effect` to each pattern type. Assert a
   `<rect>` with `fill="url(#pattern-...)"` is created inside the voice group.

6. **Border rendering:** Set a voice's `border`. Assert inset `<rect>`/`<circle>`
   stroke elements are created with correct color and stroke-width.

7. **Text decoration rendering:** Add a text decoration. Assert a `<text>`
   element with correct `x`, `y`, `font-size`, and content.

8. **Selection indicators:** Render with a selected voice ID. Assert selection
   outline and handle elements are created. Render with no selection. Assert
   they are removed.

**Step 1: Write test file with all test cases**

**Step 2: Run and iterate**

Run: `bun test tests/unit/canvas-render.test.js`

**Step 3: Commit**

### Task 7.3: Add unit tests for vocoder

`vocoder.ts` has no unit tests.

**Test file:** `tests/unit/vocoder.test.js`

**What to test:**

1. **Chain creation:** `createVocoderChain(ctx, text, freq, gain)` returns an
   object with `output` (GainNode), `duration` (number > 0), and `dispose`
   (function). Use a mock AudioContext.

2. **Duration scales with text length:** Longer text → longer duration. Test
   with 1-char, 5-char, 10-char strings.

3. **Dispose cleans up:** After calling `dispose()`, verify all created nodes
   are disconnected (check mock call counts).

4. **Frequency mapping:** Different `freq` values produce different filter bank
   configurations.

### Task 7.4: Add unit tests for decorations

`decorations.ts` has no tests.

**Test file:** `tests/unit/decorations.test.js`

**What to test:**

1. **DecorationTool.handleClick:** With a mock `prompt()` that returns text,
   verify it calls `store.addTextDeco()` with the correct coordinates and text.

2. **DecorationTool.handleClick with cancel:** With a mock `prompt()` that
   returns `null`, verify no text is added to the store.

3. **Coordinate normalization:** Verify that click coordinates are correctly
   normalized to 0-1 range before being passed to the store.

### Task 7.5: Add unit tests for playback controller

**Test file:** `tests/unit/playback.test.js`

**What to test** (with mock AudioEngine and mock DOM elements):

1. **State transitions:** idle → start() → latched. latched → stop() → idle.
2. **Loop mode:** idle → start(loop) → looping → stop() → idle.
3. **Generation counter:** Start, then stop before audio promise resolves.
   Verify the stale start is ignored.
4. **Fan gesture zones:** Verify `fanZone()` returns correct zone names for
   different vertical distances.

### Task 7.6: Add unit tests for selection manager

**Test file:** `tests/unit/selection.test.js`

**What to test:**

1. **Select voice:** `select('v1')` → `voiceId` is `'v1'`, `decoId` is undefined.
2. **Select deco:** `select(undefined, 't1')` → `decoId` is `'t1'`, `voiceId` undefined.
3. **Mutual exclusion:** Select voice, then select deco → voice is cleared.
4. **Clear:** `clear()` → both undefined.
5. **getSelectedVoice:** Returns the Voice object from the store, or undefined
   if the voice was deleted.
6. **Signal reactivity** (after Phase 4): Changing selection triggers effects.

---

## Execution Notes

### Ordering Constraints

- Phase 0 must complete first (signals dependency, directory structure)
- Phases 1-3 can be done in any order — they are independent extractions
  that touch different files
- Phase 4 (signals adoption) should come after Phase 3 (app.ts decomposition)
  so the `needsRender` removal and `onChange` replacement affect smaller,
  focused modules rather than the monolith
- Phase 5 (toolbar decomposition) benefits from Phase 4 (reactive panels)
  but can start without it (extract first, reactify second)
- **Phase 6 (lint rules) must come after Phases 1-5** — enabling `max-lines`
  and `max-lines-per-function` before the extractions would immediately fail
  on the existing monoliths. The lint rules *lock in* the refactor's gains.
- Phase 7 (docs/tests) can be done any time but benefits from all other phases

### Recommended Execution Order

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
```

### Test Strategy

**Existing tests are the safety net during extraction (Phases 1-5).** Every
commit must pass `bun run test` (unit + integration). No new tests are written
during extraction phases unless extracting into a new class that didn't exist
before (e.g., `PlaybackController`, `SelectionManager`).

**New tests are written in Phase 7** after the architecture stabilizes. Writing
tests against APIs that are about to change (Phases 4-5 rewrite state and
toolbar) wastes effort. The exception: new classes created during Phase 3
get tests immediately because their APIs are stable.

**Test types and when to use each:**

| Type | Tool | When | What it catches |
|------|------|------|-----------------|
| Unit | `bun test` | Every commit | Logic errors in pure functions, state transitions |
| Integration | Playwright | Every phase completion | Wiring errors, DOM interaction, audio lifecycle |
| Typecheck | `tsc --noEmit` | Every commit | Type errors from refactored imports/signatures |
| Lint | `oxlint` | Every commit | Style violations, complexity, file size |

**Test coverage expectations after Phase 7:**

Every module in `js/` should have a corresponding test file in `tests/unit/`.
Modules that are pure functions (mapping, formants, colors, shapes, envelope,
serialize, effects) should have >90% branch coverage. Modules that are
DOM-dependent (canvas render, toolbar panels, playback) should have coverage
of their core logic paths; DOM interaction is covered by integration tests.

### Risk Mitigation

- **Every commit is a green build.** Run `bun run test && bun run check` after
  every extraction. If tests fail, the extraction was wrong — revert and retry.
- **Re-exports during migration.** When moving a module, keep a barrel re-export
  at the old path until all importers are updated. This prevents broken imports
  during the transition.
- **Integration tests are the safety net.** Unit tests verify isolated behavior.
  Integration tests (Playwright) verify the whole app works end-to-end. Run both
  after every phase completion.
- **No behavior changes during extraction.** The code moves, but its behavior
  is identical. The only behavior change is in Phase 4 (signals adoption), and
  even there the external API stays the same.
- **Lint rules lock the door after the refactor.** Phase 6 enables size/complexity
  limits that prevent regression to monolith patterns. Once enabled, any PR that
  exceeds the limits fails CI.

### Success Criteria

After all phases:
- No file in `js/` exceeds 400 lines (enforced by `max-lines` lint rule)
- No function exceeds 80 lines (enforced by `max-lines-per-function` lint rule)
- No function exceeds cyclomatic complexity 15 (enforced by `complexity` rule)
- `app.ts` is under 200 lines
- Every exported symbol has JSDoc (enforced by jsdoc lint rules for correctness)
- Every module in `js/` has a corresponding unit test file
- All existing tests still pass
- CI runs lint, typecheck, format check, tests, build, and quality summary
- The build produces the same bundle (minus signals addition)
- The app works identically in the browser

### Estimated Scope

| Phase | Tasks | What |
|-------|-------|------|
| 0 | 2 | Setup (install signals, create dirs) |
| 1 | 3 | Extract pure audio modules (~250 lines) |
| 2 | 3 | Extract AudioEngine internals (~250 lines) |
| 3 | 9 | Decompose app.ts (~1100 lines) |
| 4 | 3 | Adopt signals for state (~100 lines rewritten) |
| 5 | 8 | Toolbar decomposition (~800 lines) |
| 6 | 4 | Lint rules + quality gates (config only) |
| 7 | 6 | JSDoc + test coverage (~0 production lines, ~500 test lines) |
| **Total** | **38** | |
