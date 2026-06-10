// Mapping.ts — Pure pitch/spatial mapping functions for audio synthesis.
// No Web Audio API dependencies — just math.

import { type NormalizedCoord, type WaveformType, normalizedCoord } from '../types.ts';
import { get } from '../voices/registry.ts';

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
// Per-voice or global parameter rather than an accidental side effect.
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
  // For hard chromatic snap. Can be re-enabled as a deliberate parameter.
  const detuneCents = MAX_DETUNE_CENTS * Math.tanh(offset * 3);
  return baseFreq * 2 ** (detuneCents / 1200);
}

/**
 * Magnetically snap a Y coordinate toward the nearest chromatic note position.
 *
 * Uses a quintic curve so positions near note centers are "sticky" while
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

  // Quintic pull: t^5 preserves sign, creates wider sticky center than cubic
  const t2 = t * t;
  const pulled = t2 * t2 * t;

  const snappedNormalized = notePos + pulled * halfZone;
  return normalizedCoord(1 - snappedNormalized);
}

/**
 * Hard-snap a Y coordinate to the exact nearest chromatic note position.
 * Used on drag release to ensure shapes always land on a note.
 */
export function hardSnapYToNote(y: NormalizedCoord): NormalizedCoord {
  const noteCount = CHROMATIC_SEMITONES.length;
  const normalized = 1 - y;
  const spacing = 1 / (noteCount - 1);
  const nearestIndex = Math.round(normalized / spacing);
  const clamped = Math.max(0, Math.min(noteCount - 1, nearestIndex));
  return normalizedCoord(1 - clamped * spacing);
}

/**
 * Map a normalized Y coordinate to a playback rate for sample-based voices.
 *
 * Uses the same chromatic pitch grid as yToFrequency, but returns a rate
 * ratio relative to the sample's reference pitch. Rate > 1 plays faster
 * (higher pitch), rate < 1 plays slower (lower pitch) — like speeding up
 * a record from 33 to 45 RPM.
 *
 * @param y - Normalized Y coordinate (0 = top/high, 1 = bottom/low)
 * @param referencePitch - The original pitch of the sample in Hz
 * @returns Playback rate ratio
 */
export function yToPlaybackRate(y: NormalizedCoord, referencePitch: number): number {
  return yToFrequency(y) / referencePitch;
}

/**
 * Map rotation angle to a periodic timbre parameter in [0, 1).
 *
 * Each waveform's visual symmetry period determines the audio cycle:
 * pulse (square) repeats every 90 degrees, blend (triangle) every 120 degrees.
 * The mapping is a linear sawtooth ramp within each period, so every angle
 * maps to a unique timbre value. Sine has no timbre and always returns 0.
 *
 * @param rotation - Rotation angle in degrees
 * @param waveform - Waveform type
 * @returns Timbre value in [0, 1), or 0 for waveforms without timbre
 */
export function rotationToTimbre(rotation: number, waveform: WaveformType): number {
  const period = get(waveform).rotationPeriod;
  if (!period) {
    return 0;
  }
  const phase = ((rotation % period) + period) % period;
  return phase / period;
}

// ---- Blend (saw/tri crossfade) ----

/**
 * Convert a timbre value to the saw→tri crossfade position for blend voices.
 * Monotonic over [0, 1) so every rotation within the triangle's 120° symmetry
 * period sounds unique (bijection: mirror orientations are visually distinct,
 * so they must sound distinct). Timbre 1 wraps to 0 because a 120° rotation
 * renders identically to 0°.
 */
export function timbreToBlendMix(timbre: number): number {
  return timbre % 1;
}

// ---- Pulse-width modulation ----

// Maximum PWM offset magnitude. At 0.9 the pulse collapses to ~5% duty cycle
// And becomes inaudible. 0.75 keeps the minimum at ~12.5% — still a bright,
// Reedy timbre but clearly audible at every rotation angle.
const MAX_PWM_OFFSET = 0.75;

/** Convert a timbre value [0, 1) to a PWM DC offset for pulse-width modulation. */
export function timbreToPWMOffset(timbre: number): number {
  return (timbre * 2 - 1) * MAX_PWM_OFFSET;
}
