# Diphthong Gradients Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Linear gradient fills sweep the formant filter from color1 to color2 over the decay phase, turning gradients into true diphthongs.

**Architecture:** Schedule Web Audio `setValueCurveAtTime` ramps at play time. Gradient angle maps to easing curve and sweep duration. Skip per-frame formant updates for voices with active sweeps. Fill changes during playback trigger voice rebuild.

**Tech Stack:** Web Audio API (`setValueCurveAtTime`), BiquadFilterNode AudioParams, existing formant mapping.

---

### Task 1: Extract `computeFormantQ` helper from `applyFormantFilter`

The Q computation is needed in both `applyFormantFilter` and the new sweep
scheduler. Extract it to avoid duplication (triple-sec rule).

**Files:**
- Modify: `js/audio/formants.ts:100-133`
- Test: `tests/unit/audio-mapping.test.js` (existing hueToFormants/lightnessToCutoff tests)

**Step 1: Write the failing test**

Add to `tests/unit/audio-mapping.test.js`:

```javascript
import { computeFormantQ, hueToFormants, lightnessToCutoff } from '../../js/audio/formants.ts';

describe('computeFormantQ', () => {
  test('returns base Q of 1 at saturation 0', () => {
    // formantQ defaults to 1.0 in default Vibe
    expect(computeFormantQ(0, 'pulse')).toBeCloseTo(1, 2);
  });

  test('higher saturation increases Q', () => {
    const qLow = computeFormantQ(20, 'pulse');
    const qHigh = computeFormantQ(80, 'pulse');
    expect(qHigh).toBeGreaterThan(qLow);
  });

  test('sine waveform caps Q lower than pulse', () => {
    const qSine = computeFormantQ(100, 'sine');
    const qPulse = computeFormantQ(100, 'pulse');
    expect(qSine).toBeLessThan(qPulse);
  });

  test('sine max Q is 5 at full saturation (default vibe)', () => {
    // (1 + 1.0 * 4) * 1.0 = 5
    expect(computeFormantQ(100, 'sine')).toBeCloseTo(5, 2);
  });

  test('pulse max Q is 9 at full saturation (default vibe)', () => {
    // (1 + 1.0 * 8) * 1.0 = 9
    expect(computeFormantQ(100, 'pulse')).toBeCloseTo(9, 2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/audio-mapping.test.js`
Expected: FAIL — `computeFormantQ` is not exported.

**Step 3: Implement**

In `js/audio/formants.ts`, add the exported helper and refactor `applyFormantFilter` to use it:

```typescript
/**
 * Compute formant filter Q (resonance) from saturation and waveform type.
 *
 * Sine waveforms cap Q at 4 to prevent signal kill when the fundamental is
 * far from formant centers. Harmonics-rich waveforms cap at 8.
 *
 * @param saturation - HSL saturation (0-100)
 * @param waveform - Voice waveform type
 * @returns Q value for the primary formant filter
 */
export function computeFormantQ(saturation: number, waveform: WaveformType = 'pulse'): number {
  const maxQ = waveform === 'sine' ? 4 : 8;
  return (1 + (saturation / 100) * maxQ) * vibe.formantQ;
}
```

Then refactor `applyFormantFilter` lines 123-124 to use it:

```typescript
  const q = computeFormantQ(s, waveform);
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/audio-mapping.test.js`
Expected: All PASS.

**Step 5: Run full test suite**

Run: `bun run test:unit`
Expected: All pass — refactor is behavior-preserving.

**Step 6: Commit**

```bash
git add js/audio/formants.ts tests/unit/audio-mapping.test.js
git commit -m "refactor: extract computeFormantQ from applyFormantFilter (#234)"
```

---

### Task 2: Add sweep lookup table and curve builder

The gradient angle is always a multiple of 45° (8 discrete positions). Map
each to sweep parameters via a simple lookup table. No trig needed.

**Files:**
- Modify: `js/audio/formants.ts`
- Create: `tests/unit/formant-sweep.test.js`

**Step 1: Write the failing tests**

Create `tests/unit/formant-sweep.test.js`:

```javascript
import { describe, expect, test } from 'bun:test';
import { sweepParamsForAngle, buildSweepCurve } from '../../js/audio/formants.ts';

describe('sweepParamsForAngle', () => {
  test('returns params for all 8 positions', () => {
    for (let a = 0; a < 360; a += 45) {
      const p = sweepParamsForAngle(a);
      expect(p.durationFrac).toBeGreaterThan(0);
      expect(p.durationFrac).toBeLessThanOrEqual(1);
      expect(p.exponent).toBeGreaterThan(0);
    }
  });

  test('0° (LR) uses full decay, linear', () => {
    const p = sweepParamsForAngle(0);
    expect(p.durationFrac).toBe(1.0);
    expect(p.exponent).toBe(1);
  });

  test('180° (RL) is fastest', () => {
    const p = sweepParamsForAngle(180);
    expect(p.durationFrac).toBeLessThan(sweepParamsForAngle(0).durationFrac);
    expect(p.exponent).toBe(1); // linear
  });

  test('45° is ease-in (exponent > 1)', () => {
    expect(sweepParamsForAngle(45).exponent).toBeGreaterThan(1);
  });

  test('135° is ease-out (exponent < 1)', () => {
    expect(sweepParamsForAngle(135).exponent).toBeLessThan(1);
  });

  test('wraps at 360°', () => {
    const a = sweepParamsForAngle(0);
    const b = sweepParamsForAngle(360);
    expect(a.durationFrac).toBe(b.durationFrac);
    expect(a.exponent).toBe(b.exponent);
  });

  test('rounds to nearest 45° for non-standard angles', () => {
    // 20° rounds to 0°
    const p = sweepParamsForAngle(20);
    expect(p.durationFrac).toBe(sweepParamsForAngle(0).durationFrac);
  });
});

describe('buildSweepCurve', () => {
  test('returns Float32Array of requested length', () => {
    const curve = buildSweepCurve(1, 64);
    expect(curve).toBeInstanceOf(Float32Array);
    expect(curve.length).toBe(64);
  });

  test('starts at 0 and ends at 1', () => {
    for (const exp of [0.5, 1, 2]) {
      const curve = buildSweepCurve(exp, 64);
      expect(curve[0]).toBeCloseTo(0, 2);
      expect(curve[63]).toBeCloseTo(1, 2);
    }
  });

  test('exponent 1 produces linear curve', () => {
    const curve = buildSweepCurve(1, 5);
    expect(curve[1]).toBeCloseTo(0.25, 2);
    expect(curve[2]).toBeCloseTo(0.5, 2);
    expect(curve[3]).toBeCloseTo(0.75, 2);
  });

  test('exponent > 1 (ease-in) is below linear at midpoint', () => {
    const curve = buildSweepCurve(2, 64);
    expect(curve[32]).toBeLessThan(0.5);
  });

  test('exponent < 1 (ease-out) is above linear at midpoint', () => {
    const curve = buildSweepCurve(0.5, 64);
    expect(curve[32]).toBeGreaterThan(0.5);
  });

  test('all values in [0, 1] and monotonically non-decreasing', () => {
    for (const exp of [0.5, 1, 2]) {
      const curve = buildSweepCurve(exp, 64);
      for (let i = 0; i < curve.length; i++) {
        expect(curve[i]).toBeGreaterThanOrEqual(0);
        expect(curve[i]).toBeLessThanOrEqual(1);
        if (i > 0) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1] - 0.001);
      }
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/formant-sweep.test.js`
Expected: FAIL — functions not exported.

**Step 3: Implement**

Add to `js/audio/formants.ts`:

```typescript
interface SweepParams {
  durationFrac: number; // fraction of decay phase (0–1)
  exponent: number;     // power curve: 1 = linear, >1 = ease-in, <1 = ease-out
}

/** Sweep parameters for each of the 8 discrete gradient angles (index = angle / 45). */
const SWEEP_TABLE: SweepParams[] = [
  { durationFrac: 1.0, exponent: 1 },   // 0°   LR     — slowest, linear
  { durationFrac: 0.8, exponent: 2 },   // 45°  TL→BR  — medium, ease-in
  { durationFrac: 0.6, exponent: 1 },   // 90°  TB     — moderate, linear
  { durationFrac: 0.8, exponent: 0.5 }, // 135° TR→BL  — medium, ease-out
  { durationFrac: 0.4, exponent: 1 },   // 180° RL     — fastest, linear
  { durationFrac: 0.8, exponent: 2 },   // 225° BR→TL  — medium, ease-in
  { durationFrac: 0.6, exponent: 1 },   // 270° BT     — moderate, linear
  { durationFrac: 0.8, exponent: 0.5 }, // 315° BL→TR  — medium, ease-out
];

/**
 * Look up sweep parameters for a gradient angle. Snaps to the nearest 45°.
 */
export function sweepParamsForAngle(angleDeg: number): SweepParams {
  const a = ((angleDeg % 360) + 360) % 360;
  const index = Math.round(a / 45) & 7;
  return SWEEP_TABLE[index]!;
}

/**
 * Build a power-curve easing array from an exponent.
 * Values go from 0 to 1 over `samples` steps.
 */
export function buildSweepCurve(exponent: number, samples: number): Float32Array {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    curve[i] = (i / (samples - 1)) ** exponent;
  }
  return curve;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/formant-sweep.test.js`
Expected: All PASS.

**Step 5: Commit**

```bash
git add js/audio/formants.ts tests/unit/formant-sweep.test.js
git commit -m "feat: add sweep lookup table and curve builder for formant sweep (#234)"
```

---

### Task 3: Add `scheduleFormantSweep`

Schedules `setValueCurveAtTime` ramps on formant filter nodes. Depends on
the helpers from Tasks 1–2.

**Files:**
- Modify: `js/audio/formants.ts`
- Modify: `tests/unit/formant-sweep.test.js`

**Step 1: Write the failing test**

Add to `tests/unit/formant-sweep.test.js`:

```javascript
import {
  buildSweepCurve,
  sweepParamsForAngle,
  scheduleFormantSweep,
} from '../../js/audio/formants.ts';
import { afterEach } from 'bun:test';
import { Vibe, setVibe } from '../../js/audio/vibe.ts';

afterEach(() => setVibe(new Vibe()));

function createMockAudioParam(initial = 0) {
  const calls = [];
  return {
    calls,
    setValueAtTime(v, t) { this.value = v; calls.push({ method: 'setValueAtTime', value: v, time: t }); },
    setValueCurveAtTime(values, t, d) { calls.push({ method: 'setValueCurveAtTime', values: Array.from(values), time: t, duration: d }); },
    cancelScheduledValues() {},
    linearRampToValueAtTime() {},
    value: initial,
  };
}

function createMockBiquadFilter(freq = 350, q = 1) {
  return {
    frequency: createMockAudioParam(freq),
    Q: createMockAudioParam(q),
    type: 'bandpass',
  };
}

describe('scheduleFormantSweep', () => {
  const linearFill = {
    mode: 'linear',
    h: 0,    // /a/ vowel
    s: 80,
    l: 50,
    h2: 120, // /i/ vowel
    s2: 60,
    l2: 70,
    gradAngle: 0,
  };

  test('schedules setValueCurveAtTime on all three nodes', () => {
    const f1 = createMockBiquadFilter();
    const f2 = createMockBiquadFilter();
    const brightness = createMockBiquadFilter(1900, 0.7);
    brightness.type = 'lowpass';

    scheduleFormantSweep(f1, f2, brightness, linearFill, 'pulse', 0.1, 0.5);

    // F1 frequency should have a setValueCurveAtTime call
    const f1FreqCurve = f1.frequency.calls.find(c => c.method === 'setValueCurveAtTime');
    expect(f1FreqCurve).not.toBeUndefined();
    expect(f1FreqCurve.time).toBeCloseTo(0.1, 5);

    // F2 frequency
    const f2FreqCurve = f2.frequency.calls.find(c => c.method === 'setValueCurveAtTime');
    expect(f2FreqCurve).not.toBeUndefined();

    // F1 Q
    const f1QCurve = f1.Q.calls.find(c => c.method === 'setValueCurveAtTime');
    expect(f1QCurve).not.toBeUndefined();

    // F2 Q
    const f2QCurve = f2.Q.calls.find(c => c.method === 'setValueCurveAtTime');
    expect(f2QCurve).not.toBeUndefined();

    // Brightness cutoff
    const brightCurve = brightness.frequency.calls.find(c => c.method === 'setValueCurveAtTime');
    expect(brightCurve).not.toBeUndefined();
  });

  test('sweep starts at color1 formants and ends at color2 formants', () => {
    const f1 = createMockBiquadFilter();
    const f2 = createMockBiquadFilter();
    const brightness = createMockBiquadFilter(1900, 0.7);
    brightness.type = 'lowpass';

    scheduleFormantSweep(f1, f2, brightness, linearFill, 'pulse', 0.0, 1.0);

    const f1Curve = f1.frequency.calls.find(c => c.method === 'setValueCurveAtTime');
    const values = f1Curve.values;
    // First value should be /a/ F1 ≈ 730
    expect(values[0]).toBeCloseTo(730, -1);
    // Last value should be /i/ F1 ≈ 270
    expect(values[values.length - 1]).toBeCloseTo(270, -1);
  });

  test('sweep duration is decay × angleToDurationFrac', () => {
    const f1 = createMockBiquadFilter();
    const f2 = createMockBiquadFilter();
    const brightness = createMockBiquadFilter(1900, 0.7);
    brightness.type = 'lowpass';

    const decay = 0.8;
    scheduleFormantSweep(f1, f2, brightness, linearFill, 'pulse', 0.0, decay);

    const f1Curve = f1.frequency.calls.find(c => c.method === 'setValueCurveAtTime');
    const expectedDuration = decay * sweepParamsForAngle(0).durationFrac;
    expect(f1Curve.duration).toBeCloseTo(expectedDuration, 3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/formant-sweep.test.js`
Expected: FAIL — `scheduleFormantSweep` not exported.

**Step 3: Implement**

Add to `js/audio/formants.ts`:

```typescript
import type { Fill, LinearFill, WaveformType } from '../types.ts';

const SWEEP_CURVE_SAMPLES = 64;

/**
 * Schedule a formant sweep on pre-existing BiquadFilterNodes for a linear
 * gradient fill. The sweep transitions from color1's vowel to color2's vowel
 * over a portion of the decay phase, with easing controlled by gradient angle.
 *
 * Call this AFTER applyFormantFilter has set the initial state (color1).
 * The scheduled curves will take over at startTime and hold at color2's
 * values when complete.
 *
 * @param f1Node - First formant bandpass filter
 * @param f2Node - Second formant bandpass filter
 * @param brightnessNode - Brightness lowpass filter
 * @param fill - Linear gradient fill with two color stops
 * @param waveform - Voice waveform type (affects Q scaling)
 * @param startTime - AudioContext time when sweep begins (typically now + attack)
 * @param decayDuration - Full decay duration in seconds
 */
export function scheduleFormantSweep(
  f1Node: BiquadFilterNode,
  f2Node: BiquadFilterNode,
  brightnessNode: BiquadFilterNode,
  fill: LinearFill,
  waveform: WaveformType,
  startTime: number,
  decayDuration: number,
): void {
  const startF = hueToFormants(fill.h);
  const endF = hueToFormants(fill.h2);
  const startQ = computeFormantQ(fill.s, waveform);
  const endQ = computeFormantQ(fill.s2, waveform);
  const startCutoff = lightnessToCutoff(fill.l);
  const endCutoff = lightnessToCutoff(fill.l2);

  const params = sweepParamsForAngle(fill.gradAngle);
  const easing = buildSweepCurve(params.exponent, SWEEP_CURVE_SAMPLES);
  const duration = Math.max(0.01, decayDuration * params.durationFrac);

  const f1Freq = new Float32Array(SWEEP_CURVE_SAMPLES);
  const f2Freq = new Float32Array(SWEEP_CURVE_SAMPLES);
  const f1Q = new Float32Array(SWEEP_CURVE_SAMPLES);
  const f2Q = new Float32Array(SWEEP_CURVE_SAMPLES);
  const bright = new Float32Array(SWEEP_CURVE_SAMPLES);

  for (let i = 0; i < SWEEP_CURVE_SAMPLES; i++) {
    const t = easing[i]!;
    f1Freq[i] = startF.f1 + (endF.f1 - startF.f1) * t;
    f2Freq[i] = startF.f2 + (endF.f2 - startF.f2) * t;
    f1Q[i] = startQ + (endQ - startQ) * t;
    f2Q[i] = (startQ + (endQ - startQ) * t) * 0.7;
    bright[i] = startCutoff + (endCutoff - startCutoff) * t;
  }

  f1Node.frequency.setValueCurveAtTime(f1Freq, startTime, duration);
  f2Node.frequency.setValueCurveAtTime(f2Freq, startTime, duration);
  f1Node.Q.setValueCurveAtTime(f1Q, startTime, duration);
  f2Node.Q.setValueCurveAtTime(f2Q, startTime, duration);
  brightnessNode.frequency.setValueCurveAtTime(bright, startTime, duration);
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/formant-sweep.test.js`
Expected: All PASS.

**Step 5: Commit**

```bash
git add js/audio/formants.ts tests/unit/formant-sweep.test.js
git commit -m "feat: add scheduleFormantSweep for diphthong transitions (#234)"
```

---

### Task 4: Add `hasSweep` and `currentFillKey` to AudioVoiceBase

Track sweep state and fill identity on each audio voice so the engine knows
when to skip per-frame formant updates and when to rebuild.

**Files:**
- Modify: `js/audio/voice-builder.ts:16-35` (AudioVoiceBase interface)
- Modify: `js/audio/voice-builder.ts:205-222` (shared object in buildVoice)

**Step 1: Add fields to AudioVoiceBase**

In `js/audio/voice-builder.ts`, add to the `AudioVoiceBase` interface:

```typescript
  hasSweep: boolean;                    // true while a formant sweep is scheduled
  currentFillKey: string | undefined;   // serialized fill for change detection
```

**Step 2: Compute fillKey and add defaults in buildVoice**

Add a `fillKey` helper at module level:

```typescript
/** Serialize a fill for change detection. Solid fills return undefined
 *  (hue/sat/light changes are handled smoothly, not via rebuild). Linear
 *  fills include all params so any change triggers rebuild + sweep reschedule. */
function fillToKey(fill: Fill): string | undefined {
  if (fill.mode !== 'linear') return undefined;
  return `${fill.h}:${fill.s}:${fill.l}:${fill.h2}:${fill.s2}:${fill.l2}:${fill.gradAngle}`;
}
```

In the `shared` object (line ~205), add:

```typescript
    currentFillKey: fillToKey(voice.fill),
    hasSweep: false,
```

**Step 3: Run typecheck and tests**

Run: `bun run check && bun run test:unit`
Expected: All pass — fields added with safe defaults, no behavior change.

**Step 4: Commit**

```bash
git add js/audio/voice-builder.ts
git commit -m "feat: add hasSweep and currentFillKey to AudioVoiceBase (#234)"
```

---

### Task 5: Wire sweep scheduling into the engine

The main integration: `play()` schedules sweeps, `_updateVoices` skips
per-frame formant updates for sweeping voices, and fill changes during
playback retrigger the sweep (cancel + reschedule) instead of rebuilding
the whole voice.

**Files:**
- Modify: `js/audio/engine.ts`
- Modify: `tests/unit/audio-engine.test.js`

**Step 1: Write the failing tests**

Add to `tests/unit/audio-engine.test.js`:

```javascript
describe('AudioEngine — diphthong sweep', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = engine.audioCtx.createGain();
  });

  async function startWith(voices) {
    const state = makeSigilState(voices);
    await engine.play(state, state.envelope);
    return state;
  }

  test('linear fill voice gets hasSweep=true after play', async () => {
    const voice = makeVoice('a', 'sine', {
      fill: { mode: 'linear', h: 0, s: 80, l: 50, h2: 120, s2: 60, l2: 70, gradAngle: 0 },
    });
    await startWith([voice]);

    const audioVoice = engine.activeVoices[0];
    expect(audioVoice.hasSweep).toBe(true);
  });

  test('solid fill voice gets hasSweep=false after play', async () => {
    const voice = makeVoice('a', 'sine', {
      fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    });
    await startWith([voice]);

    const audioVoice = engine.activeVoices[0];
    expect(audioVoice.hasSweep).toBe(false);
  });

  test('linear fill change retrigs sweep without voice rebuild', async () => {
    const voice = makeVoice('a', 'sine', {
      fill: { mode: 'linear', h: 0, s: 80, l: 50, h2: 120, s2: 60, l2: 70, gradAngle: 0 },
    });
    await startWith([voice]);

    const originalVoice = engine.activeVoices[0];

    // Change gradient angle — should retrig, NOT rebuild
    const updated = makeVoice('a', 'sine', {
      fill: { mode: 'linear', h: 0, s: 80, l: 50, h2: 120, s2: 60, l2: 70, gradAngle: 90 },
    });
    engine.update(makeSigilState([updated]));

    const sameVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(sameVoice).toBe(originalVoice); // same object — no rebuild
    expect(sameVoice.hasSweep).toBe(true); // sweep retriggered
    expect(sameVoice.currentFillKey).toContain('90'); // fill key updated
  });

  test('linear fill color change retrigs sweep', async () => {
    const voice = makeVoice('a', 'sine', {
      fill: { mode: 'linear', h: 0, s: 80, l: 50, h2: 120, s2: 60, l2: 70, gradAngle: 0 },
    });
    await startWith([voice]);

    const originalVoice = engine.activeVoices[0];

    // Change h2 color
    const updated = makeVoice('a', 'sine', {
      fill: { mode: 'linear', h: 0, s: 80, l: 50, h2: 200, s2: 60, l2: 70, gradAngle: 0 },
    });
    engine.update(makeSigilState([updated]));

    const sameVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(sameVoice).toBe(originalVoice); // no rebuild
    expect(sameVoice.hasSweep).toBe(true);
  });

  test('solid fill hue change updates formant smoothly (no rebuild)', async () => {
    const voice = makeVoice('a', 'sine', {
      fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    });
    await startWith([voice]);

    const originalVoice = engine.activeVoices[0];

    const updated = makeVoice('a', 'sine', {
      fill: { mode: 'solid', h: 100, s: 80, l: 50 },
    });
    engine.update(makeSigilState([updated]));

    const sameVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(sameVoice).toBe(originalVoice);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/audio-engine.test.js`
Expected: FAIL — `hasSweep` is always `false`, no retrig logic yet.

**Step 3: Implement engine changes**

In `js/audio/engine.ts`:

**3a. Add imports:**

```typescript
import { applyFormantFilter, computeFormantQ, hueToFormants, lightnessToCutoff, scheduleFormantSweep } from './formants.ts';
```

(Replace the existing single import of `applyFormantFilter`.)

**3b. Add private field to AudioEngine:**

```typescript
  private _playEnvelope: Envelope | undefined;
```

**3c. In `play()`, after building voices (after the `for` loop at line ~190),
store envelope and schedule sweeps:**

```typescript
    this._playEnvelope = envelope;

    // Schedule diphthong sweeps for linear-fill voices
    const sweepStart = now + attack;
    for (let i = 0; i < sigilState.voices.length; i++) {
      const voice = sigilState.voices[i]!;
      const av = this.activeVoices[i]!;
      if (voice.fill.mode === 'linear') {
        // Override initial formant to color1 (applyFormantFilter set the blended state)
        const startF = hueToFormants(voice.fill.h);
        const startQ = computeFormantQ(voice.fill.s, voice.waveform);
        const startCutoff = lightnessToCutoff(voice.fill.l);
        av.formantF1.frequency.setValueAtTime(startF.f1, now);
        av.formantF1.Q.setValueAtTime(startQ, now);
        av.formantF2.frequency.setValueAtTime(startF.f2, now);
        av.formantF2.Q.setValueAtTime(startQ * 0.7, now);
        av.brightness.frequency.setValueAtTime(startCutoff, now);

        scheduleFormantSweep(av.formantF1, av.formantF2, av.brightness,
          voice.fill, voice.waveform, sweepStart, decay);
        av.hasSweep = true;
      }
    }
```

**3d. In `_updateVoices()`, after the rebuild block (effect/blend/border
check), add a retrig block for linear fill changes. This goes BEFORE the
existing applyFormantFilter call (line ~371):**

```typescript
      // Retrig diphthong sweep when linear fill params change during playback
      const fillKey = voice.fill.mode === 'linear'
        ? `${voice.fill.h}:${voice.fill.s}:${voice.fill.l}:${voice.fill.h2}:${voice.fill.s2}:${voice.fill.l2}:${voice.fill.gradAngle}`
        : undefined;
      if (audioVoice.hasSweep && fillKey !== audioVoice.currentFillKey && voice.fill.mode === 'linear') {
        // Cancel existing automation and retrig from scratch
        audioVoice.formantF1.frequency.cancelScheduledValues(now);
        audioVoice.formantF1.Q.cancelScheduledValues(now);
        audioVoice.formantF2.frequency.cancelScheduledValues(now);
        audioVoice.formantF2.Q.cancelScheduledValues(now);
        audioVoice.brightness.frequency.cancelScheduledValues(now);

        const startF = hueToFormants(voice.fill.h);
        const startQ = computeFormantQ(voice.fill.s, voice.waveform);
        const startCutoff = lightnessToCutoff(voice.fill.l);
        audioVoice.formantF1.frequency.setValueAtTime(startF.f1, now);
        audioVoice.formantF1.Q.setValueAtTime(startQ, now);
        audioVoice.formantF2.frequency.setValueAtTime(startF.f2, now);
        audioVoice.formantF2.Q.setValueAtTime(startQ * 0.7, now);
        audioVoice.brightness.frequency.setValueAtTime(startCutoff, now);

        const retrigDecay = Math.max(0.01, this._playEnvelope?.decay ?? 0.2);
        scheduleFormantSweep(audioVoice.formantF1, audioVoice.formantF2, audioVoice.brightness,
          voice.fill, voice.waveform, now, retrigDecay);
        audioVoice.currentFillKey = fillKey;
      }
```

**3e. In `_updateVoices()`, skip applyFormantFilter for sweeping voices
(line ~371):**

Replace:
```typescript
      applyFormantFilter(
        audioVoice.formantF1,
        audioVoice.formantF2,
        audioVoice.brightness,
        voice.fill,
        voice.waveform,
      );
```
With:
```typescript
      if (!audioVoice.hasSweep) {
        applyFormantFilter(
          audioVoice.formantF1,
          audioVoice.formantF2,
          audioVoice.brightness,
          voice.fill,
          voice.waveform,
        );
      }
```

**3f. Clear envelope in `_cleanup()`:**

```typescript
    this._playEnvelope = undefined;
```

**3g. Add `setValueCurveAtTime` and `cancelScheduledValues` to the stub in
the test file:**

In `tests/unit/audio-engine.test.js`, update `createStubAudioParam`:

```javascript
function createStubAudioParam(initial = 0) {
  return {
    cancelScheduledValues() {},
    linearRampToValueAtTime() {},
    setValueAtTime(v) {
      this.value = v;
    },
    setValueCurveAtTime() {},
    value: initial,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/audio-engine.test.js`
Expected: All PASS.

**Step 5: Run full test suite**

Run: `bun run test:unit && bun run check`
Expected: All pass.

**Step 6: Commit**

```bash
git add js/audio/engine.ts js/audio/formants.ts tests/unit/audio-engine.test.js
git commit -m "feat: schedule diphthong formant sweeps on play (#234)"
```

---

### Task 6: Verify end-to-end and lint

Run all checks and fix anything that surfaces.

**Step 1: Typecheck**

Run: `bun run check`
Expected: PASS.

**Step 2: Lint**

Run: `bun run lint`
Fix any issues.

**Step 3: Format**

Run: `bun run fmt`

**Step 4: Full test suite**

Run: `bun run test`
Expected: All pass.

**Step 5: Manual smoke test**

Run: `bun run dev`
- Create a shape with a linear gradient fill (two different hues).
- Press play.
- Listen for the formant sweep from color1's vowel to color2's vowel during
  the decay phase.
- Change the gradient angle and replay — verify the easing character changes.
- Try a solid fill — verify no sweep (static formant as before).

**Step 6: Commit any fixups**

```bash
git add -u
git commit -m "chore: lint and format fixes (#234)"
```
