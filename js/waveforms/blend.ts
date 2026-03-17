// blend.ts — Blend (triangle) waveform strategy.
//
// Maps to a triangle/polygon shape visually and a crossfaded sawtooth +
// triangle oscillator pair. Timbre controls rotation (120-degree period)
// and the saw/tri blend ratio.

import { svgEl } from '../dom.ts';
import { safeStop } from '../audio/node-utils.ts';
import { yToFrequency } from '../audio/mapping.ts';
import { encodeInt, decodeInt, round3 } from '../serialize.ts';
import { type NormalizedCoord, normalizedCoord } from '../types.ts';
import type { HandleType, Voice, VoiceBase } from '../types.ts';
import type { AudioSharedNodes, AudioVoice, WaveformStrategy } from './types.ts';

function trianglePoints(voice: Voice): string {
  const r = voice.size / 2;
  const pts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
    const px = voice.x + Math.cos(angle) * r;
    const py = voice.y + Math.sin(angle) * r;
    pts.push(`${px},${py}`);
  }
  return pts.join(' ');
}

function triangleAttrs(voice: Voice): Record<string, string> {
  return { points: trianglePoints(voice) };
}

const blend: WaveformStrategy = {
  waveform: 'blend',
  shapeName: 'triangle',
  svgTag: 'polygon',
  hasTimbre: true,
  rotationPeriod: 120,
  serializationIndex: 2,
  oscillatorType: 'sawtooth',
  shapeAreaCoeff: (3 * Math.sqrt(3)) / 4,
  formantMaxQ: 8,

  svgAttrs: triangleAttrs,

  createSvgElement(voice: Voice): SVGElement {
    const el = svgEl('polygon');
    el.setAttribute('points', trianglePoints(voice));
    return el;
  },

  updateSvgElement(el: SVGElement, voice: Voice): void {
    el.setAttribute('points', trianglePoints(voice));
  },

  handlePositions(voice: Voice): [HandleType, number, number][] {
    const r = voice.size / 2;
    const positions: [HandleType, number, number][] = [];
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
      const px = voice.x + Math.cos(angle) * r;
      const py = voice.y + Math.sin(angle) * r;
      const handle: HandleType = i === 0 ? 'n' : i === 1 ? 'se' : 'sw';
      positions.push([handle, px, py]);
    }
    return positions;
  },

  buildAudioGraph(ctx: AudioContext, voice: Voice, shared: AudioSharedNodes): AudioVoice {
    const timbre = 'timbre' in voice ? voice.timbre : 0;
    const freq = yToFrequency(voice.y);

    const oscSaw = new OscillatorNode(ctx, { type: 'sawtooth', frequency: freq });
    const oscTri = new OscillatorNode(ctx, { type: 'triangle', frequency: freq });
    const gainSaw = new GainNode(ctx);
    const gainTri = new GainNode(ctx);

    const mix = 1 - Math.abs(timbre - 0.5) * 2;
    gainTri.gain.value = Math.sin((mix * Math.PI) / 2);
    gainSaw.gain.value = Math.cos((mix * Math.PI) / 2);

    oscSaw.connect(gainSaw);
    oscTri.connect(gainTri);
    gainSaw.connect(shared.gain);
    gainTri.connect(shared.gain);

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
        const mix = 1 - Math.abs(timbre - 0.5) * 2;
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

  createVoice(base: VoiceBase): Voice {
    return { ...base, timbre: normalizedCoord(0), waveform: 'blend' };
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

export default blend;
