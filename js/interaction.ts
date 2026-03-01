// interaction.ts — Typed interaction state machine
//
// Replaces the scattered interactionMode/dragOriginal/activeHandle/etc.
// variables with a single discriminated union. Each mode carries its own
// data — no more accessing fields that might not exist.

import type { HandleType, ADSRCorner, Envelope, DecoBounds } from './types.ts';

export type InteractionState =
  | { mode: 'idle' }
  | { mode: 'placing' }
  | { mode: 'drawing' }
  | { mode: 'dragging'; origin: { x: number; y: number }; startNx: number; startNy: number }
  | {
      mode: 'resizing';
      handle: HandleType;
      origin: { size: number };
      startPx: number;
      startPy: number;
    }
  | { mode: 'rotating' }
  | { mode: 'adsr'; corner: ADSRCorner; origin: Envelope }
  | { mode: 'arpeggio'; triggered: Set<string> }
  | {
      mode: 'deco-dragging';
      origin: { points: number[][] } | { x: number; y: number };
      startNx: number;
      startNy: number;
    }
  | {
      mode: 'deco-resizing';
      handle: HandleType;
      origin: { scale: number; bounds: DecoBounds; points: number[][] | null };
    }
  | {
      mode: 'pinch-rotate';
      initDist: number;
      initAngle: number;
      initSize: number;
      initRotation: number;
      shapeId: string;
    };

export const IDLE: InteractionState = { mode: 'idle' };

/** Returns true if the given state is one where undo was already captured at entry. */
export function isManipulating(state: InteractionState): boolean {
  switch (state.mode) {
    case 'dragging':
    case 'resizing':
    case 'rotating':
    case 'adsr':
    case 'deco-dragging':
    case 'deco-resizing':
    case 'pinch-rotate':
      return true;
    default:
      return false;
  }
}
