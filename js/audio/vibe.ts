// Vibe — perceptual gain tuning constants and methods
//
// Encapsulates the math that maps visual shape properties to audio gain,
// Ensuring all waveform types converge to similar perceived loudness at
// Medium sizes while preserving distinct character at small/large sizes.

import { signal } from '@preact/signals-core';
import type { BorderColor, WaveformType } from '../types.ts';
import { all, get } from '../voices/registry.ts';

export interface VibeOptions {
  // Existing
  norm?: number;
  refMult?: number;
  exponents?: Partial<Record<WaveformType, number>>;

  // Reverb / Ambience
  ir?: string;
  reverbMix?: number;
  reverbPreDelay?: number;

  // Mastering
  compThreshold?: number;
  compKnee?: number;
  compRatio?: number;
  compAttack?: number;
  compRelease?: number;
  masterGain?: number;
  eqLowFreq?: number;
  eqLowGain?: number;
  eqMidFreq?: number;
  eqMidGain?: number;
  eqMidQ?: number;
  eqHighFreq?: number;
  eqHighGain?: number;

  // Synthesis / Sound Font
  warmth?: number;
  formantMix?: number;
  formantQ?: number;
  brightnessQ?: number;
  octaveGainCoeffs?: Partial<Record<string, number>>;
  stereoWidth?: number;

  // Master effects (inserted between envelope and compressor)
  saturation?: number;
  excite?: number;
  combMix?: number;
  combFreq?: number;
}

export const VIBE_DEFAULTS = {
  norm: 0.5,
  refMult: 1.1,

  ir: undefined as string | undefined,
  reverbMix: 0,
  reverbPreDelay: 0,

  compThreshold: -10,
  compKnee: 18,
  compRatio: 3,
  compAttack: 0.005,
  compRelease: 0.25,
  masterGain: 0.5,
  eqLowFreq: 200,
  eqLowGain: 0,
  eqMidFreq: 1000,
  eqMidGain: 0,
  eqMidQ: 1,
  eqHighFreq: 4000,
  eqHighGain: 0,

  warmth: 1.5,
  formantMix: 0.7,
  formantQ: 1,
  brightnessQ: Math.SQRT1_2,
  octaveGainCoeffs: { 'up-1': 0.5, 'up-2': 0.35, 'down-1': 1.5, 'down-2': 2 } as Record<
    string,
    number
  >,
  stereoWidth: 1,

  saturation: 0,
  excite: 0,
  combMix: 0,
  combFreq: 0.008,
};

export class Vibe {
  readonly GAIN_MIN = 0.05;
  readonly GAIN_MAX = 0.8;

  readonly norm: number;
  readonly refMult: number;

  readonly GAIN_EXPONENT: Record<WaveformType, number>;

  readonly OCTAVE_GAIN_COEFF: Record<string, number>;

  readonly WAVEFORM_GAIN: Record<WaveformType, number>;

  // Reverb / Ambience
  readonly ir: string | undefined;
  readonly reverbMix: number;
  readonly reverbPreDelay: number;

  // Mastering
  readonly compThreshold: number;
  readonly compKnee: number;
  readonly compRatio: number;
  readonly compAttack: number;
  readonly compRelease: number;
  readonly masterGain: number;
  readonly eqLowFreq: number;
  readonly eqLowGain: number;
  readonly eqMidFreq: number;
  readonly eqMidGain: number;
  readonly eqMidQ: number;
  readonly eqHighFreq: number;
  readonly eqHighGain: number;

  // Synthesis / Sound Font
  readonly warmth: number;
  readonly formantMix: number;
  readonly formantQ: number;
  readonly brightnessQ: number;
  readonly stereoWidth: number;

  // Master effects
  readonly saturation: number;
  readonly excite: number;
  readonly combMix: number;
  readonly combFreq: number;

  constructor(opts?: VibeOptions) {
    this.norm = opts?.norm ?? VIBE_DEFAULTS.norm;
    this.refMult = opts?.refMult ?? VIBE_DEFAULTS.refMult;
    this.GAIN_EXPONENT = {} as Record<WaveformType, number>;
    for (const entry of all()) {
      this.GAIN_EXPONENT[entry.waveform] =
        opts?.exponents?.[entry.waveform] ?? entry.player.gainExponent;
    }
    const mergedCoeffs: Record<string, number> = { ...VIBE_DEFAULTS.octaveGainCoeffs };
    if (opts?.octaveGainCoeffs) {
      for (const [k, v] of Object.entries(opts.octaveGainCoeffs)) {
        if (v !== undefined) {
          mergedCoeffs[k] = v;
        }
      }
    }
    this.OCTAVE_GAIN_COEFF = mergedCoeffs;

    // Reverb / Ambience
    this.ir = opts?.ir ?? VIBE_DEFAULTS.ir;
    this.reverbMix = opts?.reverbMix ?? VIBE_DEFAULTS.reverbMix;
    this.reverbPreDelay = opts?.reverbPreDelay ?? VIBE_DEFAULTS.reverbPreDelay;

    // Mastering
    this.compThreshold = opts?.compThreshold ?? VIBE_DEFAULTS.compThreshold;
    this.compKnee = opts?.compKnee ?? VIBE_DEFAULTS.compKnee;
    this.compRatio = opts?.compRatio ?? VIBE_DEFAULTS.compRatio;
    this.compAttack = opts?.compAttack ?? VIBE_DEFAULTS.compAttack;
    this.compRelease = opts?.compRelease ?? VIBE_DEFAULTS.compRelease;
    this.masterGain = opts?.masterGain ?? VIBE_DEFAULTS.masterGain;
    this.eqLowFreq = opts?.eqLowFreq ?? VIBE_DEFAULTS.eqLowFreq;
    this.eqLowGain = opts?.eqLowGain ?? VIBE_DEFAULTS.eqLowGain;
    this.eqMidFreq = opts?.eqMidFreq ?? VIBE_DEFAULTS.eqMidFreq;
    this.eqMidGain = opts?.eqMidGain ?? VIBE_DEFAULTS.eqMidGain;
    this.eqMidQ = opts?.eqMidQ ?? VIBE_DEFAULTS.eqMidQ;
    this.eqHighFreq = opts?.eqHighFreq ?? VIBE_DEFAULTS.eqHighFreq;
    this.eqHighGain = opts?.eqHighGain ?? VIBE_DEFAULTS.eqHighGain;

    // Synthesis / Sound Font
    this.warmth = opts?.warmth ?? VIBE_DEFAULTS.warmth;
    this.formantMix = opts?.formantMix ?? VIBE_DEFAULTS.formantMix;
    this.formantQ = opts?.formantQ ?? VIBE_DEFAULTS.formantQ;
    this.brightnessQ = opts?.brightnessQ ?? VIBE_DEFAULTS.brightnessQ;
    this.stereoWidth = opts?.stereoWidth ?? VIBE_DEFAULTS.stereoWidth;

    // Master effects
    this.saturation = opts?.saturation ?? VIBE_DEFAULTS.saturation;
    this.excite = opts?.excite ?? VIBE_DEFAULTS.excite;
    this.combMix = opts?.combMix ?? VIBE_DEFAULTS.combMix;
    this.combFreq = opts?.combFreq ?? VIBE_DEFAULTS.combFreq;

    const refVoiceGain = this.refMult * this.areaToGain('sine', 0.5);
    this.WAVEFORM_GAIN = {} as Record<WaveformType, number>;
    for (const entry of all()) {
      this.WAVEFORM_GAIN[entry.waveform] =
        entry.waveform === 'sine'
          ? this.refMult
          : refVoiceGain / this.areaToGain(entry.waveform, 0.5);
    }
  }

  /** Compute shape area as fraction of canvas area.
   *  Delegates to each strategy's shapeAreaCoeff so new waveforms are covered automatically. */
  shapeAreaFraction(waveform: WaveformType, size: number): number {
    const half = size / 2;
    return get(waveform).player.shapeAreaCoeff * half * half;
  }

  /** Power curve: normalize area, raise to exponent, map to gain range. */
  areaToGain(waveform: WaveformType, size: number): number {
    const area = this.shapeAreaFraction(waveform, size);
    const normalized = area / this.norm;
    const curved = normalized ** this.GAIN_EXPONENT[waveform];
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

  /** Map normalized X coordinate to stereo pan value, scaled by stereoWidth. */
  xToPan(x: number): number {
    return (x * 2 - 1) * this.stereoWidth;
  }

  /** Border octave oscillator relative gain (thickness × direction coefficient).
   *  The voice-level gain is applied by the shared gain node that the border
   *  flows through, so this only encodes border-specific scaling. */
  borderOctaveGain(thickness: number, color: BorderColor, double: boolean): number {
    if (thickness === 0) {
      return 0;
    }
    const key = `${color === 'white' ? 'up' : 'down'}-${double ? 2 : 1}`;
    const coeff = this.OCTAVE_GAIN_COEFF[key] ?? 1;
    return Math.sqrt(thickness) * coeff;
  }
}

/** Reactive signal holding the current Vibe. Subscribe via `effect()`. */
const _vibeSignal = signal<Vibe>(new Vibe());
export const vibeSignal: { readonly value: Vibe } = _vibeSignal;

/**
 * Current vibe instance (non-reactive).
 * Use for imperative reads in audio code; use `vibeSignal` in effects.
 */
export let vibe: Vibe = _vibeSignal.peek();

/** Replace the active vibe instance. Updates both the signal and module binding. */
export function setVibe(v: Vibe): void {
  vibe = v;
  _vibeSignal.value = v;
}
