// sample.ts — Shared serializer for sample-based voices (stamp).
//
// Same register layout as oscillator serializer, except SP4 encodes
// stamp index (3b) + trigger position (2b) + spare (1b) instead of timbre.

import type { Voice, WaveformType } from '../../types.ts';
import { encodeInt, decodeInt } from '../b64.ts';
import type { VoiceSerializer } from '../types.ts';
import { createOscillatorSerializer } from './oscillator.ts';

// Reuse the oscillator serializer as a base — the only difference is SP4.
const base = createOscillatorSerializer();

export function createSampleSerializer(): VoiceSerializer {
  return {
    solidWidth: base.solidWidth,
    gradientWidth: base.gradientWidth,

    pack(voice: Voice): string {
      const stampIndex = 'stamp' in voice ? (voice as { stamp: number }).stamp : 0;
      const trigger = 'trigger' in voice ? (voice as { trigger: number }).trigger : 1;
      const sp4 = ((stampIndex & 0x7) << 3) | ((trigger & 0x3) << 1);

      const packed = base.pack(voice);
      const sp4Offset = voice.fill.mode === 'linear' ? 13 : 8;
      return packed.slice(0, sp4Offset) + encodeInt(sp4, 1) + packed.slice(sp4Offset + 1);
    },

    unpack(registers: string, waveform: WaveformType): Voice {
      const voice = base.unpack(registers, waveform);

      const isGradient = registers.length === this.gradientWidth;
      const sp4Offset = isGradient ? 13 : 8;
      const sp4 = decodeInt(registers, sp4Offset, 1);
      const stampIndex = (sp4 >> 3) & 0x7;
      const rawTrigger = (sp4 >> 1) & 0x3;
      const trigger = rawTrigger > 2 ? 1 : rawTrigger;

      return { ...voice, stamp: stampIndex, trigger } as Voice;
    },
  };
}
