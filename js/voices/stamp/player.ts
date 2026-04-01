// Player.ts — Stamp (sample-based) Player delegate.
//
// AudioBufferSourceNode (one-shot sample) + silent FM oscillator for
// Modulation routing. Pitch is controlled via playbackRate.

import { safeStop } from '../../audio/node-utils.ts';
import { yToFrequency, yToPlaybackRate } from '../../audio/mapping.ts';
import { getCachedSample } from '../../audio/sample-loader.ts';
import { getStample } from '../../stamples/index.ts';
import type { Voice } from '../../types.ts';
import type { AudioSharedNodes, AudioVoice, VoicePlayer } from '../types.ts';

function getStampIndex(voice: Voice): number {
  return 'stamp' in voice ? (voice as { stamp: number }).stamp : 0;
}

function getTrigger(voice: Voice): number {
  return 'trigger' in voice ? (voice as { trigger: number }).trigger : 1;
}

// 1-sample silent buffer used as fallback if decode hasn't finished yet.
let silentBuffer: AudioBuffer | undefined;
function getSilentBuffer(ctx: AudioContext): AudioBuffer {
  if (!silentBuffer) {
    silentBuffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  }
  return silentBuffer;
}

const player: VoicePlayer = {
  oscillatorType: 'sine',
  shapeAreaCoeff: 1.2,
  gainExponent: 2.5,
  buildAudioGraph(ctx: AudioContext, initVoice: Voice, shared: AudioSharedNodes): AudioVoice {
    const initStample = getStample(getStampIndex(initVoice));
    const initRate = yToPlaybackRate(initVoice.y, initStample.referencePitch);
    const initFreq = yToFrequency(initVoice.y);

    // Use sample-loader's decode cache, or silent fallback if not yet decoded.
    // Normally decodeStampSamples() is called on first gesture, so the buffer
    // Is ready by play time. The fallback handles edge cases.
    const buffer = getCachedSample(initStample.sampleUrl) ?? getSilentBuffer(ctx);
    const source = new AudioBufferSourceNode(ctx, {
      buffer,
      loop: false,
      playbackRate: initRate,
    });
    source.connect(shared.gain);

    // Silent FM oscillator: participates in FM routing but produces no audible output.
    const fmOsc = new OscillatorNode(ctx, { type: 'sine', frequency: initFreq });

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
        fmOsc.start(time);
        if (shared.octaveOsc) {
          try {
            shared.octaveOsc.start(time);
          } catch {}
        }
        // Trigger=0 (Attack): fire sample immediately
        if (getTrigger(initVoice) === 0) {
          source.start(time);
        }
      },
      onDecay(time: number) {
        // Trigger=1 (Decay): fire sample at peak envelope (original behavior)
        if (getTrigger(initVoice) === 1) {
          source.start(time);
        }
      },
      onRelease(time: number) {
        // Trigger=2 (Release): fire sample on note-off
        if (getTrigger(initVoice) === 2) {
          source.start(time);
        }
      },
      stop(_time: number) {
        safeStop(source);
        safeStop(fmOsc);
        if (shared.octaveOsc) {
          safeStop(shared.octaveOsc);
        }
      },
      updateParams(voice: Voice, now: number) {
        const stample = getStample(getStampIndex(voice));
        const rate = yToPlaybackRate(voice.y, stample.referencePitch);
        const freq = yToFrequency(voice.y);
        source.playbackRate.setValueAtTime(rate, now);
        fmOsc.frequency.setValueAtTime(freq, now);
      },
      syncGlobalParams() {},
      getModulatorNode(): OscillatorNode {
        return fmOsc;
      },
      getCarrierFrequencyParams(): AudioParam[] {
        const params: AudioParam[] = [fmOsc.frequency];
        if (shared.octaveOsc) {
          params.push(shared.octaveOsc.frequency);
        }
        return params;
      },
    };
  },
};

export default player;
