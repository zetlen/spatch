// registry.ts — Voice type registry.
//
// Flat table mapping WaveformType to its three delegates (UI, Player,
// Serializer) plus identity metadata. Consumer files look up entries by
// waveform name or numeric ID.

import type { Voice, VoiceBase, WaveformType } from '../types.ts';
import type { VoiceRegistryEntry } from './types.ts';
import sine from './sine/index.ts';
import pulse from './pulse/index.ts';
import blend from './blend/index.ts';
import astroid from './astroid/index.ts';
import stamp from './stamp/index.ts';

const byWaveform = new Map<WaveformType, VoiceRegistryEntry>();
const byId: VoiceRegistryEntry[] = [];

/** Register a voice type. Called by each voice's index.ts at import time. */
export function register(entry: VoiceRegistryEntry): void {
  byWaveform.set(entry.waveform, entry);
  byId[entry.id] = entry;
}

/** Look up a voice type by waveform name. */
export function get(waveform: WaveformType): VoiceRegistryEntry {
  const entry = byWaveform.get(waveform);
  if (!entry) throw new Error(`Unknown waveform: ${waveform}`);
  return entry;
}

/** Look up a voice type by numeric serialization ID. */
export function getById(id: number): VoiceRegistryEntry | undefined {
  return byId[id];
}

/** All registered voice types, sorted by ID. */
export function all(): VoiceRegistryEntry[] {
  return [...byWaveform.values()].sort((a, b) => a.id - b.id);
}

/** Whether a waveform type supports timbre (rotation). */
export function hasTimbre(waveform: WaveformType): boolean {
  return get(waveform).rotationPeriod > 0;
}

/** Create a Voice from a VoiceBase, applying the waveform's extra field
 *  defaults (timbre, stamp, etc.). */
export function createVoice(waveform: WaveformType, base: VoiceBase): Voice {
  return get(waveform).createVoice(base);
}

// ---- Populate registry ----
for (const entry of [sine, pulse, blend, astroid, stamp]) {
  register(entry);
}
