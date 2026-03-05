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

export type WaveformType = 'sine' | 'pulse' | 'blend';

export type PatternType = 'stripes' | 'checker' | 'noise' | 'gradient';

export type BlendMode =
  | 'soft-light'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'color-burn'
  | 'difference'
  | 'exclusion';

export type FillMode = 'solid' | 'linear';

interface FillBase {
  h: number;
  s: number;
  l: number;
}

export interface SolidFill extends FillBase {
  mode: 'solid';
}

export interface LinearFill extends FillBase {
  mode: 'linear';
  h2: number;
  s2: number;
  l2: number;
  gradAngle: number;
}

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

export function createDefaultFill(): SolidFill {
  return { h: 200, l: 50, mode: 'solid', s: 80 };
}

export function createRandomFill(): SolidFill {
  return {
    h: Math.floor(Math.random() * 360),
    l: 45 + Math.floor(Math.random() * 15),
    mode: 'solid',
    s: 70 + Math.floor(Math.random() * 20),
  };
}

export type BorderColor = 'white' | 'black';

export interface Border {
  color: BorderColor;
  double: boolean;
  thickness: NormalizedCoord;
}

export type ReverbStyle = 'glow' | 'dim';

export interface Reverb {
  depth: NormalizedCoord;
  style: ReverbStyle;
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
  reverb: Reverb | undefined;
}

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

export interface AudioEffect {
  input: AudioNode;
  output: AudioNode;
  dispose: () => void;
}

export interface VocoderChain {
  input: undefined;
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
