// Effects.ts — Audio effect builders for patterns and FM synthesis for blend modes

import type { AudioEffect, BlendMode, PatternType } from './types.ts';

export const DEFAULT_BLEND: BlendMode = 'screen';

// ---- FM synthesis parameters per blend mode ----
//
// When shapes overlap, the top voice's oscillator modulates the bottom voice's
// frequency. The blend mode of the top voice determines the FM character.

/** FM behavior parameters for a blend mode. */
export interface FMParams {
  /** Maximum modulation index at full overlap. */
  maxIndex: number;
  /** Depth scaling: 'linear' = overlap × maxIndex, 'exponential' = overlap² × maxIndex. */
  depthCurve: 'linear' | 'exponential';
  /** Self-modulation feedback amount (0–1). Modulator feeds back into its own frequency. */
  feedback: number;
  /** LFO rate for depth modulation (Hz). 0 = no LFO. */
  lfoRate: number;
}

/** FM parameters indexed by blend mode. */
export const FM_PARAMS: Record<BlendMode, FMParams> = {
  screen: { maxIndex: 0, depthCurve: 'linear', feedback: 0, lfoRate: 0 },
  multiply: { maxIndex: 1.5, depthCurve: 'exponential', feedback: 0, lfoRate: 0 },
  difference: { maxIndex: 1.5, depthCurve: 'linear', feedback: 0, lfoRate: 0 },
};

/** Max frequency deviation in Hz to prevent extreme high-ratio FM from sounding harsh. */
const MAX_FM_DEVIATION = 2000;

/**
 * Compute the FM depth gain value for a modulator→carrier connection.
 * depth = min(scaledIndex × modulatorFreq, MAX_DEVIATION)
 */
export function computeFMDepth(overlap: number, params: FMParams, modulatorFreq: number): number {
  const scaled =
    params.depthCurve === 'exponential'
      ? overlap * overlap * params.maxIndex
      : overlap * params.maxIndex;
  return Math.min(scaled * modulatorFreq, MAX_FM_DEVIATION);
}

export function createEffect(
  audioCtx: AudioContext,
  pattern: PatternType,
): AudioEffect | undefined {
  switch (pattern) {
    case 'stripes': {
      return createChorus(audioCtx);
    }
    case 'checker': {
      return createTremolo(audioCtx);
    }
    case 'noise': {
      return createFlanger(audioCtx);
    }
    case 'plaid': {
      return createPhaser(audioCtx);
    }
    default: {
      return;
    }
  }
}

// ---- Shared helpers ----

/** Create a dry/wet parallel chain with input and output gain nodes. */
function dryWet(
  ctx: AudioContext,
  dryLevel: number,
  wetLevel: number,
): { input: GainNode; output: GainNode; dry: GainNode; wet: GainNode } {
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const dry = new GainNode(ctx, { gain: dryLevel });
  const wet = new GainNode(ctx, { gain: wetLevel });
  input.connect(dry);
  dry.connect(output);
  wet.connect(output);
  return { input, output, dry, wet };
}

/** Create an LFO oscillator routed through a gain node. Returns the LFO for disposal. */
function createLFO(
  ctx: AudioContext,
  freq: number,
  depth: number,
  target: AudioParam,
): OscillatorNode {
  const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: freq });
  const gain = new GainNode(ctx, { gain: depth });
  lfo.connect(gain);
  gain.connect(target);
  lfo.start();
  return lfo;
}

// ---- Pattern effects ----

// Raster stripes → Chorus
function createChorus(ctx: AudioContext): AudioEffect {
  const { input, output, wet } = dryWet(ctx, 0.7, 0.5);
  const delay = new DelayNode(ctx, { maxDelayTime: 0.1, delayTime: 0.025 });
  const lfo = createLFO(ctx, 1.5, 0.002, delay.delayTime);

  input.connect(delay);
  delay.connect(wet);

  return { dispose: () => lfo.stop(), input, output };
}

// Checkerboard → LFO Tremolo
function createTremolo(ctx: AudioContext): AudioEffect {
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const tremoloGain = new GainNode(ctx, { gain: 0.7 });
  const lfo = createLFO(ctx, 6, 0.3, tremoloGain.gain);

  input.connect(tremoloGain);
  tremoloGain.connect(output);

  return { dispose: () => lfo.stop(), input, output };
}

// Noise texture → Flanger
function createFlanger(ctx: AudioContext): AudioEffect {
  const { input, output, wet } = dryWet(ctx, 0.7, 0.7);
  const delay = new DelayNode(ctx, { maxDelayTime: 0.02, delayTime: 0.005 });
  const feedback = new GainNode(ctx, { gain: 0.6 });
  const lfo = createLFO(ctx, 0.25, 0.004, delay.delayTime);

  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);

  return { dispose: () => lfo.stop(), input, output };
}

// Gradient overlay → Phaser
function createPhaser(ctx: AudioContext): AudioEffect {
  const { input, output, wet } = dryWet(ctx, 0.8, 0.6);

  const allpassFreqs = [350, 1100, 2700, 5500];
  const filters = allpassFreqs.map((freq) => {
    const f = new BiquadFilterNode(ctx, { type: 'allpass', frequency: freq, Q: 0.7 });
    return f;
  });

  const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.5 });
  for (const f of filters) {
    const lg = new GainNode(ctx, { gain: 500 });
    lfo.connect(lg);
    lg.connect(f.frequency);
  }
  lfo.start();

  // Chain allpass filters
  input.connect(filters[0]!);
  for (let i = 0; i < filters.length - 1; i++) {
    filters[i]!.connect(filters[i + 1]!);
  }
  filters.at(-1)!.connect(wet);

  return { dispose: () => lfo.stop(), input, output };
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
