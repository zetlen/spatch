// canvas.ts — Canvas rendering pipeline

import { getFillStyle } from './colors.ts';
import { applyPattern } from './patterns.ts';
import { getDecoBounds } from './shapes.ts';
import type { Voice, TextDecoration, SigilData, WaveformType } from './types.ts';
import { waveformShape } from './types.ts';

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
  playingShapeIds: Set<string> | null,
  selectedDecoId?: string | null,
): void {
  ctx.clearRect(0, 0, canvasSize, canvasSize);

  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  drawChromaticGuides(ctx, canvasSize);

  for (let i = 0; i < state.voices.length; i++) {
    const voice = state.voices[i]!;
    const isPlaying = playingShapeIds != null && playingShapeIds.has(voice.id);
    ctx.globalCompositeOperation = voice.blend;
    drawVoice(ctx, voice, canvasSize, voice.id === selectedId, isPlaying);
  }
  ctx.globalCompositeOperation = 'source-over';

  for (const text of state.texts) {
    drawText(ctx, text, canvasSize);
  }

  if (!lastInputWasTouch) {
    if (selectedId) {
      const sel = state.voices.find((s) => s.id === selectedId);
      if (sel) drawSelectionHandles(ctx, sel, canvasSize);
    }
    if (selectedDecoId) {
      const sel = state.texts.find((d) => d.id === selectedDecoId);
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

function drawVoice(
  ctx: CanvasRenderingContext2D,
  voice: Voice,
  canvasSize: number,
  isSelected: boolean,
  isPlaying: boolean,
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

  const fillStyle = getFillStyle(ctx, voice.fill, r);
  ctx.fillStyle = fillStyle;
  buildShapePath(ctx, voice, canvasSize);
  ctx.fill();

  if (voice.effect) {
    applyPattern(ctx, voice, canvasSize);
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
    buildShapePath(ctx, voice, canvasSize);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  ctx.restore();
}

export function buildShapePath(
  ctx: CanvasRenderingContext2D,
  voice: Voice,
  canvasSize: number,
): void {
  const r = (voice.size / 2) * canvasSize;
  const shape = waveformShape(voice.waveform);
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
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
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
  ctx.fillStyle = '#00f0ff';
  ctx.strokeStyle = '#0a0a1a';
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
  text: TextDecoration,
  canvasSize: number,
): void {
  const bounds = getDecoBounds(text, canvasSize);
  if (!bounds) return;

  ctx.save();

  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(255, 225, 86, 0.5)';
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
  ctx.fillStyle = '#ffe156';
  ctx.strokeStyle = '#0a0a1a';
  ctx.lineWidth = 1;
  for (const [hx, hy] of corners) {
    ctx.fillRect(hx - handleSize, hy - handleSize, handleSize * 2, handleSize * 2);
    ctx.strokeRect(hx - handleSize, hy - handleSize, handleSize * 2, handleSize * 2);
  }

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
