// Player.ts — Sine (circle) Player delegate.
//
// Sine oscillator with analog warmth shaping (soft-saturation waveshaper).

import { makeSaturationCurve, safeStop } from '../../audio/node-utils.ts';
import { yToFrequency } from '../../audio/mapping.ts';
import type { Voice } from '../../types.ts';
import type { AudioSharedNodes, AudioVoice, VoicePlayer } from '../types.ts';

const player: VoicePlayer = {
  oscillatorType: 'sine',
  shapeAreaCoeff: Math.PI,
  formantMaxQ: 4,
  gainExponent: 1,
  buildAudioGraph(ctx: AudioContext, initVoice: Voice, shared: AudioSharedNodes): AudioVoice {
    const initFreq = yToFrequency(initVoice.y);

    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: initFreq });

    // Soft-saturation warmth shaper (analog impurity)
    const sineWarm = new WaveShaperNode(ctx);
    sineWarm.curve = makeSaturationCurve(shared.warmth);
    sineWarm.oversample = '2x';

    osc.connect(sineWarm);
    sineWarm.connect(shared.gain);

    return {
      ...shared,
      hasSweep: false,
      lastX: initVoice.x as number,
      lastY: initVoice.y as number,
      lastSize: initVoice.size as number,
      outputNode: shared.panner,
      shapeId: initVoice.id,
      warmthShaper: sineWarm,
      start(time: number) {
        osc.start(time);
        if (shared.octaveOsc) {
          try {
            shared.octaveOsc.start(time);
          } catch {}
        }
      },
      stop(_time: number) {
        safeStop(osc);
        if (shared.octaveOsc) {
          safeStop(shared.octaveOsc);
        }
      },
      updateParams(voice: Voice, now: number) {
        const freq = yToFrequency(voice.y);
        osc.frequency.setValueAtTime(freq, now);
      },
      syncGlobalParams(vibeParams: { warmth: number }) {
        sineWarm.curve = makeSaturationCurve(vibeParams.warmth);
      },
      getModulatorNode(): OscillatorNode {
        return osc;
      },
      getCarrierFrequencyParams(): AudioParam[] {
        const params: AudioParam[] = [osc.frequency];
        if (shared.octaveOsc) {
          params.push(shared.octaveOsc.frequency);
        }
        return params;
      },
    };
  },
};

export default player;
