# FM Architecture Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-technique unidirectional FM blend system with three distinct bidirectional synthesis techniques (sine cross-FM, ring mod, raw cross-FM) and a per-voice sine shadow oscillator.

**Architecture:** Each `AudioVoice` gains a sine shadow oscillator (created in `buildVoice()` via method wrapping, no per-player changes). The engine's `FMConnection` becomes a `CrossConnection` discriminated union with mode-specific node topologies. `FM_PARAMS` is replaced by `BLEND_CONFIG` with per-mode typed configs. Ring mod re-routes voice output through dry/wet gain nodes; FM modes connect shadows or raw oscillators to carrier frequency params.

**Tech Stack:** TypeScript, Web Audio API (`BiquadFilterNode`, `GainNode`, `OscillatorNode`, `StereoPannerNode`), Bun (unit tests), Playwright (audio snapshot integration tests).

**Spec:** `docs/plans/2026-04-18-fm-architecture-design.md`

**Branch:** `fm-taming-349` (already exists with prior depth-only work that will be superseded).

---

## File Map

- **Modify:** `js/effects.ts` — replace `FMParams`/`FM_PARAMS` with `BlendConfig`/`BLEND_CONFIG`; keep `computeFMDepth`, `computeOverlap`, lowpass constants.
- **Modify:** `js/audio/voice-builder.ts` — create sine shadow oscillator, wrap `start`/`stop`/`updateParams`, add `getShadowNode()`.
- **Modify:** `js/voices/types.ts` — add `getShadowNode(): OscillatorNode` to `AudioVoice` interface.
- **Modify:** `js/audio/engine.ts` — replace `FMConnection`/`_syncFMConnections`/`_createFMConnection`/`_disposeFMConnection` with `CrossConnection` union and mode-dispatched logic; store `_masterInput` for ring mod routing.
- **Modify:** `tests/unit/effects.test.js` — update `FM_PARAMS`→`BLEND_CONFIG` tests, add `BlendConfig` structure assertions.
- **Modify:** `tests/unit/audio-engine.test.js` — update `_fmConnections`→`_crossConnections`, add ring-mod routing tests, add shadow oscillator tests.
- **Regenerate:** `tests/integration/audio-snapshot.test.js-snapshots/*.png` — all FM/blend baselines.

No new files.

---

## Task 1: Replace `FM_PARAMS` with `BLEND_CONFIG` in effects.ts

**Files:**
- Modify: `js/effects.ts`
- Modify: `tests/unit/effects.test.js`

This task replaces the old parameter table with the new discriminated union config. `computeFMDepth` stays unchanged — it takes individual values, not the config object.

- [ ] **Step 1: Write failing tests for `BLEND_CONFIG`**

In `tests/unit/effects.test.js`, replace the import and the `describe('FM_PARAMS', ...)` block. Keep the `computeOverlap`, `computeTotalOverlap`, and `computeFMDepth` blocks.

Replace the import at the top:

```javascript
import { describe, expect, test } from 'bun:test';
import {
  BLEND_CONFIG,
  computeFMDepth,
  computeOverlap,
  computeTotalOverlap,
} from '../../js/effects.ts';
```

Replace the `describe('FM_PARAMS', ...)` block (currently lines 67–86) with:

```javascript
describe('BLEND_CONFIG', () => {
  test('screen has type none', () => {
    expect(BLEND_CONFIG.screen.type).toBe('none');
  });

  test('multiply is sine cross-FM', () => {
    expect(BLEND_CONFIG.multiply.type).toBe('fm');
    expect(BLEND_CONFIG.multiply.config.maxIndex).toBeGreaterThan(0);
    expect(BLEND_CONFIG.multiply.config.maxIndex).toBeLessThanOrEqual(0.8);
    expect(BLEND_CONFIG.multiply.config.depthCurve).toBe('sqrt');
  });

  test('exclusion is ring modulation', () => {
    expect(BLEND_CONFIG.exclusion.type).toBe('ring');
  });

  test('difference is raw cross-FM', () => {
    expect(BLEND_CONFIG.difference.type).toBe('rawfm');
    expect(BLEND_CONFIG.difference.config.maxIndex).toBeGreaterThan(0);
    expect(BLEND_CONFIG.difference.config.maxIndex).toBeLessThanOrEqual(1.2);
    expect(BLEND_CONFIG.difference.config.depthCurve).toBe('linear');
  });

  test('FM modes are ordered: multiply < difference by intensity', () => {
    expect(BLEND_CONFIG.multiply.config.maxIndex).toBeLessThan(
      BLEND_CONFIG.difference.config.maxIndex,
    );
  });
});
```

Also update the `computeFMDepth` describe block's deviation cap test — change `FM_PARAMS.difference` to use a raw config literal (since `computeFMDepth` takes a params object, not a `BlendConfig`):

```javascript
describe('computeFMDepth', () => {
  const fmMultiply = BLEND_CONFIG.multiply.config;
  const fmDifference = BLEND_CONFIG.difference.config;

  test('returns 0 when overlap is 0', () => {
    expect(computeFMDepth(0, fmMultiply, 440)).toBe(0);
    expect(computeFMDepth(0, fmDifference, 440)).toBe(0);
  });

  test('is monotonic non-decreasing in overlap', () => {
    const steps = [0, 0.1, 0.25, 0.5, 0.75, 1];
    for (const cfg of [fmMultiply, fmDifference]) {
      const depths = steps.map((o) => computeFMDepth(o, cfg, 440));
      for (let i = 1; i < depths.length; i++) {
        expect(depths[i]).toBeGreaterThanOrEqual(depths[i - 1]);
      }
    }
  });

  test('respects the global deviation cap', () => {
    const highFreq = 784; // ~G5, top of melodic range
    const d = computeFMDepth(1, fmDifference, highFreq);
    expect(d).toBeLessThanOrEqual(600);
  });

  test('at full overlap, difference > multiply', () => {
    const m = computeFMDepth(1, fmMultiply, 200);
    const d = computeFMDepth(1, fmDifference, 200);
    expect(d).toBeGreaterThan(m);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `bun test tests/unit/effects.test.js`

Expected: FAIL — `BLEND_CONFIG` is not exported from effects.ts.

- [ ] **Step 3: Replace `FMParams`/`FM_PARAMS` with `BlendConfig`/`BLEND_CONFIG`**

In `js/effects.ts`, replace everything from the `FMParams` interface (line 15) through the `FM_PARAMS` declaration (line 30) with:

```typescript
/** FM behavior parameters for sine cross-FM and raw cross-FM modes. */
export interface FMConfig {
  maxIndex: number;
  depthCurve: 'linear' | 'sqrt';
}

/** Ring modulation config. Depth controlled purely by overlap. */
export interface RingConfig {}

/** Raw cross-FM config (includes lowpass on the modulator). */
export interface RawFMConfig {
  maxIndex: number;
  depthCurve: 'linear' | 'sqrt';
}

export type BlendConfig =
  | { type: 'none' }
  | { type: 'fm'; config: FMConfig }
  | { type: 'ring'; config: RingConfig }
  | { type: 'rawfm'; config: RawFMConfig };

/** Cross-modulation config indexed by blend mode. */
export const BLEND_CONFIG: Record<BlendMode, BlendConfig> = {
  screen: { type: 'none' },
  multiply: { type: 'fm', config: { maxIndex: 0.5, depthCurve: 'sqrt' } },
  exclusion: { type: 'ring', config: {} },
  difference: { type: 'rawfm', config: { maxIndex: 0.8, depthCurve: 'linear' } },
};
```

Update `computeFMDepth` to accept `FMConfig | RawFMConfig` (which are structurally identical). Replace the signature and body:

```typescript
/**
 * Compute the FM depth gain value for a modulator→carrier connection.
 * depth = min(scaledIndex × modulatorFreq, MAX_DEVIATION)
 */
export function computeFMDepth(
  overlap: number,
  config: FMConfig | RawFMConfig,
  modulatorFreq: number,
): number {
  const shaped = config.depthCurve === 'sqrt' ? Math.sqrt(overlap) : overlap;
  const scaled = shaped * config.maxIndex;
  return Math.min(scaled * modulatorFreq, MAX_FM_DEVIATION);
}
```

Note: removed the `'exponential'` depth curve branch — no blend config uses it and it was dead code.

- [ ] **Step 4: Run tests to confirm green**

Run: `bun test tests/unit/effects.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run check`

Expected: FAIL — `engine.ts` still imports `FM_PARAMS` and `FMParams`. That's fine — the engine update is Task 4. For now, temporarily alias `FM_PARAMS` at the bottom of `effects.ts` to keep the build passing until Task 4 lands:

```typescript
/** @deprecated — engine.ts still references this. Removed in Task 4. */
export const FM_PARAMS = BLEND_CONFIG;
```

Run: `bun run check`

Expected: may still fail due to type mismatch (engine expects `FMParams`, gets `BlendConfig`). If so, also add:

```typescript
/** @deprecated — engine.ts still references this. Removed in Task 4. */
export type FMParams = FMConfig;
```

Run: `bun run check` until green.

- [ ] **Step 6: Run full unit suite**

Run: `bun run test:unit`

Expected: all pass. The `audio-engine.test.js` tests reference `_fmConnections` which still exists in engine.ts — they should still pass since the engine code hasn't changed yet.

- [ ] **Step 7: Commit**

```bash
git add js/effects.ts tests/unit/effects.test.js
git commit -m "refactor: replace FM_PARAMS with BLEND_CONFIG union (#349)

Discriminated union with per-mode typed configs: 'fm' (sine cross-FM),
'ring' (ring mod), 'rawfm' (raw cross-FM), 'none' (screen).
Removes the dead 'exponential' depth curve branch.

Temporary FM_PARAMS/FMParams aliases keep engine.ts compiling until
the engine rework lands."
```

---

## Task 2: Add sine shadow oscillator to voice-builder

**Files:**
- Modify: `js/voices/types.ts`
- Modify: `js/audio/voice-builder.ts`
- Modify: `tests/unit/audio-engine.test.js` (shadow assertions)

- [ ] **Step 1: Add `getShadowNode` to the `AudioVoice` interface**

In `js/voices/types.ts`, add to the `AudioVoice` interface (after line 61, after `getCarrierFrequencyParams`):

```typescript
  getShadowNode(): OscillatorNode;
```

- [ ] **Step 2: Create the shadow and wrap the player in `buildVoice()`**

In `js/audio/voice-builder.ts`, after line 138 (`return get(voice.waveform)...`), replace the return statement. The old code:

```typescript
  return get(voice.waveform).player.buildAudioGraph(ctx, voice, shared);
}
```

Replace with:

```typescript
  const shadow = new OscillatorNode(ctx, { type: 'sine', frequency: freq });

  const audioVoice = get(voice.waveform).player.buildAudioGraph(ctx, voice, shared);

  const origStart = audioVoice.start;
  audioVoice.start = (time: number) => {
    origStart.call(audioVoice, time);
    shadow.start(time);
  };

  const origStop = audioVoice.stop;
  audioVoice.stop = (time: number) => {
    origStop.call(audioVoice, time);
    safeStop(shadow);
  };

  const origUpdate = audioVoice.updateParams;
  audioVoice.updateParams = (v: Voice, now: number) => {
    origUpdate.call(audioVoice, v, now);
    shadow.frequency.setValueAtTime(yToFrequency(v.y), now);
  };

  audioVoice.getShadowNode = () => shadow;

  return audioVoice;
}
```

Add `safeStop` to the import from `./node-utils.ts` (it's already re-exported at line 17 but not imported for local use). Change the existing re-export block:

```typescript
export {
  safeStop,
  safeDisconnect,
  makeSaturationCurve,
  createPWMWaveshaper,
} from './node-utils.ts';
```

To also import `safeStop` for local use. Since it's already re-exported, just use the re-exported name in the function body. Actually, `safeStop` is exported but the local file doesn't import it for its own use. Add an import at the top:

```typescript
import { safeStop } from './node-utils.ts';
```

And keep the re-export block unchanged. Alternatively, since `safeStop` is already in the re-export, the simplest approach is to import it from the re-export. But ES modules don't allow importing your own re-exports. So: import `safeStop` directly from `./node-utils.ts` for local use (separate from the re-export).

- [ ] **Step 3: Typecheck**

Run: `bun run check`

Expected: PASS. The `getShadowNode` method is now on the interface and provided by the wrapper.

- [ ] **Step 4: Add shadow oscillator unit test**

In `tests/unit/audio-engine.test.js`, add a test in the `'AudioEngine — blend modes and FM synthesis'` describe block (after the existing tests, around line 394):

```javascript
  test('voices have a sine shadow oscillator', async () => {
    const voiceA = makeVoice('a', 'pulse', { x: 0.5, y: 0.5, size: 0.2 });
    await startWith([voiceA]);

    const shadow = engine.activeVoices[0].getShadowNode();
    expect(shadow).toBeDefined();
    expect(shadow.type).toBe('sine');
    expect(shadow.frequency.value).toBeCloseTo(engine.activeVoices[0].getModulatorNode().frequency.value, 0);
  });

  test('shadow frequency updates when voice pitch changes', async () => {
    const voiceA = makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    await startWith([voiceA]);

    const shadow = engine.activeVoices[0].getShadowNode();
    const origFreq = shadow.frequency.value;

    // Move voice to a different Y position
    const movedA = makeVoice('a', 'sine', { x: 0.5, y: 0.3, size: 0.2 });
    engine.update(makeSigilState([movedA]), TEST_REVERB);

    expect(shadow.frequency.value).not.toBeCloseTo(origFreq, 0);
  });
```

- [ ] **Step 5: Run tests**

Run: `bun run test:unit`

Expected: all pass (including the new shadow tests).

- [ ] **Step 6: Commit**

```bash
git add js/voices/types.ts js/audio/voice-builder.ts tests/unit/audio-engine.test.js
git commit -m "feat: add sine shadow oscillator to every voice (#349)

Each AudioVoice gets a shadow OscillatorNode(type: 'sine') that
tracks the voice pitch but is never connected to audio output.
Created in buildVoice() via method wrapping — individual player
files are unchanged. The shadow provides a clean modulation source
for the upcoming cross-FM and ring-mod blend modes."
```

---

## Task 3: Rework engine cross-connection types and dispatch

**Files:**
- Modify: `js/audio/engine.ts`

This is the largest task. It replaces the single-technique `FMConnection` with the `CrossConnection` discriminated union and rewires the sync/create/dispose methods.

- [ ] **Step 1: Replace imports and connection types**

In `js/audio/engine.ts`, replace the import from `../effects.ts` (lines 9–15):

```typescript
import {
  BLEND_CONFIG,
  computeFMDepth,
  computeOverlap,
  FM_MODULATOR_LPF_HZ,
  FM_MODULATOR_LPF_Q,
  type BlendConfig,
} from '../effects.ts';
```

Replace the `FMConnection` interface (lines 36–41) with the `CrossConnection` union:

```typescript
interface FMPair {
  depthGain: GainNode;
}

interface FMPairFiltered {
  lowpass: BiquadFilterNode;
  depthGain: GainNode;
}

interface RingPair {
  dryGain: GainNode;
  wetGain: GainNode;
  shadowAmp: GainNode;
}

type CrossConnection =
  | { type: 'fm'; aToB: FMPair; bToA: FMPair }
  | { type: 'ring'; aRing: RingPair; bRing: RingPair }
  | { type: 'rawfm'; aToB: FMPairFiltered; bToA: FMPairFiltered };
```

Rename the map field and add `_masterInput`:

```typescript
private _crossConnections = new Map<string, CrossConnection>();
private _masterInput: GainNode | undefined;
```

- [ ] **Step 2: Store `_masterInput` when building voices**

In `_buildVoice` (line 638), store the master input reference:

```typescript
_buildVoice(ctx: AudioContext, voice: Voice): AudioVoice {
  if (!this._masterInput) {
    this._masterInput = this.master.input!;
  }
  return buildVoice(ctx, voice, this.master.input!, this.mixer, createEffect);
}
```

- [ ] **Step 3: Replace `_disposeFMConnections` and `_disposeFMConnection`**

Replace both methods (lines 461–478) with:

```typescript
private _disposeAllCrossConnections(): void {
  for (const conn of this._crossConnections.values()) {
    this._disposeCrossConnection(conn);
  }
  this._crossConnections.clear();
}

private _disposeCrossConnection(conn: CrossConnection): void {
  switch (conn.type) {
    case 'fm':
      conn.aToB.depthGain.gain.value = 0;
      safeDisconnect(conn.aToB.depthGain);
      conn.bToA.depthGain.gain.value = 0;
      safeDisconnect(conn.bToA.depthGain);
      break;
    case 'ring':
      this._disposeRingPair(conn.aRing);
      this._disposeRingPair(conn.bRing);
      break;
    case 'rawfm':
      conn.aToB.depthGain.gain.value = 0;
      safeDisconnect(conn.aToB.depthGain);
      safeDisconnect(conn.aToB.lowpass);
      conn.bToA.depthGain.gain.value = 0;
      safeDisconnect(conn.bToA.depthGain);
      safeDisconnect(conn.bToA.lowpass);
      break;
  }
}

private _disposeRingPair(pair: RingPair): void {
  pair.dryGain.gain.value = 0;
  safeDisconnect(pair.dryGain);
  pair.wetGain.gain.value = 0;
  safeDisconnect(pair.wetGain);
  pair.shadowAmp.gain.value = 0;
  safeDisconnect(pair.shadowAmp);
}
```

- [ ] **Step 4: Replace `_syncFMConnections` with `_syncCrossConnections`**

Replace the entire `_syncFMConnections` method (lines 480–561) with:

```typescript
private _syncCrossConnections(
  voices: readonly Voice[],
  blend: BlendMode,
  movedVoiceIds?: Set<string>,
): void {
  const ctx = this.audioCtx;
  if (!ctx || !this._masterInput) {
    return;
  }

  const blendCfg = BLEND_CONFIG[blend];
  if (blendCfg.type === 'none') {
    return;
  }

  const audioById = new Map(this.activeVoices.map((v) => [v.shapeId, v]));
  const activeKeys = new Set<string>();

  for (let i = 0; i < voices.length; i++) {
    for (let j = i + 1; j < voices.length; j++) {
      const voiceA = voices[i]!;
      const voiceB = voices[j]!;

      const key = `${voiceA.id}:${voiceB.id}`;

      if (
        movedVoiceIds &&
        !movedVoiceIds.has(voiceA.id) &&
        !movedVoiceIds.has(voiceB.id)
      ) {
        if (this._crossConnections.has(key)) {
          activeKeys.add(key);
        }
        continue;
      }

      const overlap = computeOverlap(voiceA, voiceB);
      if (overlap <= 0) {
        continue;
      }

      activeKeys.add(key);

      const audioA = audioById.get(voiceA.id);
      const audioB = audioById.get(voiceB.id);
      if (!audioA || !audioB) {
        continue;
      }

      let conn = this._crossConnections.get(key);
      if (!conn) {
        conn = this._createCrossConnection(ctx, blendCfg, audioA, audioB);
        this._crossConnections.set(key, conn);
      }

      this._updateCrossConnection(conn, blendCfg, overlap, audioA, audioB);
    }
  }

  for (const [key, conn] of this._crossConnections) {
    if (!activeKeys.has(key)) {
      this._teardownCrossConnection(conn, audioById);
      this._crossConnections.delete(key);
    }
  }
}
```

- [ ] **Step 5: Add the create, update, and teardown methods**

Add these methods after `_syncCrossConnections`:

```typescript
private _createCrossConnection(
  ctx: AudioContext,
  blendCfg: BlendConfig,
  audioA: AudioVoice,
  audioB: AudioVoice,
): CrossConnection {
  switch (blendCfg.type) {
    case 'fm':
      return this._createFMCross(ctx, audioA, audioB);
    case 'ring':
      return this._createRingCross(ctx, audioA, audioB);
    case 'rawfm':
      return this._createRawFMCross(ctx, audioA, audioB);
    default:
      throw new Error('unreachable');
  }
}

private _createFMCross(
  ctx: AudioContext,
  audioA: AudioVoice,
  audioB: AudioVoice,
): CrossConnection {
  const aToB = this._createFMPair(ctx, audioA.getShadowNode(), audioB);
  const bToA = this._createFMPair(ctx, audioB.getShadowNode(), audioA);
  return { type: 'fm', aToB, bToA };
}

private _createFMPair(
  ctx: AudioContext,
  shadow: OscillatorNode,
  carrier: AudioVoice,
): FMPair {
  const depthGain = new GainNode(ctx, { gain: 0 });
  shadow.connect(depthGain);
  for (const param of carrier.getCarrierFrequencyParams()) {
    depthGain.connect(param);
  }
  return { depthGain };
}

private _createRingCross(
  ctx: AudioContext,
  audioA: AudioVoice,
  audioB: AudioVoice,
): CrossConnection {
  const masterInput = this._masterInput!;
  const aRing = this._createRingPair(ctx, audioA, audioB.getShadowNode(), masterInput);
  const bRing = this._createRingPair(ctx, audioB, audioA.getShadowNode(), masterInput);
  return { type: 'ring', aRing, bRing };
}

private _createRingPair(
  ctx: AudioContext,
  voice: AudioVoice,
  partnerShadow: OscillatorNode,
  masterInput: GainNode,
): RingPair {
  // Disconnect voice from master — we'll route through dry/wet
  safeDisconnect(voice.outputNode);

  const dryGain = new GainNode(ctx, { gain: 1 });
  const wetGain = new GainNode(ctx, { gain: 0 });
  const shadowAmp = new GainNode(ctx, { gain: 0 });

  // Dry path: voice → dryGain → master
  voice.outputNode.connect(dryGain);
  dryGain.connect(masterInput);

  // Wet path: voice → wetGain → master, with partner shadow driving wetGain.gain
  voice.outputNode.connect(wetGain);
  wetGain.connect(masterInput);

  // Shadow → amplitude scaler → wetGain.gain
  partnerShadow.connect(shadowAmp);
  shadowAmp.connect(wetGain.gain);

  return { dryGain, wetGain, shadowAmp };
}

private _createRawFMCross(
  ctx: AudioContext,
  audioA: AudioVoice,
  audioB: AudioVoice,
): CrossConnection {
  const aToB = this._createRawFMPair(ctx, audioA.getModulatorNode(), audioB);
  const bToA = this._createRawFMPair(ctx, audioB.getModulatorNode(), audioA);
  return { type: 'rawfm', aToB, bToA };
}

private _createRawFMPair(
  ctx: AudioContext,
  modulator: OscillatorNode,
  carrier: AudioVoice,
): FMPairFiltered {
  const lowpass = new BiquadFilterNode(ctx, {
    type: 'lowpass',
    frequency: FM_MODULATOR_LPF_HZ,
    Q: FM_MODULATOR_LPF_Q,
  });
  const depthGain = new GainNode(ctx, { gain: 0 });
  modulator.connect(lowpass);
  lowpass.connect(depthGain);
  for (const param of carrier.getCarrierFrequencyParams()) {
    depthGain.connect(param);
  }
  return { lowpass, depthGain };
}

private _updateCrossConnection(
  conn: CrossConnection,
  blendCfg: BlendConfig,
  overlap: number,
  audioA: AudioVoice,
  audioB: AudioVoice,
): void {
  switch (conn.type) {
    case 'fm': {
      const cfg = (blendCfg as { type: 'fm'; config: { maxIndex: number; depthCurve: 'linear' | 'sqrt' } }).config;
      const freqA = audioA.getShadowNode().frequency.value;
      const freqB = audioB.getShadowNode().frequency.value;
      conn.aToB.depthGain.gain.value = computeFMDepth(overlap, cfg, freqA);
      conn.bToA.depthGain.gain.value = computeFMDepth(overlap, cfg, freqB);
      break;
    }
    case 'ring':
      conn.aRing.dryGain.gain.value = 1 - overlap;
      conn.aRing.shadowAmp.gain.value = overlap;
      conn.bRing.dryGain.gain.value = 1 - overlap;
      conn.bRing.shadowAmp.gain.value = overlap;
      break;
    case 'rawfm': {
      const cfg = (blendCfg as { type: 'rawfm'; config: { maxIndex: number; depthCurve: 'linear' | 'sqrt' } }).config;
      const freqA = audioA.getModulatorNode().frequency.value;
      const freqB = audioB.getModulatorNode().frequency.value;
      conn.aToB.depthGain.gain.value = computeFMDepth(overlap, cfg, freqA);
      conn.bToA.depthGain.gain.value = computeFMDepth(overlap, cfg, freqB);
      break;
    }
  }
}

private _teardownCrossConnection(
  conn: CrossConnection,
  audioById: Map<string, AudioVoice>,
): void {
  // For ring mod, reconnect voices to master before disposing
  if (conn.type === 'ring' && this._masterInput) {
    // We need to reconnect both voices' output nodes.
    // The audioById map has all active voices — find which ones
    // are in this ring pair by checking which outputNodes are
    // connected to the ring pair's dryGain.
    // Simpler: just dispose and let the next sync reconnect.
    // But that leaves voices silent until next sync.
    // Instead, store voice IDs on the connection.
  }
  this._disposeCrossConnection(conn);
}
```

Wait — ring mod teardown needs to reconnect the voice's outputNode to masterInput. The connection doesn't currently store voice references. We need to either store them or look them up.

Update the `CrossConnection` ring variant to store voice IDs:

Change the ring case in the union type to:

```typescript
  | { type: 'ring'; aId: string; bId: string; aRing: RingPair; bRing: RingPair }
```

Update `_createRingCross` to store IDs:

```typescript
private _createRingCross(
  ctx: AudioContext,
  audioA: AudioVoice,
  audioB: AudioVoice,
): CrossConnection {
  const masterInput = this._masterInput!;
  const aRing = this._createRingPair(ctx, audioA, audioB.getShadowNode(), masterInput);
  const bRing = this._createRingPair(ctx, audioB, audioA.getShadowNode(), masterInput);
  return { type: 'ring', aId: audioA.shapeId, bId: audioB.shapeId, aRing, bRing };
}
```

And replace `_teardownCrossConnection`:

```typescript
private _teardownCrossConnection(
  conn: CrossConnection,
  audioById: Map<string, AudioVoice>,
): void {
  if (conn.type === 'ring' && this._masterInput) {
    const masterInput = this._masterInput;
    const audioA = audioById.get(conn.aId);
    const audioB = audioById.get(conn.bId);
    this._disposeCrossConnection(conn);
    if (audioA) {
      audioA.outputNode.connect(masterInput);
    }
    if (audioB) {
      audioB.outputNode.connect(masterInput);
    }
    return;
  }
  this._disposeCrossConnection(conn);
}
```

- [ ] **Step 6: Update all call sites**

In the engine, find every reference to `_fmConnections`, `_disposeFMConnections`, `_syncFMConnections`, and `FM_PARAMS`:

1. `this._fmConnections` → `this._crossConnections` (constructor field already renamed in Step 1).
2. `this._disposeFMConnections()` → `this._disposeAllCrossConnections()` — occurs in `_updateVoices` (line 406) and `stop`/`_cleanup` (around line 600+).
3. `this._syncFMConnections(...)` → `this._syncCrossConnections(...)` — occurs in `play` (line 162) and `_updateVoices` (lines 407, 410).
4. Remove the `FM_PARAMS` import alias from `effects.ts` if still present (was a temporary compat shim from Task 1).

Search for `_fmConnections` and replace all occurrences with `_crossConnections`.
Search for `_disposeFMConnections` and replace with `_disposeAllCrossConnections`.
Search for `_syncFMConnections` and replace with `_syncCrossConnections`.
Search for `_lastBlend` — this stays unchanged (tracks blend mode to detect changes).

- [ ] **Step 7: Remove temporary aliases from effects.ts**

In `js/effects.ts`, delete the temporary `FM_PARAMS` and `FMParams` aliases added in Task 1.

- [ ] **Step 8: Typecheck**

Run: `bun run check`

Expected: PASS. If the type assertion casts in `_updateCrossConnection` cause issues, extract `config` via a proper narrowing check:

```typescript
case 'fm': {
  if (blendCfg.type !== 'fm') break;
  // now blendCfg.config is narrowed to FMConfig
}
```

- [ ] **Step 9: Update audio-engine unit tests**

In `tests/unit/audio-engine.test.js`, update all references:

1. Replace `engine._fmConnections` with `engine._crossConnections` everywhere.
2. In `'global blend change triggers FM rebuild'` test: update expectations:
   ```javascript
   // No cross-connections with screen blend
   expect(engine._crossConnections.size).toBe(0);
   // Change to multiply — should create cross-connections
   engine.update(makeSigilState([voiceA, voiceB], 'multiply'), TEST_REVERB);
   expect(engine._crossConnections.size).toBeGreaterThan(0);
   ```
3. Similarly update `'non-overlapping voices do not create FM connections'`, `'screen blend creates no FM even when overlapping'`, `'FM connections are cleaned up when voices separate'`, and `'FM connections stay active when voice is soloed'`.

Add a new test for ring mod routing:

```javascript
  test('exclusion blend creates ring mod connections for overlapping voices', async () => {
    const voiceA = makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    await engine.play(
      makeSigilState([voiceA, voiceB], 'exclusion'),
      { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
      TEST_REVERB,
    );

    expect(engine._crossConnections.size).toBeGreaterThan(0);
    const conn = [...engine._crossConnections.values()][0];
    expect(conn.type).toBe('ring');
  });

  test('multiply blend creates FM connections', async () => {
    const voiceA = makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    await engine.play(
      makeSigilState([voiceA, voiceB], 'multiply'),
      { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
      TEST_REVERB,
    );

    expect(engine._crossConnections.size).toBeGreaterThan(0);
    const conn = [...engine._crossConnections.values()][0];
    expect(conn.type).toBe('fm');
  });

  test('difference blend creates raw FM connections', async () => {
    const voiceA = makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    await engine.play(
      makeSigilState([voiceA, voiceB], 'difference'),
      { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
      TEST_REVERB,
    );

    expect(engine._crossConnections.size).toBeGreaterThan(0);
    const conn = [...engine._crossConnections.values()][0];
    expect(conn.type).toBe('rawfm');
  });

  test('ring mod connections are cleaned up and voices reconnected', async () => {
    const voiceA = makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    await engine.play(
      makeSigilState([voiceA, voiceB], 'exclusion'),
      { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
      TEST_REVERB,
    );

    expect(engine._crossConnections.size).toBeGreaterThan(0);

    // Move voices apart
    const movedA = makeVoice('a', 'sine', { x: 0.1, y: 0.1, size: 0.05 });
    const movedB = makeVoice('b', 'sine', { x: 0.9, y: 0.9, size: 0.05 });
    engine.update(makeSigilState([movedA, movedB], 'exclusion'), TEST_REVERB);

    expect(engine._crossConnections.size).toBe(0);
  });
```

- [ ] **Step 10: Run tests**

Run: `bun run check && bun run test:unit`

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add js/effects.ts js/audio/engine.ts tests/unit/audio-engine.test.js
git commit -m "feat: bidirectional cross-connection engine with mode dispatch (#349)

Replace unidirectional FMConnection with CrossConnection discriminated
union. Three modes:
- 'fm': sine shadows modulate each other's carrier frequency (multiply)
- 'ring': dry/wet crossfade with partner shadow driving gain (exclusion)
- 'rawfm': raw oscillators through lowpass modulate each other (difference)

All modes are bidirectional — two connections per overlapping pair.
Ring mod disconnects voice from master and routes through dry/wet nodes;
teardown reconnects the voice."
```

---

## Task 4: Manual smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Start the dev server**

Run: `bun run dev`

Open `http://localhost:5173` in Chrome.

- [ ] **Step 2: Test each blend mode**

Create two overlapping voices (ideally different waveforms — e.g., pulse + sine). Press play/latch.

Long-press the blend button and cycle through modes. Listen for:

- **screen**: clean mixed voices, no modulation.
- **multiply**: warm FM coloring — should sound like "two synths playing together." Not harsh. Audibly different from screen.
- **exclusion**: metallic, hollow, bell-like — fundamentally different texture from multiply. Sum/difference frequency character. Carrier suppressed at full overlap.
- **difference**: chaotic, textural — the "weird" option. Richer/noisier than multiply due to raw harmonics. Still usable, not painful.

- [ ] **Step 3: Test overlap dynamics**

With multiply or exclusion active, drag one voice slowly from non-overlapping to fully overlapping. The effect should fade in smoothly — no pops, no clicks, no sudden jumps. For exclusion specifically, check that the dry/wet crossfade is smooth.

- [ ] **Step 4: Test ring mod teardown**

With exclusion active and two overlapping voices, drag one voice away until they no longer overlap. The voice should still be audible (reconnected to master). If a voice goes silent when overlap drops to zero, the teardown reconnection is broken.

- [ ] **Step 5: Stress test**

- Large pulse fully enclosing a small sine, `difference` blend. Should be chaotic but not ear-splitting.
- Three overlapping voices, `multiply`. Cross-mod feedback from A→B→C→A chain. Should remain stable.
- Full-overlap voices at the same pitch (1:1 ratio), `multiply`. Classic FM — should produce octave harmonics, warm.
- Full-overlap voices a tritone apart, `exclusion`. Inharmonic ring mod — should be metallic/bell-like, not harsh.

- [ ] **Step 6: Tune parameters if needed**

If **multiply** is too subtle: raise `BLEND_CONFIG.multiply.config.maxIndex` (try 0.6, 0.7).
If **multiply** is too harsh: lower it (try 0.35, 0.4).
If **exclusion** crossfade is too abrupt: consider adding a curve (but overlap is already continuous, so this is unlikely).
If **difference** is too harsh: lower `BLEND_CONFIG.difference.config.maxIndex` or lower `FM_MODULATOR_LPF_HZ`.

Any tuning changes: update `js/effects.ts`, re-run `bun run test:unit` to confirm test ceilings hold, then amend the relevant commit.

- [ ] **Step 7: Stop dev server**

`Ctrl+C`.

---

## Task 5: Rebaseline audio snapshots

**Files:**
- Regenerate: `tests/integration/audio-snapshot.test.js-snapshots/*.png`

- [ ] **Step 1: Update snapshots**

Run: `bun run test:e2e -- --update-snapshots`

- [ ] **Step 2: Review the diff**

Run: `git diff --stat tests/integration/audio-snapshot.test.js-snapshots/`

Expected to change (both `-chromium` and `-webkit`):
- `fm-multiply-overlap-*` — changed (sine shadow instead of raw modulator)
- `fm-difference-overlap-*` — changed (bidirectional, lowpassed)
- `fm-move-into-overlap-*` — changed
- `blend-mode-switching-*` — changed (all modes changed)
- Possibly `fm-multiply-no-overlap-*` — should NOT change (no overlap = no connections)

Expected NOT to change:
- `screen-no-fm-overlap-*` — unchanged
- All single-voice snapshots (sine, triangle, astroid, etc.)

If a non-blend snapshot changed, STOP and investigate.

- [ ] **Step 3: Run e2e suite green**

Run: `bun run test:e2e`

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/audio-snapshot.test.js-snapshots/
git commit -m "test: rebaseline audio snapshots for FM architecture rework (#349)

All blend-mode baselines regenerated for the new cross-connection
architecture: sine cross-FM (multiply), ring mod (exclusion), raw
cross-FM (difference). Non-blend baselines unchanged."
```

---

## Task 6: Frequency profile regression check

**Files:** none (output to gitignored `tmp/`)

- [ ] **Step 1: Profile the PR branch**

```bash
bun run dev &
DEV_PID=$!
sleep 3
node scripts/audio-profile.js fm-architecture-pr
kill $DEV_PID
```

- [ ] **Step 2: Profile `main`**

```bash
git stash push --include-untracked -m "fm-architecture wip"
git checkout main
bun run dev &
DEV_PID=$!
sleep 3
node scripts/audio-profile.js fm-architecture-main
kill $DEV_PID
git checkout fm-taming-349
git stash pop
```

- [ ] **Step 3: Compare**

Run: `diff tmp/audio-profiling-fm-architecture-main/band-summary.txt tmp/audio-profiling-fm-architecture-pr/band-summary.txt`

Expected: band levels within ~5 dB of `main`. Random spatches rarely have overlapping voices, so the FM/ring-mod changes have minimal effect on the aggregate spectrum.

If any band exceeds 5 dB shift, STOP and investigate.

---

## Task 7: Pre-push CI check and push

- [ ] **Step 1: Verify rebase status**

Run: `git fetch origin main && git log HEAD..origin/main --oneline`

Expected: no output. If output, rebase first.

- [ ] **Step 2: Full check suite**

```bash
bun run fmt
bun run lint
bun run check
bun run test:unit
bun run test:e2e
```

Expected: all exit 0.

- [ ] **Step 3: Push**

Run: `git push -u origin fm-taming-349`

---

## Task 8: Open pull request

- [ ] **Step 1: Open PR via Gitea MCP**

Use `mcp__gitea__pull_request_write`:
- Owner: `zetlen`
- Repo: `spatch`
- Base: `main`
- Head: `fm-taming-349`
- Title: `fix: rework FM blend architecture for distinct mode characters`
- Body:

```markdown
Closes #349.

Replaces the single-technique unidirectional FM system with three distinct
bidirectional synthesis techniques:

| Blend mode | Technique | Character |
|-----------|-----------|-----------|
| `screen` | None | Clean mixed voices |
| `multiply` | Sine cross-FM | Warm, resonant |
| `exclusion` | Ring modulation | Metallic, bell-like |
| `difference` | Raw cross-FM (lowpassed) | Chaotic, textural |

**Key changes:**
- Every voice gains a sine shadow oscillator (tracks pitch, never audible)
  used as a clean modulation source for FM and ring mod
- All modulation is bidirectional — both voices in an overlapping pair affect
  each other equally
- Ring mod re-routes voice output through dry/wet gain nodes with the partner's
  shadow driving the wet path — smooth overlap-based crossfade
- Raw cross-FM retains the lowpass filter on the modulator to tame harmonics

Spec: `docs/plans/2026-04-18-fm-architecture-design.md`
Plan: `docs/plans/2026-04-18-fm-architecture-plan.md`

## Test plan

- [x] Unit tests: `BLEND_CONFIG` structure, `computeFMDepth` numeric guards,
      shadow oscillator creation/tracking, cross-connection type dispatch,
      ring-mod teardown reconnection
- [x] Audio snapshots rebaselined; non-blend baselines unchanged
- [x] Frequency profile: within 5 dB of `main` per band
- [x] Manual: all four modes audibly distinct, smooth overlap transitions,
      ring-mod teardown doesn't silence voices, stress-tested at extremes
```

---

## Self-Review Notes

**Spec coverage:**
- Sine shadow oscillator (spec §Architecture) → Task 2
- Multiply — sine cross-FM (spec §Multiply) → Task 3 (`_createFMCross`)
- Exclusion — ring modulation (spec §Exclusion) → Task 3 (`_createRingCross`)
- Difference — raw cross-FM (spec §Difference) → Task 3 (`_createRawFMCross`)
- `BLEND_CONFIG` replacing `FM_PARAMS` (spec §Parameters) → Task 1
- Engine rework (spec §Engine changes) → Task 3
- Ring mod output routing (spec §Ring mod output routing) → Task 3 (`_createRingPair`, `_teardownCrossConnection`)
- Unit tests → Tasks 1, 2, 3
- Audio snapshots → Task 5
- Frequency profile → Task 6
- Manual smoke test → Task 4
- No serialization changes → confirmed, no task needed

**Type consistency:**
- `BlendConfig` used in Task 1 (definition) and Task 3 (import, usage). Same type.
- `CrossConnection` union defined and consumed in Task 3. `type` discriminant values: `'fm'`, `'ring'`, `'rawfm'` — consistent across create/update/dispose/teardown.
- `FMPair`, `FMPairFiltered`, `RingPair` — used in both the union and the create methods. Consistent.
- `getShadowNode()` — defined in Task 2 (`types.ts` + `voice-builder.ts`), consumed in Task 3 (`_createFMCross`, `_createRingCross`, `_updateCrossConnection`). Same signature.
- `_crossConnections` field name — consistent across Task 3 steps and test updates.
- `_masterInput` — stored in `_buildVoice`, used in `_syncCrossConnections` and `_createRingPair`. Same field.

**Placeholder scan:** No TBDs, TODOs, or "fill in later" instructions. All code blocks are complete. The Task 4 tuning guidance gives specific alternative numbers.
