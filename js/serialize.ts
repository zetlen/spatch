// Serialize.ts — URL encode/decode sigil state with lz-string
//
// Wire format: positional arrays, no keys, no IDs.
//
//   [envelope, voices, reverb?]
//
//   Envelope = [attack, decay, sustain, release]
//
//   Voice (sine)        = ["s", x, y, size, fill, effect, blend, border]
//   Voice (pulse/blend) = ["p"|"b", x, y, size, fill, effect, blend, border, timbre]
//
//   Border = 0 (none) | ["W"|"B", 0|1, thickness]
//
//   Fill (solid)   = ["s", h, s, l]
//   Fill (linear)  = ["l", gradAngle, h, s, l, h2, s2, l2]
//
//   Effect = "s"|"c"|"n"|"g" | 0
//
//   Reverb = 0 (none) | ["G"|"D", depth]

import LZString from 'lz-string';
import { genId } from './state.ts';
import {
  type BlendMode,
  type Border,
  type BorderColor,
  type Fill,
  type LinearFill,
  type PatternType,
  type Reverb,
  type ReverbStyle,
  type SigilData,
  type SolidFill,
  type Voice,
  type WaveformType,
  normalizedCoord,
} from './types.ts';

/**
 * Serialize sigil state to a compressed URI-safe string via LZ-string.
 * @param state - The sigil state to serialize
 * @returns Compressed string suitable for use as a URL hash fragment
 */
export function serializeState(state: SigilData): string {
  const packed = pack(state);
  const json = JSON.stringify(packed);
  return LZString.compressToEncodedURIComponent(json);
}

/** Expose the raw packed JSON for testing. */
export function _serializeToJSON(state: SigilData): string {
  return JSON.stringify(pack(state));
}

/**
 * Deserialize sigil state from a compressed hash string.
 * @param hash - LZ-string compressed state (from URL hash fragment)
 * @returns Parsed SigilData, or undefined if decompression/parsing fails
 */
export function deserializeState(hash: string): SigilData | undefined {
  try {
    const json = LZString.decompressFromEncodedURIComponent(hash);
    if (!json) {
      return;
    }
    return unpack(JSON.parse(json));
  } catch (error) {
    console.warn('Failed to deserialize state:', error);
    return;
  }
}

/** Serialize state and write it to the current URL hash fragment (replaces history entry). */
export function saveToURL(state: SigilData): void {
  const encoded = serializeState(state);
  history.replaceState(undefined, '', '#' + encoded);
}

/** Read and deserialize state from the current URL hash fragment, or undefined if empty/invalid. */
export function loadFromURL(): SigilData | undefined {
  const hash = globalThis.location.hash.slice(1);
  if (!hash) {
    return;
  }
  return deserializeState(hash);
}

// ---- Pack ----

type PackedFill =
  | ['s', number, number, number]
  | ['l', number, number, number, number, number, number, number];

type PackedBorder = 0 | [string, number, number];

// Voice positions: [waveform, x, y, size, fill, effect, blend, border, timbre?]
type PackedVoice =
  | [string, number, number, number, PackedFill, string | 0, string, PackedBorder]
  | [string, number, number, number, PackedFill, string | 0, string, PackedBorder, number];

type PackedReverb = 0 | [string, number];

type PackedState = [
  [number, number, number, number], // Envelope
  PackedVoice[], // Voices
  PackedReverb?, // Reverb (optional)
];

function pack(state: SigilData): PackedState {
  const packed: PackedState = [
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
  ];
  const rv = packReverb(state.reverb);
  if (rv !== 0) {
    packed.push(rv);
  }
  return packed;
}

// ---- Unpack ----

const waveformMap: Record<string, WaveformType> = { b: 'blend', p: 'pulse', s: 'sine' };
const effectMap: Record<string, PatternType> = {
  c: 'checker',
  g: 'gradient',
  n: 'noise',
  s: 'stripes',
};

function unpack(packed: PackedState): SigilData {
  const [env, voices] = packed;
  return {
    envelope: {
      attack: env[0],
      decay: env[1],
      release: env[3],
      sustain: env[2],
    },
    reverb: unpackReverb(packed[2] as PackedReverb | undefined),
    voices: (voices || []).map((pv): Voice => {
      const waveform: WaveformType = waveformMap[pv[0]] || 'sine';
      const effect: PatternType | undefined = pv[5]
        ? (effectMap[pv[5] as string] ?? undefined)
        : undefined;
      const blend: BlendMode = unpackBlend(pv[6] as string);
      const border = unpackBorder(pv[7] as PackedBorder);
      const base = {
        blend,
        border,
        effect,
        fill: unpackFill(pv[4]),
        id: genId('v'),
        size: normalizedCoord(pv[3]),
        x: normalizedCoord(pv[1]),
        y: normalizedCoord(pv[2]),
      };
      switch (waveform) {
        case 'sine': {
          return Object.assign(base, { waveform: 'sine' as const });
        }
        case 'pulse': {
          return Object.assign(base, {
            timbre: normalizedCoord((pv[8] as number) ?? 0),
            waveform: 'pulse' as const,
          });
        }
        case 'blend': {
          return Object.assign(base, {
            timbre: normalizedCoord((pv[8] as number) ?? 0),
            waveform: 'blend' as const,
          });
        }
      }
    }),
  };
}

// ---- Blend pack/unpack ----

const blendPackMap: Record<BlendMode, string> = {
  'color-burn': 'B',
  difference: 'D',
  exclusion: 'X',
  multiply: 'M',
  overlay: 'O',
  screen: 'R',
  'soft-light': 'S',
};

const blendUnpackMap: Record<string, BlendMode> = Object.fromEntries(
  Object.entries(blendPackMap).map(([k, v]) => [v, k as BlendMode]),
);

function packBlend(blend: BlendMode): string {
  return blendPackMap[blend];
}

function unpackBlend(packed: string | undefined): BlendMode {
  if (packed && packed in blendUnpackMap) {
    return blendUnpackMap[packed]!;
  }
  return 'soft-light';
}

// ---- Border pack/unpack ----

const borderColorMap: Record<BorderColor, string> = { black: 'B', white: 'W' };
const borderColorUnmap: Record<string, BorderColor> = { B: 'black', W: 'white' };

function packBorder(border: Border | undefined): PackedBorder {
  if (!border) {
    return 0;
  }
  return [borderColorMap[border.color], border.double ? 1 : 0, round3(border.thickness)];
}

function unpackBorder(packed: PackedBorder | undefined): Border | undefined {
  if (!packed || !Array.isArray(packed)) {
    return;
  }
  return {
    color: borderColorUnmap[packed[0]] ?? 'white',
    double: packed[1] === 1,
    thickness: normalizedCoord(packed[2]),
  };
}

// ---- Reverb pack/unpack ----

const reverbStyleMap: Record<string, string> = { dim: 'D', glow: 'G' };
const reverbStyleUnmap: Record<string, ReverbStyle> = { D: 'dim', G: 'glow' };

function packReverb(reverb: Reverb | undefined): PackedReverb {
  if (!reverb) {
    return 0;
  }
  return [reverbStyleMap[reverb.style]!, round3(reverb.depth)];
}

function unpackReverb(packed: PackedReverb | undefined): Reverb | undefined {
  if (!packed || !Array.isArray(packed)) {
    return;
  }
  return {
    depth: normalizedCoord(packed[1]),
    style: reverbStyleUnmap[packed[0]] ?? 'glow',
  };
}

// ---- Fill pack/unpack ----

function packFill(f: Fill): PackedFill {
  switch (f.mode) {
    case 'solid': {
      return ['s', f.h, f.s, f.l];
    }
    case 'linear': {
      return ['l', f.gradAngle, f.h, f.s, f.l, f.h2, f.s2, f.l2];
    }
  }
}

function unpackFill(f: PackedFill): Fill {
  switch (f[0]) {
    case 's': {
      return { h: f[1], l: f[3], mode: 'solid', s: f[2] } satisfies SolidFill;
    }
    case 'l': {
      return {
        gradAngle: f[1],
        h: f[2],
        h2: f[5],
        l: f[4],
        l2: f[7],
        mode: 'linear',
        s: f[3],
        s2: f[6],
      } satisfies LinearFill;
    }
    default: {
      return { h: 200, l: 50, mode: 'solid', s: 80 };
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
