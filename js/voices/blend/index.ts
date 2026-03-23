import { normalizedCoord } from '../../types.ts';
import type { VoiceBase } from '../../types.ts';
import type { VoiceRegistryEntry } from '../types.ts';
import { createOscillatorSerializer } from '../serializers/oscillator.ts';
import ui from './ui.ts';
import player from './player.ts';

const entry: VoiceRegistryEntry = {
  waveform: 'blend',
  id: 2,
  rotationPeriod: 120,
  ui,
  player,
  serializer: createOscillatorSerializer(),
  createVoice: (base: VoiceBase) => ({ ...base, waveform: 'blend', timbre: normalizedCoord(0) }),
};

export default entry;
