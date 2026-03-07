// voice-builder.ts — Voice audio graph construction, types, and utilities.
//
// Contains the AudioVoice type hierarchy, Web Audio utility functions,
// and the buildVoice factory that constructs the full graph for a single voice.

import type { BlendEffect } from '../effects.ts';
import { createBlendEffect } from '../effects.ts';
import type { AudioEffect, BlendMode, PatternType, Voice, WaveformType } from '../types.ts';
import { xToPan, yToFrequency } from './mapping.ts';
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
  blendEffect: BlendEffect | undefined;
  octaveOsc: OscillatorNode | undefined;
  octaveGainNode: GainNode | undefined;
  shapeId: string;
  gain: GainNode;
  formantF1: BiquadFilterNode;
  formantF2: BiquadFilterNode;
  brightness: BiquadFilterNode;
  panner: StereoPannerNode;
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
  const ws = audioCtx.createWaveShaper();
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = x > 0 ? 1 : -1;
  }
  ws.curve = curve;
  ws.oversample = '4x';
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

/** Generate an algorithmic reverb impulse response buffer from vibe params. */
export function generateImpulseResponse(ctx: AudioContext): AudioBuffer {
  const { sampleRate } = ctx;
  const duration = vibe.reverbDuration;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      let sample = (Math.random() * 2 - 1) * Math.exp(-vibe.reverbDecay * t);
      sample *= Math.max(0, 1 - t * (1 - vibe.reverbTone));
      data[i] = sample;
    }
  }
  return buffer;
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
  const gain = ctx.createGain();
  gain.gain.value = vibe.voiceGain(voice.waveform, voice.size);

  const freq = yToFrequency(voice.y);

  // Dual formant filter bank + brightness shelf
  const formantF1 = ctx.createBiquadFilter();
  formantF1.type = 'bandpass';
  const formantF2 = ctx.createBiquadFilter();
  formantF2.type = 'bandpass';
  const formantMixer = ctx.createGain();
  formantMixer.gain.value = vibe.formantMix;
  const brightness = ctx.createBiquadFilter();
  brightness.type = 'lowpass';
  brightness.Q.value = vibe.brightnessQ;

  applyFormantFilter(formantF1, formantF2, brightness, voice.fill, voice.waveform);

  const panner = ctx.createStereoPanner();
  panner.pan.value = xToPan(voice.x);

  // Blend effect: overlap-driven audio processing
  const blendFx = createBlendEffect(ctx, voice.blend);

  // Wire: gain -> F1 -> mixer -> brightness -> [effect] -> blendFx -> panner -> master
  //       Gain -> F2 -> mixer
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

  lastNode.connect(blendFx.input);
  blendFx.output.connect(panner);
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

    octaveOsc = ctx.createOscillator();
    // Match oscillator type to voice waveform (#83)
    const oscTypeMap: Record<WaveformType, OscillatorType> = {
      blend: 'sawtooth',
      pulse: 'square',
      sine: 'sine',
    };
    octaveOsc.type = oscTypeMap[voice.waveform];
    octaveOsc.frequency.value = octaveFreq;

    octaveGainNode = ctx.createGain();
    octaveGainNode.gain.value = vibe.borderOctaveGain(
      voice.waveform,
      voice.size,
      voice.border.thickness,
      voice.border.color,
      voice.border.double,
    );
    octaveOsc.connect(octaveGainNode);
    // Connect to formantMixer to avoid double gain application (#81)
    octaveGainNode.connect(formantMixer);
  }

  const borderKey = voice.border
    ? `${voice.border.color}:${voice.border.double ? 1 : 0}`
    : undefined;

  const shared = {
    blendEffect: blendFx,
    brightness,
    currentBlend: voice.blend,
    currentBorder: borderKey,
    currentEffect: voice.effect,
    effectDispose,
    formantF1,
    formantF2,
    gain,
    octaveGainNode,
    octaveOsc,
    outputNode: panner,
    panner,
    shapeId: voice.id,
  };

  if (voice.waveform === 'pulse') {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;

    const pwmOffset = ctx.createConstantSource();
    pwmOffset.offset.value = (timbre * 2 - 1) * 0.9;

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
    const oscSaw = ctx.createOscillator();
    oscSaw.type = 'sawtooth';
    oscSaw.frequency.value = freq;

    const oscTri = ctx.createOscillator();
    oscTri.type = 'triangle';
    oscTri.frequency.value = freq;

    const gainSaw = ctx.createGain();
    const gainTri = ctx.createGain();

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
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;

  const sineWarm = ctx.createWaveShaper();
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
