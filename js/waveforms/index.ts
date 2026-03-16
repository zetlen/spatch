// index.ts — Waveform strategy registry.
//
// Maps WaveformType to its strategy object. Consumer files dispatch
// through getStrategy() instead of per-waveform switch/case blocks.

import type { WaveformType } from '../types.ts';
import type { WaveformStrategy } from './types.ts';
import sine from './sine.ts';
import pulse from './pulse.ts';
import blend from './blend.ts';

const STRATEGIES = new Map<WaveformType, WaveformStrategy>([
  ['sine', sine],
  ['pulse', pulse],
  ['blend', blend],
]);

/** Look up the strategy for a waveform type. */
export function getStrategy(waveform: WaveformType): WaveformStrategy {
  return STRATEGIES.get(waveform)!;
}

/** All strategies sorted by serialization index (stable order for bitfield packing). */
export const ALL_STRATEGIES: WaveformStrategy[] = [...STRATEGIES.values()].sort(
  (a, b) => a.serializationIndex - b.serializationIndex,
);
