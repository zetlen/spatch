// Shapes.ts — Resize/rotate math, ADSR corners, envelope geometry

import {
  type ADSRCorner,
  type Envelope,
  type NormalizedCoord,
  type Voice,
  normalizedCoord,
} from './types.ts';
import { get } from './voices/registry.ts';

// ---- ADSR envelope ↔ canvas geometry ----

const MAX_RADIUS_PCT = 15; // Max corner radius as percentage of canvas size

/**
 * Apply ADSR-derived corner radii (as %) to the canvas frame element and its parent wrapper.
 * @param frameEl - The canvas frame HTML element
 * @param envelope - The ADSR envelope
 * @param inset - Optional pixel inset to subtract from the radius for concentric inner borders
 */
export function updateCanvasBorderRadius(
  frameEl: HTMLElement | SVGElement,
  envelope: Envelope,
  inset: number = 0,
): void {
  const tl = ((envelope.decay / 2) * MAX_RADIUS_PCT).toFixed(2);
  const tr = ((1 - envelope.sustain) * MAX_RADIUS_PCT).toFixed(2);
  const br = ((envelope.release / 3) * MAX_RADIUS_PCT).toFixed(2);
  const bl = ((envelope.attack / 2) * MAX_RADIUS_PCT).toFixed(2);

  const borderRadius =
    inset > 0
      ? `calc(${tl}% - ${inset}px) calc(${tr}% - ${inset}px) calc(${br}% - ${inset}px) calc(${bl}% - ${inset}px)`
      : `${tl}% ${tr}% ${br}% ${bl}%`;

  frameEl.style.borderRadius = borderRadius;
}

/**
 * Convert a corner drag distance (normalized 0–1) to an ADSR parameter value.
 * Each corner has a different scale: attack/decay max at 2s, sustain at 1, release at 3s.
 * @param cornerName - Which ADSR corner is being dragged
 * @param dragDistance - Drag distance in normalized units from the corner
 * @returns Clamped envelope parameter value
 */
export function dragToEnvelopeValue(cornerName: ADSRCorner, dragDistance: number): number {
  const maxR = MAX_RADIUS_PCT / 100;
  const normalizedDist = dragDistance / maxR;

  switch (cornerName) {
    case 'attack': {
      return Math.max(0.01, Math.min(2, normalizedDist * 2));
    }
    case 'decay': {
      return Math.max(0.01, Math.min(2, normalizedDist * 2));
    }
    case 'sustain': {
      return Math.max(0, Math.min(1, 1 - normalizedDist));
    }
    case 'release': {
      return Math.max(0.01, Math.min(3, normalizedDist * 3));
    }
  }
}

// ---- Shape geometry ----

export const MIN_SIZE = 0.025;
const MAX_SIZE = 0.9;

export function clampSize(size: number): NormalizedCoord {
  return normalizedCoord(Math.max(MIN_SIZE, Math.min(MAX_SIZE, size)));
}

/** Tilt angles for stamp trigger values: A=-15°, D=0°, R=+15°. */
export const STAMP_TRIGGER_TILT: [number, number, number] = [-15, 0, 15];

const TILT_SPACING = 15; // degrees between adjacent stops
const TILT_HALF_ZONE = TILT_SPACING / 2; // 7.5°

// ---- Drag tilt override ----
//
// During rotation gestures, stamps need continuous visual tilt (for smooth
// quintic feedback) while the store holds a discrete trigger (for audio).
// This ephemeral map bridges the gap — set during drag, cleared on release.
// voiceRotation() checks it first so the renderer shows the live angle.

const dragTiltOverrides = new Map<string, number>();

export function setDragTilt(id: string, degrees: number): void {
  dragTiltOverrides.set(id, degrees);
}

export function getDragTilt(id: string): number | undefined {
  return dragTiltOverrides.get(id);
}

export function clearDragTilt(id: string): void {
  dragTiltOverrides.delete(id);
}

/** Get the visual rotation for a voice (derived from timbre, or trigger for stamps). */
export function voiceRotation(voice: Voice): number {
  if (voice.waveform === 'stamp') {
    const override = getDragTilt(voice.id);
    if (override !== undefined) {
      return override;
    }
    const trigger = 'trigger' in voice ? (voice as { trigger: number }).trigger : 1;
    return STAMP_TRIGGER_TILT[trigger] ?? 0;
  }
  const entry = get(voice.waveform);
  const timbre = 'timbre' in voice ? (voice.timbre as number) : 0;
  return Math.min(1, Math.max(0, timbre)) * entry.rotationPeriod;
}

/**
 * Quintic magnetic snap for stamp tilt. Returns continuous tilt (for visual)
 * and discrete trigger index (for audio). Same math as snapYToNote().
 */
export function snapTriggerTilt(rawDegrees: number): { tilt: number; trigger: 0 | 1 | 2 } {
  // Find nearest stop (bestIdx always in 0..2, non-null assertion is safe)
  let bestIdx = 0;
  let bestDist = Math.abs(rawDegrees - STAMP_TRIGGER_TILT[0]);
  for (let i = 1; i < STAMP_TRIGGER_TILT.length; i++) {
    const d = Math.abs(rawDegrees - STAMP_TRIGGER_TILT[i]!);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  const stopCenter = STAMP_TRIGGER_TILT[bestIdx]!;
  const offset = rawDegrees - stopCenter;
  const t = Math.max(-1, Math.min(1, offset / TILT_HALF_ZONE));

  // Quintic pull: t^5 preserves sign, creates wider sticky center than cubic
  const t2 = t * t;
  const pulled = t2 * t2 * t;

  const tilt = Math.max(
    STAMP_TRIGGER_TILT[0],
    Math.min(STAMP_TRIGGER_TILT[2]!, stopCenter + pulled * TILT_HALF_ZONE),
  );
  return { tilt, trigger: bestIdx as 0 | 1 | 2 };
}

/** Hard-snap to nearest trigger (no quintic). Used on pointer release. */
export function hardSnapTrigger(rawDegrees: number): 0 | 1 | 2 {
  let bestIdx = 0;
  let bestDist = Math.abs(rawDegrees - STAMP_TRIGGER_TILT[0]);
  for (let i = 1; i < STAMP_TRIGGER_TILT.length; i++) {
    const d = Math.abs(rawDegrees - STAMP_TRIGGER_TILT[i]!);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx as 0 | 1 | 2;
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
    { cornerX: canvasSize, cornerY: 0, r: (1 - envelope.sustain) * maxR }, // Top-right
    { cornerX: canvasSize, cornerY: canvasSize, r: (envelope.release / 3) * maxR }, // Bottom-right
    { cornerX: 0, cornerY: canvasSize, r: (envelope.attack / 2) * maxR }, // Bottom-left
  ];

  for (const { r, cornerX, cornerY } of corners) {
    if (r <= 0) {
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
