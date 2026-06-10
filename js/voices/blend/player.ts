// Player.ts — Blend (triangle) Player delegate.
//
// Crossfaded sawtooth + triangle oscillator pair. Timbre controls the
// Saw/tri blend ratio.

import { safeStop } from '../../audio/node-utils.ts';
import { timbreToBlendMix, yToFrequency } from '../../audio/mapping.ts';
import type { Voice } from '../../types.ts';
import type { AudioSharedNodes, AudioVoice, VoicePlayer } from '../types.ts';

const player: VoicePlayer = {
  oscillatorType: 'sawtooth',
  shapeAreaCoeff: (3 * Math.sqrt(3)) / 4,
  gainExponent: 1.3,
  buildAudioGraph(ctx: AudioContext, initVoice: Voice, shared: AudioSharedNodes): AudioVoice {
    const initTimbre = 'timbre' in initVoice ? initVoice.timbre : 0;
    const initFreq = yToFrequency(initVoice.y);

    const oscSaw = new OscillatorNode(ctx, { type: 'sawtooth', frequency: initFreq });
    const oscTri = new OscillatorNode(ctx, { type: 'triangle', frequency: initFreq });
    const gainSaw = new GainNode(ctx);
    const gainTri = new GainNode(ctx);

    const initMix = timbreToBlendMix(initTimbre);
    gainTri.gain.value = Math.sin((initMix * Math.PI) / 2);
    gainSaw.gain.value = Math.cos((initMix * Math.PI) / 2);

    oscSaw.connect(gainSaw);
    oscTri.connect(gainTri);
    gainSaw.connect(shared.gain);
    gainTri.connect(shared.gain);

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
        oscSaw.start(time);
        oscTri.start(time);
        if (shared.octaveOsc) {
          try {
            shared.octaveOsc.start(time);
          } catch {}
        }
      },
      stop(_time: number) {
        safeStop(oscSaw);
        safeStop(oscTri);
        if (shared.octaveOsc) {
          safeStop(shared.octaveOsc);
        }
      },
      updateParams(voice: Voice, now: number) {
        const timbre = 'timbre' in voice ? voice.timbre : 0;
        const freq = yToFrequency(voice.y);
        oscSaw.frequency.setValueAtTime(freq, now);
        oscTri.frequency.setValueAtTime(freq, now);
        const mix = timbreToBlendMix(timbre);
        gainTri.gain.setValueAtTime(Math.sin((mix * Math.PI) / 2), now);
        gainSaw.gain.setValueAtTime(Math.cos((mix * Math.PI) / 2), now);
      },
      syncGlobalParams() {},
      getModulatorNode(): OscillatorNode {
        return oscSaw;
      },
      getCarrierFrequencyParams(): AudioParam[] {
        const params: AudioParam[] = [oscSaw.frequency, oscTri.frequency];
        if (shared.octaveOsc) {
          params.push(shared.octaveOsc.frequency);
        }
        return params;
      },
    };
  },
};

export default player;
