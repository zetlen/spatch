// types.ts — Shared type definitions for spatch
//
// These are the contracts between modules. Import them at file boundaries;
// let TypeScript infer everything inside function bodies.

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

export type WaveformType = 'sine' | 'pulse' | 'blend';

export type PatternType = 'stripes' | 'checker' | 'noise' | 'gradient' | 'rough';

export type BlendMode =
  | 'soft-light'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'color-burn'
  | 'difference'
  | 'exclusion';

export type FillMode = 'solid' | 'radial' | 'linear';

interface FillBase {
  h: number;
  s: number;
  l: number;
}

export interface SolidFill extends FillBase {
  mode: 'solid';
}

export interface RadialFill extends FillBase {
  mode: 'radial';
  h2: number;
  s2: number;
  l2: number;
}

export interface LinearFill extends FillBase {
  mode: 'linear';
  h2: number;
  s2: number;
  l2: number;
  gradAngle: number;
}

export type Fill = SolidFill | RadialFill | LinearFill;

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

export function fillToFillDraft(fill: Fill): FillDraft {
  const base = { h: fill.h, s: fill.s, l: fill.l, h2: 180, s2: 80, l2: 45, gradAngle: 0 };
  switch (fill.mode) {
    case 'solid':
      return { ...base, mode: 'solid' };
    case 'radial':
      return { ...base, mode: 'radial', h2: fill.h2, s2: fill.s2, l2: fill.l2 };
    case 'linear':
      return {
        ...base,
        mode: 'linear',
        h2: fill.h2,
        s2: fill.s2,
        l2: fill.l2,
        gradAngle: fill.gradAngle,
      };
  }
}

export function fillDraftToFill(draft: FillDraft): Fill {
  switch (draft.mode) {
    case 'solid':
      return { mode: 'solid', h: draft.h, s: draft.s, l: draft.l };
    case 'radial':
      return {
        mode: 'radial',
        h: draft.h,
        s: draft.s,
        l: draft.l,
        h2: draft.h2,
        s2: draft.s2,
        l2: draft.l2,
      };
    case 'linear':
      return {
        mode: 'linear',
        h: draft.h,
        s: draft.s,
        l: draft.l,
        h2: draft.h2,
        s2: draft.s2,
        l2: draft.l2,
        gradAngle: draft.gradAngle,
      };
  }
}

export function createDefaultFill(): SolidFill {
  return { mode: 'solid', h: 200, s: 80, l: 50 };
}

interface VoiceBase {
  id: string;
  x: NormalizedCoord;
  y: NormalizedCoord;
  size: NormalizedCoord;
  fill: Fill;
  effect: PatternType | null;
  blend: BlendMode;
}

export interface SineVoice extends VoiceBase {
  waveform: 'sine';
}

export interface PulseVoice extends VoiceBase {
  waveform: 'pulse';
  timbre: NormalizedCoord;
}

export interface BlendVoice extends VoiceBase {
  waveform: 'blend';
  timbre: NormalizedCoord;
}

export type Voice = SineVoice | PulseVoice | BlendVoice;

// ---- Text decoration ----

export interface TextDecoration {
  id: string;
  text: string;
  x: NormalizedCoord;
  y: NormalizedCoord;
  size: NormalizedCoord;
}

// ---- Envelope ----

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

export interface SigilData {
  envelope: Envelope;
  voices: Voice[];
  texts: TextDecoration[];
}

export function waveformShape(waveform: WaveformType): 'circle' | 'square' | 'triangle' {
  switch (waveform) {
    case 'sine':
      return 'circle';
    case 'pulse':
      return 'square';
    case 'blend':
      return 'triangle';
  }
}

// ---- Audio contracts ----

export interface AudioEffect {
  input: AudioNode;
  output: AudioNode;
  dispose: () => void;
}

export interface VocoderChain {
  input: null;
  output: GainNode;
  duration: number;
  dispose: () => void;
}

// ---- UI types ----

export type HandleType = 'rotate' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w';

export type ADSRCorner = 'attack' | 'decay' | 'sustain' | 'release';

export interface DecoBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
