// serialize.js — URL encode/decode sigil state with lz-string

// LZString is loaded globally from lib/lz-string.min.js

export function serializeState(state) {
  const compact = compactify(state);
  const json = JSON.stringify(compact);
  return LZString.compressToEncodedURIComponent(json);
}

export function deserializeState(hash) {
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

export function saveToURL(state) {
  const encoded = serializeState(state);
  history.replaceState(null, '', '#' + encoded);
}

export function loadFromURL() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  return deserializeState(hash);
}

// ---- Compact format (single-char keys) ----

function compactify(state) {
  return {
    e: {
      a: round2(state.envelope.attack),
      d: round2(state.envelope.decay),
      s: round2(state.envelope.sustain),
      r: round2(state.envelope.release),
    },
    sh: state.shapes.map(s => ({
      t: s.type[0],                              // 't','s','c'
      x: round3(s.x),
      y: round3(s.y),
      z: round3(s.size),
      r: Math.round(s.rotation),
      f: compactFill(s.fill),
      p: s.pattern ? s.pattern[0] : 0,           // 's','c','n','g','r' or 0
    })),
    d: state.decorations.map(d => ({
      t: d.type[0],                               // 's','c','t'
      p: d.points ? d.points.map(([x, y]) => [round3(x), round3(y)]) : [],
      x: round3(d.x),
      y: round3(d.y),
      c: d.strokeColor,
      w: d.strokeWidth,
      tx: d.text || undefined,
      fs: d.fontSize || undefined,
      ts: d.targetShapeId || undefined,
    })),
  };
}

function decompactify(c) {
  const typeMap = { t: 'triangle', s: 'square', c: 'circle' };
  const patMap = { s: 'stripes', c: 'checker', n: 'noise', g: 'gradient', r: 'rough' };
  const decoMap = { s: 'squiggle', c: 'curlicue', t: 'text' };

  return {
    envelope: {
      attack: c.e.a,
      decay: c.e.d,
      sustain: c.e.s,
      release: c.e.r,
    },
    shapes: (c.sh || []).map(s => ({
      id: genId(),
      type: typeMap[s.t] || 'circle',
      x: s.x,
      y: s.y,
      size: s.z,
      rotation: s.r,
      fill: decompactFill(s.f),
      pattern: s.p ? (patMap[s.p] || null) : null,
    })),
    decorations: (c.d || []).map(d => ({
      id: genId(),
      type: decoMap[d.t] || 'squiggle',
      points: d.p || [],
      text: d.tx || null,
      targetShapeId: d.ts || null,
      x: d.x || 0,
      y: d.y || 0,
      strokeColor: d.c || 'hsl(320, 100%, 60%)',
      strokeWidth: d.w || 3,
      fontSize: d.fs || 24,
    })),
  };
}

function compactFill(f) {
  switch (f.mode) {
    case 'solid':
      return { m: 's', h: f.h, s: f.s, l: f.l };
    case 'radial':
      return { m: 'r', L: f.labL, a: f.labA, b: f.labB, L2: f.labL2, a2: f.labA2, b2: f.labB2 };
    case 'linear':
      return { m: 'l', g: f.gradAngle, h1: f.h1, s1: f.s1, l1: f.l1, h2: f.h2, s2: f.s2, l2: f.l2 };
    default:
      return { m: 's', h: 200, s: 80, l: 50 };
  }
}

function decompactFill(f) {
  const base = {
    mode: 'solid', h: 200, s: 80, l: 50,
    labL: 60, labA: 0, labB: 0, labL2: 30, labA2: 40, labB2: -40,
    gradAngle: 0, h1: 320, s1: 90, l1: 55, h2: 180, s2: 80, l2: 45,
  };

  switch (f.m) {
    case 's':
      return { ...base, mode: 'solid', h: f.h, s: f.s, l: f.l };
    case 'r':
      return { ...base, mode: 'radial', labL: f.L, labA: f.a, labB: f.b, labL2: f.L2, labA2: f.a2, labB2: f.b2 };
    case 'l':
      return { ...base, mode: 'linear', gradAngle: f.g, h1: f.h1, s1: f.s1, l1: f.l1, h2: f.h2, s2: f.s2, l2: f.l2 };
    default:
      return base;
  }
}

let _counter = 0;
function genId() {
  return 'r' + (++_counter).toString(36) + Math.random().toString(36).slice(2, 5);
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
