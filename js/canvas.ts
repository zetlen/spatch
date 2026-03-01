// canvas.ts — Canvas rendering pipeline

import { getFillStyle } from './colors.ts';
import { applyPattern } from './patterns.ts';
import { getDecoBounds } from './shapes.ts';
import type { Shape, Decoration, SigilData, DecoBounds } from './types.ts';

const CANVAS_BG = '#1a1a2e';

// Track whether the last pointer interaction was touch.
let lastInputWasTouch = false;
window.addEventListener(
  'pointerdown',
  (e) => {
    lastInputWasTouch = e.pointerType === 'touch';
  },
  true,
);

export function isLastInputTouch(): boolean {
  return lastInputWasTouch;
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: SigilData,
  canvasSize: number,
  selectedId: string | null,
  playingShapeIds: Set<string> | null,
  selectedDecoId?: string | null,
): void {
  ctx.clearRect(0, 0, canvasSize, canvasSize);

  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  drawChromaticGuides(ctx, canvasSize);

  for (let i = 0; i < state.shapes.length; i++) {
    const shape = state.shapes[i];
    const isPlaying = playingShapeIds != null && playingShapeIds.has(shape.id);
    drawShape(ctx, shape, canvasSize, shape.id === selectedId, isPlaying);
  }

  for (const deco of state.decorations) {
    drawDecoration(ctx, deco, canvasSize);
  }

  if (!lastInputWasTouch) {
    if (selectedId) {
      const sel = state.shapes.find((s) => s.id === selectedId);
      if (sel) drawSelectionHandles(ctx, sel, canvasSize);
    }
    if (selectedDecoId) {
      const sel = state.decorations.find((d) => d.id === selectedDecoId);
      if (sel) drawDecoSelectionHandles(ctx, sel, canvasSize);
    }
  }
}

function drawChromaticGuides(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.save();
  ctx.lineWidth = 1;
  for (let s = 0; s <= 36; s++) {
    const y = (1 - s / 36) * size;
    const isOctave = s % 12 === 0;
    ctx.strokeStyle = isOctave ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)';
    ctx.setLineDash(isOctave ? [6, 8] : [4, 8]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  canvasSize: number,
  isSelected: boolean,
  isPlaying: boolean,
): void {
  const cx = shape.x * canvasSize;
  const cy = shape.y * canvasSize;
  const r = (shape.size / 2) * canvasSize;
  const rotRad = (shape.rotation * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotRad);

  buildShapePath(ctx, shape, canvasSize);
  ctx.save();
  ctx.clip();

  const fillStyle = getFillStyle(ctx, shape.fill, r);
  ctx.fillStyle = fillStyle;
  buildShapePath(ctx, shape, canvasSize);
  ctx.fill();

  if (shape.pattern) {
    applyPattern(ctx, shape, canvasSize);
  }

  ctx.restore();

  const glowColor = isPlaying ? 'rgba(0, 240, 255, 0.9)' : 'rgba(255, 255, 255, 0.5)';
  const glowLayers = isPlaying
    ? [
        { width: 8, alpha: 0.15, color: '#00f0ff' },
        { width: 4, alpha: 0.3, color: '#00f0ff' },
        { width: 2, alpha: 0.7, color: '#00f0ff' },
        { width: 1, alpha: 1.0, color: '#ffffff' },
      ]
    : [
        { width: 6, alpha: 0.08, color: glowColor },
        { width: 3, alpha: 0.15, color: glowColor },
        { width: 1.5, alpha: 0.4, color: 'rgba(255,255,255,0.6)' },
      ];

  for (const layer of glowLayers) {
    ctx.save();
    ctx.globalAlpha = layer.alpha;
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = layer.width;
    if (isPlaying) {
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 15;
    }
    buildShapePath(ctx, shape, canvasSize);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  ctx.restore();
}

export function buildShapePath(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  canvasSize: number,
): void {
  const r = (shape.size / 2) * canvasSize;
  ctx.beginPath();
  switch (shape.type) {
    case 'circle':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(-r, -r, r * 2, r * 2);
      break;
    case 'triangle':
      for (let i = 0; i < 3; i++) {
        const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
  }
}

function drawSelectionHandles(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  canvasSize: number,
): void {
  const cx = shape.x * canvasSize;
  const cy = shape.y * canvasSize;
  const r = (shape.size / 2) * canvasSize;
  const rotRad = (shape.rotation * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotRad);

  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-r, -r, r * 2, r * 2);
  ctx.setLineDash([]);

  const handleSize = 5;
  const handles = [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
    [0, -r],
    [r, 0],
    [0, r],
    [-r, 0],
  ];
  ctx.fillStyle = '#00f0ff';
  ctx.strokeStyle = '#0a0a1a';
  ctx.lineWidth = 1;
  for (const [hx, hy] of handles) {
    ctx.fillRect(hx - handleSize, hy - handleSize, handleSize * 2, handleSize * 2);
    ctx.strokeRect(hx - handleSize, hy - handleSize, handleSize * 2, handleSize * 2);
  }

  if (shape.type !== 'circle') {
    const rotHandleY = -r - 25;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(0, rotHandleY);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, rotHandleY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#b44dff';
    ctx.fill();
    ctx.strokeStyle = '#0a0a1a';
    ctx.stroke();
  }

  ctx.restore();
}

function drawDecoSelectionHandles(
  ctx: CanvasRenderingContext2D,
  deco: Decoration,
  canvasSize: number,
): void {
  const bounds = getDecoBounds(deco, canvasSize);
  if (!bounds) return;

  ctx.save();

  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(255, 225, 86, 0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
  ctx.setLineDash([]);

  const handleSize = 5;
  const corners = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.w, bounds.y],
    [bounds.x + bounds.w, bounds.y + bounds.h],
    [bounds.x, bounds.y + bounds.h],
  ];
  ctx.fillStyle = '#ffe156';
  ctx.strokeStyle = '#0a0a1a';
  ctx.lineWidth = 1;
  for (const [hx, hy] of corners) {
    ctx.fillRect(hx - handleSize, hy - handleSize, handleSize * 2, handleSize * 2);
    ctx.strokeRect(hx - handleSize, hy - handleSize, handleSize * 2, handleSize * 2);
  }

  ctx.restore();
}

function drawDecoration(ctx: CanvasRenderingContext2D, deco: Decoration, canvasSize: number): void {
  switch (deco.type) {
    case 'squiggle': {
      if (deco.points.length < 2) break;
      ctx.save();
      ctx.strokeStyle = deco.strokeColor;
      ctx.lineWidth = deco.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = deco.strokeColor;
      ctx.shadowBlur = 8;

      ctx.beginPath();
      const pts = deco.points;
      ctx.moveTo(pts[0][0] * canvasSize, pts[0][1] * canvasSize);
      for (let i = 1; i < pts.length - 1; i++) {
        const midX = ((pts[i][0] + pts[i + 1][0]) / 2) * canvasSize;
        const midY = ((pts[i][1] + pts[i + 1][1]) / 2) * canvasSize;
        ctx.quadraticCurveTo(pts[i][0] * canvasSize, pts[i][1] * canvasSize, midX, midY);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last[0] * canvasSize, last[1] * canvasSize);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
      break;
    }

    case 'curlicue':
      drawCurlicue(ctx, deco, canvasSize);
      break;

    case 'text': {
      const s = deco.scale || 1;
      ctx.save();
      ctx.font = `${deco.fontSize * s}px 'Orbitron', sans-serif`;
      ctx.fillStyle = deco.strokeColor;
      ctx.shadowColor = deco.strokeColor;
      ctx.shadowBlur = 10;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(deco.text, deco.x * canvasSize, deco.y * canvasSize);
      ctx.shadowBlur = 0;
      ctx.restore();
      break;
    }
  }
}

function drawCurlicue(
  ctx: CanvasRenderingContext2D,
  deco: Decoration & { type: 'curlicue' },
  canvasSize: number,
): void {
  const cx = deco.x * canvasSize;
  const cy = deco.y * canvasSize;
  const scale = 1.2 * (deco.scale || 1);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = deco.strokeColor;
  ctx.lineWidth = deco.strokeWidth || 2;
  ctx.lineCap = 'round';
  ctx.shadowColor = deco.strokeColor;
  ctx.shadowBlur = 6;

  ctx.beginPath();
  const a = 3 * scale;
  const b = 0.15;
  for (let t = 0; t < 12; t += 0.1) {
    const r = a * Math.exp(b * t);
    const x = r * Math.cos(t);
    const y = r * Math.sin(t);
    if (t === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.restore();
}
