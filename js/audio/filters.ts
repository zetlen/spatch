// Filters.ts — Color-to-audio mapping for OKLCH fills.
//
// Two independent formant dimensions + a brightness lowpass:
// Hue → F1 frequency (vowel height: open ↔ closed)
// Chroma → F2 frequency (vowel frontness: back ↔ front)
// Lightness → lowpass cutoff (dark/warm ↔ light/bright)

import type { Fill, LinearFill } from '../types.ts';

// ---- Vowel formant ranges ----
// Based on standard acoustic phonetics (Peterson & Barney 1952).
// F1 (openness): 270 Hz (closed /i/) to 730 Hz (open /a/).
// F2 (frontness): 840 Hz (back /u/) to 2290 Hz (front /i/).

const F1_MIN = 270;
const F1_MAX = 730;
const F2_MIN = 840;
const F2_MAX = 2290;
const CUTOFF_MIN = 500;
const CUTOFF_MAX = 8000;

// Fixed formant Q — broad enough to color the sound, not so sharp it rings.
export const FORMANT_Q = 3;

// Formant mixer wet level — how much of the formant-filtered signal is heard
// relative to the original. 0.7 keeps the formants clearly audible without
// completely replacing the raw oscillator character.
export const FORMANT_MIX = 0.7;

/**
 * Map OKLCH hue (0–360) to F1 frequency (vowel height).
 * Hue 0° → 270 Hz (closed, like /i/ or /u/).
 * Hue 360° → 730 Hz (open, like /a/).
 * Exponential mapping for perceptually even steps.
 */
export function hueToF1(hue: number): number {
  const t = (((hue % 360) + 360) % 360) / 360;
  return F1_MIN * (F1_MAX / F1_MIN) ** t;
}

/**
 * Map OKLCH chroma (0–0.4) to F2 frequency (vowel frontness).
 * Chroma 0 (grey) → 840 Hz (back vowel, like /u/ or /o/).
 * Chroma 0.4 (vivid) → 2290 Hz (front vowel, like /i/ or /e/).
 * Grey shapes sound neutral/back; vivid shapes sound forward/present.
 */
export function chromaToF2(chroma: number): number {
  const t = chroma / 0.4;
  return F2_MIN * (F2_MAX / F2_MIN) ** t;
}

/**
 * Map OKLCH lightness (0–1) to lowpass cutoff frequency.
 * L=0 (dark) → 500 Hz (warm, muffled). L=1 (light) → 8000 Hz (bright, open).
 * Wide and gentle — doesn't cut aggressively, just shapes brightness.
 */
export function lightnessToCutoff(l: number): number {
  return CUTOFF_MIN * (CUTOFF_MAX / CUTOFF_MIN) ** l;
}

/**
 * Apply color-to-audio settings to the formant filter nodes.
 * For linear gradient fills, sets params to the sweep's starting color.
 */
export function applyColorParams(
  f1: BiquadFilterNode,
  f2: BiquadFilterNode,
  brightness: BiquadFilterNode,
  fill: Fill,
): void {
  let { h, c, l } = fill;

  if (fill.mode === 'linear') {
    if (isSweepReversed(fill.gradAngle)) {
      h = fill.h2;
      c = fill.c2;
      l = fill.l2;
    }
  }

  f1.frequency.value = hueToF1(h);
  f2.frequency.value = chromaToF2(c);
  brightness.frequency.value = lightnessToCutoff(l);
}

// ---- Gradient-angle → sweep parameters ----

interface SweepParams {
  durationFrac: number;
  exponent: number;
}

const SWEEP_TABLE: SweepParams[] = [
  { durationFrac: 1, exponent: 1 },
  { durationFrac: 0.8, exponent: 2 },
  { durationFrac: 0.6, exponent: 1 },
  { durationFrac: 0.8, exponent: 0.5 },
  { durationFrac: 0.4, exponent: 1 },
  { durationFrac: 0.8, exponent: 2 },
  { durationFrac: 0.6, exponent: 1 },
  { durationFrac: 0.8, exponent: 0.5 },
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
 * Schedule a formant sweep between two OKLCH colors over time.
 * Interpolates F1 frequency, F2 frequency, and brightness cutoff.
 */
export function scheduleColorSweep(
  nodes: { f1: BiquadFilterNode; f2: BiquadFilterNode; brightness: BiquadFilterNode },
  fill: LinearFill,
  startTime: number,
  decayDuration: number,
): void {
  const { f1, f2, brightness } = nodes;
  const reversed = isSweepReversed(fill.gradAngle);

  const startF1 = hueToF1(reversed ? fill.h2 : fill.h);
  const endF1 = hueToF1(reversed ? fill.h : fill.h2);
  const startF2 = chromaToF2(reversed ? fill.c2 : fill.c);
  const endF2 = chromaToF2(reversed ? fill.c : fill.c2);
  const startCutoff = lightnessToCutoff(reversed ? fill.l2 : fill.l);
  const endCutoff = lightnessToCutoff(reversed ? fill.l : fill.l2);

  const params = sweepParamsForAngle(fill.gradAngle);
  const easing = buildSweepCurve(params.exponent, SWEEP_CURVE_SAMPLES);
  const duration = Math.max(0.01, decayDuration * params.durationFrac);

  const f1Curve = new Float32Array(SWEEP_CURVE_SAMPLES);
  const f2Curve = new Float32Array(SWEEP_CURVE_SAMPLES);
  const cutoffCurve = new Float32Array(SWEEP_CURVE_SAMPLES);

  for (let i = 0; i < SWEEP_CURVE_SAMPLES; i++) {
    const t = easing[i]!;
    f1Curve[i] = startF1 + (endF1 - startF1) * t;
    f2Curve[i] = startF2 + (endF2 - startF2) * t;
    cutoffCurve[i] = startCutoff + (endCutoff - startCutoff) * t;
  }

  f1.frequency.setValueCurveAtTime(f1Curve, startTime, duration);
  f2.frequency.setValueCurveAtTime(f2Curve, startTime, duration);
  brightness.frequency.setValueCurveAtTime(cutoffCurve, startTime, duration);
}
