// voice-builder.ts — Voice audio graph construction, types, and utilities.
//
// Contains utility functions and the buildVoice factory that constructs
// the full audio graph for a single voice. Waveform-specific graph
// construction is delegated to waveform strategies.

import type { AudioEffect, Fill, PatternType, Voice } from '../types.ts';
import { yToFrequency } from './mapping.ts';
import { applyFormantFilter } from './formants.ts';
import { vibe } from './vibe.ts';
import { get } from '../voices/registry.ts';
import type { AudioSharedNodes } from '../voices/types.ts';
export type { AudioVoice } from '../voices/types.ts';

// Re-export utilities from node-utils so callers (engine.ts etc.) don't need to change.
export {
  safeStop,
  safeDisconnect,
  makeSaturationCurve,
  createPWMWaveshaper,
} from './node-utils.ts';

/** Compute a stable key for a linear fill, or undefined for solid fills. */
export function fillToKey(fill: Fill): string | undefined {
  if (fill.mode !== 'linear') return undefined;
  return `${fill.h}:${fill.s}:${fill.l}:${fill.h2}:${fill.s2}:${fill.l2}:${fill.gradAngle}`;
}

// ---- Voice graph builder ----

/**
 * Build the complete Web Audio graph for a single voice.
 *
 * Creates shared plumbing (gain, formant filters, stereo panner, pattern/blend
 * effects, border octave doubling), then delegates waveform-specific oscillator
 * construction to the waveform strategy's `buildAudioGraph` method.
 *
 * @param ctx - The active AudioContext
 * @param voice - Voice data from the sigil store
 * @param masterGain - The master gain node to connect the voice output to
 * @param createPatternEffect - Factory for pattern-driven audio effects
 * @returns A fully wired AudioVoice ready to be started
 */
export function buildVoice(
  ctx: AudioContext,
  voice: Voice,
  masterGain: GainNode,
  createPatternEffect: (ctx: AudioContext, effect: PatternType) => AudioEffect | undefined,
) {
  const gain = new GainNode(ctx, { gain: vibe.voiceGain(voice.waveform, voice.size) });

  const freq = yToFrequency(voice.y);

  // Dual formant filter bank + brightness shelf
  const formantF1 = new BiquadFilterNode(ctx, { type: 'bandpass' });
  const formantF2 = new BiquadFilterNode(ctx, { type: 'bandpass' });
  const formantMixer = new GainNode(ctx, { gain: vibe.formantMix });
  const brightness = new BiquadFilterNode(ctx, { type: 'lowpass', Q: vibe.brightnessQ });

  applyFormantFilter(formantF1, formantF2, brightness, voice.fill, voice.waveform);

  const panner = new StereoPannerNode(ctx, { pan: vibe.xToPan(voice.x) });

  // Wire: gain -> F1 -> mixer -> brightness -> [effect] -> panner -> master
  //       gain -> F2 -> mixer
  //       [border osc -> borderGain -> gain]  (sibling of primary, same chain)
  // FM synthesis for blend modes is handled at the engine level (cross-voice routing).
  gain.connect(formantF1);
  gain.connect(formantF2);
  formantF1.connect(formantMixer);
  formantF2.connect(formantMixer);
  formantMixer.connect(brightness);

  let lastNode: AudioNode = brightness;
  let effectDispose;

  if (voice.effect) {
    const effect = createPatternEffect(ctx, voice.effect);
    if (effect) {
      lastNode.connect(effect.input);
      lastNode = effect.output;
      effectDispose = effect.dispose;
    }
  }

  lastNode.connect(panner);
  panner.connect(masterGain);

  // Octave doubling: border adds an oscillator at shifted frequency.
  // White = up, black = down. Single = 1 octave, double = 2 octaves.
  // Thickness scales the doubled voice gain.
  let octaveOsc: OscillatorNode | undefined;
  let octaveGainNode: GainNode | undefined;
  if (voice.border) {
    const octaveShift = voice.border.double ? 2 : 1;
    const direction = voice.border.color === 'white' ? 1 : -1;
    const octaveFreq = freq * 2 ** (direction * octaveShift);

    // Match oscillator type to voice waveform (#83)
    octaveOsc = new OscillatorNode(ctx, {
      type: get(voice.waveform).player.oscillatorType,
      frequency: octaveFreq,
    });

    octaveGainNode = new GainNode(ctx, {
      gain: vibe.borderOctaveGain(voice.border.thickness, voice.border.color, voice.border.double),
    });
    octaveOsc.connect(octaveGainNode);
    // Connect to voice gain so border traverses the same chain as the primary
    // oscillator: gain → F1/F2 → mixer → brightness → effect → panner → master.
    octaveGainNode.connect(gain);
  }

  const borderKey = voice.border
    ? `${voice.border.color}:${voice.border.double ? 1 : 0}`
    : undefined;

  const shared: AudioSharedNodes = {
    ctx,
    gain,
    formantF1,
    formantF2,
    formantMixer,
    brightness,
    panner,
    octaveOsc,
    octaveGainNode,
    effectDispose,
    currentEffect: voice.effect,
    currentBorder: borderKey,
    currentFillKey: fillToKey(voice.fill),
    warmth: vibe.warmth,
  };

  return get(voice.waveform).player.buildAudioGraph(ctx, voice, shared);
}
