// Player.ts — Astroid Player delegate.
//
// 6-oscillator supersaw with LP filter + saturation shaper. Timbre controls
// Detune/stereo spread and which oscillator pairs are active.

import { makeSaturationCurve, safeStop } from '../../audio/node-utils.ts';
import { wrapTimbre, yToFrequency } from '../../audio/mapping.ts';
import type { Voice } from '../../types.ts';
import type { AudioSharedNodes, AudioVoice, VoicePlayer } from '../types.ts';

// Six oscillators: [outerL, innerL, centerL, centerR, innerR, outerR].
// Each pair fades in at a different timbre threshold and reaches full gain
// At fullAt. The center pair is always active.
const OSC_COUNT = 6;
const FADE_IN_AT = [0.5, 0.25, 0, 0, 0.25, 0.5];
const FULL_AT = [1, 0.5, 0, 0, 0.5, 1];

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
  if (timbre < lo) {
    return 0;
  }
  if (timbre >= hi) {
    return 1;
  }
  return (timbre - lo) / (hi - lo);
}

const player: VoicePlayer = {
  oscillatorType: 'sawtooth',
  shapeAreaCoeff: (3 * Math.PI) / 8,
  gainExponent: 1.4,
  buildAudioGraph(ctx: AudioContext, initVoice: Voice, shared: AudioSharedNodes): AudioVoice {
    // Wrapped: timbre 1 renders at 90° ≡ 0° for the 4-fold-symmetric astroid,
    // so it must sound like timbre 0 (full spread is approached, not reached).
    const initTimbre = wrapTimbre('timbre' in initVoice ? (initVoice.timbre as number) : 0);
    const initFreq = yToFrequency(initVoice.y);

    const oscs = Array.from(
      { length: OSC_COUNT },
      (_, i) =>
        new OscillatorNode(ctx, {
          type: 'sawtooth',
          frequency: initFreq,
          detune: DETUNE_BASE[i]! + DETUNE_SCALE[i]! * initTimbre,
        }),
    );
    const panners = Array.from(
      { length: OSC_COUNT },
      (_, i) => new StereoPannerNode(ctx, { pan: PAN_BASE[i]! + PAN_SCALE[i]! * initTimbre }),
    );
    const initGains = Array.from({ length: OSC_COUNT }, (_, i) => oscGain(i, initTimbre));
    const initTotal = initGains.reduce((a, b) => a + b, 0) || 1;
    const gainNodes = Array.from(
      { length: OSC_COUNT },
      (_, i) => new GainNode(ctx, { gain: initGains[i]! / initTotal }),
    );

    // OB-Xa brass coloring: 2-pole LP at 5.5 kHz cuts harsh saw harmonics
    // Without killing brightness, and a soft tanh shaper adds Marshall warmth.
    // SumNode attenuates the combined oscillators before the shaper to prevent
    // Clipping artifacts (6 oscs summed can exceed ±1 without the reduction).
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
      lastX: initVoice.x as number,
      lastY: initVoice.y as number,
      lastSize: initVoice.size as number,
      outputNode: shared.panner,
      shapeId: initVoice.id,
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
        if (shared.octaveOsc) {
          safeStop(shared.octaveOsc);
        }
      },
      updateParams(voice: Voice, now: number) {
        const timbre = wrapTimbre('timbre' in voice ? (voice.timbre as number) : 0);
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
        return oscs[2]!; // Center-left osc as modulator
      },
      getCarrierFrequencyParams(): AudioParam[] {
        const params: AudioParam[] = oscs.map((o) => o.frequency);
        if (shared.octaveOsc) {
          params.push(shared.octaveOsc.frequency);
        }
        return params;
      },
    };
  },
};

export default player;
