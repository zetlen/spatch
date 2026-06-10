// Patterns.ts — 8×8 1-bit bitmap pattern tiles for visual overlays and audio effects.
//
// Each pattern is 8 bytes — one byte per row, MSB-first.
// Bit value 1 = filled pixel (dark overlay), 0 = transparent.
// Inspired by the Windows 95 desktop pattern set.
//
// Visual (bitmap), audio (effect factory), and label are co-located per pattern.

import { svgEl } from './dom.ts';
import { makeSaturationCurve } from './audio/node-utils.ts';
import { PATTERN_TYPES, type AudioEffect, type PatternType } from './types.ts';

// ---- Effect builders ----

type EffectFactory = (ctx: AudioContext) => AudioEffect;

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

/**
 * Create an LFO oscillator routed through a gain node, with a dispose that
 * stops the LFO and disconnects both nodes — modulation sources must be fully
 * detached from their target AudioParams on teardown so the graph is
 * immediately collectable.
 */
function createLFO(
  ctx: AudioContext,
  freq: number,
  depth: number,
  target: AudioParam,
): { lfo: OscillatorNode; dispose: () => void } {
  const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: freq });
  const gain = new GainNode(ctx, { gain: depth });
  lfo.connect(gain);
  gain.connect(target);
  lfo.start();
  const dispose = () => {
    lfo.stop();
    lfo.disconnect();
    gain.disconnect();
  };
  return { dispose, lfo };
}

function createChorus(ctx: AudioContext): AudioEffect {
  const { input, output, wet } = dryWet(ctx, 0.7, 0.5);
  const delay = new DelayNode(ctx, { maxDelayTime: 0.1, delayTime: 0.025 });
  const lfo = createLFO(ctx, 1.5, 0.002, delay.delayTime);
  input.connect(delay);
  delay.connect(wet);
  return { dispose: lfo.dispose, input, output };
}

function createTremolo(ctx: AudioContext): AudioEffect {
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const tremoloGain = new GainNode(ctx, { gain: 0.7 });
  const lfo = createLFO(ctx, 6, 0.3, tremoloGain.gain);
  input.connect(tremoloGain);
  tremoloGain.connect(output);
  return { dispose: lfo.dispose, input, output };
}

function createFlanger(ctx: AudioContext): AudioEffect {
  const { input, output, wet } = dryWet(ctx, 0.7, 0.7);
  const delay = new DelayNode(ctx, { maxDelayTime: 0.02, delayTime: 0.005 });
  const feedback = new GainNode(ctx, { gain: 0.6 });
  const lfo = createLFO(ctx, 0.25, 0.004, delay.delayTime);
  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  return { dispose: lfo.dispose, input, output };
}

function createPhaser(ctx: AudioContext): AudioEffect {
  const { input, output, wet } = dryWet(ctx, 0.8, 0.6);
  const allpassFreqs = [350, 1100, 2700, 5500];
  const filters = allpassFreqs.map(
    (freq) => new BiquadFilterNode(ctx, { type: 'allpass', frequency: freq, Q: 0.7 }),
  );
  const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.5 });
  const lfoGains = filters.map((f) => {
    const lg = new GainNode(ctx, { gain: 500 });
    lfo.connect(lg);
    lg.connect(f.frequency);
    return lg;
  });
  lfo.start();
  input.connect(filters[0]!);
  for (let i = 0; i < filters.length - 1; i++) {
    filters[i]!.connect(filters[i + 1]!);
  }
  filters.at(-1)!.connect(wet);
  return {
    dispose: () => {
      lfo.stop();
      lfo.disconnect();
      for (const lg of lfoGains) {
        lg.disconnect();
      }
    },
    input,
    output,
  };
}

function makeBitcrushCurve(bits: number): Float32Array {
  const samples = 8192;
  const curve = new Float32Array(samples);
  const levels = 2 ** bits;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

function createBitcrush(ctx: AudioContext): AudioEffect {
  const { input, output, wet } = dryWet(ctx, 0.3, 0.8);
  const shaper = new WaveShaperNode(ctx, { curve: makeBitcrushCurve(4) });
  input.connect(shaper);
  shaper.connect(wet);
  return { dispose: () => {}, input, output };
}

function createOverdrive(ctx: AudioContext): AudioEffect {
  const { input, output, wet } = dryWet(ctx, 0.3, 0.7);
  // Boost into tanh soft-clip, then compensate gain
  const boost = new GainNode(ctx, { gain: 4 });
  const shaper = new WaveShaperNode(ctx, { curve: makeSaturationCurve(3), oversample: '4x' });
  const cut = new GainNode(ctx, { gain: 0.4 });
  input.connect(boost);
  boost.connect(shaper);
  shaper.connect(cut);
  cut.connect(wet);
  return { dispose: () => {}, input, output };
}

function createWahWah(ctx: AudioContext): AudioEffect {
  const { input, output, wet } = dryWet(ctx, 0.5, 0.7);
  const filter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 800, Q: 5 });
  const lfo = createLFO(ctx, 3, 600, filter.frequency);
  input.connect(filter);
  filter.connect(wet);
  return { dispose: lfo.dispose, input, output };
}

// ---- Pattern definitions ----

interface PatternDef {
  readonly bytes: readonly number[];
  readonly label: string;
  readonly effect?: EffectFactory;
}

/** Pattern data: visual (bitmap), audio (effect), and label co-located. */
const PATTERNS: Record<PatternType, PatternDef> = {
  stripes: { bytes: [255, 255, 0, 0, 255, 255, 0, 0], label: 'Chorus', effect: createChorus },
  bricks: {
    bytes: [187, 95, 174, 93, 186, 117, 234, 245],
    label: 'Flanger',
    effect: createFlanger,
  },
  buttons: {
    bytes: [170, 125, 198, 71, 198, 127, 190, 85],
    label: 'Tremolo',
    effect: createTremolo,
  },
  rounder: {
    bytes: [215, 147, 40, 215, 40, 147, 213, 215],
    label: 'Wah-Wah',
    effect: createWahWah,
  },
  'waffles-revenge': {
    bytes: [77, 154, 8, 85, 239, 154, 77, 154],
    label: 'Overdrive',
    effect: createOverdrive,
  },
  weave: { bytes: [136, 84, 34, 69, 136, 21, 34, 81], label: 'Phaser', effect: createPhaser },
  'live-wire': {
    bytes: [239, 239, 14, 254, 254, 254, 224, 239],
    label: 'Bitcrush',
    effect: createBitcrush,
  },
};

// ---- SVG pattern rendering ----

/** Size of one pattern tile in normalized (0–1) coordinates. */
const TILE_SIZE = 0.016;
/** Size of one pixel within the tile. */
const PIXEL_SIZE = TILE_SIZE / 8;
/** Fill opacity for "on" pixels. */
const PIXEL_ALPHA = 0.4;

/** Build an SVG <pattern> element from an 8-byte bitmap. */
function buildPatternEl(id: string, bytes: readonly number[]): SVGPatternElement {
  const pattern = svgEl('pattern', {
    id,
    patternUnits: 'userSpaceOnUse',
    width: TILE_SIZE,
    height: TILE_SIZE,
  });

  for (let row = 0; row < 8; row++) {
    const byte = bytes[row]!;
    for (let col = 0; col < 8; col++) {
      if (byte & (1 << (7 - col))) {
        pattern.append(
          svgEl('rect', {
            x: col * PIXEL_SIZE,
            y: row * PIXEL_SIZE,
            width: PIXEL_SIZE,
            height: PIXEL_SIZE,
            fill: `rgba(0,0,0,${PIXEL_ALPHA})`,
          }),
        );
      }
    }
  }

  return pattern;
}

/** Ensure all active pattern definitions exist in the given <defs> element. */
export function ensurePatternDefs(defs: SVGDefsElement): void {
  if (defs.querySelector(`[id^="pat-"]`)) {
    return;
  }

  for (const name of PATTERN_TYPES) {
    defs.append(buildPatternEl(`pat-${name}`, PATTERNS[name].bytes));
  }
}

/**
 * Get the SVG fill value for applying a pattern overlay to a shape clone.
 */
export function getPatternFill(pattern: PatternType): string {
  return `url(#pat-${pattern})`;
}

/** Get the user-facing label for a pattern (the audio effect name). */
export function getPatternLabel(pattern: PatternType): string {
  return PATTERNS[pattern].label;
}

/**
 * Create the audio effect for a pattern, or undefined if none is defined.
 */
export function createEffect(ctx: AudioContext, pattern: PatternType): AudioEffect | undefined {
  return PATTERNS[pattern]?.effect?.(ctx);
}

/**
 * Generate a 1-bit 8×8 SVG data URI for use as a CSS tiled background preview.
 */
export function getPatternPreviewCSS(pattern: PatternType): string {
  const def = PATTERNS[pattern];
  if (!def) {
    return '';
  }
  const rects: string[] = [];
  for (let row = 0; row < 8; row++) {
    const byte = def.bytes[row]!;
    for (let col = 0; col < 8; col++) {
      if (byte & (1 << (7 - col))) {
        rects.push(`<rect x="${col}" y="${row}" width="1" height="1" fill="currentColor"/>`);
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" shape-rendering="crispEdges">${rects.join('')}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
