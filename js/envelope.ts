// envelope.ts — ADSR corner controls and visual rendering

import type { Envelope, ADSRCorner } from './types.ts';

// Maps canvas corner rounding to ADSR values
// Corners: bottom-left=attack, top-left=decay, top-right=sustain, bottom-right=release

const MAX_RADIUS_RATIO = 0.15; // max corner radius as fraction of canvas size

export interface CornerRadii {
  bottomLeft: number;
  topLeft: number;
  topRight: number;
  bottomRight: number;
}

export function envelopeToCornerRadii(envelope: Envelope, canvasSize: number): CornerRadii {
  const maxR = canvasSize * MAX_RADIUS_RATIO;
  return {
    bottomLeft: (envelope.attack / 2.0) * maxR,
    topLeft: (envelope.decay / 2.0) * maxR,
    topRight: envelope.sustain * maxR,
    bottomRight: (envelope.release / 3.0) * maxR,
  };
}

export function updateCanvasBorderRadius(
  frameEl: HTMLElement,
  envelope: Envelope,
  canvasSize: number,
): void {
  const radii = envelopeToCornerRadii(envelope, canvasSize);
  const br = `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`;
  frameEl.style.borderRadius = br;
  // Also set on the wrap so overflow: hidden clips the canvas to the rounded corners
  if (frameEl.parentElement) {
    frameEl.parentElement.style.borderRadius = br;
  }
}

// Convert a drag distance on a corner to an envelope parameter change
export function dragToEnvelopeValue(
  cornerName: ADSRCorner,
  dragDistance: number,
  canvasSize: number,
): number {
  const maxR = canvasSize * MAX_RADIUS_RATIO;
  const normalizedDist = dragDistance / maxR;

  switch (cornerName) {
    case 'attack':
      return Math.max(0.01, Math.min(2.0, normalizedDist * 2.0));
    case 'decay':
      return Math.max(0.01, Math.min(2.0, normalizedDist * 2.0));
    case 'sustain':
      return Math.max(0, Math.min(1.0, normalizedDist));
    case 'release':
      return Math.max(0.01, Math.min(3.0, normalizedDist * 3.0));
  }
}
