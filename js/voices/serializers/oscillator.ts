// oscillator.ts — Shared serializer for oscillator-based voices.
//
// Handles: sine, pulse, blend, astroid.
// Register layout (per design doc):
//   CP1 (4 chars): Fill color 1 — H(9) + S(7) + L(8)
//   CP2 (5 chars): Fill color 2 + gradient angle — angle(3) + H(9) + S(7) + L(8)
//                  Present only for gradient fills.
//   SP1 (1 char): Y — note index 0-36
//   MP1 (2 chars): X — pan 0-4095
//   SP3 (1 char): Size 0-63
//   SP4 (1 char): Timbre 0-63 (0 for sine)
//   SP5 (2 chars): Effect (5b) + spare (7b)
//                  TODO: Shrink back to 1 char (3b+3b) after culling patterns.
//   SP6 (1 char): Border style (3b) + thickness (3b)

import {
  type Border,
  type Fill,
  type LinearFill,
  PATTERN_TYPES,
  type PatternType,
  type SolidFill,
  type Voice,
  type WaveformType,
  normalizedCoord,
} from '../../types.ts';
import { genId } from '../../state.ts';
import { MIN_SIZE } from '../../shapes.ts';
import { encodeInt, decodeInt } from '../b64.ts';
import type { VoiceSerializer } from '../types.ts';

// Effect keys sorted for stable indexing (same order as v1).
const EFFECT_KEYS: (PatternType | undefined)[] = [undefined, ...PATTERN_TYPES].sort();

const TOTAL_NOTES = 36; // 37 semitones: index 0-36
const X_RESOLUTION = 4095; // 12 bits: 0-4095 (2 B64 chars)
const SIZE_STEPS = 63; // 64 steps: 0-63
const TIMBRE_STEPS = 63; // 64 steps: 0-63
const THICKNESS_STEPS = 7; // 8 steps: 0-7

// ---- Color packing ----

function packColor(h: number, s: number, l: number): string {
  const val = (Math.round(h) << 14) | (Math.round(s) << 7) | Math.round(l);
  return encodeInt(val, 4);
}

function unpackColor(str: string, idx: number): { h: number; s: number; l: number } {
  const val = decodeInt(str, idx, 4);
  return {
    h: (val >> 14) & 0x1ff,
    s: (val >> 7) & 0x7f,
    l: val & 0x7f,
  };
}

function packGradientColor(angle: number, h: number, s: number, l: number): string {
  const angleBits = Math.round(angle / 45) & 7;
  const colorBits = (Math.round(h) << 14) | (Math.round(s) << 7) | Math.round(l);
  return encodeInt((angleBits << 23) | colorBits, 5);
}

function unpackGradientColor(
  str: string,
  idx: number,
): { angle: number; h: number; s: number; l: number } {
  const val = decodeInt(str, idx, 5);
  return {
    angle: ((val >> 23) & 7) * 45,
    h: (val >> 14) & 0x1ff,
    s: (val >> 7) & 0x7f,
    l: val & 0x7f,
  };
}

// ---- Border packing ----
// style (3b): 0=none, 1=white, 2=black, 3=white-double, 4=black-double
// thickness (3b): 0-7

function packBorder(border: Border | undefined): number {
  if (!border) return 0;
  let style = 0;
  if (border.color === 'white') style = border.double ? 3 : 1;
  else style = border.double ? 4 : 2;
  const thick = Math.round(border.thickness * THICKNESS_STEPS);
  return ((style & 0x7) << 3) | (thick & 0x7);
}

function unpackBorder(val: number): Border | undefined {
  const style = (val >> 3) & 0x7;
  if (style === 0) return undefined;
  const thick = val & 0x7;
  return {
    color: style === 2 || style === 4 ? 'black' : 'white',
    double: style > 2,
    thickness: normalizedCoord(thick / THICKNESS_STEPS),
  };
}

// ---- Y ↔ note index ----

function yToNoteIndex(y: number): number {
  const normalized = 1 - y;
  return Math.round(normalized * TOTAL_NOTES);
}

function noteIndexToY(index: number): number {
  return 1 - index / TOTAL_NOTES;
}

// ---- SP4 packing (timbre for oscillators) ----

function packSP4Oscillator(voice: Voice): number {
  const timbre = 'timbre' in voice ? (voice.timbre as number) : 0;
  return Math.round(timbre * TIMBRE_STEPS);
}

function unpackSP4Oscillator(val: number, waveform: WaveformType): Record<string, unknown> {
  if (waveform === 'sine' || waveform === 'stamp') return {};
  return { timbre: normalizedCoord(val / TIMBRE_STEPS) };
}

// ---- Main serializer ----

export function createOscillatorSerializer(): VoiceSerializer {
  return {
    solidWidth: 12,
    gradientWidth: 17,

    pack(voice: Voice): string {
      let out = '';

      // CP1: fill color 1
      out += packColor(voice.fill.h, voice.fill.s, voice.fill.l);

      // CP2: fill color 2 + angle (gradient only)
      if (voice.fill.mode === 'linear') {
        const f = voice.fill as LinearFill;
        out += packGradientColor(f.gradAngle, f.h2, f.s2, f.l2);
      }

      // SP1: Y note index
      out += encodeInt(yToNoteIndex(voice.y as number), 1);

      // MP1: X pan (12 bits, 2 chars — continuous, no grid snap)
      out += encodeInt(Math.round((voice.x as number) * X_RESOLUTION), 2);

      // SP3: Size
      out += encodeInt(Math.round((voice.size as number) * SIZE_STEPS), 1);

      // SP4: Timbre (oscillator-specific)
      out += encodeInt(packSP4Oscillator(voice), 1);

      // SP5: Effect (5b) + spare (7b) = 2 chars
      const eff = Math.max(0, EFFECT_KEYS.indexOf(voice.effect));
      out += encodeInt((eff & 0x1f) << 7, 2);

      // SP6: Border style (3b) + thickness (3b)
      out += encodeInt(packBorder(voice.border), 1);

      return out;
    },

    unpack(registers: string, waveform: WaveformType): Voice {
      let idx = 0;

      // CP1: fill color 1
      const c1 = unpackColor(registers, idx);
      idx += 4;

      // Detect gradient: if registers length equals gradientWidth, CP2 is present
      const isGradient = registers.length === this.gradientWidth;

      let fill: Fill;
      if (isGradient) {
        const c2 = unpackGradientColor(registers, idx);
        idx += 5;
        fill = {
          mode: 'linear',
          gradAngle: c2.angle,
          h: c1.h,
          s: c1.s,
          l: c1.l,
          h2: c2.h,
          s2: c2.s,
          l2: c2.l,
        } satisfies LinearFill;
      } else {
        fill = {
          mode: 'solid',
          h: c1.h,
          s: c1.s,
          l: c1.l,
        } satisfies SolidFill;
      }

      // SP1: Y
      const noteIndex = decodeInt(registers, idx++, 1);
      const y = normalizedCoord(noteIndexToY(noteIndex));

      // MP1: X (12 bits, 2 chars)
      const x = normalizedCoord(decodeInt(registers, idx, 2) / X_RESOLUTION);
      idx += 2;

      // SP3: Size (clamped to MIN_SIZE — size 0 is unrepresentable)
      const size = normalizedCoord(Math.max(MIN_SIZE, decodeInt(registers, idx++, 1) / SIZE_STEPS));

      // SP4: Timbre
      const sp4 = decodeInt(registers, idx++, 1);
      const extraFields = unpackSP4Oscillator(sp4, waveform);

      // SP5: Effect (5b) + spare (7b) = 2 chars
      const sp5 = decodeInt(registers, idx, 2);
      idx += 2;
      const effect = EFFECT_KEYS[(sp5 >> 7) & 0x1f];

      // SP6: Border
      const sp6 = decodeInt(registers, idx++, 1);
      const border = unpackBorder(sp6);

      return {
        id: genId('v'),
        waveform,
        x,
        y,
        size,
        fill,
        effect,
        border,
        ...extraFields,
      } as Voice;
    },
  };
}
