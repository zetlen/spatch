// shapes.ts — Hit testing, selection, drag/resize/rotate

import {
  normalizedCoord,
  degrees,
  waveformShape,
  type Voice,
  type TextDecoration,
  type Envelope,
  type SigilData,
  type NormalizedCoord,
  type HandleType,
  type ADSRCorner,
  type Degrees,
  type DecoBounds,
  type WaveformType,
} from './types.ts';

const HANDLE_SIZE = 8;
const ROT_HANDLE_OFFSET = 25;

const MIN_SIZE = 0.025;
const MAX_SIZE = 0.9;

export function clampSize(size: number): NormalizedCoord {
  return normalizedCoord(Math.max(MIN_SIZE, Math.min(MAX_SIZE, size)));
}

/** Get the visual rotation for a voice (derived from timbre). */
function voiceRotation(voice: Voice): number {
  if ('timbre' in voice) {
    const period = voice.waveform === 'pulse' ? 90 : 120;
    return (Math.asin(Math.min(1, Math.max(0, voice.timbre))) * period) / Math.PI;
  }
  return 0;
}

// Hit test against all voices (back-to-front, return topmost)
export function hitTestShapes(
  state: SigilData,
  mx: number,
  my: number,
  canvasSize: number,
): string | null {
  // Iterate in reverse (front voices first)
  for (let i = state.voices.length - 1; i >= 0; i--) {
    const voice = state.voices[i]!;
    if (isPointInVoice(voice, mx, my, canvasSize)) {
      return voice.id;
    }
  }
  return null;
}

function isPointInVoice(voice: Voice, mx: number, my: number, canvasSize: number): boolean {
  const cx = voice.x * canvasSize;
  const cy = voice.y * canvasSize;
  const r = (voice.size / 2) * canvasSize;
  const rotDeg = voiceRotation(voice);
  const rotRad = (rotDeg * Math.PI) / 180;

  // Transform mouse point into voice-local coordinates
  const dx = mx - cx;
  const dy = my - cy;
  const cos = Math.cos(-rotRad);
  const sin = Math.sin(-rotRad);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;

  const shape = waveformShape(voice.waveform);

  switch (shape) {
    case 'circle':
      return lx * lx + ly * ly <= r * r;

    case 'square':
      return Math.abs(lx) <= r && Math.abs(ly) <= r;

    case 'triangle': {
      // Equilateral triangle inscribed in circle of radius r
      const verts: [number, number][] = [];
      for (let i = 0; i < 3; i++) {
        const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
        verts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
      }
      return pointInTriangle(lx, ly, verts[0]!, verts[1]!, verts[2]!);
    }

    default:
      return false;
  }
}

function pointInTriangle(
  px: number,
  py: number,
  v0: [number, number],
  v1: [number, number],
  v2: [number, number],
): boolean {
  // Use barycentric coordinates
  const denom = (v1[0] - v0[0]) * (v2[1] - v0[1]) - (v2[0] - v0[0]) * (v1[1] - v0[1]);
  if (Math.abs(denom) < 0.001) return false;
  const u = ((v2[1] - v0[1]) * (px - v0[0]) + (v0[0] - v2[0]) * (py - v0[1])) / denom;
  const v = ((v0[1] - v1[1]) * (px - v0[0]) + (v1[0] - v0[0]) * (py - v0[1])) / denom;
  return u >= 0 && v >= 0 && u + v <= 1;
}

// Hit test selection handles. Returns handle type or null.
export function hitTestHandles(
  voice: Voice | null,
  mx: number,
  my: number,
  canvasSize: number,
): HandleType | null {
  if (!voice) return null;
  const cx = voice.x * canvasSize;
  const cy = voice.y * canvasSize;
  const r = (voice.size / 2) * canvasSize;
  const rotDeg = voiceRotation(voice);
  const rotRad = (rotDeg * Math.PI) / 180;

  // Transform to local coords
  const dx = mx - cx;
  const dy = my - cy;
  const cos = Math.cos(-rotRad);
  const sin = Math.sin(-rotRad);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;

  // Rotation handle (disabled for sine voices / circles)
  const rotY = -r - ROT_HANDLE_OFFSET;
  if (voice.waveform !== 'sine' && Math.abs(lx) < 8 && Math.abs(ly - rotY) < 8) {
    return 'rotate';
  }

  // Resize handles (corners and midpoints)
  const handles: { x: number; y: number; type: HandleType }[] = [
    { x: -r, y: -r, type: 'nw' },
    { x: r, y: -r, type: 'ne' },
    { x: r, y: r, type: 'se' },
    { x: -r, y: r, type: 'sw' },
    { x: 0, y: -r, type: 'n' },
    { x: r, y: 0, type: 'e' },
    { x: 0, y: r, type: 's' },
    { x: -r, y: 0, type: 'w' },
  ];

  for (const h of handles) {
    if (Math.abs(lx - h.x) < HANDLE_SIZE && Math.abs(ly - h.y) < HANDLE_SIZE) {
      return h.type;
    }
  }

  return null;
}

// Hit test ADSR corners. Returns corner name if mouse is near a canvas corner.
export function hitTestADSRCorner(
  envelope: Envelope,
  mx: number,
  my: number,
  canvasSize: number,
): ADSRCorner | null {
  const hitRadius = canvasSize * 0.08;
  const corners: { name: ADSRCorner; cx: number; cy: number }[] = [
    { name: 'attack', cx: 0, cy: canvasSize },
    { name: 'decay', cx: 0, cy: 0 },
    { name: 'sustain', cx: canvasSize, cy: 0 },
    { name: 'release', cx: canvasSize, cy: canvasSize },
  ];

  for (const corner of corners) {
    if (Math.hypot(mx - corner.cx, my - corner.cy) < hitRadius) {
      return corner.name;
    }
  }

  return null;
}

// Calculate new size from a resize handle drag
export function calcResize(
  voice: Voice,
  handleType: HandleType,
  localDx: number,
  localDy: number,
  canvasSize: number,
): NormalizedCoord {
  const r = (voice.size / 2) * canvasSize;
  let newR = r;

  switch (handleType) {
    case 'nw':
    case 'se':
      newR = r + ((handleType === 'se' ? 1 : -1) * (localDx + localDy)) / 2;
      break;
    case 'ne':
    case 'sw':
      newR = r + ((handleType === 'ne' ? 1 : -1) * (localDx - localDy)) / 2;
      break;
    case 'n':
    case 's':
      newR = r + (handleType === 's' ? 1 : -1) * localDy;
      break;
    case 'e':
    case 'w':
      newR = r + (handleType === 'e' ? 1 : -1) * localDx;
      break;
  }

  return clampSize((newR * 2) / canvasSize);
}

// Calculate rotation from mouse position relative to voice center
export function calcRotation(voice: Voice, mx: number, my: number, canvasSize: number): Degrees {
  const cx = voice.x * canvasSize;
  const cy = voice.y * canvasSize;
  const angle = Math.atan2(my - cy, mx - cx);
  // Convert to degrees, offset so "up" = 0
  let deg = (angle * 180) / Math.PI + 90;
  if (deg < 0) deg += 360;
  return degrees(deg);
}

// ---- Text decoration hit testing ----

const DECO_HANDLE_SIZE = 8;
const TEXT_APPROX_CHAR_W = 14; // approximate character width for hit testing

// Compute bounding box for a text decoration in pixel coordinates
export function getDecoBounds(text: TextDecoration, canvasSize: number): DecoBounds | null {
  if (!text.text) return null;
  const cx = text.x * canvasSize;
  const cy = text.y * canvasSize;
  const fontSize = text.size * canvasSize;
  const tw = text.text.length * TEXT_APPROX_CHAR_W * (text.size / 0.06); // scale proportionally
  const th = fontSize * 1.2;
  return { x: cx - tw / 2, y: cy - th / 2, w: tw, h: th };
}

// Hit test text decorations (back-to-front, return topmost)
export function hitTestDecorations(
  state: SigilData,
  mx: number,
  my: number,
  canvasSize: number,
): string | null {
  for (let i = state.texts.length - 1; i >= 0; i--) {
    const text = state.texts[i]!;
    const bounds = getDecoBounds(text, canvasSize);
    if (
      bounds &&
      mx >= bounds.x &&
      mx <= bounds.x + bounds.w &&
      my >= bounds.y &&
      my <= bounds.y + bounds.h
    ) {
      return text.id;
    }
  }
  return null;
}

// Hit test decoration resize handles (corner handles only)
export function hitTestDecoHandles(
  text: TextDecoration,
  mx: number,
  my: number,
  canvasSize: number,
): HandleType | null {
  const bounds = getDecoBounds(text, canvasSize);
  if (!bounds) return null;

  const corners: { x: number; y: number; type: HandleType }[] = [
    { x: bounds.x, y: bounds.y, type: 'nw' },
    { x: bounds.x + bounds.w, y: bounds.y, type: 'ne' },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h, type: 'se' },
    { x: bounds.x, y: bounds.y + bounds.h, type: 'sw' },
  ];

  for (const c of corners) {
    if (Math.abs(mx - c.x) < DECO_HANDLE_SIZE && Math.abs(my - c.y) < DECO_HANDLE_SIZE) {
      return c.type;
    }
  }
  return null;
}

// Move a text decoration by a normalized delta
export function moveDeco(text: TextDecoration, dnx: number, dny: number): void {
  text.x = normalizedCoord(text.x + dnx);
  text.y = normalizedCoord(text.y + dny);
}
