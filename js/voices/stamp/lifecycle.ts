// Stamp/lifecycle.ts — Stamp sample lifecycle: prefetch, decode, symbol injection.

import { STAMPLES } from '../../stamples/index.ts';
import { decodeSample, fetchSample } from '../../audio/sample-loader.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Which stample variant to use when creating new stamp voices. */
let defaultStampleIndex = 0;

/** Set the default stample variant for new stamp voices (called by toolbar). */
export function setDefaultStampleIndex(index: number): void {
  defaultStampleIndex = index;
}

/** Get the current default stample index. */
export function getDefaultStampleIndex(): number {
  return defaultStampleIndex;
}

/** Prefetch all stamp sample bytes (tiny files, no AudioContext needed). */
export function prefetchStampSamples(): void {
  for (const stample of STAMPLES) {
    fetchSample(stample.sampleUrl);
  }
}

/** Decode all prefetched stamp samples into AudioBuffers. Call once an
 *  AudioContext is available (e.g. after warmUp). Uses sample-loader's
 *  built-in decode cache — no separate cache needed here. */
export function decodeStampSamples(ctx: BaseAudioContext): Promise<void> {
  const tasks = STAMPLES.map((stample) => decodeSample(ctx, stample.sampleUrl));
  return Promise.all(tasks).then(() => undefined);
}

/** Symbol ID for a stample index. */
function symbolId(index: number): string {
  return `stample-${index}`;
}

/**
 * Inject <symbol> definitions for all stamples into an SVG element's <defs>.
 * Call once at app init with the canvas SVG element. Each symbol contains the
 * parsed and fill-stripped stamp SVG content with its original viewBox.
 */
export function initStampSymbols(svg: SVGSVGElement): void {
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.prepend(defs);
  }

  for (let i = 0; i < STAMPLES.length; i++) {
    if (defs.querySelector(`#${symbolId(i)}`)) {
      continue;
    }
    const stample = STAMPLES[i]!;
    const symbol = document.createElementNS(SVG_NS, 'symbol');
    symbol.id = symbolId(i);
    symbol.setAttribute('viewBox', stample.svg.viewBox);

    // Parse SVG content and strip fill/style so shapes inherit the voice color
    const wrapper = `<svg xmlns="${SVG_NS}">${stample.svg.content}</svg>`;
    const doc = new DOMParser().parseFromString(wrapper, 'image/svg+xml');
    for (const el of doc.querySelectorAll('[fill]')) {
      el.removeAttribute('fill');
    }
    for (const el of doc.querySelectorAll('[style]')) {
      el.removeAttribute('style');
    }
    const parsed = doc.documentElement;
    while (parsed.firstChild) {
      symbol.appendChild(parsed.firstChild);
    }

    defs.appendChild(symbol);
  }
}
