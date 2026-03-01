// serialize.ts — URL encode/decode sigil state with lz-string

import LZString from 'lz-string';
import { genId } from './state.ts';
import type {
  SigilData,
  Fill,
  SolidFill,
  RadialFill,
  LinearFill,
  Decoration,
  NormalizedCoord,
  Degrees,
} from './types.ts';

export function serializeState(state: SigilData): string {
  const compact = compactify(state);
  const json = JSON.stringify(compact);
  return LZString.compressToEncodedURIComponent(json);
}

export function deserializeState(hash: string): SigilData | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(hash);
    if (!json) return null;
    const compact = JSON.parse(json);
    return decompactify(compact);
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

interface CompactState {
  e: CompactEnvelope;
  sh: CompactShape[];
  d: CompactDecoration[];
}

function compactify(state: SigilData): CompactState {
  return {
    e: {
      a: round2(state.envelope.attack),
      d: round2(state.envelope.decay),
      s: round2(state.envelope.sustain),
      r: round2(state.envelope.release),
    },
    sh: state.shapes.map((s) => ({
      i: s.id,
      t: s.type[0],
      x: round3(s.x),
      y: round3(s.y),
      z: round3(s.size),
      r: Math.round(s.rotation),
      f: compactFill(s.fill),
      p: s.pattern ? s.pattern[0] : 0,
    })),
    d: state.decorations.map((d) => {
      const base: CompactDecoration = {
        i: d.id,
        t: d.type[0],
        p: d.type === 'squiggle' ? d.points.map(([x, y]) => [round3(x), round3(y)]) : [],
        x: round3(d.type !== 'squiggle' ? d.x : 0),
        y: round3(d.type !== 'squiggle' ? d.y : 0),
        c: d.strokeColor,
        w: d.strokeWidth,
      };
      if (d.type === 'text') {
        base.tx = d.text;
        base.fs = d.fontSize;
      }
      if (d.targetShapeId) base.ts = d.targetShapeId;
      return base;
    }),
  };
}

function decompactify(c: CompactState): SigilData {
  const typeMap: Record<string, string> = { t: 'triangle', s: 'square', c: 'circle' };
  const patMap: Record<string, string> = {
    s: 'stripes',
    c: 'checker',
    n: 'noise',
    g: 'gradient',
    r: 'rough',
  };
  const decoMap: Record<string, string> = { s: 'squiggle', c: 'curlicue', t: 'text' };

  return {
    envelope: {
      attack: c.e.a,
      decay: c.e.d,
      sustain: c.e.s,
      release: c.e.r,
    },
    shapes: (c.sh || []).map((s) => ({
      id: s.i || genId('s'),
      type: (typeMap[s.t] || 'circle') as 'circle' | 'triangle' | 'square',
      x: s.x as NormalizedCoord,
      y: s.y as NormalizedCoord,
      size: s.z as NormalizedCoord,
      rotation: s.r as Degrees,
      fill: decompactFill(s.f),
      pattern: s.p ? (patMap[s.p as string] as any) || null : null,
    })),
    decorations: (c.d || []).map((d) => {
      const decoType = (decoMap[d.t] || 'squiggle') as 'squiggle' | 'curlicue' | 'text';
      return decompactDecoration(d, decoType);
    }),
  };
}

function decompactDecoration(
  d: CompactDecoration,
  decoType: 'squiggle' | 'curlicue' | 'text',
): Decoration {
  const base = {
    id: d.i || genId('d'),
    strokeColor: d.c || 'hsl(320, 100%, 60%)',
    strokeWidth: d.w || 3,
    targetShapeId: d.ts || null,
  };

  switch (decoType) {
    case 'squiggle':
      return {
        ...base,
        type: 'squiggle',
        points: (d.p || []) as [NormalizedCoord, NormalizedCoord][],
      };
    case 'curlicue':
      return {
        ...base,
        type: 'curlicue',
        x: (d.x || 0) as NormalizedCoord,
        y: (d.y || 0) as NormalizedCoord,
        scale: 1,
      };
    case 'text':
      return {
        ...base,
        type: 'text',
        text: d.tx || '',
        x: (d.x || 0) as NormalizedCoord,
        y: (d.y || 0) as NormalizedCoord,
        scale: 1,
        fontSize: d.fs || 24,
      };
  }
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

function decompactFill(f: any): Fill {
  switch (f.m) {
    case 's':
      return { mode: 'solid', h: f.h ?? 200, s: f.s ?? 80, l: f.l ?? 50 } satisfies SolidFill;
    case 'r':
      if (f.h != null) {
        return {
          mode: 'radial',
          h: f.h,
          s: f.s,
          l: f.l,
          h2: f.h2 ?? 180,
          s2: f.s2 ?? 80,
          l2: f.l2 ?? 45,
        } satisfies RadialFill;
      }
      return { mode: 'radial', h: 200, s: 80, l: 50, h2: 180, s2: 80, l2: 45 } satisfies RadialFill;
    case 'l':
      return {
        mode: 'linear',
        gradAngle: f.g ?? 0,
        h: f.h ?? f.h1 ?? 200,
        s: f.s ?? f.s1 ?? 80,
        l: f.l ?? f.l1 ?? 50,
        h2: f.h2 ?? 180,
        s2: f.s2 ?? 80,
        l2: f.l2 ?? 45,
      } satisfies LinearFill;
    default:
      return { mode: 'solid', h: 200, s: 80, l: 50 } satisfies SolidFill;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
