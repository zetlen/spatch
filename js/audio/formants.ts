// formants.ts — Formant filter mapping and border octave gain.
// Pure functions mapping visual fill properties to audio filter parameters.
// No Web Audio API node creation — just parameter computation (except applyFormantFilter
// which sets values on pre-existing BiquadFilterNodes).

import type { BorderColor, Fill, NormalizedCoord, WaveformType } from '../types.ts';
import { areaToGain, waveformGain } from './mapping.ts';

// ---- Border octave gain ----

// Direction-dependent loudness coefficients for octave-doubled border oscillator.
// Higher octaves sound louder perceptually (equal-loudness contours), so we
// attenuate up-shifts and boost down-shifts.
const OCTAVE_GAIN_COEFF: Record<string, number> = {
  'down-1': 1.5,
  'down-2': 2,
  'up-1': 0.5,
  'up-2': 0.35,
};

/**
 * Compute the gain for a border's octave-doubled oscillator.
 *
 * Border color determines octave direction (white = up, black = down).
 * The `double` flag doubles the octave shift (1 or 2 octaves). Gain scales
 * with the base voice gain (from shape area), square root of border thickness,
 * and a perceptual loudness coefficient that attenuates higher octaves and
 * boosts lower ones.
 *
 * @param waveform - Voice waveform type (determines base area gain formula)
 * @param size - Normalized shape size (0-1)
 * @param thickness - Normalized border thickness (0-1)
 * @param color - Border color: 'white' (octave up) or 'black' (octave down)
 * @param double - Whether to shift by 2 octaves instead of 1
 * @returns Gain value for the octave oscillator (non-negative)
 */
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

// ---- Formant filter mapping ----
//
// Hue drives a smooth path through vowel space (F1 = openness, F2 = frontness).
// Saturation controls formant resonance (Q). Lightness controls a brightness
// shelf.  Linear gradient crossfades formants between the two colors; gradient
// angle controls the blend bias.

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
 * Apply formant filter settings to pre-existing BiquadFilterNodes based on a Fill.
 *
 * Maps the fill's hue to formant frequencies (F1/F2 bandpass filters), saturation
 * to filter Q (resonance), and lightness to a brightness lowpass cutoff. For
 * linear gradient fills, the formant parameters are crossfaded between the two
 * colors based on the gradient angle.
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
    // Crossfade formants between primary and secondary colors.
    // Gradient angle sets the blend: 0 deg = primary, 90 deg = 50/50, 180 deg = secondary.
    const blend = (((fill.gradAngle % 360) + 360) % 360) / 360;
    h += (fill.h2 - h) * blend;
    s += (fill.s2 - s) * blend;
    l += (fill.l2 - l) * blend;
  }

  const formants = hueToFormants(h);
  // Sine has no harmonics -- high Q kills the signal when the fundamental
  // is far from formant centers. Cap Q lower for sine (#82).
  const maxQ = waveform === 'sine' ? 4 : 8;
  const q = 1 + (s / 100) * maxQ;

  f1Node.frequency.value = formants.f1;
  f1Node.Q.value = q;
  f2Node.frequency.value = formants.f2;
  f2Node.Q.value = q * 0.7;

  // Lightness -> lowpass cutoff: dark = muffled, light = open
  brightnessNode.frequency.value = lightnessToCutoff(l);
}
