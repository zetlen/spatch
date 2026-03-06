// Vibe — perceptual gain tuning constants and methods
//
// Encapsulates the math that maps visual shape properties to audio gain,
// ensuring all waveform types converge to similar perceived loudness at
// medium sizes while preserving distinct character at small/large sizes.

import type { BorderColor, WaveformType } from '../types.ts';

export interface VibeOptions {
  norm?: number;
  refMult?: number;
  exponents?: Partial<Record<WaveformType, number>>;
}

export const VIBE_DEFAULTS = {
  norm: 0.5,
  refMult: 1.1,
  exponents: { sine: 1.0, pulse: 1.6, blend: 1.3 } as Record<WaveformType, number>,
};

export class Vibe {
  readonly GAIN_MIN = 0.05;
  readonly GAIN_MAX = 0.8;

  readonly norm: number;
  readonly refMult: number;

  readonly GAIN_EXPONENT: Record<WaveformType, number>;

  readonly OCTAVE_GAIN_COEFF: Record<string, number> = {
    'up-1': 0.5,
    'up-2': 0.35,
    'down-1': 1.5,
    'down-2': 2,
  };

  readonly WAVEFORM_GAIN: Record<WaveformType, number>;

  constructor(opts?: VibeOptions) {
    this.norm = opts?.norm ?? VIBE_DEFAULTS.norm;
    this.refMult = opts?.refMult ?? VIBE_DEFAULTS.refMult;
    this.GAIN_EXPONENT = {
      sine: opts?.exponents?.sine ?? VIBE_DEFAULTS.exponents.sine,
      pulse: opts?.exponents?.pulse ?? VIBE_DEFAULTS.exponents.pulse,
      blend: opts?.exponents?.blend ?? VIBE_DEFAULTS.exponents.blend,
    };

    const refVoiceGain = this.refMult * this.areaToGain('sine', 0.5);
    this.WAVEFORM_GAIN = {
      sine: this.refMult,
      pulse: refVoiceGain / this.areaToGain('pulse', 0.5),
      blend: refVoiceGain / this.areaToGain('blend', 0.5),
    };
  }

  /** Compute shape area as fraction of canvas area. */
  shapeAreaFraction(waveform: WaveformType, size: number): number {
    const half = size / 2;
    switch (waveform) {
      case 'sine':
        return Math.PI * half * half;
      case 'pulse':
        return size * size;
      case 'blend':
        return ((3 * Math.sqrt(3)) / 4) * half * half;
    }
  }

  /** Power curve: normalize area, raise to exponent, map to gain range. */
  areaToGain(waveform: WaveformType, size: number): number {
    const area = this.shapeAreaFraction(waveform, size);
    const normalized = area / this.norm;
    const curved = Math.pow(normalized, this.GAIN_EXPONENT[waveform]);
    return Math.min(this.GAIN_MAX, this.GAIN_MIN + (this.GAIN_MAX - this.GAIN_MIN) * curved);
  }

  /** Returns the per-waveform gain multiplier. */
  waveformGain(waveform: WaveformType): number {
    return this.WAVEFORM_GAIN[waveform];
  }

  /** Returns the combined voice gain (areaToGain * waveformGain), clamped to GAIN_MAX. */
  voiceGain(waveform: WaveformType, size: number): number {
    return Math.min(this.GAIN_MAX, this.areaToGain(waveform, size) * this.WAVEFORM_GAIN[waveform]);
  }

  /** Border octave oscillator gain, derived from voice gain, thickness, and octave direction. */
  borderOctaveGain(
    waveform: WaveformType,
    size: number,
    thickness: number,
    color: BorderColor,
    double: boolean,
  ): number {
    if (thickness === 0) return 0;
    const key = `${color === 'white' ? 'up' : 'down'}-${double ? 2 : 1}`;
    const coeff = this.OCTAVE_GAIN_COEFF[key] ?? 1;
    return this.voiceGain(waveform, size) * Math.sqrt(thickness) * coeff;
  }
}

export let vibe = new Vibe();

/** Replace the active vibe instance (debug tuner only). */
export function setVibe(v: Vibe): void {
  vibe = v;
}
