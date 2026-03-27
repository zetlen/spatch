// stamp/ui.ts — SVG rendering and selection handles for stamp voices.

import { resizeHandleEl, setAttrs, svgEl } from '../../dom.ts';
import { getStample } from '../../stamples/index.ts';
import type { Voice } from '../../types.ts';
import type { VoiceUI } from '../types.ts';

function getStampIndex(voice: Voice): number {
  return 'stamp' in voice ? (voice as { stamp: number }).stamp : 0;
}

/** Symbol ID for a stample index. */
function symbolId(index: number): string {
  return `stample-${index}`;
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

/** Compute scale and translation to map viewBox coordinates to canvas space. */
function viewBoxTransform(
  voice: Voice,
  viewBox: string,
): { scale: number; tx: number; ty: number } {
  const [vx, vy, vw, vh] = viewBox.split(' ').map(Number);
  const r = (voice.size as number) / 2;
  const scale = Math.min((voice.size as number) / vw!, (voice.size as number) / vh!);
  const tx = (voice.x as number) - r + ((voice.size as number) - vw! * scale) / 2 - vx! * scale;
  const ty = (voice.y as number) - r + ((voice.size as number) - vh! * scale) / 2 - vy! * scale;
  return { scale, tx, ty };
}

/** Transform a hull path's coordinates from viewBox space to canvas space.
 *  Rewrites all numeric coordinate pairs in the path `d` string so the
 *  resulting path needs no transform attribute (avoiding stroke scaling). */
function transformHullPath(d: string, voice: Voice, viewBox: string): string {
  const { scale, tx, ty } = viewBoxTransform(voice, viewBox);
  let isX = true;
  return d.replace(/-?\d+\.?\d*/g, (match) => {
    const n = parseFloat(match);
    const result = isX ? n * scale + tx : n * scale + ty;
    isX = !isX;
    return result.toFixed(4);
  });
}

const ui: VoiceUI = {
  svgTag: 'g',
  shapeName: 'stamp',

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
    const { scale, tx, ty } = viewBoxTransform(voice, stample.svg.viewBox);
    const hp = stample.handlePoints;
    return [
      resizeHandleEl('n', hp.n.x * scale + tx, hp.n.y * scale + ty),
      resizeHandleEl('e', hp.e.x * scale + tx, hp.e.y * scale + ty),
      resizeHandleEl('s', hp.s.x * scale + tx, hp.s.y * scale + ty),
      resizeHandleEl('w', hp.w.x * scale + tx, hp.w.y * scale + ty),
    ];
  },
};

export default ui;
