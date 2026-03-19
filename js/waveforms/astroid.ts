// astroid.ts — Astroid (astroid hypocycloid) waveform strategy.
//
// Maps to a 4-pointed astroid shape visually and a 6-oscillator
// supersaw audio graph. Timbre controls rotation (continuous 0–90° arc,
// matching the astroid's 4-fold symmetry) and the detune/stereo spread.
// Six sawtooth oscillators are always running: the center pair is always at
// full gain, the inner pair fades in from timbre=0.25 to 0.5, and the outer
// pair from timbre=0.5 to 1.0. Total gain is normalized so loudness stays
// constant regardless of how many pairs are active.
//
// The astroid SVG path uses four cubic bezier segments with control-point
// ratio κ=0.4, giving sharper, more star-like concave indentations than the
// true mathematical astroid (κ≈0.61).

import { resizeHandleEl, rotationHandleEls, svgEl } from '../dom.ts';
import { makeSaturationCurve, safeStop } from '../audio/node-utils.ts';
import { yToFrequency } from '../audio/mapping.ts';
import { decodeInt, encodeInt, round3 } from '../serialize.ts';
import { type NormalizedCoord, normalizedCoord } from '../types.ts';
import type { Voice, VoiceBase } from '../types.ts';
import type { AudioSharedNodes, AudioVoice, WaveformStrategy } from './types.ts';

// Bezier control-point ratio. 0.4 gives sharper points than the true astroid
// (κ≈0.61) — more like a recognisable 4-pointed star.
const KAPPA = 0.4;

// Six oscillators: [outerL, innerL, centerL, centerR, innerR, outerR].
// Each pair fades in at a different timbre threshold and reaches full gain
// at fullAt. The center pair is always active.
const OSC_COUNT = 6;
const FADE_IN_AT = [0.5, 0.25, 0, 0, 0.25, 0.5];
const FULL_AT = [1.0, 0.5, 0, 0, 0.5, 1.0];

// Detune and pan for each osc: [outerL, innerL, centerL, centerR, innerR, outerR].
// BASE values are always present (center pair always has spread so timbre=0 sounds fat).
// SCALE values grow with timbre. At timbre=1 the six oscs land on even 10-cent /
// 0.35-pan steps: -25/-15/-5/+5/+15/+25 cents, -0.8/-0.5/-0.15/+0.15/+0.5/+0.8 pan.
const DETUNE_BASE = [0, 0, -5, 5, 0, 0];
const DETUNE_SCALE = [-25, -15, 0, 0, 15, 25];
const PAN_BASE = [0, 0, -0.15, 0.15, 0, 0];
const PAN_SCALE = [-0.8, -0.5, 0, 0, 0.5, 0.8];

function oscGain(i: number, timbre: number): number {
  const lo = FADE_IN_AT[i]!;
  const hi = FULL_AT[i]!;
  if (timbre < lo) return 0;
  if (timbre >= hi) return 1;
  return (timbre - lo) / (hi - lo);
}

function astroidPath(voice: Voice): string {
  const cx = voice.x as number;
  const cy = voice.y as number;
  const r = (voice.size as number) / 2;
  const k = r * KAPPA;
  return [
    `M ${cx + r},${cy}`,
    `C ${cx + k},${cy} ${cx},${cy - k} ${cx},${cy - r}`,
    `C ${cx},${cy - k} ${cx - k},${cy} ${cx - r},${cy}`,
    `C ${cx - k},${cy} ${cx},${cy + k} ${cx},${cy + r}`,
    `C ${cx},${cy + k} ${cx + k},${cy} ${cx + r},${cy}`,
    'Z',
  ].join(' ');
}

const astroid: WaveformStrategy = {
  waveform: 'astroid',
  shapeName: 'astroid',
  svgTag: 'path',
  hasTimbre: true,
  rotationPeriod: 90,
  serializationIndex: 3,
  oscillatorType: 'sawtooth',
  shapeAreaCoeff: (3 * Math.PI) / 8, // astroid area = (3π/8)·r²
  formantMaxQ: 8,
  gainExponent: 1.4,

  createSvgElement(voice: Voice): SVGElement {
    const el = svgEl('path');
    el.setAttribute('d', astroidPath(voice));
    return el;
  },

  updateSvgElement(el: SVGElement, voice: Voice): void {
    el.setAttribute('d', astroidPath(voice));
  },

  selectionHandles(voice: Voice): SVGElement[] {
    const r = voice.size / 2;
    return [
      resizeHandleEl('e', voice.x + r, voice.y),
      resizeHandleEl('n', voice.x, voice.y - r),
      resizeHandleEl('w', voice.x - r, voice.y),
      resizeHandleEl('s', voice.x, voice.y + r),
      ...rotationHandleEls(voice.x, voice.y - r),
    ];
  },

  buildAudioGraph(ctx: AudioContext, voice: Voice, shared: AudioSharedNodes): AudioVoice {
    const timbre = 'timbre' in voice ? (voice.timbre as number) : 0;
    const freq = yToFrequency(voice.y);

    const oscs = Array.from(
      { length: OSC_COUNT },
      (_, i) =>
        new OscillatorNode(ctx, {
          type: 'sawtooth',
          frequency: freq,
          detune: DETUNE_BASE[i]! + DETUNE_SCALE[i]! * timbre,
        }),
    );
    const panners = Array.from(
      { length: OSC_COUNT },
      (_, i) => new StereoPannerNode(ctx, { pan: PAN_BASE[i]! + PAN_SCALE[i]! * timbre }),
    );
    const gains = Array.from({ length: OSC_COUNT }, (_, i) => oscGain(i, timbre));
    const total = gains.reduce((a, b) => a + b, 0) || 1;
    const gainNodes = Array.from(
      { length: OSC_COUNT },
      (_, i) => new GainNode(ctx, { gain: gains[i]! / total }),
    );

    // OB-Xa brass coloring: 2-pole LP at 5.5 kHz cuts harsh saw harmonics
    // without killing brightness, and a soft tanh shaper adds Marshall warmth.
    // sumNode attenuates the combined oscillators before the shaper to prevent
    // clipping artifacts (6 oscs summed can exceed ±1 without the reduction).
    const sumNode = new GainNode(ctx, { gain: 0.3 });
    const lpFilter = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 5500,
      Q: 1,
    });
    const shaper = new WaveShaperNode(ctx, {
      curve: makeSaturationCurve(2),
      oversample: '2x',
    });

    oscs.forEach((osc, i) => {
      osc.connect(gainNodes[i]!);
      gainNodes[i]!.connect(panners[i]!);
      panners[i]!.connect(sumNode);
    });
    sumNode.connect(lpFilter);
    lpFilter.connect(shaper);
    shaper.connect(shared.gain);

    return {
      ...shared,
      hasSweep: false,
      lastX: voice.x as number,
      lastY: voice.y as number,
      lastSize: voice.size as number,
      outputNode: shared.panner,
      shapeId: voice.id,
      warmthShaper: undefined,
      start(time: number) {
        oscs.forEach((osc) => osc.start(time));
        if (shared.octaveOsc) {
          try {
            shared.octaveOsc.start(time);
          } catch {}
        }
      },
      stop(_time: number) {
        oscs.forEach((osc) => safeStop(osc));
        if (shared.octaveOsc) safeStop(shared.octaveOsc);
      },
      updateParams(voice: Voice, now: number) {
        const timbre = 'timbre' in voice ? (voice.timbre as number) : 0;
        const freq = yToFrequency(voice.y);
        const gains = Array.from({ length: OSC_COUNT }, (_, i) => oscGain(i, timbre));
        const total = gains.reduce((a, b) => a + b, 0) || 1;
        oscs.forEach((osc, i) => {
          osc.frequency.setValueAtTime(freq, now);
          osc.detune.setValueAtTime(DETUNE_BASE[i]! + DETUNE_SCALE[i]! * timbre, now);
          panners[i]!.pan.setValueAtTime(PAN_BASE[i]! + PAN_SCALE[i]! * timbre, now);
          gainNodes[i]!.gain.setValueAtTime(gains[i]! / total, now);
        });
      },
      syncGlobalParams() {},
      getModulatorNode(): OscillatorNode {
        return oscs[2]!; // center-left osc as modulator
      },
      getCarrierFrequencyParams(): AudioParam[] {
        const params: AudioParam[] = oscs.map((o) => o.frequency);
        if (shared.octaveOsc) params.push(shared.octaveOsc.frequency);
        return params;
      },
    };
  },

  createVoice(base: VoiceBase): Voice {
    return { ...base, timbre: normalizedCoord(0), waveform: 'astroid' };
  },

  getTimbre(voice: Voice): NormalizedCoord {
    return 'timbre' in voice ? (voice.timbre as NormalizedCoord) : normalizedCoord(0);
  },

  withTimbre(value: NormalizedCoord): Partial<Voice> {
    return { timbre: value };
  },

  packExtra(voice: Voice): string {
    const timbre = 'timbre' in voice ? (voice.timbre as number) : 0;
    return encodeInt(round3(timbre) * 1000, 2);
  },

  unpackExtra(
    str: string,
    idx: number,
  ): { fields: Record<string, NormalizedCoord>; bytesRead: number } {
    const timbre = normalizedCoord(decodeInt(str, idx, 2) / 1000);
    return { fields: { timbre }, bytesRead: 2 };
  },
};

export default astroid;
