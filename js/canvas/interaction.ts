// canvas/interaction.ts — Pointer event handling for the SVG canvas.
//
// Owns all pointer-down/move/up/cancel handlers, the InteractionState machine,
// multi-touch pinch-rotate, shape hit testing, handle interactions,
// and ADSR corner dragging. Dependencies are injected via the constructor.

import { hardSnapYToNote, rotationToTimbre, snapYToNote } from '../audio/mapping.ts';
import {
  clampSize,
  dragToEnvelopeValue,
  hitTestADSRCorner,
  isInClippedCorner,
  voiceRotation,
} from '../shapes.ts';
import type { SelectionManager, SigilStore, UndoManager } from '../state.ts';
import {
  type ADSRCorner,
  type Envelope,
  type HandleType,
  type NormalizedCoord,
  normalizedCoord,
} from '../types.ts';
import { all, get, hasTimbre } from '../voices/registry.ts';

// ---- Interaction state machine ----
//
// Discriminated union replacing scattered mode/drag/handle variables.
// Each mode carries its own data — no accessing fields that don't exist.

export type InteractionState =
  | { mode: 'idle' }
  | {
      mode: 'dragging';
      pointerId: number;
      origin: { x: number; y: number };
      startNx: number;
      startNy: number;
    }
  | {
      mode: 'resizing';
      pointerId: number;
      handle: HandleType;
      origin: { size: number; timbre: number; trigger: number };
      /** Angle from voice center to the handle at drag start (radians). */
      startAngle: number;
      /** Distance from voice center to the pointer at drag start. */
      startDist: number;
      cx: number;
      cy: number;
    }
  | {
      mode: 'adsr';
      pointerId: number;
      corner: ADSRCorner;
      origin: Envelope;
      startPx: number;
      startPy: number;
    }
  | {
      mode: 'pinch-rotate';
      pointerA: number;
      pointerB: number;
      positions: Map<number, { x: number; y: number }>;
      initDist: number;
      initAngle: number;
      initSize: number;
      initRotation: number;
      shapeId: string;
    };

const IDLE: InteractionState = { mode: 'idle' };

// ---- SVG coordinate helpers ----

interface NormCoords {
  nx: number;
  ny: number;
}

function svgCoordsFromClient(canvas: SVGSVGElement, clientX: number, clientY: number): NormCoords {
  const pt = canvas.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = canvas.getScreenCTM();
  if (!ctm) {
    return { nx: 0, ny: 0 };
  }
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { nx: svgPt.x, ny: svgPt.y };
}

function svgCoordsFromEvent(canvas: SVGSVGElement, e: PointerEvent): NormCoords {
  return svgCoordsFromClient(canvas, e.clientX, e.clientY);
}

// ---- Tool-to-waveform map ----

const toolToWaveform = new Map(all().map((e) => [e.ui.shapeName, e.waveform] as const));

// ---- ADSR corner drag helpers ----

const INV_SQRT2 = 1 / Math.sqrt(2);

function cornerDiagonal(corner: ADSRCorner): { dx: number; dy: number } {
  switch (corner) {
    case 'attack': {
      return { dx: 1, dy: -1 };
    }
    case 'decay': {
      return { dx: 1, dy: 1 };
    }
    case 'sustain': {
      return { dx: -1, dy: 1 };
    }
    case 'release': {
      return { dx: -1, dy: -1 };
    }
  }
}

function envelopeValueToDist(corner: ADSRCorner, val: number): number {
  const maxR = 0.15; // Matches MAX_RADIUS_RATIO in envelope.ts (canvasSize=1)
  switch (corner) {
    case 'attack':
    case 'decay': {
      return (val / 2) * maxR;
    }
    case 'sustain': {
      return val * maxR;
    }
    case 'release': {
      return (val / 3) * maxR;
    }
  }
}

// ---- Pinch helpers ----

function pointerDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointerAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// ---- Dependency interfaces ----

export interface ToolbarDeps {
  readonly currentTool: string;
}

export interface InteractionDeps {
  canvasWrap: HTMLElement;
  stage: HTMLElement;
  canvas: SVGSVGElement;
  store: SigilStore;
  undo: UndoManager;
  selection: SelectionManager;
  toolbar: ToolbarDeps;
  requestRender(): void;
  addVoiceFromTool(tool: string, x: NormalizedCoord, y: NormalizedCoord): void;
}

// ---- Controller ----

export class CanvasInteractionController {
  private interaction: InteractionState = IDLE;
  private activePointers = new Map<number, { x: number; y: number }>();
  /** Touch pointer that landed on empty canvas — deselect deferred to pointerup so pinch can start */
  private pendingTouchDeselect: number | null = null;

  private readonly canvasWrap: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly canvas: SVGSVGElement;
  private readonly store: SigilStore;
  private readonly undo: UndoManager;
  private readonly selection: SelectionManager;
  private readonly toolbar: ToolbarDeps;
  private readonly requestRender: () => void;
  private readonly addVoiceFromTool: (tool: string, x: NormalizedCoord, y: NormalizedCoord) => void;

  // Bound handlers for cleanup
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerEnd: (e: PointerEvent) => void;
  private boundAreaPointerDown: (e: PointerEvent) => void;
  private boundCycleSelection: (e: MouseEvent) => void;
  private boundForcePressCycle: (e: Event) => void;

  constructor(deps: InteractionDeps) {
    this.canvasWrap = deps.canvasWrap;
    this.stage = deps.stage;
    this.canvas = deps.canvas;
    this.store = deps.store;
    this.undo = deps.undo;
    this.selection = deps.selection;
    this.toolbar = deps.toolbar;
    this.requestRender = deps.requestRender;
    this.addVoiceFromTool = deps.addVoiceFromTool;

    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerEnd = this.handlePointerEnd.bind(this);
    this.boundAreaPointerDown = this.handleAreaPointerDown.bind(this);
    this.boundCycleSelection = this.handleCycleSelection.bind(this);
    this.boundForcePressCycle = (e: Event) => this.handleCycleSelection(e as MouseEvent);
  }

  bindEvents(): void {
    this.canvasWrap.addEventListener('pointerdown', this.boundPointerDown);
    this.canvasWrap.addEventListener('pointermove', this.boundPointerMove);
    this.canvasWrap.addEventListener('pointerup', this.boundPointerEnd);
    this.canvasWrap.addEventListener('pointercancel', this.boundPointerEnd);
    this.stage.addEventListener('pointerdown', this.boundAreaPointerDown);
    this.canvas.addEventListener('dblclick', this.boundCycleSelection);
    this.canvas.addEventListener('webkitmouseforcedown', this.boundForcePressCycle);
  }

  dispose(): void {
    this.canvasWrap.removeEventListener('pointerdown', this.boundPointerDown);
    this.canvasWrap.removeEventListener('pointermove', this.boundPointerMove);
    this.canvasWrap.removeEventListener('pointerup', this.boundPointerEnd);
    this.canvasWrap.removeEventListener('pointercancel', this.boundPointerEnd);
    this.stage.removeEventListener('pointerdown', this.boundAreaPointerDown);
    this.canvas.removeEventListener('dblclick', this.boundCycleSelection);
    this.canvas.removeEventListener('webkitmouseforcedown', this.boundForcePressCycle);
  }

  // ---- Selection cycling (double-click / force-press) ----

  private handleCycleSelection(e: MouseEvent): void {
    const voiceEl = (e.target as Element).closest?.('[data-voice-id]');
    if (!voiceEl) return;

    const voiceLayer = this.canvas.querySelector('g[data-layer="voices"]');
    if (!voiceLayer) return;

    const group = voiceEl.closest('g[data-voice-id]') as SVGGElement | null;
    if (!group) return;

    // Send topmost shape to back
    voiceLayer.prepend(group);

    // Find what's now on top at this point
    const newTop = document.elementFromPoint(e.clientX, e.clientY);
    const newVoiceEl = newTop?.closest?.('[data-voice-id]');
    const newId = newVoiceEl
      ? ((newVoiceEl as HTMLElement).dataset.voiceId ?? undefined)
      : undefined;

    if (newId && newId !== group.dataset.voiceId) {
      this.selection.select(newId);
    }
    // If same element or no element, the shape stays selected (no-op)

    this.requestRender();
  }

  // ---- Background deselect ----

  private handleAreaPointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    if (target === this.stage) {
      // Touch deselect is deferred to pointerup (handled in handlePointerDown)
      if (e.pointerType !== 'touch') {
        this.selection.clear();
        this.requestRender();
      }
    }
  }

  // ---- ADSR drag ----

  private handleADSRDrag(nx: number, ny: number): void {
    if (this.interaction.mode !== 'adsr') {
      return;
    }
    const diag = cornerDiagonal(this.interaction.corner);
    const moveDx = nx - this.interaction.startPx;
    const moveDy = ny - this.interaction.startPy;
    const projectedDelta = (moveDx * diag.dx + moveDy * diag.dy) * INV_SQRT2;
    const originDist = envelopeValueToDist(
      this.interaction.corner,
      this.interaction.origin[this.interaction.corner],
    );
    const newDist = Math.max(0, originDist + projectedDelta);
    const val = dragToEnvelopeValue(this.interaction.corner, newDist);
    this.store.updateEnvelope({ [this.interaction.corner]: val });
  }

  // ---- Pointer down ----

  private handlePointerDown(e: PointerEvent): void {
    e.preventDefault();

    const { nx, ny } = svgCoordsFromEvent(this.canvas, e);
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two touch pointers -> pinch-rotate
    if (e.pointerType === 'touch' && this.activePointers.size === 2) {
      // Cancel any single-touch interaction in progress
      if (this.interaction.mode !== 'idle') {
        this.interaction = IDLE;
      }
      // Cancel pending deselect — a pinch is starting
      this.pendingTouchDeselect = null;

      const [idA, posA] = [...this.activePointers.entries()][0]!;
      const [idB, posB] = [...this.activePointers.entries()][1]!;

      // For pinch, use the currently selected voice as target
      const shapeId = this.selection.voiceId;
      if (!shapeId) {
        return;
      }

      const voice = this.store.getVoice(shapeId);
      if (!voice) {
        return;
      }

      this.selection.select(shapeId);
      this.undo.snapshot();

      const initRotation = voiceRotation(voice);
      this.interaction = {
        initAngle: pointerAngle(posA, posB),
        initDist: pointerDist(posA, posB),
        initRotation,
        initSize: voice.size,
        mode: 'pinch-rotate',
        pointerA: idA,
        pointerB: idB,
        positions: new Map(this.activePointers),
        shapeId,
      };
      this.canvasWrap.setPointerCapture(idA);
      this.canvasWrap.setPointerCapture(idB);
      this.requestRender();
      return;
    }

    const tool = this.toolbar.currentTool;

    // Shape (voice) placement tools
    const waveform = toolToWaveform.get(tool);
    if (waveform) {
      this.addVoiceFromTool(tool, normalizedCoord(nx), hardSnapYToNote(normalizedCoord(ny)));
      return;
    }

    // Select mode -- skip shape hit testing in clipped corner regions
    const inClippedCorner = isInClippedCorner(this.store.data.envelope, nx, ny, 1);

    if (!inClippedCorner) {
      // 1. Check handles on selected voice (SVG native hit testing)
      const handleEl = (e.target as Element).closest?.('[data-handle]');
      const handle = handleEl
        ? (((handleEl as HTMLElement).dataset.handle as HandleType) ?? undefined)
        : undefined;

      if (handle) {
        const selVoice = this.selection.getSelectedVoice();
        if (selVoice) {
          const cx = selVoice.x as number;
          const cy = selVoice.y as number;
          const timbre = 'timbre' in selVoice ? (selVoice.timbre as number) : 0;
          const trigger = 'trigger' in selVoice ? (selVoice as { trigger: number }).trigger : 1;
          this.undo.snapshot();
          this.interaction = {
            cx,
            cy,
            handle: handle as HandleType,
            mode: 'resizing',
            origin: { size: selVoice.size, timbre, trigger },
            pointerId: e.pointerId,
            startAngle: Math.atan2(ny - cy, nx - cx),
            startDist: Math.hypot(nx - cx, ny - cy),
          };
          this.canvasWrap.setPointerCapture(e.pointerId);
          return;
        }
      }

      // 2. Hit test voices (SVG native)
      const voiceEl = (e.target as Element).closest?.('[data-voice-id]');
      const hitId = voiceEl ? ((voiceEl as HTMLElement).dataset.voiceId ?? undefined) : undefined;
      if (hitId) {
        this.selection.select(hitId);

        this.undo.snapshot();
        const voice = this.store.getVoice(hitId)!;
        this.interaction = {
          mode: 'dragging',
          origin: { x: voice.x, y: voice.y },
          pointerId: e.pointerId,
          startNx: nx,
          startNy: ny,
        };
        this.canvasWrap.setPointerCapture(e.pointerId);
        this.requestRender();
        return;
      }
    }

    // 3. Check ADSR corners
    const adsrCorner = hitTestADSRCorner(this.store.data.envelope, nx, ny, 1);
    if (adsrCorner) {
      this.undo.snapshot();
      this.interaction = {
        corner: adsrCorner,
        mode: 'adsr',
        origin: { ...this.store.data.envelope },
        pointerId: e.pointerId,
        startPx: nx,
        startPy: ny,
      };
      this.canvasWrap.setPointerCapture(e.pointerId);
      return;
    }

    // 4. Deselect — for touch, defer to pointerup so pinch can still start
    if (!inClippedCorner) {
      if (e.pointerType === 'touch') {
        this.pendingTouchDeselect = e.pointerId;
      } else {
        this.selection.clear();
        this.requestRender();
      }
    }
  }

  // ---- Pointer move ----

  private handlePointerMove(e: PointerEvent): void {
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Pinch-rotate: compute from two stored positions
    if (this.interaction.mode === 'pinch-rotate') {
      this.interaction.positions.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const posA = this.interaction.positions.get(this.interaction.pointerA);
      const posB = this.interaction.positions.get(this.interaction.pointerB);
      if (!posA || !posB) {
        return;
      }

      const dist = pointerDist(posA, posB);
      const angle = pointerAngle(posA, posB);
      const scale = dist / this.interaction.initDist;
      const newSize = clampSize(this.interaction.initSize * scale);

      const voice = this.store.getVoice(this.interaction.shapeId);
      if (!voice) {
        return;
      }

      if (!hasTimbre(voice.waveform)) {
        this.store.updateVoice(this.interaction.shapeId, { size: newSize });
      } else {
        const angleDelta = angle - this.interaction.initAngle;
        const newRotation = (((this.interaction.initRotation + angleDelta) % 360) + 360) % 360;
        const timbre = rotationToTimbre(newRotation, voice.waveform);
        this.store.updateVoice(this.interaction.shapeId, {
          size: newSize,
          timbre: normalizedCoord(timbre),
        });
      }
      return;
    }

    // Filter by pointerId for single-pointer interactions
    if (
      this.interaction.mode !== 'idle' &&
      'pointerId' in this.interaction &&
      this.interaction.pointerId !== e.pointerId
    ) {
      return;
    }

    const { nx, ny } = svgCoordsFromEvent(this.canvas, e);

    if (this.interaction.mode === 'dragging') {
      const voice = this.selection.getSelectedVoice();
      if (!voice) {
        return;
      }
      const dx = nx - this.interaction.startNx;
      const dy = ny - this.interaction.startNy;
      this.store.updateVoice(voice.id, {
        x: normalizedCoord(this.interaction.origin.x + dx),
        y: snapYToNote(normalizedCoord(this.interaction.origin.y + dy)),
      });
      return;
    }

    if (this.interaction.mode === 'resizing') {
      const voice = this.selection.getSelectedVoice();
      if (!voice) {
        return;
      }

      // Decompose pointer motion into radial (resize) and tangential (rotate)
      // components relative to the voice center.
      const { cx, cy } = this.interaction;
      const curAngle = Math.atan2(ny - cy, nx - cx);
      const curDist = Math.hypot(nx - cx, ny - cy);

      // Radial: distance change → resize
      const distDelta = curDist - this.interaction.startDist;
      const newSize = clampSize(this.interaction.origin.size + distDelta * 2);
      const updates: Record<string, unknown> = { size: newSize };

      // Tangential: angle change → rotation/timbre/trigger
      const angleDelta = curAngle - this.interaction.startAngle;
      // Normalize to [-π, π]
      const normAngle = Math.atan2(Math.sin(angleDelta), Math.cos(angleDelta));
      const degDelta = (normAngle * 180) / Math.PI;

      if (voice.waveform === 'stamp') {
        // Stamp: snap trigger based on accumulated angle from origin
        const baseTilt = [-5, 0, 5][this.interaction.origin.trigger] ?? 0;
        const newTilt = baseTilt + degDelta;
        const trigger = newTilt <= -2.5 ? 0 : newTilt >= 2.5 ? 2 : 1;
        updates.trigger = trigger as 0 | 1 | 2;
      } else if (hasTimbre(voice.waveform)) {
        const entry = get(voice.waveform);
        const originDeg = this.interaction.origin.timbre * entry.rotationPeriod;
        const newRotation = (((originDeg + degDelta) % 360) + 360) % 360;
        updates.timbre = normalizedCoord(rotationToTimbre(newRotation, voice.waveform));
      }

      this.store.updateVoice(voice.id, updates);
      return;
    }

    if (this.interaction.mode === 'adsr') {
      this.handleADSRDrag(nx, ny);
      return;
    }
  }

  // ---- Pointer end ----

  private handlePointerEnd(e: PointerEvent): void {
    this.activePointers.delete(e.pointerId);

    if (this.interaction.mode === 'pinch-rotate') {
      if (e.pointerId === this.interaction.pointerA || e.pointerId === this.interaction.pointerB) {
        this.interaction = IDLE;
        this.pendingTouchDeselect = null;
        this.requestRender();
      }
      return;
    }

    // Filter by pointerId
    if (
      this.interaction.mode !== 'idle' &&
      'pointerId' in this.interaction &&
      this.interaction.pointerId !== e.pointerId
    ) {
      return;
    }

    // Hard-snap to nearest grid position on drag release
    if (this.interaction.mode === 'dragging') {
      const voice = this.selection.getSelectedVoice();
      if (voice) {
        this.store.updateVoice(voice.id, {
          y: hardSnapYToNote(voice.y),
        });
      }
    }

    // Deferred touch deselect: only fires if no pinch occurred
    if (this.pendingTouchDeselect === e.pointerId) {
      this.pendingTouchDeselect = null;
      this.selection.clear();
      this.requestRender();
    }

    this.interaction = IDLE;
  }
}
