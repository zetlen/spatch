# Global Blend Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move blend mode from per-voice to global (sigil-level) with overlap tracking, 4 commutative modes, and 2-bit URL serialization.

**Architecture:** Remove `blend` from `VoiceBase`, add to `SigilData`. Pack 2-bit blend index into the top bits of the existing scene header char. Add overlap tracking to `SigilStore` that auto-resets blend to `screen` when no shapes overlap. All FM synthesis reads the global blend instead of per-voice blend.

**Tech Stack:** TypeScript, Bun test runner, Playwright (e2e), Preact Signals

**Spec:** `docs/plans/2026-03-28-global-blend-design.md`

---

### Task 1: Update types — move blend from VoiceBase to SigilData

**Files:**
- Modify: `js/types.ts`

- [ ] **Step 1: Update BLEND_MODES to include exclusion**

In `js/types.ts`, replace the `BLEND_MODES` array:

```ts
export const BLEND_MODES = ['screen', 'multiply', 'exclusion', 'difference'] as const;
```

- [ ] **Step 2: Remove blend from VoiceBase**

In `js/types.ts`, remove the `blend: BlendMode` field from `VoiceBase`:

```ts
export interface VoiceBase {
  id: string;
  x: NormalizedCoord;
  y: NormalizedCoord;
  size: NormalizedCoord;
  fill: Fill;
  effect: PatternType | undefined;
  border: Border | undefined;
}
```

- [ ] **Step 3: Add blend to SigilData**

In `js/types.ts`, add `blend` to `SigilData`:

```ts
export interface SigilData {
  envelope: Envelope;
  voices: Voice[];
  scene: number;
  blend: BlendMode;
}
```

- [ ] **Step 4: Run typecheck to see all compilation errors**

Run: `bun run check 2>&1 | head -80`

This will show every file that reads/writes `voice.blend` or expects `blend` on a voice — these are the files to fix in subsequent tasks. Do NOT fix them yet. Record the list.

- [ ] **Step 5: Commit type changes**

```bash
git add js/types.ts
git commit -m "feat: move blend from VoiceBase to SigilData, add exclusion mode"
```

---

### Task 2: Update effects.ts — new FM_PARAMS and remove DEFAULT_BLEND

**Files:**
- Modify: `js/effects.ts`

- [ ] **Step 1: Replace FM_PARAMS and remove DEFAULT_BLEND**

In `js/effects.ts`, replace the entire `FM_PARAMS` record and remove the `DEFAULT_BLEND` export:

```ts
// Remove this line:
// export const DEFAULT_BLEND: BlendMode = 'screen';

export const FM_PARAMS: Record<BlendMode, FMParams> = {
  screen: { maxIndex: 0, depthCurve: 'linear', feedback: 0, lfoRate: 0 },
  multiply: { maxIndex: 0.6, depthCurve: 'exponential', feedback: 0, lfoRate: 0 },
  exclusion: { maxIndex: 1.2, depthCurve: 'linear', feedback: 0, lfoRate: 0 },
  difference: { maxIndex: 1.8, depthCurve: 'linear', feedback: 0.2, lfoRate: 0 },
};
```

Also remove the `import type { BlendMode }` since it's now imported through the `FM_PARAMS` type — actually it's still needed for the `Record<BlendMode, FMParams>` type. Keep the import.

- [ ] **Step 2: Commit**

```bash
git add js/effects.ts
git commit -m "feat: update FM_PARAMS for 4 blend modes, remove DEFAULT_BLEND"
```

---

### Task 3: Update state.ts — add updateBlend, overlap tracking, remove per-voice blend default

**Files:**
- Modify: `js/state.ts`

- [ ] **Step 1: Add blend to createDefaultState**

In `js/state.ts`, update `createDefaultState`:

```ts
export function createDefaultState(): SigilData {
  return {
    blend: 'screen',
    envelope: { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
    scene: 0,
    voices: [],
  };
}
```

- [ ] **Step 2: Remove blend from createVoice**

In the `createVoice` function in `js/state.ts`, remove the `blend` field from the `base` object. Remove the `DEFAULT_BLEND` import:

```ts
import {
  type Envelope,
  type Fill,
  type NormalizedCoord,
  type SigilData,
  type Voice,
  type VoiceBase,
  type WaveformType,
  normalizedCoord,
} from './types.ts';
import { createRandomFill } from './colors.ts';
import { createVoice as registryCreateVoice } from './voices/registry.ts';

// ... genId unchanged ...

function createVoice(waveform: WaveformType, x: NormalizedCoord, y: NormalizedCoord): Voice {
  const base: VoiceBase = {
    border: undefined as Voice['border'],
    effect: undefined as Voice['effect'],
    fill: createRandomFill(),
    id: genId('v'),
    size: normalizedCoord(0.25),
    x,
    y,
  };
  return registryCreateVoice(waveform, base);
}
```

- [ ] **Step 3: Add updateBlend method and overlap tracking to SigilStore**

Add these imports at the top of `js/state.ts`:

```ts
import { signal } from '@preact/signals-core';
import { computeOverlap } from './effects.ts';
```

Wait — `signal` is already imported. Just add `computeOverlap`.

Add to the `SigilStore` class:

```ts
  private _hasOverlap = signal(false);

  /** Whether any pair of voices currently overlaps. */
  get hasOverlap(): boolean {
    return this._hasOverlap.value;
  }

  /** Set the global blend mode. Only meaningful when hasOverlap is true. */
  updateBlend(blend: BlendMode): void {
    this._data.value = { ...this._data.value, blend };
  }

  /** Recompute overlap and auto-reset blend to screen when no overlap exists. */
  private _recomputeOverlap(): void {
    const voices = this._data.value.voices;
    for (let i = 0; i < voices.length; i++) {
      for (let j = i + 1; j < voices.length; j++) {
        if (
          computeOverlap(
            voices[i]!.x as number,
            voices[i]!.y as number,
            voices[i]!.size as number,
            voices[j]!.x as number,
            voices[j]!.y as number,
            voices[j]!.size as number,
          ) > 0
        ) {
          this._hasOverlap.value = true;
          return;
        }
      }
    }
    // No overlap — auto-reset blend to screen
    if (this._data.value.blend !== 'screen') {
      this._data.value = { ...this._data.value, blend: 'screen' };
    }
    this._hasOverlap.value = false;
  }
```

Also add the `BlendMode` import to the types import line.

- [ ] **Step 4: Call _recomputeOverlap in mutation methods**

Add `this._recomputeOverlap()` at the end of these methods in `SigilStore`:
- `addVoice` — after pushing the new voice
- `removeVoice` — after filtering out the voice
- `updateVoice` — after the map update
- `pasteVoice` — after pushing the clone
- `loadState` — after setting the data

- [ ] **Step 5: Commit**

```bash
git add js/state.ts
git commit -m "feat: add global blend, overlap tracking with auto-reset to SigilStore"
```

---

### Task 4: Update serialization — pack blend in header, remove from SP5

**Files:**
- Modify: `js/serialize.ts`
- Modify: `js/voices/serializers/oscillator.ts`

- [ ] **Step 1: Update serialize.ts header packing**

In `js/serialize.ts`, update `packState` to pack blend into the scene char:

Replace:
```ts
  // Scene (1 char)
  out += encodeInt(state.scene, 1);
```

With:
```ts
  // Scene + blend (1 char): [blend(2b) | scene(4b)]
  const blendIndex = BLEND_MODES.indexOf(state.blend);
  out += encodeInt(((blendIndex & 0x3) << 4) | (state.scene & 0xf), 1);
```

Add `BLEND_MODES` to the imports from `./types.ts`.

- [ ] **Step 2: Update unpackState to read blend from header**

Replace:
```ts
  // Scene (1 char)
  const scene = decodeInt(str, idx++, 1);
```

With:
```ts
  // Scene + blend (1 char): [blend(2b) | scene(4b)]
  const sceneBlendChar = decodeInt(str, idx++, 1);
  const blend = BLEND_MODES[(sceneBlendChar >> 4) & 0x3] ?? 'screen';
  const scene = sceneBlendChar & 0xf;
```

Update the return at the bottom:
```ts
  return { blend, envelope, scene, voices };
```

- [ ] **Step 3: Remove blend from oscillator serializer SP5**

In `js/voices/serializers/oscillator.ts`:

Remove the `BLEND_MODES` import and `DEFAULT_BLEND` import. In the `pack` method, replace the SP5 line:

```ts
      // SP5: Effect (5b) + spare (7b) = 2 chars
      const eff = Math.max(0, EFFECT_KEYS.indexOf(voice.effect));
      out += encodeInt((eff & 0x1f) << 7, 2);
```

In the `unpack` method, replace the SP5 section:

```ts
      // SP5: Effect (5b) + spare (7b) = 2 chars
      const sp5 = decodeInt(registers, idx, 2);
      idx += 2;
      const effect = EFFECT_KEYS[(sp5 >> 7) & 0x1f];
```

Remove the `blend` field from the returned voice object. The return should no longer include `blend`:

```ts
      return {
        id: genId('v'),
        waveform,
        x,
        y,
        size,
        fill,
        effect,
        border,
        ...extraFields,
      } as Voice;
```

Remove the `BLEND_MODES` and `DEFAULT_BLEND` imports from the import block.

- [ ] **Step 4: Commit**

```bash
git add js/serialize.ts js/voices/serializers/oscillator.ts
git commit -m "feat: pack blend in header scene char, remove from per-voice SP5"
```

---

### Task 5: Update audio engine — read global blend for FM

**Files:**
- Modify: `js/audio/engine.ts`
- Modify: `js/audio/voice-builder.ts`
- Modify: `js/voices/types.ts`

- [ ] **Step 1: Remove currentBlend from AudioSharedNodes and AudioVoice**

In `js/voices/types.ts`, remove `currentBlend: BlendMode` from both `AudioSharedNodes` (line 27) and `AudioVoice` (line 49). Remove the `BlendMode` import.

- [ ] **Step 2: Remove currentBlend from voice-builder.ts**

In `js/audio/voice-builder.ts`, remove `currentBlend: voice.blend,` from the `shared` object (around line 134).

- [ ] **Step 3: Update engine.ts — remove per-voice blend change detection**

In `js/audio/engine.ts` around line 569-577, remove the blend comparison from the effect/blend/border change detection block. Replace:

```ts
      // Effect, blend, or border changed — tear down and rebuild the entire voice
      const borderKey = voice.border
        ? `${voice.border.color}:${voice.border.double ? 1 : 0}`
        : undefined;
      if (
        voice.effect !== audioVoice.currentEffect ||
        voice.blend !== audioVoice.currentBlend ||
        borderKey !== audioVoice.currentBorder
      ) {
```

With:

```ts
      // Effect or border changed — tear down and rebuild the entire voice
      const borderKey = voice.border
        ? `${voice.border.color}:${voice.border.double ? 1 : 0}`
        : undefined;
      if (
        voice.effect !== audioVoice.currentEffect ||
        borderKey !== audioVoice.currentBorder
      ) {
```

- [ ] **Step 4: Update _syncFMConnections to use global blend**

In `js/audio/engine.ts`, update `_syncFMConnections` to accept the global blend mode. Change the method signature:

```ts
  private _syncFMConnections(voices: readonly Voice[], blend: BlendMode, movedVoiceIds?: Set<string>): void {
```

Add `BlendMode` to the imports from `../types.ts`.

Inside the method, replace the per-voice blend lookup (around line 808):

```ts
        // Skip FM for blend modes with no modulation (e.g. screen)
        const params = FM_PARAMS[blend];
        if (params.maxIndex <= 0) continue;
```

And update `_createFMConnection` similarly (around line 883):

```ts
  private _createFMConnection(
    ctx: AudioContext,
    blend: BlendMode,
    modulatorAudio: AudioVoice,
    carrierAudio: AudioVoice,
  ): FMConnection {
    const params = FM_PARAMS[blend];
```

Remove the `modulatorData: Voice` parameter since it was only used for `modulatorData.blend`.

- [ ] **Step 5: Update all _syncFMConnections call sites**

There are 3 call sites in engine.ts:

1. In `play()` (around line 246):
   ```ts
   this._syncFMConnections(sigilState.voices, sigilState.blend);
   ```

2. In `syncState()` full sweep (around line 710):
   ```ts
   this._syncFMConnections(sigilState.voices, sigilState.blend);
   ```

3. In `syncState()` incremental (around line 712):
   ```ts
   this._syncFMConnections(sigilState.voices, sigilState.blend, movedVoiceIds);
   ```

Also update the `_createFMConnection` call inside `_syncFMConnections` (around line 845):
```ts
          conn = this._createFMConnection(ctx, blend, modulatorAudio, carrierAudio);
```

- [ ] **Step 6: Add blend change detection to syncState for full FM rebuild**

In `syncState()`, after the existing `voicesChanged` / `movedVoiceIds` FM sync block (around line 708-713), add blend change detection. Add a class field to track the last-synced blend:

```ts
  private _lastBlend: BlendMode = 'screen';
```

Then in `syncState()`, before the FM sync block, check for blend change:

```ts
    // Global blend change — full FM rebuild
    if (sigilState.blend !== this._lastBlend) {
      this._disposeFMConnections();
      this._syncFMConnections(sigilState.voices, sigilState.blend);
      this._lastBlend = sigilState.blend;
    } else if (voicesChanged) {
      this._disposeFMConnections();
      this._syncFMConnections(sigilState.voices, sigilState.blend);
    } else if (movedVoiceIds.size > 0) {
      this._syncFMConnections(sigilState.voices, sigilState.blend, movedVoiceIds);
    }
```

Also reset `_lastBlend` in `play()`:
```ts
    this._lastBlend = sigilState.blend;
```

- [ ] **Step 7: Commit**

```bash
git add js/audio/engine.ts js/audio/voice-builder.ts js/voices/types.ts
git commit -m "feat: read global blend for FM synthesis, remove per-voice blend tracking"
```

---

### Task 6: Update render.ts — use global blend

**Files:**
- Modify: `js/canvas/render.ts`

- [ ] **Step 1: Update reconcileVoice to use global blend**

In `js/canvas/render.ts`, update `reconcileVoice` to accept the global blend mode instead of reading per-voice blend. Change the signature:

```ts
function reconcileVoice(
  group: SVGGElement,
  voice: Voice,
  defs: SVGDefsElement,
  hasOverlap: boolean,
  globalBlend: string,
): void {
```

Replace the blend mode line (around line 253):
```ts
  group.style.mixBlendMode = hasOverlap ? globalBlend : 'screen';
```

Remove the `DEFAULT_BLEND` import from `../effects.ts`. Keep the `computeOverlap` import.

- [ ] **Step 2: Pass global blend through reconcileVoices**

Update `reconcileVoices` to accept `state: SigilData` (or just the blend) and pass it through. Change signature:

```ts
function reconcileVoices(
  voiceLayer: SVGGElement,
  state: SigilData,
  defs: SVGDefsElement,
  soloVoiceId: string | undefined,
): void {
```

Replace `voices` references with `state.voices` inside the function. Pass `state.blend` to `reconcileVoice`:

```ts
    reconcileVoice(group, voice, defs, overlapping.has(voice.id), state.blend);
```

- [ ] **Step 3: Update render() call to reconcileVoices**

In the `render()` function, change:
```ts
  reconcileVoices(voiceLayer, state.voices, defs, soloVoiceId);
```
to:
```ts
  reconcileVoices(voiceLayer, state, defs, soloVoiceId);
```

- [ ] **Step 4: Commit**

```bash
git add js/canvas/render.ts
git commit -m "feat: render uses global blend mode for overlapping voices"
```

---

### Task 7: Update toolbar — remove blend from fill panel

**Files:**
- Modify: `js/toolbar/fill-panel.ts`

- [ ] **Step 1: Remove blend buttons and handlers from fill panel**

In `js/toolbar/fill-panel.ts`:

1. Remove the `BlendMode` import from `../types.ts`
2. Remove the `DEFAULT_BLEND` import from `../effects.ts`
3. Remove the separator and two blend icon items from the `items()` return array (lines 185-197):
   ```ts
   // DELETE these lines:
   { type: 'separator' as const },
   {
     type: 'icon' as const,
     symbol: 'tabler-skull',
     title: 'Exponential FM',
     key: 'blend:multiply',
   },
   {
     type: 'icon' as const,
     symbol: 'tabler-spiral',
     title: 'Linear FM',
     key: 'blend:difference',
   },
   ```

4. Remove the blend key handling from `isActive()` (lines 205-208):
   ```ts
   // DELETE these lines:
   if (key?.startsWith('blend:')) {
     const blend = key.slice(6);
     return (getSelectedVoice(deps)?.blend ?? DEFAULT_BLEND) === blend;
   }
   ```

5. Remove the blend key handling from `onClick()` (lines 212-221):
   ```ts
   // DELETE these lines:
   if (key?.startsWith('blend:')) {
     const voice = getSelectedVoice(deps);
     if (!voice) return;
     deps.undo.snapshot();
     const mode = key.slice(6) as BlendMode;
     deps.store.updateVoice(voice.id, {
       blend: voice.blend === mode ? DEFAULT_BLEND : mode,
     });
     return;
   }
   ```

- [ ] **Step 2: Commit**

```bash
git add js/toolbar/fill-panel.ts
git commit -m "feat: remove per-voice blend controls from fill panel"
```

---

### Task 8: Add global blend toolbar button

**Files:**
- Modify: `index.html`
- Modify: `js/toolbar/toolbar.ts`

- [ ] **Step 1: Add blend button to index.html**

In `index.html`, add a blend button near the other global action buttons. Find the harmonize button area (around line 50) and add the blend button after `btn-harmonize`:

```html
            <button id="btn-blend" class="action-btn" title="FM Blend" disabled>
              <svg class="icon"><use href="#tabler-layers-intersect"></use></svg>
            </button>
```

The button starts `disabled` because on fresh load there's no overlap.

- [ ] **Step 2: Wire blend button in toolbar.ts**

In `js/toolbar/toolbar.ts`, add blend mode cycling logic. Import the needed types:

```ts
import { BLEND_MODES, type BlendMode } from '../types.ts';
```

In the `Toolbar` constructor, after the panel binding section, add:

```ts
    // Global blend mode button — cycles through blend modes
    const btnBlend = qel<HTMLButtonElement>('#btn-blend');
    btnBlend.addEventListener('click', () => {
      if (!this.store.hasOverlap) return;
      this.undo.snapshot();
      const current = this.store.data.blend;
      const idx = BLEND_MODES.indexOf(current);
      const next = BLEND_MODES[(idx + 1) % BLEND_MODES.length]!;
      this.store.updateBlend(next);
    });

    // Enable/disable blend button based on overlap
    effect(() => {
      const has = this.store.hasOverlap;
      btnBlend.disabled = !has;
      btnBlend.classList.toggle('active', has && this.store.data.blend !== 'screen');
    });
```

Add `effect` to the imports from `@preact/signals-core` if not already imported.

- [ ] **Step 3: Add blend button tooltip update**

Update the effect to show the current mode in the tooltip:

```ts
    effect(() => {
      const has = this.store.hasOverlap;
      const blend = this.store.data.blend;
      btnBlend.disabled = !has;
      btnBlend.classList.toggle('active', has && blend !== 'screen');
      btnBlend.title = has ? `FM Blend: ${blend}` : 'FM Blend (no overlap)';
    });
```

- [ ] **Step 4: Commit**

```bash
git add index.html js/toolbar/toolbar.ts
git commit -m "feat: add global blend toolbar button with overlap-gated enable"
```

---

### Task 9: Update harmony.ts — remove per-voice blend, add global blend

**Files:**
- Modify: `js/harmony.ts`

- [ ] **Step 1: Remove per-voice blend from randomizer**

In `js/harmony.ts`:

1. Remove `BLEND_MODES` from the imports.
2. Remove the per-voice blend randomization block (around lines 234-237):
   ```ts
   // DELETE these lines:
   // 50% chance of a random blend mode
   if (Math.random() < 0.5) {
     updates.blend = BLEND_MODES[Math.floor(Math.random() * BLEND_MODES.length)]!;
   }
   ```

3. After the `applyScale(store, scale)` call at the end of `randomize()`, add global blend randomization. The overlap tracker will auto-reset if no overlap:
   ```ts
   // Random global blend — overlap tracker will auto-reset to screen if no overlap
   const ACTIVE_BLENDS: BlendMode[] = ['screen', 'multiply', 'exclusion', 'difference'];
   store.updateBlend(ACTIVE_BLENDS[Math.floor(Math.random() * ACTIVE_BLENDS.length)]!);
   ```

   Add `BlendMode` to the imports from `./types.ts`.

- [ ] **Step 2: Commit**

```bash
git add js/harmony.ts
git commit -m "feat: randomizer sets global blend instead of per-voice"
```

---

### Task 10: Update tutorial.ts — use global blend

**Files:**
- Modify: `js/tutorial.ts`

- [ ] **Step 1: Update the blend tutorial step**

In `js/tutorial.ts`, find the blend modes step (around line 348-391). Update the play substeps to use global blend via `ctx.store.updateBlend()` instead of per-voice blend updates:

Replace substep 2 (around lines 374-381):
```ts
      (ctx: StepContext) => {
        if (ctx.demo.tri)
          ctx.store.updateVoice(ctx.demo.tri, { x: ctx.nc(0.45) });
        if (ctx.demo.sq) ctx.store.updateVoice(ctx.demo.sq, { x: ctx.nc(0.5) });
        if (ctx.demo.circ)
          ctx.store.updateVoice(ctx.demo.circ, { x: ctx.nc(0.55) });
        ctx.store.updateBlend('multiply');
        ctx.render();
        ctx.playLatched();
      },
```

Replace substep 3 (around lines 383-389):
```ts
      (ctx: StepContext) => {
        ctx.store.updateBlend('difference');
        ctx.render();
        ctx.playLatched();
      },
```

- [ ] **Step 2: Commit**

```bash
git add js/tutorial.ts
git commit -m "feat: tutorial uses global blend mode"
```

---

### Task 11: Fix remaining compilation errors

**Files:**
- Possibly: any file still referencing `voice.blend` or `DEFAULT_BLEND`

- [ ] **Step 1: Run typecheck and fix all remaining errors**

Run: `bun run check`

Fix any remaining type errors. Common issues:
- Tests creating voice fixtures with `blend` field — remove the field
- Any file importing `DEFAULT_BLEND` — replace with literal `'screen'` or use `store.data.blend`
- Any file reading `voice.blend` — should now be `state.blend` or `store.data.blend`

- [ ] **Step 2: Run lint and format**

Run: `bun run lint && bun run fmt`

- [ ] **Step 3: Commit all fixes**

```bash
git add -A
git commit -m "fix: resolve remaining type errors from blend migration"
```

---

### Task 12: Update tests — serialization

**Files:**
- Modify: `tests/unit/serialize.test.js`
- Modify: `tests/unit/serialize-v2.test.js`

- [ ] **Step 1: Update serialize.test.js**

In `tests/unit/serialize.test.js`:

Update `makeVoice` to remove `blend`:
```js
function makeVoice(overrides = {}) {
  return {
    border: undefined,
    effect: undefined,
    fill: { h: 200, l: 50, mode: 'solid', s: 80 },
    id: 'test1',
    size: 0.5,
    waveform: 'sine',
    x: 0.5,
    y: 0.5,
    ...overrides,
  };
}
```

Update `makeState` to include `blend`:
```js
function makeState(overrides = {}) {
  return {
    blend: 'screen',
    envelope: { attack: 0.571, decay: 0.571, release: 1.286, sustain: 0.571 },
    scene: 0,
    voices: [],
    ...overrides,
  };
}
```

Replace the "all blend modes survive round-trip" test (lines 142-151) with a global blend round-trip test:
```js
  test('all global blend modes survive round-trip', () => {
    const blends = ['screen', 'multiply', 'exclusion', 'difference'];
    for (const blend of blends) {
      const state = makeState({ blend, voices: [makeVoice()] });
      const decoded = deserializeState(serializeState(state));
      expect(decoded.blend).toBe(blend);
    }
  });
```

Update the "scene index survives round-trip" test to only test valid 4-bit scene indices (0-15, not 63):
```js
  test('scene index survives round-trip', () => {
    for (const scene of [0, 5, 11, 15]) {
      const state = makeState({ scene });
      const decoded = deserializeState(serializeState(state));
      expect(decoded.scene).toBe(scene);
    }
  });
```

Add a backwards compatibility test:
```js
  test('old v2 URLs decode blend as screen (backwards compatible)', () => {
    // Old URLs have scene char with top 2 bits = 0, which decodes as blend index 0 = screen
    const state = makeState({ voices: [makeVoice()] });
    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);
    expect(decoded.blend).toBe('screen');
  });
```

- [ ] **Step 2: Update serialize-v2.test.js**

In `tests/unit/serialize-v2.test.js`:

Update `makeVoice` to remove `blend`:
```js
function makeVoice(overrides = {}) {
  return {
    border: undefined,
    effect: undefined,
    fill: { h: 200, l: 50, mode: 'solid', s: 80 },
    id: 'test1',
    size: 0.5,
    waveform: 'sine',
    x: 0.5,
    y: 0.5,
    ...overrides,
  };
}
```

Remove the "all blend modes survive" test (lines 139-145) from the OscillatorSerializer section entirely — blend is no longer in per-voice registers.

- [ ] **Step 3: Run tests**

Run: `bun run test:unit`

- [ ] **Step 4: Commit**

```bash
git add tests/unit/serialize.test.js tests/unit/serialize-v2.test.js
git commit -m "test: update serialization tests for global blend"
```

---

### Task 13: Update tests — state.test.js

**Files:**
- Modify: `tests/unit/state.test.js`

- [ ] **Step 1: Replace per-voice blend tests with global blend tests**

In `tests/unit/state.test.js`, replace the entire `SigilStore blend mode` describe block (lines 175-204) with:

```js
describe('SigilStore global blend', () => {
  test('default state has screen blend', () => {
    const store = new SigilStore();
    expect(store.data.blend).toBe('screen');
  });

  test('updateBlend sets global blend mode', () => {
    const store = new SigilStore();
    store.updateBlend('multiply');
    expect(store.data.blend).toBe('multiply');
  });

  test('blend persists through undo/redo', () => {
    const store = new SigilStore();
    const undo = new UndoManager(store);
    undo.snapshot();
    store.updateBlend('difference');

    expect(store.data.blend).toBe('difference');
    undo.undo();
    expect(store.data.blend).toBe('screen');
    undo.redo();
    expect(store.data.blend).toBe('difference');
  });
});

describe('SigilStore overlap tracking', () => {
  test('hasOverlap is false with no voices', () => {
    const store = new SigilStore();
    expect(store.hasOverlap).toBe(false);
  });

  test('hasOverlap is false with non-overlapping voices', () => {
    const store = new SigilStore();
    store.addVoice('sine', 0.1, 0.1);
    store.addVoice('sine', 0.9, 0.9);
    expect(store.hasOverlap).toBe(false);
  });

  test('hasOverlap is true when voices overlap', () => {
    const store = new SigilStore();
    store.addVoice('sine', 0.5, 0.5);
    store.addVoice('sine', 0.5, 0.5);
    expect(store.hasOverlap).toBe(true);
  });

  test('blend auto-resets to screen when overlap disappears', () => {
    const store = new SigilStore();
    const v1 = store.addVoice('sine', 0.5, 0.5);
    store.addVoice('sine', 0.5, 0.5);
    store.updateBlend('multiply');
    expect(store.data.blend).toBe('multiply');

    // Move voice away so no overlap
    store.updateVoice(v1.id, { x: 0.0, y: 0.0 });
    expect(store.hasOverlap).toBe(false);
    expect(store.data.blend).toBe('screen');
  });

  test('hasOverlap updates when voice is removed', () => {
    const store = new SigilStore();
    store.addVoice('sine', 0.5, 0.5);
    const v2 = store.addVoice('sine', 0.5, 0.5);
    expect(store.hasOverlap).toBe(true);

    store.removeVoice(v2.id);
    expect(store.hasOverlap).toBe(false);
  });
});
```

- [ ] **Step 2: Remove voice.blend references from other tests**

Check that no other test in state.test.js references `voice.blend`. If there were, they'd already fail from the type change.

- [ ] **Step 3: Run tests**

Run: `bun run test:unit -- tests/unit/state.test.js`

- [ ] **Step 4: Commit**

```bash
git add tests/unit/state.test.js
git commit -m "test: replace per-voice blend tests with global blend and overlap tracking tests"
```

---

### Task 14: Update or delete blend-specific tests

**Files:**
- Delete: `tests/integration/blend-combinations.test.js`
- Rewrite: `tests/unit/blend-visual.test.js`

- [ ] **Step 1: Delete blend-combinations.test.js**

```bash
rm tests/integration/blend-combinations.test.js
```

Cross-mode pair tests no longer apply — all voices share one global mode.

- [ ] **Step 2: Rewrite blend-visual.test.js for 4 global modes**

Replace the entire file `tests/unit/blend-visual.test.js`:

```js
// blend-visual.test.js — Verify that all 4 blend modes produce
// visually distinct colors at the overlap region.

import { describe, expect, test } from 'bun:test';

const BLEND_MODES = ['screen', 'multiply', 'exclusion', 'difference'];

const COLOR_A = { r: 200, g: 80, b: 60 };
const COLOR_B = { r: 60, g: 120, b: 200 };

function blendChannel(a, b, mode) {
  const an = a / 255;
  const bn = b / 255;
  let result;
  switch (mode) {
    case 'screen':
      result = 1 - (1 - an) * (1 - bn);
      break;
    case 'multiply':
      result = an * bn;
      break;
    case 'exclusion':
      result = an + bn - 2 * an * bn;
      break;
    case 'difference':
      result = Math.abs(an - bn);
      break;
    default:
      result = an;
  }
  return Math.round(result * 255);
}

function blendColors(colorA, colorB, mode) {
  return {
    r: blendChannel(colorA.r, colorB.r, mode),
    g: blendChannel(colorA.g, colorB.g, mode),
    b: blendChannel(colorA.b, colorB.b, mode),
  };
}

function colorKey(c) {
  return `${c.r},${c.g},${c.b}`;
}

describe('blend mode visual distinctness', () => {
  test('all blend operations are commutative', () => {
    for (const mode of BLEND_MODES) {
      const ab = blendColors(COLOR_A, COLOR_B, mode);
      const ba = blendColors(COLOR_B, COLOR_A, mode);
      expect(ab).toEqual(ba);
    }
  });

  test('all 4 blend modes produce distinct overlap colors', () => {
    const colors = new Map();
    for (const mode of BLEND_MODES) {
      const c = blendColors(COLOR_A, COLOR_B, mode);
      const key = colorKey(c);
      expect(colors.has(key)).toBe(false);
      colors.set(key, mode);
    }
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun run test:unit -- tests/unit/blend-visual.test.js`

- [ ] **Step 4: Commit**

```bash
git add tests/unit/blend-visual.test.js
git rm tests/integration/blend-combinations.test.js
git commit -m "test: rewrite blend visual tests for 4 global modes, delete cross-mode e2e"
```

---

### Task 15: Fix remaining test fixtures and run full test suite

**Files:**
- Modify: any test files with `blend` in voice fixtures

- [ ] **Step 1: Grep for remaining voice blend references in tests**

Run: `grep -rn "blend" tests/`

Fix any remaining references to `voice.blend` or `blend:` in test fixtures. Common patterns:
- `makeVoice({ blend: ... })` → remove the `blend` field
- `expect(voice.blend)` → remove or change to `expect(state.blend)`
- Import of `DEFAULT_BLEND` → remove

- [ ] **Step 2: Run full test suite**

Run: `bun run test:unit`

Fix any failures.

- [ ] **Step 3: Run typecheck and lint**

Run: `bun run check && bun run lint && bun run fmt`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: fix remaining blend references in test fixtures"
```

---

### Task 16: Run e2e tests and verify

**Files:** none (verification only)

- [ ] **Step 1: Start dev server**

Run: `bun run dev &`

- [ ] **Step 2: Run e2e tests**

Run: `bun run test:e2e`

- [ ] **Step 3: Fix any failures**

If e2e tests reference per-voice blend behavior, update them.

- [ ] **Step 4: Stop dev server and commit any fixes**

```bash
kill %1
git add -A && git commit -m "fix: e2e test adjustments for global blend"
```

---

### Task 17: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Voice Fields table**

In the Voice Fields table in CLAUDE.md, remove the `blend` row from the voice fields and add a note about global blend in the top-level state section. Replace the `blend` row:

```
| `blend` | CSS `mix-blend-mode` | cross-voice FM synthesis (see below) |
```

With a note in the Architecture section or a new row at the SigilData level:

In the "State & Transforms" section, after describing the three domains, add:
```
**Global blend mode** (`SigilData.blend`): one of 4 commutative CSS
`mix-blend-mode` values (`screen`, `multiply`, `exclusion`, `difference`)
applied to all overlapping voice groups. Drives FM synthesis depth/character
for overlapping pairs. Auto-resets to `screen` when no voices overlap.
```

Also remove `blend` from the "Serialization policy" or voice field list.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for global blend mode"
```
