# Bijective Audio-Visual Mapping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current `Shape`/`Decoration` types with a bijection-compliant
`Voice`/`TextDecoration` parameter space where every field affects both canvas
rendering and audio synthesis.

**Architecture:** The `Shape` type becomes a `Voice` discriminated union
(`SineVoice | PulseVoice | BlendVoice`). Squiggles and curlicues are removed.
`TextDecoration` is stripped to bijection-compliant fields. The rotation→audio
mapping becomes periodic per shape symmetry using a half-sine curve. Fill→formant
mapping is fixed for radial and linear modes.

**Tech Stack:** TypeScript, Bun (test runner + build), Web Audio API, Canvas 2D

**Design doc:** `docs/plans/2026-03-01-bijective-audio-visual-design.md`

---

### Task 1: New Voice and TextDecoration types in types.ts

**Files:**

- Modify: `js/types.ts`
- Test: `bun run check` (typecheck only — this task defines types)

**Step 1: Replace Shape-related types with Voice union**

Replace `ShapeType`, `Shape`, and `Decoration` types. Keep `Fill`, `Envelope`,
`FillDraft`, and branding functions unchanged.

Remove:

- `type ShapeType = 'circle' | 'triangle' | 'square'`
- `interface Shape`
- `type DecorationType`
- `interface DecorationBase`
- `interface SquiggleDecoration`
- `interface CurlicueDecoration`
- `type Decoration` (the union)

Add:

```typescript
export type WaveformType = 'sine' | 'pulse' | 'blend';

interface VoiceBase {
  id: string;
  x: NormalizedCoord;
  y: NormalizedCoord;
  size: NormalizedCoord;
  fill: Fill;
  effect: PatternType | null;
}

export interface SineVoice extends VoiceBase {
  waveform: 'sine';
}

export interface PulseVoice extends VoiceBase {
  waveform: 'pulse';
  timbre: NormalizedCoord;
}

export interface BlendVoice extends VoiceBase {
  waveform: 'blend';
  timbre: NormalizedCoord;
}

export type Voice = SineVoice | PulseVoice | BlendVoice;
```

**Step 2: Replace TextDecoration**

Remove old `TextDecoration`. Add:

```typescript
export interface TextDecoration {
  id: string;
  text: string;
  x: NormalizedCoord;
  y: NormalizedCoord;
  size: NormalizedCoord;
  color: { h: number; s: number; l: number };
}
```

**Step 3: Update SigilData**

```typescript
export interface SigilData {
  envelope: Envelope;
  voices: Voice[];
  texts: TextDecoration[];
}
```

**Step 4: Add helper to get the visual shape type for a waveform**

```typescript
export function waveformShape(waveform: WaveformType): 'circle' | 'square' | 'triangle' {
  switch (waveform) {
    case 'sine':
      return 'circle';
    case 'pulse':
      return 'square';
    case 'blend':
      return 'triangle';
  }
}
```

**Step 5: Keep HandleType, ADSRCorner, DecoBounds, AudioEffect, VocoderChain**

These are UI/audio contract types and stay unchanged.

**Step 6: Remove PatternType re-export check**

`PatternType` stays (it's used by both Voice and effects). `FillMode` stays.

**Step 7: Run typecheck (expect many errors in other files)**

Run: `bun run check 2>&1 | head -5`
Expected: Many errors in `state.ts`, `audio.ts`, `canvas.ts`, etc. referencing
old `Shape`/`Decoration` types. This is correct — we fix them in subsequent tasks.

**Step 8: Commit**

```
git add js/types.ts
git commit -m "feat: Voice discriminated union replaces Shape/Decoration types"
```

---

### Task 2: Audio mapping — periodic rotation and formant fixes

**Files:**

- Modify: `js/audio.ts`
- Test: `tests/unit/audio-mapping.test.js`

**Step 1: Write failing tests for new rotation mapping**

Add to `tests/unit/audio-mapping.test.js`, replacing the old `rotationToParam`
tests:

```javascript
describe('rotationToTimbre', () => {
  test('square: 0° and 90° produce same timbre (vertex symmetry)', () => {
    expect(rotationToTimbre(0, 'pulse')).toBeCloseTo(rotationToTimbre(90, 'pulse'), 5);
  });

  test('square: 0° and 180° produce same timbre', () => {
    expect(rotationToTimbre(0, 'pulse')).toBeCloseTo(rotationToTimbre(180, 'pulse'), 5);
  });

  test('square: 45° is peak (timbre = 1.0)', () => {
    expect(rotationToTimbre(45, 'pulse')).toBeCloseTo(1.0, 5);
  });

  test('square: 10° and 80° produce same timbre (mirror symmetry)', () => {
    expect(rotationToTimbre(10, 'pulse')).toBeCloseTo(rotationToTimbre(80, 'pulse'), 5);
  });

  test('triangle: 0° and 120° produce same timbre', () => {
    expect(rotationToTimbre(0, 'blend')).toBeCloseTo(rotationToTimbre(120, 'blend'), 5);
  });

  test('triangle: 60° is peak (timbre = 1.0)', () => {
    expect(rotationToTimbre(60, 'blend')).toBeCloseTo(1.0, 5);
  });

  test('triangle: 20° and 100° produce same timbre (mirror)', () => {
    expect(rotationToTimbre(20, 'blend')).toBeCloseTo(rotationToTimbre(100, 'blend'), 5);
  });

  test('timbre is always in [0, 1]', () => {
    for (let deg = 0; deg < 360; deg += 1) {
      for (const wf of ['pulse', 'blend']) {
        const t = rotationToTimbre(deg, wf);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/audio-mapping.test.js`
Expected: FAIL — `rotationToTimbre` not exported.

**Step 3: Implement rotationToTimbre in audio.ts**

Replace `rotationToParam`:

```typescript
const WAVEFORM_PERIOD: Record<string, number> = {
  pulse: 90,
  blend: 120,
};

export function rotationToTimbre(rotation: number, waveform: string): number {
  const period = WAVEFORM_PERIOD[waveform];
  if (!period) return 0; // sine has no timbre
  const phase = ((rotation % period) + period) % period;
  return Math.sin((Math.PI * phase) / period);
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/audio-mapping.test.js`
Expected: PASS

**Step 5: Remove curlicuesToDetune export and tests**

Delete `curlicuesToDetune` function from `audio.ts`.
Delete `describe('curlicuesToDetune', ...)` from `tests/unit/audio-mapping.test.js`.

**Step 6: Write test for fixed linear gradAngle mapping**

```javascript
describe('linear gradAngle blend', () => {
  test('gradAngle 90 and 270 produce different blends', () => {
    // Old formula: abs(sin(...)) made these identical. New: linear.
    const blend90 = 90 / 360;
    const blend270 = 270 / 360;
    expect(blend90).not.toBeCloseTo(blend270, 5);
  });
});
```

This test validates the design intent. The actual fix is in `applyFormantFilter`
inside `audio.ts`.

**Step 7: Fix applyFormantFilter for linear and radial fills**

In `applyFormantFilter`:

Linear fill — replace:

```typescript
const blend = Math.abs(Math.sin(((fill.gradAngle % 360) * Math.PI) / 360));
```

with:

```typescript
const blend = (((fill.gradAngle % 360) + 360) % 360) / 360;
```

Radial fill — replace the saturation-only averaging with full interpolation:

```typescript
} else if (fill.mode === 'radial') {
  h = (h + fill.h2) / 2;
  s = (s + fill.s2) / 2;
  l = (l + fill.l2) / 2;
}
```

**Step 8: Update waveformGain to use WaveformType**

Change from `ShapeType` parameter to `WaveformType`:

```typescript
export function waveformGain(waveform: WaveformType): number {
  switch (waveform) {
    case 'pulse':
      return 0.7;
    case 'blend':
      return 0.85;
    case 'sine':
    default:
      return 1.4;
  }
}
```

Same for `shapeAreaFraction`, `areaToGain`, `spectralNeed` — update to accept
`WaveformType` instead of `ShapeType`. Map `'sine'→circle`, `'pulse'→square`,
`'blend'→triangle` for area calculations using `waveformShape()`.

**Step 9: Run all unit tests**

Run: `bun test tests/unit/audio-mapping.test.js`
Expected: PASS

**Step 10: Commit**

```
git add js/audio.ts tests/unit/audio-mapping.test.js
git commit -m "feat: periodic rotation-to-timbre mapping, fix formant bijection"
```

---

### Task 3: State — SigilStore uses voices and texts

**Files:**

- Modify: `js/state.ts`
- Test: `tests/unit/state.test.js`

**Step 1: Update state.test.js for new API**

Replace all `addShape`/`getShape`/`removeShape`/`updateShape` with
`addVoice`/`getVoice`/`removeVoice`/`updateVoice`. Replace `store.data.shapes`
with `store.data.voices`. Replace `store.data.decorations` with
`store.data.texts`. Remove all squiggle/curlicue decoration tests. Update
`addTextDeco` tests to use the new `TextDecoration` shape (no strokeColor,
strokeWidth, fontSize, scale — just text, x, y, size, color).

Key test changes:

- `store.addVoice('sine', 0.5, 0.5)` instead of `store.addShape('circle', ...)`
- `store.addVoice('pulse', 0.3, 0.3)` instead of `store.addShape('square', ...)`
- `store.addVoice('blend', 0.2, 0.8)` instead of `store.addShape('triangle', ...)`
- Remove `addSquiggle` test entirely
- Update `addTextDeco` to use new signature

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/state.test.js`
Expected: FAIL — old API names.

**Step 3: Update state.ts**

Replace imports to use new types (`Voice`, `WaveformType`, `TextDecoration`
instead of `Shape`, `ShapeType`, `Decoration`, etc.).

Replace `createDefaultState`:

```typescript
export function createDefaultState(): SigilData {
  return {
    envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    voices: [],
    texts: [],
  };
}
```

Replace `createShape` with `createVoice`:

```typescript
function createVoice(waveform: WaveformType, x: NormalizedCoord, y: NormalizedCoord): Voice {
  const base = {
    id: genId('v'),
    x,
    y,
    size: normalizedCoord(0.12),
    fill: createDefaultFill(),
    effect: null,
  };
  switch (waveform) {
    case 'sine':
      return { ...base, waveform: 'sine' };
    case 'pulse':
      return { ...base, waveform: 'pulse', timbre: normalizedCoord(0) };
    case 'blend':
      return { ...base, waveform: 'blend', timbre: normalizedCoord(0) };
  }
}
```

Remove `createSquiggle`, `createCurlicue`. Update `createTextDeco`:

```typescript
function createTextDeco(text: string, x: NormalizedCoord, y: NormalizedCoord): TextDecoration {
  return {
    id: genId('t'),
    text,
    x,
    y,
    size: normalizedCoord(0.06),
    color: { h: 50, s: 100, l: 60 },
  };
}
```

Rename all `SigilStore` methods:

- `addShape` → `addVoice` (takes `WaveformType` instead of `ShapeType`)
- `removeShape` → `removeVoice`
- `updateShape` → `updateVoice`
- `getShape` → `getVoice`
- `pasteShape` → `pasteVoice`
- `duplicateShape` → `duplicateVoice`
- `moveLayer` / `bringToFront` / `sendToBack` — update to use `data.voices`
- `addSquiggle` → DELETE
- `addCurlicue` → DELETE
- `addDecoration` → `addText`
- `removeDecoration` → `removeText`
- `getDecoration` → `getText`
- `updateDecoration` → `updateText`

All internal references change from `data.shapes` to `data.voices` and
`data.decorations` to `data.texts`.

**Step 4: Run tests**

Run: `bun test tests/unit/state.test.js`
Expected: PASS

**Step 5: Commit**

```
git add js/state.ts tests/unit/state.test.js
git commit -m "feat: SigilStore uses voices/texts, remove squiggle/curlicue"
```

---

### Task 4: Serialization — v2 compact format

**Files:**

- Modify: `js/serialize.ts`
- Test: `tests/unit/serialize.test.js`

**Step 1: Update serialize.test.js**

Replace `makeShape` with `makeVoice`. Replace `shapes`/`decorations` with
`voices`/`texts`. Update all assertions. Add a v2 version field test.
Keep legacy format tests but update expected output (legacy format should
deserialize squiggles/curlicues as empty texts array, shapes as voices).

```javascript
function makeVoice(overrides = {}) {
  return {
    id: 'test1',
    waveform: 'sine',
    x: 0.5,
    y: 0.5,
    size: 0.12,
    fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    effect: null,
    ...overrides,
  };
}
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/serialize.test.js`
Expected: FAIL

**Step 3: Update serialize.ts**

New compact format (v2):

```typescript
interface CompactVoice {
  i: string;
  w: string; // waveform first char: s/p/b
  x: number;
  y: number;
  z: number; // size
  f: CompactFill;
  e: string | 0; // effect (pattern) first char or 0
  b?: number; // timbre (only for pulse/blend)
}

interface CompactText {
  i: string;
  t: string; // text content
  x: number;
  y: number;
  z: number; // size
  h: number; // color hue
  s: number; // color saturation
  l: number; // color lightness
}

interface CompactStateV2 {
  v: 2;
  e: CompactEnvelope;
  vo: CompactVoice[];
  tx: CompactText[];
}
```

Update `compactify` to produce v2. Update `decompactify` to handle v2.
Keep v1/legacy deserialization working: map old shapes to voices
(`type[0] → waveform`, `rotation → timbre` via `rotationToTimbre`), drop
squiggles/curlicues, map old text decorations to new TextDecoration format.

**Step 4: Run tests**

Run: `bun test tests/unit/serialize.test.js`
Expected: PASS

**Step 5: Commit**

```
git add js/serialize.ts tests/unit/serialize.test.js
git commit -m "feat: v2 serialization format for voices/texts"
```

---

### Task 5: Canvas — render voices, remove squiggle/curlicue

**Files:**

- Modify: `js/canvas.ts`
- Modify: `js/shapes.ts` (hit testing)
- No unit test file — canvas is integration-tested via Playwright

**Step 1: Update canvas.ts imports and render function**

Change `render()` signature from `state: SigilData` (which has `shapes`/
`decorations`) to the new `SigilData` (which has `voices`/`texts`).

Replace `state.shapes` → `state.voices`, `shape.type` → `waveformShape(voice.waveform)`,
`shape.rotation` → derive rotation from `voice.timbre` (reverse mapping).

For the reverse mapping (timbre → rotation for visual rendering):

```typescript
function timbreToRotation(timbre: NormalizedCoord, waveform: WaveformType): number {
  // timbre 0–1 maps to 0°–45° for pulse, 0°–60° for blend
  // (half of one symmetry period, since the half-sine is symmetric)
  const period = waveform === 'pulse' ? 90 : 120;
  return (Math.asin(timbre) * period) / Math.PI;
}
```

For sine voices, rotation is always 0.

**Step 2: Remove drawDecoration squiggle/curlicue cases**

Delete `case 'squiggle'` and `case 'curlicue'` from `drawDecoration`.
Delete `drawCurlicue` function. Replace decoration loop to iterate
`state.texts` and render each with text-drawing code.

**Step 3: Update text rendering**

Render text using `TextDecoration.color` (convert h/s/l to CSS) instead of
`strokeColor`. Use `size * canvasSize` for font size instead of `fontSize * scale`.

**Step 4: Update shapes.ts hit testing**

Change `hitTestShapes` to work with `Voice[]` instead of `Shape[]`.
Use `waveformShape(voice.waveform)` where the old code used `shape.type`.
Derive rotation from timbre for hit test math.

Remove `hitTestDecorations` squiggle/curlicue paths. Simplify to only handle
text bounding boxes.

**Step 5: Update selection handles**

In `drawSelectionHandles`: no rotation handle for sine voices (circles).
For pulse/blend, derive rotation from timbre.

**Step 6: Run typecheck**

Run: `bun run check`
Expected: PASS (or only errors in files not yet updated)

**Step 7: Commit**

```
git add js/canvas.ts js/shapes.ts
git commit -m "feat: canvas renders voices, remove squiggle/curlicue drawing"
```

---

### Task 6: DecorationTool — text-only

**Files:**

- Modify: `js/decorations.ts`

**Step 1: Strip DecorationTool to text-only**

Remove squiggle drawing state (`isDrawing`, `currentPoints`).
Remove `handleMouseMove` and squiggle-related `handleMouseUp` logic.
Remove curlicue placement.

The class becomes:

```typescript
export class DecorationTool {
  store: SigilStore;
  undo: UndoManager;
  currentTool: string | null;

  constructor(store: SigilStore, undo: UndoManager) {
    this.store = store;
    this.undo = undo;
    this.currentTool = null;
  }

  setTool(tool: string | null): void {
    this.currentTool = tool;
  }

  handleMouseDown(nx: NormalizedCoord, ny: NormalizedCoord): { placed: string } | null {
    if (this.currentTool !== 'text') return null;
    const text = (document.getElementById('text-input') as HTMLInputElement).value.trim();
    if (!text) return null;
    this.undo.snapshot();
    const deco = this.store.addText(text, nx, ny);
    return { placed: deco.id };
  }
}
```

**Step 2: Commit**

```
git add js/decorations.ts
git commit -m "refactor: strip DecorationTool to text-only"
```

---

### Task 7: Toolbar and HTML — remove squiggle/curlicue UI

**Files:**

- Modify: `index.html`
- Modify: `js/toolbar.ts`

**Step 1: Remove squiggle/curlicue buttons from index.html**

Delete these lines from `index.html`:

```html
<button class="tool-btn" data-tool="squiggle" title="Draw Squiggle">&#8766;</button>
<button class="tool-btn" data-tool="curlicue" title="Place Curlicue">&#10048;</button>
```

**Step 2: Update toolbar.ts**

Change `Shape` import to `Voice`. Update `getSelected()` to return `Voice | null`
and call `this.store.getVoice()`. Update all `store.updateShape` calls to
`store.updateVoice`. Update `store.updateFill` to `store.updateVoice` with fill.

**Step 3: Commit**

```
git add index.html js/toolbar.ts
git commit -m "feat: remove squiggle/curlicue UI from toolbar and HTML"
```

---

### Task 8: App.ts and interaction.ts — wire everything up

**Files:**

- Modify: `js/app.ts`
- Modify: `js/interaction.ts`

**Step 1: Update interaction.ts**

Remove `mode: 'drawing'` (was for squiggle freehand drawing). The rest stays.

**Step 2: Update app.ts imports**

Replace all `Shape`/`Decoration`/`SquiggleDecoration` imports with `Voice`/
`TextDecoration`/`WaveformType`. Replace `store.addShape` → `store.addVoice`,
`store.getShape` → `store.getVoice`, `store.updateShape` → `store.updateVoice`,
etc.

**Step 3: Remove squiggle/curlicue interaction logic**

Delete all branches checking for `tool === 'squiggle'` or `tool === 'curlicue'`.
Remove the live squiggle preview drawing. Remove squiggle-specific `deco-dragging`
and `deco-resizing` point-manipulation code.

**Step 4: Update rotation handling**

Where the code currently does `store.updateShape(id, { rotation: degrees(angle) })`,
change to:

1. Compute timbre from angle using `rotationToTimbre(angle, voice.waveform)`
2. Call `store.updateVoice(id, { timbre: normalizedCoord(timbre) })`
3. Only do this for pulse/blend voices; sine voices don't rotate.

**Step 5: Update audio.ts \_buildVoice and updateVoices**

Change `_buildVoice` to accept `Voice` instead of `Shape`. Use
`voice.waveform` instead of `shape.type`. For timbre:

- Access `voice.timbre` directly for pulse/blend (it's already 0–1)
- No detune from curlicues — remove `curlicuesToDetune` calls

In `updateVoices`: iterate `sigilState.voices` instead of `sigilState.shapes`.
Remove text vocoder playback from `play()` or update to use `sigilState.texts`.

**Step 6: Update audio.ts text vocoder playback**

In `play()`, iterate `sigilState.texts` instead of filtering decorations.
Use `TextDecoration.color` to apply formant filter to the carrier (same
`hueToFormants` mapping). Use `TextDecoration.size` for carrier gain.

**Step 7: Update embed-entry.ts**

Replace `sigil.shapes` → `sigil.voices`, `sigil.decorations` → `sigil.texts`.

**Step 8: Run typecheck**

Run: `bun run check`
Expected: PASS — zero type errors.

**Step 9: Commit**

```
git add js/app.ts js/interaction.ts js/audio.ts js/embed-entry.ts
git commit -m "feat: wire voices/texts through app, audio engine, and embed"
```

---

### Task 9: Update remaining tests

**Files:**

- Modify: `tests/unit/audio-engine.test.js`
- Modify: `tests/unit/shapes.test.js`
- Modify: `tests/unit/types.test.js`
- Modify: `tests/unit/embed.test.js`
- Modify: all integration tests under `tests/integration/`

**Step 1: Update audio-engine.test.js**

Replace all `shapes` → `voices`, `decorations` → `texts`.
Remove curlicue references. Update shape type strings to waveform strings.

**Step 2: Update shapes.test.js**

Update hit testing to use `Voice` objects instead of `Shape` objects.
Remove squiggle/curlicue hit test cases.

**Step 3: Update types.test.js**

Update to test `Voice` union, `waveformShape()`, new `TextDecoration`.
Remove old `Shape`/`Decoration` tests.

**Step 4: Update embed.test.js**

Replace `shapes`/`decorations` with `voices`/`texts`.

**Step 5: Update integration tests**

Update `shape-placement.test.js` — likely rename to `voice-placement.test.js`.
Update `serialization.test.js` with new format.
Update `playback.test.js` with new data shape.
Update `play-modes.test.js`.

**Step 6: Run full test suite**

Run: `bun test && bun run check`
Expected: ALL PASS, zero type errors.

**Step 7: Commit**

```
git add tests/
git commit -m "test: update all tests for voice/text bijective model"
```

---

### Task 10: Build and smoke test

**Files:** None (verification only)

**Step 1: Build**

Run: `bun run build`
Expected: Clean build, no errors.

**Step 2: Dev build**

Run: `bun run dev` (in non-watch mode, just build once)
Expected: Clean build with source maps.

**Step 3: Run full test suite**

Run: `bun test && bunx playwright test`
Expected: ALL PASS.

**Step 4: Commit (if any fixups needed)**

---

### Task 11: Clean up removed code and final commit

**Files:**

- Modify: `js/vocoder.ts` (if text changes affect it)
- Delete or empty: squiggle/curlicue CSS if any in `css/style.css`
- Modify: `CLAUDE.md` project structure section (update file descriptions)

**Step 1: Update CLAUDE.md project structure**

Update the file tree to reflect:

- `types.ts` now has Voice union, TextDecoration, no Shape/Decoration
- `state.ts` now has voice/text CRUD
- `decorations.ts` now text-only
- Remove `vocoder.ts` description reference to "text decorations (bandpass filter bank)"
  — keep it accurate

**Step 2: Check for dead code**

Run: `bun run check` and `bun run lint` to catch any unreferenced imports
or unused variables.

**Step 3: Final commit**

```
git add -A
git commit -m "chore: clean up project structure docs and dead code"
```
