// Effects.ts — FM synthesis parameters for blend modes and overlap computation.
//
// Pattern-driven audio effects are co-located with pattern definitions
// in patterns.ts. This file handles only cross-voice FM synthesis
// (blend modes) and overlap geometry.

import type { BlendMode } from './types.ts';

// ---- FM synthesis parameters per blend mode ----
//
// When shapes overlap, the top voice's oscillator modulates the bottom voice's
// frequency. The blend mode of the top voice determines the FM character.

/** FM behavior parameters for a blend mode. */
export interface FMParams {
  /** Maximum modulation index at full overlap. */
  maxIndex: number;
  /** Depth scaling: 'linear' = overlap × maxIndex, 'sqrt' = √overlap × maxIndex, 'exponential' = overlap² × maxIndex. */
  depthCurve: 'linear' | 'sqrt' | 'exponential';
  /** Self-modulation feedback amount (0–1). Modulator feeds back into its own frequency. */
  feedback: number;
}

/** FM parameters indexed by blend mode. */
export const FM_PARAMS: Record<BlendMode, FMParams> = {
  screen: { maxIndex: 0, depthCurve: 'linear', feedback: 0 },
  multiply: { maxIndex: 0.8, depthCurve: 'sqrt', feedback: 0 },
  exclusion: { maxIndex: 1.2, depthCurve: 'linear', feedback: 0 },
  difference: { maxIndex: 1.8, depthCurve: 'linear', feedback: 0.2 },
};

/** Max frequency deviation in Hz to prevent extreme high-ratio FM from sounding harsh. */
const MAX_FM_DEVIATION = 2000;

/**
 * Compute the FM depth gain value for a modulator→carrier connection.
 * depth = min(scaledIndex × modulatorFreq, MAX_DEVIATION)
 */
export function computeFMDepth(overlap: number, params: FMParams, modulatorFreq: number): number {
  const shaped =
    params.depthCurve === 'exponential'
      ? overlap * overlap
      : params.depthCurve === 'sqrt'
        ? Math.sqrt(overlap)
        : overlap;
  const scaled = shaped * params.maxIndex;
  return Math.min(scaled * modulatorFreq, MAX_FM_DEVIATION);
}

// ---- Overlap computation ----

/** Compute overlap between two voices as 0–1 based on center distance and sizes. */
export function computeOverlap(
  x1: number,
  y1: number,
  size1: number,
  x2: number,
  y2: number,
  size2: number,
): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const combinedRadius = (size1 + size2) / 2;
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
    total += computeOverlap(v.x, v.y, v.size, other.x, other.y, other.size);
  }
  return Math.min(1, total);
}
