// Serialize.ts — URL encode/decode sigil state with a custom Base64 format
//
// Wire format: A single Base64 string
// The layout packs variables into 64-char dictionary indices (A-Z, a-z, 0-9, -, _)
//
//   [Envelope] (8 chars): attack, decay, sustain, release (2 chars each, 12-bit, x1000)
//   [Scene] (1 char): scene index (0-63)
//   [Voices] (variable length):
//      Flags (2 chars): 12-bit bitfield storing waveform, effect, blend, fillMode, borderMode
//      x, y, size (2 chars each)
//      [Optional] timbre (2 chars, iff waveform > 0)
//      [Optional] border thickness (2 chars, iff borderMode > 0)
//      Fill (4 or 10 chars): solid (4) vs linear (10 chars + gradient angle)
//
// Note: HSL and all normalized values are quantized to integers/12-bit maxes during packing.

import { genId } from './state.ts';
import {
  type Border,
  type Fill,
  type LinearFill,
  type PatternType,
  PATTERN_TYPES,
  BLEND_MODES,
  type SigilData,
  type SolidFill,
  type Voice,
  type WaveformType,
  normalizedCoord,
} from './types.ts';
import { DEFAULT_BLEND } from './effects.ts';

/**
 * Serialize sigil state to a compressed URI-safe string via bespoke Base64 encoding.
 * @param state - The sigil state to serialize
 * @returns Compressed string suitable for use as a URL hash fragment
 */
export function serializeState(state: SigilData): string {
  return packB64(state);
}

/**
 * Deserialize sigil state from our bespoke Base64 hash string.
 * @param hash - Base64 compressed state (from URL hash fragment)
 * @returns Parsed SigilData, or undefined if decompression/parsing fails
 */
export function deserializeState(hash: string): SigilData | undefined {
  if (!hash) return undefined;
  try {
    return unpackB64(hash);
  } catch (error) {
    console.warn('Failed to deserialize b64 state:', error);
    return undefined;
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

// ---- Base64 Custom Packing ----

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_MAP = new Map(B64_CHARS.split('').map((c, i) => [c, i]));

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function encodeInt(val: number, chars: number): string {
  let res = '';
  val = Math.max(0, Math.floor(val || 0));
  for (let i = 0; i < chars; i++) {
    res = B64_CHARS[val & 0x3f] + res;
    val = Math.floor(val / 64);
  }
  return res;
}

function decodeInt(str: string, startIndex: number, chars: number): number {
  if (startIndex + chars > str.length) {
    throw new Error('Unexpected end of input during parsing');
  }
  let val = 0;
  for (let i = 0; i < chars; i++) {
    val = val * 64 + (B64_MAP.get(str.charAt(startIndex + i)) || 0);
  }
  return val;
}

const EFFECT_KEYS: (PatternType | undefined)[] = [undefined, ...PATTERN_TYPES].sort();

function packB64(state: SigilData): string {
  let out = '';
  // Env (8 chars)
  out += encodeInt(round3(state.envelope.attack) * 1000, 2);
  out += encodeInt(round3(state.envelope.decay) * 1000, 2);
  out += encodeInt(round3(state.envelope.sustain) * 1000, 2);
  out += encodeInt(round3(state.envelope.release) * 1000, 2);

  // Scene (1 char)
  out += encodeInt(state.scene, 1);

  // Voices
  for (const v of state.voices) {
    let flags = 0;
    const wf = v.waveform === 'blend' ? 2 : v.waveform === 'pulse' ? 1 : 0;
    flags |= (wf & 0x3) << 10;

    const eff = Math.max(0, EFFECT_KEYS.indexOf(v.effect));
    flags |= (eff & 0x7) << 7;

    const bl = Math.max(0, BLEND_MODES.indexOf(v.blend));
    flags |= (bl & 0x7) << 4;

    const fm = v.fill.mode === 'linear' ? 1 : 0;
    flags |= (fm & 0x1) << 3;

    let bm = 0;
    if (v.border) {
      if (v.border.color === 'white') bm = v.border.double ? 3 : 1;
      else bm = v.border.double ? 4 : 2;
    }
    flags |= bm & 0x7;

    out += encodeInt(flags, 2);
    out += encodeInt(round3(v.x) * 1000, 2);
    out += encodeInt(round3(v.y) * 1000, 2);
    out += encodeInt(round3(v.size) * 1000, 2);

    if (wf > 0 && 'timbre' in v) {
      out += encodeInt(round3(v.timbre) * 1000, 2);
    }

    if (bm > 0 && v.border) {
      out += encodeInt(round3(v.border.thickness) * 1000, 2);
    }

    if (fm === 0) {
      // solid
      const f = v.fill as SolidFill;
      const fInt = (Math.round(f.h) << 14) | (Math.round(f.s) << 7) | Math.round(f.l);
      out += encodeInt(fInt, 4);
    } else {
      // linear
      const f = v.fill as LinearFill;
      out += encodeInt(Math.round(f.gradAngle), 2);
      const f1 = (Math.round(f.h) << 14) | (Math.round(f.s) << 7) | Math.round(f.l);
      out += encodeInt(f1, 4);
      const f2 = (Math.round(f.h2) << 14) | (Math.round(f.s2) << 7) | Math.round(f.l2);
      out += encodeInt(f2, 4);
    }
  }

  return out;
}

function unpackB64(str: string): SigilData {
  let idx = 0;

  // Env (8 chars)
  const attack = decodeInt(str, idx, 2) / 1000;
  idx += 2;
  const decay = decodeInt(str, idx, 2) / 1000;
  idx += 2;
  const sustain = decodeInt(str, idx, 2) / 1000;
  idx += 2;
  const release = decodeInt(str, idx, 2) / 1000;
  idx += 2;

  // Scene (1 char)
  const scene = decodeInt(str, idx, 1);
  idx += 1;

  // Voices
  const voices: Voice[] = [];
  while (idx < str.length) {
    try {
      const flags = decodeInt(str, idx, 2);
      idx += 2;
      const wf = (flags >> 10) & 0x3;
      const eff = (flags >> 7) & 0x7;
      const bl = (flags >> 4) & 0x7;
      const fm = (flags >> 3) & 0x1;
      const bm = flags & 0x7;

      const x = normalizedCoord(decodeInt(str, idx, 2) / 1000);
      idx += 2;
      const y = normalizedCoord(decodeInt(str, idx, 2) / 1000);
      idx += 2;
      const size = normalizedCoord(decodeInt(str, idx, 2) / 1000);
      idx += 2;

      let timbre = 0;
      if (wf > 0) {
        timbre = decodeInt(str, idx, 2) / 1000;
        idx += 2;
      }

      let border: Border | undefined = undefined;
      if (bm > 0) {
        const thickness = normalizedCoord(decodeInt(str, idx, 2) / 1000);
        idx += 2;
        border = {
          color: bm === 2 || bm === 4 ? 'black' : 'white',
          double: bm > 2,
          thickness,
        };
      }

      let fill: Fill;
      if (fm === 0) {
        const fInt = decodeInt(str, idx, 4);
        idx += 4;
        fill = {
          mode: 'solid',
          h: (fInt >> 14) & 0x1ff,
          s: (fInt >> 7) & 0x7f,
          l: fInt & 0x7f,
        } satisfies SolidFill;
      } else {
        const gradAngle = decodeInt(str, idx, 2);
        idx += 2;
        const f1 = decodeInt(str, idx, 4);
        idx += 4;
        const f2 = decodeInt(str, idx, 4);
        idx += 4;
        fill = {
          mode: 'linear',
          gradAngle,
          h: (f1 >> 14) & 0x1ff,
          s: (f1 >> 7) & 0x7f,
          l: f1 & 0x7f,
          h2: (f2 >> 14) & 0x1ff,
          s2: (f2 >> 7) & 0x7f,
          l2: f2 & 0x7f,
        } satisfies LinearFill;
      }

      const effect = EFFECT_KEYS[eff];
      const blend = BLEND_MODES[bl] || DEFAULT_BLEND;
      const waveform: WaveformType = wf === 2 ? 'blend' : wf === 1 ? 'pulse' : 'sine';

      const base = { id: genId('v'), x, y, size, fill, effect, blend, border };

      if (waveform === 'sine') {
        voices.push(Object.assign(base, { waveform } as const) as Voice);
      } else {
        voices.push(
          Object.assign(base, { waveform, timbre: normalizedCoord(timbre) } as const) as Voice,
        );
      }
    } catch {
      // If we encounter truncated data or garbage, we just drop the
      // incomplete voice and stop processing, returning what we have.
      break;
    }
  }

  return {
    envelope: { attack, decay, sustain, release },
    scene,
    voices,
  };
}
