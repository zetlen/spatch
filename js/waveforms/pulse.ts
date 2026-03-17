// pulse.ts — Pulse (square) waveform strategy.
//
// Maps to a square/rect shape visually and a sawtooth + PWM waveshaper for
// variable pulse width. Timbre controls rotation (90-degree period).

import { setAttrs, svgEl } from '../dom.ts';
import { safeStop, createPWMWaveshaper } from '../audio/node-utils.ts';
import { timbreToPWMOffset, yToFrequency } from '../audio/mapping.ts';
import { encodeInt, decodeInt, round3 } from '../serialize.ts';
import { type NormalizedCoord, normalizedCoord } from '../types.ts';
import type { HandleType, Voice, VoiceBase } from '../types.ts';
import type { AudioSharedNodes, AudioVoice, WaveformStrategy } from './types.ts';

function rectAttrs(voice: Voice): Record<string, string> {
  const r = voice.size / 2;
  return {
    height: String(voice.size),
    width: String(voice.size),
    x: String(voice.x - r),
    y: String(voice.y - r),
  };
}

const pulse: WaveformStrategy = {
  waveform: 'pulse',
  shapeName: 'square',
  svgTag: 'rect',
  hasTimbre: true,
  rotationPeriod: 90,
  serializationIndex: 1,
  oscillatorType: 'square',
  shapeAreaCoeff: 4,
  formantMaxQ: 8,

  svgAttrs: rectAttrs,

  createSvgElement(voice: Voice): SVGElement {
    const el = svgEl('rect');
    setAttrs(el, rectAttrs(voice));
    return el;
  },

  updateSvgElement(el: SVGElement, voice: Voice): void {
    setAttrs(el, rectAttrs(voice));
  },

  handlePositions(voice: Voice): [HandleType, number, number][] {
    const r = voice.size / 2;
    return [
      ['nw', voice.x - r, voice.y - r],
      ['ne', voice.x + r, voice.y - r],
      ['se', voice.x + r, voice.y + r],
      ['sw', voice.x - r, voice.y + r],
    ];
  },

  buildAudioGraph(ctx: AudioContext, voice: Voice, shared: AudioSharedNodes): AudioVoice {
    const timbre = 'timbre' in voice ? voice.timbre : 0;
    const freq = yToFrequency(voice.y);

    const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: freq });
    const pwmOffset = new ConstantSourceNode(ctx, {
      offset: timbreToPWMOffset(timbre),
    });
    const ws = createPWMWaveshaper(ctx);

    osc.connect(ws);
    pwmOffset.connect(ws);
    ws.connect(shared.gain);

    pwmOffset.start();

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

  createVoice(base: VoiceBase): Voice {
    return { ...base, timbre: normalizedCoord(0), waveform: 'pulse' };
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

export default pulse;
