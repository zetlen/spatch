# Volume Slope Curves Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat gain-vs-size curve with per-waveform power curves that converge at medium size, extracted into a Mastering class.

**Architecture:** New `js/audio/mastering.ts` holds all perceptual gain constants and methods. `areaToGain`, `waveformGain`, `shapeAreaFraction` move from `mapping.ts`; `borderOctaveGain` and `OCTAVE_GAIN_COEFF` move from `formants.ts`. Call sites in `voice-builder.ts`, `engine.ts`, and `formants.ts` switch to the new module. Power curve exponents tame square/triangle growth; `waveformGain` multipliers are recomputed so all waveforms converge at size=0.5.

**Tech Stack:** TypeScript, Bun test runner, Playwright for integration tests

---

### Task 1: Write failing unit tests for Mastering class

**Files:**
- Create: `tests/unit/mastering.test.js`

**Step 1: Write the test file**

```js
import { describe, expect, test } from 'bun:test';
import { mastering } from '../../js/audio/mastering.ts';

describe('mastering.shapeAreaFraction', () => {
  test('sine (circle) area = pi * (size/2)^2', () => {
    expect(mastering.shapeAreaFraction('sine', 0.5)).toBeCloseTo(Math.PI * 0.25 * 0.25);
  });

  test('pulse (square) area = size^2', () => {
    expect(mastering.shapeAreaFraction('pulse', 0.5)).toBeCloseTo(0.25);
  });

  test('blend (triangle) area < sine < pulse at same size', () => {
    const size = 0.4;
    const tri = mastering.shapeAreaFraction('blend', size);
    const circ = mastering.shapeAreaFraction('sine', size);
    const sq = mastering.shapeAreaFraction('pulse', size);
    expect(tri).toBeLessThan(circ);
    expect(circ).toBeLessThan(sq);
  });

  test('area scales with size squared', () => {
    for (const type of ['sine', 'pulse', 'blend']) {
      const small = mastering.shapeAreaFraction(type, 0.2);
      const big = mastering.shapeAreaFraction(type, 0.4);
      expect(big / small).toBeCloseTo(4);
    }
  });
});

describe('mastering.areaToGain', () => {
  test('tiny shape returns near-minimum gain', () => {
    expect(mastering.areaToGain('sine', 0.025)).toBeCloseTo(mastering.GAIN_MIN, 1);
  });

  test('large shape caps at GAIN_MAX', () => {
    expect(mastering.areaToGain('pulse', 0.95)).toBe(mastering.GAIN_MAX);
    expect(mastering.areaToGain('sine', 0.95)).toBe(mastering.GAIN_MAX);
    expect(mastering.areaToGain('blend', 0.95)).toBe(mastering.GAIN_MAX);
  });

  test('gain increases with size for all waveforms', () => {
    for (const type of ['sine', 'pulse', 'blend']) {
      const small = mastering.areaToGain(type, 0.2);
      const big = mastering.areaToGain(type, 0.5);
      expect(big).toBeGreaterThan(small);
    }
  });

  test('pulse ramps slower than sine at small sizes', () => {
    const sineGain = mastering.areaToGain('sine', 0.3);
    const pulseGain = mastering.areaToGain('pulse', 0.3);
    expect(pulseGain).toBeLessThan(sineGain);
  });

  test('blend ramps slower than sine at small sizes', () => {
    const sineGain = mastering.areaToGain('sine', 0.3);
    const blendGain = mastering.areaToGain('blend', 0.3);
    expect(blendGain).toBeLessThan(sineGain);
  });
});

describe('mastering.waveformGain', () => {
  test('all waveforms return positive values', () => {
    for (const wf of ['sine', 'pulse', 'blend']) {
      expect(mastering.waveformGain(wf)).toBeGreaterThan(0);
    }
  });

  test('sine is boosted above 1.0', () => {
    expect(mastering.waveformGain('sine')).toBeGreaterThan(1);
  });

  test('pulse is attenuated below 1.0', () => {
    expect(mastering.waveformGain('pulse')).toBeLessThan(1);
  });
});

describe('mastering.voiceGain — convergence at medium size', () => {
  test('at size=0.5, all waveforms produce gain within 10% of each other', () => {
    const sineGain = mastering.voiceGain('sine', 0.5);
    const pulseGain = mastering.voiceGain('pulse', 0.5);
    const blendGain = mastering.voiceGain('blend', 0.5);

    const avg = (sineGain + pulseGain + blendGain) / 3;
    expect(Math.abs(sineGain - avg) / avg).toBeLessThan(0.1);
    expect(Math.abs(pulseGain - avg) / avg).toBeLessThan(0.1);
    expect(Math.abs(blendGain - avg) / avg).toBeLessThan(0.1);
  });

  test('monotonically increases with size for all waveforms', () => {
    for (const wf of ['sine', 'pulse', 'blend']) {
      let prev = mastering.voiceGain(wf, 0.05);
      for (let s = 0.1; s <= 0.95; s += 0.05) {
        const g = mastering.voiceGain(wf, s);
        expect(g).toBeGreaterThanOrEqual(prev);
        prev = g;
      }
    }
  });

  test('all waveforms hit GAIN_MAX at size near 1', () => {
    for (const wf of ['sine', 'pulse', 'blend']) {
      const g = mastering.voiceGain(wf, 0.95);
      // voiceGain = areaToGain * waveformGain; areaToGain caps at GAIN_MAX
      // so voiceGain caps at GAIN_MAX * waveformGain
      expect(g).toBeGreaterThan(0);
    }
  });
});

describe('mastering.borderOctaveGain', () => {
  test('returns 0 for zero thickness', () => {
    expect(mastering.borderOctaveGain('sine', 0.5, 0, 'white', false)).toBe(0);
  });

  test('scales with shape size (larger shape = louder)', () => {
    const small = mastering.borderOctaveGain('sine', 0.2, 0.5, 'white', false);
    const large = mastering.borderOctaveGain('sine', 0.6, 0.5, 'white', false);
    expect(large).toBeGreaterThan(small);
  });

  test('scales with thickness', () => {
    const thin = mastering.borderOctaveGain('sine', 0.5, 0.2, 'white', false);
    const thick = mastering.borderOctaveGain('sine', 0.5, 0.8, 'white', false);
    expect(thick).toBeGreaterThan(thin);
  });

  test('octave up (white) is quieter than octave down (black)', () => {
    const up = mastering.borderOctaveGain('sine', 0.5, 0.5, 'white', false);
    const down = mastering.borderOctaveGain('sine', 0.5, 0.5, 'black', false);
    expect(down).toBeGreaterThan(up);
  });

  test('double octave up is quieter than single octave up', () => {
    const single = mastering.borderOctaveGain('sine', 0.5, 0.5, 'white', false);
    const double = mastering.borderOctaveGain('sine', 0.5, 0.5, 'white', true);
    expect(double).toBeLessThan(single);
  });

  test('double octave down is louder than single octave down', () => {
    const single = mastering.borderOctaveGain('sine', 0.5, 0.5, 'black', false);
    const double = mastering.borderOctaveGain('sine', 0.5, 0.5, 'black', true);
    expect(double).toBeGreaterThan(single);
  });

  test('different waveforms at same size produce different gains', () => {
    const sine = mastering.borderOctaveGain('sine', 0.5, 0.5, 'white', false);
    const pulse = mastering.borderOctaveGain('pulse', 0.5, 0.5, 'white', false);
    expect(sine).not.toBeCloseTo(pulse, 2);
  });

  test('always returns non-negative', () => {
    for (const wf of ['sine', 'pulse', 'blend']) {
      for (const color of ['white', 'black']) {
        for (const dbl of [false, true]) {
          const g = mastering.borderOctaveGain(wf, 0.5, 0.5, color, dbl);
          expect(g).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/mastering.test.js`
Expected: FAIL — module `../../js/audio/mastering.ts` does not exist

**Step 3: Commit**

```bash
git add tests/unit/mastering.test.js
git commit -m "test: add failing unit tests for Mastering class (#166)"
```

---

### Task 2: Create Mastering class to make unit tests pass

**Files:**
- Create: `js/audio/mastering.ts`

**Step 1: Write the Mastering class**

```ts
// mastering.ts — Perceptual gain tuning constants and methods.
// Pure math, no Web Audio API dependencies.

import type { BorderColor, NormalizedCoord, WaveformType } from '../types.ts';

// Maximum area at size=1 for each waveform, used to normalize fractions to [0,1].
const MAX_AREA: Record<WaveformType, number> = {
  sine: Math.PI * 0.25,          // pi * (0.5)^2
  pulse: 1,                       // 1^2
  blend: (3 * Math.sqrt(3)) / 16, // (3*sqrt(3)/4) * (0.5)^2
};

export class Mastering {
  readonly GAIN_MIN = 0.05;
  readonly GAIN_MAX = 0.8;

  /** Per-waveform power exponents for the gain curve. Higher = slower ramp. */
  readonly GAIN_EXPONENT: Record<WaveformType, number> = {
    sine: 1.0,
    pulse: 1.6,
    blend: 1.3,
  };

  /**
   * Per-waveform loudness multipliers, computed to make voiceGain converge
   * at size=0.5. Sine is boosted (single partial), pulse/blend attenuated
   * (rich harmonics).
   */
  readonly WAVEFORM_GAIN: Record<WaveformType, number>;

  /** Direction-dependent loudness coefficients for border octave oscillator. */
  readonly OCTAVE_GAIN_COEFF: Record<string, number> = {
    'up-1': 0.5,
    'up-2': 0.35,
    'down-1': 1.5,
    'down-2': 2,
  };

  constructor() {
    // Compute waveformGain multipliers so voiceGain converges at size=0.5.
    // Pick sine as the reference, then scale others to match.
    const refSize = 0.5 as NormalizedCoord;
    const refAreaGain = this._rawAreaToGain('sine', refSize);
    const refMultiplier = 1.6; // Sine boost (preserves existing feel)
    const refVoiceGain = refAreaGain * refMultiplier;

    const wg: Record<string, number> = { sine: refMultiplier };
    for (const wf of ['pulse', 'blend'] as WaveformType[]) {
      const ag = this._rawAreaToGain(wf, refSize);
      wg[wf] = refVoiceGain / ag;
    }
    this.WAVEFORM_GAIN = wg as Record<WaveformType, number>;
  }

  /** Compute area of a shape as a fraction of the 1x1 canvas. */
  shapeAreaFraction(waveform: WaveformType, size: NormalizedCoord): number {
    const halfSize = size / 2;
    switch (waveform) {
      case 'sine':
        return Math.PI * halfSize * halfSize;
      case 'pulse':
        return size * size;
      case 'blend':
        return ((3 * Math.sqrt(3)) / 4) * halfSize * halfSize;
    }
  }

  /**
   * Map shape area to gain using a per-waveform power curve.
   * Area is normalized to [0,1] then raised to the waveform's exponent.
   */
  areaToGain(waveform: WaveformType, size: NormalizedCoord): number {
    return this._rawAreaToGain(waveform, size);
  }

  /** Per-waveform loudness multiplier. */
  waveformGain(waveform: WaveformType): number {
    return this.WAVEFORM_GAIN[waveform];
  }

  /** Combined gain: areaToGain * waveformGain. */
  voiceGain(waveform: WaveformType, size: NormalizedCoord): number {
    return this.areaToGain(waveform, size) * this.waveformGain(waveform);
  }

  /** Gain for a border's octave-doubled oscillator. */
  borderOctaveGain(
    waveform: WaveformType,
    size: NormalizedCoord,
    thickness: NormalizedCoord,
    color: BorderColor,
    double: boolean,
  ): number {
    const baseGain = this.voiceGain(waveform, size);
    const direction = color === 'white' ? 'up' : 'down';
    const shift = double ? 2 : 1;
    const coeff = this.OCTAVE_GAIN_COEFF[`${direction}-${shift}`]!;
    return baseGain * Math.sqrt(thickness) * coeff;
  }

  /** Internal: area-to-gain with power curve, before waveformGain multiplier. */
  private _rawAreaToGain(waveform: WaveformType, size: NormalizedCoord): number {
    const fraction = this.shapeAreaFraction(waveform, size);
    const normalized = Math.min(1, fraction / MAX_AREA[waveform]);
    const curved = normalized ** this.GAIN_EXPONENT[waveform];
    return Math.min(this.GAIN_MAX, this.GAIN_MIN + (this.GAIN_MAX - this.GAIN_MIN) * curved);
  }
}

/** Default mastering instance. Import this in place of the old free functions. */
export const mastering = new Mastering();
```

**Step 2: Run tests to verify they pass**

Run: `bun test tests/unit/mastering.test.js`
Expected: All tests PASS

If the convergence test fails (>10% spread at size=0.5), adjust `refMultiplier`
or exponents. The constructor auto-computes the other multipliers, so only the
sine reference and exponents need manual tuning.

**Step 3: Run typecheck**

Run: `bun run check`
Expected: PASS

**Step 4: Commit**

```bash
git add js/audio/mastering.ts
git commit -m "feat: add Mastering class with per-waveform gain curves (#166)"
```

---

### Task 3: Migrate call sites to use mastering module

**Files:**
- Modify: `js/audio/voice-builder.ts` (lines 16-17)
- Modify: `js/audio/engine.ts` (lines 11-12, 323-324, 346-355)
- Modify: `js/audio/formants.ts` (line 7, lines 37-49)
- Modify: `js/audio/mapping.ts` (remove lines 97-197)

**Step 1: Update `voice-builder.ts` imports and usage**

Replace line 16:
```ts
import { areaToGain, waveformGain, xToPan, yToFrequency } from './mapping.ts';
```
with:
```ts
import { xToPan, yToFrequency } from './mapping.ts';
import { mastering } from './mastering.ts';
```

Replace line 17:
```ts
import { applyFormantFilter, borderOctaveGain } from './formants.ts';
```
with:
```ts
import { applyFormantFilter } from './formants.ts';
```

Replace line 153 (`gain.gain.value = ...`):
```ts
gain.gain.value = mastering.voiceGain(voice.waveform, voice.size);
```

Replace lines 221-227 (`octaveGainNode.gain.value = borderOctaveGain(...)`):
```ts
octaveGainNode.gain.value = mastering.borderOctaveGain(
  voice.waveform,
  voice.size,
  voice.border.thickness,
  voice.border.color,
  voice.border.double,
);
```

**Step 2: Update `engine.ts` imports and usage**

Replace line 11:
```ts
import { areaToGain, waveformGain, xToPan, yToFrequency } from './mapping.ts';
```
with:
```ts
import { xToPan, yToFrequency } from './mapping.ts';
import { mastering } from './mastering.ts';
```

Replace line 12:
```ts
import { applyFormantFilter, borderOctaveGain } from './formants.ts';
```
with:
```ts
import { applyFormantFilter } from './formants.ts';
```

Replace line 323-325 (`audioVoice.gain.gain.setValueAtTime(...)`):
```ts
audioVoice.gain.gain.setValueAtTime(
  mastering.voiceGain(voice.waveform, voice.size),
  now,
);
```

Replace lines 346-356 (`borderOctaveGain(...)` call):
```ts
audioVoice.octaveGainNode.gain.setValueAtTime(
  mastering.borderOctaveGain(
    voice.waveform,
    voice.size,
    voice.border.thickness,
    voice.border.color,
    voice.border.double,
  ),
  now,
);
```

**Step 3: Update `formants.ts`**

Remove lines 7 (`import { areaToGain, waveformGain } from './mapping.ts';`).

Remove lines 9-49 (the entire `OCTAVE_GAIN_COEFF` constant, the `borderOctaveGain`
function, and the section comment). The `borderOctaveGain` export is no longer
needed — it now lives in mastering.ts. Keep the formant filter code unchanged.

**Step 4: Remove moved functions from `mapping.ts`**

Remove lines 97-197: `shapeAreaFraction`, `areaToGain`, `waveformGain`, and
their doc comments. Keep `yToFrequency`, `snapYToNote`, `xToPan`,
`rotationToTimbre` and their constants.

**Step 5: Run typecheck**

Run: `bun run check`
Expected: PASS — all imports resolve, no type errors

**Step 6: Run all unit tests**

Run: `bun test`
Expected: `audio-mapping.test.js` FAILS (imports removed functions).
`mastering.test.js` PASSES. Other tests PASS.

**Step 7: Commit the migration (tests will be fixed in next task)**

```bash
git add js/audio/mastering.ts js/audio/mapping.ts js/audio/formants.ts js/audio/voice-builder.ts js/audio/engine.ts
git commit -m "refactor: migrate gain functions to Mastering class (#166)"
```

---

### Task 4: Update unit test imports

**Files:**
- Modify: `tests/unit/audio-mapping.test.js`

**Step 1: Update imports and remove moved tests**

The test file currently imports `areaToGain`, `waveformGain`, `shapeAreaFraction`
from `mapping.ts` and `borderOctaveGain` from `formants.ts`. These functions
no longer exist at those paths. Their tests are now covered by
`mastering.test.js`.

Remove these imports from line 10-11:
- `areaToGain`
- `shapeAreaFraction`
- `waveformGain`
- `borderOctaveGain`

So line 10 becomes:
```js
import {
  rotationToTimbre,
  snapYToNote,
  xToPan,
  yToFrequency,
} from '../../js/audio/mapping.ts';
```

Line 11 becomes:
```js
import { hueToFormants, lightnessToCutoff } from '../../js/audio/formants.ts';
```

Remove the `describe` blocks for:
- `waveformGain` (lines 140-158)
- `shapeAreaFraction` (lines 160-186)
- `areaToGain` (lines 188-212)
- `borderOctaveGain` (lines 356-407)

Keep all other `describe` blocks unchanged (`yToFrequency`, `xToPan`,
`rotationToTimbre`, `snapYToNote`, `lightnessToCutoff`, `hueToFormants`).

**Step 2: Run all unit tests**

Run: `bun test`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/unit/audio-mapping.test.js
git commit -m "test: update audio-mapping tests for mastering extraction (#166)"
```

---

### Task 5: Add integration tests for relative loudness

**Files:**
- Modify: `tests/integration/playback.test.js`

These tests use the existing `__audioTap` helper (injected via
`tests/integration/helpers/audio-tap.js`) to read real Web Audio amplitude
from the browser's AnalyserNode.

**Step 1: Add a helper function and new test cases**

Add these tests to the existing `Playback` describe block in
`tests/integration/playback.test.js`:

```js
test('medium-size shapes produce similar amplitude across waveforms', async ({ page }) => {
  // Helper: place a shape of given tool at canvas center, play, measure amplitude
  async function measureAmplitude(tool) {
    // Clear canvas: select all + delete
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    // Place shape
    await page.click(`[data-tool="${tool}"]`);
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Resize to ~50% of canvas (medium size)
    // The default placement size is 0.12; we need to resize via the store
    await page.evaluate(() => {
      const store = globalThis.__spatchStore;
      if (store) {
        const voices = store.get().voices;
        const last = voices[voices.length - 1];
        if (last) store.updateVoice(last.id, { size: 0.5 });
      }
    });

    // Latch play
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);

    // Sample amplitude several times and average
    const amplitude = await page.evaluate(() => {
      const tap = globalThis.__audioTap;
      if (!tap) return 0;
      let sum = 0;
      const samples = 5;
      for (let i = 0; i < samples; i++) {
        sum += tap.getAmplitude();
      }
      return sum / samples;
    });

    // Stop
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);

    return amplitude;
  }

  const sineAmp = await measureAmplitude('circle');
  const pulseAmp = await measureAmplitude('square');
  const blendAmp = await measureAmplitude('triangle');

  // All should be non-zero
  expect(sineAmp).toBeGreaterThan(0.001);
  expect(pulseAmp).toBeGreaterThan(0.001);
  expect(blendAmp).toBeGreaterThan(0.001);

  // At medium size, amplitudes should be within 3x of each other
  // (generous tolerance — compressor, formants, and waveform content all affect RMS)
  const maxAmp = Math.max(sineAmp, pulseAmp, blendAmp);
  const minAmp = Math.min(sineAmp, pulseAmp, blendAmp);
  expect(maxAmp / minAmp).toBeLessThan(3);
});
```

Note: This test needs `__spatchStore` exposed globally. Check if it already is;
if not, add a one-line exposure in the audio-tap or skip-splash init script:

```js
// In skip-splash.js or a new helpers/expose-store.js:
// globalThis.__spatchStore is set by app.ts — check if it's already exposed
```

If `__spatchStore` is not exposed, an alternative is to place shapes at specific
canvas positions where the default size gives predictable area, or resize by
dragging a corner handle. The simplest approach is to expose the store for tests.
Check `js/app.ts` for whether the store is already on `globalThis`.

**Step 2: Run integration tests**

Run: `bun run test:e2e` (requires dev server running)
Expected: PASS

If the store is not exposed, you'll need to either:
- Add `globalThis.__spatchStore = store;` in `js/app.ts` (guarded by a check
  for test environment), or
- Use the Playwright `page.evaluate` to find the store via module scope, or
- Resize shapes via drag interaction instead of direct store mutation

**Step 3: Commit**

```bash
git add tests/integration/playback.test.js
git commit -m "test: add integration tests for relative loudness across waveforms (#166)"
```

---

### Task 6: Final verification

**Step 1: Run full test suite**

Run: `bun run test`
Expected: All unit + integration tests PASS

**Step 2: Run typecheck**

Run: `bun run check`
Expected: PASS

**Step 3: Run lint**

Run: `bun run lint`
Expected: PASS (or only pre-existing warnings)

**Step 4: Run format**

Run: `bun run fmt`
Expected: Files formatted (commit any changes)

**Step 5: Final commit if needed**

```bash
git add -A
git commit -m "chore: format and lint fixes (#166)"
```
