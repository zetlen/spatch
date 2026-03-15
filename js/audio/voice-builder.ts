// voice-builder.ts — Voice audio graph construction, types, and utilities.
//
// Contains the AudioVoice type hierarchy, Web Audio utility functions,
// and the buildVoice factory that constructs the full graph for a single voice.

import type { AudioEffect, BlendMode, Fill, PatternType, Voice, WaveformType } from '../types.ts';
import { timbreToPWMOffset, yToFrequency } from './mapping.ts';
import { applyFormantFilter } from './formants.ts';
import { vibe } from './vibe.ts';

// ---- Audio voice types ----

/** Base fields shared by all audio voice graph wrappers. */
export interface AudioVoiceBase {
  outputNode: StereoPannerNode;
  effectDispose: (() => void) | undefined;
  currentEffect: string | undefined;
  currentBlend: BlendMode;
  currentBorder: string | undefined; // Serialized border for change detection
  currentFillKey: string | undefined;
  hasSweep: boolean;
  octaveOsc: OscillatorNode | undefined;
  octaveGainNode: GainNode | undefined;
  shapeId: string;
  gain: GainNode;
  formantF1: BiquadFilterNode;
  formantF2: BiquadFilterNode;
  formantMixer: GainNode;
  brightness: BiquadFilterNode;
  warmthShaper: WaveShaperNode | undefined;
  panner: StereoPannerNode;
  lastX: number;
  lastY: number;
  lastSize: number;
  start(time: number): void;
  stop(time: number): void;
}

/** Audio voice wrapper for sine waveform (circle shape). */
export interface SineAudioVoice extends AudioVoiceBase {
  waveform: 'sine';
  oscillator: OscillatorNode;
}

/** Audio voice wrapper for square/pulse waveform (square shape). */
export interface SquareAudioVoice extends AudioVoiceBase {
  waveform: 'square';
  oscRaw: OscillatorNode;
  pwmOffset: ConstantSourceNode;
}

/** Audio voice wrapper for triangle/blend waveform (triangle shape). */
export interface TriangleAudioVoice extends AudioVoiceBase {
  waveform: 'triangle';
  oscSaw: OscillatorNode;
  oscTri: OscillatorNode;
  gainSaw: GainNode;
  gainTri: GainNode;
}

/** Discriminated union of all shape audio voice types. */
export type AudioVoice = SineAudioVoice | SquareAudioVoice | TriangleAudioVoice;

// ---- Utility functions ----

/** Create a hard-clipping waveshaper curve for pulse-width modulation. */
function createPWMWaveshaper(audioCtx: AudioContext): WaveShaperNode {
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = x > 0 ? 1 : -1;
  }
  const ws = new WaveShaperNode(audioCtx, { curve, oversample: '4x' });
  return ws;
}

/** Safely stop and disconnect an AudioScheduledSourceNode. */
export function safeStop(node: AudioScheduledSourceNode): void {
  try {
    node.stop();
    node.disconnect();
  } catch {}
}

/** Safely disconnect an AudioNode. */
export function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {}
}

/** Compute a stable key for a linear fill, or undefined for solid fills. */
export function fillToKey(fill: Fill): string | undefined {
  if (fill.mode !== 'linear') return undefined;
  return `${fill.h}:${fill.s}:${fill.l}:${fill.h2}:${fill.s2}:${fill.l2}:${fill.gradAngle}`;
}

// ---- Voice graph builder ----

/**
 * Build the complete Web Audio graph for a single voice.
 *
 * Creates oscillator(s), formant filters, stereo panner, pattern/blend effects,
 * and optional border octave doubling. Returns an {@link AudioVoice} with
 * `start()` and `stop()` methods.
 *
 * Three internal paths handle the three waveform types:
 * - **sine** (circle): single oscillator with soft-saturation warmth
 * - **pulse** (square): sawtooth + PWM waveshaper for variable pulse width
 * - **blend** (triangle): crossfaded sawtooth + triangle pair
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
): AudioVoice {
  const timbre = 'timbre' in voice ? voice.timbre : 0;
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

  // Octave doubling: border adds a sine oscillator at shifted frequency.
  // White = up, black = down. Single = 1 octave, double = 2 octaves.
  // Thickness scales the doubled voice gain.
  let octaveOsc: OscillatorNode | undefined;
  let octaveGainNode: GainNode | undefined;
  if (voice.border) {
    const octaveShift = voice.border.double ? 2 : 1;
    const direction = voice.border.color === 'white' ? 1 : -1;
    const octaveFreq = freq * 2 ** (direction * octaveShift);

    // Match oscillator type to voice waveform (#83)
    const oscTypeMap: Record<WaveformType, OscillatorType> = {
      blend: 'sawtooth',
      pulse: 'square',
      sine: 'sine',
    };
    octaveOsc = new OscillatorNode(ctx, {
      type: oscTypeMap[voice.waveform],
      frequency: octaveFreq,
    });

    octaveGainNode = new GainNode(ctx, {
      gain: vibe.borderOctaveGain(
        voice.waveform,
        voice.size,
        voice.border.thickness,
        voice.border.color,
        voice.border.double,
      ),
    });
    octaveOsc.connect(octaveGainNode);
    // Connect to formantMixer to avoid double gain application (#81)
    octaveGainNode.connect(formantMixer);
  }

  const borderKey = voice.border
    ? `${voice.border.color}:${voice.border.double ? 1 : 0}`
    : undefined;

  const shared = {
    brightness,
    currentBlend: voice.blend,
    currentBorder: borderKey,
    currentEffect: voice.effect,
    currentFillKey: fillToKey(voice.fill),
    hasSweep: false,
    effectDispose,
    formantF1,
    formantF2,
    formantMixer,
    gain,
    lastX: voice.x as number,
    lastY: voice.y as number,
    lastSize: voice.size as number,
    octaveGainNode,
    octaveOsc,
    outputNode: panner,
    panner,
    shapeId: voice.id,
    warmthShaper: undefined as WaveShaperNode | undefined,
  };

  if (voice.waveform === 'pulse') {
    const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: freq });

    const pwmOffset = new ConstantSourceNode(ctx, { offset: timbreToPWMOffset(timbre) });

    const ws = createPWMWaveshaper(ctx);

    osc.connect(ws);
    pwmOffset.connect(ws);
    ws.connect(gain);

    pwmOffset.start();

    return {
      ...shared,
      oscRaw: osc,
      pwmOffset,
      start(time: number) {
        try {
          osc.start(time);
        } catch {}
        if (octaveOsc) {
          try {
            octaveOsc.start(time);
          } catch {}
        }
      },
      stop(_time: number) {
        safeStop(osc);
        safeStop(pwmOffset);
        if (octaveOsc) {
          safeStop(octaveOsc);
        }
      },
      waveform: 'square',
    };
  }

  if (voice.waveform === 'blend') {
    const oscSaw = new OscillatorNode(ctx, { type: 'sawtooth', frequency: freq });

    const oscTri = new OscillatorNode(ctx, { type: 'triangle', frequency: freq });

    const gainSaw = new GainNode(ctx);
    const gainTri = new GainNode(ctx);

    const mix = 1 - Math.abs(timbre - 0.5) * 2;
    gainTri.gain.value = Math.sin((mix * Math.PI) / 2);
    gainSaw.gain.value = Math.cos((mix * Math.PI) / 2);

    oscSaw.connect(gainSaw);
    oscTri.connect(gainTri);
    gainSaw.connect(gain);
    gainTri.connect(gain);

    return {
      ...shared,
      gainSaw,
      gainTri,
      oscSaw,
      oscTri,
      start(time: number) {
        oscSaw.start(time);
        oscTri.start(time);
        if (octaveOsc) {
          try {
            octaveOsc.start(time);
          } catch {}
        }
      },
      stop(_time: number) {
        safeStop(oscSaw);
        safeStop(oscTri);
        if (octaveOsc) {
          safeStop(octaveOsc);
        }
      },
      waveform: 'triangle',
    };
  }

  // Sine -- default, with subtle harmonic enrichment (analog impurity)
  const osc = new OscillatorNode(ctx, { type: 'sine', frequency: freq });

  const sineWarm = new WaveShaperNode(ctx);
  const warmSamples = 1024;
  const warmCurve = new Float32Array(warmSamples);
  for (let i = 0; i < warmSamples; i++) {
    const x = (i * 2) / warmSamples - 1;
    warmCurve[i] = Math.tanh(x * vibe.warmth);
  }
  sineWarm.curve = warmCurve;
  sineWarm.oversample = '2x';

  osc.connect(sineWarm);
  sineWarm.connect(gain);

  return {
    ...shared,
    oscillator: osc,
    warmthShaper: sineWarm,
    start(time: number) {
      osc.start(time);
      if (octaveOsc) {
        try {
          octaveOsc.start(time);
        } catch {}
      }
    },
    stop(_time: number) {
      safeStop(osc);
      if (octaveOsc) {
        safeStop(octaveOsc);
      }
    },
    waveform: 'sine',
  };
}

// ---- FM synthesis helpers ----

/** Get the primary oscillator node to use as an FM modulator source. */
export function getModulatorNode(voice: AudioVoice): OscillatorNode {
  switch (voice.waveform) {
    case 'sine':
      return voice.oscillator;
    case 'square':
      return voice.oscRaw;
    case 'triangle':
      return voice.oscSaw;
  }
}

/** Get all carrier frequency AudioParams that FM should modulate. */
export function getCarrierFrequencyParams(voice: AudioVoice): AudioParam[] {
  const params: AudioParam[] = [];
  switch (voice.waveform) {
    case 'sine':
      params.push(voice.oscillator.frequency);
      break;
    case 'square':
      params.push(voice.oscRaw.frequency);
      break;
    case 'triangle':
      params.push(voice.oscSaw.frequency, voice.oscTri.frequency);
      break;
  }
  if (voice.octaveOsc) {
    params.push(voice.octaveOsc.frequency);
  }
  return params;
}
