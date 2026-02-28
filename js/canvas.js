// canvas.js — Canvas rendering pipeline

import { getFillStyle } from './colors.js';
import { applyPattern } from './patterns.js';

const CANVAS_BG = '#1a1a2e';

export function render(ctx, state, canvasSize, selectedId, playingShapeIds) {
  ctx.clearRect(0, 0, canvasSize, canvasSize);

  // Background
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  // Subtle grid for placement guidance
  drawGrid(ctx, canvasSize);

  // ADSR corner arcs
  drawADSRCorners(ctx, canvasSize, state.envelope);

  // Shapes (back to front)
  for (let i = 0; i < state.shapes.length; i++) {
    const shape = state.shapes[i];
    const isPlaying = playingShapeIds && playingShapeIds.has(shape.id);
    drawShape(ctx, shape, canvasSize, shape.id === selectedId, isPlaying);
  }

  // Decorations
  for (const deco of state.decorations) {
    drawDecoration(ctx, deco, canvasSize);
  }

  // Selection handles
  if (selectedId) {
    const sel = state.shapes.find(s => s.id === selectedId);
    if (sel) drawSelectionHandles(ctx, sel, canvasSize);
  }
}

function drawGrid(ctx, size) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  const step = size / 16;
  for (let i = 1; i < 16; i++) {
    const p = i * step;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  ctx.restore();
}

export function drawADSRCorners(ctx, size, envelope) {
  const maxR = size * 0.15;
  const corners = [
    { x: 0,    y: size, param: 'attack',  val: envelope.attack / 2.0 },   // bottom-left
    { x: 0,    y: 0,    param: 'decay',   val: envelope.decay / 2.0 },    // top-left
    { x: size, y: 0,    param: 'sustain', val: envelope.sustain },         // top-right
    { x: size, y: size, param: 'release', val: envelope.release / 3.0 },   // bottom-right
  ];

  ctx.save();
  for (const corner of corners) {
    const r = corner.val * maxR;
    if (r < 2) continue;

    // Determine arc angles based on corner position
    let startAngle, endAngle;
    if (corner.x === 0 && corner.y === size) {      // bottom-left
      startAngle = -Math.PI / 2; endAngle = 0;
      ctx.save(); ctx.translate(corner.x + r, corner.y - r);
    } else if (corner.x === 0 && corner.y === 0) {  // top-left
      startAngle = 0; endAngle = Math.PI / 2;
      ctx.save(); ctx.translate(corner.x + r, corner.y + r);
    } else if (corner.x === size && corner.y === 0) { // top-right
      startAngle = Math.PI / 2; endAngle = Math.PI;
      ctx.save(); ctx.translate(corner.x - r, corner.y + r);
    } else {                                           // bottom-right
      startAngle = Math.PI; endAngle = Math.PI * 1.5;
      ctx.save(); ctx.translate(corner.x - r, corner.y - r);
    }

    // Glow arc
    ctx.beginPath();
    ctx.arc(0, 0, r, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Handle dot
    const midAngle = (startAngle + endAngle) / 2;
    ctx.beginPath();
    ctx.arc(Math.cos(midAngle) * r, Math.sin(midAngle) * r, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00f0ff';
    ctx.fill();

    ctx.restore();
  }
  ctx.restore();
}

function drawShape(ctx, shape, canvasSize, isSelected, isPlaying) {
  const cx = shape.x * canvasSize;
  const cy = shape.y * canvasSize;
  const r = (shape.size / 2) * canvasSize;
  const rotRad = shape.rotation * Math.PI / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotRad);

  // Build clip path
  buildShapePath(ctx, shape, canvasSize);
  ctx.save();
  ctx.clip();

  // Fill
  const fillStyle = getFillStyle(ctx, shape.fill, r);
  ctx.fillStyle = fillStyle;
  buildShapePath(ctx, shape, canvasSize);
  ctx.fill();

  // Pattern overlay
  if (shape.pattern) {
    applyPattern(ctx, shape, canvasSize);
  }

  ctx.restore(); // un-clip

  // Neon outline glow
  const glowColor = isPlaying ? 'rgba(0, 240, 255, 0.9)' : 'rgba(255, 255, 255, 0.5)';
  const glowLayers = isPlaying ? [
    { width: 8, alpha: 0.15, color: '#00f0ff' },
    { width: 4, alpha: 0.3, color: '#00f0ff' },
    { width: 2, alpha: 0.7, color: '#00f0ff' },
    { width: 1, alpha: 1.0, color: '#ffffff' },
  ] : [
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

  ctx.restore(); // un-translate/rotate
}

export function buildShapePath(ctx, shape, canvasSize) {
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
        const angle = (i * 2 * Math.PI / 3) - Math.PI / 2;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
  }
}

function drawSelectionHandles(ctx, shape, canvasSize) {
  const cx = shape.x * canvasSize;
  const cy = shape.y * canvasSize;
  const r = (shape.size / 2) * canvasSize;
  const rotRad = shape.rotation * Math.PI / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotRad);

  // Bounding box
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-r, -r, r * 2, r * 2);
  ctx.setLineDash([]);

  // Corner resize handles
  const handleSize = 5;
  const handles = [
    [-r, -r], [r, -r], [r, r], [-r, r],         // corners
    [0, -r], [r, 0], [0, r], [-r, 0],            // midpoints
  ];
  ctx.fillStyle = '#00f0ff';
  ctx.strokeStyle = '#0a0a1a';
  ctx.lineWidth = 1;
  for (const [hx, hy] of handles) {
    ctx.fillRect(hx - handleSize, hy - handleSize, handleSize * 2, handleSize * 2);
    ctx.strokeRect(hx - handleSize, hy - handleSize, handleSize * 2, handleSize * 2);
  }

  // Rotation handle (above shape)
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

  ctx.restore();
}

function drawDecoration(ctx, deco, canvasSize) {
  if (deco.type === 'squiggle' && deco.points.length >= 2) {
    ctx.save();
    ctx.strokeStyle = deco.strokeColor;
    ctx.lineWidth = deco.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Neon glow
    ctx.shadowColor = deco.strokeColor;
    ctx.shadowBlur = 8;

    ctx.beginPath();
    const pts = deco.points;
    ctx.moveTo(pts[0][0] * canvasSize, pts[0][1] * canvasSize);
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i][0] + pts[i + 1][0]) / 2 * canvasSize;
      const midY = (pts[i][1] + pts[i + 1][1]) / 2 * canvasSize;
      ctx.quadraticCurveTo(
        pts[i][0] * canvasSize, pts[i][1] * canvasSize,
        midX, midY
      );
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0] * canvasSize, last[1] * canvasSize);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  if (deco.type === 'curlicue') {
    drawCurlicue(ctx, deco, canvasSize);
  }

  if (deco.type === 'text' && deco.text) {
    ctx.save();
    ctx.font = `${deco.fontSize || 24}px 'Orbitron', sans-serif`;
    ctx.fillStyle = deco.strokeColor;
    ctx.shadowColor = deco.strokeColor;
    ctx.shadowBlur = 10;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(deco.text, deco.x * canvasSize, deco.y * canvasSize);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

function drawCurlicue(ctx, deco, canvasSize) {
  const cx = deco.x * canvasSize;
  const cy = deco.y * canvasSize;
  const scale = 1.2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = deco.strokeColor;
  ctx.lineWidth = deco.strokeWidth || 2;
  ctx.lineCap = 'round';
  ctx.shadowColor = deco.strokeColor;
  ctx.shadowBlur = 6;

  // Logarithmic spiral
  ctx.beginPath();
  const a = 3 * scale;
  const b = 0.15;
  for (let t = 0; t < 12; t += 0.1) {
    const r = a * Math.exp(b * t);
    const x = r * Math.cos(t);
    const y = r * Math.sin(t);
    t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.restore();
}
