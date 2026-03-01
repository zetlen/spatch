// state.js — Sigil data model, undo/redo, state management

let _idCounter = 0;
function genId(prefix = 's') {
  return prefix + (++_idCounter).toString(36) + Math.random().toString(36).slice(2, 6);
}

export function createDefaultState() {
  return {
    envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    shapes: [],
    decorations: [],
  };
}

function createShape(type, x, y) {
  return {
    id: genId('s'),
    type, // "circle" | "triangle" | "square"
    x,
    y, // normalized 0–1
    size: 0.12, // normalized
    rotation: 0, // degrees 0–360
    fill: {
      mode: 'solid', // "solid" | "radial" | "linear"
      h: 200,
      s: 80,
      l: 50,
      // stop 2 (radial outer, linear end)
      h2: 180,
      s2: 80,
      l2: 45,
      // linear gradient angle
      gradAngle: 0,
    },
    pattern: null, // null | "stripes" | "checker" | "noise" | "gradient" | "rough"
  };
}

function createDecoration(type, points, color) {
  return {
    id: genId('d'),
    type,
    points: points || [],
    text: null,
    targetShapeId: null,
    x: 0,
    y: 0,
    strokeColor: color || 'hsl(320, 100%, 60%)',
    strokeWidth: 3,
    fontSize: 24,
  };
}

// --- State manager with undo/redo ---

const MAX_UNDO = 50;

export class SigilState {
  constructor() {
    this.data = createDefaultState();
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.listeners = [];
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  _notify() {
    for (const fn of this.listeners) fn(this.data);
  }

  _snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }

  _pushUndo() {
    this.undoStack.push(this._snapshot());
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this._snapshot());
    this.data = this.undoStack.pop();
    this._notify();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this._snapshot());
    this.data = this.redoStack.pop();
    this._notify();
  }

  addShape(type, x, y) {
    this._pushUndo();
    const shape = createShape(type, x, y);
    this.data.shapes.push(shape);
    this.selectedId = shape.id;
    this._notify();
    return shape;
  }

  removeShape(id) {
    const idx = this.data.shapes.findIndex((s) => s.id === id);
    if (idx === -1) return;
    this._pushUndo();
    this.data.shapes.splice(idx, 1);
    if (this.selectedId === id) this.selectedId = null;
    this._notify();
  }

  updateShape(id, updates) {
    const shape = this.data.shapes.find((s) => s.id === id);
    if (!shape) return;
    Object.assign(shape, updates);
    this._notify();
  }

  updateShapeWithUndo(id, updates) {
    this._pushUndo();
    this.updateShape(id, updates);
  }

  updateFill(id, fillUpdates) {
    const shape = this.data.shapes.find((s) => s.id === id);
    if (!shape) return;
    Object.assign(shape.fill, fillUpdates);
    this._notify();
  }

  updateFillWithUndo(id, fillUpdates) {
    this._pushUndo();
    this.updateFill(id, fillUpdates);
  }

  getShape(id) {
    return this.data.shapes.find((s) => s.id === id);
  }

  getSelected() {
    return this.selectedId ? this.getShape(this.selectedId) : null;
  }

  moveLayer(id, direction) {
    const idx = this.data.shapes.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= this.data.shapes.length) return;
    this._pushUndo();
    const [shape] = this.data.shapes.splice(idx, 1);
    this.data.shapes.splice(newIdx, 0, shape);
    this._notify();
  }

  bringToFront(id) {
    const idx = this.data.shapes.findIndex((s) => s.id === id);
    if (idx === -1 || idx === this.data.shapes.length - 1) return;
    this._pushUndo();
    const [shape] = this.data.shapes.splice(idx, 1);
    this.data.shapes.push(shape);
    this._notify();
  }

  sendToBack(id) {
    const idx = this.data.shapes.findIndex((s) => s.id === id);
    if (idx <= 0) return;
    this._pushUndo();
    const [shape] = this.data.shapes.splice(idx, 1);
    this.data.shapes.unshift(shape);
    this._notify();
  }

  updateEnvelope(updates) {
    Object.assign(this.data.envelope, updates);
    this._notify();
  }

  updateEnvelopeWithUndo(updates) {
    this._pushUndo();
    this.updateEnvelope(updates);
  }

  addDecoration(type, points, color) {
    this._pushUndo();
    const deco = createDecoration(type, points, color);
    this.data.decorations.push(deco);
    this._notify();
    return deco;
  }

  removeDecoration(id) {
    const idx = this.data.decorations.findIndex((d) => d.id === id);
    if (idx === -1) return;
    this._pushUndo();
    this.data.decorations.splice(idx, 1);
    this._notify();
  }

  loadState(data) {
    this.data = data;
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this._notify();
  }
}
