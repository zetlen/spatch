// Colors.ts — Color conversions (HSL, RGB) and color picker logic

import { svgEl } from './dom.ts';
import type { Fill, LinearFill, SolidFill } from './types.ts';

export function hslToString(h: number, s: number, l: number): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// ---- Fill factories ----

/** Create a solid fill with a random hue and mid-range saturation/lightness. */
export function createRandomFill(): SolidFill {
  return {
    h: Math.floor(Math.random() * 360),
    l: 45 + Math.floor(Math.random() * 15),
    mode: 'solid',
    s: 70 + Math.floor(Math.random() * 20),
  };
}

// ---- SVG-compatible fill helpers ----

/** Get the primary solid color for any fill (used for SVG fill attr on solid fills). */
export function getSolidFillColor(fill: Fill): string {
  return hslToString(fill.h, fill.s, fill.l);
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
  // Map unit-circle direction to 0-1 gradient coords
  grad.setAttribute('x1', String(0.5 - dx * 0.5));
  grad.setAttribute('y1', String(0.5 - dy * 0.5));
  grad.setAttribute('x2', String(0.5 + dx * 0.5));
  grad.setAttribute('y2', String(0.5 + dy * 0.5));

  const stops = grad.querySelectorAll('stop');
  stops[0]!.setAttribute('stop-color', hslToString(fill.h, fill.s, fill.l));
  stops[1]!.setAttribute('stop-color', hslToString(fill.h2, fill.s2, fill.l2));
}

// ---- Get swatch display color for toolbar ----

export function getSwatchColor(fill: Fill): string {
  switch (fill.mode) {
    case 'solid': {
      return hslToString(fill.h, fill.s, fill.l);
    }
    case 'linear': {
      return `linear-gradient(${fill.gradAngle + 90}deg, ${hslToString(fill.h, fill.s, fill.l)}, ${hslToString(fill.h2, fill.s2, fill.l2)})`;
    }
  }
}

// ---- HSL ↔ Hex conversion (for native color picker) ----

export function hslToHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

export function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, Math.round(l * 100)];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
