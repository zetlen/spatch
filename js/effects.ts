// Effects.ts — FM synthesis parameters for blend modes and overlap computation.
//
// Pattern-driven audio effects are co-located with pattern definitions
// In patterns.ts. This file handles only cross-voice FM synthesis
// (blend modes) and overlap geometry.

import type { BlendMode } from './types.ts';

// ---- Cross-modulation parameters per blend mode ----
//
// When shapes overlap, voices cross-modulate each other bidirectionally.
// The blend mode determines the synthesis technique and character.

/** FM behavior parameters for sine cross-FM and raw cross-FM modes. */
export interface FMConfig {
  maxIndex: number;
  depthCurve: 'linear' | 'sqrt';
}

/** Ring modulation config. Depth controlled purely by overlap. */
export type RingConfig = Record<string, never>;

/** Raw cross-FM config (includes lowpass on the modulator). */
export interface RawFMConfig {
  maxIndex: number;
  depthCurve: 'linear' | 'sqrt';
}

export type BlendConfig =
  | { type: 'none' }
  | { type: 'fm'; config: FMConfig }
  | { type: 'ring'; config: RingConfig }
  | { type: 'rawfm'; config: RawFMConfig };

/** Cross-modulation config indexed by blend mode. */
export const BLEND_CONFIG: Record<BlendMode, BlendConfig> = {
  screen: { type: 'none' },
  multiply: { type: 'fm', config: { maxIndex: 0.5, depthCurve: 'sqrt' } },
  exclusion: { type: 'ring', config: {} },
  difference: { type: 'rawfm', config: { maxIndex: 0.8, depthCurve: 'linear' } },
};

/** Max frequency deviation in Hz to prevent extreme high-ratio FM from sounding harsh. */
const MAX_FM_DEVIATION = 600;

/**
 * Modulator lowpass cutoff, Hz.
 * Passes the full melodic range (≤~784 Hz fundamentals) and attenuates
 * 3rd+ harmonics of non-sine modulators, which are the dominant source
 * of FM harshness.
 */
export const FM_MODULATOR_LPF_HZ = 1800;

/** Butterworth Q — flat passband, no resonance peak. */
export const FM_MODULATOR_LPF_Q = Math.SQRT1_2;

/**
 * Compute the FM depth gain value for a modulator→carrier connection.
 * depth = min(scaledIndex × modulatorFreq, MAX_DEVIATION)
 */
export function computeFMDepth(
  overlap: number,
  config: FMConfig | RawFMConfig,
  modulatorFreq: number,
): number {
  const shaped = config.depthCurve === 'sqrt' ? Math.sqrt(overlap) : overlap;
  const scaled = shaped * config.maxIndex;
  return Math.min(scaled * modulatorFreq, MAX_FM_DEVIATION);
}

// ---- Overlap computation ----

/** Compute overlap between two voices as 0–1 based on center distance and sizes. */
export function computeOverlap(
  a: { x: number; y: number; size: number },
  b: { x: number; y: number; size: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const combinedRadius = (a.size + b.size) / 2;
  if (combinedRadius <= 0) {
    return 0;
  }
  return Math.max(0, 1 - dist / combinedRadius);
}

/** Compute total overlap for a voice against all other voices. */
export function computeTotalOverlap(
  voiceIndex: number,
  voices: readonly { x: number; y: number; size: number }[],
): number {
  const v = voices[voiceIndex]!;
  let total = 0;
  for (let i = 0; i < voices.length; i++) {
    if (i === voiceIndex) {
      continue;
    }
    const other = voices[i]!;
    total += computeOverlap(v, other);
  }
  return Math.min(1, total);
}
