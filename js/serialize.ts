// serialize.ts — URL encode/decode sigil state with lz-string

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
  type NormalizedCoord,
  type PatternType,
} from './types.ts';

export function serializeState(state: SigilData): string {
  const compact = compactify(state);
  const json = JSON.stringify(compact);
  return LZString.compressToEncodedURIComponent(json);
}

/** Expose the raw compact JSON for testing. */
export function _serializeToJSON(state: SigilData): string {
  return JSON.stringify(compactify(state));
}

export function deserializeState(hash: string): SigilData | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(hash);
    if (!json) return null;
    const compact = JSON.parse(json);
    if (compact.v === 2) {
      return decompactifyV2(compact);
    }
    // Legacy format (no v field) or v1 — map to new types
    return decompactifyLegacy(compact);
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

// ---- Compact format (single-char keys) ----

interface CompactEnvelope {
  a: number;
  d: number;
  s: number;
  r: number;
}

interface CompactSolidFill {
  m: 's';
  h: number;
  s: number;
  l: number;
}

interface CompactRadialFill {
  m: 'r';
  h: number;
  s: number;
  l: number;
  h2: number;
  s2: number;
  l2: number;
}

interface CompactLinearFill {
  m: 'l';
  g: number;
  h: number;
  s: number;
  l: number;
  h2: number;
  s2: number;
  l2: number;
}

type CompactFill = CompactSolidFill | CompactRadialFill | CompactLinearFill;

// ---- V2 compact types ----

interface CompactVoice {
  i: string;
  w: string;
  x: number;
  y: number;
  z: number;
  f: CompactFill;
  e: string | 0;
  b?: number;
}

interface CompactText {
  i: string;
  t: string;
  x: number;
  y: number;
  z: number;
  h: number;
  s: number;
  l: number;
}

interface CompactStateV2 {
  v: 2;
  e: CompactEnvelope;
  vo: CompactVoice[];
  tx: CompactText[];
}

// ---- Legacy compact types (v1 / no version) ----

interface CompactShape {
  i: string;
  t: string;
  x: number;
  y: number;
  z: number;
  r: number;
  f: CompactFill;
  p: string | 0;
}

interface CompactDecoration {
  i: string;
  t: string;
  p: [number, number][];
  x: number;
  y: number;
  c: string;
  w: number;
  tx?: string;
  fs?: number;
  ts?: string;
}

interface CompactStateLegacy {
  e: CompactEnvelope;
  sh: CompactShape[];
  d: CompactDecoration[];
}

interface CompactStateV1 extends CompactStateLegacy {
  v: 1;
}

// ---- V2 compactify ----

function compactify(state: SigilData): CompactStateV2 {
  return {
    v: 2,
    e: {
      a: round2(state.envelope.attack),
      d: round2(state.envelope.decay),
      s: round2(state.envelope.sustain),
      r: round2(state.envelope.release),
    },
    vo: state.voices.map((v) => {
      const cv: CompactVoice = {
        i: v.id,
        w: v.waveform[0]!,
        x: round3(v.x),
        y: round3(v.y),
        z: round3(v.size),
        f: compactFill(v.fill),
        e: v.effect ? v.effect[0]! : 0,
      };
      if ('timbre' in v) {
        cv.b = round3(v.timbre);
      }
      return cv;
    }),
    tx: state.texts.map((t) => ({
      i: t.id,
      t: t.text,
      x: round3(t.x),
      y: round3(t.y),
      z: round3(t.size),
      h: t.color.h,
      s: t.color.s,
      l: t.color.l,
    })),
  };
}

// ---- V2 decompactify ----

const waveformMap: Record<string, WaveformType> = { s: 'sine', p: 'pulse', b: 'blend' };
const effectMap: Record<string, PatternType> = {
  s: 'stripes',
  c: 'checker',
  n: 'noise',
  g: 'gradient',
  r: 'rough',
};

function decompactifyV2(c: CompactStateV2): SigilData {
  return {
    envelope: {
      attack: c.e.a,
      decay: c.e.d,
      sustain: c.e.s,
      release: c.e.r,
    },
    voices: (c.vo || []).map((cv): Voice => {
      const waveform: WaveformType = waveformMap[cv.w] || 'sine';
      const effect: PatternType | null = cv.e ? (effectMap[cv.e as string] ?? null) : null;
      const base = {
        id: cv.i || genId('v'),
        x: normalizedCoord(cv.x),
        y: normalizedCoord(cv.y),
        size: normalizedCoord(cv.z),
        fill: decompactFill(cv.f),
        effect,
      };
      switch (waveform) {
        case 'sine':
          return { ...base, waveform: 'sine' };
        case 'pulse':
          return { ...base, waveform: 'pulse', timbre: normalizedCoord(cv.b ?? 0) };
        case 'blend':
          return { ...base, waveform: 'blend', timbre: normalizedCoord(cv.b ?? 0) };
      }
    }),
    texts: (c.tx || []).map((ct): TextDecoration => ({
      id: ct.i || genId('t'),
      text: ct.t,
      x: normalizedCoord(ct.x),
      y: normalizedCoord(ct.y),
      size: normalizedCoord(ct.z),
      color: { h: ct.h, s: ct.s, l: ct.l },
    })),
  };
}

// ---- Legacy decompactify (v1 and no-version) ----

function decompactifyLegacy(c: CompactStateLegacy | CompactStateV1): SigilData {
  // Map old shape types to waveforms: circle→sine, square→pulse, triangle→blend
  const legacyTypeMap: Record<string, WaveformType> = {
    c: 'sine',
    s: 'pulse',
    t: 'blend',
  };

  const patMap: Record<string, PatternType> = {
    s: 'stripes',
    c: 'checker',
    n: 'noise',
    g: 'gradient',
    r: 'rough',
  };

  return {
    envelope: {
      attack: c.e.a,
      decay: c.e.d,
      sustain: c.e.s,
      release: c.e.r,
    },
    voices: (c.sh || []).map((s): Voice => {
      const waveform: WaveformType = legacyTypeMap[s.t] || 'sine';
      const effect: PatternType | null = s.p ? (patMap[s.p as string] ?? null) : null;
      const base = {
        id: s.i || genId('v'),
        x: normalizedCoord(s.x),
        y: normalizedCoord(s.y),
        size: normalizedCoord(s.z),
        fill: decompactFill(s.f),
        effect,
      };
      switch (waveform) {
        case 'sine':
          return { ...base, waveform: 'sine' };
        case 'pulse':
          // Old rotation is available but map timbre to 0 for legacy
          return { ...base, waveform: 'pulse', timbre: normalizedCoord(0) };
        case 'blend':
          return { ...base, waveform: 'blend', timbre: normalizedCoord(0) };
      }
    }),
    texts: (c.d || [])
      .filter((d) => d.t === 't') // Only keep text decorations, drop squiggles/curlicues
      .map((d): TextDecoration => {
        // Try to parse h/s/l from legacy strokeColor (e.g., "hsl(50, 100%, 60%)")
        const color = parseHSLString(d.c) || { h: 50, s: 100, l: 60 };
        return {
          id: d.i || genId('t'),
          text: d.tx || '',
          x: normalizedCoord(d.x || 0),
          y: normalizedCoord(d.y || 0),
          size: normalizedCoord(0.06),
          color,
        };
      }),
  };
}

/** Parse an "hsl(h, s%, l%)" string into {h, s, l}. Returns null on failure. */
function parseHSLString(str: string): { h: number; s: number; l: number } | null {
  if (!str) return null;
  const m = str.match(/hsl\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)/);
  if (!m) return null;
  return { h: parseInt(m[1]!), s: parseInt(m[2]!), l: parseInt(m[3]!) };
}

function compactFill(f: Fill): CompactFill {
  switch (f.mode) {
    case 'solid':
      return { m: 's', h: f.h, s: f.s, l: f.l };
    case 'radial':
      return { m: 'r', h: f.h, s: f.s, l: f.l, h2: f.h2, s2: f.s2, l2: f.l2 };
    case 'linear':
      return {
        m: 'l',
        g: f.gradAngle,
        h: f.h,
        s: f.s,
        l: f.l,
        h2: f.h2,
        s2: f.s2,
        l2: f.l2,
      };
  }
}

function decompactFill(f: CompactFill): Fill {
  switch (f.m) {
    case 's':
      return { mode: 'solid', h: f.h, s: f.s, l: f.l } satisfies SolidFill;
    case 'r':
      return {
        mode: 'radial',
        h: f.h,
        s: f.s,
        l: f.l,
        h2: f.h2,
        s2: f.s2,
        l2: f.l2,
      } satisfies RadialFill;
    case 'l':
      return {
        mode: 'linear',
        gradAngle: f.g,
        h: f.h,
        s: f.s,
        l: f.l,
        h2: f.h2,
        s2: f.s2,
        l2: f.l2,
      } satisfies LinearFill;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
