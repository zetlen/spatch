// canvas.ts — Canvas rendering pipeline

import { getFillStyle } from './colors.ts';
import { applyPattern } from './patterns.ts';
import { getDecoBounds } from './shapes.ts';
import type { Voice, TextDecoration, SigilData, WaveformType } from './types.ts';
import { waveformShape } from './types.ts';

// Offscreen canvas for blend-mode compositing. Shapes are drawn here using
// their blend modes against a transparent background so they blend with each
// other but not with the dark canvas background. The result is composited
// onto the main canvas with source-over, preserving full shape brightness.
let _blendCanvas: HTMLCanvasElement | null = null;
let _blendCtx: CanvasRenderingContext2D | null = null;

function getBlendCanvas(size: number): CanvasRenderingContext2D {
  if (!_blendCanvas || _blendCanvas.width !== size || _blendCanvas.height !== size) {
    _blendCanvas = document.createElement('canvas');
    _blendCanvas.width = size;
    _blendCanvas.height = size;
    _blendCtx = _blendCanvas.getContext('2d')!;
  }
  return _blendCtx!;
}

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

/** Convert a voice's timbre to a visual rotation angle for rendering. */
function timbreToRotation(timbre: number, waveform: WaveformType): number {
  if (waveform === 'sine') return 0;
  const period = waveform === 'pulse' ? 90 : 120;
  return Math.min(1, Math.max(0, timbre)) * period;
}

/** Get the visual rotation angle for a voice (in degrees). */
function voiceRotation(voice: Voice): number {
  if ('timbre' in voice) {
    return timbreToRotation(voice.timbre, voice.waveform);
  }
  return 0;
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: SigilData,
  canvasSize: number,
  selectedId: string | null,
  selectedDecoId?: string | null,
): void {
  ctx.clearRect(0, 0, canvasSize, canvasSize);

  drawChromaticGuides(ctx, canvasSize);

  // Draw voices onto offscreen canvas so blend modes apply between shapes
  // (not against the dark background, which would make soft-light etc. too dim).
  const bctx = getBlendCanvas(canvasSize);
  bctx.clearRect(0, 0, canvasSize, canvasSize);
  for (let i = 0; i < state.voices.length; i++) {
    const voice = state.voices[i]!;
    bctx.globalCompositeOperation = voice.blend;
    drawVoice(bctx, voice, canvasSize, voice.id === selectedId);
  }
  bctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(_blendCanvas!, 0, 0);

  for (const text of state.texts) {
    drawText(ctx, text, canvasSize);
  }

  if (selectedId) {
    const sel = state.voices.find((s) => s.id === selectedId);
    if (sel) {
      if (lastInputWasTouch) {
        drawTouchSelectionIndicator(ctx, sel, canvasSize);
      } else {
        drawSelectionHandles(ctx, sel, canvasSize);
      }
    }
  }
  if (selectedDecoId) {
    const sel = state.texts.find((d) => d.id === selectedDecoId);
    if (sel) {
      if (lastInputWasTouch) {
        drawDecoTouchSelectionIndicator(ctx, sel, canvasSize);
      } else {
        drawDecoSelectionHandles(ctx, sel, canvasSize);
      }
    }
  }
}

function drawChromaticGuides(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.save();
  ctx.lineWidth = 1;
  for (let s = 0; s <= 36; s++) {
    const y = (1 - s / 36) * size;
    const isOctave = s % 12 === 0;
    ctx.strokeStyle = isOctave ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
    ctx.setLineDash(isOctave ? [6, 8] : [4, 8]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawVoice(
  ctx: CanvasRenderingContext2D,
  voice: Voice,
  canvasSize: number,
  isSelected: boolean,
): void {
  const cx = voice.x * canvasSize;
  const cy = voice.y * canvasSize;
  const r = (voice.size / 2) * canvasSize;
  const rotDeg = voiceRotation(voice);
  const rotRad = (rotDeg * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotRad);

  buildShapePath(ctx, voice, canvasSize);
  ctx.save();
  ctx.clip();

  const fillStyle = getFillStyle(ctx, voice.fill, r, rotDeg);
  ctx.fillStyle = fillStyle;
  buildShapePath(ctx, voice, canvasSize);
  ctx.fill();

  if (voice.effect) {
    applyPattern(ctx, voice, canvasSize);
  }

  // Draw border inside the clipped shape (clip shows only the inner half
  // of edge strokes, creating a natural inset effect)
  if (voice.border) {
    const shape = waveformShape(voice.waveform);
    const maxW = r * 0.12;
    const w = Math.max(1, voice.border.thickness * maxW);
    ctx.strokeStyle = voice.border.color;

    // Outer border: stroke at shape edge, clip shows inner half
    ctx.lineWidth = w * 2;
    buildShapePathAt(ctx, shape, r);
    ctx.stroke();

    if (voice.border.double) {
      // Inner border: concentric shape inset past outer + gap
      const gap = w * 0.6;
      const innerR = r - w - gap;
      if (innerR > 0) {
        ctx.lineWidth = w;
        buildShapePathAt(ctx, shape, innerR);
        ctx.stroke();
      }
    }
  }

  ctx.restore();

  // Shape outline
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.5;
  buildShapePath(ctx, voice, canvasSize);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

export function buildShapePath(
  ctx: CanvasRenderingContext2D,
  voice: Voice,
  canvasSize: number,
): void {
  const r = (voice.size / 2) * canvasSize;
  buildShapePathAt(ctx, waveformShape(voice.waveform), r);
}

/** Build a shape path centered at origin with a given radius. */
function buildShapePathAt(
  ctx: CanvasRenderingContext2D,
  shape: 'circle' | 'square' | 'triangle',
  r: number,
): void {
  ctx.beginPath();
  switch (shape) {
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
  voice: Voice,
  canvasSize: number,
): void {
  const cx = voice.x * canvasSize;
  const cy = voice.y * canvasSize;
  const r = (voice.size / 2) * canvasSize;
  const rotDeg = voiceRotation(voice);
  const rotRad = (rotDeg * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotRad);

  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-r, -r, r * 2, r * 2);
  ctx.setLineDash([]);

  const handleSize = 5;
  const handles: [number, number][] = [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
    [0, -r],
    [r, 0],
    [0, r],
    [-r, 0],
  ];
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1;
  for (const [hx, hy] of handles) {
    ctx.fillRect(hx - handleSize, hy - handleSize, handleSize * 2, handleSize * 2);
    ctx.strokeRect(hx - handleSize, hy - handleSize, handleSize * 2, handleSize * 2);
  }

  // No rotation handle for sine voices (circles have no distinguishable rotation)
  if (voice.waveform !== 'sine') {
    const rotHandleY = -r - 25;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(0, rotHandleY);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, rotHandleY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#888888';
    ctx.fill();
    ctx.strokeStyle = '#2a2a2a';
    ctx.stroke();
  }

  ctx.restore();
}

function drawDecoSelectionHandles(
  ctx: CanvasRenderingContext2D,
  text: TextDecoration,
  canvasSize: number,
): void {
  const bounds = getDecoBounds(text, canvasSize);
  if (!bounds) return;

  ctx.save();

  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
  ctx.setLineDash([]);

  const handleSize = 5;
  const corners: [number, number][] = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.w, bounds.y],
    [bounds.x + bounds.w, bounds.y + bounds.h],
    [bounds.x, bounds.y + bounds.h],
  ];
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1;
  for (const [hx, hy] of corners) {
    ctx.fillRect(hx - handleSize, hy - handleSize, handleSize * 2, handleSize * 2);
    ctx.strokeRect(hx - handleSize, hy - handleSize, handleSize * 2, handleSize * 2);
  }

  ctx.restore();
}

function drawTouchSelectionIndicator(
  ctx: CanvasRenderingContext2D,
  voice: Voice,
  canvasSize: number,
): void {
  const cx = voice.x * canvasSize;
  const cy = voice.y * canvasSize;
  const r = (voice.size / 2) * canvasSize;
  const rotDeg = voiceRotation(voice);
  const rotRad = (rotDeg * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotRad);
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-r, -r, r * 2, r * 2);
  ctx.setLineDash([]);
  ctx.restore();
}

function drawDecoTouchSelectionIndicator(
  ctx: CanvasRenderingContext2D,
  text: TextDecoration,
  canvasSize: number,
): void {
  const bounds = getDecoBounds(text, canvasSize);
  if (!bounds) return;

  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
  ctx.setLineDash([]);
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, text: TextDecoration, canvasSize: number): void {
  if (!text.text) return;
  const fontSize = text.size * canvasSize;

  ctx.save();
  ctx.font = `${fontSize}px 'Orbitron', sans-serif`;
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.text, text.x * canvasSize, text.y * canvasSize);
  ctx.restore();
}
