// sine.ts — Sine (circle) waveform strategy.
//
// Maps to a circle shape visually and a sine oscillator with analog warmth
// shaping. No timbre parameter (circles have no rotation).

import { setAttrs, svgEl } from '../dom.ts';
import { makeSaturationCurve, safeStop } from '../audio/node-utils.ts';
import { yToFrequency } from '../audio/mapping.ts';
import type { HandleType, Voice, VoiceBase } from '../types.ts';
import type { AudioSharedNodes, AudioVoice, WaveformStrategy } from './types.ts';

function circleAttrs(voice: Voice): Record<string, string> {
  const r = voice.size / 2;
  return { cx: String(voice.x), cy: String(voice.y), r: String(r) };
}

const sine: WaveformStrategy = {
  waveform: 'sine',
  shapeName: 'circle',
  svgTag: 'circle',
  hasTimbre: false,
  rotationPeriod: 0,
  serializationIndex: 0,
  oscillatorType: 'sine',
  shapeAreaCoeff: Math.PI,
  formantMaxQ: 4,

  svgAttrs: circleAttrs,

  createSvgElement(voice: Voice): SVGElement {
    const el = svgEl('circle');
    setAttrs(el, circleAttrs(voice));
    return el;
  },

  updateSvgElement(el: SVGElement, voice: Voice): void {
    setAttrs(el, circleAttrs(voice));
  },

  handlePositions(voice: Voice): [HandleType, number, number][] {
    const r = voice.size / 2;
    return [
      ['e', voice.x + r, voice.y],
      ['n', voice.x, voice.y - r],
      ['w', voice.x - r, voice.y],
      ['s', voice.x, voice.y + r],
    ];
  },

  buildAudioGraph(ctx: AudioContext, voice: Voice, shared: AudioSharedNodes): AudioVoice {
    const freq = yToFrequency(voice.y);

    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: freq });

    // Soft-saturation warmth shaper (analog impurity)
    const sineWarm = new WaveShaperNode(ctx);
    sineWarm.curve = makeSaturationCurve(shared.warmth);
    sineWarm.oversample = '2x';

    osc.connect(sineWarm);
    sineWarm.connect(shared.gain);

    return {
      ...shared,
      hasSweep: false,
      lastX: voice.x as number,
      lastY: voice.y as number,
      lastSize: voice.size as number,
      outputNode: shared.panner,
      shapeId: voice.id,
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

  createVoice(base: VoiceBase): Voice {
    return { ...base, waveform: 'sine' };
  },

  packExtra(_voice: Voice): string {
    return '';
  },

  unpackExtra(_str: string, _idx: number): { fields: Record<string, unknown>; bytesRead: number } {
    return { fields: {}, bytesRead: 0 };
  },
};

export default sine;
