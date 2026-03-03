# Shrillness Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make spatch sound warmer and less harsh by lowering pitch range, replacing the ineffective brightness highshelf with a lowpass filter, removing the aggressive auto EQ, taming formant Q, and giving sines subtle harmonic presence.

**Architecture:** All changes are in `js/audio.ts`. The signal chain topology simplifies (auto EQ removal) but otherwise stays the same. Pure functions (`yToFrequency`, `waveformGain`, `applyFormantFilter`) get parameter tweaks. `_buildVoice` gets a new waveshaper for sine voices. `play()` loses EQ band creation. No serialization, canvas, or type changes.

**Tech Stack:** TypeScript, Web Audio API, bun test

**Design doc:** `docs/plans/2026-03-03-shrillness-fix-design.md`

---

### Task 1: Lower base pitch from C3 to G2

**Files:**
- Modify: `js/audio.ts:33` — change `BASE_MIDI`
- Modify: `tests/unit/audio-mapping.test.js` — update frequency expectations

**Step 1: Update the tests to expect the new frequencies**

In `tests/unit/audio-mapping.test.js`, the following values change:

- `BASE_MIDI` 48 → 43 (G2 instead of C3)
- y=1 (bottom): MIDI 43 → `440 * 2^((43-69)/12)` ≈ 98.00 Hz (G2)
- y=0 (top): MIDI 43+36=79 → `440 * 2^((79-69)/12)` ≈ 783.99 Hz (G5)
- The micro-detuning max stays at ±40 cents

Update these tests in `audio-mapping.test.js`:

```js
// yToFrequency: 'y=0 (top) returns highest pentatonic note'
// y=0 → normalized=1 → index=15 → semitone 36 → MIDI 79 → G5
// 440 * 2^((79-69)/12) ≈ 783.99
expect(freq).toBeCloseTo(783.99, 0);

// yToFrequency: 'y=1 (bottom) returns lowest pentatonic note'
// y=1 → normalized=0 → index=0 → semitone 0 → MIDI 43 → G2
// 440 * 2^((43-69)/12) ≈ 98.00
expect(freq).toBeCloseTo(98.0, 0);

// 'exact note position has no micro-detuning'
expect(freqTop).toBeCloseTo(783.99, 0);  // G5
expect(freqBottom).toBeCloseTo(98.0, 0); // G2

// 'between-note positions produce micro-detuned pitch'
// y=0.5 → continuous=7.5, rounds to index 8 → semitone 19 (B3)
// MIDI 43+19=62 → 440 * 2^((62-69)/12) ≈ 293.66
// With detuning ~-36 cents: slightly flat
const freq = yToFrequency(0.5);
expect(freq).toBeLessThan(293.66);
expect(freq).toBeGreaterThan(284.0);

// 'micro-detuning stays within ±40 cents' — update BASE_MIDI in the loop:
const baseFreq = 440 * Math.pow(2, (43 + semitones[clamped] - 69) / 12);
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/audio-mapping.test.js`
Expected: FAIL — old frequencies don't match new expectations

**Step 3: Change BASE_MIDI in audio.ts**

In `js/audio.ts` line 33, change:
```ts
const BASE_MIDI = 43; // G2
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/audio-mapping.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add js/audio.ts tests/unit/audio-mapping.test.js
git commit -m "fix: lower base pitch from C3 to G2 (#116)"
```

---

### Task 2: Replace brightness highshelf with lowpass cutoff from lightness

**Files:**
- Modify: `js/audio.ts` — `applyFormantFilter` function and `_buildVoice` brightness node setup
- Modify: `tests/unit/audio-mapping.test.js` — add new export + tests

**Step 1: Export and test the new lightness→cutoff mapping**

Add a new exported pure function `lightnessToCutoff(lightness: number): number` to `audio.ts`. This is a pure function we can unit test directly.

Add tests in `tests/unit/audio-mapping.test.js`:

```js
import { lightnessToCutoff } from '../../js/audio.ts';

describe('lightnessToCutoff', () => {
  test('lightness 0 (black) returns ~300 Hz', () => {
    const freq = lightnessToCutoff(0);
    expect(freq).toBeCloseTo(300, -1); // within 10 Hz
  });

  test('lightness 50 (mid) returns ~2500 Hz', () => {
    const freq = lightnessToCutoff(50);
    expect(freq).toBeCloseTo(2500, -2); // within 100 Hz
  });

  test('lightness 100 (white) returns ~12000 Hz', () => {
    const freq = lightnessToCutoff(100);
    expect(freq).toBeCloseTo(12000, -2); // within 100 Hz
  });

  test('monotonically increasing', () => {
    let prev = lightnessToCutoff(0);
    for (let l = 1; l <= 100; l++) {
      const freq = lightnessToCutoff(l);
      expect(freq).toBeGreaterThan(prev);
      prev = freq;
    }
  });

  test('always returns positive frequency', () => {
    for (let l = 0; l <= 100; l++) {
      expect(lightnessToCutoff(l)).toBeGreaterThan(0);
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/audio-mapping.test.js`
Expected: FAIL — `lightnessToCutoff` not exported

**Step 3: Implement lightnessToCutoff and update applyFormantFilter**

Add to `js/audio.ts` (near the other mapping functions):

```ts
// Lightness → lowpass cutoff: exponential mapping from dark (muffled) to light (open).
// 300 Hz at black, ~2500 Hz at mid grey, 12000 Hz at white.
export function lightnessToCutoff(lightness: number): number {
  const t = lightness / 100; // 0–1
  return 300 * Math.pow(12000 / 300, t); // exponential: 300 → 12000
}
```

In `applyFormantFilter`, replace the brightness highshelf logic. Change:
```ts
// Lightness -> brightness shelf: dark = muffled, light = bright
brightnessNode.gain.value = (l / 100) * 14 - 7; // -7 to +7 dB
```
to:
```ts
// Lightness -> lowpass cutoff: dark = muffled, light = open
brightnessNode.frequency.value = lightnessToCutoff(l);
```

In `_buildVoice`, change the brightness node setup from:
```ts
brightness.type = 'highshelf';
brightness.frequency.value = 2000;
```
to:
```ts
brightness.type = 'lowpass';
brightness.Q.value = 0.707; // Butterworth — no resonant peak
```

(Remove the fixed `frequency.value = 2000` line — `applyFormantFilter` sets the frequency dynamically.)

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/audio-mapping.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add js/audio.ts tests/unit/audio-mapping.test.js
git commit -m "fix: replace brightness highshelf with lowpass cutoff from lightness (#116)"
```

---

### Task 3: Remove auto EQ

**Files:**
- Modify: `js/audio.ts` — remove `spectralNeed`, `MAX_EQ_BANDS`, `_autoEQ`, `_applyAutoEQ`, and EQ wiring in `play()`
- Modify: `tests/unit/audio-engine.test.js` — remove the entire "auto EQ" describe block

**Step 1: Delete the auto EQ test block**

Remove the entire `describe('AudioEngine — auto EQ', ...)` block from `tests/unit/audio-engine.test.js` (the block starting at line ~242 and ending at ~320).

**Step 2: Run tests to verify they pass (no test references removed code yet)**

Run: `bun test tests/unit/audio-engine.test.js`
Expected: PASS (tests pass but the code still exists)

**Step 3: Remove auto EQ from audio.ts**

1. Delete the `spectralNeed` function and `MAX_EQ_BANDS` constant.
2. Remove the `_autoEQ: BiquadFilterNode[]` field and its initialization in the constructor.
3. Remove `_applyAutoEQ` method entirely.
4. In `play()`:
   - Remove the EQ band pool creation loop (`for (let i = 0; i < poolSize ...`)
   - Remove the EQ band wiring loop (the `let prev: AudioNode = this.masterGain` / band chaining)
   - Wire directly: `this.masterGain.connect(this.envelopeGain)`
   - Remove the `this._applyAutoEQ(sigilState.voices)` call
5. In `updateVoices()`:
   - Remove `this._applyAutoEQ(sigilState.voices)` call
6. In `_cleanup()`:
   - Remove the `for (const band of this._autoEQ)` cleanup loop and `this._autoEQ = []`

**Step 4: Run all tests**

Run: `bun test tests/unit/audio-engine.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add js/audio.ts tests/unit/audio-engine.test.js
git commit -m "fix: remove aggressive auto EQ in favor of per-voice lowpass (#116)"
```

---

### Task 4: Reduce formant max Q from 12 to 8

**Files:**
- Modify: `js/audio.ts:232` — change `maxQ` in `applyFormantFilter`

**Step 1: No test changes needed**

The formant Q isn't directly tested via exported pure functions — it's an internal parameter of `applyFormantFilter`. The existing audio-engine integration tests still pass because they use stubs. This is a simple constant change.

**Step 2: Change maxQ in applyFormantFilter**

In `js/audio.ts`, in `applyFormantFilter`, change:
```ts
const maxQ = waveform === 'sine' ? 4 : 12;
```
to:
```ts
const maxQ = waveform === 'sine' ? 4 : 8;
```

**Step 3: Run tests**

Run: `bun test tests/unit/audio-engine.test.js tests/unit/audio-mapping.test.js`
Expected: PASS

**Step 4: Commit**

```bash
git add js/audio.ts
git commit -m "fix: reduce formant max Q from 12 to 8 to tame harsh resonances (#116)"
```

---

### Task 5: Sine presence — gain bump + subtle waveshaper

**Files:**
- Modify: `js/audio.ts` — `waveformGain` and `_buildVoice` sine branch
- Modify: `tests/unit/audio-mapping.test.js` — update `waveformGain('sine')` expectation

**Step 1: Update the waveformGain test**

In `tests/unit/audio-mapping.test.js`, change:
```js
test('sine is boosted for perceived loudness matching', () => {
  expect(waveformGain('sine')).toBe(1.4);
});
```
to:
```js
test('sine is boosted for perceived loudness matching', () => {
  expect(waveformGain('sine')).toBe(1.6);
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/audio-mapping.test.js`
Expected: FAIL — expects 1.6, gets 1.4

**Step 3: Implement the changes**

In `js/audio.ts`, change `waveformGain`:
```ts
case 'sine':
  return 1.6; // sine is single-partial; boost to match perceived loudness
```

In `_buildVoice`, the sine branch (near end of function), add a gentle waveshaper between oscillator and gain node. Change:
```ts
// Sine -- default
const osc = ctx.createOscillator();
osc.type = 'sine';
osc.frequency.value = freq;
osc.connect(gain);
```
to:
```ts
// Sine -- default, with subtle harmonic enrichment (analog impurity)
const osc = ctx.createOscillator();
osc.type = 'sine';
osc.frequency.value = freq;

const sineWarm = ctx.createWaveShaper();
const warmSamples = 1024;
const warmCurve = new Float32Array(warmSamples);
for (let i = 0; i < warmSamples; i++) {
  const x = (i * 2) / warmSamples - 1;
  warmCurve[i] = Math.tanh(x * 1.5);
}
sineWarm.curve = warmCurve;
sineWarm.oversample = '2x';

osc.connect(sineWarm);
sineWarm.connect(gain);
```

**Step 4: Run tests**

Run: `bun test tests/unit/audio-mapping.test.js tests/unit/audio-engine.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add js/audio.ts tests/unit/audio-mapping.test.js
git commit -m "fix: add sine warmth via gain bump and subtle waveshaper (#116)"
```

---

### Task 6: Run full test suite and typecheck

**Step 1: Run all tests**

Run: `bun run test:unit`
Expected: All pass

**Step 2: Typecheck**

Run: `bun run check`
Expected: No errors

**Step 3: Lint**

Run: `bun run lint`
Expected: No errors

**Step 4: Build**

Run: `bun run dev`
Expected: Successful build

**Step 5: Manual listening test**

Start dev server (`bunx serve dist`), open in browser, place shapes, press play.
Verify:
- Overall pitch is noticeably lower/warmer than before
- Dark-colored shapes sound muffled; light-colored shapes sound bright
- Sines (circles) are audible in a mix with squares and triangles
- No harsh ringing or shrill peaks
- Squares and triangles have controlled treble, not ice-picky
