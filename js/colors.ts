// Colors.ts — OKLCH color conversions and fill helpers

import { svgEl } from './dom.ts';
import type { Fill, LinearFill, SolidFill } from './types.ts';

/** Format an OKLCH color as a CSS oklch() string. */
export function oklchToString(h: number, c: number, l: number): string {
  return `oklch(${l} ${c} ${h})`;
}

// ---- Gamut clamping ----

/**
 * Clamp chroma so the color fits within sRGB gamut.
 * Uses binary search: halves chroma until the resulting sRGB values are in [0, 255].
 *
 * NOTE: This function can be removed once the `colorspace="limited-srgb"` attribute
 * on <input type="color"> is universally supported across browsers. As of 2026-03,
 * only Safari implements it. Until then, JS-side clamping is needed for programmatic
 * color generation (createRandomFill, harmony randomizer).
 */
export function clampChromaToSRGB(h: number, c: number, l: number): number {
  if (c <= 0) {
    return 0;
  }

  let lo = 0;
  let hi = c;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (isInSRGBGamut(h, mid, l)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Test whether an OKLCH color is within sRGB gamut using Oklab→linear sRGB math. */
function isInSRGBGamut(h: number, c: number, l: number): boolean {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const lc = l_ * l_ * l_;
  const mc = m_ * m_ * m_;
  const sc = s_ * s_ * s_;

  const r = +4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  const g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  const bl = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc;

  const EPS = -0.001;
  return r >= EPS && r <= 1.001 && g >= EPS && g <= 1.001 && bl >= EPS && bl <= 1.001;
}

// ---- Fill factories ----

/** Create a solid fill with a random hue and mid-range chroma/lightness. */
export function createRandomFill(): SolidFill {
  const h = Math.floor(Math.random() * 360);
  const rawC = 0.08 + Math.random() * 0.17;
  const l = 0.4 + Math.random() * 0.3;
  const c = clampChromaToSRGB(h, rawC, l);
  return { h, c, l, mode: 'solid' };
}

// ---- SVG-compatible fill helpers ----

/** Get the primary solid color for any fill. */
export function getSolidFillColor(fill: Fill): string {
  return oklchToString(fill.h, fill.c, fill.l);
}

/** Create or update an SVG <linearGradient> element for a linear fill. */
export function ensureLinearGradient(
  defs: SVGDefsElement,
  id: string,
  fill: LinearFill,
  shapeRotationDeg: number,
): void {
  let grad = defs.querySelector(`#${id}`) as SVGLinearGradientElement | undefined;
  if (!grad) {
    grad = svgEl(
      'linearGradient',
      { id, gradientUnits: 'objectBoundingBox' },
      svgEl('stop', { offset: '0%' }),
      svgEl('stop', { offset: '100%' }),
    );
    defs.append(grad);
  }

  const angle = ((fill.gradAngle - shapeRotationDeg) * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  grad.setAttribute('x1', String(0.5 - dx * 0.5));
  grad.setAttribute('y1', String(0.5 - dy * 0.5));
  grad.setAttribute('x2', String(0.5 + dx * 0.5));
  grad.setAttribute('y2', String(0.5 + dy * 0.5));

  const stops = grad.querySelectorAll('stop');
  stops[0]!.setAttribute('stop-color', oklchToString(fill.h, fill.c, fill.l));
  stops[1]!.setAttribute('stop-color', oklchToString(fill.h2, fill.c2, fill.l2));
}

// ---- Get swatch display color for toolbar ----

export function getSwatchColor(fill: Fill): string {
  switch (fill.mode) {
    case 'solid': {
      return oklchToString(fill.h, fill.c, fill.l);
    }
    case 'linear': {
      return `linear-gradient(${fill.gradAngle + 90}deg, ${oklchToString(fill.h, fill.c, fill.l)}, ${oklchToString(fill.h2, fill.c2, fill.l2)})`;
    }
  }
}
