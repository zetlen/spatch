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

/** An angle in degrees, 0–360. */
export type Degrees = Brand<number, 'Degrees'>;

/** A detuning offset in cents. */
export type Cents = Brand<number, 'Cents'>;

// ---- Shape types ----

export type ShapeType = 'circle' | 'triangle' | 'square';

export type PatternType = 'stripes' | 'checker' | 'noise' | 'gradient' | 'rough';

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

export interface Shape {
  id: string;
  type: ShapeType;
  /** Normalized 0–1, horizontal position */
  x: NormalizedCoord;
  /** Normalized 0–1, vertical position (0=top, 1=bottom) */
  y: NormalizedCoord;
  /** Normalized 0–1, default 0.12 */
  size: NormalizedCoord;
  /** Degrees 0–360 */
  rotation: Degrees;
  fill: Fill;
  /** Visual pattern overlay, null = none */
  pattern: PatternType | null;
}

// ---- Decoration types ----

export type DecorationType = 'squiggle' | 'curlicue' | 'text';

interface DecorationBase {
  id: string;
  strokeColor: string;
  strokeWidth: number;
  targetShapeId: string | null;
}

export interface SquiggleDecoration extends DecorationBase {
  type: 'squiggle';
  points: [NormalizedCoord, NormalizedCoord][];
}

export interface CurlicueDecoration extends DecorationBase {
  type: 'curlicue';
  x: NormalizedCoord;
  y: NormalizedCoord;
  scale: number;
}

export interface TextDecoration extends DecorationBase {
  type: 'text';
  text: string;
  x: NormalizedCoord;
  y: NormalizedCoord;
  scale: number;
  fontSize: number;
}

export type Decoration = SquiggleDecoration | CurlicueDecoration | TextDecoration;

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
  shapes: Shape[];
  decorations: Decoration[];
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
