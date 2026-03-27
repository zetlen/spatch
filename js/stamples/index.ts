// index.ts — Stamples registry.
//
// Each stample is a directory under js/stamples/<name>/ containing:
//   stamp.svg   — detailed silhouette for rendering
//   sample.mp3  — audio sample
//   index.ts    — exports a Stample object (metadata, hull path, imports)
//
// This module collects them into a registry array, mirroring the pattern
// used by js/scenes/index.ts.

import palmTree from './palm-tree';
import energyDome from './energy-dome';
import champagne from './champagne';

export type { Stample } from './stample-types';

/** Parsed SVG data ready for inline rendering. */
export interface StampleSvg {
  viewBox: string;
  content: string;
}

/** Cardinal handle positions in the hull's viewBox space. */
export interface HandlePoints {
  n: { x: number; y: number };
  e: { x: number; y: number };
  s: { x: number; y: number };
  w: { x: number; y: number };
}

/** Resolved stample with parsed SVG data and data URI for thumbnails. */
export interface ResolvedStample {
  name: string;
  svg: StampleSvg;
  svgDataUri: string;
  sampleUrl: string;
  referencePitch: number;
  shapeAreaCoeff: number;
  gainExponent: number;
  formantMaxQ: number;
  hull: string;
  handlePoints: HandlePoints;
}

function parseSvg(raw: string): StampleSvg {
  const vbMatch = raw.match(/viewBox="([^"]+)"/);
  const viewBox = vbMatch ? vbMatch[1]! : '0 0 100 100';
  const openEnd = raw.indexOf('>');
  const closeStart = raw.lastIndexOf('</svg>');
  const content = raw.slice(openEnd + 1, closeStart);
  return { viewBox, content };
}

function toDataUri(raw: string): string {
  return 'data:image/svg+xml,' + encodeURIComponent(raw);
}

// ---- Hull sampling for handle placement ----

const SAMPLE_STEPS = 20;

function sampleCubic(p0: [number, number], args: number[], out: [number, number][]): void {
  const [x1, y1, x2, y2, x3, y3] = args;
  for (let i = 1; i <= SAMPLE_STEPS; i++) {
    const t = i / SAMPLE_STEPS;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * x1! + 3 * u * t * t * x2! + t * t * t * x3!,
      u * u * u * p0[1] + 3 * u * u * t * y1! + 3 * u * t * t * y2! + t * t * t * y3!,
    ]);
  }
}

function sampleQuadratic(p0: [number, number], args: number[], out: [number, number][]): void {
  const [x1, y1, x2, y2] = args;
  for (let i = 1; i <= SAMPLE_STEPS; i++) {
    const t = i / SAMPLE_STEPS;
    const u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * x1! + t * t * x2!,
      u * u * p0[1] + 2 * u * t * y1! + t * t * y2!,
    ]);
  }
}

/** Sample an SVG path (M/L/C/Q commands) into a polyline. */
function sampleHullPath(d: string): [number, number][] {
  const pts: [number, number][] = [];
  // Split into command + number groups
  const tokens = d.match(/[MLCQZ]|[-]?\d+\.?\d*/g);
  if (!tokens) return pts;

  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i]!;
    if (cmd === 'M' || cmd === 'L') {
      pts.push([parseFloat(tokens[i + 1]!), parseFloat(tokens[i + 2]!)]);
      i += 3;
    } else if (cmd === 'C') {
      const args = tokens.slice(i + 1, i + 7).map(Number);
      sampleCubic(pts[pts.length - 1]!, args, pts);
      i += 7;
    } else if (cmd === 'Q') {
      const args = tokens.slice(i + 1, i + 5).map(Number);
      sampleQuadratic(pts[pts.length - 1]!, args, pts);
      i += 5;
    } else {
      // Z or unknown — skip
      i++;
    }
  }
  return pts;
}

/** Find handle positions by locating distance-from-centroid peaks,
 *  then assigning the closest peak to each cardinal direction. */
function computeHandlePoints(hull: string): HandlePoints {
  const pts = sampleHullPath(hull);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;

  // Find local maxima of distance from centroid, ranked by prominence.
  const dists = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const ranked: { pt: [number, number]; prominence: number }[] = [];
  for (let i = 1; i < dists.length - 1; i++) {
    if (dists[i]! <= dists[i - 1]! || dists[i]! <= dists[i + 1]!) continue;
    const lo = Math.min(
      ...dists.slice(Math.max(0, i - 30), i),
      ...dists.slice(i + 1, Math.min(dists.length, i + 30)),
    );
    const prominence = dists[i]! - lo;
    if (prominence > 10) ranked.push({ pt: pts[i]!, prominence });
  }
  const tips = ranked.map((r) => r.pt);

  // Bounding extremes as fallbacks when no tip is found for a cardinal.
  const extremes = {
    n: pts.reduce((best, p) => (p[1] < best[1] ? p : best), pts[0]!),
    s: pts.reduce((best, p) => (p[1] > best[1] ? p : best), pts[0]!),
    e: pts.reduce((best, p) => (p[0] > best[0] ? p : best), pts[0]!),
    w: pts.reduce((best, p) => (p[0] < best[0] ? p : best), pts[0]!),
  };

  // Assign tips to each cardinal: among tips within ±60° of the direction,
  // pick the one furthest from the centroid. Fall back to the bounding
  // extreme (topmost, rightmost, etc.) when no tip qualifies.
  const MAX_ANGLE = Math.PI / 3; // 60°
  const cardinals: { key: keyof HandlePoints; angle: number }[] = [
    { key: 'n', angle: -Math.PI / 2 },
    { key: 'e', angle: 0 },
    { key: 's', angle: Math.PI / 2 },
    { key: 'w', angle: Math.PI },
  ];
  const result = {} as HandlePoints;
  for (const { key, angle } of cardinals) {
    let best: [number, number] | undefined;
    let bestDist = -1;
    for (const tip of tips) {
      const tipAngle = Math.atan2(tip[1] - cy, tip[0] - cx);
      let diff = Math.abs(tipAngle - angle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff > MAX_ANGLE) continue;
      const dist = Math.hypot(tip[0] - cx, tip[1] - cy);
      if (dist > bestDist) {
        bestDist = dist;
        best = tip;
      }
    }
    if (!best) best = extremes[key];
    result[key] = { x: best[0], y: best[1] };
  }
  return result;
}

/** Extract the `d` attribute from the first <path> in raw SVG markup.
 *  Appends Z if the path isn't already closed (open paths leave a gap
 *  in the selection outline stroke). */
function extractPathD(svgRaw: string): string {
  const match = svgRaw.match(/<path[^>]+d="([^"]+)"/);
  if (!match) throw new Error('No <path d="..."> found in stamp SVG');
  const d = match[1]!;
  return d.trimEnd().endsWith('Z') ? d : d + ' Z';
}

function resolve(s: {
  name: string;
  svgRaw: string;
  sampleUrl: string;
  referencePitch: number;
  shapeAreaCoeff: number;
  gainExponent: number;
  formantMaxQ: number;
  hull?: string;
  handles?: { n: [number, number]; e: [number, number]; s: [number, number]; w: [number, number] };
}): ResolvedStample {
  const hull = s.hull ?? extractPathD(s.svgRaw);
  const handlePoints = s.handles
    ? {
        n: { x: s.handles.n[0], y: s.handles.n[1] },
        e: { x: s.handles.e[0], y: s.handles.e[1] },
        s: { x: s.handles.s[0], y: s.handles.s[1] },
        w: { x: s.handles.w[0], y: s.handles.w[1] },
      }
    : computeHandlePoints(hull);
  return {
    name: s.name,
    svg: parseSvg(s.svgRaw),
    svgDataUri: toDataUri(s.svgRaw),
    sampleUrl: s.sampleUrl,
    referencePitch: s.referencePitch,
    shapeAreaCoeff: s.shapeAreaCoeff,
    gainExponent: s.gainExponent,
    formantMaxQ: s.formantMaxQ,
    hull,
    handlePoints,
  };
}

export const STAMPLES: readonly ResolvedStample[] = [
  resolve(palmTree),
  resolve(energyDome),
  resolve(champagne),
];

export const STAMPLE_COUNT = STAMPLES.length;

export function getStample(index: number): ResolvedStample {
  return STAMPLES[((index % STAMPLE_COUNT) + STAMPLE_COUNT) % STAMPLE_COUNT]!;
}
