// patterns.ts — Visual pattern tile generators

import { type Voice, type PatternType } from './types.ts';

const cache = new Map<PatternType, HTMLCanvasElement>();

function getPatternTile(patternType: PatternType): HTMLCanvasElement | null {
  if (cache.has(patternType)) return cache.get(patternType)!;
  let tile: HTMLCanvasElement | null = null;
  switch (patternType) {
    case 'stripes':
      tile = createStripesTile();
      break;
    case 'checker':
      tile = createCheckerTile();
      break;
    case 'noise':
      tile = createNoiseTile();
      break;
    default:
      return null; // gradient is procedural
  }
  if (tile) cache.set(patternType, tile);
  return tile;
}

function createStripesTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 6;
  c.height = 6;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, 6, 3);
  return c;
}

function createCheckerTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, 4, 4);
  ctx.fillRect(4, 4, 4, 4);
  return c;
}

function createNoiseTile(): HTMLCanvasElement {
  const size = 16;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 0;
    img.data[i + 1] = 0;
    img.data[i + 2] = 0;
    img.data[i + 3] = Math.random() > 0.5 ? 76 : 0;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Apply a pattern overlay to the current clipped region
export function applyPattern(
  ctx: CanvasRenderingContext2D,
  voice: Voice,
  canvasSize: number,
): void {
  const r = (voice.size / 2) * canvasSize;
  const pattern = voice.effect;

  if (pattern === 'gradient') {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.35;
    const grad = ctx.createLinearGradient(-r, -r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = grad;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    return;
  }

  // Tile-based patterns
  const tile = getPatternTile(pattern!);
  if (!tile) return;

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = 0.5;
  const pat = ctx.createPattern(tile, 'repeat')!;
  ctx.fillStyle = pat;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}
