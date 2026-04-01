// Voice-builder.ts — Voice audio graph construction, types, and utilities.
//
// Contains utility functions and the buildVoice factory that constructs
// The full audio graph for a single voice. Waveform-specific graph
// Construction is delegated to waveform strategies.

import type { AudioEffect, Fill, PatternType, Voice } from '../types.ts';
import { yToFrequency } from './mapping.ts';
import { applyColorParams, FORMANT_MIX, FORMANT_Q } from './filters.ts';
import type { Mixer } from './mixer.ts';
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
  if (fill.mode !== 'linear') {
    return undefined;
  }
  return `${fill.h}:${fill.c}:${fill.l}:${fill.h2}:${fill.c2}:${fill.l2}:${fill.gradAngle}`;
}

const BRIGHTNESS_Q = Math.SQRT1_2;
const WARMTH = 1.5;

// ---- Voice graph builder ----

/**
 * Build the complete Web Audio graph for a single voice.
 *
 * Creates shared plumbing (gain, dual formant bandpass filters, brightness
 * lowpass, stereo panner, pattern/blend effects, border octave doubling),
 * then delegates waveform-specific oscillator construction to the waveform
 * strategy's `buildAudioGraph` method.
 *
 * Signal chain:
 *   primary osc → [voice processing] → gain → F1 bandpass ──┐
 *                                           → F2 bandpass ──┤→ mixer → brightness → [effect] → panner → master
 *   border osc → borderGain → gain   (sibling of primary, same downstream chain)
 */
export function buildVoice(
  ctx: AudioContext,
  voice: Voice,
  masterGain: GainNode,
  mixer: Mixer,
  createPatternEffect: (ctx: AudioContext, effect: PatternType) => AudioEffect | undefined,
) {
  const gain = new GainNode(ctx, { gain: mixer.voiceGain(voice.waveform, voice.size) });

  const freq = yToFrequency(voice.y);

  // Dual formant filters: hue → F1 (vowel height), chroma → F2 (vowel frontness)
  const f1 = new BiquadFilterNode(ctx, { type: 'bandpass', Q: FORMANT_Q });
  const f2 = new BiquadFilterNode(ctx, { type: 'bandpass', Q: FORMANT_Q });
  const formantMixer = new GainNode(ctx, { gain: FORMANT_MIX });

  // Lightness → brightness lowpass (wide, gentle)
  const brightness = new BiquadFilterNode(ctx, { type: 'lowpass', Q: BRIGHTNESS_Q });

  applyColorParams(f1, f2, brightness, voice.fill);

  const panner = new StereoPannerNode(ctx, { pan: mixer.xToPan(voice.x) });

  // Wire: gain → F1 → mixer → brightness → [effect] → panner → master
  //       gain → F2 → mixer
  //       [border osc → borderGain → gain]  (sibling of primary, same chain)
  // FM synthesis for blend modes is handled at the engine level (cross-voice routing).
  gain.connect(f1);
  gain.connect(f2);
  f1.connect(formantMixer);
  f2.connect(formantMixer);
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
  let octaveOsc: OscillatorNode | undefined;
  let octaveGainNode: GainNode | undefined;
  if (voice.border) {
    const octaveShift = voice.border.double ? 2 : 1;
    const direction = voice.border.color === 'white' ? 1 : -1;
    const octaveFreq = freq * 2 ** (direction * octaveShift);

    octaveOsc = new OscillatorNode(ctx, {
      type: get(voice.waveform).player.oscillatorType,
      frequency: octaveFreq,
    });

    octaveGainNode = new GainNode(ctx, {
      gain: mixer.borderOctaveGain(voice.border.thickness, voice.border.color, voice.border.double),
    });
    octaveOsc.connect(octaveGainNode);
    octaveGainNode.connect(gain);
  }

  const borderKey = voice.border
    ? `${voice.border.color}:${voice.border.double ? 1 : 0}`
    : undefined;

  const shared: AudioSharedNodes = {
    ctx,
    gain,
    f1,
    f2,
    formantMixer,
    brightness,
    panner,
    octaveOsc,
    octaveGainNode,
    effectDispose,
    currentEffect: voice.effect,
    currentBorder: borderKey,
    currentFillKey: fillToKey(voice.fill),
    warmth: WARMTH,
  };

  return get(voice.waveform).player.buildAudioGraph(ctx, voice, shared);
}
