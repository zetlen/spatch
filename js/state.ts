// state.ts — Sigil data model, undo/redo, state management

import type {
  ShapeType,
  Shape,
  Decoration,
  DecorationType,
  SigilData,
  Envelope,
  Fill,
  NormalizedCoord,
  Degrees,
} from './types.ts';

let _idCounter = 0;
export function genId(prefix = 's'): string {
  return prefix + (++_idCounter).toString(36) + Math.random().toString(36).slice(2, 6);
}

export function createDefaultState(): SigilData {
  return {
    envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    shapes: [],
    decorations: [],
  };
}

function createShape(type: ShapeType, x: NormalizedCoord, y: NormalizedCoord): Shape {
  return {
    id: genId('s'),
    type,
    x,
    y,
    size: 0.12 as NormalizedCoord,
    rotation: 0 as Degrees,
    fill: {
      mode: 'solid',
      h: 200,
      s: 80,
      l: 50,
      h2: 180,
      s2: 80,
      l2: 45,
      gradAngle: 0,
    },
    pattern: null,
  };
}

function createDecoration(
  type: DecorationType,
  points: [NormalizedCoord, NormalizedCoord][] | null,
  color?: string,
): Decoration {
  return {
    id: genId('d'),
    type,
    points: points || [],
    text: null,
    targetShapeId: null,
    x: 0 as NormalizedCoord,
    y: 0 as NormalizedCoord,
    scale: 1,
    strokeColor: color || 'hsl(320, 100%, 60%)',
    strokeWidth: 3,
    fontSize: 24,
  };
}

// --- State manager with undo/redo ---

const MAX_UNDO = 50;

export class SigilState {
  data: SigilData;
  undoStack: SigilData[];
  redoStack: SigilData[];
  selectedId: string | null;
  selectedDecoId: string | null;
  listeners: ((data: SigilData) => void)[];

  constructor() {
    this.data = createDefaultState();
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.selectedDecoId = null;
    this.listeners = [];
  }

  onChange(fn: (data: SigilData) => void): void {
    this.listeners.push(fn);
  }

  _notify(): void {
    for (const fn of this.listeners) fn(this.data);
  }

  _snapshot(): SigilData {
    return JSON.parse(JSON.stringify(this.data));
  }

  _pushUndo(): void {
    this.undoStack.push(this._snapshot());
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): void {
    if (!this.undoStack.length) return;
    this.redoStack.push(this._snapshot());
    this.data = this.undoStack.pop()!;
    this._notify();
  }

  redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push(this._snapshot());
    this.data = this.redoStack.pop()!;
    this._notify();
  }

  addShape(type: ShapeType, x: NormalizedCoord, y: NormalizedCoord): Shape {
    this._pushUndo();
    const shape = createShape(type, x, y);
    this.data.shapes.push(shape);
    this.selectedId = shape.id;
    this._notify();
    return shape;
  }

  duplicateShape(id: string, offsetX = 0, offsetY = 0): Shape | null {
    const source = this.getShape(id);
    if (!source) return null;
    return this.pasteShape(source, offsetX, offsetY);
  }

  pasteShape(shapeData: Shape, offsetX = 0, offsetY = 0): Shape {
    this._pushUndo();
    const clone: Shape = JSON.parse(JSON.stringify(shapeData));
    clone.id = genId('s');
    clone.x = Math.max(0, Math.min(1, clone.x + offsetX)) as NormalizedCoord;
    clone.y = Math.max(0, Math.min(1, clone.y + offsetY)) as NormalizedCoord;
    this.data.shapes.push(clone);
    this.selectedId = clone.id;
    this._notify();
    return clone;
  }

  removeShape(id: string): void {
    const idx = this.data.shapes.findIndex((s) => s.id === id);
    if (idx === -1) return;
    this._pushUndo();
    this.data.shapes.splice(idx, 1);
    if (this.selectedId === id) this.selectedId = null;
    this._notify();
  }

  updateShape(id: string, updates: Partial<Shape>): void {
    const shape = this.data.shapes.find((s) => s.id === id);
    if (!shape) return;
    Object.assign(shape, updates);
    this._notify();
  }

  updateShapeWithUndo(id: string, updates: Partial<Shape>): void {
    this._pushUndo();
    this.updateShape(id, updates);
  }

  updateFill(id: string, fillUpdates: Partial<Fill>): void {
    const shape = this.data.shapes.find((s) => s.id === id);
    if (!shape) return;
    Object.assign(shape.fill, fillUpdates);
    this._notify();
  }

  updateFillWithUndo(id: string, fillUpdates: Partial<Fill>): void {
    this._pushUndo();
    this.updateFill(id, fillUpdates);
  }

  getShape(id: string): Shape | undefined {
    return this.data.shapes.find((s) => s.id === id);
  }

  getSelected(): Shape | null {
    return (this.selectedId ? this.getShape(this.selectedId) : null) ?? null;
  }

  moveLayer(id: string, direction: number): void {
    const idx = this.data.shapes.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= this.data.shapes.length) return;
    this._pushUndo();
    const [shape] = this.data.shapes.splice(idx, 1);
    this.data.shapes.splice(newIdx, 0, shape);
    this._notify();
  }

  bringToFront(id: string): void {
    const idx = this.data.shapes.findIndex((s) => s.id === id);
    if (idx === -1 || idx === this.data.shapes.length - 1) return;
    this._pushUndo();
    const [shape] = this.data.shapes.splice(idx, 1);
    this.data.shapes.push(shape);
    this._notify();
  }

  sendToBack(id: string): void {
    const idx = this.data.shapes.findIndex((s) => s.id === id);
    if (idx <= 0) return;
    this._pushUndo();
    const [shape] = this.data.shapes.splice(idx, 1);
    this.data.shapes.unshift(shape);
    this._notify();
  }

  updateEnvelope(updates: Partial<Envelope>): void {
    Object.assign(this.data.envelope, updates);
    this._notify();
  }

  updateEnvelopeWithUndo(updates: Partial<Envelope>): void {
    this._pushUndo();
    this.updateEnvelope(updates);
  }

  addDecoration(
    type: DecorationType,
    points: [NormalizedCoord, NormalizedCoord][] | null,
    color?: string,
  ): Decoration {
    this._pushUndo();
    const deco = createDecoration(type, points, color);
    this.data.decorations.push(deco);
    this._notify();
    return deco;
  }

  removeDecoration(id: string): void {
    const idx = this.data.decorations.findIndex((d) => d.id === id);
    if (idx === -1) return;
    this._pushUndo();
    this.data.decorations.splice(idx, 1);
    if (this.selectedDecoId === id) this.selectedDecoId = null;
    this._notify();
  }

  getDecoration(id: string): Decoration | undefined {
    return this.data.decorations.find((d) => d.id === id);
  }

  getSelectedDeco(): Decoration | null {
    return (this.selectedDecoId ? this.getDecoration(this.selectedDecoId) : null) ?? null;
  }

  updateDecoration(id: string, updates: Partial<Decoration>): void {
    const deco = this.getDecoration(id);
    if (!deco) return;
    Object.assign(deco, updates);
    this._notify();
  }

  loadState(data: SigilData): void {
    this.data = data;
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.selectedDecoId = null;
    this._notify();
  }
}
