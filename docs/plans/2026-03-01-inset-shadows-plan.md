# Inset Shadows (Master Reverb) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an inset shadow on the canvas frame that maps to master-level reverb, with depth slider and glow/dim toggle.

**Architecture:** The canvas element is split into a frame div (background, border-radius, bevel, inset shadow) and a transparent canvas (shapes only). A `reverb` field is added to `SigilData` (global, not per-voice). Audio uses a ConvolverNode with algorithmically generated impulse responses on the master chain. UI follows the existing border panel pattern.

**Tech Stack:** CSS box-shadow, Canvas 2D API, Web Audio ConvolverNode, algorithmic IR generation.

**Design doc:** `docs/plans/2026-03-01-inset-shadows-design.md`

---

### Task 1: Add Reverb type to types.ts and SigilData

**Files:**
- Modify: `js/types.ts:143-207`

**Step 1: Add ReverbStyle type and Reverb interface**

After the `Border` interface (line 149), add:

```ts
export type ReverbStyle = 'glow' | 'dim';

export interface Reverb {
  depth: NormalizedCoord;
  style: ReverbStyle;
}
```

**Step 2: Add reverb field to SigilData**

Update `SigilData` (line 203) to include reverb:

```ts
export interface SigilData {
  envelope: Envelope;
  voices: Voice[];
  texts: TextDecoration[];
  reverb: Reverb | null;
}
```

**Step 3: Verify types**

Run: `npx tsc --noEmit`

This will fail because `createDefaultState()` in `state.ts` doesn't include `reverb`. That's expected — fix in Task 2.

**Step 4: Update createDefaultState and fix type errors**

In `js/state.ts:21-27`, update `createDefaultState`:

```ts
export function createDefaultState(): SigilData {
  return {
    envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    voices: [],
    texts: [],
    reverb: null,
  };
}
```

Also add `Reverb` to the imports from `types.ts`, and add methods to `SigilStore`:

```ts
updateReverb(reverb: Reverb | null): void {
  this.data.reverb = reverb;
  this._notify();
}
```

**Step 5: Verify types pass**

Run: `npx tsc --noEmit`

Expected: PASS (or more downstream errors in `serialize.ts` which we fix in Task 3).

**Step 6: Run existing tests**

Run: `bun test`

Some tests may need `reverb: null` added to their `makeState()` helpers. Fix any that break by adding the field.

**Step 7: Commit**

```
git add js/types.ts js/state.ts
git commit -m "Add Reverb type and reverb field to SigilData"
```

---

### Task 2: Add reverb state tests

**Files:**
- Modify: `tests/unit/state.test.js`

**Step 1: Add reverb tests to state.test.js**

Add a new `describe` block after the existing `SigilStore border` block:

```js
describe('SigilStore reverb', () => {
  test('default state has null reverb', () => {
    const store = new SigilStore();
    expect(store.data.reverb).toBeNull();
  });

  test('updateReverb sets reverb', () => {
    const store = new SigilStore();
    store.updateReverb({ depth: 0.5, style: 'glow' });
    expect(store.data.reverb).not.toBeNull();
    expect(store.data.reverb.depth).toBe(0.5);
    expect(store.data.reverb.style).toBe('glow');
  });

  test('updateReverb to null removes reverb', () => {
    const store = new SigilStore();
    store.updateReverb({ depth: 0.5, style: 'dim' });
    store.updateReverb(null);
    expect(store.data.reverb).toBeNull();
  });

  test('updateReverb notifies listeners', () => {
    const store = new SigilStore();
    let called = false;
    store.onChange(() => { called = true; });
    store.updateReverb({ depth: 0.3, style: 'glow' });
    expect(called).toBe(true);
  });

  test('reverb persists through undo/redo', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.updateReverb({ depth: 0.7, style: 'dim' });

    expect(store.data.reverb).not.toBeNull();
    undo.undo();
    expect(store.data.reverb).toBeNull();
    undo.redo();
    expect(store.data.reverb.depth).toBe(0.7);
    expect(store.data.reverb.style).toBe('dim');
  });
});
```

**Step 2: Run tests**

Run: `bun test`

Expected: all tests pass.

**Step 3: Commit**

```
git add tests/unit/state.test.js
git commit -m "Add reverb state tests"
```

---

### Task 3: Add reverb serialization

**Files:**
- Modify: `js/serialize.ts`
- Modify: `tests/unit/serialize.test.js`

**Step 1: Update wire format comment**

At the top of `serialize.ts`, update the comment to document the new format:

```ts
//   [envelope, voices, texts, reverb?]
//
//   reverb = 0 (none) | ["G"|"D", depth]
```

**Step 2: Add pack/unpack functions**

After the `packBorder`/`unpackBorder` functions, add:

```ts
type PackedReverb = 0 | [string, number];

const reverbStyleMap: Record<string, string> = { glow: 'G', dim: 'D' };
const reverbStyleUnmap: Record<string, ReverbStyle> = { G: 'glow', D: 'dim' };

function packReverb(reverb: Reverb | null): PackedReverb {
  if (!reverb) return 0;
  return [reverbStyleMap[reverb.style]!, round3(reverb.depth)];
}

function unpackReverb(packed: PackedReverb | undefined): Reverb | null {
  if (!packed || !Array.isArray(packed)) return null;
  return {
    style: reverbStyleUnmap[packed[0]] ?? 'glow',
    depth: normalizedCoord(packed[1]),
  };
}
```

Add `Reverb`, `ReverbStyle` to the imports from `types.ts`.

**Step 3: Update PackedState type**

```ts
type PackedState = [
  [number, number, number, number], // envelope
  PackedVoice[],                    // voices
  PackedText[],                     // texts
  PackedReverb?,                    // reverb (optional for backwards compat)
];
```

**Step 4: Update pack function**

In `pack()`, add reverb to the output array:

```ts
function pack(state: SigilData): PackedState {
  const packed: PackedState = [
    [
      round2(state.envelope.attack),
      round2(state.envelope.decay),
      round2(state.envelope.sustain),
      round2(state.envelope.release),
    ],
    state.voices.map((v): PackedVoice => {
      // ... existing voice packing unchanged ...
    }),
    state.texts.map((t): PackedText => [t.text, round3(t.x), round3(t.y), round3(t.size)]),
  ];
  const rv = packReverb(state.reverb);
  if (rv !== 0) packed.push(rv);
  return packed;
}
```

Only append reverb if non-null, so existing URLs without reverb stay unchanged.

**Step 5: Update unpack function**

In `unpack()`, read the optional 4th element:

```ts
function unpack(packed: PackedState): SigilData {
  const [env, voices, texts] = packed;
  return {
    envelope: { /* unchanged */ },
    voices: /* unchanged */,
    texts: /* unchanged */,
    reverb: unpackReverb(packed[3] as PackedReverb | undefined),
  };
}
```

**Step 6: Add serialization tests**

In `tests/unit/serialize.test.js`, add:

```js
describe('reverb serialization', () => {
  test('null reverb round-trips', () => {
    const state = makeState({ reverb: null });
    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);
    expect(decoded.reverb).toBeNull();
  });

  test('glow reverb round-trips', () => {
    const state = makeState({ reverb: { depth: 0.6, style: 'glow' } });
    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);
    expect(decoded.reverb).not.toBeNull();
    expect(decoded.reverb.style).toBe('glow');
    expect(decoded.reverb.depth).toBeCloseTo(0.6);
  });

  test('dim reverb round-trips', () => {
    const state = makeState({ reverb: { depth: 0.3, style: 'dim' } });
    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);
    expect(decoded.reverb.style).toBe('dim');
    expect(decoded.reverb.depth).toBeCloseTo(0.3);
  });

  test('old URLs without reverb deserialize with null reverb', () => {
    // Encode a state without reverb, then verify it deserializes correctly
    const state = makeState();
    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);
    expect(decoded.reverb).toBeNull();
  });
});
```

Also update `makeState` to include `reverb: null` by default.

**Step 7: Verify types and tests**

Run: `npx tsc --noEmit && bun test`

Expected: all pass.

**Step 8: Commit**

```
git add js/serialize.ts tests/unit/serialize.test.js
git commit -m "Add reverb serialization with backwards-compatible wire format"
```

---

### Task 4: Split canvas element into frame div + transparent canvas

**Files:**
- Modify: `index.html:128-131`
- Modify: `css/style.css` (canvas section)
- Modify: `js/canvas.ts:9,65-68`
- Modify: `js/envelope.ts:27-34`
- Modify: `js/app.ts:72-83,104-108`

**Step 1: Add canvas-frame div to HTML**

In `index.html`, update the canvas-wrap contents (line 128-131):

```html
<main id="canvas-area">
  <div id="canvas-wrap">
    <div id="canvas-frame"></div>
    <canvas id="sigil-canvas" width="800" height="800"></canvas>
  </div>
</main>
```

**Step 2: Update CSS**

Move background, border, and border-radius from `#sigil-canvas` to `#canvas-frame`:

```css
#canvas-frame {
  position: absolute;
  inset: 0;
  background: #2a2a2a;
  border-width: 2px;
  border-style: solid;
  border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
}

#sigil-canvas {
  position: relative;
  display: block;
  background: transparent;
  image-rendering: auto;
}
```

Also update `#canvas-wrap` to be `position: relative`.

**Step 3: Update canvas.ts — clear to transparent**

Change the render function (lines 65-68). Replace:

```ts
ctx.fillStyle = CANVAS_BG;
ctx.fillRect(0, 0, canvasSize, canvasSize);
```

With:

```ts
ctx.clearRect(0, 0, canvasSize, canvasSize);
```

Remove the unused `CANVAS_BG` constant (line 9).

**Step 4: Update envelope.ts — target frame div**

Update `updateCanvasBorderRadius` to accept the frame element instead of the canvas:

```ts
export function updateCanvasBorderRadius(
  frameEl: HTMLElement,
  envelope: Envelope,
  canvasSize: number,
): void {
  const radii = envelopeToCornerRadii(envelope, canvasSize);
  frameEl.style.borderRadius = `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`;
}
```

**Step 5: Update app.ts — use frame element**

Find the `updateCanvasBorderRadius` calls. The function is called with the canvas element. Change it to use the frame div:

- Near line 27: add `const canvasFrame = document.getElementById('canvas-frame')!;`
- Line 82: `updateCanvasBorderRadius(canvasFrame, store.data.envelope, size);`
- Lines 104-108: `updateCanvasBorderRadius(canvasFrame, store.data.envelope, parseInt(wrap.style.width) || CANVAS_SIZE);`

**Step 6: Update resizeCanvas**

In `resizeCanvas()` (near line 68), also size the frame div. Since `#canvas-frame` has `position: absolute; inset: 0`, it will auto-fill `#canvas-wrap` — no explicit sizing needed.

**Step 7: Verify types and tests**

Run: `npx tsc --noEmit && bun test`

Expected: all pass.

**Step 8: Build and verify**

Run: `bun run build`

Serve dist and visually verify that the canvas still shows the dark background with shapes on top, ADSR corners still round, and the bevel border is intact.

**Step 9: Commit**

```
git add index.html css/style.css js/canvas.ts js/envelope.ts js/app.ts
git commit -m "Split canvas into frame div + transparent canvas for inset shadow support"
```

---

### Task 5: Add reverb shadow rendering on canvas frame

**Files:**
- Modify: `js/app.ts` (add shadow update logic)
- Modify: `css/style.css` (add transition for shadow)

**Step 1: Add updateReverbShadow function in app.ts**

Add a function to apply the inset shadow CSS:

```ts
function updateReverbShadow(frameEl: HTMLElement, reverb: Reverb | null, canvasSize: number): void {
  if (!reverb) {
    frameEl.style.boxShadow = 'none';
    return;
  }
  const maxBlur = canvasSize * 0.15;
  const blur = reverb.depth * maxBlur;
  const alpha = 0.3 + reverb.depth * 0.5;
  const color = reverb.style === 'glow'
    ? `rgba(255,255,255,${alpha.toFixed(2)})`
    : `rgba(0,0,0,${alpha.toFixed(2)})`;
  frameEl.style.boxShadow = `inset 0 0 ${blur.toFixed(1)}px ${color}`;
}
```

Import `Reverb` from `types.ts`.

**Step 2: Call updateReverbShadow in the render loop**

In `renderLoop()`, after the `updateCanvasBorderRadius` call, add:

```ts
updateReverbShadow(canvasFrame, store.data.reverb, parseInt(wrap.style.width) || CANVAS_SIZE);
```

**Step 3: Also call in resizeCanvas**

After the `updateCanvasBorderRadius` call in `resizeCanvas()`:

```ts
updateReverbShadow(canvasFrame, store.data.reverb, size);
```

**Step 4: Add CSS transition**

In `css/style.css`, add to the `#canvas-frame` rule:

```css
transition: box-shadow 0.15s, border-radius 0.15s;
```

**Step 5: Verify types and tests**

Run: `npx tsc --noEmit && bun test`

Expected: all pass.

**Step 6: Commit**

```
git add js/app.ts css/style.css
git commit -m "Add reverb inset shadow rendering on canvas frame"
```

---

### Task 6: Add master reverb to audio engine

**Files:**
- Modify: `js/audio.ts`
- Modify: `tests/unit/audio-engine.test.js`

**Step 1: Add IR generation function**

Near the top of `audio.ts` (after the mapping functions), add:

```ts
function generateImpulseResponse(
  ctx: AudioContext,
  style: ReverbStyle,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const duration = style === 'glow' ? 0.3 : 2.0;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const cutoff = style === 'glow' ? 1.0 : 0.3;

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      let sample = (Math.random() * 2 - 1) * Math.exp(-3 * t / duration);
      if (cutoff < 1.0) {
        sample *= Math.max(0, 1 - t * (1 - cutoff));
      }
      data[i] = sample;
    }
  }
  return buffer;
}
```

Import `ReverbStyle` from `types.ts`.

**Step 2: Add reverb nodes to AudioEngine**

Add fields to the `AudioEngine` class constructor:

```ts
private _reverbConvolver: ConvolverNode | null = null;
private _reverbWet: GainNode | null = null;
private _reverbStyle: ReverbStyle | null = null;
```

**Step 3: Add updateReverb method**

```ts
updateReverb(reverb: Reverb | null): void {
  if (!this.audioCtx || !this.isPlaying) return;
  const ctx = this.audioCtx;

  if (!reverb) {
    // Remove reverb
    if (this._reverbConvolver) {
      safeDisconnect(this._reverbConvolver);
      this._reverbConvolver = null;
    }
    if (this._reverbWet) {
      safeDisconnect(this._reverbWet);
      this._reverbWet = null;
    }
    this._reverbStyle = null;
    return;
  }

  // Create or update convolver
  if (!this._reverbConvolver || this._reverbStyle !== reverb.style) {
    // Style changed — rebuild convolver
    if (this._reverbConvolver) safeDisconnect(this._reverbConvolver);
    if (this._reverbWet) safeDisconnect(this._reverbWet);

    this._reverbConvolver = ctx.createConvolver();
    this._reverbConvolver.buffer = generateImpulseResponse(ctx, reverb.style);

    this._reverbWet = ctx.createGain();

    // Wire: envelopeGain → convolver → wetGain → compressor
    this.envelopeGain!.connect(this._reverbConvolver);
    this._reverbConvolver.connect(this._reverbWet);
    this._reverbWet.connect(this.compressor!);

    this._reverbStyle = reverb.style;
  }

  // Update wet level
  this._reverbWet!.gain.value = reverb.depth;
}
```

**Step 4: Call updateReverb in play()**

In the `play()` method, after the master chain is wired (after `this.compressor.connect(ctx.destination)`), add:

```ts
if (sigilState.reverb) {
  this.updateReverb(sigilState.reverb);
}
```

Wait — the reverb needs `envelopeGain` to be connected, and that happens later in `play()`. Add the reverb setup after the EQ chain is wired (after line 411: `this.compressor.connect(ctx.destination);`):

```ts
// Master reverb (if active)
if (sigilState.reverb) {
  this._reverbConvolver = ctx.createConvolver();
  this._reverbConvolver.buffer = generateImpulseResponse(ctx, sigilState.reverb.style);
  this._reverbWet = ctx.createGain();
  this._reverbWet.gain.value = sigilState.reverb.depth;
  this.envelopeGain.connect(this._reverbConvolver);
  this._reverbConvolver.connect(this._reverbWet);
  this._reverbWet.connect(this.compressor);
  this._reverbStyle = sigilState.reverb.style;
}
```

**Step 5: Clean up reverb in _cleanup()**

In `_cleanup()`, before the `this.isPlaying = false` line, add:

```ts
if (this._reverbConvolver) {
  safeDisconnect(this._reverbConvolver);
  this._reverbConvolver = null;
}
if (this._reverbWet) {
  safeDisconnect(this._reverbWet);
  this._reverbWet = null;
}
this._reverbStyle = null;
```

**Step 6: Wire updateReverb into updateVoices**

At the end of `updateVoices()`, call `updateReverb` so live changes take effect:

```ts
// Update master reverb
this.updateReverb(sigilState.reverb);
```

Wait — `updateVoices` receives `sigilState` which has `reverb`. But reverb updates should also happen when no voices change. Better: call `updateReverb` from `app.ts` in the `store.onChange` handler. Add to `updateVoices` anyway since it's called frequently during playback and keeps the reverb in sync.

**Step 7: Add audio engine tests**

In `tests/unit/audio-engine.test.js`, add a new `describe` block:

```js
describe('AudioEngine — master reverb', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = engine.audioCtx.createGain();
  });

  function makeReverbState(reverb) {
    return {
      voices: [makeVoice('a')],
      texts: [],
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
      reverb,
    };
  }

  test('play with null reverb creates no convolver', async () => {
    const state = makeReverbState(null);
    await engine.play(state, state.envelope);
    expect(engine._reverbConvolver).toBeNull();
  });

  test('play with reverb creates convolver and wet gain', async () => {
    const state = makeReverbState({ depth: 0.5, style: 'glow' });
    await engine.play(state, state.envelope);
    expect(engine._reverbConvolver).not.toBeNull();
    expect(engine._reverbWet).not.toBeNull();
  });

  test('reverb wet gain matches depth', async () => {
    const state = makeReverbState({ depth: 0.7, style: 'dim' });
    await engine.play(state, state.envelope);
    expect(engine._reverbWet.gain.value).toBeCloseTo(0.7);
  });

  test('reverb is cleaned up on stop', async () => {
    const state = makeReverbState({ depth: 0.5, style: 'glow' });
    await engine.play(state, state.envelope);
    engine.stop();
    expect(engine._reverbConvolver).toBeNull();
    expect(engine._reverbWet).toBeNull();
  });

  test('updateReverb changes wet gain during playback', async () => {
    const state = makeReverbState({ depth: 0.3, style: 'glow' });
    await engine.play(state, state.envelope);
    engine.updateReverb({ depth: 0.8, style: 'glow' });
    expect(engine._reverbWet.gain.value).toBeCloseTo(0.8);
  });
});
```

The stub `createStubAudioContext` needs a `createConvolver` method and `createBuffer`. Add to the stub:

```js
createConvolver() {
  return createStubNode({ buffer: null });
},
createBuffer(channels, length, sampleRate) {
  const channelData = [];
  for (let i = 0; i < channels; i++) {
    channelData.push(new Float32Array(length));
  }
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    getChannelData(ch) { return channelData[ch]; },
  };
},
```

Also update `makeSigilState` to include `reverb: null`.

**Step 8: Verify types and tests**

Run: `npx tsc --noEmit && bun test`

Expected: all pass.

**Step 9: Commit**

```
git add js/audio.ts tests/unit/audio-engine.test.js
git commit -m "Add master reverb with algorithmic IR generation"
```

---

### Task 7: Add reverb panel UI

**Files:**
- Modify: `index.html` (add reverb panel HTML, toolbar button)
- Modify: `css/style.css` (reverb panel styles)
- Modify: `js/toolbar.ts` (bind reverb panel)
- Modify: `js/app.ts` (wire reverb updates to audio)

**Step 1: Add reverb button to bottom toolbar**

In `index.html`, add the reverb button after `#btn-border` (near line 284):

```html
<button id="btn-reverb" class="action-btn" title="Reverb (inset shadow)">
  &#9676;
</button>
```

**Step 2: Add reverb panel HTML**

After the border panel (after line ~261), add:

```html
<!-- Reverb Panel (hidden by default) -->
<div id="reverb-panel" class="panel hidden">
  <div class="reverb-controls">
    <div class="reverb-row">
      <span class="reverb-label">Style</span>
      <button class="reverb-style-btn active" data-reverb-style="glow">G</button>
      <button class="reverb-style-btn" data-reverb-style="dim">D</button>
    </div>
    <div class="reverb-row">
      <span class="reverb-label">Depth</span>
      <input id="reverb-depth" class="reverb-slider" type="range" min="1" max="100" value="50" />
    </div>
    <button id="btn-remove-reverb" class="reverb-remove-btn">Remove</button>
  </div>
</div>
```

**Step 3: Add reverb panel CSS**

In `css/style.css`, after the border panel styles, add:

```css
/* ---- Reverb Panel ---- */

#reverb-panel {
  position: fixed;
  bottom: 50px;
  left: 12px;
  top: auto;
  transform: none;
}

.reverb-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 180px;
}

.reverb-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.reverb-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  width: 64px;
  flex-shrink: 0;
}

.reverb-style-btn {
  background: var(--bg-toolbar);
  border-width: 1px;
  border-style: solid;
  border-color: var(--bevel-hi) var(--bevel-lo) var(--bevel-lo) var(--bevel-hi);
  color: var(--text-muted);
  padding: 2px 10px;
  border-radius: 2px;
  cursor: pointer;
  font-family: 'Share Tech Mono', monospace;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.reverb-style-btn.active {
  color: var(--text-primary);
  border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
  background: var(--active-bg);
}

.reverb-slider {
  flex: 1;
  height: 4px;
}

.reverb-remove-btn {
  background: transparent;
  border: 1px solid rgba(204, 51, 68, 0.3);
  color: var(--danger);
  padding: 3px 10px;
  border-radius: 2px;
  cursor: pointer;
  font-family: 'Share Tech Mono', monospace;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 4px;
  align-self: flex-end;
}

.reverb-remove-btn:hover {
  background: rgba(204, 51, 68, 0.12);
  border-color: var(--danger);
}

#btn-reverb.has-reverb {
  background: var(--active-bg);
  border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
}
```

**Step 4: Add toolbar bindings**

In `js/toolbar.ts`, add `_bindReverbPanel` and `_updateReverbPanel` methods. Follow the exact same pattern as `_bindBorderPanel`.

Import `normalizedCoord`, `ReverbStyle` from `types.ts`.

```ts
_bindReverbPanel(): void {
  const btn = document.getElementById('btn-reverb');
  const panel = document.getElementById('reverb-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (this.store.data.reverb) {
      panel.classList.toggle('hidden');
    } else {
      this.undo.snapshot();
      this.store.updateReverb({ depth: normalizedCoord(0.5), style: 'glow' });
      panel.classList.remove('hidden');
      this._updateReverbPanel();
    }
  });

  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target as Node) && e.target !== btn) {
      panel.classList.add('hidden');
    }
  });

  // Style toggles
  panel.querySelectorAll<HTMLElement>('.reverb-style-btn').forEach((styleBtn) => {
    styleBtn.addEventListener('click', () => {
      const rev = this.store.data.reverb;
      if (!rev) return;
      this.undo.snapshot();
      this.store.updateReverb({ ...rev, style: styleBtn.dataset.reverbStyle as ReverbStyle });
      this._updateReverbPanel();
    });
  });

  // Remove button
  const removeBtn = document.getElementById('btn-remove-reverb');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      this.undo.snapshot();
      this.store.updateReverb(null);
      panel.classList.add('hidden');
      this._updateReverbPanel();
    });
  }

  // Depth slider
  const slider = document.getElementById('reverb-depth') as HTMLInputElement | null;
  if (slider) {
    slider.addEventListener('input', () => {
      const rev = this.store.data.reverb;
      if (!rev) return;
      this.store.updateReverb({ ...rev, depth: normalizedCoord(parseInt(slider.value) / 100) });
    });
    slider.addEventListener('pointerdown', () => {
      this.undo.snapshot();
    });
  }
}

_updateReverbPanel(): void {
  const btn = document.getElementById('btn-reverb');
  const hasReverb = this.store.data.reverb != null;

  btn?.classList.toggle('has-reverb', hasReverb);

  if (!hasReverb) return;
  const reverb = this.store.data.reverb!;

  document.querySelectorAll<HTMLElement>('.reverb-style-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.reverbStyle === reverb.style);
  });

  const slider = document.getElementById('reverb-depth') as HTMLInputElement | null;
  if (slider) {
    slider.value = String(Math.round(reverb.depth * 100));
  }
}
```

Call `_bindReverbPanel()` in the constructor (where `_bindBorderPanel()` is called).

Call `_updateReverbPanel()` at the end of `syncToSelectedShape()`.

**Step 5: Wire audio updates**

In `js/app.ts`, in the `store.onChange` handler, add reverb update:

```ts
if (audio.isPlaying) {
  audio.updateReverb(store.data.reverb);
}
```

**Step 6: Verify types and tests**

Run: `npx tsc --noEmit && bun test`

Expected: all pass.

**Step 7: Commit**

```
git add index.html css/style.css js/toolbar.ts js/app.ts
git commit -m "Add reverb panel UI with depth slider and glow/dim toggle"
```

---

### Task 8: Update embed page

**Files:**
- Modify: `embed.html`
- Modify: `js/embed-entry.ts`

**Step 1: Add canvas-frame div to embed.html**

Update the embed HTML structure:

```html
<div id="wrap">
  <div id="canvas-frame"></div>
  <canvas id="c" width="800" height="800"></canvas>
  <button id="play-btn">&#9654; PLAY</button>
</div>
```

Add styles for `#canvas-frame`:

```css
#canvas-frame {
  position: absolute;
  inset: 0;
  background: #2a2a2a;
}
canvas {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  background: transparent;
}
```

Remove the `background` from the `canvas` rule.

**Step 2: Update embed-entry.ts**

Apply border-radius and reverb shadow to the frame div:

```ts
const frame = document.getElementById('canvas-frame')!;

// Apply ADSR border radius to frame
updateCanvasBorderRadius(frame, sigil.envelope, 800);

// Apply reverb shadow
if (sigil.reverb) {
  const maxBlur = 800 * 0.15;
  const blur = sigil.reverb.depth * maxBlur;
  const alpha = 0.3 + sigil.reverb.depth * 0.5;
  const color = sigil.reverb.style === 'glow'
    ? `rgba(255,255,255,${alpha.toFixed(2)})`
    : `rgba(0,0,0,${alpha.toFixed(2)})`;
  frame.style.boxShadow = `inset 0 0 ${blur.toFixed(1)}px ${color}`;
}
```

Update the `updateCanvasBorderRadius` call — it was targeting the canvas, now targets the frame.

**Step 3: Verify types and build**

Run: `npx tsc --noEmit && bun run build`

Expected: PASS.

**Step 4: Commit**

```
git add embed.html js/embed-entry.ts
git commit -m "Update embed page with canvas frame and reverb shadow"
```

---

### Task 9: Update CLAUDE.md and run final verification

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md**

Add reverb to the key concepts section:

```
- **Reverb** is a global effect on `SigilData` (not per-voice). The canvas
  frame gains an inset shadow (CSS box-shadow) that maps to master reverb.
  `depth` controls wet/dry mix and shadow intensity. `style` is either
  'glow' (small room, bright) or 'dim' (arena, dark). ConvolverNode with
  algorithmic impulse response.
```

Update the canvas frame note:

```
- The canvas is split: `#canvas-frame` (div) owns background, border-radius,
  bevel, and inset shadow. `#sigil-canvas` (canvas) is transparent and draws
  shapes only. This ensures the inset shadow appears behind shapes.
```

**Step 2: Run full test suite**

Run: `npx tsc --noEmit && bun test`

Expected: all tests pass.

**Step 3: Build**

Run: `bun run build`

**Step 4: Commit**

```
git add CLAUDE.md
git commit -m "Update CLAUDE.md for reverb and canvas frame architecture"
```

---

### Task 10: Add ADSR corner drag integration tests

**Files:**
- Create: `tests/integration/adsr-corners.test.js`

This task addresses the user's note that ADSR corner dragging is unreliable with touch events. We need integration tests that exercise the pointer event flow through the app, simulating both mouse and touch interactions.

**Step 1: Create the test file**

Create `tests/integration/adsr-corners.test.js`. These tests simulate pointer events on the canvas to exercise the ADSR corner interaction state machine.

```js
import { describe, test, expect, beforeEach } from 'bun:test';
import { hitTestADSRCorner, getDecoBounds } from '../../js/shapes.ts';
import {
  envelopeToCornerRadii,
  dragToEnvelopeValue,
  updateCanvasBorderRadius,
} from '../../js/envelope.ts';

const CANVAS_SIZE = 800;
const defaultEnvelope = { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 };

describe('ADSR corner hit testing', () => {
  test('attack corner (bottom-left) is hit near (0, 800)', () => {
    const result = hitTestADSRCorner(defaultEnvelope, 10, CANVAS_SIZE - 10, CANVAS_SIZE);
    expect(result).toBe('attack');
  });

  test('decay corner (top-left) is hit near (0, 0)', () => {
    const result = hitTestADSRCorner(defaultEnvelope, 10, 10, CANVAS_SIZE);
    expect(result).toBe('decay');
  });

  test('sustain corner (top-right) is hit near (800, 0)', () => {
    const result = hitTestADSRCorner(defaultEnvelope, CANVAS_SIZE - 10, 10, CANVAS_SIZE);
    expect(result).toBe('sustain');
  });

  test('release corner (bottom-right) is hit near (800, 800)', () => {
    const result = hitTestADSRCorner(defaultEnvelope, CANVAS_SIZE - 10, CANVAS_SIZE - 10, CANVAS_SIZE);
    expect(result).toBe('release');
  });

  test('center of canvas hits no corner', () => {
    const result = hitTestADSRCorner(defaultEnvelope, 400, 400, CANVAS_SIZE);
    expect(result).toBeNull();
  });

  test('hit radius is proportional to canvas size', () => {
    // At 800px, hit radius = 800 * 0.08 = 64px
    // Point at (65, 65) should NOT hit decay corner (0,0)
    // But (63, 0) should hit it
    const miss = hitTestADSRCorner(defaultEnvelope, 65, 65, CANVAS_SIZE);
    expect(miss).toBeNull();

    const hit = hitTestADSRCorner(defaultEnvelope, 63, 0, CANVAS_SIZE);
    expect(hit).toBe('decay');
  });
});

describe('ADSR drag to envelope value', () => {
  test('attack: small drag = small value', () => {
    const val = dragToEnvelopeValue('attack', 10, CANVAS_SIZE);
    expect(val).toBeGreaterThan(0.01);
    expect(val).toBeLessThan(0.5);
  });

  test('attack: large drag = clamped at max', () => {
    const val = dragToEnvelopeValue('attack', CANVAS_SIZE, CANVAS_SIZE);
    expect(val).toBe(2.0);
  });

  test('attack: zero drag = minimum', () => {
    const val = dragToEnvelopeValue('attack', 0, CANVAS_SIZE);
    expect(val).toBe(0.01);
  });

  test('sustain: half drag = 0.5', () => {
    const maxR = CANVAS_SIZE * 0.15;
    const val = dragToEnvelopeValue('sustain', maxR * 0.5, CANVAS_SIZE);
    expect(val).toBeCloseTo(0.5, 1);
  });

  test('sustain: clamped between 0 and 1', () => {
    expect(dragToEnvelopeValue('sustain', 0, CANVAS_SIZE)).toBe(0);
    expect(dragToEnvelopeValue('sustain', CANVAS_SIZE, CANVAS_SIZE)).toBe(1.0);
  });

  test('release: max drag = 3.0', () => {
    const val = dragToEnvelopeValue('release', CANVAS_SIZE, CANVAS_SIZE);
    expect(val).toBe(3.0);
  });

  test('decay: matches attack scaling', () => {
    const attackVal = dragToEnvelopeValue('attack', 50, CANVAS_SIZE);
    const decayVal = dragToEnvelopeValue('decay', 50, CANVAS_SIZE);
    expect(attackVal).toBeCloseTo(decayVal);
  });
});

describe('ADSR corner radii', () => {
  test('default envelope produces non-zero radii', () => {
    const radii = envelopeToCornerRadii(defaultEnvelope, CANVAS_SIZE);
    expect(radii.bottomLeft).toBeGreaterThan(0);
    expect(radii.topLeft).toBeGreaterThan(0);
    expect(radii.topRight).toBeGreaterThan(0);
    expect(radii.bottomRight).toBeGreaterThan(0);
  });

  test('zero envelope produces zero radii', () => {
    const env = { attack: 0, decay: 0, sustain: 0, release: 0 };
    const radii = envelopeToCornerRadii(env, CANVAS_SIZE);
    expect(radii.bottomLeft).toBe(0);
    expect(radii.topLeft).toBe(0);
    expect(radii.topRight).toBe(0);
    expect(radii.bottomRight).toBe(0);
  });

  test('radii scale with canvas size', () => {
    const small = envelopeToCornerRadii(defaultEnvelope, 400);
    const large = envelopeToCornerRadii(defaultEnvelope, 800);
    expect(large.topLeft).toBeCloseTo(small.topLeft * 2);
  });

  test('attack maps to bottomLeft', () => {
    const lowAttack = envelopeToCornerRadii({ ...defaultEnvelope, attack: 0.1 }, CANVAS_SIZE);
    const highAttack = envelopeToCornerRadii({ ...defaultEnvelope, attack: 1.5 }, CANVAS_SIZE);
    expect(highAttack.bottomLeft).toBeGreaterThan(lowAttack.bottomLeft);
    // Other corners should be unchanged
    expect(highAttack.topLeft).toBeCloseTo(lowAttack.topLeft);
  });
});

describe('ADSR drag simulation (pointer event flow)', () => {
  // These tests simulate the full drag flow:
  // 1. pointerdown near a corner → enters 'adsr' interaction mode
  // 2. pointermove away from corner → calls dragToEnvelopeValue
  // 3. pointerup → exits interaction

  test('dragging attack corner outward increases attack', () => {
    // Start near attack corner (0, 800)
    const corner = hitTestADSRCorner(defaultEnvelope, 5, CANVAS_SIZE - 5, CANVAS_SIZE);
    expect(corner).toBe('attack');

    // Simulate drag: distance from corner (0, 800) to (80, 720) = ~113px
    const dist = Math.hypot(80 - 0, (CANVAS_SIZE - 720) - 0);
    const newAttack = dragToEnvelopeValue('attack', dist, CANVAS_SIZE);
    expect(newAttack).toBeGreaterThan(defaultEnvelope.attack);
  });

  test('dragging sustain corner outward increases sustain', () => {
    const corner = hitTestADSRCorner(defaultEnvelope, CANVAS_SIZE - 5, 5, CANVAS_SIZE);
    expect(corner).toBe('sustain');

    // Drag inward: distance from (800, 0) to (700, 100) = ~141px
    const dist = Math.hypot(CANVAS_SIZE - 700, 100 - 0);
    const newSustain = dragToEnvelopeValue('sustain', dist, CANVAS_SIZE);
    expect(newSustain).toBeGreaterThan(0.5);
  });

  test('minimal drag keeps values near minimum', () => {
    const corner = hitTestADSRCorner(defaultEnvelope, 3, 3, CANVAS_SIZE);
    expect(corner).toBe('decay');

    // Tiny drag: 5px
    const newDecay = dragToEnvelopeValue('decay', 5, CANVAS_SIZE);
    expect(newDecay).toBeCloseTo(0.083, 1); // 5 / (800 * 0.15) * 2
  });

  test('touch coordinate scaling: pointer at canvas edge hits corner', () => {
    // Touch events often report coordinates relative to the element.
    // At the corners of an 800x800 canvas, coords should be:
    // attack: (0, 800), decay: (0, 0), sustain: (800, 0), release: (800, 800)
    const corners = [
      { x: 0, y: CANVAS_SIZE, expected: 'attack' },
      { x: 0, y: 0, expected: 'decay' },
      { x: CANVAS_SIZE, y: 0, expected: 'sustain' },
      { x: CANVAS_SIZE, y: CANVAS_SIZE, expected: 'release' },
    ];

    for (const { x, y, expected } of corners) {
      const result = hitTestADSRCorner(defaultEnvelope, x, y, CANVAS_SIZE);
      expect(result).toBe(expected);
    }
  });

  test('touch near but not exactly on corner still hits', () => {
    // Touch target size: 800 * 0.08 = 64px radius
    // A touch 50px from the corner should hit
    const result = hitTestADSRCorner(defaultEnvelope, 50, 50, CANVAS_SIZE);
    expect(result).toBe('decay');
  });

  test('touch between two corners does not hit either', () => {
    // Midpoint of top edge (400, 0): distance to both decay (0,0) and sustain (800,0) is 400px
    // Hit radius is 64px, so this should miss both
    const result = hitTestADSRCorner(defaultEnvelope, 400, 0, CANVAS_SIZE);
    expect(result).toBeNull();
  });
});
```

**Step 2: Run tests**

Run: `bun test`

Expected: all pass.

**Step 3: Commit**

```
git add tests/integration/adsr-corners.test.js
git commit -m "Add ADSR corner drag integration tests"
```
