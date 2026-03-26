import type { VoiceBase } from '../../types.ts';
import type { VoiceRegistryEntry } from '../types.ts';
import { createOscillatorSerializer } from '../serializers/oscillator.ts';
import ui from './ui.ts';
import player from './player.ts';

const entry: VoiceRegistryEntry = {
  waveform: 'sine',
  id: 0,
  rotationPeriod: 0,
  panels: { border: true, stample: false },
  ui,
  player,
  serializer: createOscillatorSerializer(),
  createVoice: (base: VoiceBase) => ({ ...base, waveform: 'sine' }),
};

export default entry;
