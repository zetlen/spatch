// serialize.ts — URL encode/decode sigil state with register-based v2 format.
//
// V2 wire format:
//   [Version: 1 char (6b)]
//   [Scene: 1 char (6b)]
//   [Envelope: 2 chars (attack 3b + decay 3b, sustain 3b + release 3b)]
//   [Voices: variable length, sorted lexicographically]
//     Per voice:
//       Header (1 char): [typeId: 3b][fillMode: 1b][spare: 2b]
//       Registers: 10 chars (solid) or 15 chars (gradient)
//         CP1 (4 chars): fill color 1 — H(9) + S(7) + L(8)
//         CP2 (5 chars, gradient only): angle(3) + H(9) + S(7) + L(8)
//         SP1-SP6 (6 chars): Y, X, size, waveform-specific, effect+blend, border

import type { Envelope, SigilData, Voice } from './types.ts';
import { encodeInt, decodeInt } from './voices/b64.ts';
import { get, getById } from './voices/registry.ts';

// Re-export b64 utilities for any remaining consumers.
export { encodeInt, decodeInt } from './voices/b64.ts';

const SCHEMA_VERSION = 2;

// ---- Envelope quantization (3 bits per param) ----
// Attack/Decay: 8 steps over 0-2.0s
// Sustain: 8 steps over 0-1.0
// Release: 8 steps over 0-3.0s

const ENV_ATTACK_SCALE = 3.5; // val * 3.5 → 0-7
const ENV_DECAY_SCALE = 3.5;
const ENV_SUSTAIN_SCALE = 7; // val * 7 → 0-7
const ENV_RELEASE_SCALE = 7 / 3; // val * (7/3) → 0-7

function packEnvelope(env: Envelope): string {
  const a = Math.round(env.attack * ENV_ATTACK_SCALE) & 0x7;
  const d = Math.round(env.decay * ENV_DECAY_SCALE) & 0x7;
  const s = Math.round(env.sustain * ENV_SUSTAIN_SCALE) & 0x7;
  const r = Math.round(env.release * ENV_RELEASE_SCALE) & 0x7;
  return encodeInt((a << 3) | d, 1) + encodeInt((s << 3) | r, 1);
}

function unpackEnvelope(str: string, idx: number): Envelope {
  const ad = decodeInt(str, idx, 1);
  const sr = decodeInt(str, idx + 1, 1);
  return {
    attack: ((ad >> 3) & 0x7) / ENV_ATTACK_SCALE,
    decay: (ad & 0x7) / ENV_DECAY_SCALE,
    sustain: ((sr >> 3) & 0x7) / ENV_SUSTAIN_SCALE,
    release: (sr & 0x7) / ENV_RELEASE_SCALE,
  };
}

// ---- Voice header ----
// [typeId: 3b][fillMode: 1b][spare: 2b]

function packVoiceHeader(typeId: number, isGradient: boolean): string {
  const header = ((typeId & 0x7) << 3) | ((isGradient ? 1 : 0) << 2);
  return encodeInt(header, 1);
}

function unpackVoiceHeader(str: string, idx: number): { typeId: number; isGradient: boolean } {
  const val = decodeInt(str, idx, 1);
  return {
    typeId: (val >> 3) & 0x7,
    isGradient: ((val >> 2) & 0x1) === 1,
  };
}

// ---- Top-level pack/unpack ----

function packState(state: SigilData): string {
  let out = '';

  // Version (1 char)
  out += encodeInt(SCHEMA_VERSION, 1);

  // Scene (1 char)
  out += encodeInt(state.scene, 1);

  // Envelope (2 chars)
  out += packEnvelope(state.envelope);

  // Voices — pack each with header + registers, sort for canonical ordering
  const voiceStrings = state.voices.map((v) => {
    const entry = get(v.waveform);
    const isGradient = v.fill.mode === 'linear';
    const header = packVoiceHeader(entry.id, isGradient);
    const registers = entry.serializer.pack(v);
    return header + registers;
  });
  voiceStrings.sort();
  out += voiceStrings.join('');

  return out;
}

function unpackState(str: string): SigilData {
  let idx = 0;

  // Version (1 char)
  const version = decodeInt(str, idx++, 1);
  if (version !== SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version: ${version}`);
  }

  // Scene (1 char)
  const scene = decodeInt(str, idx++, 1);

  // Envelope (2 chars)
  const envelope = unpackEnvelope(str, idx);
  idx += 2;

  // Voices
  const voices: Voice[] = [];
  while (idx < str.length) {
    try {
      const { typeId, isGradient } = unpackVoiceHeader(str, idx);
      idx += 1;

      const entry = getById(typeId);
      if (!entry) break;

      const width = isGradient ? entry.serializer.gradientWidth : entry.serializer.solidWidth;
      if (idx + width > str.length) break;

      const registers = str.slice(idx, idx + width);
      idx += width;

      voices.push(entry.serializer.unpack(registers, entry.waveform));
    } catch {
      break;
    }
  }

  return { envelope, scene, voices };
}

// ---- Public API ----

export function serializeState(state: SigilData): string {
  return packState(state);
}

export function deserializeState(hash: string): SigilData | undefined {
  if (!hash) return undefined;
  try {
    return unpackState(hash);
  } catch (error) {
    console.warn('Failed to deserialize state:', error);
    return undefined;
  }
}

export function stateToPath(state: SigilData): string {
  if (state.voices.length === 0) return '/';
  return '/s/' + serializeState(state);
}

const B64_VALID = /^[A-Za-z0-9\-_]+$/;

export function pathToState(pathname: string): SigilData | undefined {
  if (!pathname.startsWith('/s/')) return undefined;
  const data = pathname.slice(3);
  if (!data || !B64_VALID.test(data)) return undefined;
  return deserializeState(data);
}

let dirty = false;

export function resetDirty(): void {
  dirty = false;
}

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

export function loadFromURL(): SigilData | undefined {
  return pathToState(globalThis.location.pathname);
}
