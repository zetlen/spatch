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

function resolve(s: {
  name: string;
  svgRaw: string;
  sampleUrl: string;
  referencePitch: number;
  shapeAreaCoeff: number;
  gainExponent: number;
  formantMaxQ: number;
  hull: string;
}): ResolvedStample {
  return {
    name: s.name,
    svg: parseSvg(s.svgRaw),
    svgDataUri: toDataUri(s.svgRaw),
    sampleUrl: s.sampleUrl,
    referencePitch: s.referencePitch,
    shapeAreaCoeff: s.shapeAreaCoeff,
    gainExponent: s.gainExponent,
    formantMaxQ: s.formantMaxQ,
    hull: s.hull,
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
