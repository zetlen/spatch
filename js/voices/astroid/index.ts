import { normalizedCoord } from '../../types.ts';
import type { VoiceBase } from '../../types.ts';
import type { VoiceRegistryEntry } from '../types.ts';
import { createOscillatorSerializer } from '../serializers/oscillator.ts';
import ui from './ui.ts';
import player from './player.ts';

const entry: VoiceRegistryEntry = {
  waveform: 'astroid',
  id: 3,
  rotationPeriod: 90,
  ui,
  player,
  serializer: createOscillatorSerializer(),
  createVoice: (base: VoiceBase) => ({ ...base, waveform: 'astroid', timbre: normalizedCoord(0) }),
};

export default entry;
