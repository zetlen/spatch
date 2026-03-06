// State.ts — Sigil data model, undo/redo, state management
//
// Uses @preact/signals-core for reactive state. All mutations are immutable:
// each method creates a new state reference so the signal detects changes.

import { effect, signal } from '@preact/signals-core';

import {
  type Envelope,
  type Fill,
  type NormalizedCoord,
  type Reverb,
  type SigilData,
  type Voice,
  type WaveformType,
  normalizedCoord,
} from './types.ts';
import { createRandomFill } from './colors.ts';
import { DEFAULT_BLEND } from './effects.ts';

let _idCounter = 0;
/**
 * Generate a unique ID with the given prefix (e.g. 'v' for voices).
 * @param prefix - ID prefix character (default 's')
 * @returns A string like 'v1a3f' combining a counter and random suffix
 */
export function genId(prefix = 's'): string {
  return prefix + (++_idCounter).toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Create a fresh empty SigilData with default envelope and no voices/reverb. */
export function createDefaultState(): SigilData {
  return {
    envelope: { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
    reverb: undefined,
    voices: [],
  };
}

function createVoice(waveform: WaveformType, x: NormalizedCoord, y: NormalizedCoord): Voice {
  const base = {
    blend: DEFAULT_BLEND,
    border: undefined as Voice['border'],
    effect: undefined as Voice['effect'],
    fill: createRandomFill(),
    id: genId('v'),
    size: normalizedCoord(0.25),
    x,
    y,
  };
  switch (waveform) {
    case 'sine': {
      return { ...base, waveform: 'sine' };
    }
    case 'pulse': {
      return { ...base, timbre: normalizedCoord(0), waveform: 'pulse' };
    }
    case 'blend': {
      return { ...base, timbre: normalizedCoord(0), waveform: 'blend' };
    }
  }
}

// --- Pure data store (CRUD + reactive signal, no undo, no selection) ---

/**
 * Reactive data store for sigil state. Backed by a @preact/signals-core signal.
 * All mutations create new immutable state references so signal subscribers detect changes.
 */
export class SigilStore {
  private _data = signal<SigilData>(createDefaultState());

  constructor(initial?: SigilData) {
    if (initial) {
      this._data.value = initial;
    }
  }

  /** Read current state. Returns the signal's value (immutable reference). */
  get data(): SigilData {
    return this._data.value;
  }

  /**
   * Subscribe to state changes. The callback fires whenever the signal value
   * changes (i.e. on every mutation). Returns a dispose function to unsubscribe.
   *
   * Note: the callback does NOT fire immediately on subscription (matching the
   * old listener-based behavior). Only subsequent signal changes trigger it.
   */
  onChange(fn: (data: SigilData) => void): () => void {
    let first = true;
    return effect(() => {
      const data = this._data.value;
      if (first) {
        first = false;
        return;
      }
      fn(data);
    });
  }

  /**
   * Create and add a new voice at the given position.
   * @param waveform - Shape/waveform type for the new voice
   * @param x - Normalized X position (0-1)
   * @param y - Normalized Y position (0-1)
   * @returns The newly created voice
   */
  addVoice(waveform: WaveformType, x: NormalizedCoord, y: NormalizedCoord): Voice {
    const voice = createVoice(waveform, x, y);
    this._data.value = {
      ...this._data.value,
      voices: [...this._data.value.voices, voice],
    };
    return voice;
  }

  /**
   * Clone and add a voice with a new ID and optional position offset.
   * @param voiceData - Source voice to clone
   * @param offsetX - Horizontal offset to apply (default 0)
   * @param offsetY - Vertical offset to apply (default 0)
   * @returns The pasted voice clone
   */
  pasteVoice(voiceData: Voice, offsetX = 0, offsetY = 0): Voice {
    const clone: Voice = structuredClone(voiceData);
    clone.id = genId('v');
    clone.x = normalizedCoord(clone.x + offsetX);
    clone.y = normalizedCoord(clone.y + offsetY);
    this._data.value = {
      ...this._data.value,
      voices: [...this._data.value.voices, clone],
    };
    return clone;
  }

  /**
   * Duplicate an existing voice by ID with an optional position offset.
   * @param id - ID of the voice to duplicate
   * @param offsetX - Horizontal offset (default 0)
   * @param offsetY - Vertical offset (default 0)
   * @returns The duplicated voice, or undefined if the source was not found
   */
  duplicateVoice(id: string, offsetX = 0, offsetY = 0): Voice | undefined {
    const source = this.getVoice(id);
    if (!source) {
      return;
    }
    return this.pasteVoice(source, offsetX, offsetY);
  }

  /** Remove a voice by ID. No-op if the ID is not found. */
  removeVoice(id: string): void {
    const voices = this._data.value.voices;
    const idx = voices.findIndex((s) => s.id === id);
    if (idx === -1) {
      return;
    }
    this._data.value = {
      ...this._data.value,
      voices: voices.filter((s) => s.id !== id),
    };
  }

  /** Merge partial updates into a voice by ID. No-op if the ID is not found. */
  updateVoice(id: string, updates: Partial<Voice>): void {
    const voices = this._data.value.voices;
    const idx = voices.findIndex((s) => s.id === id);
    if (idx === -1) {
      return;
    }
    this._data.value = {
      ...this._data.value,
      voices: voices.map((v) => (v.id === id ? ({ ...v, ...updates } as Voice) : v)),
    };
  }

  /** Update a voice's fill by ID. Shorthand for `updateVoice(id, { fill })`. */
  updateFill(id: string, fill: Fill): void {
    this.updateVoice(id, { fill });
  }

  /** Look up a voice by ID, or undefined if not found. */
  getVoice(id: string): Voice | undefined {
    return this._data.value.voices.find((s) => s.id === id);
  }

  /** Merge partial updates into the ADSR envelope. */
  updateEnvelope(updates: Partial<Envelope>): void {
    this._data.value = {
      ...this._data.value,
      envelope: { ...this._data.value.envelope, ...updates },
    };
  }

  /** Set or clear the global reverb effect. Pass undefined to remove reverb. */
  updateReverb(reverb: Reverb | undefined): void {
    this._data.value = {
      ...this._data.value,
      reverb,
    };
  }

  /** Replace the entire state with the given SigilData. */
  loadState(data: SigilData): void {
    this._data.value = data;
  }
}

// --- Selection manager (app-level, not serialized or undoable) ---

/**
 * App-level selection state for voices. Not part of the SigilStore data model
 * (doesn't serialize or participate in undo/redo). Backed by a signal —
 * subscribers use effect() to react to selection changes.
 */
export class SelectionManager {
  private _voiceId = signal<string | undefined>(undefined);

  constructor(private store: SigilStore) {}

  /** Currently selected voice ID, or undefined if no voice is selected. */
  get voiceId(): string | undefined {
    return this._voiceId.value;
  }

  /** Set the current selection to a voice ID, or undefined to clear. */
  select(voiceId?: string): void {
    this._voiceId.value = voiceId;
  }

  /** Clear the selection. */
  clear(): void {
    this.select(undefined);
  }

  /** Returns the currently selected Voice, or undefined if none is selected. */
  getSelectedVoice(): Voice | undefined {
    return this._voiceId.value
      ? (this.store.getVoice(this._voiceId.value) ?? undefined)
      : undefined;
  }
}

// --- Undo/redo manager (wraps a SigilStore) ---
//
// With immutable state, snapshots are just previous signal values — no need
// for structuredClone. The signal holds a new reference on each mutation, so
// saving the old .data reference captures the entire state.

const MAX_UNDO = 50;

/**
 * Undo/redo manager wrapping a SigilStore. Takes JSON-style snapshots of
 * immutable state references before mutations so undo restores previous values.
 */
export class UndoManager {
  store: SigilStore;
  undoStack: SigilData[];
  redoStack: SigilData[];

  constructor(store: SigilStore) {
    this.store = store;
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Save the current state to the undo stack. Call before a mutation to make it undoable. */
  snapshot(): void {
    this.undoStack.push(this.store.data);
    if (this.undoStack.length > MAX_UNDO) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  /** Restore the most recent snapshot from the undo stack. No-op if stack is empty. */
  undo(): void {
    if (this.undoStack.length === 0) {
      return;
    }
    this.redoStack.push(this.store.data);
    this.store.loadState(this.undoStack.pop()!);
  }

  /** Re-apply the most recently undone state. No-op if redo stack is empty. */
  redo(): void {
    if (this.redoStack.length === 0) {
      return;
    }
    this.undoStack.push(this.store.data);
    this.store.loadState(this.redoStack.pop()!);
  }

  /** Clear both undo and redo stacks. */
  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
