// app.ts — Entry point, event wiring, render loop

import { SigilStore, UndoManager } from './state.ts';
import { render } from './canvas.ts';
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
import { Toolbar } from './toolbar.ts';
import { AudioEngine } from './audio.ts';
import { updateCanvasBorderRadius, dragToEnvelopeValue } from './envelope.ts';
import { DecorationTool } from './decorations.ts';
import { saveToURL, loadFromURL } from './serialize.ts';
import { generateEmbedSnippet, copyToClipboard } from './embed.js';
import type {
  Shape,
  Decoration,
  HandleType,
  ADSRCorner,
  SigilData,
  NormalizedCoord,
  Degrees,
} from './types.ts';

// ---- Init ----

const canvas = document.getElementById('sigil-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const CANVAS_SIZE = 800;

const store = new SigilStore();
const undo = new UndoManager(store);
const toolbar = new Toolbar(store, undo);
const audio = new AudioEngine();
const decoTool = new DecorationTool(store, undo, canvas, CANVAS_SIZE);

// ---- Selection state (app-level, not in store) ----

let selectedId: string | null = null;
let selectedDecoId: string | null = null;

function setSelection(shapeId: string | null, decoId: string | null = null): void {
  selectedId = shapeId;
  selectedDecoId = decoId;
  toolbar.selectedId = shapeId;
  toolbar.selectedDecoId = decoId;
}

function getSelected(): Shape | null {
  return selectedId ? (store.getShape(selectedId) ?? null) : null;
}

function getSelectedDeco(): Decoration | null {
  return selectedDecoId ? (store.getDecoration(selectedDecoId) ?? null) : null;
}

// ---- Check for saved state in URL ----

const loaded = loadFromURL();
if (loaded) {
  store.loadState(loaded);
}

// ---- Responsive canvas sizing ----

function resizeCanvas(): void {
  const area = document.getElementById('canvas-area')!;
  const maxH = area.clientHeight - 24;
  const maxW = area.clientWidth - 24;
  const size = Math.min(maxH, maxW, 800);

  const wrap = document.getElementById('canvas-wrap')!;
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';

  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  // Keep internal resolution at 800 for crisp rendering
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;

  updateCanvasBorderRadius(canvas, store.data.envelope, size);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ---- Render loop ----

let needsRender = true;

store.onChange(() => {
  needsRender = true;
  debouncedSave();
  if (audio.isPlaying) {
    audio.updateVoices(store.data);
  }
});

function renderLoop(): void {
  if (needsRender || audio.isPlaying) {
    render(ctx, store.data, CANVAS_SIZE, selectedId, audio.playingShapeIds, selectedDecoId);

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
      store.data.envelope,
      parseInt(canvas.style.width) || CANVAS_SIZE,
    );

    needsRender = false;
  }
  requestAnimationFrame(renderLoop);
}
renderLoop();

// ---- Mouse → canvas coordinate transform ----

interface CanvasCoords {
  px: number;
  py: number;
  nx: number;
  ny: number;
}

function canvasCoords(e: MouseEvent): CanvasCoords {
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
let dragStart: CanvasCoords = { px: 0, py: 0, nx: 0, ny: 0 };
let dragOriginal: any = null;
let activeHandle: HandleType | null = null;
let activeADSRCorner: ADSRCorner | null = null;
let triggeredShapes = new Set<string>(); // for arpeggio mode

// ---- Tool change callback ----

toolbar.onToolChange = (tool: string) => {
  if (tool === 'squiggle' || tool === 'curlicue' || tool === 'text') {
    decoTool.setTool(tool);
    setSelection(null);
    needsRender = true;
  } else {
    decoTool.setTool(null);
  }
};

// ---- Mouse events ----

canvas.addEventListener('mousedown', (e: MouseEvent) => {
  const { px, py, nx, ny } = canvasCoords(e);
  dragStart = { px, py, nx, ny };

  // Arpeggio: shift+drag across canvas
  if (e.shiftKey && store.data.shapes.length > 0 && toolbar.currentTool === 'select') {
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
    const result = decoTool.handleMouseDown(nx as any, ny as any);
    if (result) {
      if ('placed' in result) {
        // Curlicue / text: placed instantly — switch to select mode like shapes
        setSelection(null, result.placed);
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
    undo.snapshot();
    const shape = store.addShape(tool, nx as any, ny as any);
    setSelection(shape.id);
    toolbar.currentTool = 'select';
    toolbar._updateToolActive();
    decoTool.setTool(null);
    toolbar.syncToSelectedShape();
    needsRender = true;
    return;
  }

  // Select mode
  // 1. Check ADSR corners
  const adsrCorner = hitTestADSRCorner(store.data.envelope, px, py, CANVAS_SIZE);
  if (adsrCorner) {
    interactionMode = 'adsr';
    activeADSRCorner = adsrCorner;
    undo.snapshot();
    dragOriginal = { ...store.data.envelope };
    return;
  }

  // 2. Check handles on selected shape
  const selShape = getSelected();
  if (selShape) {
    const handle = hitTestHandles(selShape, px, py, CANVAS_SIZE);
    if (handle === 'rotate') {
      interactionMode = 'rotating';
      undo.snapshot();
      dragOriginal = { rotation: selShape.rotation };
      return;
    }
    if (handle) {
      interactionMode = 'resizing';
      activeHandle = handle;
      undo.snapshot();
      dragOriginal = { size: selShape.size };
      return;
    }
  }

  // 3. Hit test shapes
  const hitId = hitTestShapes(store.data, px, py, CANVAS_SIZE);
  if (hitId) {
    setSelection(hitId);
    toolbar.syncToSelectedShape();
    interactionMode = 'dragging';
    undo.snapshot();
    const shape = store.getShape(hitId)!;
    dragOriginal = { x: shape.x, y: shape.y };
    needsRender = true;
    return;
  }

  // 4. Check resize handles on selected decoration
  const selDeco = getSelectedDeco();
  if (selDeco) {
    const decoHandle = hitTestDecoHandles(selDeco, px, py, CANVAS_SIZE);
    if (decoHandle) {
      interactionMode = 'deco-resizing';
      activeHandle = decoHandle;
      undo.snapshot();
      dragOriginal = {
        scale: selDeco.type !== 'squiggle' ? selDeco.scale : 1,
        bounds: getDecoBounds(selDeco, CANVAS_SIZE),
        points: selDeco.type === 'squiggle' ? selDeco.points.map((p) => [...p]) : null,
      };
      return;
    }
  }

  // 5. Hit test decorations
  const hitDecoId = hitTestDecorations(store.data, px, py, CANVAS_SIZE);
  if (hitDecoId) {
    setSelection(null, hitDecoId);
    interactionMode = 'deco-dragging';
    undo.snapshot();
    const deco = store.getDecoration(hitDecoId)!;
    if (deco.type === 'squiggle') {
      dragOriginal = { points: deco.points.map((p) => [...p]) };
    } else {
      dragOriginal = { x: deco.x, y: deco.y };
    }
    needsRender = true;
    return;
  }

  // 6. Deselect
  setSelection(null);
  needsRender = true;
});

canvas.addEventListener('mousemove', (e: MouseEvent) => {
  const { px, py, nx, ny } = canvasCoords(e);

  if (interactionMode === 'drawing') {
    decoTool.handleMouseMove(nx, ny);
    needsRender = true;
    return;
  }

  if (interactionMode === 'dragging') {
    const shape = getSelected();
    if (!shape) return;
    const dx = nx - dragStart.nx;
    const dy = ny - dragStart.ny;
    store.updateShape(shape.id, {
      x: Math.max(0, Math.min(1, dragOriginal.x + dx)) as NormalizedCoord,
      y: Math.max(0, Math.min(1, dragOriginal.y + dy)) as NormalizedCoord,
    });
    return;
  }

  if (interactionMode === 'resizing') {
    const shape = getSelected();
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
      activeHandle!,
      localDx,
      localDy,
      CANVAS_SIZE,
    );
    store.updateShape(shape.id, { size: newSize });
    return;
  }

  if (interactionMode === 'rotating') {
    const shape = getSelected();
    if (!shape) return;
    const rotation = calcRotation(shape, px, py, CANVAS_SIZE);
    store.updateShape(shape.id, { rotation });
    return;
  }

  if (interactionMode === 'adsr') {
    // Drag distance from corner determines value
    const cornerPos = getCornerPosition(activeADSRCorner!, CANVAS_SIZE);
    const dist = Math.hypot(px - cornerPos.x, py - cornerPos.y);
    const val = dragToEnvelopeValue(activeADSRCorner!, dist, CANVAS_SIZE);
    store.updateEnvelope({ [activeADSRCorner!]: val });
    return;
  }

  if (interactionMode === 'arpeggio') {
    if (!audio._arpeggioReady) return;
    // Trigger shapes as pointer crosses their X position
    for (const shape of store.data.shapes) {
      const shapePx = shape.x * CANVAS_SIZE;
      if (!triggeredShapes.has(shape.id) && Math.abs(px - shapePx) < 20) {
        triggeredShapes.add(shape.id);
        audio.triggerArpeggio(store.data, store.data.envelope, shape.id);
        needsRender = true;
      }
    }
    return;
  }

  if (interactionMode === 'deco-dragging') {
    const deco = getSelectedDeco();
    if (!deco) return;
    const dnx = nx - dragStart.nx;
    const dny = ny - dragStart.ny;
    if (deco.type === 'squiggle') {
      const newPts = dragOriginal.points.map((p: number[]) => [
        Math.max(0, Math.min(1, p[0] + dnx)),
        Math.max(0, Math.min(1, p[1] + dny)),
      ]);
      store.updateDecoration(deco.id, { points: newPts } as any);
    } else {
      store.updateDecoration(deco.id, {
        x: Math.max(0, Math.min(1, dragOriginal.x + dnx)),
        y: Math.max(0, Math.min(1, dragOriginal.y + dny)),
      } as any);
    }
    return;
  }

  if (interactionMode === 'deco-resizing') {
    const deco = getSelectedDeco();
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
      const newPts = origPts.map((p: number[]) => [
        Math.max(0, Math.min(1, pcx + (p[0] - pcx) * ratio)),
        Math.max(0, Math.min(1, pcy + (p[1] - pcy) * ratio)),
      ]);
      store.updateDecoration(deco.id, { points: newPts } as any);
    } else {
      store.updateDecoration(deco.id, { scale: newScale } as any);
    }
    return;
  }
});

canvas.addEventListener('mouseup', () => {
  if (interactionMode === 'drawing') {
    const decoId = decoTool.handleMouseUp();
    if (decoId) {
      // Squiggle finished — switch to select mode like shapes
      setSelection(null, decoId);
      toolbar.currentTool = 'select';
      toolbar._updateToolActive();
      decoTool.setTool(null);
    }
    needsRender = true;
  }

  // No need to manually push undo — undo.snapshot() was called at mousedown
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
      setSelection(null, decoId);
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

let pinchRotateState: {
  initDist: number;
  initAngle: number;
  initSize: number;
  initRotation: number;
  shapeId: string;
} | null = null;

function touchDist(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchAngle(a: Touch, b: Touch): number {
  return (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;
}

canvas.addEventListener(
  'touchstart',
  (e: TouchEvent) => {
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
      const shapeId = hitTestShapes(store.data, px, py, CANVAS_SIZE) || selectedId;
      if (!shapeId) return;

      const shape = store.getShape(shapeId);
      if (!shape) return;

      setSelection(shapeId);
      undo.snapshot();
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
  (e: TouchEvent) => {
    e.preventDefault();

    if (interactionMode === 'pinch-rotate' && e.touches.length >= 2 && pinchRotateState) {
      const [a, b] = e.touches;
      const dist = touchDist(a, b);
      const angle = touchAngle(a, b);

      const scale = dist / pinchRotateState.initDist;
      const newSize = clampSize(pinchRotateState.initSize * scale);

      const angleDelta = angle - pinchRotateState.initAngle;
      const newRotation = (((pinchRotateState.initRotation + angleDelta) % 360) + 360) % 360;

      store.updateShape(pinchRotateState.shapeId, {
        size: newSize,
        rotation: Math.round(newRotation) as Degrees,
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
  (e: TouchEvent) => {
    e.preventDefault();

    if (interactionMode === 'pinch-rotate') {
      if (e.touches.length < 2) {
        // Undo snapshot was already captured at touchstart
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

let clipboard: Shape | null = null;

// ---- Keyboard shortcuts ----

document.addEventListener('keydown', (e: KeyboardEvent) => {
  // Don't intercept when typing in inputs
  if (
    (e.target as HTMLElement).tagName === 'INPUT' ||
    (e.target as HTMLElement).tagName === 'TEXTAREA'
  )
    return;

  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedId) {
      undo.snapshot();
      store.removeShape(selectedId);
      setSelection(null);
    } else if (selectedDecoId) {
      undo.snapshot();
      store.removeDecoration(selectedDecoId);
      setSelection(null);
    }
  }
  if (e.key === 'c' && mod) {
    if (selectedId) {
      const shape = store.getShape(selectedId);
      if (shape) clipboard = JSON.parse(JSON.stringify(shape));
    }
  }
  if (e.key === 'v' && mod) {
    e.preventDefault();
    if (clipboard) {
      undo.snapshot();
      const pasted = store.pasteShape(clipboard, 0.03, 0.03);
      setSelection(pasted.id);
      toolbar.syncToSelectedShape();
      needsRender = true;
    }
    return;
  }
  if (e.key === 'd' && mod) {
    e.preventDefault();
    if (selectedId) {
      undo.snapshot();
      const dup = store.duplicateShape(selectedId, 0, 0);
      if (dup) {
        setSelection(dup.id);
        toolbar.syncToSelectedShape();
        needsRender = true;
      }
    }
    return;
  }
  if (e.key === 'z' && mod) {
    e.preventDefault();
    if (e.shiftKey) undo.redo();
    else undo.undo();
  }
  if (e.key === 'y' && mod) {
    e.preventDefault();
    undo.redo();
  }
  if (e.key === 'Escape') {
    setSelection(null);
    toolbar.currentTool = 'select';
    toolbar._updateToolActive();
    decoTool.setTool(null);
    document.getElementById('text-input')!.classList.add('hidden');
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
    } else if (store.data.shapes.length > 0) {
      startPlayback().then(() => {
        playState = 'latched';
      });
    }
  }
});

// ---- Play mode selector & Play button ----

const playBtn = document.getElementById('btn-play')!;
const canvasWrap = document.getElementById('canvas-wrap')!;
const playFan = document.getElementById('play-fan')!;
const fanLock = playFan.querySelector('.fan-lock')!;
const fanLoop = playFan.querySelector('.fan-loop')! as HTMLElement;

let playState = 'idle'; // 'idle' | 'latched' | 'looping'
let gestureActive = false;
let gestureTimerId: ReturnType<typeof setTimeout> | null = null;
let gesturePointerId: number | null = null;
let lastFanInfo: { zone: string; ms?: number; pull?: number } | null = null;
let loopHoldMs = 500;
let loopTimeoutId: ReturnType<typeof setTimeout> | null = null;
let releaseGlowTimeoutId: ReturnType<typeof setTimeout> | null = null;
let playGeneration = 0;

async function startPlayback(): Promise<void> {
  if (releaseGlowTimeoutId != null) {
    clearTimeout(releaseGlowTimeoutId);
    releaseGlowTimeoutId = null;
  }
  const gen = playGeneration;
  await audio.play(store.data, store.data.envelope);
  if (gen !== playGeneration) return; // cancelled during init
  playBtn.classList.add('playing');
  canvasWrap.classList.add('playing');
  playBtn.textContent = '\u25A0 STOP';
  needsRender = true;
}

function stopPlayback(): void {
  playGeneration++;
  if (loopTimeoutId != null) {
    clearTimeout(loopTimeoutId);
    loopTimeoutId = null;
  }
  audio.release(store.data.envelope);
  playBtn.classList.remove('playing');
  playBtn.textContent = '\u25B6 PLAY';
  playState = 'idle';
  const releaseMs = store.data.envelope.release * 1000 + 100;
  releaseGlowTimeoutId = setTimeout(() => {
    releaseGlowTimeoutId = null;
    canvasWrap.classList.remove('playing');
    needsRender = true;
  }, releaseMs);
}

function scheduleLoopRestart(): void {
  const env = store.data.envelope;
  const releaseMs = env.release * 1000;

  loopTimeoutId = setTimeout(() => {
    audio.release(store.data.envelope);
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

function fanZone(clientY: number): { zone: string; ms?: number; pull?: number } {
  const r = playBtn.getBoundingClientRect();
  const dy = r.top + r.height / 2 - clientY;
  if (dy < LOCK_MIN) return { zone: 'button' };
  if (dy < LOCK_MAX) return { zone: 'lock' };
  const t = Math.min(1, Math.max(0, (dy - LOOP_MIN) / LOOP_RANGE));
  const ms = Math.round((LOOP_MS_MIN + t * (LOOP_MS_MAX - LOOP_MS_MIN)) / 50) * 50;
  return { zone: 'loop', ms, pull: Math.max(0, dy - LOOP_MIN) };
}

function openFan(): void {
  gestureActive = true;
  playFan.classList.add('open');
}

function closeFan(): void {
  gestureActive = false;
  lastFanInfo = null;
  playFan.classList.remove('open');
  fanLock.classList.remove('hot');
  fanLoop.classList.remove('hot', 'dragging');
  fanLoop.style.transform = '';
}

playBtn.addEventListener('pointerdown', (e: PointerEvent) => {
  e.preventDefault();

  // If already playing (latched or looping), stop
  if (playState !== 'idle') {
    stopPlayback();
    return;
  }

  if (store.data.shapes.length === 0) return;

  gesturePointerId = e.pointerId;
  lastFanInfo = null;
  playBtn.setPointerCapture(e.pointerId);

  // Set up gesture tracking synchronously — before audio init
  gestureTimerId = setTimeout(() => {
    gestureTimerId = null;
    if (gesturePointerId != null) openFan();
  }, FAN_DELAY_MS);

  // Track early drag to open fan immediately
  const earlyMove = (me: PointerEvent) => {
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

playBtn.addEventListener('pointermove', (e: PointerEvent) => {
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

playBtn.addEventListener('pointerup', (e: PointerEvent) => {
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
    loopHoldMs = info.ms!;
    playState = 'looping';
    scheduleLoopRestart();
  } else {
    // Released back on button
    stopPlayback();
  }

  closeFan();
  gesturePointerId = null;
});

playBtn.addEventListener('lostpointercapture', (e: PointerEvent) => {
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

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (store.data.shapes.length > 0 || store.data.decorations.length > 0) {
      saveToURL(store.data);
    }
  }, 1000);
}

// ---- Share menu ----

const menuBtn = document.getElementById('btn-menu')!;
const shareMenu = document.getElementById('share-menu')!;

menuBtn.addEventListener('click', (e: MouseEvent) => {
  e.stopPropagation();
  shareMenu.classList.toggle('hidden');
});

document.addEventListener('click', (e: MouseEvent) => {
  if (!shareMenu.contains(e.target as Node) && e.target !== menuBtn) {
    shareMenu.classList.add('hidden');
  }
});

shareMenu.addEventListener('click', async (e: MouseEvent) => {
  const item = (e.target as HTMLElement).closest('.share-menu-item') as HTMLElement | null;
  if (!item) return;

  const action = item.dataset.action;
  const label = item.querySelector('span')!;
  const originalText = label.textContent!;

  if (action === 'share') {
    await copyToClipboard(window.location.href);
  } else if (action === 'embed') {
    const snippet = generateEmbedSnippet(store.data);
    await copyToClipboard(snippet);
  }

  label.textContent = 'Copied!';
  setTimeout(() => {
    label.textContent = originalText;
  }, 1500);
});

// ---- Corner position helper ----

function getCornerPosition(cornerName: string, size: number): { x: number; y: number } {
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
