// Effects.ts — Audio effect builders mapped to visual patterns and blend modes

import type { AudioEffect, BlendMode, PatternType } from './types.ts';

export const DEFAULT_BLEND: BlendMode = 'soft-light';

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

// ---- Blend mode audio effects ----
//
// Each blend effect is a dry/wet chain. The wet amount is controlled externally
// By setting the wetGain.gain value based on geometric overlap.

export interface BlendEffect {
  input: GainNode;
  output: GainNode;
  wetGain: GainNode;
  dispose: () => void;
}

const noop = () => {};

export function createBlendEffect(ctx: AudioContext, mode: BlendMode): BlendEffect {
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const dry = new GainNode(ctx);
  const wet = new GainNode(ctx, { gain: 0 }); // Overlap drives this

  input.connect(dry);
  dry.connect(output);

  let dispose = noop;

  switch (mode) {
    case 'soft-light': {
      dispose = wireSaturation(ctx, input, wet, 2);
      break;
    }
    case 'multiply': {
      dispose = wireSaturation(ctx, input, wet, 6);
      break;
    }
    case 'screen': {
      wireCompression(ctx, input, wet);
      break;
    }
    case 'overlay': {
      dispose = wireExciter(ctx, input, wet);
      break;
    }
    case 'color-burn': {
      wireGate(ctx, input, wet, dry);
      break;
    }
    case 'difference': {
      dispose = wireCombFilter(ctx, input, wet);
      break;
    }
    case 'exclusion': {
      dispose = wireFlanger(ctx, input, wet);
      break;
    }
  }

  wet.connect(output);

  return { dispose, input, output, wetGain: wet };
}

// Tape saturation — gentle even-order harmonics via waveshaper
function wireSaturation(
  ctx: AudioContext,
  input: GainNode,
  wet: GainNode,
  drive: number,
): () => void {
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * drive);
  }
  const ws = new WaveShaperNode(ctx, { curve, oversample: '2x' });
  input.connect(ws);
  ws.connect(wet);
  return () => {};
}

// Additive with soft compression — DynamicsCompressor
function wireCompression(ctx: AudioContext, input: GainNode, wet: GainNode): void {
  const comp = new DynamicsCompressorNode(ctx, {
    threshold: -20,
    knee: 30,
    ratio: 8,
    attack: 0.003,
    release: 0.1,
  });
  input.connect(comp);
  comp.connect(wet);
}

// Harmonic exciter — asymmetric waveshaper that adds even harmonics
function wireExciter(ctx: AudioContext, input: GainNode, wet: GainNode): () => void {
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    // Asymmetric: positive half gets more drive than negative
    curve[i] = x >= 0 ? Math.tanh(x * 4) : Math.tanh(x * 2) * 0.8;
  }
  const ws = new WaveShaperNode(ctx, { curve, oversample: '2x' });

  // High-pass to keep only the added harmonics
  const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 2000, Q: 0.5 });

  input.connect(ws);
  ws.connect(hp);
  hp.connect(wet);
  return () => {};
}

// Aggressive gating — overlap reduces dry gain toward silence
function wireGate(ctx: AudioContext, input: GainNode, wet: GainNode, dry: GainNode): void {
  // For color-burn, overlap reduces the dry signal instead of adding wet.
  // We invert: wet is silent, dry gets reduced by overlap.
  // The caller sets wet.gain = overlap, but we want dry.gain = 1 - overlap.
  // We'll handle this in the overlap update by also adjusting dry.
  // Wire wet to pass silence (just connect input to wet for the node graph,
  // But the actual gating happens via dry.gain adjustment in updateOverlap).
  input.connect(wet);
  // Store reference to dry on wet for the update function to find
  (wet as GainNode & { _dryGain?: GainNode })._dryGain = dry;
}

// Comb filter — creates hollow, phasey tones from spectral notches
function wireCombFilter(ctx: AudioContext, input: GainNode, wet: GainNode): () => void {
  const delay = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.008 }); // ~125 Hz comb frequency
  const feedback = new GainNode(ctx, { gain: -0.7 }); // Negative = destructive interference

  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);

  return () => {};
}

// Flanging — swept comb filter
function wireFlanger(ctx: AudioContext, input: GainNode, wet: GainNode): () => void {
  const delay = new DelayNode(ctx, { maxDelayTime: 0.02, delayTime: 0.003 });
  const feedback = new GainNode(ctx, { gain: 0.5 });
  const lfo = createLFO(ctx, 0.3, 0.002, delay.delayTime);

  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);

  return () => lfo.stop();
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
