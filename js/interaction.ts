// Interaction.ts — Typed interaction state machine
//
// Replaces the scattered interactionMode/dragOriginal/activeHandle/etc.
// Variables with a single discriminated union. Each mode carries its own
// Data — no more accessing fields that might not exist.

import type { ADSRCorner, DecoBounds, Envelope, HandleType } from './types.ts';

export type InteractionState =
  | { mode: 'idle' }
  | {
      mode: 'dragging';
      pointerId: number;
      origin: { x: number; y: number };
      startNx: number;
      startNy: number;
    }
  | {
      mode: 'resizing';
      pointerId: number;
      handle: HandleType;
      origin: { size: number };
      startPx: number;
      startPy: number;
    }
  | { mode: 'rotating'; pointerId: number }
  | {
      mode: 'adsr';
      pointerId: number;
      corner: ADSRCorner;
      origin: Envelope;
      startPx: number;
      startPy: number;
    }
  | {
      mode: 'deco-dragging';
      pointerId: number;
      origin: { x: number; y: number };
      startNx: number;
      startNy: number;
    }
  | {
      mode: 'deco-resizing';
      pointerId: number;
      handle: HandleType;
      origin: { size: number; bounds: DecoBounds };
    }
  | {
      mode: 'pinch-rotate';
      pointerA: number;
      pointerB: number;
      positions: Map<number, { x: number; y: number }>;
      initDist: number;
      initAngle: number;
      initSize: number;
      initRotation: number;
      shapeId: string;
    };

export const IDLE: InteractionState = { mode: 'idle' };
