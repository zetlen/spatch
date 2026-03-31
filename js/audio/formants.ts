// Formants.ts — Formant filter mapping.
// Pure functions mapping visual fill properties to audio filter parameters.
// No Web Audio API node creation — just parameter computation (except applyFormantFilter
// Which sets values on pre-existing BiquadFilterNodes).

import type { Fill, LinearFill, WaveformType } from '../types.ts';
import { get } from '../voices/registry.ts';

const DEFAULT_FORMANT_Q = 1;

// ---- Formant filter mapping ----
//
// Hue drives a smooth path through vowel space (F1 = openness, F2 = frontness).
// Saturation controls formant resonance (Q). Lightness controls a brightness
// Shelf.  Linear gradient crossfades formants between the two colors; gradient
// Angle controls the blend bias.

interface FormantPoint {
  hue: number;
  f1: number;
  f2: number;
}

const FORMANT_ANCHORS: FormantPoint[] = [
  { f1: 730, f2: 1090, hue: 0 }, // /a/ -- open central
  { f1: 530, f2: 1840, hue: 60 }, // /e/ -- mid front
  { f1: 270, f2: 2290, hue: 120 }, // /i/ -- close front
  { f1: 300, f2: 870, hue: 180 }, // /u/ -- close back
  { f1: 570, f2: 840, hue: 240 }, // /o/ -- mid back
  { f1: 680, f2: 1100, hue: 300 }, // /a:/ -- open back
];

/**
 * Map a hue angle (0-360) to formant frequencies F1 and F2.
 *
 * Interpolates between six vowel anchor points arranged around the hue circle.
 * The mapping wraps smoothly at 360 degrees. F1 represents vocal tract openness
 * and F2 represents frontness/backness.
 *
 * @param hue - Hue angle in degrees (wraps at 360)
 * @returns Object with `f1` and `f2` frequencies in Hz
 */
export function hueToFormants(hue: number): { f1: number; f2: number } {
  const h = ((hue % 360) + 360) % 360;
  const n = FORMANT_ANCHORS.length;

  // Find the two anchors that bracket this hue
  let lo = FORMANT_ANCHORS[n - 1]!;
  let hi = FORMANT_ANCHORS[0]!;
  for (let i = 0; i < n; i++) {
    const a = FORMANT_ANCHORS[i]!;
    const b = FORMANT_ANCHORS[(i + 1) % n]!;
    const aHue = a.hue;
    const bHue = i === n - 1 ? 360 : b.hue;
    if (h >= aHue && h < bHue) {
      lo = a;
      hi = b;
      const t = (h - aHue) / (bHue - aHue);
      return {
        f1: lo.f1 + (hi.f1 - lo.f1) * t,
        f2: lo.f2 + (hi.f2 - lo.f2) * t,
      };
    }
  }

  // Fallback (shouldn't reach here)
  return { f1: lo.f1, f2: hi.f2 };
}

/**
 * Map lightness (0-100) to a lowpass filter cutoff frequency.
 *
 * Uses an exponential mapping: dark colors (low lightness) produce a muffled
 * sound via low cutoff (~300 Hz), while light colors (high lightness) open
 * the filter (~12000 Hz). Mid-grey lands around ~1900 Hz.
 *
 * @param lightness - HSL lightness value (0 = black, 100 = white)
 * @returns Lowpass cutoff frequency in Hz
 */
export function lightnessToCutoff(lightness: number): number {
  const t = lightness / 100; // 0-1
  return 300 * (12_000 / 300) ** t; // Exponential: 300 -> 12000
}

/**
 * Compute the formant Q (resonance) from saturation and waveform type.
 *
 * Sine waveforms cap Q lower than harmonics-rich waveforms because high Q on a
 * single partial kills the signal when the fundamental is far from formant centers.
 *
 * @param saturation - HSL saturation value (0-100)
 * @param waveform - The voice's waveform type (affects max Q)
 * @returns Computed Q value scaled by DEFAULT_FORMANT_Q
 */
export function computeFormantQ(saturation: number, waveform: WaveformType = 'pulse'): number {
  const maxQ = get(waveform).player.formantMaxQ;
  return (1 + (saturation / 100) * maxQ) * DEFAULT_FORMANT_Q;
}

/**
 * Apply formant filter settings to pre-existing BiquadFilterNodes based on a Fill.
 *
 * Maps the fill's hue to formant frequencies (F1/F2 bandpass filters), saturation
 * to filter Q (resonance), and lightness to a brightness lowpass cutoff. For
 * linear gradient fills, sets formants to the sweep's starting color (respecting
 * reversal); the time-based sweep handles the transition.
 *
 * Sine waveforms cap Q lower than harmonics-rich waveforms because high Q on a
 * single partial kills the signal when the fundamental is far from formant centers.
 *
 * @param f1Node - BiquadFilterNode for the first formant (bandpass)
 * @param f2Node - BiquadFilterNode for the second formant (bandpass)
 * @param brightnessNode - BiquadFilterNode for the brightness shelf (lowpass)
 * @param fill - The voice's Fill (solid or linear gradient)
 * @param waveform - The voice's waveform type (affects max Q)
 */
export function applyFormantFilter(
  f1Node: BiquadFilterNode,
  f2Node: BiquadFilterNode,
  brightnessNode: BiquadFilterNode,
  fill: Fill,
  waveform: WaveformType = 'pulse',
) {
  let { h } = fill;
  let { s } = fill;
  let { l } = fill;

  if (fill.mode === 'linear') {
    // Set formants to the sweep's starting color. The time-based sweep
    // (scheduleFormantSweep) handles the transition to the end color.
    // When reversed (bit 2 set, angles 180°–315°), start from color 2.
    if (isSweepReversed(fill.gradAngle)) {
      h = fill.h2;
      s = fill.s2;
      l = fill.l2;
    }
  }

  const formants = hueToFormants(h);
  const q = computeFormantQ(s, waveform);

  f1Node.frequency.value = formants.f1;
  f1Node.Q.value = q;
  f2Node.frequency.value = formants.f2;
  f2Node.Q.value = q * 0.7;

  // Lightness -> lowpass cutoff: dark = muffled, light = open
  brightnessNode.frequency.value = lightnessToCutoff(l);
}

// ---- Gradient-angle → sweep parameters ----
//
// For linear gradient fills, the gradient angle (always a multiple of 45°)
// Determines how the formant filter sweeps between the two colors over time.
// `durationFrac` controls sweep speed (fraction of the decay phase) and
// `exponent` shapes the easing curve (1 = linear, >1 = ease-in, <1 = ease-out).

interface SweepParams {
  durationFrac: number;
  exponent: number;
}

const SWEEP_TABLE: SweepParams[] = [
  { durationFrac: 1, exponent: 1 }, // 0°   LR     — slowest, linear
  { durationFrac: 0.8, exponent: 2 }, // 45°  TL→BR  — medium, ease-in
  { durationFrac: 0.6, exponent: 1 }, // 90°  TB     — moderate, linear
  { durationFrac: 0.8, exponent: 0.5 }, // 135° TR→BL  — medium, ease-out
  { durationFrac: 0.4, exponent: 1 }, // 180° RL     — fastest, linear
  { durationFrac: 0.8, exponent: 2 }, // 225° BR→TL  — medium, ease-in
  { durationFrac: 0.6, exponent: 1 }, // 270° BT     — moderate, linear
  { durationFrac: 0.8, exponent: 0.5 }, // 315° BL→TR  — medium, ease-out
];

/**
 * Look up sweep parameters for a gradient angle.
 *
 * The angle is snapped to the nearest multiple of 45° and wrapped to [0, 360).
 * Returns the `durationFrac` (sweep speed as a fraction of the decay phase) and
 * `exponent` (easing curve power) for that direction.
 *
 * @param angleDeg - Gradient angle in degrees (wraps and rounds to nearest 45°)
 * @returns SweepParams for the closest cardinal/ordinal direction
 */
export function sweepParamsForAngle(angleDeg: number): SweepParams {
  const a = ((angleDeg % 360) + 360) % 360;
  const index = Math.round(a / 45) & 7;
  return SWEEP_TABLE[index]!;
}

/**
 * Build a monotonic sweep curve as a Float32Array.
 *
 * Each sample is `(i / (samples - 1)) ** exponent`, producing values in [0, 1].
 * Exponent 1 = linear, >1 = ease-in (slow start), <1 = ease-out (fast start).
 * Intended for use as a `setValueCurveAtTime` automation array.
 *
 * @param exponent - Power curve exponent (must be > 0)
 * @param samples - Number of samples in the output array (must be >= 2)
 * @returns Float32Array of length `samples` with values from 0 to 1
 */
export function buildSweepCurve(exponent: number, samples: number): Float32Array {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    curve[i] = (i / (samples - 1)) ** exponent;
  }
  return curve;
}

const SWEEP_CURVE_SAMPLES = 64;

/** True when the gradient's anchor bit (bit 2) is set, meaning the sweep direction is reversed. */
export function isSweepReversed(gradAngle: number): boolean {
  return (Math.round(gradAngle / 45) & 4) !== 0;
}

export function scheduleFormantSweep(
  nodes: { f1: BiquadFilterNode; f2: BiquadFilterNode; brightness: BiquadFilterNode },
  fill: LinearFill,
  waveform: WaveformType,
  startTime: number,
  decayDuration: number,
): void {
  const { f1: f1Node, f2: f2Node, brightness: brightnessNode } = nodes;
  const reversed = isSweepReversed(fill.gradAngle);
  const startF = hueToFormants(reversed ? fill.h2 : fill.h);
  const endF = hueToFormants(reversed ? fill.h : fill.h2);
  const startQ = computeFormantQ(reversed ? fill.s2 : fill.s, waveform);
  const endQ = computeFormantQ(reversed ? fill.s : fill.s2, waveform);
  const startCutoff = lightnessToCutoff(reversed ? fill.l2 : fill.l);
  const endCutoff = lightnessToCutoff(reversed ? fill.l : fill.l2);

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
