// state.ts — Sigil data model, undo/redo, state management

import {
  normalizedCoord,
  createRandomFill,
  type WaveformType,
  type Voice,
  type TextDecoration,
  type SigilData,
  type Envelope,
  type Fill,
  type NormalizedCoord,
  type BlendMode,
  type Reverb,
} from './types.ts';

let _idCounter = 0;
export function genId(prefix = 's'): string {
  return prefix + (++_idCounter).toString(36) + Math.random().toString(36).slice(2, 6);
}

export function createDefaultState(): SigilData {
  return {
    envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    voices: [],
    texts: [],
    reverb: null,
  };
}

const DEFAULT_BLEND: BlendMode = 'soft-light';

function createVoice(waveform: WaveformType, x: NormalizedCoord, y: NormalizedCoord): Voice {
  const base = {
    id: genId('v'),
    x,
    y,
    size: normalizedCoord(0.2),
    fill: createRandomFill(),
    effect: null as Voice['effect'],
    blend: DEFAULT_BLEND,
    border: null as Voice['border'],
  };
  switch (waveform) {
    case 'sine':
      return { ...base, waveform: 'sine' };
    case 'pulse':
      return { ...base, waveform: 'pulse', timbre: normalizedCoord(0) };
    case 'blend':
      return { ...base, waveform: 'blend', timbre: normalizedCoord(0) };
  }
}

function createTextDeco(text: string, x: NormalizedCoord, y: NormalizedCoord): TextDecoration {
  return {
    id: genId('t'),
    text,
    x,
    y,
    size: normalizedCoord(0.06),
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

  addVoice(waveform: WaveformType, x: NormalizedCoord, y: NormalizedCoord): Voice {
    const voice = createVoice(waveform, x, y);
    this.data.voices.push(voice);
    this._notify();
    return voice;
  }

  pasteVoice(voiceData: Voice, offsetX = 0, offsetY = 0): Voice {
    const clone: Voice = JSON.parse(JSON.stringify(voiceData));
    clone.id = genId('v');
    clone.x = normalizedCoord(clone.x + offsetX);
    clone.y = normalizedCoord(clone.y + offsetY);
    this.data.voices.push(clone);
    this._notify();
    return clone;
  }

  duplicateVoice(id: string, offsetX = 0, offsetY = 0): Voice | null {
    const source = this.getVoice(id);
    if (!source) return null;
    return this.pasteVoice(source, offsetX, offsetY);
  }

  removeVoice(id: string): void {
    const idx = this.data.voices.findIndex((s) => s.id === id);
    if (idx === -1) return;
    this.data.voices.splice(idx, 1);
    this._notify();
  }

  updateVoice(id: string, updates: Partial<Voice>): void {
    const voice = this.data.voices.find((s) => s.id === id);
    if (!voice) return;
    Object.assign(voice, updates);
    this._notify();
  }

  updateFill(id: string, fill: Fill): void {
    const voice = this.data.voices.find((s) => s.id === id);
    if (!voice) return;
    voice.fill = fill;
    this._notify();
  }

  getVoice(id: string): Voice | undefined {
    return this.data.voices.find((s) => s.id === id);
  }

  updateEnvelope(updates: Partial<Envelope>): void {
    Object.assign(this.data.envelope, updates);
    this._notify();
  }

  updateReverb(reverb: Reverb | null): void {
    this.data.reverb = reverb;
    this._notify();
  }

  addText(text: TextDecoration): TextDecoration {
    this.data.texts.push(text);
    this._notify();
    return text;
  }

  addTextDeco(text: string, x: NormalizedCoord, y: NormalizedCoord): TextDecoration {
    const deco = createTextDeco(text, x, y);
    return this.addText(deco);
  }

  removeText(id: string): void {
    const idx = this.data.texts.findIndex((d) => d.id === id);
    if (idx === -1) return;
    this.data.texts.splice(idx, 1);
    this._notify();
  }

  getText(id: string): TextDecoration | undefined {
    return this.data.texts.find((d) => d.id === id);
  }

  updateText(id: string, updates: Partial<TextDecoration>): void {
    const deco = this.getText(id);
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
