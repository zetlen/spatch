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

export interface Fill {
  mode: FillMode;
  /** Hue for stop 1 (0–360) */
  h: number;
  /** Saturation for stop 1 (0–100) */
  s: number;
  /** Lightness for stop 1 (0–100) */
  l: number;
  /** Hue for stop 2 — radial outer / linear end (0–360) */
  h2: number;
  /** Saturation for stop 2 (0–100) */
  s2: number;
  /** Lightness for stop 2 (0–100) */
  l2: number;
  /** Linear gradient angle in degrees (0–360) */
  gradAngle: number;
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

export interface Decoration {
  id: string;
  type: DecorationType;
  /** Array of [x, y] normalized coordinate pairs */
  points: [NormalizedCoord, NormalizedCoord][];
  /** Text content (only for type: "text") */
  text: string | null;
  /** Optional linked shape ID */
  targetShapeId: string | null;
  /** Normalized 0–1, horizontal position */
  x: NormalizedCoord;
  /** Normalized 0–1, vertical position */
  y: NormalizedCoord;
  /** Scale factor (0.2–5) */
  scale: number;
  /** CSS color string, e.g. "hsl(320, 100%, 60%)" */
  strokeColor: string;
  /** Stroke width in pixels */
  strokeWidth: number;
  /** Font size in pixels (used when type is "text") */
  fontSize: number;
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
