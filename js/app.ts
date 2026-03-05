// app.ts — Entry point, event wiring, render loop

import { SigilStore, UndoManager } from './state.ts';
import { render } from './canvas.ts';
import {
  hitTestADSRCorner,
  isInClippedCorner,
  calcResize,
  calcRotation,
  clampSize,
  voiceRotation,
} from './shapes.ts';
import { Toolbar } from './toolbar.ts';
import { AudioEngine, snapYToNote, rotationToTimbre } from './audio.ts';
import { updateCanvasBorderRadius, dragToEnvelopeValue } from './envelope.ts';
import { saveToURL, loadFromURL } from './serialize.ts';
import { generateEmbedSnippet, copyToClipboard } from './embed.ts';
import { IDLE, type InteractionState } from './interaction.ts';
import { initStage, setAudioLevel } from './stage.ts';
import {
  normalizedCoord,
  type Voice,
  type TextDecoration,
  type WaveformType,
  type ADSRCorner,
  type HandleType,
  type Reverb,
} from './types.ts';

// ---- Init ----

const svg = document.getElementById('sigil-canvas') as unknown as SVGSVGElement;
const canvasFrame = document.getElementById('canvas-frame')!;

const store = new SigilStore();
const undo = new UndoManager(store);
const toolbar = new Toolbar(store, undo);
const audio = new AudioEngine();

// Pre-warm AudioContext on first user gesture. iOS Safari only allows audio
// from touchend, click, doubleclick, or keydown — NOT pointerdown/mousedown.
{
  const warmUpEvents = ['touchend', 'click', 'keydown'] as const;
  function onFirstGesture(): void {
    audio.warmUp();
    for (const evt of warmUpEvents) document.removeEventListener(evt, onFirstGesture);
  }
  for (const evt of warmUpEvents) document.addEventListener(evt, onFirstGesture);
}

// ---- Selection state (app-level, not in store) ----

let selectedId: string | null = null;
let selectedDecoId: string | null = null;

function setSelection(shapeId: string | null, decoId: string | null = null): void {
  selectedId = shapeId;
  selectedDecoId = decoId;
  toolbar.selectedId = shapeId;
  toolbar.selectedDecoId = decoId;
  toolbar.updateBottomBar();
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

// ---- First-load splash ----

const splashKey = `spatch-seen:${location.pathname}${location.hash}`;
let splashActive = !localStorage.getItem(splashKey);
if (splashActive) {
  document.body.classList.add('splash');
}

// ---- Reverb shadow on canvas frame ----

function updateFrameShadow(
  frameEl: HTMLElement,
  reverb: Reverb | null,
  canvasSize: number,
  audioLevel: number,
): void {
  const shadows: string[] = [];

  if (reverb) {
    const maxBlur = canvasSize * 0.15;
    const blur = reverb.depth * maxBlur;
    const alpha = 0.3 + reverb.depth * 0.5;
    const color =
      reverb.style === 'glow'
        ? `rgba(255,255,255,${alpha.toFixed(2)})`
        : `rgba(0,0,0,${alpha.toFixed(2)})`;
    shadows.push(`inset 0 0 ${blur.toFixed(1)}px ${color}`);
  }

  if (audioLevel > 0.001) {
    // sqrt curve keeps shadow visible longer during fade-out
    const t = Math.sqrt(Math.min(1, audioLevel * 3));
    const blur = 12 + t * 36;
    const spread = 2 + t * 14;
    const alpha = 0.3 + t * 0.6;
    shadows.push(
      `0 0 ${blur.toFixed(1)}px ${spread.toFixed(1)}px rgba(10, 12, 18, ${alpha.toFixed(2)})`,
    );
  }

  frameEl.style.boxShadow = shadows.length > 0 ? shadows.join(', ') : 'none';
}

// ---- Responsive canvas sizing ----

let needsRender = true;

function resizeCanvas(): void {
  const area = document.getElementById('canvas-area')!;
  const maxH = area.clientHeight - 24;
  const maxW = area.clientWidth - 24;
  const size = Math.min(maxH, maxW, 800);

  const wrap = document.getElementById('canvas-wrap')!;
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';

  updateCanvasBorderRadius(canvasFrame, store.data.envelope, size);
  updateFrameShadow(canvasFrame, store.data.reverb, size, audio.getLevel());
  needsRender = true;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
initStage();

// ---- Play state (hoisted for renderLoop / keyboard handler) ----

const playBtn = document.getElementById('btn-play')!;
const playFan = document.getElementById('play-fan')!;
const fanLock = playFan.querySelector('.fan-lock')!;
const fanLoop = playFan.querySelector('.fan-loop')! as HTMLElement;

const playModeLock = document.getElementById('play-mode-lock')!;
const playModeLoop = document.getElementById('play-mode-loop')!;

let playState = 'idle'; // 'idle' | 'latched' | 'looping'
let gestureActive = false;
let gestureTimerId: ReturnType<typeof setTimeout> | null = null;
let gesturePointerId: number | null = null;
let lastFanInfo: { zone: string; ms?: number; pull?: number } | null = null;
let loopHoldMs = 500;
let loopTimeoutId: ReturnType<typeof setTimeout> | null = null;
let loopCycleStart = 0;
let loopCycleDuration = 0;
let releaseGlowTimeoutId: ReturnType<typeof setTimeout> | null = null;
let playGeneration = 0;

// ---- Render loop ----

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
    render(svg, store.data, selectedId, selectedDecoId);

    const wrap = document.getElementById('canvas-wrap')!;
    const displaySize = parseInt(wrap.style.width) || 800;
    updateCanvasBorderRadius(canvasFrame, store.data.envelope, displaySize);
    updateFrameShadow(canvasFrame, store.data.reverb, displaySize, audio.getLevel());
    setAudioLevel(audio.getLevel());

    needsRender = false;
  }

  if (playState === 'looping' && loopCycleDuration > 0) {
    const elapsed = performance.now() - loopCycleStart;
    const progress = Math.min(1, elapsed / loopCycleDuration);
    playBtn.style.setProperty('--loop-progress', `${(progress * 100).toFixed(1)}%`);
  }

  requestAnimationFrame(renderLoop);
}
renderLoop();

// ---- Mouse -> SVG coordinate transform ----
// SVG viewBox is "0 0 1 1", so SVG coords ARE normalized 0-1.

interface NormCoords {
  nx: number;
  ny: number;
}

function svgCoordsFromClient(clientX: number, clientY: number): NormCoords {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { nx: 0, ny: 0 };
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { nx: svgPt.x, ny: svgPt.y };
}

function svgCoords(e: PointerEvent): NormCoords {
  return svgCoordsFromClient(e.clientX, e.clientY);
}

// ---- Map tool names to waveform types ----

const toolToWaveform: Record<string, WaveformType> = {
  circle: 'sine',
  square: 'pulse',
  triangle: 'blend',
};

// ---- Interaction state ----

let interaction: InteractionState = IDLE;

// Active pointers for pinch-rotate detection
const activePointers = new Map<number, { x: number; y: number }>();

// ---- ADSR corner drag helpers ----
// Diagonal direction pointing inward from each corner (for projection)
const INV_SQRT2 = 1 / Math.sqrt(2);

function cornerDiagonal(corner: ADSRCorner): { dx: number; dy: number } {
  switch (corner) {
    case 'attack':
      return { dx: 1, dy: -1 };
    case 'decay':
      return { dx: 1, dy: 1 };
    case 'sustain':
      return { dx: -1, dy: 1 };
    case 'release':
      return { dx: -1, dy: -1 };
  }
}

function envelopeValueToDist(corner: ADSRCorner, val: number, canvasSize: number): number {
  const maxR = canvasSize * 0.15; // matches MAX_RADIUS_RATIO in envelope.ts
  switch (corner) {
    case 'attack':
    case 'decay':
      return (val / 2.0) * maxR;
    case 'sustain':
      return val * maxR;
    case 'release':
      return (val / 3.0) * maxR;
  }
}

function handleADSRDrag(nx: number, ny: number): void {
  if (interaction.mode !== 'adsr') return;
  const diag = cornerDiagonal(interaction.corner);
  const moveDx = nx - interaction.startPx;
  const moveDy = ny - interaction.startPy;
  const projectedDelta = (moveDx * diag.dx + moveDy * diag.dy) * INV_SQRT2;
  const originDist = envelopeValueToDist(
    interaction.corner,
    interaction.origin[interaction.corner],
    1,
  );
  const newDist = Math.max(0, originDist + projectedDelta);
  const val = dragToEnvelopeValue(interaction.corner, newDist, 1);
  store.updateEnvelope({ [interaction.corner]: val });
}

// ---- Tool change callback ----

toolbar.onToolChange = (tool: string) => {
  if (tool === 'deselect') {
    setSelection(null);
    needsRender = true;
  }
};

toolbar.onDuplicate = () => {
  if (selectedId) {
    undo.snapshot();
    const dup = store.duplicateVoice(selectedId, 0.03, 0.03);
    if (dup) {
      setSelection(dup.id);
      toolbar.syncToSelectedShape();
      needsRender = true;
    }
  }
};

// ---- Pinch helpers ----

function pointerDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointerAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// ---- Click stage background to deselect ----

const canvasArea = document.getElementById('canvas-area')!;
canvasArea.addEventListener('pointerdown', (e: PointerEvent) => {
  const target = e.target as HTMLElement;
  if (target === canvasArea) {
    setSelection(null);
    needsRender = true;
  }
});

// ---- Pointer events (all on canvasWrap) ----

const canvasWrap = document.getElementById('canvas-wrap')!;

canvasWrap.addEventListener('pointerdown', (e: PointerEvent) => {
  if (splashActive) return;
  e.preventDefault();

  const { nx, ny } = svgCoords(e);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // Two touch pointers → pinch-rotate
  if (e.pointerType === 'touch' && activePointers.size === 2) {
    // Cancel any single-touch interaction in progress
    if (interaction.mode !== 'idle') {
      interaction = IDLE;
    }

    const [idA, posA] = [...activePointers.entries()][0]!;
    const [idB, posB] = [...activePointers.entries()][1]!;

    // For pinch, use the currently selected voice as target
    const shapeId = selectedId;
    if (!shapeId) return;

    const voice = store.getVoice(shapeId);
    if (!voice) return;

    setSelection(shapeId);
    undo.snapshot();

    const initRotation = voiceRotation(voice);
    interaction = {
      mode: 'pinch-rotate',
      pointerA: idA,
      pointerB: idB,
      positions: new Map(activePointers),
      initDist: pointerDist(posA, posB),
      initAngle: pointerAngle(posA, posB),
      initSize: voice.size,
      initRotation,
      shapeId,
    };
    canvasWrap.setPointerCapture(idA);
    canvasWrap.setPointerCapture(idB);
    needsRender = true;
    return;
  }

  const tool = toolbar.currentTool;

  // Shape (voice) placement tools
  const waveform = toolToWaveform[tool];
  if (waveform) {
    undo.snapshot();
    const voice = store.addVoice(waveform, normalizedCoord(nx), snapYToNote(normalizedCoord(ny)));
    setSelection(voice.id);
    toolbar.currentTool = 'select';
    toolbar._updateToolActive();
    toolbar.syncToSelectedShape();
    needsRender = true;
    return;
  }

  // Select mode — skip shape hit testing in clipped corner regions
  const inClippedCorner = isInClippedCorner(store.data.envelope, nx, ny, 1);

  if (!inClippedCorner) {
    // 1. Check handles on selected voice (SVG native hit testing)
    const handleEl = (e.target as Element).closest?.('[data-handle]');
    const handle = handleEl
      ? (((handleEl as HTMLElement).dataset.handle as HandleType) ?? null)
      : null;

    if (handle) {
      const selVoice = getSelected();
      if (selVoice) {
        if (handle === 'rotate') {
          undo.snapshot();
          interaction = { mode: 'rotating', pointerId: e.pointerId };
          canvasWrap.setPointerCapture(e.pointerId);
          return;
        }
        undo.snapshot();
        interaction = {
          mode: 'resizing',
          pointerId: e.pointerId,
          handle,
          origin: { size: selVoice.size },
          startPx: nx,
          startPy: ny,
        };
        canvasWrap.setPointerCapture(e.pointerId);
        return;
      }

      // Handle might be on a deco element
      const selDeco = getSelectedDeco();
      if (selDeco) {
        undo.snapshot();
        const textEl = svg.querySelector(`text[data-deco-id="${selDeco.id}"]`);
        let bounds;
        if (textEl) {
          try {
            const bbox = (textEl as SVGTextElement).getBBox();
            bounds = { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height };
          } catch {
            bounds = null;
          }
        }
        if (bounds) {
          interaction = {
            mode: 'deco-resizing',
            pointerId: e.pointerId,
            handle,
            origin: {
              size: selDeco.size,
              bounds,
            },
          };
          canvasWrap.setPointerCapture(e.pointerId);
          return;
        }
      }
    }

    // 2. Hit test voices (SVG native)
    const voiceEl = (e.target as Element).closest?.('[data-voice-id]');
    const hitId = voiceEl ? ((voiceEl as HTMLElement).dataset.voiceId ?? null) : null;
    if (hitId) {
      setSelection(hitId);
      toolbar.syncToSelectedShape();
      undo.snapshot();
      const voice = store.getVoice(hitId)!;
      interaction = {
        mode: 'dragging',
        pointerId: e.pointerId,
        origin: { x: voice.x, y: voice.y },
        startNx: nx,
        startNy: ny,
      };
      canvasWrap.setPointerCapture(e.pointerId);
      needsRender = true;
      return;
    }

    // 3. Hit test text decorations (SVG native)
    const decoEl = (e.target as Element).closest?.('[data-deco-id]');
    const hitDecoId = decoEl ? ((decoEl as HTMLElement).dataset.decoId ?? null) : null;
    if (hitDecoId) {
      setSelection(null, hitDecoId);
      undo.snapshot();
      const deco = store.getText(hitDecoId)!;
      interaction = {
        mode: 'deco-dragging',
        pointerId: e.pointerId,
        origin: { x: deco.x, y: deco.y },
        startNx: nx,
        startNy: ny,
      };
      canvasWrap.setPointerCapture(e.pointerId);
      needsRender = true;
      return;
    }
  }

  // 5. Check ADSR corners
  const adsrCorner = hitTestADSRCorner(store.data.envelope, nx, ny, 1);
  if (adsrCorner) {
    undo.snapshot();
    interaction = {
      mode: 'adsr',
      pointerId: e.pointerId,
      corner: adsrCorner,
      origin: { ...store.data.envelope },
      startPx: nx,
      startPy: ny,
    };
    canvasWrap.setPointerCapture(e.pointerId);
    return;
  }

  // 6. Deselect
  if (!inClippedCorner) {
    setSelection(null);
    needsRender = true;
  }
});

canvasWrap.addEventListener('pointermove', (e: PointerEvent) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // Pinch-rotate: compute from two stored positions
  if (interaction.mode === 'pinch-rotate') {
    interaction.positions.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const posA = interaction.positions.get(interaction.pointerA);
    const posB = interaction.positions.get(interaction.pointerB);
    if (!posA || !posB) return;

    const dist = pointerDist(posA, posB);
    const angle = pointerAngle(posA, posB);
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

  // Filter by pointerId for single-pointer interactions
  if (
    interaction.mode !== 'idle' &&
    'pointerId' in interaction &&
    interaction.pointerId !== e.pointerId
  )
    return;

  const { nx, ny } = svgCoords(e);

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
    const rotDeg = voiceRotation(voice);
    const rotRad = (rotDeg * Math.PI) / 180;
    const dnx = nx - interaction.startPx;
    const dny = ny - interaction.startPy;
    const cos = Math.cos(-rotRad);
    const sin = Math.sin(-rotRad);
    const localDx = dnx * cos - dny * sin;
    const localDy = dnx * sin + dny * cos;
    const newSize = calcResize(
      { ...voice, size: normalizedCoord(interaction.origin.size) },
      interaction.handle,
      localDx,
      localDy,
      1,
    );
    store.updateVoice(voice.id, { size: newSize });
    return;
  }

  if (interaction.mode === 'rotating') {
    const voice = getSelected();
    if (!voice) return;
    if (voice.waveform === 'sine') return;
    const rotation = calcRotation(voice, nx, ny, 1);
    const timbre = rotationToTimbre(rotation, voice.waveform);
    store.updateVoice(voice.id, { timbre: normalizedCoord(timbre) });
    return;
  }

  if (interaction.mode === 'adsr') {
    handleADSRDrag(nx, ny);
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
    const currDist = Math.hypot(nx - cx, ny - cy);
    const ratio = currDist / initDist;
    const newSize = normalizedCoord(Math.max(0.02, Math.min(0.5, size * ratio)));
    store.updateText(deco.id, { size: newSize });
    return;
  }
});

function handlePointerEnd(e: PointerEvent): void {
  activePointers.delete(e.pointerId);

  if (interaction.mode === 'pinch-rotate') {
    if (e.pointerId === interaction.pointerA || e.pointerId === interaction.pointerB) {
      interaction = IDLE;
      toolbar.syncToSelectedShape();
      needsRender = true;
    }
    return;
  }

  // Filter by pointerId
  if (
    interaction.mode !== 'idle' &&
    'pointerId' in interaction &&
    interaction.pointerId !== e.pointerId
  )
    return;

  interaction = IDLE;
}

canvasWrap.addEventListener('pointerup', handlePointerEnd);
canvasWrap.addEventListener('pointercancel', handlePointerEnd);

// ---- Clipboard for copy/paste ----

let clipboard: Voice | null = null;

// ---- Share menu (hoisted for keyboard handler) ----

const shareBtn = document.getElementById('btn-share')!;
const shareMenu = document.getElementById('share-menu')!;

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
      const dup = store.duplicateVoice(selectedId, 0.03, 0.03);
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
    shareMenu.classList.add('hidden');
    needsRender = true;
  }
  if (e.key === 'v' && !mod) {
    toolbar.currentTool = 'select';
    toolbar._updateToolActive();
  }
  if (e.key === ' ') {
    e.preventDefault();
    if (e.repeat || splashActive) return;
    if (playState !== 'idle') {
      stopPlayback();
    } else if (store.data.voices.length > 0) {
      startPlayback().then(() => {
        playState = 'latched';
        updatePlayIndicators();
      });
    }
  }
});

// ---- Play mode selector & Play button ----

function updatePlayIndicators(): void {
  playModeLock.classList.toggle('hidden', playState !== 'latched');
  playModeLoop.classList.toggle('hidden', playState !== 'looping');
}

// Icon reference for sprite scanner: #tabler-player-stop-filled
function setPlayIcon(playing: boolean): void {
  const symbol = playing ? 'tabler-player-stop-filled' : 'tabler-player-play-filled';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('play-icon');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${symbol}`);
  svg.appendChild(use);
  playBtn.querySelector('.play-icon')!.replaceWith(svg);
}

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
  setPlayIcon(true);
  needsRender = true;
}

function stopPlayback(): void {
  playGeneration++;
  if (loopTimeoutId != null) {
    clearTimeout(loopTimeoutId);
    loopTimeoutId = null;
  }
  audio.release(store.data.envelope);
  playBtn.classList.remove('playing', 'looping');
  playBtn.style.setProperty('--loop-progress', '0%');
  setPlayIcon(false);
  playState = 'idle';
  updatePlayIndicators();
  const releaseMs = store.data.envelope.release * 1000 + 100;
  releaseGlowTimeoutId = setTimeout(() => {
    releaseGlowTimeoutId = null;
    needsRender = true;
  }, releaseMs);
}

function scheduleLoopRestart(): void {
  const env = store.data.envelope;
  const releaseMs = env.release * 1000;

  loopCycleDuration = loopHoldMs + releaseMs + 50;
  loopCycleStart = performance.now();
  playBtn.classList.add('looping');

  loopTimeoutId = setTimeout(() => {
    audio.release(store.data.envelope);
    loopTimeoutId = setTimeout(() => {
      if (playState === 'looping') {
        loopCycleStart = performance.now();
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
  const dy = clientY - (r.top + r.height / 2); // positive = below button
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
  // Eagerly warm up AudioContext — even though pointerdown isn't a qualifying
  // gesture on iOS Safari, creating the context now means it's ready when
  // touchend/click fires and actually unlocks it.
  audio.warmUp();

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
    const dy = me.clientY - (r.top + r.height / 2); // positive = below button
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
    fanLoop.style.transform = `translateY(${info.pull}px)`;
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
    updatePlayIndicators();
  } else if (info.zone === 'loop') {
    loopHoldMs = info.ms!;
    playState = 'looping';
    updatePlayIndicators();
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

// ---- Splash interaction ----

if (splashActive) {
  const canvasArea = document.getElementById('canvas-area')!;
  const MIN_SUSTAIN_MS = 2000;
  let splashDownTime = 0;
  let splashPointerDown = false;

  function splashReveal(delayAudioRelease: number, playReady: Promise<void>): void {
    const FADE_DURATION = 0.5;
    const topBar = document.getElementById('toolbar-top')!;
    const botBar = document.getElementById('toolbar-bottom')!;

    // Fast fixed fade — starts immediately, eases out
    topBar.style.transitionDuration = `${FADE_DURATION}s`;
    botBar.style.transitionDuration = `${FADE_DURATION}s`;

    // Remove splash class — triggers CSS opacity transition right away
    document.body.classList.remove('splash');
    splashActive = false;

    // Mark URL as seen
    localStorage.setItem(splashKey, '1');

    // Release audio: wait for play() to finish first, otherwise release()
    // fires while isPlaying is still false and becomes a no-op.
    const doRelease = async () => {
      try {
        await playReady;
      } catch {}
      // If play() somehow didn't complete, force stop as fallback
      if (!audio.isPlaying) {
        audio.stop();
        playBtn.classList.remove('playing');
        setPlayIcon(false);
        playState = 'idle';
        return;
      }
      audio.release(store.data.envelope);
      playBtn.classList.remove('playing');
      setPlayIcon(false);
      playState = 'idle';
      const releaseMs = store.data.envelope.release * 1000 + 100;
      releaseGlowTimeoutId = setTimeout(() => {
        releaseGlowTimeoutId = null;
        needsRender = true;
      }, releaseMs);
    };

    if (delayAudioRelease > 0) {
      setTimeout(doRelease, delayAudioRelease);
    } else {
      doRelease();
    }

    // Clean up inline transition-duration after transition ends
    topBar.addEventListener(
      'transitionend',
      () => {
        topBar.style.transitionDuration = '';
        botBar.style.transitionDuration = '';
      },
      { once: true },
    );

    removeSplashListeners();
  }

  function splashDown(_e: PointerEvent): void {
    if (splashPointerDown) return; // Ignore multi-touch
    splashPointerDown = true;
    splashDownTime = Date.now();
    // Do NOT preventDefault() — iOS Safari cancels click/touchend if we do,
    // and those are the only events that can unlock audio.
  }

  function splashUp(): void {
    if (!splashPointerDown) return;
    splashPointerDown = false;
    removeSplashListeners();

    // iOS Safari only unlocks audio from touchend/click — NOT pointerup.
    // Warm up + start playback here so AudioContext init happens in a
    // gesture that Safari accepts.
    audio.warmUp();
    const playReady = startPlayback();

    const elapsed = Date.now() - splashDownTime;
    const remaining = Math.max(0, MIN_SUSTAIN_MS - elapsed);

    // Always reveal UI immediately; audio sustains for remainder if needed.
    // Pass the playback promise so release waits for play() to finish.
    splashReveal(remaining, playReady);
  }

  function removeSplashListeners(): void {
    canvasArea.removeEventListener('pointerdown', splashDown);
    canvasArea.removeEventListener('touchend', splashUp);
    canvasArea.removeEventListener('click', splashUp);
  }

  canvasArea.addEventListener('pointerdown', splashDown);
  // iOS Safari: touchend is the qualifying gesture for audio unlock.
  // Desktop fallback: click fires after pointerup on non-touch devices.
  // Do NOT use pointerup — it fires before touchend on iOS, racing the
  // audio unlock and leaving the AudioContext suspended.
  canvasArea.addEventListener('touchend', splashUp);
  canvasArea.addEventListener('click', splashUp);
}

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

// Icon reference for sprite scanner: #tabler-link #tabler-code #tabler-check

function syncShareActive(): void {
  shareBtn.classList.toggle('active', !shareMenu.classList.contains('hidden'));
}

shareBtn.addEventListener('click', (e: MouseEvent) => {
  e.stopPropagation();
  shareMenu.classList.toggle('hidden');
  syncShareActive();
});

document.addEventListener('click', (e: MouseEvent) => {
  if (!shareMenu.contains(e.target as Node) && e.target !== shareBtn) {
    shareMenu.classList.add('hidden');
    syncShareActive();
  }
});

shareMenu.addEventListener('click', async (e: MouseEvent) => {
  const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!btn) return;

  const action = btn.dataset.action;

  if (action === 'share') {
    await copyToClipboard(window.location.href);
  } else if (action === 'embed') {
    const snippet = generateEmbedSnippet(store.data);
    await copyToClipboard(snippet);
  }

  // Briefly swap icon to check mark
  const origSvg = btn.querySelector('svg')!;
  const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  checkSvg.setAttribute('width', '20');
  checkSvg.setAttribute('height', '20');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#tabler-check');
  checkSvg.appendChild(use);
  origSvg.replaceWith(checkSvg);
  setTimeout(() => {
    checkSvg.replaceWith(origSvg);
  }, 1500);
});

// ---- New button ----

document.getElementById('btn-new')!.addEventListener('click', () => {
  if (store.data.voices.length === 0 && store.data.texts.length === 0) return;
  undo.snapshot();
  for (const v of store.data.voices.slice()) {
    store.removeVoice(v.id);
  }
  for (const d of store.data.texts.slice()) {
    store.removeText(d.id);
  }
  setSelection(null);
  needsRender = true;
});

// ---- Splash preview button ----

document.getElementById('btn-splash')!.addEventListener('click', () => {
  localStorage.removeItem(splashKey);
  location.reload();
});
