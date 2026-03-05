// Shapes.ts — Resize/rotate math, ADSR corner testing

import {
  type ADSRCorner,
  type Degrees,
  type Envelope,
  type HandleType,
  type NormalizedCoord,
  type Voice,
  degrees,
  normalizedCoord,
} from './types.ts';

const MIN_SIZE = 0.025;
const MAX_SIZE = 0.9;

export function clampSize(size: number): NormalizedCoord {
  return normalizedCoord(Math.max(MIN_SIZE, Math.min(MAX_SIZE, size)));
}

/** Get the visual rotation for a voice (derived from timbre). */
export function voiceRotation(voice: Voice): number {
  if ('timbre' in voice) {
    const period = voice.waveform === 'pulse' ? 90 : 120;
    return Math.min(1, Math.max(0, voice.timbre)) * period;
  }
  return 0;
}

// Check if a point falls in a clipped-out corner region (outside the border-radius arc).
// Used to prevent shape hit testing in areas that are visually clipped.
//
// CSS border-radius: R creates a quarter-circle arc centered INWARD from the
// Corner by R pixels — at (corner ± R, corner ± R). We test whether the point
// Is inside the corner's bounding square but outside that arc.
export function isInClippedCorner(
  envelope: Envelope,
  mx: number,
  my: number,
  canvasSize: number,
): boolean {
  const maxR = canvasSize * 0.15; // Matches MAX_RADIUS_RATIO in envelope.ts
  const corners = [
    { cornerX: 0, cornerY: 0, r: (envelope.decay / 2) * maxR }, // Top-left
    { cornerX: canvasSize, cornerY: 0, r: envelope.sustain * maxR }, // Top-right
    { cornerX: canvasSize, cornerY: canvasSize, r: (envelope.release / 3) * maxR }, // Bottom-right
    { cornerX: 0, cornerY: canvasSize, r: (envelope.attack / 2) * maxR }, // Bottom-left
  ];

  for (const { r, cornerX, cornerY } of corners) {
    if (r < 1) {
      continue;
    } // No rounding, no clipped region
    // Is the point in the corner's bounding square?
    const dx = Math.abs(mx - cornerX);
    const dy = Math.abs(my - cornerY);
    if (dx < r && dy < r) {
      // Inside the bounding square — check if outside the quarter-circle arc.
      // Arc center is inward from the corner by r in both axes.
      const arcCx = cornerX === 0 ? r : canvasSize - r;
      const arcCy = cornerY === 0 ? r : canvasSize - r;
      if ((mx - arcCx) ** 2 + (my - arcCy) ** 2 > r * r) {
        return true;
      }
    }
  }
  return false;
}

// Hit test ADSR corners. Returns corner name if mouse is near a canvas corner.
export function hitTestADSRCorner(
  envelope: Envelope,
  mx: number,
  my: number,
  canvasSize: number,
): ADSRCorner | undefined {
  const hitRadius = canvasSize * 0.08;
  const corners: { name: ADSRCorner; cx: number; cy: number }[] = [
    { cx: 0, cy: canvasSize, name: 'attack' },
    { cx: 0, cy: 0, name: 'decay' },
    { cx: canvasSize, cy: 0, name: 'sustain' },
    { cx: canvasSize, cy: canvasSize, name: 'release' },
  ];

  for (const corner of corners) {
    if (Math.hypot(mx - corner.cx, my - corner.cy) < hitRadius) {
      return corner.name;
    }
  }

  return;
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
    case 'se': {
      newR = r + ((handleType === 'se' ? 1 : -1) * (localDx + localDy)) / 2;
      break;
    }
    case 'ne':
    case 'sw': {
      newR = r + ((handleType === 'ne' ? 1 : -1) * (localDx - localDy)) / 2;
      break;
    }
    case 'n':
    case 's': {
      newR = r + (handleType === 's' ? 1 : -1) * localDy;
      break;
    }
    case 'e':
    case 'w': {
      newR = r + (handleType === 'e' ? 1 : -1) * localDx;
      break;
    }
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
  if (deg < 0) {
    deg += 360;
  }
  return degrees(deg);
}
