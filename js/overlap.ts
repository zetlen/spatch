// overlap.ts — Rasterized shape-vs-shape overlap detection.
//
// Draws voice shapes onto a small OffscreenCanvas and checks for pixel
// intersection. Pixel-faithful for all shape types including rotated
// triangles, astroids, and stamp hulls. Runs on pointer release and
// after voice add/remove/load — not during continuous drags.

import type { Voice } from './types.ts';
import { voiceRotation } from './shapes.ts';
import { getStample } from './stamples/index.ts';
import { computeOverlap } from './effects.ts';

/** Resolution of the overlap raster. 64×64 = 4096 pixels — fast to check. */
const RES = 64;

// Reusable canvas and context (avoids allocation per check).
let _canvas: OffscreenCanvas | undefined;
let _ctx: OffscreenCanvasRenderingContext2D | undefined;

function getCtx(): OffscreenCanvasRenderingContext2D {
  if (!_ctx) {
    _canvas = new OffscreenCanvas(RES, RES);
    _ctx = _canvas.getContext('2d', { willReadFrequently: true })!;
  }
  return _ctx;
}

// ---- Shape drawing on Canvas2D ----

const KAPPA = 0.4; // Astroid bezier control-point ratio (matches ui.ts)

function drawShape(ctx: OffscreenCanvasRenderingContext2D, voice: Voice): void {
  const cx = voice.x as number;
  const cy = voice.y as number;
  const r = (voice.size as number) / 2;
  const rot = (voiceRotation(voice) * Math.PI) / 180;

  ctx.beginPath();

  switch (voice.waveform) {
    case 'sine':
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;

    case 'pulse': {
      // Rotated rectangle: size × size centered on (cx, cy)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.rect(-r, -r, voice.size as number, voice.size as number);
      ctx.restore();
      break;
    }

    case 'blend': {
      // Equilateral triangle inscribed in circle of radius r, rotated
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      for (let i = 0; i < 3; i++) {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        const px = r * Math.cos(angle);
        const py = r * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.restore();
      break;
    }

    case 'astroid': {
      // 4-pointed star with cubic bezier curves, rotated
      const k = r * KAPPA;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.moveTo(r, 0);
      ctx.bezierCurveTo(k, 0, 0, -k, 0, -r);
      ctx.bezierCurveTo(0, -k, -k, 0, -r, 0);
      ctx.bezierCurveTo(-k, 0, 0, k, 0, r);
      ctx.bezierCurveTo(0, k, k, 0, r, 0);
      ctx.closePath();
      ctx.restore();
      break;
    }

    case 'stamp': {
      // Stamp hull path — parse the SVG path `d` string and draw on canvas
      const stampIdx = 'stamp' in voice ? (voice as { stamp: number }).stamp : 0;
      const stample = getStample(stampIdx);
      const vb = stample.svg.viewBox.split(' ').map(Number);
      const [vx, vy, vw, vh] = vb;
      const scale = Math.min((voice.size as number) / vw!, (voice.size as number) / vh!);
      const tx = (voice.x as number) - r + ((voice.size as number) - vw! * scale) / 2 - vx! * scale;
      const ty = (voice.y as number) - r + ((voice.size as number) - vh! * scale) / 2 - vy! * scale;

      ctx.save();
      // Apply stamp tilt rotation
      if (rot !== 0) {
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.translate(-cx, -cy);
      }
      drawSvgPath(ctx, stample.hull, scale, tx, ty);
      ctx.restore();
      break;
    }
  }

  ctx.fill();
}

/** Parse a simplified SVG path (M, L, C, Z commands) and draw it on Canvas2D. */
function drawSvgPath(
  ctx: OffscreenCanvasRenderingContext2D,
  d: string,
  scale: number,
  tx: number,
  ty: number,
): void {
  const nums: number[] = [];
  for (const m of d.matchAll(/-?\d+\.?\d*/g)) {
    nums.push(parseFloat(m[0]));
  }

  let i = 0;
  const cmds = d.match(/[MLCZmlcz]/g) ?? [];

  ctx.beginPath();
  for (const cmd of cmds) {
    switch (cmd) {
      case 'M':
        ctx.moveTo(nums[i]! * scale + tx, nums[i + 1]! * scale + ty);
        i += 2;
        break;
      case 'L':
        ctx.lineTo(nums[i]! * scale + tx, nums[i + 1]! * scale + ty);
        i += 2;
        break;
      case 'C':
        ctx.bezierCurveTo(
          nums[i]! * scale + tx,
          nums[i + 1]! * scale + ty,
          nums[i + 2]! * scale + tx,
          nums[i + 3]! * scale + ty,
          nums[i + 4]! * scale + tx,
          nums[i + 5]! * scale + ty,
        );
        i += 6;
        break;
      case 'Z':
        ctx.closePath();
        break;
    }
  }
}

// ---- Pairwise overlap check ----

/** Whether OffscreenCanvas is available (browser: yes, Bun/Node tests: no). */
const HAS_OFFSCREEN_CANVAS = typeof OffscreenCanvas !== 'undefined';

/** Center-distance fallback for non-browser environments (tests). */
function shapesOverlapFallback(a: Voice, b: Voice): boolean {
  return (
    computeOverlap(
      a.x as number,
      a.y as number,
      a.size as number,
      b.x as number,
      b.y as number,
      b.size as number,
    ) > 0
  );
}

/** Check if two voices' shapes visually overlap using rasterized pixel test. */
function shapesOverlap(a: Voice, b: Voice): boolean {
  if (!HAS_OFFSCREEN_CANVAS) return shapesOverlapFallback(a, b);
  // Bounding box pre-filter (circle-based, generous)
  const dist = Math.hypot((a.x as number) - (b.x as number), (a.y as number) - (b.y as number));
  if (dist > ((a.size as number) + (b.size as number)) / 2) return false;

  // Compute the bounding box intersection in normalized coordinates
  const ar = (a.size as number) / 2;
  const br = (b.size as number) / 2;
  const minX = Math.max((a.x as number) - ar, (b.x as number) - br);
  const maxX = Math.min((a.x as number) + ar, (b.x as number) + br);
  const minY = Math.max((a.y as number) - ar, (b.y as number) - br);
  const maxY = Math.min((a.y as number) + ar, (b.y as number) + br);
  if (minX >= maxX || minY >= maxY) return false;

  // Pad slightly to avoid edge-of-pixel misses
  const pad = Math.max(maxX - minX, maxY - minY) * 0.05;
  const x0 = minX - pad;
  const y0 = minY - pad;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;

  const ctx = getCtx();
  ctx.clearRect(0, 0, RES, RES);

  // Map the intersection region to canvas coordinates
  ctx.save();
  ctx.setTransform(RES / w, 0, 0, RES / h, -x0 * (RES / w), -y0 * (RES / h));

  // Draw shape A
  ctx.fillStyle = '#f00';
  drawShape(ctx, a);

  // Draw shape B with source-in: only keeps pixels where A already exists
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#00f';
  drawShape(ctx, b);

  ctx.restore();

  // Check if any pixel has alpha > 0
  const data = ctx.getImageData(0, 0, RES, RES).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! > 0) return true;
  }
  return false;
}

// ---- Public API ----

/**
 * Compute which voices visually overlap using rasterized pixel tests.
 * Returns the set of voice IDs that overlap with at least one other voice.
 */
export function computeOverlappingVoices(voices: readonly Voice[]): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < voices.length; i++) {
    for (let j = i + 1; j < voices.length; j++) {
      if (shapesOverlap(voices[i]!, voices[j]!)) {
        result.add(voices[i]!.id);
        result.add(voices[j]!.id);
      }
    }
  }
  return result;
}
