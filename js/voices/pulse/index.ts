import { normalizedCoord } from '../../types.ts';
import type { VoiceBase } from '../../types.ts';
import type { VoiceRegistryEntry } from '../types.ts';
import { createOscillatorSerializer } from '../serializers/oscillator.ts';
import ui from './ui.ts';
import player from './player.ts';

const entry: VoiceRegistryEntry = {
  waveform: 'pulse',
  id: 1,
  rotationPeriod: 90,
  panels: { border: true, stample: false },
  ui,
  player,
  serializer: createOscillatorSerializer(),
  createVoice: (base: VoiceBase) => ({ ...base, waveform: 'pulse', timbre: normalizedCoord(0) }),
};

export default entry;
