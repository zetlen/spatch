import type { VoiceBase, Voice } from '../../types.ts';
import type { VoiceRegistryEntry } from '../types.ts';
import { createSampleSerializer } from '../serializers/sample.ts';
import { getDefaultStampleIndex } from './lifecycle.ts';
import ui from './ui.ts';
import player from './player.ts';

const entry: VoiceRegistryEntry = {
  waveform: 'stamp',
  id: 4,
  rotationPeriod: 0,
  ui,
  player,
  serializer: createSampleSerializer(),
  createVoice: (base: VoiceBase) =>
    ({ ...base, waveform: 'stamp', stamp: getDefaultStampleIndex() }) as Voice,
};

export default entry;
