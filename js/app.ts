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
import { AudioEngine, snapYToNote, rotationToTimbre } from './audio.ts';
import { updateCanvasBorderRadius, dragToEnvelopeValue } from './envelope.ts';
import { DecorationTool } from './decorations.ts';
import { saveToURL, loadFromURL } from './serialize.ts';
import { generateEmbedSnippet, copyToClipboard } from './embed.ts';
import { IDLE, type InteractionState } from './interaction.ts';
import {
  normalizedCoord,
  type Voice,
  type TextDecoration,
  type WaveformType,
  type Reverb,
} from './types.ts';

// ---- Init ----

const canvas = document.getElementById('sigil-canvas') as HTMLCanvasElement;
const canvasFrame = document.getElementById('canvas-frame')!;
const ctx = canvas.getContext('2d')!;
const CANVAS_SIZE = 800;

const store = new SigilStore();
const undo = new UndoManager(store);
const toolbar = new Toolbar(store, undo);
const audio = new AudioEngine();
const decoTool = new DecorationTool(store, undo);

// ---- Selection state (app-level, not in store) ----

let selectedId: string | null = null;
let selectedDecoId: string | null = null;

function setSelection(shapeId: string | null, decoId: string | null = null): void {
  selectedId = shapeId;
  selectedDecoId = decoId;
  toolbar.selectedId = shapeId;
  toolbar.selectedDecoId = decoId;
}

function getSelected(): Voice | null {
  return selectedId ? (store.getVoice(selectedId) ?? null) : null;
}

function getSelectedDeco(): TextDecoration | null {
  return selectedDecoId ? (store.getText(selectedDecoId) ?? null) : null;
}

// ---- Check for saved state in URL ----

const loaded = loadFromURL();
if (loaded) {
  store.loadState(loaded);
}

// ---- Reverb shadow on canvas frame ----

function updateReverbShadow(frameEl: HTMLElement, reverb: Reverb | null, canvasSize: number): void {
  if (!reverb) {
    frameEl.style.boxShadow = 'none';
    return;
  }
  const maxBlur = canvasSize * 0.15;
  const blur = reverb.depth * maxBlur;
  const alpha = 0.3 + reverb.depth * 0.5;
  const color =
    reverb.style === 'glow'
      ? `rgba(255,255,255,${alpha.toFixed(2)})`
      : `rgba(0,0,0,${alpha.toFixed(2)})`;
  frameEl.style.boxShadow = `inset 0 0 ${blur.toFixed(1)}px ${color}`;
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

  updateCanvasBorderRadius(canvasFrame, store.data.envelope, size);
  updateReverbShadow(canvasFrame, store.data.reverb, size);
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
    audio.updateReverb(store.data.reverb);
  }
});

function renderLoop(): void {
  if (needsRender || audio.isPlaying) {
    render(ctx, store.data, CANVAS_SIZE, selectedId, selectedDecoId);

    updateCanvasBorderRadius(
      canvasFrame,
      store.data.envelope,
      parseInt(canvas.style.width) || CANVAS_SIZE,
    );
    updateReverbShadow(canvasFrame, store.data.reverb, parseInt(canvas.style.width) || CANVAS_SIZE);

    needsRender = false;
  }
  requestAnimationFrame(renderLoop);
}
renderLoop();

// ---- Mouse -> canvas coordinate transform ----

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

// ---- Map tool names to waveform types ----

const toolToWaveform: Record<string, WaveformType> = {
  circle: 'sine',
  square: 'pulse',
  triangle: 'blend',
};

// ---- Interaction state ----

let interaction: InteractionState = IDLE;

// ---- Tool change callback ----

toolbar.onToolChange = (tool: string) => {
  if (tool === 'text') {
    decoTool.setTool(tool);
    setSelection(null);
    needsRender = true;
  } else {
    decoTool.setTool(null);
  }
};

// ---- Helper: get visual rotation for a voice (for resize local coords) ----

function voiceRotation(voice: Voice): number {
  if ('timbre' in voice) {
    const period = voice.waveform === 'pulse' ? 90 : 120;
    return Math.min(1, Math.max(0, voice.timbre)) * period;
  }
  return 0;
}

// ---- Mouse events ----

canvas.addEventListener('mousedown', (e: MouseEvent) => {
  const { px, py, nx, ny } = canvasCoords(e);

  const tool = toolbar.currentTool;

  // Text decoration tool
  if (tool === 'text') {
    const result = decoTool.handleMouseDown(normalizedCoord(nx), normalizedCoord(ny));
    if (result) {
      if ('placed' in result) {
        // Text: placed instantly -- switch to select mode
        setSelection(null, result.placed);
        toolbar.currentTool = 'select';
        toolbar._updateToolActive();
        decoTool.setTool(null);
      }
      needsRender = true;
      return;
    }
  }

  // Shape (voice) placement tools
  const waveform = toolToWaveform[tool];
  if (waveform) {
    undo.snapshot();
    const voice = store.addVoice(waveform, normalizedCoord(nx), snapYToNote(normalizedCoord(ny)));
    setSelection(voice.id);
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
    undo.snapshot();
    interaction = { mode: 'adsr', corner: adsrCorner, origin: { ...store.data.envelope } };
    return;
  }

  // 2. Check handles on selected voice
  const selVoice = getSelected();
  if (selVoice) {
    const handle = hitTestHandles(selVoice, px, py, CANVAS_SIZE);
    if (handle === 'rotate') {
      undo.snapshot();
      interaction = { mode: 'rotating' };
      return;
    }
    if (handle) {
      undo.snapshot();
      interaction = {
        mode: 'resizing',
        handle,
        origin: { size: selVoice.size },
        startPx: px,
        startPy: py,
      };
      return;
    }
  }

  // 3. Hit test voices
  const hitId = hitTestShapes(store.data, px, py, CANVAS_SIZE);
  if (hitId) {
    setSelection(hitId);
    toolbar.syncToSelectedShape();
    undo.snapshot();
    const voice = store.getVoice(hitId)!;
    interaction = {
      mode: 'dragging',
      origin: { x: voice.x, y: voice.y },
      startNx: nx,
      startNy: ny,
    };
    needsRender = true;
    return;
  }

  // 4. Check resize handles on selected text decoration
  const selDeco = getSelectedDeco();
  if (selDeco) {
    const decoHandle = hitTestDecoHandles(selDeco, px, py, CANVAS_SIZE);
    if (decoHandle) {
      undo.snapshot();
      interaction = {
        mode: 'deco-resizing',
        handle: decoHandle,
        origin: {
          size: selDeco.size,
          bounds: getDecoBounds(selDeco, CANVAS_SIZE)!,
        },
      };
      return;
    }
  }

  // 5. Hit test text decorations
  const hitDecoId = hitTestDecorations(store.data, px, py, CANVAS_SIZE);
  if (hitDecoId) {
    setSelection(null, hitDecoId);
    undo.snapshot();
    const deco = store.getText(hitDecoId)!;
    interaction = {
      mode: 'deco-dragging',
      origin: { x: deco.x, y: deco.y },
      startNx: nx,
      startNy: ny,
    };
    needsRender = true;
    return;
  }

  // 6. Deselect
  setSelection(null);
  needsRender = true;
});

canvas.addEventListener('mousemove', (e: MouseEvent) => {
  const { px, py, nx, ny } = canvasCoords(e);

  if (interaction.mode === 'dragging') {
    const voice = getSelected();
    if (!voice) return;
    const dx = nx - interaction.startNx;
    const dy = ny - interaction.startNy;
    store.updateVoice(voice.id, {
      x: normalizedCoord(interaction.origin.x + dx),
      y: snapYToNote(normalizedCoord(interaction.origin.y + dy)),
    });
    return;
  }

  if (interaction.mode === 'resizing') {
    const voice = getSelected();
    if (!voice) return;
    // Transform delta to voice-local coordinates
    const rotDeg = voiceRotation(voice);
    const rotRad = (rotDeg * Math.PI) / 180;
    const dpx = px - interaction.startPx;
    const dpy = py - interaction.startPy;
    const cos = Math.cos(-rotRad);
    const sin = Math.sin(-rotRad);
    const localDx = dpx * cos - dpy * sin;
    const localDy = dpx * sin + dpy * cos;
    const newSize = calcResize(
      { ...voice, size: normalizedCoord(interaction.origin.size) },
      interaction.handle,
      localDx,
      localDy,
      CANVAS_SIZE,
    );
    store.updateVoice(voice.id, { size: newSize });
    return;
  }

  if (interaction.mode === 'rotating') {
    const voice = getSelected();
    if (!voice) return;
    if (voice.waveform === 'sine') return;
    const rotation = calcRotation(voice, px, py, CANVAS_SIZE);
    const timbre = rotationToTimbre(rotation, voice.waveform);
    store.updateVoice(voice.id, { timbre: normalizedCoord(timbre) });
    return;
  }

  if (interaction.mode === 'adsr') {
    // Drag distance from corner determines value
    const cornerPos = getCornerPosition(interaction.corner, CANVAS_SIZE);
    const dist = Math.hypot(px - cornerPos.x, py - cornerPos.y);
    const val = dragToEnvelopeValue(interaction.corner, dist, CANVAS_SIZE);
    store.updateEnvelope({ [interaction.corner]: val });
    return;
  }

  if (interaction.mode === 'deco-dragging') {
    const deco = getSelectedDeco();
    if (!deco) return;
    const dnx = nx - interaction.startNx;
    const dny = ny - interaction.startNy;
    store.updateText(deco.id, {
      x: normalizedCoord(interaction.origin.x + dnx),
      y: normalizedCoord(interaction.origin.y + dny),
    });
    return;
  }

  if (interaction.mode === 'deco-resizing') {
    const deco = getSelectedDeco();
    if (!deco) return;
    const { bounds, size } = interaction.origin;
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    const initDist = Math.hypot(bounds.w / 2, bounds.h / 2);
    const currDist = Math.hypot(px - cx, py - cy);
    const ratio = currDist / initDist;
    const newSize = normalizedCoord(Math.max(0.02, Math.min(0.5, size * ratio)));
    store.updateText(deco.id, { size: newSize });
    return;
  }
});

canvas.addEventListener('mouseup', () => {
  interaction = IDLE;
});

canvas.addEventListener('mouseleave', () => {
  interaction = IDLE;
});

// ---- Touch support ----

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
      if (interaction.mode !== 'idle') {
        canvas.dispatchEvent(new MouseEvent('mouseup', {}));
      }

      const a = e.touches[0]!;
      const b = e.touches[1]!;
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      const rect = canvas.getBoundingClientRect();
      const px = ((midX - rect.left) * CANVAS_SIZE) / rect.width;
      const py = ((midY - rect.top) * CANVAS_SIZE) / rect.height;

      // Select voice under midpoint, or use already-selected voice
      const shapeId = hitTestShapes(store.data, px, py, CANVAS_SIZE) || selectedId;
      if (!shapeId) return;

      const voice = store.getVoice(shapeId);
      if (!voice) return;

      setSelection(shapeId);
      undo.snapshot();

      const initRotation = voiceRotation(voice);
      interaction = {
        mode: 'pinch-rotate',
        initDist: touchDist(a, b),
        initAngle: touchAngle(a, b),
        initSize: voice.size,
        initRotation,
        shapeId,
      };
      needsRender = true;
      return;
    }

    const touch = e.touches[0]!;
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

    if (interaction.mode === 'pinch-rotate' && e.touches.length >= 2) {
      const a = e.touches[0]!;
      const b = e.touches[1]!;
      const dist = touchDist(a, b);
      const angle = touchAngle(a, b);

      const scale = dist / interaction.initDist;
      const newSize = clampSize(interaction.initSize * scale);

      const voice = store.getVoice(interaction.shapeId);
      if (!voice) return;

      if (voice.waveform === 'sine') {
        store.updateVoice(interaction.shapeId, { size: newSize });
      } else {
        const angleDelta = angle - interaction.initAngle;
        const newRotation = (((interaction.initRotation + angleDelta) % 360) + 360) % 360;
        const timbre = rotationToTimbre(newRotation, voice.waveform);
        store.updateVoice(interaction.shapeId, {
          size: newSize,
          timbre: normalizedCoord(timbre),
        });
      }
      return;
    }

    const touch = e.touches[0]!;
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

    if (interaction.mode === 'pinch-rotate') {
      if (e.touches.length < 2) {
        // Undo snapshot was already captured at touchstart
        interaction = IDLE;
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

let clipboard: Voice | null = null;

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
      store.removeVoice(selectedId);
      setSelection(null);
    } else if (selectedDecoId) {
      undo.snapshot();
      store.removeText(selectedDecoId);
      setSelection(null);
    }
  }
  if (e.key === 'c' && mod) {
    if (selectedId) {
      const voice = store.getVoice(selectedId);
      if (voice) clipboard = JSON.parse(JSON.stringify(voice));
    }
  }
  if (e.key === 'v' && mod) {
    e.preventDefault();
    if (clipboard) {
      undo.snapshot();
      const pasted = store.pasteVoice(clipboard, 0.03, 0.03);
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
      const dup = store.duplicateVoice(selectedId, 0, 0);
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
    } else if (store.data.voices.length > 0) {
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
  if (gen !== playGeneration) {
    // Cancelled during async init — stop audio that just started
    audio.stop();
    return;
  }
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

  if (store.data.voices.length === 0) return;

  gesturePointerId = e.pointerId;
  lastFanInfo = null;
  playBtn.setPointerCapture(e.pointerId);

  // Set up gesture tracking synchronously -- before audio init
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

  // Start audio (non-blocking -- gesture is already wired)
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
    // Quick click -- normal release
    stopPlayback();
    closeFan();
    gesturePointerId = null;
    return;
  }

  // Use the last tracked zone from pointermove -- avoids drift during finger lift.
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
    if (store.data.voices.length > 0 || store.data.texts.length > 0) {
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
