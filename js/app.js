// app.js — Entry point, event wiring, render loop

import { SigilState } from './state.ts';
import { render } from './canvas.js';
import {
  hitTestShapes,
  hitTestHandles,
  hitTestADSRCorner,
  calcResize,
  calcRotation,
  clampSize,
  hitTestDecorations,
  hitTestDecoHandles,
  getDecoBounds,
} from './shapes.ts';
import { Toolbar } from './toolbar.js';
import { AudioEngine } from './audio.ts';
import { updateCanvasBorderRadius, dragToEnvelopeValue } from './envelope.ts';
import { DecorationTool } from './decorations.js';
import { saveToURL, loadFromURL } from './serialize.js';
import { generateEmbedSnippet, copyToClipboard } from './embed.js';

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
  if (audio.isPlaying) {
    audio.updateVoices(state.data);
  }
});

function renderLoop() {
  if (needsRender || audio.isPlaying) {
    render(
      ctx,
      state.data,
      CANVAS_SIZE,
      state.selectedId,
      audio.playingShapeIds,
      state.selectedDecoId,
    );

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

    updateCanvasBorderRadius(
      canvas,
      state.data.envelope,
      parseInt(canvas.style.width) || CANVAS_SIZE,
    );

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
    nx: ((e.clientX - rect.left) * scaleX) / CANVAS_SIZE,
    ny: ((e.clientY - rect.top) * scaleY) / CANVAS_SIZE,
  };
}

// ---- Interaction state ----

let interactionMode = 'idle'; // 'idle' | 'dragging' | 'resizing' | 'rotating' | 'adsr' | 'drawing' | 'arpeggio' | 'deco-dragging' | 'deco-resizing'
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
    state.selectedDecoId = null;
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
    audio._init().then(() => {
      audio._arpeggioReady = true;
    });
    audio._arpeggioReady = false;
    return;
  }

  const tool = toolbar.currentTool;

  // Decoration tools
  if (tool === 'squiggle' || tool === 'curlicue' || tool === 'text') {
    const result = decoTool.handleMouseDown(nx, ny);
    if (result) {
      if (result.placed) {
        // Curlicue / text: placed instantly — switch to select mode like shapes
        state.selectedDecoId = result.placed;
        state.selectedId = null;
        toolbar.currentTool = 'select';
        toolbar._updateToolActive();
        decoTool.setTool(null);
      } else {
        // Squiggle: drawing in progress
        interactionMode = 'drawing';
      }
      needsRender = true;
      return;
    }
  }

  // Shape placement tools
  if (tool === 'triangle' || tool === 'square' || tool === 'circle') {
    state.addShape(tool, nx, ny);
    toolbar.currentTool = 'select';
    toolbar._updateToolActive();
    decoTool.setTool(null);
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
    state.selectedDecoId = null;
    toolbar.syncToSelectedShape();
    interactionMode = 'dragging';
    preManipSnapshot = state._snapshot();
    const shape = state.getShape(hitId);
    dragOriginal = { x: shape.x, y: shape.y };
    needsRender = true;
    return;
  }

  // 4. Check resize handles on selected decoration
  const selDeco = state.getSelectedDeco();
  if (selDeco) {
    const decoHandle = hitTestDecoHandles(selDeco, px, py, CANVAS_SIZE);
    if (decoHandle) {
      interactionMode = 'deco-resizing';
      activeHandle = decoHandle;
      preManipSnapshot = state._snapshot();
      dragOriginal = {
        scale: selDeco.scale || 1,
        bounds: getDecoBounds(selDeco, CANVAS_SIZE),
        points: selDeco.type === 'squiggle' ? selDeco.points.map((p) => [...p]) : null,
      };
      return;
    }
  }

  // 5. Hit test decorations
  const hitDecoId = hitTestDecorations(state.data, px, py, CANVAS_SIZE);
  if (hitDecoId) {
    state.selectedDecoId = hitDecoId;
    state.selectedId = null;
    interactionMode = 'deco-dragging';
    preManipSnapshot = state._snapshot();
    const deco = state.getDecoration(hitDecoId);
    if (deco.type === 'squiggle') {
      dragOriginal = { points: deco.points.map((p) => [...p]) };
    } else {
      dragOriginal = { x: deco.x, y: deco.y };
    }
    needsRender = true;
    return;
  }

  // 6. Deselect
  state.selectedId = null;
  state.selectedDecoId = null;
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
    const rotRad = (shape.rotation * Math.PI) / 180;
    const dpx = px - dragStart.px;
    const dpy = py - dragStart.py;
    const cos = Math.cos(-rotRad);
    const sin = Math.sin(-rotRad);
    const localDx = dpx * cos - dpy * sin;
    const localDy = dpx * sin + dpy * cos;
    const newSize = calcResize(
      { ...shape, size: dragOriginal.size },
      activeHandle,
      localDx,
      localDy,
      CANVAS_SIZE,
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

  if (interactionMode === 'deco-dragging') {
    const deco = state.getSelectedDeco();
    if (!deco) return;
    const dnx = nx - dragStart.nx;
    const dny = ny - dragStart.ny;
    if (deco.type === 'squiggle') {
      const newPts = dragOriginal.points.map((p) => [
        Math.max(0, Math.min(1, p[0] + dnx)),
        Math.max(0, Math.min(1, p[1] + dny)),
      ]);
      state.updateDecoration(deco.id, { points: newPts });
    } else {
      state.updateDecoration(deco.id, {
        x: Math.max(0, Math.min(1, dragOriginal.x + dnx)),
        y: Math.max(0, Math.min(1, dragOriginal.y + dny)),
      });
    }
    return;
  }

  if (interactionMode === 'deco-resizing') {
    const deco = state.getSelectedDeco();
    if (!deco) return;
    const bounds = dragOriginal.bounds;
    if (!bounds) return;
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    const initDist = Math.hypot(bounds.w / 2, bounds.h / 2);
    const currDist = Math.hypot(px - cx, py - cy);
    const newScale = Math.max(0.2, Math.min(5, dragOriginal.scale * (currDist / initDist)));
    if (deco.type === 'squiggle') {
      // Scale points relative to their center
      const origPts = dragOriginal.points || deco.points;
      let sumX = 0,
        sumY = 0;
      for (const p of origPts) {
        sumX += p[0];
        sumY += p[1];
      }
      const pcx = sumX / origPts.length;
      const pcy = sumY / origPts.length;
      const ratio = newScale / dragOriginal.scale;
      const newPts = origPts.map((p) => [
        Math.max(0, Math.min(1, pcx + (p[0] - pcx) * ratio)),
        Math.max(0, Math.min(1, pcy + (p[1] - pcy) * ratio)),
      ]);
      state.updateDecoration(deco.id, { points: newPts });
    } else {
      state.updateDecoration(deco.id, { scale: newScale });
    }
    return;
  }
});

canvas.addEventListener('mouseup', () => {
  if (interactionMode === 'drawing') {
    const decoId = decoTool.handleMouseUp();
    if (decoId) {
      // Squiggle finished — switch to select mode like shapes
      state.selectedDecoId = decoId;
      state.selectedId = null;
      toolbar.currentTool = 'select';
      toolbar._updateToolActive();
      decoTool.setTool(null);
    }
    needsRender = true;
  }

  if (
    interactionMode === 'dragging' ||
    interactionMode === 'resizing' ||
    interactionMode === 'rotating' ||
    interactionMode === 'adsr' ||
    interactionMode === 'deco-dragging' ||
    interactionMode === 'deco-resizing'
  ) {
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
    const decoId = decoTool.handleMouseUp();
    if (decoId) {
      state.selectedDecoId = decoId;
      state.selectedId = null;
      toolbar.currentTool = 'select';
      toolbar._updateToolActive();
      decoTool.setTool(null);
    }
    needsRender = true;
  }
  if (interactionMode === 'arpeggio') {
    triggeredShapes.clear();
  }
});

// ---- Touch support ----

let pinchRotateState = null; // { initDist, initAngle, initSize, initRotation, shapeId }

function touchDist(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchAngle(a, b) {
  return (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;
}

canvas.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();

    if (e.touches.length === 2) {
      // Cancel any in-progress single-touch interaction
      if (interactionMode !== 'idle') {
        canvas.dispatchEvent(new MouseEvent('mouseup', {}));
      }

      const [a, b] = e.touches;
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      const rect = canvas.getBoundingClientRect();
      const px = ((midX - rect.left) * CANVAS_SIZE) / rect.width;
      const py = ((midY - rect.top) * CANVAS_SIZE) / rect.height;

      // Select shape under midpoint, or use already-selected shape
      let shapeId = hitTestShapes(state.data, px, py, CANVAS_SIZE) || state.selectedId;
      if (!shapeId) return;

      const shape = state.getShape(shapeId);
      if (!shape) return;

      state.selectedId = shapeId;
      preManipSnapshot = state._snapshot();
      pinchRotateState = {
        initDist: touchDist(a, b),
        initAngle: touchAngle(a, b),
        initSize: shape.size,
        initRotation: shape.rotation,
        shapeId,
      };
      interactionMode = 'pinch-rotate';
      needsRender = true;
      return;
    }

    const touch = e.touches[0];
    canvas.dispatchEvent(
      new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY,
        shiftKey: e.shiftKey,
      }),
    );
  },
  { passive: false },
);

canvas.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();

    if (interactionMode === 'pinch-rotate' && e.touches.length >= 2 && pinchRotateState) {
      const [a, b] = e.touches;
      const dist = touchDist(a, b);
      const angle = touchAngle(a, b);

      const scale = dist / pinchRotateState.initDist;
      const newSize = clampSize(pinchRotateState.initSize * scale);

      const angleDelta = angle - pinchRotateState.initAngle;
      const newRotation = (((pinchRotateState.initRotation + angleDelta) % 360) + 360) % 360;

      state.updateShape(pinchRotateState.shapeId, {
        size: newSize,
        rotation: Math.round(newRotation),
      });
      return;
    }

    const touch = e.touches[0];
    canvas.dispatchEvent(
      new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY,
        shiftKey: e.shiftKey,
      }),
    );
  },
  { passive: false },
);

canvas.addEventListener(
  'touchend',
  (e) => {
    e.preventDefault();

    if (interactionMode === 'pinch-rotate') {
      if (e.touches.length < 2) {
        // Commit undo snapshot
        if (preManipSnapshot) {
          state.undoStack.push(preManipSnapshot);
          if (state.undoStack.length > 50) state.undoStack.shift();
          state.redoStack.length = 0;
          preManipSnapshot = null;
        }
        pinchRotateState = null;
        interactionMode = 'idle';
        toolbar.syncToSelectedShape();
        needsRender = true;
      }
      return;
    }

    canvas.dispatchEvent(new MouseEvent('mouseup', {}));
  },
  { passive: false },
);

// ---- Clipboard for copy/paste ----

let clipboard = null; // JSON snapshot of a shape

// ---- Keyboard shortcuts ----

document.addEventListener('keydown', (e) => {
  // Don't intercept when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedId) {
      state.removeShape(state.selectedId);
    } else if (state.selectedDecoId) {
      state.removeDecoration(state.selectedDecoId);
    }
  }
  if (e.key === 'c' && mod) {
    if (state.selectedId) {
      const shape = state.getShape(state.selectedId);
      if (shape) clipboard = JSON.parse(JSON.stringify(shape));
    }
  }
  if (e.key === 'v' && mod) {
    e.preventDefault();
    if (clipboard) {
      state.pasteShape(clipboard, 0.03, 0.03);
      toolbar.syncToSelectedShape();
      needsRender = true;
    }
    return;
  }
  if (e.key === 'd' && mod) {
    e.preventDefault();
    if (state.selectedId) {
      state.duplicateShape(state.selectedId, 0, 0);
      toolbar.syncToSelectedShape();
      needsRender = true;
    }
    return;
  }
  if (e.key === 'z' && mod) {
    e.preventDefault();
    if (e.shiftKey) state.redo();
    else state.undo();
  }
  if (e.key === 'y' && mod) {
    e.preventDefault();
    state.redo();
  }
  if (e.key === 'Escape') {
    state.selectedId = null;
    state.selectedDecoId = null;
    toolbar.currentTool = 'select';
    toolbar._updateToolActive();
    decoTool.setTool(null);
    document.getElementById('text-input').classList.add('hidden');
    shareMenu.classList.add('hidden');
    needsRender = true;
  }
  if (e.key === 'v' && !mod) {
    toolbar.currentTool = 'select';
    toolbar._updateToolActive();
    decoTool.setTool(null);
  }
  if (e.key === ' ') {
    e.preventDefault();
    if (playState !== 'idle') {
      stopPlayback();
    } else if (state.data.shapes.length > 0) {
      startPlayback().then(() => {
        playState = 'latched';
      });
    }
  }
});

// ---- Play mode selector & Play button ----

const playBtn = document.getElementById('btn-play');
const canvasWrap = document.getElementById('canvas-wrap');
const playFan = document.getElementById('play-fan');
const fanLock = playFan.querySelector('.fan-lock');
const fanLoop = playFan.querySelector('.fan-loop');

let playState = 'idle'; // 'idle' | 'latched' | 'looping'
let gestureActive = false;
let gestureTimerId = null;
let gesturePointerId = null;
let lastFanInfo = null; // zone info from most recent pointermove
let loopHoldMs = 500;
let loopTimeoutId = null;
let releaseGlowTimeoutId = null;
let playGeneration = 0; // incremented on stop, checked after async audio init

async function startPlayback() {
  if (releaseGlowTimeoutId != null) {
    clearTimeout(releaseGlowTimeoutId);
    releaseGlowTimeoutId = null;
  }
  const gen = playGeneration;
  await audio.play(state.data, state.data.envelope);
  if (gen !== playGeneration) return; // cancelled during init
  playBtn.classList.add('playing');
  canvasWrap.classList.add('playing');
  playBtn.textContent = '\u25A0 STOP';
  needsRender = true;
}

function stopPlayback() {
  playGeneration++;
  if (loopTimeoutId != null) {
    clearTimeout(loopTimeoutId);
    loopTimeoutId = null;
  }
  audio.release(state.data.envelope);
  playBtn.classList.remove('playing');
  playBtn.textContent = '\u25B6 PLAY';
  playState = 'idle';
  const releaseMs = state.data.envelope.release * 1000 + 100;
  releaseGlowTimeoutId = setTimeout(() => {
    releaseGlowTimeoutId = null;
    canvasWrap.classList.remove('playing');
    needsRender = true;
  }, releaseMs);
}

function scheduleLoopRestart() {
  const env = state.data.envelope;
  const releaseMs = env.release * 1000;

  loopTimeoutId = setTimeout(() => {
    audio.release(state.data.envelope);
    loopTimeoutId = setTimeout(() => {
      if (playState === 'looping') {
        startPlayback();
        scheduleLoopRestart();
      }
    }, releaseMs + 50);
  }, loopHoldMs);
}

// ---- Play fan gesture constants ----

const LOCK_MIN = 35;
const LOCK_MAX = 70;
const LOOP_MIN = 70;
const LOOP_RANGE = 130;
const LOOP_MS_MIN = 100;
const LOOP_MS_MAX = 2000;
const FAN_DELAY_MS = 250;

function fanZone(clientY) {
  const r = playBtn.getBoundingClientRect();
  const dy = r.top + r.height / 2 - clientY;
  if (dy < LOCK_MIN) return { zone: 'button' };
  if (dy < LOCK_MAX) return { zone: 'lock' };
  const t = Math.min(1, Math.max(0, (dy - LOOP_MIN) / LOOP_RANGE));
  const ms = Math.round((LOOP_MS_MIN + t * (LOOP_MS_MAX - LOOP_MS_MIN)) / 50) * 50;
  return { zone: 'loop', ms, pull: Math.max(0, dy - LOOP_MIN) };
}

function openFan() {
  gestureActive = true;
  playFan.classList.add('open');
}

function closeFan() {
  gestureActive = false;
  lastFanInfo = null;
  playFan.classList.remove('open');
  fanLock.classList.remove('hot');
  fanLoop.classList.remove('hot', 'dragging');
  fanLoop.style.transform = '';
}

playBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();

  // If already playing (latched or looping), stop
  if (playState !== 'idle') {
    stopPlayback();
    return;
  }

  if (state.data.shapes.length === 0) return;

  gesturePointerId = e.pointerId;
  lastFanInfo = null;
  playBtn.setPointerCapture(e.pointerId);

  // Set up gesture tracking synchronously — before audio init
  gestureTimerId = setTimeout(() => {
    gestureTimerId = null;
    if (gesturePointerId != null) openFan();
  }, FAN_DELAY_MS);

  // Track early drag to open fan immediately
  const earlyMove = (me) => {
    if (me.pointerId !== gesturePointerId) return;
    const r = playBtn.getBoundingClientRect();
    const dy = r.top + r.height / 2 - me.clientY;
    if (dy > 10 && gestureTimerId != null) {
      clearTimeout(gestureTimerId);
      gestureTimerId = null;
      openFan();
      playBtn.removeEventListener('pointermove', earlyMove);
    }
  };
  playBtn.addEventListener('pointermove', earlyMove);

  // Clean up early-move listener once gesture ends
  const cleanup = () => {
    playBtn.removeEventListener('pointermove', earlyMove);
    playBtn.removeEventListener('pointerup', cleanup);
    playBtn.removeEventListener('lostpointercapture', cleanup);
  };
  playBtn.addEventListener('pointerup', cleanup, { once: true });
  playBtn.addEventListener('lostpointercapture', cleanup, { once: true });

  // Start audio (non-blocking — gesture is already wired)
  startPlayback();
});

playBtn.addEventListener('pointermove', (e) => {
  if (!gestureActive || e.pointerId !== gesturePointerId) return;

  const info = fanZone(e.clientY);
  lastFanInfo = info;

  fanLock.classList.toggle('hot', info.zone === 'lock');

  if (info.zone === 'loop') {
    fanLoop.classList.add('hot', 'dragging');
    fanLoop.style.transform = `translateY(-${info.pull}px)`;
  } else {
    fanLoop.classList.remove('hot', 'dragging');
    fanLoop.style.transform = '';
  }
});

playBtn.addEventListener('pointerup', (e) => {
  if (e.pointerId !== gesturePointerId) return;

  if (gestureTimerId != null) {
    clearTimeout(gestureTimerId);
    gestureTimerId = null;
  }

  if (!gestureActive) {
    // Quick click — normal release
    stopPlayback();
    closeFan();
    gesturePointerId = null;
    return;
  }

  // Use the last tracked zone from pointermove — avoids drift during finger lift.
  // Fall back to computing from the pointerup position if no move was recorded.
  const info = lastFanInfo || fanZone(e.clientY);

  if (info.zone === 'lock') {
    playState = 'latched';
  } else if (info.zone === 'loop') {
    loopHoldMs = info.ms;
    playState = 'looping';
    scheduleLoopRestart();
  } else {
    // Released back on button
    stopPlayback();
  }

  closeFan();
  gesturePointerId = null;
});

playBtn.addEventListener('lostpointercapture', (e) => {
  // pointerup already handled this gesture
  if (gesturePointerId == null) return;
  if (e.pointerId !== gesturePointerId) return;

  if (gestureTimerId != null) {
    clearTimeout(gestureTimerId);
    gestureTimerId = null;
  }

  if (audio.isPlaying && playState === 'idle') {
    stopPlayback();
  }
  closeFan();
  gesturePointerId = null;
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

// ---- Share menu ----

const menuBtn = document.getElementById('btn-menu');
const shareMenu = document.getElementById('share-menu');

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  shareMenu.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!shareMenu.contains(e.target) && e.target !== menuBtn) {
    shareMenu.classList.add('hidden');
  }
});

shareMenu.addEventListener('click', async (e) => {
  const item = e.target.closest('.share-menu-item');
  if (!item) return;

  const action = item.dataset.action;
  const label = item.querySelector('span');
  const originalText = label.textContent;

  if (action === 'share') {
    await copyToClipboard(window.location.href);
  } else if (action === 'embed') {
    const snippet = generateEmbedSnippet(state.data);
    await copyToClipboard(snippet);
  }

  label.textContent = 'Copied!';
  setTimeout(() => {
    label.textContent = originalText;
  }, 1500);
});

// ---- Corner position helper ----

function getCornerPosition(cornerName, size) {
  switch (cornerName) {
    case 'attack':
      return { x: 0, y: size };
    case 'decay':
      return { x: 0, y: 0 };
    case 'sustain':
      return { x: size, y: 0 };
    case 'release':
      return { x: size, y: size };
    default:
      return { x: 0, y: 0 };
  }
}
