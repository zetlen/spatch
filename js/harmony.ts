// Harmony.ts — Musical scale definitions, harmonize, and randomize logic
//
// Harmonize snaps existing voices to a randomly chosen musical scale.
// Randomize creates 5 random voices and then harmonizes them.

import {
  BLEND_MODES,
  type Border,
  type Fill,
  type NormalizedCoord,
  PATTERN_TYPES,
  type Voice,
  normalizedCoord,
} from './types.ts';
import { type SigilStore, type UndoManager } from './state.ts';
import { STAMPLE_COUNT } from './stamples/index.ts';
import { SCENES } from './scenes/index.ts';
import { all, hasTimbre } from './voices/registry.ts';

// ---- Scale definitions ----
// Each scale is defined by its intervals (semitone offsets within one octave).

/** A named musical scale with its semitone intervals within one octave. */
interface Scale {
  name: string;
  intervals: readonly number[];
}

const SCALES: Scale[] = [
  { name: 'major pentatonic', intervals: [0, 2, 4, 7, 9] },
  { name: 'minor pentatonic', intervals: [0, 3, 5, 7, 10] },
  { name: 'mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { name: 'phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  { name: 'dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'natural minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'blues', intervals: [0, 3, 5, 6, 7, 10] },
  { name: 'mu', intervals: [0, 2, 4, 6, 7, 8, 11] },
];

// ---- Semitone ↔ Y coordinate conversion ----
// The canvas maps 37 chromatic semitones (G2–G5) across Y 0–1.
// Y=0 is top (high pitch, semitone 36), Y=1 is bottom (low pitch, semitone 0).
// yToSemitone returns a float to preserve sub-semitone precision for
// accurate nearest-note snapping (rounding would create false ties).

const TOTAL_SEMITONES = 36;

function yToSemitone(y: NormalizedCoord): number {
  return (1 - y) * TOTAL_SEMITONES;
}

function semitoneToY(semitone: number): NormalizedCoord {
  const clamped = Math.max(0, Math.min(TOTAL_SEMITONES, semitone));
  return normalizedCoord(1 - clamped / TOTAL_SEMITONES);
}

// ---- Scale note generation ----

/**
 * Expand a scale's intervals across the full 3-octave range (0–36 semitones),
 * rooted at the given semitone offset (0–11).
 * Returns a sorted array of all valid semitone indices in range.
 */
function scaleNotes(scale: Scale, root: number): number[] {
  const notes: number[] = [];
  for (let octave = -1; octave <= 3; octave++) {
    for (const interval of scale.intervals) {
      const semitone = root + octave * 12 + interval;
      if (semitone >= 0 && semitone <= TOTAL_SEMITONES) {
        notes.push(semitone);
      }
    }
  }
  return [...new Set(notes)].sort((a, b) => a - b);
}

/** Find the nearest semitone in the given sorted array to the target. */
function nearestInScale(target: number, notes: number[]): number {
  let best = notes[0]!;
  let bestDist = Math.abs(target - best);
  for (const n of notes) {
    const dist = Math.abs(target - n);
    if (dist < bestDist || (dist === bestDist && Math.random() < 0.5)) {
      best = n;
      bestDist = dist;
    }
  }
  return best;
}

// ---- Public scale metadata ----

/** Number of available scales. */
export const SCALE_COUNT = SCALES.length;

/** Get the display name of a scale by index. */
export function getScaleName(index: number): string {
  return SCALES[((index % SCALES.length) + SCALES.length) % SCALES.length]!.name;
}

// ---- Core harmonize (no undo) ----

/** Snap all voices to the given scale with a random root. No undo snapshot. */
function applyScale(store: SigilStore, scale: Scale): void {
  const root = Math.floor(Math.random() * 12);
  const notes = scaleNotes(scale, root);
  for (const voice of store.data.voices) {
    const currentSemitone = yToSemitone(voice.y);
    const snapped = nearestInScale(currentSemitone, notes);
    const newY = semitoneToY(snapped);
    if (newY !== voice.y) {
      store.updateVoice(voice.id, { y: newY });
    }
  }
}

// ---- Public API ----

/**
 * Harmonize all voices to a random scale. Pushes one undo snapshot.
 * Returns the chosen scale name.
 */
export function harmonize(store: SigilStore, undo: UndoManager): string {
  const voices = store.data.voices;
  if (voices.length === 0) return '';

  const scale = SCALES[Math.floor(Math.random() * SCALES.length)]!;
  undo.snapshot();
  applyScale(store, scale);
  return scale.name;
}

/**
 * Harmonize all voices to a specific scale by index. Pushes one undo snapshot.
 * Returns the scale name.
 */
export function harmonizeWithScale(
  store: SigilStore,
  undo: UndoManager,
  scaleIndex: number,
): string {
  const voices = store.data.voices;
  if (voices.length === 0) return '';

  const scale = SCALES[((scaleIndex % SCALES.length) + SCALES.length) % SCALES.length]!;
  undo.snapshot();
  applyScale(store, scale);
  return scale.name;
}

/** Create a random linear gradient fill with two distinct hues and a random angle. */
function createRandomLinearFill(): Fill {
  return {
    mode: 'linear',
    h: Math.floor(Math.random() * 360),
    s: 70 + Math.floor(Math.random() * 20),
    l: 45 + Math.floor(Math.random() * 15),
    h2: Math.floor(Math.random() * 360),
    s2: 70 + Math.floor(Math.random() * 20),
    l2: 45 + Math.floor(Math.random() * 15),
    gradAngle: Math.floor(Math.random() * 8) * 45,
  };
}

/** Waveform types to pick from when randomizing. */
const WAVEFORMS = all().map((e) => e.waveform);

/** Number of voices to create when randomizing. */
const RANDOM_VOICE_COUNT = 5;

/**
 * Randomize: clear existing voices, create RANDOM_VOICE_COUNT new voices
 * with random properties, then harmonize them to a random scale.
 * Returns the chosen scale name.
 */
export function randomize(store: SigilStore, undo: UndoManager): string {
  undo.snapshot();

  // Random scene
  store.updateScene(Math.floor(Math.random() * SCENES.length));

  // Random ADSR envelope
  store.updateEnvelope({
    attack: 0.005 + Math.random() * 1.2, // 5ms – 1.2s
    decay: 0.02 + Math.random() * 1.0, // 20ms – 1s
    sustain: 0.15 + Math.random() * 0.8, // 0.15 – 0.95
    release: 0.05 + Math.random() * 2.0, // 50ms – 2s
  });

  // Clear existing voices
  for (const v of store.data.voices) {
    store.removeVoice(v.id);
  }

  // Create random voices with varied visual/audio properties
  for (let i = 0; i < RANDOM_VOICE_COUNT; i++) {
    const waveform = WAVEFORMS[Math.floor(Math.random() * WAVEFORMS.length)]!;
    const x = normalizedCoord(0.1 + Math.random() * 0.8); // avoid extreme edges
    const y = normalizedCoord(0.05 + Math.random() * 0.9);
    store.addVoice(waveform, x, y);

    const lastVoice = store.data.voices.at(-1)!;
    const updates: Partial<Voice> = {
      size: normalizedCoord(0.1 + Math.random() * 0.35),
    };

    // 35% chance of a gradient fill (diphthong sweep)
    if (Math.random() < 0.35) {
      updates.fill = createRandomLinearFill();
    }

    // 75% chance of random rotation (drives timbre on pulse/blend; no-op for sine)
    if (Math.random() < 0.75) {
      Object.assign(updates, hasTimbre(waveform) ? { timbre: normalizedCoord(Math.random()) } : {});
    }

    // 15% chance of a border (random color, thickness, double).
    // Stamps skip borders — border adds an octave-doubled oscillator
    // which doesn't apply to sample-based voices.
    if (waveform !== 'stamp' && Math.random() < 0.15) {
      updates.border = {
        color: Math.random() < 0.5 ? 'white' : 'black',
        double: Math.random() < 0.3,
        thickness: normalizedCoord(0.1 + Math.random() * 0.4),
      } satisfies Border;
    }

    // 25% chance of a random pattern
    if (Math.random() < 0.25) {
      updates.effect = PATTERN_TYPES[Math.floor(Math.random() * PATTERN_TYPES.length)]!;
    }

    // Randomize stamp variant for stamp voices
    if (waveform === 'stamp') {
      (updates as Record<string, unknown>).stamp = Math.floor(Math.random() * STAMPLE_COUNT);
    }

    store.updateVoice(lastVoice.id, updates);
  }

  // Harmonize inline (can't call harmonize() — it would push a second
  // undo snapshot, splitting the operation into two undo steps)
  const scale = SCALES[Math.floor(Math.random() * SCALES.length)]!;
  applyScale(store, scale);

  // Random global blend — overlap tracker will auto-reset to screen if no overlap
  store.updateBlend(BLEND_MODES[Math.floor(Math.random() * BLEND_MODES.length)]!);

  return scale.name;
}
