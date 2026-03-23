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
      // Pack using the oscillator serializer, then patch SP4.
      // SP4 is at offset solidWidth-3 (for solid) or gradientWidth-3 (for gradient)
      // from the start: CP1(4) + [CP2(5)] + SP1(1) + MP1(2) + SP3(1) + [SP4] + SP5 + SP6
      // SP4 position = 4 + (gradient ? 5 : 0) + 4 = 8 or 13

      const stampIndex = 'stamp' in voice ? (voice as { stamp: number }).stamp : 0;
      // SP4 for sample: stamp index (3b) + trigger (2b) + spare (1b)
      // trigger not yet implemented, so bits 2-0 are spare
      const sp4 = (stampIndex & 0x7) << 3;

      // Build using oscillator pack (which sets SP4 to timbre=0 for non-timbre voices)
      // then overwrite SP4
      const packed = base.pack(voice);
      const sp4Offset = voice.fill.mode === 'linear' ? 13 : 8;
      return packed.slice(0, sp4Offset) + encodeInt(sp4, 1) + packed.slice(sp4Offset + 1);
    },

    unpack(registers: string, waveform: WaveformType): Voice {
      // Unpack using oscillator serializer (which ignores SP4 for stamp waveform)
      const voice = base.unpack(registers, waveform);

      // Read SP4 manually for stamp-specific fields
      const isGradient = registers.length === this.gradientWidth;
      const sp4Offset = isGradient ? 13 : 8;
      const sp4 = decodeInt(registers, sp4Offset, 1);
      const stampIndex = (sp4 >> 3) & 0x7;

      return { ...voice, stamp: stampIndex } as Voice;
    },
  };
}
