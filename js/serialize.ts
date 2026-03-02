// serialize.ts — URL encode/decode sigil state with lz-string
//
// Wire format: positional arrays, no keys, no IDs.
//
//   [envelope, voices, texts]
//
//   envelope = [attack, decay, sustain, release]
//
//   voice (sine)        = ["s", x, y, size, fill, effect, blend, border]
//   voice (pulse/blend) = ["p"|"b", x, y, size, fill, effect, blend, border, timbre]
//
//   border = 0 (none) | ["W"|"B", 0|1, thickness]
//
//   fill (solid)   = ["s", h, s, l]
//   fill (radial)  = ["r", h, s, l, h2, s2, l2]
//   fill (linear)  = ["l", gradAngle, h, s, l, h2, s2, l2]
//
//   effect = "s"|"c"|"n"|"g"|"r" | 0
//
//   text = [text, x, y, size]

import LZString from 'lz-string';
import { genId } from './state.ts';
import {
  normalizedCoord,
  type SigilData,
  type Voice,
  type TextDecoration,
  type Fill,
  type SolidFill,
  type RadialFill,
  type LinearFill,
  type WaveformType,
  type PatternType,
  type BlendMode,
  type Border,
  type BorderColor,
} from './types.ts';

export function serializeState(state: SigilData): string {
  const packed = pack(state);
  const json = JSON.stringify(packed);
  return LZString.compressToEncodedURIComponent(json);
}

/** Expose the raw packed JSON for testing. */
export function _serializeToJSON(state: SigilData): string {
  return JSON.stringify(pack(state));
}

export function deserializeState(hash: string): SigilData | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(hash);
    if (!json) return null;
    return unpack(JSON.parse(json));
  } catch (e) {
    console.warn('Failed to deserialize state:', e);
    return null;
  }
}

export function saveToURL(state: SigilData): void {
  const encoded = serializeState(state);
  history.replaceState(null, '', '#' + encoded);
}

export function loadFromURL(): SigilData | null {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  return deserializeState(hash);
}

// ---- Pack ----

type PackedFill =
  | ['s', number, number, number]
  | ['r', number, number, number, number, number, number]
  | ['l', number, number, number, number, number, number, number];

type PackedBorder = 0 | [string, number, number];

// Voice positions: [waveform, x, y, size, fill, effect, blend, border, timbre?]
type PackedVoice =
  | [string, number, number, number, PackedFill, string | 0, string, PackedBorder]
  | [string, number, number, number, PackedFill, string | 0, string, PackedBorder, number];

type PackedText = [string, number, number, number];

type PackedState = [
  [number, number, number, number], // envelope
  PackedVoice[], // voices
  PackedText[], // texts
];

function pack(state: SigilData): PackedState {
  return [
    [
      round2(state.envelope.attack),
      round2(state.envelope.decay),
      round2(state.envelope.sustain),
      round2(state.envelope.release),
    ],
    state.voices.map((v): PackedVoice => {
      const w = v.waveform[0]!;
      const f = packFill(v.fill);
      const e: string | 0 = v.effect ? v.effect[0]! : 0;
      const b = packBlend(v.blend);
      const bdr = packBorder(v.border);
      if ('timbre' in v) {
        return [w, round3(v.x), round3(v.y), round3(v.size), f, e, b, bdr, round3(v.timbre)];
      }
      return [w, round3(v.x), round3(v.y), round3(v.size), f, e, b, bdr];
    }),
    state.texts.map((t): PackedText => [t.text, round3(t.x), round3(t.y), round3(t.size)]),
  ];
}

// ---- Unpack ----

const waveformMap: Record<string, WaveformType> = { s: 'sine', p: 'pulse', b: 'blend' };
const effectMap: Record<string, PatternType> = {
  s: 'stripes',
  c: 'checker',
  n: 'noise',
  g: 'gradient',
  r: 'rough',
};

function unpack(packed: PackedState): SigilData {
  const [env, voices, texts] = packed;
  return {
    envelope: {
      attack: env[0],
      decay: env[1],
      sustain: env[2],
      release: env[3],
    },
    voices: (voices || []).map((pv): Voice => {
      const waveform: WaveformType = waveformMap[pv[0]] || 'sine';
      const effect: PatternType | null = pv[5] ? (effectMap[pv[5] as string] ?? null) : null;
      const blend: BlendMode = unpackBlend(pv[6] as string);
      const border = unpackBorder(pv[7] as PackedBorder);
      const base = {
        id: genId('v'),
        x: normalizedCoord(pv[1]),
        y: normalizedCoord(pv[2]),
        size: normalizedCoord(pv[3]),
        fill: unpackFill(pv[4]),
        effect,
        blend,
        border,
      };
      switch (waveform) {
        case 'sine':
          return { ...base, waveform: 'sine' };
        case 'pulse':
          return { ...base, waveform: 'pulse', timbre: normalizedCoord((pv[8] as number) ?? 0) };
        case 'blend':
          return { ...base, waveform: 'blend', timbre: normalizedCoord((pv[8] as number) ?? 0) };
      }
    }),
    texts: (texts || []).map(
      (pt): TextDecoration => ({
        id: genId('t'),
        text: pt[0],
        x: normalizedCoord(pt[1]),
        y: normalizedCoord(pt[2]),
        size: normalizedCoord(pt[3]),
      }),
    ),
    reverb: null,
  };
}

// ---- Blend pack/unpack ----

const blendPackMap: Record<BlendMode, string> = {
  'soft-light': 'S',
  multiply: 'M',
  screen: 'R',
  overlay: 'O',
  'color-burn': 'B',
  difference: 'D',
  exclusion: 'X',
};

const blendUnpackMap: Record<string, BlendMode> = Object.fromEntries(
  Object.entries(blendPackMap).map(([k, v]) => [v, k as BlendMode]),
);

function packBlend(blend: BlendMode): string {
  return blendPackMap[blend];
}

function unpackBlend(packed: string | undefined): BlendMode {
  if (packed && packed in blendUnpackMap) return blendUnpackMap[packed]!;
  return 'soft-light';
}

// ---- Border pack/unpack ----

const borderColorMap: Record<BorderColor, string> = { white: 'W', black: 'B' };
const borderColorUnmap: Record<string, BorderColor> = { W: 'white', B: 'black' };

function packBorder(border: Border | null): PackedBorder {
  if (!border) return 0;
  return [borderColorMap[border.color], border.double ? 1 : 0, round3(border.thickness)];
}

function unpackBorder(packed: PackedBorder | undefined): Border | null {
  if (!packed || !Array.isArray(packed)) return null;
  return {
    color: borderColorUnmap[packed[0]] ?? 'white',
    double: packed[1] === 1,
    thickness: normalizedCoord(packed[2]),
  };
}

// ---- Fill pack/unpack ----

function packFill(f: Fill): PackedFill {
  switch (f.mode) {
    case 'solid':
      return ['s', f.h, f.s, f.l];
    case 'radial':
      return ['r', f.h, f.s, f.l, f.h2, f.s2, f.l2];
    case 'linear':
      return ['l', f.gradAngle, f.h, f.s, f.l, f.h2, f.s2, f.l2];
  }
}

function unpackFill(f: PackedFill): Fill {
  switch (f[0]) {
    case 's':
      return { mode: 'solid', h: f[1], s: f[2], l: f[3] } satisfies SolidFill;
    case 'r':
      return {
        mode: 'radial',
        h: f[1],
        s: f[2],
        l: f[3],
        h2: f[4],
        s2: f[5],
        l2: f[6],
      } satisfies RadialFill;
    case 'l':
      return {
        mode: 'linear',
        gradAngle: f[1],
        h: f[2],
        s: f[3],
        l: f[4],
        h2: f[5],
        s2: f[6],
        l2: f[7],
      } satisfies LinearFill;
    default:
      return { mode: 'solid', h: 200, s: 80, l: 50 };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
