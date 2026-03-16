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
  normalizedCoord,
} from './types.ts';
import { DEFAULT_BLEND } from './effects.ts';
import { getStrategy, ALL_STRATEGIES } from './waveforms/index.ts';

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

/** Convert sigil state to a URL path. Returns '/' if no voices. */
export function stateToPath(state: SigilData): string {
  if (state.voices.length === 0) return '/';
  return '/s/' + serializeState(state);
}

const B64_VALID = /^[A-Za-z0-9\-_]+$/;

/** Parse a URL pathname into sigil state. Returns undefined if path is not a /s/ route or data is invalid. */
export function pathToState(pathname: string): SigilData | undefined {
  if (!pathname.startsWith('/s/')) return undefined;
  const data = pathname.slice(3);
  if (!data || !B64_VALID.test(data)) return undefined;
  return deserializeState(data);
}

/** Whether the URL has been modified since the last navigation event. */
let dirty = false;

/** Reset the dirty flag (called on popstate). */
export function resetDirty(): void {
  dirty = false;
}

/** Serialize state and write it to the URL path via pushState or replaceState. */
export function saveToURL(state: SigilData): void {
  const path = stateToPath(state);
  if (path === globalThis.location.pathname) return;
  if (dirty) {
    history.replaceState(null, '', path);
  } else {
    history.pushState(null, '', path);
    dirty = true;
  }
}

/** Read and deserialize state from the current URL path, or undefined if empty/invalid.
 *  Migrates old hash-based URLs to path form via replaceState. */
export function loadFromURL(): SigilData | undefined {
  // Hash migration: old URLs stored state in the hash fragment
  const hash = globalThis.location.hash.slice(1);
  if (hash) {
    const state = deserializeState(hash);
    if (state) {
      const path = stateToPath(state);
      history.replaceState(null, '', path);
      return state;
    }
  }
  return pathToState(globalThis.location.pathname);
}

// ---- Base64 Custom Packing ----

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_MAP = new Map(B64_CHARS.split('').map((c, i) => [c, i]));

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function encodeInt(val: number, chars: number): string {
  let res = '';
  val = Math.max(0, Math.floor(val || 0));
  for (let i = 0; i < chars; i++) {
    res = B64_CHARS[val & 0x3f] + res;
    val = Math.floor(val / 64);
  }
  return res;
}

export function decodeInt(str: string, startIndex: number, chars: number): number {
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

function packVoice(v: Voice): string {
  let out = '';
  let flags = 0;
  const strategy = getStrategy(v.waveform);
  const wf = strategy.serializationIndex;
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

  out += strategy.packExtra(v);

  if (bm > 0 && v.border) {
    out += encodeInt(round3(v.border.thickness) * 1000, 2);
  }

  if (fm === 0) {
    const f = v.fill as SolidFill;
    const fInt = (Math.round(f.h) << 14) | (Math.round(f.s) << 7) | Math.round(f.l);
    out += encodeInt(fInt, 4);
  } else {
    const f = v.fill as LinearFill;
    out += encodeInt(Math.round(f.gradAngle), 2);
    const f1 = (Math.round(f.h) << 14) | (Math.round(f.s) << 7) | Math.round(f.l);
    out += encodeInt(f1, 4);
    const f2 = (Math.round(f.h2) << 14) | (Math.round(f.s2) << 7) | Math.round(f.l2);
    out += encodeInt(f2, 4);
  }

  return out;
}

function packB64(state: SigilData): string {
  let out = '';
  // Env (8 chars)
  out += encodeInt(round3(state.envelope.attack) * 1000, 2);
  out += encodeInt(round3(state.envelope.decay) * 1000, 2);
  out += encodeInt(round3(state.envelope.sustain) * 1000, 2);
  out += encodeInt(round3(state.envelope.release) * 1000, 2);

  // Scene (1 char)
  out += encodeInt(state.scene, 1);

  // Voices — pack each independently, then sort for canonical ordering.
  // Voice array order is not data; sorting ensures any permutation of the
  // same voice set produces an identical URL.
  const voiceStrings = state.voices.map((v) => packVoice(v));
  voiceStrings.sort();
  out += voiceStrings.join('');

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
      const strategy = ALL_STRATEGIES[wf];
      if (!strategy) break;
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

      // Note: in the current serialization format, `hasTimbre` is equivalent to
      // `serializationIndex > 0`. If a future waveform has serializationIndex > 0
      // but no timbre, the serialization format will need a revision. This is
      // acceptable since CLAUDE.md says "no backwards compatibility until v1."
      let extraFields: Record<string, unknown> = {};
      if (strategy.hasTimbre) {
        const result = strategy.unpackExtra(str, idx);
        extraFields = result.fields;
        idx += result.bytesRead;
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

      const base = { id: genId('v'), x, y, size, fill, effect, blend, border };
      voices.push({ ...strategy.createVoice(base), ...extraFields } as Voice);
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
