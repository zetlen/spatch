// mapping.ts — Pure pitch/spatial mapping functions for audio synthesis.
// No Web Audio API dependencies — just math.

import { type NormalizedCoord, type WaveformType, normalizedCoord } from '../types.ts';

// ---- Chromatic scale ----
// 3 octaves from G2 (MIDI 43) to G5 (MIDI 79): 37 semitones
const CHROMATIC_SEMITONES: number[] = [];
for (let i = 0; i <= 36; i++) {
  CHROMATIC_SEMITONES.push(i);
}

/** MIDI note number for G2, the lowest note in the chromatic range. */
const BASE_MIDI = 43;

/**
 * Convert a MIDI note number to frequency in Hz.
 * Uses standard 12-TET tuning with A4 = 440 Hz.
 */
function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

// ---- Mapping functions ----

// Maximum micro-detuning in cents when positioned between note snap points.
// Set to 0 for hard chromatic snap. Can be re-enabled later as a deliberate
// per-voice or global parameter rather than an accidental side effect.
const MAX_DETUNE_CENTS = 0;

/**
 * Map a normalized Y coordinate (0-1) to a frequency in Hz.
 *
 * Y=0 (top of canvas) maps to the highest note (G5, MIDI 79).
 * Y=1 (bottom of canvas) maps to the lowest note (G2, MIDI 43).
 * Positions snap to the nearest chromatic semitone across a 3-octave range.
 *
 * When MAX_DETUNE_CENTS > 0, positions between note centers produce
 * micro-detuning via a tanh curve. Currently disabled (hard chromatic snap).
 */
export function yToFrequency(y: NormalizedCoord): number {
  // Y is 0-1, where 0=top (high pitch), 1=bottom (low pitch)
  const normalized = 1 - y;
  const continuous = normalized * (CHROMATIC_SEMITONES.length - 1);
  const index = Math.round(continuous);
  const clamped = Math.max(0, Math.min(CHROMATIC_SEMITONES.length - 1, index));
  const offset = continuous - clamped; // -0.5 to +0.5

  const baseFreq = midiToFreq(BASE_MIDI + CHROMATIC_SEMITONES[clamped]!);

  // Micro-detuning: tanh flattens near edges. Currently disabled (MAX_DETUNE_CENTS=0)
  // for hard chromatic snap. Can be re-enabled as a deliberate parameter.
  const detuneCents = MAX_DETUNE_CENTS * Math.tanh(offset * 3);
  return baseFreq * 2 ** (detuneCents / 1200);
}

/**
 * Magnetically snap a Y coordinate toward the nearest chromatic note position.
 *
 * Uses a cubic curve so positions near note centers are "sticky" while
 * positions between notes are compressed but still reachable. The result
 * is monotonic: increasing Y never decreases the snapped value.
 *
 * @param y - Normalized Y coordinate (0 = top, 1 = bottom)
 * @returns Snapped Y coordinate, still in normalized [0, 1] range
 */
export function snapYToNote(y: NormalizedCoord): NormalizedCoord {
  const noteCount = CHROMATIC_SEMITONES.length;
  const normalized = 1 - y;
  const spacing = 1 / (noteCount - 1);

  const continuous = normalized / spacing;
  const nearestIndex = Math.round(continuous);
  const clamped = Math.max(0, Math.min(noteCount - 1, nearestIndex));
  const notePos = clamped * spacing;

  const halfZone = spacing / 2;
  const rawOffset = normalized - notePos;
  const t = Math.max(-1, Math.min(1, rawOffset / halfZone));

  // Cubic pull: t^3 preserves sign, creates wide sticky center
  const pulled = t * t * t;

  const snappedNormalized = notePos + pulled * halfZone;
  return normalizedCoord(1 - snappedNormalized);
}

/**
 * Map a normalized X coordinate (0-1) to a stereo pan value (-1 to +1).
 *
 * X=0 maps to full left (-1), X=0.5 maps to center (0), X=1 maps to full right (+1).
 */
export function xToPan(x: NormalizedCoord): number {
  return x * 2 - 1; // 0->-1 (left), 1->+1 (right)
}

/**
 * Compute the area of a shape as a fraction of the 1x1 normalized canvas.
 *
 * All shapes use r = size/2 as bounding radius:
 * - sine (circle): pi * r^2
 * - pulse (square): (2r)^2 = size^2
 * - blend (equilateral triangle inscribed in circle): (3*sqrt(3)/4) * r^2
 *
 * @param waveform - Shape type determining the area formula
 * @param size - Normalized shape size (0-1)
 * @returns Area as a fraction of the unit canvas
 */
export function shapeAreaFraction(waveform: WaveformType, size: NormalizedCoord): number {
  const halfSize = size / 2;
  switch (waveform) {
    case 'sine': {
      return Math.PI * halfSize * halfSize;
    }
    case 'pulse': {
      return size * size;
    } // Side = 2r = size
    case 'blend': {
      // Equilateral inscribed in circle of radius size/2
      return ((3 * Math.sqrt(3)) / 4) * halfSize * halfSize;
    }
  }
}

/**
 * Map a shape's canvas area fraction to audio gain.
 *
 * Larger shapes are louder. Gain starts at 0.05 for tiny shapes and caps at 0.8
 * for the largest shapes. The relationship is linear in area (quadratic in size).
 *
 * @param waveform - Shape type (determines area formula)
 * @param size - Normalized shape size (0-1)
 * @returns Gain value in [0.05, 0.8]
 */
export function areaToGain(waveform: WaveformType, size: NormalizedCoord): number {
  const fraction = shapeAreaFraction(waveform, size);
  return Math.min(0.8, 0.05 + fraction);
}

// Map rotation to a periodic timbre parameter.
// Each waveform's visual symmetry period determines the audio cycle:
// a square repeats every 90 deg, a triangle every 120 deg.
// Linear sawtooth ramp: every angle within the period maps to a unique
// timbre value (0 at the start, approaching 1 at the end).

/** Rotation period in degrees for each waveform with rotational timbre. */
const WAVEFORM_PERIOD: Record<string, number> = {
  blend: 120,
  pulse: 90,
};

/**
 * Map rotation angle to a periodic timbre parameter in [0, 1).
 *
 * Each waveform's visual symmetry period determines the audio cycle:
 * pulse (square) repeats every 90 degrees, blend (triangle) every 120 degrees.
 * The mapping is a linear sawtooth ramp within each period, so every angle
 * maps to a unique timbre value. Sine has no timbre and always returns 0.
 *
 * @param rotation - Rotation angle in degrees
 * @param waveform - Waveform type name
 * @returns Timbre value in [0, 1), or 0 for sine
 */
export function rotationToTimbre(rotation: number, waveform: string): number {
  const period = WAVEFORM_PERIOD[waveform];
  if (!period) {
    return 0;
  } // Sine has no timbre
  const phase = ((rotation % period) + period) % period;
  return phase / period;
}

/**
 * Per-waveform perceived-loudness normalization gain.
 *
 * Square and sawtooth waves have higher RMS and excite more auditory critical
 * bands than a pure sine, making them sound louder at the same amplitude.
 * Sine needs a boost (~3 dB) to match perceived loudness; square and sawtooth
 * are attenuated.
 *
 * - pulse (square): 0.7 (RMS ~1.41x sine, rich harmonics)
 * - blend (sawtooth): 0.85 (RMS ~1.15x sine)
 * - sine: 1.6 (single partial; boosted to match perceived loudness)
 */
export function waveformGain(waveform: WaveformType): number {
  switch (waveform) {
    case 'pulse': {
      return 0.7;
    } // Square RMS ~= 1.41x sine, rich harmonics
    case 'blend': {
      return 0.85;
    } // Sawtooth RMS ~= 1.15x sine
    case 'sine': {
      return 1.6;
    } // Sine is single-partial; boost to match perceived loudness
  }
}
