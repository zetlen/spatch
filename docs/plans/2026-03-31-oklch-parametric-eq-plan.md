# OKLCH + Parametric EQ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fill color model (HSL → OKLCH) and audio mapping (dual-formant bank → peak filter + lowpass) so each color channel maps to one independently audible audio parameter.

**Architecture:** Two parallel changes that touch the same files: (1) swap internal color representation from HSL to OKLCH, updating types, serialization, CSS output, and UI; (2) replace the 3-biquad formant filter bank with a 2-biquad peak+lowpass chain, simplifying the audio graph. Changes propagate through types → colors/filters → voice-builder → engine → serializers → toolbar → tests.

**Tech Stack:** TypeScript, Web Audio API (BiquadFilterNode type `peaking` + `lowpass`), CSS `oklch()`, `<input type="color">` with `colorspace="limited-srgb"`.

**Spec:** `docs/plans/2026-03-31-oklch-parametric-eq-design.md`

---

### Task 1: Update FillBase types and fill utilities (HSL → OKLCH)

**Files:**
- Modify: `js/types.ts:66-148` (FillBase, FillDraft, fill conversion functions)

- [ ] **Step 1: Rename `s` → `c` in FillBase and all Fill/FillDraft types**

In `js/types.ts`, update `FillBase`:

```ts
interface FillBase {
  h: number;
  c: number;
  l: number;
}
```

Update `LinearFill` — rename `s2` → `c2`:

```ts
export interface LinearFill extends FillBase {
  mode: 'linear';
  h2: number;
  c2: number;
  l2: number;
  gradAngle: number;
}
```

Update `FillDraft` — rename `s` → `c`, `s2` → `c2`:

```ts
export interface FillDraft {
  mode: FillMode;
  h: number;
  c: number;
  l: number;
  h2: number;
  c2: number;
  l2: number;
  gradAngle: number;
}
```

Update `fillToFillDraft` defaults to OKLCH ranges:

```ts
export function fillToFillDraft(fill: Fill): FillDraft {
  const base = { gradAngle: 0, h: fill.h, h2: 180, l: fill.l, l2: 0.55, c: fill.c, c2: 0.15 };
  switch (fill.mode) {
    case 'solid': {
      return { ...base, mode: 'solid' };
    }
    case 'linear': {
      return {
        ...base,
        gradAngle: fill.gradAngle,
        h2: fill.h2,
        l2: fill.l2,
        mode: 'linear',
        c2: fill.c2,
      };
    }
  }
}
```

Update `fillDraftToFill` — rename `s` → `c`, `s2` → `c2`:

```ts
export function fillDraftToFill(draft: FillDraft): Fill {
  switch (draft.mode) {
    case 'solid': {
      return { h: draft.h, l: draft.l, mode: 'solid', c: draft.c };
    }
    case 'linear': {
      return {
        gradAngle: draft.gradAngle,
        h: draft.h,
        h2: draft.h2,
        l: draft.l,
        l2: draft.l2,
        mode: 'linear',
        c: draft.c,
        c2: draft.c2,
      };
    }
  }
}
```

- [ ] **Step 2: Run typecheck to find all broken references to `.s` and `.s2`**

Run: `bun run check 2>&1 | head -80`

Expected: Many type errors across the codebase where `.s` and `.s2` are referenced. This is intentional — it maps the blast radius. Save the output; these are all the sites that must be updated in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add js/types.ts
git commit -m "feat(types): rename Fill s→c, s2→c2 for OKLCH chroma (#313)"
```

---

### Task 2: Replace color utilities (HSL → OKLCH)

**Files:**
- Modify: `js/colors.ts` (full rewrite of exports)
- Modify: `css/style.css:230` (one hardcoded `hsl()`)

- [ ] **Step 1: Rewrite colors.ts**

Replace the entire file. Delete `hslToString`, `hslToHex`, `hexToHsl`, `hslToRgb`. Add `oklchToString` and `clampChromaToSRGB`.

```ts
// Colors.ts — OKLCH color conversions and fill helpers

import { svgEl } from './dom.ts';
import type { Fill, LinearFill, SolidFill } from './types.ts';

/** Format an OKLCH color as a CSS oklch() string. */
export function oklchToString(h: number, c: number, l: number): string {
  return `oklch(${l} ${c} ${h})`;
}

// ---- Gamut clamping ----

/**
 * Clamp chroma so the color fits within sRGB gamut.
 * Uses binary search: halves chroma until the resulting sRGB values are in [0, 255].
 *
 * NOTE: This function can be removed once the `colorspace="limited-srgb"` attribute
 * on <input type="color"> is universally supported across browsers. As of 2026-03,
 * only Safari implements it. Until then, JS-side clamping is needed for programmatic
 * color generation (createRandomFill, harmony randomizer).
 */
export function clampChromaToSRGB(h: number, c: number, l: number): number {
  // Quick check: zero chroma is always in gamut
  if (c <= 0) return 0;

  // Use CSS color parsing to test if a color is in sRGB gamut.
  // Create a temporary element, set its color, and read it back.
  // If the browser clamps the chroma, the read-back value will differ.
  // Binary search for the max chroma that round-trips cleanly.
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (isInSRGBGamut(h, mid, l)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Test whether an OKLCH color is within sRGB gamut using Oklab→linear sRGB math. */
function isInSRGBGamut(h: number, c: number, l: number): boolean {
  // Oklab from OKLCH
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  // Oklab → linear sRGB via the LMS intermediate
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const lc = l_ * l_ * l_;
  const mc = m_ * m_ * m_;
  const sc = s_ * s_ * s_;

  const r = +4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  const g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  const bl = -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc;

  const EPS = -0.001; // Small tolerance for floating point
  return r >= EPS && r <= 1.001 && g >= EPS && g <= 1.001 && bl >= EPS && bl <= 1.001;
}

// ---- Fill factories ----

/** Create a solid fill with a random hue and mid-range chroma/lightness. */
export function createRandomFill(): SolidFill {
  const h = Math.floor(Math.random() * 360);
  const rawC = 0.08 + Math.random() * 0.17; // 0.08–0.25
  const l = 0.4 + Math.random() * 0.3; // 0.4–0.7
  const c = clampChromaToSRGB(h, rawC, l);
  return { h, c, l, mode: 'solid' };
}

// ---- SVG-compatible fill helpers ----

/** Get the primary solid color for any fill. */
export function getSolidFillColor(fill: Fill): string {
  return oklchToString(fill.h, fill.c, fill.l);
}

/** Create or update an SVG <linearGradient> element for a linear fill. */
export function ensureLinearGradient(
  defs: SVGDefsElement,
  id: string,
  fill: LinearFill,
  shapeRotationDeg: number,
): void {
  let grad = defs.querySelector(`#${id}`) as SVGLinearGradientElement | undefined;
  if (!grad) {
    grad = svgEl(
      'linearGradient',
      { id, gradientUnits: 'objectBoundingBox' },
      svgEl('stop', { offset: '0%' }),
      svgEl('stop', { offset: '100%' }),
    );
    defs.append(grad);
  }

  const angle = ((fill.gradAngle - shapeRotationDeg) * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  grad.setAttribute('x1', String(0.5 - dx * 0.5));
  grad.setAttribute('y1', String(0.5 - dy * 0.5));
  grad.setAttribute('x2', String(0.5 + dx * 0.5));
  grad.setAttribute('y2', String(0.5 + dy * 0.5));

  const stops = grad.querySelectorAll('stop');
  stops[0]!.setAttribute('stop-color', oklchToString(fill.h, fill.c, fill.l));
  stops[1]!.setAttribute('stop-color', oklchToString(fill.h2, fill.c2, fill.l2));
}

// ---- Get swatch display color for toolbar ----

export function getSwatchColor(fill: Fill): string {
  switch (fill.mode) {
    case 'solid': {
      return oklchToString(fill.h, fill.c, fill.l);
    }
    case 'linear': {
      return `linear-gradient(${fill.gradAngle + 90}deg, ${oklchToString(fill.h, fill.c, fill.l)}, ${oklchToString(fill.h2, fill.c2, fill.l2)})`;
    }
  }
}
```

- [ ] **Step 2: Update CSS hardcoded hsl value**

In `css/style.css:230`, replace:
```css
background: hsl(200, 80%, 50%);
```
with an oklch equivalent:
```css
background: oklch(0.55 0.17 237);
```

(This is approximately the same blue — OKLCH L≈0.55, C≈0.17, H≈237.)

- [ ] **Step 3: Commit**

```bash
git add js/colors.ts css/style.css
git commit -m "feat(colors): replace HSL with OKLCH color model (#313)"
```

---

### Task 3: Replace formants.ts with filters.ts

**Files:**
- Delete: `js/audio/formants.ts`
- Create: `js/audio/filters.ts`

- [ ] **Step 1: Write tests for the new filter mapping functions**

Create `tests/unit/filters.test.js`:

```js
import { describe, expect, test } from 'bun:test';
import {
  hueToFrequency,
  chromaToGain,
  lightnessToCutoff,
  sweepParamsForAngle,
  buildSweepCurve,
  isSweepReversed,
} from '../../js/audio/filters.ts';

describe('hueToFrequency', () => {
  test('hue 0 maps to ~100 Hz', () => {
    expect(hueToFrequency(0)).toBeCloseTo(100, -1);
  });

  test('hue 360 maps to ~12000 Hz', () => {
    expect(hueToFrequency(360)).toBeCloseTo(12000, -2);
  });

  test('hue 180 maps to ~1095 Hz (geometric midpoint)', () => {
    const freq = hueToFrequency(180);
    expect(freq).toBeGreaterThan(900);
    expect(freq).toBeLessThan(1300);
  });

  test('monotonically increasing', () => {
    let prev = 0;
    for (let h = 0; h <= 360; h += 10) {
      const f = hueToFrequency(h);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe('chromaToGain', () => {
  test('zero chroma produces 0 dB gain', () => {
    expect(chromaToGain(0, 12)).toBe(0);
  });

  test('max chroma (0.4) produces maxGain', () => {
    expect(chromaToGain(0.4, 12)).toBeCloseTo(12, 1);
  });

  test('mid chroma produces proportional gain', () => {
    expect(chromaToGain(0.2, 12)).toBeCloseTo(6, 1);
  });
});

describe('lightnessToCutoff', () => {
  test('L=0 maps to ~300 Hz', () => {
    expect(lightnessToCutoff(0)).toBeCloseTo(300, -1);
  });

  test('L=1 maps to ~12000 Hz', () => {
    expect(lightnessToCutoff(1)).toBeCloseTo(12000, -2);
  });

  test('monotonically increasing', () => {
    let prev = 0;
    for (let l = 0; l <= 1; l += 0.1) {
      const f = lightnessToCutoff(l);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

// Sweep tests — these functions are unchanged from formants.ts.
// Moved here to verify the import path works.

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
    expect(p.durationFrac).toBe(1);
    expect(p.exponent).toBe(1);
  });
});

describe('isSweepReversed', () => {
  test('false for angles 0–135°', () => {
    expect(isSweepReversed(0)).toBe(false);
    expect(isSweepReversed(135)).toBe(false);
  });

  test('true for angles 180–315°', () => {
    expect(isSweepReversed(180)).toBe(true);
    expect(isSweepReversed(315)).toBe(true);
  });
});

describe('buildSweepCurve', () => {
  test('starts at 0 and ends at 1', () => {
    const curve = buildSweepCurve(1, 64);
    expect(curve[0]).toBeCloseTo(0, 2);
    expect(curve[63]).toBeCloseTo(1, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/filters.test.js`

Expected: FAIL — `filters.ts` does not exist yet.

- [ ] **Step 3: Create `js/audio/filters.ts`**

```ts
// Filters.ts — Parametric EQ filter mapping for OKLCH fills.
//
// Pure functions mapping OKLCH fill properties to audio filter parameters.
// Hue → peak center frequency (log sweep 100 Hz – 12 kHz)
// Chroma → peak gain (0 dB grey → +12 dB vivid)
// Lightness → lowpass cutoff (300 Hz – 12 kHz)

import type { Fill, LinearFill, WaveformType } from '../types.ts';
import { get } from '../voices/registry.ts';

// ---- Parametric EQ mapping ----

const FREQ_MIN = 100;
const FREQ_MAX = 12_000;
const CUTOFF_MIN = 300;
const CUTOFF_MAX = 12_000;
const MAX_CHROMA = 0.4;
const MAX_GAIN = 12; // dB

/**
 * Map OKLCH hue (0–360) to peak filter center frequency.
 * Logarithmic: equal hue steps produce equal perceived pitch steps.
 * Hue 0° ≈ 100 Hz, hue 180° ≈ 1095 Hz, hue 360° ≈ 12 kHz.
 */
export function hueToFrequency(hue: number): number {
  return FREQ_MIN * (FREQ_MAX / FREQ_MIN) ** (hue / 360);
}

/**
 * Map OKLCH chroma (0–0.4) to peak filter gain in dB.
 * Linear: grey = 0 dB (flat), vivid = +12 dB (strong coloring).
 */
export function chromaToGain(chroma: number, maxGain: number = MAX_GAIN): number {
  return (chroma / MAX_CHROMA) * maxGain;
}

/**
 * Map OKLCH lightness (0–1) to lowpass cutoff frequency.
 * Exponential: dark = muffled (~300 Hz), light = open (~12 kHz).
 */
export function lightnessToCutoff(l: number): number {
  return CUTOFF_MIN * (CUTOFF_MAX / CUTOFF_MIN) ** l;
}

/**
 * Apply parametric filter settings to pre-existing BiquadFilterNodes.
 * For linear gradient fills, sets filters to the sweep's starting color.
 */
export function applyFilterParams(
  peak: BiquadFilterNode,
  lowpass: BiquadFilterNode,
  fill: Fill,
  waveform: WaveformType = 'pulse',
): void {
  let { h, c, l } = fill;

  if (fill.mode === 'linear') {
    if (isSweepReversed(fill.gradAngle)) {
      h = fill.h2;
      c = fill.c2;
      l = fill.l2;
    }
  }

  peak.frequency.value = hueToFrequency(h);
  peak.gain.value = chromaToGain(c);
  // NOTE: uses old field name `formantMaxQ` here. Task 4 renames it to `peakQ`
  // and updates this line. Both tasks must land before typecheck passes.
  peak.Q.value = get(waveform).player.formantMaxQ;
  lowpass.frequency.value = lightnessToCutoff(l);
}

// ---- Gradient-angle → sweep parameters ----

interface SweepParams {
  durationFrac: number;
  exponent: number;
}

const SWEEP_TABLE: SweepParams[] = [
  { durationFrac: 1, exponent: 1 },       // 0°   LR     — slowest, linear
  { durationFrac: 0.8, exponent: 2 },     // 45°  TL→BR  — medium, ease-in
  { durationFrac: 0.6, exponent: 1 },     // 90°  TB     — moderate, linear
  { durationFrac: 0.8, exponent: 0.5 },   // 135° TR→BL  — medium, ease-out
  { durationFrac: 0.4, exponent: 1 },     // 180° RL     — fastest, linear
  { durationFrac: 0.8, exponent: 2 },     // 225° BR→TL  — medium, ease-in
  { durationFrac: 0.6, exponent: 1 },     // 270° BT     — moderate, linear
  { durationFrac: 0.8, exponent: 0.5 },   // 315° BL→TR  — medium, ease-out
];

export function sweepParamsForAngle(angleDeg: number): SweepParams {
  const a = ((angleDeg % 360) + 360) % 360;
  const index = Math.round(a / 45) & 7;
  return SWEEP_TABLE[index]!;
}

export function buildSweepCurve(exponent: number, samples: number): Float32Array {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    curve[i] = (i / (samples - 1)) ** exponent;
  }
  return curve;
}

const SWEEP_CURVE_SAMPLES = 64;

/** True when the gradient's anchor bit (bit 2) is set. */
export function isSweepReversed(gradAngle: number): boolean {
  return (Math.round(gradAngle / 45) & 4) !== 0;
}

/**
 * Schedule a filter parameter sweep between two OKLCH colors over time.
 * Interpolates peak frequency, peak gain, and lowpass cutoff.
 */
export function scheduleFilterSweep(
  nodes: { peak: BiquadFilterNode; lowpass: BiquadFilterNode },
  fill: LinearFill,
  waveform: WaveformType,
  startTime: number,
  decayDuration: number,
): void {
  const { peak, lowpass } = nodes;
  const reversed = isSweepReversed(fill.gradAngle);

  const startFreq = hueToFrequency(reversed ? fill.h2 : fill.h);
  const endFreq = hueToFrequency(reversed ? fill.h : fill.h2);
  const startGainDb = chromaToGain(reversed ? fill.c2 : fill.c);
  const endGainDb = chromaToGain(reversed ? fill.c : fill.c2);
  const startCutoff = lightnessToCutoff(reversed ? fill.l2 : fill.l);
  const endCutoff = lightnessToCutoff(reversed ? fill.l : fill.l2);

  const params = sweepParamsForAngle(fill.gradAngle);
  const easing = buildSweepCurve(params.exponent, SWEEP_CURVE_SAMPLES);
  const duration = Math.max(0.01, decayDuration * params.durationFrac);

  const freqCurve = new Float32Array(SWEEP_CURVE_SAMPLES);
  const gainCurve = new Float32Array(SWEEP_CURVE_SAMPLES);
  const cutoffCurve = new Float32Array(SWEEP_CURVE_SAMPLES);

  for (let i = 0; i < SWEEP_CURVE_SAMPLES; i++) {
    const t = easing[i]!;
    freqCurve[i] = startFreq + (endFreq - startFreq) * t;
    gainCurve[i] = startGainDb + (endGainDb - startGainDb) * t;
    cutoffCurve[i] = startCutoff + (endCutoff - startCutoff) * t;
  }

  peak.frequency.setValueCurveAtTime(freqCurve, startTime, duration);
  peak.gain.setValueCurveAtTime(gainCurve, startTime, duration);
  lowpass.frequency.setValueCurveAtTime(cutoffCurve, startTime, duration);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/filters.test.js`

Expected: PASS (all tests green). Note: `applyFilterParams` and `scheduleFilterSweep` call `get(waveform).player.peakQ` which requires the voice registry. These are tested via engine integration, not unit tested here since they need Web Audio stubs.

- [ ] **Step 5: Delete old formant test file and formants.ts**

```bash
rm js/audio/formants.ts tests/unit/formant-sweep.test.js
```

- [ ] **Step 6: Commit**

```bash
git add js/audio/filters.ts tests/unit/filters.test.js
git add -u js/audio/formants.ts tests/unit/formant-sweep.test.js
git commit -m "feat(audio): replace formant bank with parametric EQ filters (#313)"
```

---

### Task 4: Update voice delegate types and voice-builder

**Files:**
- Modify: `js/voices/types.ts:15-84` (AudioSharedNodes, AudioVoice, VoicePlayer)
- Modify: `js/audio/voice-builder.ts` (filter node creation, signal chain)

- [ ] **Step 1: Update AudioSharedNodes in voices/types.ts**

Replace `formantF1`, `formantF2`, `formantMixer`, `brightness` with `peak`, `lowpass`:

```ts
export interface AudioSharedNodes {
  ctx: AudioContext;
  gain: GainNode;
  peak: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  panner: StereoPannerNode;
  octaveOsc: OscillatorNode | undefined;
  octaveGainNode: GainNode | undefined;
  effectDispose: (() => void) | undefined;
  currentEffect: string | undefined;
  currentBorder: string | undefined;
  currentFillKey: string | undefined;
  warmth: number;
}
```

- [ ] **Step 2: Update AudioVoice in voices/types.ts**

Replace same fields:

```ts
export interface AudioVoice {
  shapeId: string;
  gain: GainNode;
  outputNode: StereoPannerNode;
  panner: StereoPannerNode;
  peak: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  warmthShaper: WaveShaperNode | undefined;
  octaveOsc: OscillatorNode | undefined;
  octaveGainNode: GainNode | undefined;
  effectDispose: (() => void) | undefined;
  currentEffect: string | undefined;
  currentBorder: string | undefined;
  currentFillKey: string | undefined;
  hasSweep: boolean;
  lastX: number;
  lastY: number;
  lastSize: number;
  start(time: number): void;
  onDecay?(time: number): void;
  onRelease?(time: number): void;
  stop(time: number): void;
  updateParams(voice: Voice, now: number): void;
  syncGlobalParams(vibeParams: { warmth: number }, now: number): void;
  getModulatorNode(): OscillatorNode;
  getCarrierFrequencyParams(): AudioParam[];
}
```

- [ ] **Step 3: Rename `formantMaxQ` → `peakQ` in VoicePlayer**

```ts
export interface VoicePlayer {
  readonly oscillatorType: OscillatorType;
  readonly shapeAreaCoeff: number;
  readonly peakQ: number;
  readonly gainExponent: number;
  buildAudioGraph(ctx: AudioContext, voice: Voice, shared: AudioSharedNodes): AudioVoice;
}
```

- [ ] **Step 4: Rewrite voice-builder.ts signal chain**

Replace the formant filter bank with peak + lowpass. Import from `filters.ts` instead of `formants.ts`:

```ts
import { applyFilterParams } from './filters.ts';
```

Replace the filter node creation block (lines ~62-80) with:

```ts
  // Parametric EQ: peak filter (hue→freq, chroma→gain) + lowpass (lightness→cutoff)
  const peak = new BiquadFilterNode(ctx, { type: 'peaking', Q: get(voice.waveform).player.peakQ });
  // Also update filters.ts: change `.formantMaxQ` → `.peakQ` in applyFilterParams
  const lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', Q: LOWPASS_Q });

  applyFilterParams(peak, lowpass, voice.fill, voice.waveform);
```

Replace the signal chain wiring:

```ts
  // Wire: gain → peak → lowpass → [effect] → panner → master
  //       [border osc → borderGain → gain]
  gain.connect(peak);
  peak.connect(lowpass);

  let lastNode: AudioNode = lowpass;
```

Delete `FORMANT_MIX` constant. Replace `BRIGHTNESS_Q` with `LOWPASS_Q` (same value `Math.SQRT1_2`).

Update the `AudioSharedNodes` construction at the bottom — replace `formantF1`, `formantF2`, `formantMixer`, `brightness` with `peak`, `lowpass`.

Update `fillToKey` to use `c` instead of `s`:

```ts
export function fillToKey(fill: Fill): string | undefined {
  if (fill.mode !== 'linear') {
    return undefined;
  }
  return `${fill.h}:${fill.c}:${fill.l}:${fill.h2}:${fill.c2}:${fill.l2}:${fill.gradAngle}`;
}
```

- [ ] **Step 5: Commit**

```bash
git add js/voices/types.ts js/audio/voice-builder.ts
git commit -m "feat(audio): simplify voice signal chain to peak+lowpass (#313)"
```

---

### Task 5: Update all player delegates (peakQ rename)

**Files:**
- Modify: `js/voices/sine/player.ts` — `formantMaxQ: 4` → `peakQ: 2`
- Modify: `js/voices/pulse/player.ts` — `formantMaxQ: N` → `peakQ: 3`
- Modify: `js/voices/blend/player.ts` — `formantMaxQ: N` → `peakQ: 3`
- Modify: `js/voices/astroid/player.ts` — `formantMaxQ: 8` → `peakQ: 3.5`
- Modify: `js/voices/stamp/lifecycle.ts` (or wherever stamp player is) — `formantMaxQ: N` → `peakQ: 3`

- [ ] **Step 1: Find and read all player delegates**

Run: `grep -rn 'formantMaxQ' js/voices/`

Update each one. The exact values:
- sine: `peakQ: 2` (broader boost — one partial)
- pulse: `peakQ: 3`
- blend: `peakQ: 3`
- astroid: `peakQ: 3.5` (6 saws fill the spectrum)
- stamp: `peakQ: 3`

Also update any `shared.formantF1`/`shared.formantF2`/`shared.brightness` references to `shared.peak`/`shared.lowpass` if the player delegates access them directly (they currently don't — they access `shared.gain` and `shared.panner`).

- [ ] **Step 2: Verify each player's `buildAudioGraph` still connects to `shared.gain`**

The player delegates connect their oscillator output to `shared.gain`. The voice-builder wires `gain → peak → lowpass → ...`. As long as the players still connect to `shared.gain`, the chain is correct. Verify no player references `formantF1`/`formantF2`/`brightness` directly.

- [ ] **Step 3: Commit**

```bash
git add js/voices/
git commit -m "feat(audio): rename formantMaxQ→peakQ, set fixed Q values (#313)"
```

---

### Task 6: Update engine.ts (formant scheduling → filter scheduling)

**Files:**
- Modify: `js/audio/engine.ts`

This is the largest mechanical change — ~15 call sites that reference formant scheduling functions.

- [ ] **Step 1: Update imports**

Replace:
```ts
import {
  applyFormantFilter,
  computeFormantQ,
  hueToFormants,
  isSweepReversed,
  lightnessToCutoff,
  scheduleFormantSweep,
} from './formants.ts';
```
with:
```ts
import {
  applyFilterParams,
  hueToFrequency,
  chromaToGain,
  lightnessToCutoff,
  isSweepReversed,
  scheduleFilterSweep,
} from './filters.ts';
```

- [ ] **Step 2: Update `play()` method — diphthong sweep scheduling (lines ~162-184)**

Replace the formant setup block:

```ts
      if (voice.fill.mode === 'linear') {
        const rev = isSweepReversed(voice.fill.gradAngle);
        const startH = rev ? voice.fill.h2 : voice.fill.h;
        const startC = rev ? voice.fill.c2 : voice.fill.c;
        const startL = rev ? voice.fill.l2 : voice.fill.l;
        av.peak.frequency.setValueAtTime(hueToFrequency(startH), now);
        av.peak.gain.setValueAtTime(chromaToGain(startC), now);
        av.lowpass.frequency.setValueAtTime(lightnessToCutoff(startL), now);

        scheduleFilterSweep(
          { peak: av.peak, lowpass: av.lowpass },
          voice.fill,
          voice.waveform,
          sweepStart,
          decay,
        );
        av.hasSweep = true;
      }
```

- [ ] **Step 3: Update `_updateVoices()` — new voice sweep scheduling (lines ~272-295)**

Same pattern as step 2 for the "add voice mid-playback" block. Replace `formantF1`/`formantF2`/`brightness` with `peak`/`lowpass`, replace the function calls.

- [ ] **Step 4: Update `_updateVoices()` — fill-change retrig block (lines ~357-382)**

Replace the cancel + reschedule block:

```ts
      if (
        audioVoice.hasSweep &&
        fillKey !== audioVoice.currentFillKey &&
        voice.fill.mode === 'linear'
      ) {
        audioVoice.peak.frequency.cancelScheduledValues(now);
        audioVoice.peak.gain.cancelScheduledValues(now);
        audioVoice.lowpass.frequency.cancelScheduledValues(now);

        const rev = isSweepReversed(voice.fill.gradAngle);
        const startH = rev ? voice.fill.h2 : voice.fill.h;
        const startC = rev ? voice.fill.c2 : voice.fill.c;
        const startL = rev ? voice.fill.l2 : voice.fill.l;
        audioVoice.peak.frequency.setValueAtTime(hueToFrequency(startH), now);
        audioVoice.peak.gain.setValueAtTime(chromaToGain(startC), now);
        audioVoice.lowpass.frequency.setValueAtTime(lightnessToCutoff(startL), now);

        const retrigDecay = Math.max(0.01, this._playEnvelope?.decay ?? 0.2);
        scheduleFilterSweep(
          { peak: audioVoice.peak, lowpass: audioVoice.lowpass },
          voice.fill,
          voice.waveform,
          now,
          retrigDecay,
        );
        audioVoice.currentFillKey = fillKey;
      }
```

- [ ] **Step 5: Update `_updateVoices()` — solid fill update (lines ~384-392)**

Replace:
```ts
      if (!audioVoice.hasSweep) {
        applyFilterParams(
          audioVoice.peak,
          audioVoice.lowpass,
          voice.fill,
          voice.waveform,
        );
      }
```

- [ ] **Step 6: Commit**

```bash
git add js/audio/engine.ts
git commit -m "feat(audio): update engine to use parametric EQ filter scheduling (#313)"
```

---

### Task 7: Update serializers (s → c, lightness rescale)

**Files:**
- Modify: `js/voices/serializers/oscillator.ts`

- [ ] **Step 1: Update `packColor` and `unpackColor`**

The bit layout stays the same (H 9b | C 7b | L 8b = 24b). Change the semantics:

```ts
function packColor(h: number, c: number, l: number): string {
  // Chroma 0–0.4 → 0–128: multiply by 320
  // Lightness 0–1 → 0–255: multiply by 255
  const val = (Math.round(h) << 14) | (Math.round(c * 320) << 7) | Math.round(l * 255);
  return encodeInt(val, 4);
}

function unpackColor(str: string, idx: number): { h: number; c: number; l: number } {
  const val = decodeInt(str, idx, 4);
  return {
    h: (val >> 14) & 0x1ff,
    c: ((val >> 7) & 0x7f) / 320,
    l: (val & 0xff) / 255,
  };
}
```

- [ ] **Step 2: Update `packGradientColor` and `unpackGradientColor`**

Same chroma/lightness rescaling, plus rename `s` → `c`:

```ts
function packGradientColor(angle: number, h: number, c: number, l: number): string {
  const angleBits = Math.round(angle / 45) & 7;
  const colorBits = (Math.round(h) << 14) | (Math.round(c * 320) << 7) | Math.round(l * 255);
  return encodeInt((angleBits << 23) | colorBits, 5);
}

function unpackGradientColor(
  str: string,
  idx: number,
): { angle: number; h: number; c: number; l: number } {
  const val = decodeInt(str, idx, 5);
  return {
    angle: ((val >> 23) & 7) * 45,
    h: (val >> 14) & 0x1ff,
    c: ((val >> 7) & 0x7f) / 320,
    l: (val & 0xff) / 255,
  };
}
```

- [ ] **Step 3: Update `pack()` — fill field references**

Replace `voice.fill.s` → `voice.fill.c`, and in gradient section replace `f.s2` → `f.c2`, `f.l2` references use the same field names (already `l2`):

```ts
      out += packColor(voice.fill.h, voice.fill.c, voice.fill.l);
      // ...
      out += packGradientColor(f.gradAngle, f.h2, f.c2, f.l2);
```

- [ ] **Step 4: Update `unpack()` — fill construction**

Replace `s` → `c` in the Fill object construction:

```ts
      if (isGradient) {
        fill = {
          mode: 'linear',
          gradAngle: c2.angle,
          h: c1.h,
          c: c1.c,
          l: c1.l,
          h2: c2.h,
          c2: c2.c,
          l2: c2.l,
        } satisfies LinearFill;
      } else {
        fill = {
          mode: 'solid',
          h: c1.h,
          c: c1.c,
          l: c1.l,
        } satisfies SolidFill;
      }
```

- [ ] **Step 5: Commit**

```bash
git add js/voices/serializers/oscillator.ts
git commit -m "feat(serialize): update color pack/unpack for OKLCH chroma+lightness (#313)"
```

---

### Task 8: Update fill-panel.ts and harmony.ts

**Files:**
- Modify: `js/toolbar/fill-panel.ts`
- Modify: `js/harmony.ts`

- [ ] **Step 1: Update fill-panel.ts**

Update `bindColorInput` to use `c`/`c2` instead of `s`/`s2`. Update type annotations:

```ts
  function bindColorInput(
    input: HTMLInputElement,
    hKey: 'h' | 'h2',
    cKey: 'c' | 'c2',
    lKey: 'l' | 'l2',
  ): void {
```

Update `buildColorInput` to add `colorspace`:

```ts
function buildColorInput(id: string, title: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'color';
  input.id = id;
  input.className = 'expansion-color-input';
  input.title = title;
  input.setAttribute('colorspace', 'limited-srgb');
  return input;
}
```

Update `syncColorInputs` to set input values using oklch strings instead of hex. Import `oklchToString` from `colors.ts`:

```ts
  function syncColorInputs() {
    const solid = area.querySelector<HTMLInputElement>('#color-solid');
    const lin2 = area.querySelector<HTMLInputElement>('#color-lin-2');
    if (solid) {
      solid.value = oklchToString(fillDraft.h, fillDraft.c, fillDraft.l);
    }
    if (lin2) {
      lin2.value = oklchToString(fillDraft.h2, fillDraft.c2, fillDraft.l2);
    }
    // ... angle toggles unchanged
  }
```

Update `bindColorInput` to parse the color picker's return value. The return format from `<input type="color">` when set with oklch may be hex or oklch depending on browser. Parse both:

```ts
  function bindColorInput(
    input: HTMLInputElement,
    hKey: 'h' | 'h2',
    cKey: 'c' | 'c2',
    lKey: 'l' | 'l2',
  ): void {
    input.addEventListener('input', () => {
      const sel = getSelectedVoice(deps);
      if (!sel) return;
      const parsed = parseColorValue(input.value);
      if (parsed) {
        fillDraft[hKey] = parsed.h;
        fillDraft[cKey] = parsed.c;
        fillDraft[lKey] = parsed.l;
        commitFill(sel.id, false);
        updateSwatch();
      }
    });
  }
```

Add `parseColorValue` helper — parse both oklch and hex return formats. For hex, use a canvas-based conversion to oklch (or compute via Oklab math). This is the one place where we need hex→oklch conversion:

```ts
/** Parse a color value returned by <input type="color"> into OKLCH components.
 *  Browsers may return oklch(), rgb(), or hex depending on implementation. */
function parseColorValue(value: string): { h: number; c: number; l: number } | null {
  // Try oklch() format first
  const oklchMatch = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (oklchMatch) {
    return { l: parseFloat(oklchMatch[1]!), c: parseFloat(oklchMatch[2]!), h: parseFloat(oklchMatch[3]!) };
  }

  // Fallback: use a canvas to convert any CSS color to sRGB, then compute OKLCH
  const ctx = parseColorValue._ctx ??= document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = value;
  const hex = ctx.fillStyle; // Always returns #rrggbb
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return srgbToOklch(r, g, b);
}
parseColorValue._ctx = null as CanvasRenderingContext2D | null;
```

Add `srgbToOklch` helper (sRGB → linear RGB → Oklab → OKLCH):

```ts
function srgbToOklch(r: number, g: number, b: number): { h: number; c: number; l: number } {
  // sRGB → linear
  const rl = r <= 0.04045 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4;
  const gl = g <= 0.04045 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
  const bl = b <= 0.04045 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4;

  // Linear sRGB → LMS (cube root for Oklab)
  const l_ = Math.cbrt(0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl);
  const m_ = Math.cbrt(0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl);
  const s_ = Math.cbrt(0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl);

  // LMS → Oklab
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const bk = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  // Oklab → OKLCH
  const c = Math.sqrt(a * a + bk * bk);
  const h = c < 0.001 ? 0 : ((Math.atan2(bk, a) * 180) / Math.PI + 360) % 360;
  return { h, c, l: L };
}
```

Remove imports of `hexToHsl` and `hslToHex`. Import `oklchToString` from `../colors.ts`.

Update labels: "Vowel" → remove or keep as-is (the user may have preferences here — just remove the word "Vowel" from the titles). Change `'Start Vowel'` → `'Start Color'`, `'Vowel'` → `'Color'`, `'End Vowel'` → `'End Color'`, `'Vowel Slide'` → `'Gradient'`.

- [ ] **Step 2: Update harmony.ts**

Update `createRandomLinearFill()` to use OKLCH ranges:

```ts
function createRandomLinearFill(): Fill {
  const h1 = Math.floor(Math.random() * 360);
  const h2 = Math.floor(Math.random() * 360);
  const rawC1 = 0.08 + Math.random() * 0.17;
  const rawC2 = 0.08 + Math.random() * 0.17;
  const l1 = 0.4 + Math.random() * 0.3;
  const l2 = 0.4 + Math.random() * 0.3;
  return {
    mode: 'linear',
    h: h1,
    c: clampChromaToSRGB(h1, rawC1, l1),
    l: l1,
    h2: h2,
    c2: clampChromaToSRGB(h2, rawC2, l2),
    l2: l2,
    gradAngle: Math.floor(Math.random() * 8) * 45,
  };
}
```

Add import of `clampChromaToSRGB` from `./colors.ts`.

- [ ] **Step 3: Commit**

```bash
git add js/toolbar/fill-panel.ts js/harmony.ts
git commit -m "feat(ui): update fill panel and harmony for OKLCH (#313)"
```

---

### Task 9: Update tests

**Files:**
- Modify: `tests/unit/colors.test.js`
- Modify: `tests/unit/serialize-v2.test.js`
- Modify: `tests/unit/fill-to-key.test.js`
- Modify: `tests/unit/audio-engine.test.js` (formant references in stubs)

- [ ] **Step 1: Rewrite colors.test.js**

Replace the entire file — old tests reference hslToString/hslToHex/hexToHsl which no longer exist:

```js
import { describe, expect, test } from 'bun:test';
import {
  clampChromaToSRGB,
  getSolidFillColor,
  getSwatchColor,
  oklchToString,
} from '../../js/colors.ts';

describe('oklchToString', () => {
  test('formats OKLCH values correctly', () => {
    expect(oklchToString(200, 0.15, 0.55)).toBe('oklch(0.55 0.15 200)');
  });

  test('handles zero values', () => {
    expect(oklchToString(0, 0, 0)).toBe('oklch(0 0 0)');
  });
});

describe('clampChromaToSRGB', () => {
  test('zero chroma returns 0', () => {
    expect(clampChromaToSRGB(0, 0, 0.5)).toBe(0);
  });

  test('moderate chroma at mid-lightness passes through', () => {
    // 0.1 chroma at L=0.5 should be in gamut for most hues
    const clamped = clampChromaToSRGB(180, 0.1, 0.5);
    expect(clamped).toBeCloseTo(0.1, 2);
  });

  test('extreme chroma is reduced', () => {
    // 0.4 chroma at many hues exceeds sRGB
    const clamped = clampChromaToSRGB(150, 0.4, 0.5);
    expect(clamped).toBeLessThan(0.4);
    expect(clamped).toBeGreaterThan(0);
  });
});

describe('getSolidFillColor', () => {
  test('returns oklch string for solid fill', () => {
    const fill = { h: 200, c: 0.15, l: 0.55, mode: 'solid' };
    expect(getSolidFillColor(fill)).toBe('oklch(0.55 0.15 200)');
  });
});

describe('getSwatchColor', () => {
  test('solid fill returns oklch string', () => {
    const fill = { h: 200, c: 0.15, l: 0.55, mode: 'solid' };
    expect(getSwatchColor(fill)).toBe('oklch(0.55 0.15 200)');
  });

  test('linear fill returns linear-gradient string', () => {
    const fill = {
      gradAngle: 45,
      h: 320, c: 0.2, l: 0.55,
      h2: 180, c2: 0.15, l2: 0.45,
      mode: 'linear',
    };
    const result = getSwatchColor(fill);
    expect(result).toContain('linear-gradient(');
    expect(result).toContain('135deg');
    expect(result).toContain('oklch(');
  });
});
```

- [ ] **Step 2: Update serialize-v2.test.js**

Replace all `s:` → `c:`, `s2:` → `c2:` in fill objects, and adjust value ranges. A few key changes:

Replace `makeVoice`:
```js
function makeVoice(overrides = {}) {
  return {
    border: undefined,
    effect: undefined,
    fill: { h: 200, c: 0.15, l: 0.55, mode: 'solid' },
    id: 'test1',
    size: 0.5,
    waveform: 'sine',
    x: 0.5,
    y: 0.5,
    ...overrides,
  };
}
```

Update all test assertions that check `fill.s` → `fill.c`, `fill.l` → adjust values to 0–1 range, and gradient fills to use `c`/`c2`/OKLCH lightness values. Key tests to update:

- "sine voice with solid fill": expect `c: 0.15`, `l: 0.55` (with quantization tolerance)
- "gradient fill round-trips": update fill values to OKLCH ranges
- "hue preserved exactly": keep as-is (hue range unchanged)
- "all-zero voice": `fill: { h: 0, c: 0, l: 0, mode: 'solid' }`
- "max-value voice": `fill: { h: 360, c: 0.4, l: 1, mode: 'solid' }`

For quantization accuracy, chroma round-trips as `round(c * 320) / 320`, so expect `toBeCloseTo(0.15, 2)`.
Lightness round-trips as `round(l * 255) / 255`, so expect `toBeCloseTo(0.55, 2)`.

- [ ] **Step 3: Update fill-to-key.test.js**

Replace `s` → `c`, `s2` → `c2` in all fill objects:

```js
  test('returns undefined for solid fills', () => {
    expect(fillToKey({ mode: 'solid', h: 120, c: 0.15, l: 0.5 })).toBeUndefined();
  });

  test('returns a string key for linear fills', () => {
    const key = fillToKey({
      mode: 'linear',
      h: 0, c: 0.15, l: 0.5,
      h2: 120, c2: 0.1, l2: 0.7,
      gradAngle: 90,
    });
    expect(typeof key).toBe('string');
    expect(key).toBe('0:0.15:0.5:120:0.1:0.7:90');
  });
```

Update the "different fills" and "same fill" tests similarly.

- [ ] **Step 4: Update audio-engine.test.js stubs**

Search for `formantF1`, `formantF2`, `formantMixer`, `brightness` in the stub constructors and replace with `peak`, `lowpass`. The stubs create mock BiquadFilterNodes — just rename the properties. Also search for any `type: 'bandpass'` → `type: 'peaking'` in stubs.

- [ ] **Step 5: Run full test suite**

Run: `bun run test:unit`

Expected: All unit tests pass. Fix any remaining `.s`/`.s2` references found by test failures.

- [ ] **Step 6: Commit**

```bash
git add tests/
git commit -m "test: update all tests for OKLCH+parametric EQ (#313)"
```

---

### Task 10: Typecheck, lint, and fix remaining references

- [ ] **Step 1: Run typecheck**

Run: `bun run check`

Expected: Clean (no errors). If there are errors, they'll be remaining `.s` / `.s2` / `formantF1` / `formantF2` / `formantMixer` / `brightness` references — fix them.

- [ ] **Step 2: Run lint**

Run: `bun run lint`

- [ ] **Step 3: Run format**

Run: `bun run fmt`

- [ ] **Step 4: Run full test suite (unit + e2e)**

Run: `bun run test`

Fix any e2e test failures — these will likely be hardcoded fill values in integration test helpers or assertions.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: fix remaining references and formatting (#313)"
```
