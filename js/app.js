// app.js — Entry point, event wiring, render loop

import { SigilState } from './state.js';
import { render } from './canvas.js';
import { hitTestShapes, hitTestHandles, hitTestADSRCorner, calcResize, calcRotation } from './shapes.js';
import { Toolbar } from './toolbar.js';
import { AudioEngine } from './audio.js';
import { updateCanvasBorderRadius, dragToEnvelopeValue } from './envelope.js';
import { DecorationTool } from './decorations.js';
import { saveToURL, loadFromURL } from './serialize.js';
import { showEmbedModal, copyToClipboard } from './embed.js';

// ---- Init ----

const canvas = document.getElementById('sigil-canvas');
const ctx = canvas.getContext('2d');
const CANVAS_SIZE = 800;

const state = new SigilState();
const toolbar = new Toolbar(state);
const audio = new AudioEngine();
const decoTool = new DecorationTool(state, canvas, CANVAS_SIZE);

// ---- Check for saved state in URL ----

const loaded = loadFromURL();
if (loaded) {
  state.loadState(loaded);
}

// ---- Responsive canvas sizing ----

function resizeCanvas() {
  const area = document.getElementById('canvas-area');
  const maxH = area.clientHeight - 24;
  const maxW = area.clientWidth - 24;
  const size = Math.min(maxH, maxW, 800);

  const wrap = document.getElementById('canvas-wrap');
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';

  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  // Keep internal resolution at 800 for crisp rendering
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;

  updateCanvasBorderRadius(canvas, state.data.envelope, size);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ---- Render loop ----

let needsRender = true;

state.onChange(() => {
  needsRender = true;
  debouncedSave();
});

function renderLoop() {
  if (needsRender || audio.isPlaying) {
    render(ctx, state.data, CANVAS_SIZE, state.selectedId, audio.playingShapeIds);

    // Draw live squiggle preview
    const drawingPts = decoTool.getDrawingPoints();
    if (drawingPts && drawingPts.length >= 2) {
      ctx.save();
      ctx.strokeStyle = 'hsl(320, 100%, 60%)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'hsl(320, 100%, 60%)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(drawingPts[0][0] * CANVAS_SIZE, drawingPts[0][1] * CANVAS_SIZE);
      for (let i = 1; i < drawingPts.length; i++) {
        ctx.lineTo(drawingPts[i][0] * CANVAS_SIZE, drawingPts[i][1] * CANVAS_SIZE);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    updateCanvasBorderRadius(canvas, state.data.envelope,
      parseInt(canvas.style.width) || CANVAS_SIZE);

    needsRender = false;
  }
  requestAnimationFrame(renderLoop);
}
renderLoop();

// ---- Mouse → canvas coordinate transform ----

function canvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = CANVAS_SIZE / rect.width;
  const scaleY = CANVAS_SIZE / rect.height;
  return {
    px: (e.clientX - rect.left) * scaleX,
    py: (e.clientY - rect.top) * scaleY,
    nx: (e.clientX - rect.left) * scaleX / CANVAS_SIZE,
    ny: (e.clientY - rect.top) * scaleY / CANVAS_SIZE,
  };
}

// ---- Interaction state ----

let interactionMode = 'idle'; // 'idle' | 'dragging' | 'resizing' | 'rotating' | 'adsr' | 'drawing' | 'arpeggio'
let dragStart = { px: 0, py: 0, nx: 0, ny: 0 };
let dragOriginal = null;
let preManipSnapshot = null; // snapshot of full state before a drag/resize/rotate
let activeHandle = null;
let activeADSRCorner = null;
let triggeredShapes = new Set(); // for arpeggio mode

// ---- Tool change callback ----

toolbar.onToolChange = (tool) => {
  if (tool === 'squiggle' || tool === 'curlicue' || tool === 'text') {
    decoTool.setTool(tool);
    state.selectedId = null;
    needsRender = true;
  } else {
    decoTool.setTool(null);
  }
};

// ---- Mouse events ----

canvas.addEventListener('mousedown', (e) => {
  const { px, py, nx, ny } = canvasCoords(e);
  dragStart = { px, py, nx, ny };

  // Arpeggio: shift+drag across canvas
  if (e.shiftKey && state.data.shapes.length > 0 && toolbar.currentTool === 'select') {
    interactionMode = 'arpeggio';
    triggeredShapes.clear();
    audio._init().then(() => { audio._arpeggioReady = true; });
    audio._arpeggioReady = false;
    return;
  }

  const tool = toolbar.currentTool;

  // Decoration tools
  if (tool === 'squiggle' || tool === 'curlicue' || tool === 'text') {
    if (decoTool.handleMouseDown(nx, ny)) {
      interactionMode = 'drawing';
      needsRender = true;
      return;
    }
  }

  // Shape placement tools
  if (tool === 'triangle' || tool === 'square' || tool === 'circle') {
    state.addShape(tool, nx, ny);
    toolbar.syncToSelectedShape();
    needsRender = true;
    return;
  }

  // Select mode
  // 1. Check ADSR corners
  const adsrCorner = hitTestADSRCorner(state.data.envelope, px, py, CANVAS_SIZE);
  if (adsrCorner) {
    interactionMode = 'adsr';
    activeADSRCorner = adsrCorner;
    preManipSnapshot = state._snapshot();
    dragOriginal = { ...state.data.envelope };
    return;
  }

  // 2. Check handles on selected shape
  const selShape = state.getSelected();
  if (selShape) {
    const handle = hitTestHandles(selShape, px, py, CANVAS_SIZE);
    if (handle === 'rotate') {
      interactionMode = 'rotating';
      preManipSnapshot = state._snapshot();
      dragOriginal = { rotation: selShape.rotation };
      return;
    }
    if (handle) {
      interactionMode = 'resizing';
      activeHandle = handle;
      preManipSnapshot = state._snapshot();
      dragOriginal = { size: selShape.size };
      return;
    }
  }

  // 3. Hit test shapes
  const hitId = hitTestShapes(state.data, px, py, CANVAS_SIZE);
  if (hitId) {
    state.selectedId = hitId;
    toolbar.syncToSelectedShape();
    interactionMode = 'dragging';
    preManipSnapshot = state._snapshot();
    const shape = state.getShape(hitId);
    dragOriginal = { x: shape.x, y: shape.y };
    needsRender = true;
    return;
  }

  // 4. Deselect
  state.selectedId = null;
  needsRender = true;
});

canvas.addEventListener('mousemove', (e) => {
  const { px, py, nx, ny } = canvasCoords(e);

  if (interactionMode === 'drawing') {
    decoTool.handleMouseMove(nx, ny);
    needsRender = true;
    return;
  }

  if (interactionMode === 'dragging') {
    const shape = state.getSelected();
    if (!shape) return;
    const dx = nx - dragStart.nx;
    const dy = ny - dragStart.ny;
    state.updateShape(shape.id, {
      x: Math.max(0, Math.min(1, dragOriginal.x + dx)),
      y: Math.max(0, Math.min(1, dragOriginal.y + dy)),
    });
    return;
  }

  if (interactionMode === 'resizing') {
    const shape = state.getSelected();
    if (!shape) return;
    // Transform delta to shape-local coordinates
    const rotRad = shape.rotation * Math.PI / 180;
    const dpx = px - dragStart.px;
    const dpy = py - dragStart.py;
    const cos = Math.cos(-rotRad);
    const sin = Math.sin(-rotRad);
    const localDx = dpx * cos - dpy * sin;
    const localDy = dpx * sin + dpy * cos;
    const newSize = calcResize(
      { ...shape, size: dragOriginal.size },
      activeHandle, localDx, localDy, CANVAS_SIZE
    );
    state.updateShape(shape.id, { size: newSize });
    return;
  }

  if (interactionMode === 'rotating') {
    const shape = state.getSelected();
    if (!shape) return;
    const rotation = calcRotation(shape, px, py, CANVAS_SIZE);
    state.updateShape(shape.id, { rotation });
    return;
  }

  if (interactionMode === 'adsr') {
    // Drag distance from corner determines value
    const cornerPos = getCornerPosition(activeADSRCorner, CANVAS_SIZE);
    const dist = Math.hypot(px - cornerPos.x, py - cornerPos.y);
    const val = dragToEnvelopeValue(activeADSRCorner, dist, CANVAS_SIZE);
    state.updateEnvelope({ [activeADSRCorner]: val });
    return;
  }

  if (interactionMode === 'arpeggio') {
    if (!audio._arpeggioReady) return;
    // Trigger shapes as pointer crosses their X position
    for (const shape of state.data.shapes) {
      const shapePx = shape.x * CANVAS_SIZE;
      if (!triggeredShapes.has(shape.id) && Math.abs(px - shapePx) < 20) {
        triggeredShapes.add(shape.id);
        audio.triggerArpeggio(state.data, state.data.envelope, shape.id);
        needsRender = true;
      }
    }
    return;
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (interactionMode === 'drawing') {
    decoTool.handleMouseUp();
    needsRender = true;
  }

  if (interactionMode === 'dragging' || interactionMode === 'resizing' || interactionMode === 'rotating' || interactionMode === 'adsr') {
    // Push the pre-manipulation snapshot onto the undo stack
    if (preManipSnapshot) {
      state.undoStack.push(preManipSnapshot);
      if (state.undoStack.length > 50) state.undoStack.shift();
      state.redoStack.length = 0;
      preManipSnapshot = null;
    }
  }

  interactionMode = 'idle';
  activeHandle = null;
  activeADSRCorner = null;
  dragOriginal = null;
  triggeredShapes.clear();
});

canvas.addEventListener('mouseleave', () => {
  if (interactionMode === 'drawing') {
    decoTool.handleMouseUp();
    needsRender = true;
  }
  if (interactionMode === 'arpeggio') {
    triggeredShapes.clear();
  }
});

// ---- Touch support ----

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  canvas.dispatchEvent(new MouseEvent('mousedown', {
    clientX: touch.clientX, clientY: touch.clientY,
  }));
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  canvas.dispatchEvent(new MouseEvent('mousemove', {
    clientX: touch.clientX, clientY: touch.clientY,
  }));
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  canvas.dispatchEvent(new MouseEvent('mouseup', {}));
}, { passive: false });

// ---- Keyboard shortcuts ----

document.addEventListener('keydown', (e) => {
  // Don't intercept when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedId) {
      state.removeShape(state.selectedId);
    }
  }
  if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (e.shiftKey) state.redo();
    else state.undo();
  }
  if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    state.redo();
  }
  if (e.key === 'Escape') {
    state.selectedId = null;
    toolbar.currentTool = 'select';
    toolbar._updateToolActive();
    decoTool.setTool(null);
    document.getElementById('text-input').classList.add('hidden');
    needsRender = true;
  }
  if (e.key === 'v') {
    toolbar.currentTool = 'select';
    toolbar._updateToolActive();
    decoTool.setTool(null);
  }
});

// ---- Play button ----

const playBtn = document.getElementById('btn-play');

playBtn.addEventListener('mousedown', async (e) => {
  e.preventDefault();
  if (state.data.shapes.length === 0) return;

  await audio.play(state.data, state.data.envelope);
  playBtn.classList.add('playing');
  playBtn.textContent = '■ STOP';
  needsRender = true;
});

playBtn.addEventListener('mouseup', () => {
  if (audio.isPlaying) {
    audio.release(state.data.envelope);
    playBtn.classList.remove('playing');
    playBtn.innerHTML = '&#9654; PLAY';
    setTimeout(() => { needsRender = true; }, state.data.envelope.release * 1000 + 100);
  }
});

// ---- Share button ----

document.getElementById('btn-share').addEventListener('click', () => {
  saveToURL(state.data);
  copyToClipboard(window.location.href).then(() => {
    const btn = document.getElementById('btn-share');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Share'; }, 2000);
  });
});

// ---- Embed button ----

document.getElementById('btn-embed').addEventListener('click', () => {
  saveToURL(state.data);
  showEmbedModal(state.data);
});

// ---- Auto-save to URL (debounced) ----

let saveTimeout = null;
function debouncedSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (state.data.shapes.length > 0 || state.data.decorations.length > 0) {
      saveToURL(state.data);
    }
  }, 1000);
}

// ---- Corner position helper ----

function getCornerPosition(cornerName, size) {
  switch (cornerName) {
    case 'attack':  return { x: 0, y: size };
    case 'decay':   return { x: 0, y: 0 };
    case 'sustain': return { x: size, y: 0 };
    case 'release': return { x: size, y: size };
    default:        return { x: 0, y: 0 };
  }
}
