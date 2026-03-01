// state.ts — Sigil data model, undo/redo, state management

import {
  normalizedCoord,
  degrees,
  createDefaultFill,
  type ShapeType,
  type Shape,
  type Decoration,
  type SquiggleDecoration,
  type CurlicueDecoration,
  type TextDecoration,
  type SigilData,
  type Envelope,
  type Fill,
  type NormalizedCoord,
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
    size: normalizedCoord(0.12),
    rotation: degrees(0),
    fill: createDefaultFill(),
    pattern: null,
  };
}

function createSquiggle(
  points: [NormalizedCoord, NormalizedCoord][],
  color?: string,
): SquiggleDecoration {
  return {
    id: genId('d'),
    type: 'squiggle',
    points,
    targetShapeId: null,
    strokeColor: color || 'hsl(320, 100%, 60%)',
    strokeWidth: 3,
  };
}

function createCurlicue(
  x: NormalizedCoord,
  y: NormalizedCoord,
  color?: string,
): CurlicueDecoration {
  return {
    id: genId('d'),
    type: 'curlicue',
    x,
    y,
    scale: 1,
    targetShapeId: null,
    strokeColor: color || 'hsl(280, 100%, 65%)',
    strokeWidth: 3,
  };
}

function createTextDeco(
  text: string,
  x: NormalizedCoord,
  y: NormalizedCoord,
  color?: string,
): TextDecoration {
  return {
    id: genId('d'),
    type: 'text',
    text,
    x,
    y,
    scale: 1,
    fontSize: 24,
    targetShapeId: null,
    strokeColor: color || 'hsl(50, 100%, 60%)',
    strokeWidth: 3,
  };
}

// --- Pure data store (CRUD + change notification, no undo, no selection) ---

export class SigilStore {
  data: SigilData;
  private listeners: ((data: SigilData) => void)[];

  constructor(initial?: SigilData) {
    this.data = initial ?? createDefaultState();
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

  addShape(type: ShapeType, x: NormalizedCoord, y: NormalizedCoord): Shape {
    const shape = createShape(type, x, y);
    this.data.shapes.push(shape);
    this._notify();
    return shape;
  }

  pasteShape(shapeData: Shape, offsetX = 0, offsetY = 0): Shape {
    const clone: Shape = JSON.parse(JSON.stringify(shapeData));
    clone.id = genId('s');
    clone.x = normalizedCoord(clone.x + offsetX);
    clone.y = normalizedCoord(clone.y + offsetY);
    this.data.shapes.push(clone);
    this._notify();
    return clone;
  }

  duplicateShape(id: string, offsetX = 0, offsetY = 0): Shape | null {
    const source = this.getShape(id);
    if (!source) return null;
    return this.pasteShape(source, offsetX, offsetY);
  }

  removeShape(id: string): void {
    const idx = this.data.shapes.findIndex((s) => s.id === id);
    if (idx === -1) return;
    this.data.shapes.splice(idx, 1);
    this._notify();
  }

  updateShape(id: string, updates: Partial<Shape>): void {
    const shape = this.data.shapes.find((s) => s.id === id);
    if (!shape) return;
    Object.assign(shape, updates);
    this._notify();
  }

  updateFill(id: string, fill: Fill): void {
    const shape = this.data.shapes.find((s) => s.id === id);
    if (!shape) return;
    shape.fill = fill;
    this._notify();
  }

  getShape(id: string): Shape | undefined {
    return this.data.shapes.find((s) => s.id === id);
  }

  moveLayer(id: string, direction: number): void {
    const idx = this.data.shapes.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= this.data.shapes.length) return;
    const [shape] = this.data.shapes.splice(idx, 1);
    this.data.shapes.splice(newIdx, 0, shape);
    this._notify();
  }

  bringToFront(id: string): void {
    const idx = this.data.shapes.findIndex((s) => s.id === id);
    if (idx === -1 || idx === this.data.shapes.length - 1) return;
    const [shape] = this.data.shapes.splice(idx, 1);
    this.data.shapes.push(shape);
    this._notify();
  }

  sendToBack(id: string): void {
    const idx = this.data.shapes.findIndex((s) => s.id === id);
    if (idx <= 0) return;
    const [shape] = this.data.shapes.splice(idx, 1);
    this.data.shapes.unshift(shape);
    this._notify();
  }

  updateEnvelope(updates: Partial<Envelope>): void {
    Object.assign(this.data.envelope, updates);
    this._notify();
  }

  addDecoration(deco: Decoration): Decoration {
    this.data.decorations.push(deco);
    this._notify();
    return deco;
  }

  addSquiggle(points: [NormalizedCoord, NormalizedCoord][], color?: string): SquiggleDecoration {
    const deco = createSquiggle(points, color);
    return this.addDecoration(deco) as SquiggleDecoration;
  }

  addCurlicue(x: NormalizedCoord, y: NormalizedCoord, color?: string): CurlicueDecoration {
    const deco = createCurlicue(x, y, color);
    return this.addDecoration(deco) as CurlicueDecoration;
  }

  addTextDeco(
    text: string,
    x: NormalizedCoord,
    y: NormalizedCoord,
    color?: string,
  ): TextDecoration {
    const deco = createTextDeco(text, x, y, color);
    return this.addDecoration(deco) as TextDecoration;
  }

  removeDecoration(id: string): void {
    const idx = this.data.decorations.findIndex((d) => d.id === id);
    if (idx === -1) return;
    this.data.decorations.splice(idx, 1);
    this._notify();
  }

  getDecoration(id: string): Decoration | undefined {
    return this.data.decorations.find((d) => d.id === id);
  }

  updateDecoration(id: string, updates: Partial<Decoration>): void {
    const deco = this.getDecoration(id);
    if (!deco) return;
    Object.assign(deco, updates);
    this._notify();
  }

  loadState(data: SigilData): void {
    this.data = data;
    this._notify();
  }
}

// --- Undo/redo manager (wraps a SigilStore) ---

const MAX_UNDO = 50;

export class UndoManager {
  store: SigilStore;
  undoStack: SigilData[];
  redoStack: SigilData[];

  constructor(store: SigilStore) {
    this.store = store;
    this.undoStack = [];
    this.redoStack = [];
  }

  snapshot(): void {
    this.undoStack.push(this.store._snapshot());
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): void {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.store._snapshot());
    this.store.data = this.undoStack.pop()!;
    this.store._notify();
  }

  redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.store._snapshot());
    this.store.data = this.redoStack.pop()!;
    this.store._notify();
  }

  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
