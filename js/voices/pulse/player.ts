// Player.ts — Pulse (square) Player delegate.
//
// Sawtooth oscillator + PWM waveshaper for variable pulse width.

import { safeStop, createPWMWaveshaper } from '../../audio/node-utils.ts';
import { timbreToPWMOffset, yToFrequency } from '../../audio/mapping.ts';
import type { Voice } from '../../types.ts';
import type { AudioSharedNodes, AudioVoice, VoicePlayer } from '../types.ts';

const player: VoicePlayer = {
  oscillatorType: 'square',
  shapeAreaCoeff: 4,
  formantMaxQ: 8,
  gainExponent: 1.6,
  buildAudioGraph(ctx: AudioContext, initVoice: Voice, shared: AudioSharedNodes): AudioVoice {
    const initTimbre = 'timbre' in initVoice ? initVoice.timbre : 0;
    const initFreq = yToFrequency(initVoice.y);

    const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: initFreq });
    const pwmOffset = new ConstantSourceNode(ctx, {
      offset: timbreToPWMOffset(initTimbre),
    });
    const ws = createPWMWaveshaper(ctx);

    osc.connect(ws);
    pwmOffset.connect(ws);
    ws.connect(shared.gain);

    pwmOffset.start();

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
        try {
          osc.start(time);
        } catch {}
        if (shared.octaveOsc) {
          try {
            shared.octaveOsc.start(time);
          } catch {}
        }
      },
      stop(_time: number) {
        safeStop(osc);
        safeStop(pwmOffset);
        if (shared.octaveOsc) {
          safeStop(shared.octaveOsc);
        }
      },
      updateParams(voice: Voice, now: number) {
        const timbre = 'timbre' in voice ? voice.timbre : 0;
        const freq = yToFrequency(voice.y);
        osc.frequency.setValueAtTime(freq, now);
        pwmOffset.offset.setValueAtTime(timbreToPWMOffset(timbre), now);
      },
      syncGlobalParams() {},
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
