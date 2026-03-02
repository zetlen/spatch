// colors.ts — Color conversions (HSL, RGB) and color picker logic

import type { Fill } from './types.ts';

export function hslToString(h: number, s: number, l: number): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// ---- Get fill CSS string for a shape ----

export function getFillStyle(
  ctx: CanvasRenderingContext2D,
  fill: Fill,
  radius: number,
): string | CanvasGradient {
  switch (fill.mode) {
    case 'solid':
      return hslToString(fill.h, fill.s, fill.l);

    case 'linear': {
      const angle = (fill.gradAngle * Math.PI) / 180;
      const dx = Math.cos(angle) * radius;
      const dy = Math.sin(angle) * radius;
      const grad = ctx.createLinearGradient(-dx, -dy, dx, dy);
      grad.addColorStop(0, hslToString(fill.h, fill.s, fill.l));
      grad.addColorStop(1, hslToString(fill.h2, fill.s2, fill.l2));
      return grad;
    }
  }
}

// ---- Get swatch display color for toolbar ----

export function getSwatchColor(fill: Fill): string {
  switch (fill.mode) {
    case 'solid':
      return hslToString(fill.h, fill.s, fill.l);
    case 'linear':
      return `linear-gradient(${fill.gradAngle}deg, ${hslToString(fill.h, fill.s, fill.l)}, ${hslToString(fill.h2, fill.s2, fill.l2)})`;
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
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
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

// ---- Angle dial rendering ----

export function drawAngleDial(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  angle: number,
): void {
  ctx.clearRect(cx - r - 2, cy - r - 2, (r + 2) * 2, (r + 2) * 2);
  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Direction indicator
  const rad = (angle * Math.PI) / 180;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(rad) * r * 0.8, cy + Math.sin(rad) * r * 0.8);
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 3;
  ctx.stroke();
  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#2a2a2a';
  ctx.fill();
}
