// stamp.ts — Stamp (sample-based) waveform strategy.
//
// Stamps play short audio samples instead of oscillators. Each stamp has a
// unique SVG silhouette and sample file, indexed via the `stamp` field on the
// voice. The STAMPLES registry (js/stamples/index.ts) defines available stamps.
//
// Rendering uses <symbol> definitions (injected into the canvas SVG defs at
// init time via initStampSymbols) referenced by <use> elements. This gives
// fast rendering (browser caches symbol content), native fill/stroke support,
// and proper hit-testing for drag/selection.
//
// Audio pipeline: AudioBufferSourceNode (looped) → shared.gain → [formant chain].
// A dedicated silent OscillatorNode runs alongside for FM modulation routing.
// Pitch is controlled via playbackRate (like speeding up a record).

import { resizeHandleEl, setAttrs, svgEl } from '../dom.ts';
import { safeStop } from '../audio/node-utils.ts';
import { yToFrequency, yToPlaybackRate } from '../audio/mapping.ts';
import { decodeSample, fetchSample, getCachedSample } from '../audio/sample-loader.ts';
import { decodeInt, encodeInt } from '../serialize.ts';
import { type NormalizedCoord, type Voice, type VoiceBase, normalizedCoord } from '../types.ts';
import type { AudioSharedNodes, AudioVoice, WaveformStrategy } from './types.ts';
import { STAMPLES, getStample } from '../stamples/index.ts';

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
    if (defs.querySelector(`#${symbolId(i)}`)) continue;
    const stample = STAMPLES[i]!;
    const symbol = document.createElementNS(SVG_NS, 'symbol');
    symbol.id = symbolId(i);
    symbol.setAttribute('viewBox', stample.svg.viewBox);

    // Parse SVG content and strip fill/style so shapes inherit the voice color
    const wrapper = `<svg xmlns="${SVG_NS}">${stample.svg.content}</svg>`;
    const doc = new DOMParser().parseFromString(wrapper, 'image/svg+xml');
    for (const el of doc.querySelectorAll('[fill]')) el.removeAttribute('fill');
    for (const el of doc.querySelectorAll('[style]')) el.removeAttribute('style');
    const parsed = doc.documentElement;
    while (parsed.firstChild) {
      symbol.appendChild(parsed.firstChild);
    }

    defs.appendChild(symbol);
  }
}

// 1-sample silent buffer used as fallback if decode hasn't finished yet.
let silentBuffer: AudioBuffer | undefined;
function getSilentBuffer(ctx: AudioContext): AudioBuffer {
  if (!silentBuffer) {
    silentBuffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  }
  return silentBuffer;
}

function getStampIndex(voice: Voice): number {
  return 'stamp' in voice ? (voice as { stamp: number }).stamp : 0;
}

/** Compute the aspect-ratio-correct width/height for a stamp's <use> element.
 *  The stamp fits inside the voice's size, preserving the symbol's viewBox ratio. */
function stampBounds(
  voice: Voice,
  stample: { svg: { viewBox: string } },
): {
  w: number;
  h: number;
  dx: number;
  dy: number;
} {
  const [, , vw, vh] = stample.svg.viewBox.split(' ').map(Number);
  const s = voice.size as number;
  const aspect = vw! / vh!;
  let w: number, h: number;
  if (aspect > 1) {
    w = s;
    h = s / aspect;
  } else {
    w = s * aspect;
    h = s;
  }
  return { w, h, dx: (s - w) / 2, dy: (s - h) / 2 };
}

function useAttrs(voice: Voice): Record<string, string | number> {
  const r = (voice.size as number) / 2;
  const stample = getStample(getStampIndex(voice));
  const { w, h, dx, dy } = stampBounds(voice, stample);
  return {
    href: `#${symbolId(getStampIndex(voice))}`,
    x: (voice.x as number) - r + dx,
    y: (voice.y as number) - r + dy,
    width: w,
    height: h,
  };
}

/** Transform a hull path's coordinates from viewBox space to canvas space.
 *  Rewrites all numeric coordinate pairs in the path `d` string so the
 *  resulting path needs no transform attribute (avoiding stroke scaling). */
function transformHullPath(d: string, voice: Voice, viewBox: string): string {
  const [vx, vy, vw, vh] = viewBox.split(' ').map(Number);
  const r = (voice.size as number) / 2;
  const scale = Math.min((voice.size as number) / vw!, (voice.size as number) / vh!);
  const tx = (voice.x as number) - r + ((voice.size as number) - vw! * scale) / 2 - vx! * scale;
  const ty = (voice.y as number) - r + ((voice.size as number) - vh! * scale) / 2 - vy! * scale;
  // Replace coordinate pairs: transform each number
  let isX = true;
  return d.replace(/-?\d+\.?\d*/g, (match) => {
    const n = parseFloat(match);
    const result = isX ? n * scale + tx : n * scale + ty;
    isX = !isX;
    return result.toFixed(4);
  });
}

const stamp: WaveformStrategy = {
  waveform: 'stamp',
  shapeName: 'stamp',
  svgTag: 'g',
  hasTimbre: false,
  rotationPeriod: 0,
  serializationIndex: 4,
  oscillatorType: 'sine',
  shapeAreaCoeff: 1.2,
  formantMaxQ: 4,
  gainExponent: 2.5,

  createSvgElement(voice: Voice): SVGElement {
    const g = svgEl('g');
    const idx = getStampIndex(voice);
    g.setAttribute('data-stamp', String(idx));
    const use = svgEl('use');
    setAttrs(use, useAttrs(voice));
    // Hull-shaped hit-test path: iOS Safari doesn't propagate touch events
    // through <use>/<symbol>, so this transparent hull captures touches and
    // bubbles them up to the voice group. Using the hull shape (not a rect)
    // so clicks outside the silhouette pass through to shapes behind.
    const stample = getStample(idx);
    const hit = svgEl('path');
    hit.setAttribute('d', transformHullPath(stample.hull, voice, stample.svg.viewBox));
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('data-hit', '');
    g.append(use, hit);
    return g;
  },

  updateSvgElement(el: SVGElement, voice: Voice): void {
    const use = el.querySelector('use');
    const hit = el.querySelector('[data-hit]');
    if (use) setAttrs(use, useAttrs(voice));
    const idx = getStampIndex(voice);
    const stample = getStample(idx);
    if (hit) {
      hit.setAttribute('d', transformHullPath(stample.hull, voice, stample.svg.viewBox));
    }
    // Update stamp variant if changed
    const currentStamp = el.getAttribute('data-stamp');
    const newStamp = String(idx);
    if (currentStamp !== newStamp && use) {
      setAttrs(use, useAttrs(voice));
      el.setAttribute('data-stamp', newStamp);
    }
  },

  createSelectionElement(voice: Voice): SVGElement {
    const stample = getStample(getStampIndex(voice));
    const el = svgEl('path');
    // Pre-transform hull coordinates to canvas space so the path has no
    // transform attribute. This avoids stroke scaling issues (the transform's
    // scale() would shrink the stroke to sub-pixel on mobile).
    el.setAttribute('d', transformHullPath(stample.hull, voice, stample.svg.viewBox));
    return el;
  },

  selectionHandles(voice: Voice): SVGElement[] {
    const stample = getStample(getStampIndex(voice));
    const r = (voice.size as number) / 2;
    const { w, h, dx, dy } = stampBounds(voice, stample);
    const hw = w / 2;
    const hh = h / 2;
    const cx = (voice.x as number) + dx - r + hw;
    const cy = (voice.y as number) + dy - r + hh;
    return [
      resizeHandleEl('e', cx + hw, cy),
      resizeHandleEl('n', cx, cy - hh),
      resizeHandleEl('w', cx - hw, cy),
      resizeHandleEl('s', cx, cy + hh),
    ];
  },

  buildAudioGraph(ctx: AudioContext, voice: Voice, shared: AudioSharedNodes): AudioVoice {
    const stample = getStample(getStampIndex(voice));
    const rate = yToPlaybackRate(voice.y, stample.referencePitch);
    const freq = yToFrequency(voice.y);

    // Use sample-loader's decode cache, or silent fallback if not yet decoded.
    // Normally decodeStampSamples() is called on first gesture, so the buffer
    // is ready by play time. The fallback handles edge cases.
    const buffer = getCachedSample(stample.sampleUrl) ?? getSilentBuffer(ctx);
    const source = new AudioBufferSourceNode(ctx, {
      buffer,
      loop: false,
      playbackRate: rate,
    });
    source.connect(shared.gain);

    // Silent FM oscillator: participates in FM routing but produces no audible output.
    const fmOsc = new OscillatorNode(ctx, { type: 'sine', frequency: freq });

    return {
      ...shared,
      hasSweep: false,
      lastX: voice.x as number,
      lastY: voice.y as number,
      lastSize: voice.size as number,
      outputNode: shared.panner,
      shapeId: voice.id,
      warmthShaper: undefined,
      start(time: number) {
        // FM osc and border octave start immediately (attack phase).
        // The sample itself fires in onDecay() so the percussive hit
        // lands at peak envelope amplitude, not during the ramp.
        fmOsc.start(time);
        if (shared.octaveOsc) {
          try {
            shared.octaveOsc.start(time);
          } catch {}
        }
      },
      onDecay(time: number) {
        source.start(time);
      },
      stop(_time: number) {
        safeStop(source);
        safeStop(fmOsc);
        if (shared.octaveOsc) safeStop(shared.octaveOsc);
      },
      updateParams(voice: Voice, now: number) {
        const stample = getStample(getStampIndex(voice));
        const rate = yToPlaybackRate(voice.y, stample.referencePitch);
        const freq = yToFrequency(voice.y);
        source.playbackRate.setValueAtTime(rate, now);
        fmOsc.frequency.setValueAtTime(freq, now);
      },
      syncGlobalParams() {},
      getModulatorNode(): OscillatorNode {
        return fmOsc;
      },
      getCarrierFrequencyParams(): AudioParam[] {
        const params: AudioParam[] = [fmOsc.frequency];
        if (shared.octaveOsc) params.push(shared.octaveOsc.frequency);
        return params;
      },
    };
  },

  createVoice(base: VoiceBase): Voice {
    return { ...base, waveform: 'stamp', stamp: defaultStampleIndex } as Voice;
  },

  getTimbre(_voice: Voice): NormalizedCoord {
    return normalizedCoord(0);
  },

  withTimbre(_value: NormalizedCoord): Partial<Voice> {
    return {};
  },

  packExtra(voice: Voice): string {
    return encodeInt(getStampIndex(voice), 1);
  },

  unpackExtra(str: string, idx: number): { fields: Record<string, unknown>; bytesRead: number } {
    const stamp = decodeInt(str, idx, 1);
    return { fields: { stamp }, bytesRead: 1 };
  },
};

export default stamp;
