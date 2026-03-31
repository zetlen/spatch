// Mixer — per-voice gain, pan, and border octave gain.
//
// Extracted from Vibe: encapsulates the math that maps visual shape properties
// to audio levels. Precomputes waveform normalization from the voice registry
// at construction time so all waveform types converge to similar perceived
// loudness at medium sizes while preserving distinct character at extremes.

import type { BorderColor, NormalizedCoord, WaveformType } from '../types.ts';
import { all, get } from '../voices/registry.ts';

const GAIN_MIN = 0.05;
const GAIN_MAX = 0.8;
const NORM = 0.5;
const REF_MULT = 1.1;

const OCTAVE_GAIN_COEFF: Record<string, number> = {
  'up-1': 0.5,
  'up-2': 0.35,
  'down-1': 1.5,
  'down-2': 2,
};

export class Mixer {
  readonly GAIN_MIN = GAIN_MIN;
  readonly GAIN_MAX = GAIN_MAX;

  private readonly _gainExponent: Record<string, number> = {};
  private readonly _waveformGain: Record<string, number> = {};

  constructor() {
    for (const entry of all()) {
      this._gainExponent[entry.waveform] = entry.player.gainExponent;
    }
    const refVoiceGain = REF_MULT * this.areaToGain('sine', 0.5);
    for (const entry of all()) {
      this._waveformGain[entry.waveform] =
        entry.waveform === 'sine' ? REF_MULT : refVoiceGain / this.areaToGain(entry.waveform, 0.5);
    }
  }

  /** Compute shape area as fraction of canvas area.
   *  Delegates to each voice's shapeAreaCoeff so new waveforms are covered automatically. */
  shapeAreaFraction(waveform: WaveformType, size: number): number {
    const half = size / 2;
    return get(waveform).player.shapeAreaCoeff * half * half;
  }

  /** Power curve: normalize area, raise to exponent, map to gain range. */
  areaToGain(waveform: WaveformType, size: number): number {
    const area = this.shapeAreaFraction(waveform, size);
    const normalized = area / NORM;
    const curved = normalized ** (this._gainExponent[waveform] ?? 1);
    return Math.min(GAIN_MAX, GAIN_MIN + (GAIN_MAX - GAIN_MIN) * curved);
  }

  /** Returns the combined voice gain (areaToGain × waveformGain), clamped to GAIN_MAX. */
  voiceGain(waveform: WaveformType, size: number): number {
    return Math.min(
      GAIN_MAX,
      this.areaToGain(waveform, size) * (this._waveformGain[waveform] ?? 1),
    );
  }

  /** Map normalized X coordinate to stereo pan value (-1 to +1). */
  xToPan(x: NormalizedCoord): number {
    return x * 2 - 1;
  }

  /** Border octave oscillator relative gain (thickness × direction coefficient).
   *  The voice-level gain is applied by the shared gain node that the border
   *  flows through, so this only encodes border-specific scaling. */
  borderOctaveGain(thickness: number, color: BorderColor, double: boolean): number {
    if (thickness === 0) {
      return 0;
    }
    const key = `${color === 'white' ? 'up' : 'down'}-${double ? 2 : 1}`;
    const coeff = OCTAVE_GAIN_COEFF[key] ?? 1;
    return Math.sqrt(thickness) * coeff;
  }
}
