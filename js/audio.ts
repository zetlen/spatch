// Audio.ts — Web Audio engine: oscillators, filters, spatial mapping

import {
  type BlendEffect,
  computeTotalOverlap,
  createBlendEffect,
  createEffect,
} from './effects.ts';
import { createVocoderChain } from './vocoder.ts';
import {
  type BlendMode,
  type BorderColor,
  type Envelope,
  type Fill,
  type NormalizedCoord,
  type Reverb,
  type ReverbStyle,
  type SigilData,
  type Voice,
  type WaveformType,
  normalizedCoord,
} from './types.ts';

// ---- Chromatic scale ----
// 3 octaves from G2 (MIDI 43) to G5 (MIDI 79): 37 semitones
const CHROMATIC_SEMITONES: number[] = [];
for (let i = 0; i <= 36; i++) {
  CHROMATIC_SEMITONES.push(i);
}

const BASE_MIDI = 43; // G2

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

// ---- Mapping functions ----

// Maximum micro-detuning in cents when positioned between note snap points.
// Set to 0 for hard chromatic snap. Can be re-enabled later as a deliberate
// Per-voice or global parameter rather than an accidental side effect.
const MAX_DETUNE_CENTS = 0;

export function yToFrequency(y: NormalizedCoord): number {
  // Y is 0-1, where 0=top (high pitch), 1=bottom (low pitch)
  const normalized = 1 - y;
  const continuous = normalized * (CHROMATIC_SEMITONES.length - 1);
  const index = Math.round(continuous);
  const clamped = Math.max(0, Math.min(CHROMATIC_SEMITONES.length - 1, index));
  const offset = continuous - clamped; // -0.5 to +0.5

  const baseFreq = midiToFreq(BASE_MIDI + CHROMATIC_SEMITONES[clamped]!);

  // Micro-detuning: tanh flattens near edges. Currently disabled (MAX_DETUNE_CENTS=0)
  // For hard chromatic snap. Can be re-enabled as a deliberate parameter.
  const detuneCents = MAX_DETUNE_CENTS * Math.tanh(offset * 3);
  return baseFreq * 2 ** (detuneCents / 1200);
}

// Magnetic snap: pull y toward nearest note position during drag.
// Uses a cubic curve so positions near note centers are "sticky" while
// Positions between notes are compressed but still reachable.
export function snapYToNote(y: NormalizedCoord): NormalizedCoord {
  const noteCount = CHROMATIC_SEMITONES.length;
  const normalized = 1 - y;
  const spacing = 1 / (noteCount - 1);

  const continuous = normalized / spacing;
  const nearestIndex = Math.round(continuous);
  const clamped = Math.max(0, Math.min(noteCount - 1, nearestIndex));
  const notePos = clamped * spacing;

  const halfZone = spacing / 2;
  const rawOffset = normalized - notePos;
  const t = Math.max(-1, Math.min(1, rawOffset / halfZone));

  // Cubic pull: t^3 preserves sign, creates wide sticky center
  const pulled = t * t * t;

  const snappedNormalized = notePos + pulled * halfZone;
  return normalizedCoord(1 - snappedNormalized);
}

export function xToPan(x: NormalizedCoord): number {
  return x * 2 - 1; // 0->-1 (left), 1->+1 (right)
}

// Area of a shape as a fraction of the 1x1 normalized canvas.
// All shapes use r = size/2 as bounding radius.
export function shapeAreaFraction(waveform: WaveformType, size: NormalizedCoord): number {
  const halfSize = size / 2;
  switch (waveform) {
    case 'sine': {
      return Math.PI * halfSize * halfSize;
    }
    case 'pulse': {
      return size * size;
    } // Side = 2r = size
    case 'blend': {
      // Equilateral inscribed in circle of radius size/2
      return ((3 * Math.sqrt(3)) / 4) * halfSize * halfSize;
    }
  }
}

// Map a shape's canvas area fraction to gain.
// Max area for a shape at size 0.9: square = 0.81, circle ~= 0.636, triangle ~= 0.263.
export function areaToGain(waveform: WaveformType, size: NormalizedCoord): number {
  const fraction = shapeAreaFraction(waveform, size);
  return Math.min(0.8, 0.05 + fraction);
}

// Map rotation to a periodic timbre parameter.
// Each waveform's visual symmetry period determines the audio cycle:
// A square repeats every 90 deg, a triangle every 120 deg.
// Linear sawtooth ramp: every angle within the period maps to a unique
// Timbre value (0 at the start, approaching 1 at the end).
const WAVEFORM_PERIOD: Record<string, number> = {
  blend: 120,
  pulse: 90,
};

export function rotationToTimbre(rotation: number, waveform: string): number {
  const period = WAVEFORM_PERIOD[waveform];
  if (!period) {
    return 0;
  } // Sine has no timbre
  const phase = ((rotation % period) + period) % period;
  return phase / period;
}

// Per-waveform perceived-loudness normalization.  Square and sawtooth have
// Higher RMS *and* excite more auditory critical bands than a pure sine,
// Making them sound louder at the same amplitude.  Sine needs a boost (~3 dB)
// To match perceived loudness; square and sawtooth are attenuated.
export function waveformGain(waveform: WaveformType): number {
  switch (waveform) {
    case 'pulse': {
      return 0.7;
    } // Square RMS ~= 1.41x sine, rich harmonics
    case 'blend': {
      return 0.85;
    } // Sawtooth RMS ~= 1.15x sine
    case 'sine': {
      return 1.6;
    } // Sine is single-partial; boost to match perceived loudness
  }
}

// Direction-dependent loudness coefficients for octave-doubled border oscillator.
// Higher octaves sound louder perceptually (equal-loudness contours), so we
// Attenuate up-shifts and boost down-shifts.
const OCTAVE_GAIN_COEFF: Record<string, number> = {
  'down-1': 1.5,
  'down-2': 2,
  'up-1': 0.5,
  'up-2': 0.35,
};

export function borderOctaveGain(
  waveform: WaveformType,
  size: NormalizedCoord,
  thickness: NormalizedCoord,
  color: BorderColor,
  double: boolean,
): number {
  const baseGain = areaToGain(waveform, size) * waveformGain(waveform);
  const direction = color === 'white' ? 'up' : 'down';
  const shift = double ? 2 : 1;
  const coeff = OCTAVE_GAIN_COEFF[`${direction}-${shift}`]!;
  return baseGain * Math.sqrt(thickness) * coeff;
}

// ---- PWM Waveshaper for Square (Pulse) ----

function createPWMWaveshaper(audioCtx: AudioContext) {
  const ws = audioCtx.createWaveShaper();
  const samples = 1024;
  const curve = new Float32Array(samples);
  // Provide a static hard-clipping curve where pulse width is animated
  // Dynamically by passing a DC bias through it.
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = x > 0 ? 1 : -1;
  }
  ws.curve = curve;
  // Over-sampling reduces aliasing from the hard clipping
  ws.oversample = '4x';
  return ws;
}

// ---- Formant filter mapping ----
//
// Hue drives a smooth path through vowel space (F1 = openness, F2 = frontness).
// Saturation controls formant resonance (Q). Lightness controls a brightness
// Shelf.  Linear gradient crossfades formants between the two colors; gradient
// Angle controls the blend bias.

interface FormantPoint {
  hue: number;
  f1: number;
  f2: number;
}

const FORMANT_ANCHORS: FormantPoint[] = [
  { f1: 730, f2: 1090, hue: 0 }, // /a/ -- open central
  { f1: 530, f2: 1840, hue: 60 }, // /e/ -- mid front
  { f1: 270, f2: 2290, hue: 120 }, // /i/ -- close front
  { f1: 300, f2: 870, hue: 180 }, // /u/ -- close back
  { f1: 570, f2: 840, hue: 240 }, // /o/ -- mid back
  { f1: 680, f2: 1100, hue: 300 }, // /a:/ -- open back
];

export function hueToFormants(hue: number): { f1: number; f2: number } {
  const h = ((hue % 360) + 360) % 360;
  const n = FORMANT_ANCHORS.length;

  // Find the two anchors that bracket this hue
  let lo = FORMANT_ANCHORS[n - 1]!;
  let hi = FORMANT_ANCHORS[0]!;
  for (let i = 0; i < n; i++) {
    const a = FORMANT_ANCHORS[i]!;
    const b = FORMANT_ANCHORS[(i + 1) % n]!;
    const aHue = a.hue;
    const bHue = i === n - 1 ? 360 : b.hue;
    if (h >= aHue && h < bHue) {
      lo = a;
      hi = b;
      const t = (h - aHue) / (bHue - aHue);
      return {
        f1: lo.f1 + (hi.f1 - lo.f1) * t,
        f2: lo.f2 + (hi.f2 - lo.f2) * t,
      };
    }
  }

  // Fallback (shouldn't reach here)
  return { f1: lo.f1, f2: hi.f2 };
}

// Lightness → lowpass cutoff: exponential mapping from dark (muffled) to light (open).
// 300 Hz at black, ~2500 Hz at mid grey, 12000 Hz at white.
export function lightnessToCutoff(lightness: number): number {
  const t = lightness / 100; // 0–1
  return 300 * (12_000 / 300) ** t; // Exponential: 300 → 12000
}

function applyFormantFilter(
  f1Node: BiquadFilterNode,
  f2Node: BiquadFilterNode,
  brightnessNode: BiquadFilterNode,
  fill: Fill,
  waveform: WaveformType = 'pulse',
) {
  let { h } = fill;
  let { s } = fill;
  let { l } = fill;

  if (fill.mode === 'linear') {
    // Crossfade formants between primary and secondary colors.
    // Gradient angle sets the blend: 0 deg = primary, 90 deg = 50/50, 180 deg = secondary.
    const blend = (((fill.gradAngle % 360) + 360) % 360) / 360;
    h += (fill.h2 - h) * blend;
    s += (fill.s2 - s) * blend;
    l += (fill.l2 - l) * blend;
  }

  const formants = hueToFormants(h);
  // Sine has no harmonics — high Q kills the signal when the fundamental
  // Is far from formant centers. Cap Q lower for sine (#82).
  const maxQ = waveform === 'sine' ? 4 : 8;
  const q = 1 + (s / 100) * maxQ;

  f1Node.frequency.value = formants.f1;
  f1Node.Q.value = q;
  f2Node.frequency.value = formants.f2;
  f2Node.Q.value = q * 0.7;

  // Lightness -> lowpass cutoff: dark = muffled, light = open
  brightnessNode.frequency.value = lightnessToCutoff(l);
}

// ---- Internal audio voice types ----

function safeStop(node: AudioScheduledSourceNode): void {
  try {
    node.stop();
    node.disconnect();
  } catch {}
}

function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {}
}

function generateImpulseResponse(ctx: AudioContext, style: ReverbStyle): AudioBuffer {
  const { sampleRate } = ctx;
  const duration = style === 'glow' ? 0.3 : 2;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const cutoff = style === 'glow' ? 1 : 0.3;

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      let sample = (Math.random() * 2 - 1) * Math.exp((-3 * t) / duration);
      if (cutoff < 1) {
        sample *= Math.max(0, 1 - t * (1 - cutoff));
      }
      data[i] = sample;
    }
  }
  return buffer;
}

interface AudioVoiceBase {
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

interface SineAudioVoice extends AudioVoiceBase {
  waveform: 'sine';
  oscillator: OscillatorNode;
}

interface SquareAudioVoice extends AudioVoiceBase {
  waveform: 'square';
  oscRaw: OscillatorNode;
  pwmOffset: ConstantSourceNode;
}

interface TriangleAudioVoice extends AudioVoiceBase {
  waveform: 'triangle';
  oscSaw: OscillatorNode;
  oscTri: OscillatorNode;
  gainSaw: GainNode;
  gainTri: GainNode;
}

type AudioVoice = SineAudioVoice | SquareAudioVoice | TriangleAudioVoice;

interface TextAudioVoice {
  isTextVoice: true;
  textCarrier: OscillatorNode;
  outputNode: StereoPannerNode;
  effectDispose: () => void;
}

type AnyAudioVoice = AudioVoice | TextAudioVoice;

// ---- Audio Engine ----

export class AudioEngine {
  audioCtx: AudioContext | undefined = undefined;
  activeVoices: AnyAudioVoice[];
  masterGain: GainNode | undefined;
  envelopeGain: GainNode | undefined;
  compressor: DynamicsCompressorNode | undefined;
  isPlaying: boolean;
  _sessionId: number;
  _analyser: AnalyserNode | undefined;
  _analyserBuf: Float32Array<ArrayBuffer> | undefined;
  _reverbConvolver: ConvolverNode | undefined;
  _reverbWet: GainNode | undefined;
  _reverbStyle: ReverbStyle | undefined;
  _streamDest: MediaStreamAudioDestinationNode | undefined;
  _audioEl: HTMLAudioElement | undefined;

  constructor() {
    this.activeVoices = [];
    this.masterGain = undefined;
    this.envelopeGain = undefined;
    this.compressor = undefined;
    this.isPlaying = false;
    this._sessionId = 0;
    this._analyser = undefined;
    this._analyserBuf = undefined;
    this._reverbConvolver = undefined;
    this._reverbWet = undefined;
    this._reverbStyle = undefined;
    this._streamDest = undefined;
    this._audioEl = undefined;
  }

  /** Synchronously create and unlock the AudioContext.
   *  Everything here MUST be synchronous — iOS Safari revokes user-gesture
   *  privileges after any microtask boundary (including await). */
  _init(): void {
    if (this.audioCtx) {
      return;
    }
    this.audioCtx = new AudioContext();

    // Classic iOS Safari unlock: play a silent buffer to "warm" the context.
    // This is the most widely battle-tested workaround.
    const silent = this.audioCtx.createBuffer(1, 1, 22_050);
    const src = this.audioCtx.createBufferSource();
    src.buffer = silent;
    src.connect(this.audioCtx.destination);
    src.start(0);

    // Resume synchronously — don't await the promise.
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    // Route audio through a MediaStreamDestination → <audio> element.
    // Safari aggressively suspends bare AudioContext output but treats
    // <audio> srcObject streams as "real" media that keeps playing.
    this._streamDest = this.audioCtx.createMediaStreamDestination();
    this._audioEl = document.createElement('audio');
    this._audioEl.srcObject = this._streamDest.stream;
    this._audioEl.style.display = 'none';
    document.body.append(this._audioEl);
    this._audioEl.play().catch(() => {});

    // Permanent listeners for qualifying gestures (touchend, click) that
    // Resume the keep-alive <audio> if it was paused after a previous stop
    // AND we're currently playing audio. This covers iOS Safari where play()
    // Is called from pointerdown (non-qualifying) — the touchend/click that
    // Follows in the same gesture will resume the element.
    const resumeKeepAlive = () => {
      if (this._audioEl && this._audioEl.paused && this.isPlaying) {
        this._audioEl.play().catch(() => {});
      }
    };
    document.addEventListener('touchend', resumeKeepAlive);
    document.addEventListener('click', resumeKeepAlive);
  }

  /** Call from any user gesture to pre-warm the AudioContext. */
  warmUp(): void {
    this._init();
  }

  async play(sigilState: SigilData, envelope: Envelope): Promise<void> {
    this._init();
    this.stop();

    const ctx = this.audioCtx!;
    // Don't await resume() — warmUp() already called it synchronously from
    // The user gesture. Awaiting here can hang on iOS Safari if the context
    // Is mid-resume. Fire-and-forget as a fallback only.
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Master chain
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -10;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.25;

    this.envelopeGain = ctx.createGain();
    this.envelopeGain.gain.value = 0;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.5;

    // Analyser for level metering (drives play glow)
    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 256;
    this._analyserBuf = new Float32Array(this._analyser.fftSize);

    // Wire: masterGain -> envelopeGain -> compressor -> analyser -> dest
    this.masterGain.connect(this.envelopeGain);
    this.envelopeGain.connect(this.compressor);
    this.compressor.connect(this._analyser);
    // Actual audio output goes through ctx.destination as normal.
    this._analyser.connect(ctx.destination);
    // Also feed the stream destination — its <audio> element keeps Safari
    // From suspending the AudioContext, but doesn't produce audible output.
    if (this._streamDest) {
      this._analyser.connect(this._streamDest);
      // Resume keep-alive <audio> if it was paused after a previous stop.
      // May fail outside a user gesture (e.g. loop restart) — that's OK,
      // The AudioContext is already running and the permanent touchend/click
      // Listeners in _init() will resume it on the next qualifying gesture.
      if (this._audioEl && this._audioEl.paused) {
        this._audioEl.play().catch(() => {});
      }
    }

    // Master reverb (if active)
    if (sigilState.reverb) {
      this._reverbConvolver = ctx.createConvolver();
      this._reverbConvolver.buffer = generateImpulseResponse(ctx, sigilState.reverb.style);
      this._reverbWet = ctx.createGain();
      this._reverbWet.gain.value = sigilState.reverb.depth;
      this.envelopeGain.connect(this._reverbConvolver);
      this._reverbConvolver.connect(this._reverbWet);
      this._reverbWet.connect(this.compressor);
      this._reverbStyle = sigilState.reverb.style;
    }

    // Apply ADSR envelope
    const now = ctx.currentTime;
    const attack = Math.max(0.01, envelope.attack);
    const decay = Math.max(0.01, envelope.decay);
    const sustain = Math.max(0, Math.min(1, envelope.sustain));

    this.envelopeGain.gain.setValueAtTime(0, now);
    this.envelopeGain.gain.linearRampToValueAtTime(1, now + attack);
    this.envelopeGain.gain.linearRampToValueAtTime(sustain, now + attack + decay);

    // Build voices
    for (const voice of sigilState.voices) {
      const audioVoice = this._buildVoice(ctx, voice);
      audioVoice.start(now);
      this.activeVoices.push(audioVoice);
    }

    // Set initial blend overlap levels
    this._updateBlendOverlaps(sigilState.voices);

    // Play text vocoders
    for (const textDeco of sigilState.texts) {
      const freq = yToFrequency(textDeco.y);
      const carrier = ctx.createOscillator();
      carrier.type = 'sawtooth';
      carrier.frequency.value = freq;

      const vocoder = createVocoderChain(ctx, textDeco.text, carrier);
      if (vocoder) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = xToPan(textDeco.x);

        // Scale gain by text size
        const textGain = ctx.createGain();
        textGain.gain.value = Math.min(0.8, 0.1 + textDeco.size * 5);

        vocoder.output.connect(textGain);
        textGain.connect(panner);
        panner.connect(this.masterGain!);

        carrier.start(now);
        carrier.stop(now + vocoder.duration);

        this.activeVoices.push({
          effectDispose: () => {
            vocoder.dispose();
            safeDisconnect(textGain);
          },
          isTextVoice: true,
          outputNode: panner,
          textCarrier: carrier,
        });
      }
    }

    this.isPlaying = true;
  }

  release(envelope: Envelope): void {
    if (!this.isPlaying || !this.envelopeGain) {
      return;
    }
    const ctx = this.audioCtx!;
    const now = ctx.currentTime;
    const releaseTime = Math.max(0.01, envelope.release);

    this.envelopeGain.gain.cancelScheduledValues(now);
    this.envelopeGain.gain.setValueAtTime(this.envelopeGain.gain.value, now);
    this.envelopeGain.gain.linearRampToValueAtTime(0, now + releaseTime);

    // Schedule cleanup, but only if the session hasn't changed
    const sid = this._sessionId;
    setTimeout(
      () => {
        if (this._sessionId === sid) {
          this._cleanup();
        }
      },
      releaseTime * 1000 + 100,
    );
  }

  setEnvelopePosition(t: number, envelope: Envelope): void {
    if (!this.isPlaying || !this.envelopeGain) {
      return;
    }
    const attack = Math.max(0.01, envelope.attack);
    const decay = Math.max(0.01, envelope.decay);
    const sustain = Math.max(0, Math.min(1, envelope.sustain));
    const totalTime = attack + decay;
    const actualTime = t * totalTime;
    let gain;
    if (actualTime <= attack) {
      gain = actualTime / attack;
    } else {
      gain = 1 - ((actualTime - attack) / decay) * (1 - sustain);
    }
    const ctx = this.audioCtx!;
    const now = ctx.currentTime;
    this.envelopeGain.gain.cancelScheduledValues(now);
    this.envelopeGain.gain.setValueAtTime(this.envelopeGain.gain.value, now);
    this.envelopeGain.gain.linearRampToValueAtTime(gain, now + 0.05);
  }

  updateVoices(sigilState: SigilData): void {
    if (!this.isPlaying || !this.audioCtx) {
      return;
    }
    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const voiceMap = new Map(sigilState.voices.map((v) => [v.id, v]));

    // Remove audio voices for deleted voices
    for (let i = this.activeVoices.length - 1; i >= 0; i--) {
      const audioVoice = this.activeVoices[i]!;
      if ('isTextVoice' in audioVoice) {
        continue;
      }
      if (!voiceMap.has(audioVoice.shapeId)) {
        this._stopVoice(audioVoice);
        this.activeVoices.splice(i, 1);
      }
    }

    // Add audio voices for new voices
    const activeIds = new Set(
      this.activeVoices.filter((v): v is AudioVoice => !('isTextVoice' in v)).map((v) => v.shapeId),
    );
    for (const voice of sigilState.voices) {
      if (!activeIds.has(voice.id)) {
        const audioVoice = this._buildVoice(ctx, voice);
        audioVoice.start(now);
        this.activeVoices.push(audioVoice);
      }
    }

    // Update existing audio voices
    for (let i = this.activeVoices.length - 1; i >= 0; i--) {
      const audioVoice = this.activeVoices[i]!;
      if ('isTextVoice' in audioVoice) {
        continue;
      }
      const voice = voiceMap.get(audioVoice.shapeId);
      if (!voice) {
        continue;
      }

      // Effect, blend, or border changed — tear down and rebuild the entire voice
      const borderKey = voice.border
        ? `${voice.border.color}:${voice.border.double ? 1 : 0}`
        : undefined;
      if (
        voice.effect !== audioVoice.currentEffect ||
        voice.blend !== audioVoice.currentBlend ||
        borderKey !== audioVoice.currentBorder
      ) {
        this._stopVoice(audioVoice);
        this.activeVoices.splice(i, 1);
        const rebuilt = this._buildVoice(ctx, voice);
        rebuilt.start(now);
        this.activeVoices.push(rebuilt);
        continue;
      }

      const timbre = 'timbre' in voice ? voice.timbre : 0;
      const freq = yToFrequency(voice.y);

      switch (audioVoice.waveform) {
        case 'square': {
          audioVoice.oscRaw.frequency.setValueAtTime(freq, now);
          audioVoice.pwmOffset.offset.setValueAtTime((timbre * 2 - 1) * 0.9, now);
          break;
        }
        case 'triangle': {
          audioVoice.oscSaw.frequency.setValueAtTime(freq, now);
          audioVoice.oscTri.frequency.setValueAtTime(freq, now);
          const mix = 1 - Math.abs(timbre - 0.5) * 2;
          audioVoice.gainTri.gain.setValueAtTime(Math.sin((mix * Math.PI) / 2), now);
          audioVoice.gainSaw.gain.setValueAtTime(Math.cos((mix * Math.PI) / 2), now);
          break;
        }
        case 'sine': {
          audioVoice.oscillator.frequency.setValueAtTime(freq, now);
          break;
        }
      }

      audioVoice.gain.gain.setValueAtTime(
        areaToGain(voice.waveform, voice.size) * waveformGain(voice.waveform),
        now,
      );
      audioVoice.panner.pan.setValueAtTime(xToPan(voice.x), now);
      applyFormantFilter(
        audioVoice.formantF1,
        audioVoice.formantF2,
        audioVoice.brightness,
        voice.fill,
        voice.waveform,
      );

      // Update octave oscillator frequency if border is present
      if (audioVoice.octaveOsc && voice.border) {
        const octaveShift = voice.border.double ? 2 : 1;
        const direction = voice.border.color === 'white' ? 1 : -1;
        const octaveFreq = freq * 2 ** (direction * octaveShift);
        audioVoice.octaveOsc.frequency.setValueAtTime(octaveFreq, now);
      }

      // Update octave oscillator gain if border is present
      if (audioVoice.octaveGainNode && voice.border) {
        audioVoice.octaveGainNode.gain.setValueAtTime(
          borderOctaveGain(
            voice.waveform,
            voice.size,
            voice.border.thickness,
            voice.border.color,
            voice.border.double,
          ),
          now,
        );
      }
    }

    // Update blend overlap levels
    this._updateBlendOverlaps(sigilState.voices);
  }

  updateReverb(reverb: Reverb | undefined): void {
    if (!this.audioCtx || !this.isPlaying) {
      return;
    }
    const ctx = this.audioCtx;

    if (!reverb) {
      if (this._reverbConvolver) {
        safeDisconnect(this._reverbConvolver);
        this._reverbConvolver = undefined;
      }
      if (this._reverbWet) {
        safeDisconnect(this._reverbWet);
        this._reverbWet = undefined;
      }
      this._reverbStyle = undefined;
      return;
    }

    if (!this._reverbConvolver || this._reverbStyle !== reverb.style) {
      if (this._reverbConvolver) {
        safeDisconnect(this._reverbConvolver);
      }
      if (this._reverbWet) {
        safeDisconnect(this._reverbWet);
      }

      this._reverbConvolver = ctx.createConvolver();
      this._reverbConvolver.buffer = generateImpulseResponse(ctx, reverb.style);

      this._reverbWet = ctx.createGain();

      // Wire: envelopeGain → convolver → wetGain → compressor
      this.envelopeGain!.connect(this._reverbConvolver);
      this._reverbConvolver.connect(this._reverbWet);
      this._reverbWet.connect(this.compressor!);

      this._reverbStyle = reverb.style;
    }

    this._reverbWet!.gain.value = reverb.depth;
  }

  stop(): void {
    if (!this.isPlaying) {
      return;
    }
    this._cleanup();
  }

  /** Current RMS output level as 0–1. */
  getLevel(): number {
    if (!this._analyser || !this._analyserBuf) {
      return 0;
    }
    this._analyser.getFloatTimeDomainData(this._analyserBuf);
    let sum = 0;
    for (let i = 0; i < this._analyserBuf.length; i++) {
      const s = this._analyserBuf[i]!;
      sum += s * s;
    }
    return Math.sqrt(sum / this._analyserBuf.length);
  }

  _updateBlendOverlaps(voices: readonly Voice[]): void {
    for (const audioVoice of this.activeVoices) {
      if ('isTextVoice' in audioVoice) {
        continue;
      }
      const blendFx = audioVoice.blendEffect;
      if (!blendFx) {
        continue;
      }

      const voiceIndex = voices.findIndex((v) => v.id === audioVoice.shapeId);
      if (voiceIndex === -1) {
        continue;
      }

      const overlap = computeTotalOverlap(voiceIndex, voices);

      // For color-burn, overlap reduces dry signal instead of adding wet
      const dryGain = (blendFx.wetGain as GainNode & { _dryGain?: GainNode })._dryGain;
      if (dryGain) {
        blendFx.wetGain.gain.value = 0;
        dryGain.gain.value = 1 - overlap;
      } else {
        blendFx.wetGain.gain.value = overlap;
      }
    }
  }

  _cleanup(): void {
    this._sessionId++;

    for (const audioVoice of this.activeVoices) {
      this._stopVoice(audioVoice);
    }
    this.activeVoices = [];

    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {}
      this.masterGain = undefined;
    }
    if (this.envelopeGain) {
      try {
        this.envelopeGain.disconnect();
      } catch {}
      this.envelopeGain = undefined;
    }
    if (this.compressor) {
      try {
        this.compressor.disconnect();
      } catch {}
      this.compressor = undefined;
    }
    if (this._analyser) {
      safeDisconnect(this._analyser);
      this._analyser = undefined;
      this._analyserBuf = undefined;
    }
    if (this._reverbConvolver) {
      safeDisconnect(this._reverbConvolver);
      this._reverbConvolver = undefined;
    }
    if (this._reverbWet) {
      safeDisconnect(this._reverbWet);
      this._reverbWet = undefined;
    }
    this._reverbStyle = undefined;

    // Pause the keep-alive <audio> element so iOS drops the audio session
    // Indicator (speaker icon in status bar / Control Center). It will be
    // Resumed in play() or by the permanent touchend/click listeners
    // Registered in _init().
    if (this._audioEl) {
      this._audioEl.pause();
    }

    this.isPlaying = false;
  }

  _stopVoice(audioVoice: AnyAudioVoice): void {
    if ('isTextVoice' in audioVoice) {
      safeDisconnect(audioVoice.textCarrier);
      safeDisconnect(audioVoice.outputNode);
      if (audioVoice.effectDispose) {
        audioVoice.effectDispose();
      }
      return;
    }

    audioVoice.stop(0);
    if (audioVoice.octaveOsc) {
      safeStop(audioVoice.octaveOsc);
    }
    safeDisconnect(audioVoice.outputNode);
    audioVoice.effectDispose?.();
    audioVoice.blendEffect?.dispose();
  }

  _buildVoice(ctx: AudioContext, voice: Voice): AudioVoice {
    const timbre = 'timbre' in voice ? voice.timbre : 0;
    const gain = ctx.createGain();
    gain.gain.value = areaToGain(voice.waveform, voice.size) * waveformGain(voice.waveform);

    const freq = yToFrequency(voice.y);

    // Dual formant filter bank + brightness shelf
    const formantF1 = ctx.createBiquadFilter();
    formantF1.type = 'bandpass';
    const formantF2 = ctx.createBiquadFilter();
    formantF2.type = 'bandpass';
    const formantMixer = ctx.createGain();
    formantMixer.gain.value = 0.7; // Compensate for two-path sum
    const brightness = ctx.createBiquadFilter();
    brightness.type = 'lowpass';
    brightness.Q.value = Math.SQRT1_2; // Butterworth — no resonant peak

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
      const effect = createEffect(ctx, voice.effect);
      if (effect) {
        lastNode.connect(effect.input);
        lastNode = effect.output;
        effectDispose = effect.dispose;
      }
    }

    lastNode.connect(blendFx.input);
    blendFx.output.connect(panner);
    panner.connect(this.masterGain || ctx.destination);

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
      octaveGainNode.gain.value = borderOctaveGain(
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
      warmCurve[i] = Math.tanh(x * 1.5);
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
}
