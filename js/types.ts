// Types.ts — Shared type definitions for spatch
//
// These are the contracts between modules. Import them at file boundaries;
// Let TypeScript infer everything inside function bodies.

// ---- Branded primitives ----
// Catch "wrong kind of number" bugs at module boundaries.

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** A number normalized to the 0–1 range (canvas coordinates, sizes). */
export type NormalizedCoord = Brand<number, 'NormalizedCoord'>;

/** Clamp to [0, 1] and brand as NormalizedCoord. */
export function normalizedCoord(n: number): NormalizedCoord {
  return Math.max(0, Math.min(1, n)) as NormalizedCoord;
}

/** An angle in degrees, 0–360. */
export type Degrees = Brand<number, 'Degrees'>;

/** Wrap to [0, 360) and brand as Degrees. */
export function degrees(n: number): Degrees {
  return (((n % 360) + 360) % 360) as Degrees;
}

/** A detuning offset in cents. */
export type Cents = Brand<number, 'Cents'>;

/** Brand as Cents (no range restriction). */
export function cents(n: number): Cents {
  return n as Cents;
}

// ---- Voice types ----

/** Waveform discriminant: sine (circle), pulse (square), or blend (triangle). */
export type WaveformType = 'sine' | 'pulse' | 'blend';

/** Pattern overlay type applied to a voice shape for visual texture and audio effect. */
export const PATTERN_TYPES = ['stripes', 'checker', 'noise', 'plaid'] as const;
export type PatternType = (typeof PATTERN_TYPES)[number];

/** CSS mix-blend-mode value that maps to an overlap-driven audio effect.
 *  All modes are commutative (order-independent) so voice ordering is not data.
 *  Only modes that are visually distinct for ALL color combinations are included,
 *  to preserve the bijection principle (no two states may look identical).
 *  Screen is the default — visual blending with no FM modulation. */
export const BLEND_MODES = ['screen', 'multiply', 'difference'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** Fill mode discriminant for the Fill union. */
export type FillMode = 'solid' | 'linear';

interface FillBase {
  h: number;
  s: number;
  l: number;
}

/** A single-color fill with HSL components. */
export interface SolidFill extends FillBase {
  mode: 'solid';
}

/** A linear gradient fill with two HSL color stops and a gradient angle. */
export interface LinearFill extends FillBase {
  mode: 'linear';
  h2: number;
  s2: number;
  l2: number;
  gradAngle: number;
}

/** Discriminated union of fill types (solid color or linear gradient). */
export type Fill = SolidFill | LinearFill;

/** Flat bag used internally by toolbar for mode-switching without data loss. */
export interface FillDraft {
  mode: FillMode;
  h: number;
  s: number;
  l: number;
  h2: number;
  s2: number;
  l2: number;
  gradAngle: number;
}

/**
 * Convert a Fill union to a flat FillDraft bag, filling in defaults for missing gradient fields.
 * @param fill - The fill to convert
 * @returns A FillDraft with all fields populated
 */
export function fillToFillDraft(fill: Fill): FillDraft {
  const base = { gradAngle: 0, h: fill.h, h2: 180, l: fill.l, l2: 45, s: fill.s, s2: 80 };
  switch (fill.mode) {
    case 'solid': {
      return { ...base, mode: 'solid' };
    }
    case 'linear': {
      return {
        ...base,
        gradAngle: fill.gradAngle,
        h2: fill.h2,
        l2: fill.l2,
        mode: 'linear',
        s2: fill.s2,
      };
    }
  }
}

/**
 * Convert a FillDraft bag back to a Fill union, discarding unused gradient fields for solid mode.
 * @param draft - The draft to convert
 * @returns A Fill matching the draft's mode
 */
export function fillDraftToFill(draft: FillDraft): Fill {
  switch (draft.mode) {
    case 'solid': {
      return { h: draft.h, l: draft.l, mode: 'solid', s: draft.s };
    }
    case 'linear': {
      return {
        gradAngle: draft.gradAngle,
        h: draft.h,
        h2: draft.h2,
        l: draft.l,
        l2: draft.l2,
        mode: 'linear',
        s: draft.s,
        s2: draft.s2,
      };
    }
  }
}

/** Border stroke color: white shifts octave up, black shifts octave down. */
export type BorderColor = 'white' | 'black';

/** Inset stroke border on a voice shape; maps to an octave-doubled oscillator in audio. */
export interface Border {
  color: BorderColor;
  double: boolean;
  thickness: NormalizedCoord;
}

interface VoiceBase {
  id: string;
  x: NormalizedCoord;
  y: NormalizedCoord;
  size: NormalizedCoord;
  fill: Fill;
  effect: PatternType | undefined;
  blend: BlendMode;
  border: Border | undefined;
}

/** Sine waveform voice (circle shape). No timbre parameter. */
export interface SineVoice extends VoiceBase {
  waveform: 'sine';
}

/** Pulse waveform voice (square shape). Timbre controls pulse width via rotation. */
export interface PulseVoice extends VoiceBase {
  waveform: 'pulse';
  timbre: NormalizedCoord;
}

/** Blend waveform voice (triangle shape). Timbre controls saw/tri blend via rotation. */
export interface BlendVoice extends VoiceBase {
  waveform: 'blend';
  timbre: NormalizedCoord;
}

/** Discriminated union of voice types, keyed on the `waveform` field. */
export type Voice = SineVoice | PulseVoice | BlendVoice;

// ---- Envelope ----

/** ADSR amplitude envelope applied to all voices during playback. */
export interface Envelope {
  /** Attack time in seconds (0.01–2.0) */
  attack: number;
  /** Decay time in seconds (0.01–2.0) */
  decay: number;
  /** Sustain level (0–1) */
  sustain: number;
  /** Release time in seconds (0.01–3.0) */
  release: number;
}

// ---- Top-level state ----

/** Complete sigil state: voices, envelope, and scene index. */
export interface SigilData {
  envelope: Envelope;
  voices: Voice[];
  scene: number;
}

/**
 * Map a waveform type to its corresponding geometric shape name.
 * @param waveform - The waveform type
 * @returns The shape name used for SVG rendering
 */
export function waveformShape(waveform: WaveformType): 'circle' | 'square' | 'triangle' {
  switch (waveform) {
    case 'sine': {
      return 'circle';
    }
    case 'pulse': {
      return 'square';
    }
    case 'blend': {
      return 'triangle';
    }
  }
}

// ---- Audio contracts ----

/** An audio effect chain with connectable input/output nodes and cleanup. */
export interface AudioEffect {
  input: AudioNode;
  output: AudioNode;
  dispose: () => void;
}

// ---- UI types ----

/** Selection handle positions: cardinal/corner resize handles or rotation handle. */
export type HandleType = 'rotate' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w';

/** Canvas frame corner mapped to an ADSR envelope parameter. */
export type ADSRCorner = 'attack' | 'decay' | 'sustain' | 'release';
