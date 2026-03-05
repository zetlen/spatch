# Border Octave Oscillator Gain Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix border octave oscillator so its gain tracks shape size and thickness changes don't cause audio glitches.

**Architecture:** Add a `borderOctaveGain()` pure function with direction-dependent loudness coefficients. Store the octave GainNode on the audio voice. Split `borderKey` so only topology changes (color, double) trigger rebuilds; thickness updates flow through the smooth parameter path.

**Tech Stack:** TypeScript, Web Audio API, Bun test runner

---

### Task 1: Add `borderOctaveGain` helper and unit tests

**Files:**
- Modify: `js/audio.ts` (add exported function after `waveformGain`)
- Modify: `tests/unit/audio-mapping.test.js` (add test describe block)

**Step 1: Write the failing tests**

Add to `tests/unit/audio-mapping.test.js`:

```js
import {
  // ... existing imports ...
  borderOctaveGain,
} from '../../js/audio.ts';

// ... existing tests ...

describe('borderOctaveGain', () => {
  test('returns 0 for zero thickness', () => {
    expect(borderOctaveGain('sine', 0.5, 0, 'white', false)).toBe(0);
  });

  test('scales with shape size (larger shape = louder)', () => {
    const small = borderOctaveGain('sine', 0.2, 0.5, 'white', false);
    const large = borderOctaveGain('sine', 0.6, 0.5, 'white', false);
    expect(large).toBeGreaterThan(small);
  });

  test('scales with thickness', () => {
    const thin = borderOctaveGain('sine', 0.5, 0.2, 'white', false);
    const thick = borderOctaveGain('sine', 0.5, 0.8, 'white', false);
    expect(thick).toBeGreaterThan(thin);
  });

  test('octave up (white) is quieter than octave down (black)', () => {
    const up = borderOctaveGain('sine', 0.5, 0.5, 'white', false);
    const down = borderOctaveGain('sine', 0.5, 0.5, 'black', false);
    expect(down).toBeGreaterThan(up);
  });

  test('double octave up is quieter than single octave up', () => {
    const single = borderOctaveGain('sine', 0.5, 0.5, 'white', false);
    const double = borderOctaveGain('sine', 0.5, 0.5, 'white', true);
    expect(double).toBeLessThan(single);
  });

  test('double octave down is louder than single octave down', () => {
    const single = borderOctaveGain('sine', 0.5, 0.5, 'black', false);
    const double = borderOctaveGain('sine', 0.5, 0.5, 'black', true);
    expect(double).toBeGreaterThan(single);
  });

  test('different waveforms at same size produce different gains', () => {
    const sine = borderOctaveGain('sine', 0.5, 0.5, 'white', false);
    const pulse = borderOctaveGain('pulse', 0.5, 0.5, 'white', false);
    expect(sine).not.toBeCloseTo(pulse, 2);
  });

  test('always returns non-negative', () => {
    for (const wf of ['sine', 'pulse', 'blend']) {
      for (const color of ['white', 'black']) {
        for (const dbl of [false, true]) {
          const g = borderOctaveGain(wf, 0.5, 0.5, color, dbl);
          expect(g).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/audio-mapping.test.js`
Expected: FAIL — `borderOctaveGain` is not exported from audio.ts

**Step 3: Write the implementation**

Add to `js/audio.ts` after `waveformGain`, and add to the export:

```ts
// Direction-dependent loudness coefficients for octave-doubled border oscillator.
// Higher octaves sound louder perceptually (equal-loudness contours), so we
// attenuate up-shifts and boost down-shifts.
const OCTAVE_GAIN_COEFF: Record<string, number> = {
  'up-1': 0.5,
  'up-2': 0.35,
  'down-1': 1.5,
  'down-2': 2.0,
};

export function borderOctaveGain(
  waveform: WaveformType,
  size: NormalizedCoord,
  thickness: NormalizedCoord,
  color: BorderColor,
  double: boolean,
): number {
  const baseGain = areaToGain(waveform, size) * waveformGain(waveform);
  const direction = color === 'white' ? 'up' : 'down';
  const shift = double ? 2 : 1;
  const coeff = OCTAVE_GAIN_COEFF[`${direction}-${shift}`]!;
  return baseGain * Math.sqrt(thickness) * coeff;
}
```

Add `BorderColor` to the imports from `types.ts`.

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/audio-mapping.test.js`
Expected: All PASS

**Step 5: Commit**

```
feat(audio): add borderOctaveGain with direction-dependent loudness coefficients
```

---

### Task 2: Store octave gain node and use `borderOctaveGain` in `_buildVoice`

**Files:**
- Modify: `js/audio.ts:286-298` (add `octaveGainNode` to `AudioVoiceBase`)
- Modify: `js/audio.ts:868-893` (use `borderOctaveGain` in `_buildVoice`)

**Step 1: Add `octaveGainNode` to `AudioVoiceBase`**

In `AudioVoiceBase` interface, add:
```ts
octaveGainNode: GainNode | null;
```

**Step 2: Update `_buildVoice` to use `borderOctaveGain` and store the node**

Replace the octave gain section (~lines 885-889):
```ts
// Old:
const octaveGain = ctx.createGain();
octaveGain.gain.value = Math.sqrt(voice.border.thickness);
octaveOsc.connect(octaveGain);
octaveGain.connect(formantMixer);
```

With:
```ts
const octaveGainNode = ctx.createGain();
octaveGainNode.gain.value = borderOctaveGain(
  voice.waveform, voice.size, voice.border.thickness,
  voice.border.color, voice.border.double,
);
octaveOsc.connect(octaveGainNode);
octaveGainNode.connect(formantMixer);
```

**Step 3: Store `octaveGainNode` in the shared object**

In the `shared` object (~line 896), change:
```ts
// Old line in shared:
octaveOsc,
// Add:
octaveGainNode: voice.border ? octaveGainNode : null,
```

Note: `octaveGainNode` is only defined inside the `if (voice.border)` block,
so set it to `null` in the else case. The cleanest way: declare
`let octaveGainNode: GainNode | null = null;` before the `if (voice.border)`
block, and assign inside.

**Step 4: Run existing tests to verify nothing broke**

Run: `bun test tests/unit/audio-engine.test.js`
Expected: All PASS

**Step 5: Commit**

```
refactor(audio): store octaveGainNode and use borderOctaveGain in _buildVoice
```

---

### Task 3: Split border key and add smooth thickness updates

**Files:**
- Modify: `js/audio.ts:612-668` (`updateVoices` method)
- Modify: `tests/unit/audio-engine.test.js` (update and add tests)

**Step 1: Update existing tests for new border key format**

In `tests/unit/audio-engine.test.js`, the border key tests need updating:

```js
// Line 334: change expected from 'white:0:0.5' to 'white:0'
expect(audioVoice.currentBorder).toBe('white:0');

// Line 353: change expected from 'black:0:0.5' to 'black:0'
expect(newVoice.currentBorder).toBe('black:0');

// Line 371: change expected from 'white:1:0.7' to 'white:1'
expect(newVoice.currentBorder).toBe('white:1');
```

**Step 2: Add test for smooth thickness update (no rebuild)**

```js
test('thickness change updates gain smoothly without rebuild', async () => {
  const voice = makeVoice('a', 'sine', {
    border: { color: 'white', double: false, thickness: 0.3 },
  });
  await startWith([voice]);

  const originalVoice = engine.activeVoices[0];

  // Change only thickness
  const updated = makeVoice('a', 'sine', {
    border: { color: 'white', double: false, thickness: 0.8 },
  });
  engine.updateVoices(makeSigilState([updated]));

  // Same voice object — NOT rebuilt
  const sameVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
  expect(sameVoice).toBe(originalVoice);
});
```

**Step 3: Add test for octave gain tracking size changes**

```js
test('octave gain updates when shape size changes', async () => {
  const voice = makeVoice('a', 'sine', {
    size: 0.3,
    border: { color: 'white', double: false, thickness: 0.5 },
  });
  await startWith([voice]);

  const audioVoice = engine.activeVoices[0];
  const initialGain = audioVoice.octaveGainNode.gain.value;

  // Increase size
  const updated = makeVoice('a', 'sine', {
    size: 0.7,
    border: { color: 'white', double: false, thickness: 0.5 },
  });
  engine.updateVoices(makeSigilState([updated]));

  expect(audioVoice.octaveGainNode.gain.value).toBeGreaterThan(initialGain);
});
```

**Step 4: Run tests to verify they fail**

Run: `bun test tests/unit/audio-engine.test.js`
Expected: FAIL — border key still includes thickness, no smooth update yet

**Step 5: Update `updateVoices` in `js/audio.ts`**

Change border key computation (~line 612-613):
```ts
// Old:
const borderKey = voice.border
  ? `${voice.border.color}:${voice.border.double ? 1 : 0}:${voice.border.thickness}`
  : null;

// New:
const borderKey = voice.border
  ? `${voice.border.color}:${voice.border.double ? 1 : 0}`
  : null;
```

Add octave gain update in the smooth parameter block, after the primary gain
update (~after line 651):
```ts
// Update octave oscillator gain if border is present
if (audioVoice.octaveGainNode && voice.border) {
  audioVoice.octaveGainNode.gain.setValueAtTime(
    borderOctaveGain(
      voice.waveform, voice.size, voice.border.thickness,
      voice.border.color, voice.border.double,
    ),
    now,
  );
}
```

**Step 6: Run all tests**

Run: `bun test`
Expected: All PASS

**Step 7: Commit**

```
fix(audio): border octave gain tracks size, thickness updates without rebuild (#151)
```

---

### Task 4: Typecheck and lint

**Step 1: Run typecheck**

Run: `bun run check`
Expected: No errors

**Step 2: Run lint**

Run: `bun run lint`
Expected: No errors

**Step 3: Run formatter**

Run: `bun run fmt`

**Step 4: Run full test suite**

Run: `bun run test`
Expected: All pass

**Step 5: Commit any formatting changes**

Only if fmt changed anything:
```
style: format
```
