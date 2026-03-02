// audio.ts — Web Audio engine: oscillators, filters, spatial mapping

import { createEffect } from './effects.ts';
import { createVocoderChain } from './vocoder.ts';
import {
  normalizedCoord,
  type WaveformType,
  type Voice,
  type Fill,
  type SigilData,
  type Envelope,
  type NormalizedCoord,
} from './types.ts';

// ---- Pentatonic scale ----
const PENTATONIC_INTERVALS = [0, 2, 4, 7, 9];
const PENTATONIC_SEMITONES: number[] = [];
for (let octave = 0; octave < 3; octave++) {
  for (const interval of PENTATONIC_INTERVALS) {
    PENTATONIC_SEMITONES.push(octave * 12 + interval);
  }
}
PENTATONIC_SEMITONES.push(36); // top: 3 octaves above root

const BASE_MIDI = 48; // C3

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---- Mapping functions ----

// Maximum micro-detuning in cents when positioned between note snap points.
// Tanh curve flattens near edges so the pitch always sounds like "that note."
const MAX_DETUNE_CENTS = 40;

export function yToFrequency(y: NormalizedCoord): number {
  // y is 0-1, where 0=top (high pitch), 1=bottom (low pitch)
  const normalized = 1 - y;
  const continuous = normalized * (PENTATONIC_SEMITONES.length - 1);
  const index = Math.round(continuous);
  const clamped = Math.max(0, Math.min(PENTATONIC_SEMITONES.length - 1, index));
  const offset = continuous - clamped; // -0.5 to +0.5

  const baseFreq = midiToFreq(BASE_MIDI + PENTATONIC_SEMITONES[clamped]!);

  // Micro-detuning: tanh flattens near edges, every y produces a unique pitch
  const detuneCents = MAX_DETUNE_CENTS * Math.tanh(offset * 3);
  return baseFreq * Math.pow(2, detuneCents / 1200);
}

// Magnetic snap: pull y toward nearest note position during drag.
// Uses a cubic curve so positions near note centers are "sticky" while
// positions between notes are compressed but still reachable.
export function snapYToNote(y: NormalizedCoord): NormalizedCoord {
  const noteCount = PENTATONIC_SEMITONES.length;
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

export function sizeToGain(size: NormalizedCoord): number {
  return Math.min(0.8, 0.05 + size * 3);
}

// Area of a shape as a fraction of the 1x1 normalized canvas.
// All shapes use r = size/2 as bounding radius.
export function shapeAreaFraction(waveform: WaveformType, size: NormalizedCoord): number {
  const halfSize = size / 2;
  switch (waveform) {
    case 'sine':
      return Math.PI * halfSize * halfSize;
    case 'pulse':
      return size * size; // side = 2r = size
    case 'blend':
      // Equilateral inscribed in circle of radius size/2
      return ((3 * Math.sqrt(3)) / 4) * halfSize * halfSize;
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
// a square repeats every 90 deg, a triangle every 120 deg.
// Uses a half-sine curve so that visually identical orientations produce
// identical audio, and the mapping is smooth with a peak at mid-period.
const WAVEFORM_PERIOD: Record<string, number> = {
  pulse: 90,
  blend: 120,
};

export function rotationToTimbre(rotation: number, waveform: string): number {
  const period = WAVEFORM_PERIOD[waveform];
  if (!period) return 0; // sine has no timbre
  const phase = ((rotation % period) + period) % period;
  return Math.sin((Math.PI * phase) / period);
}

function oscillatorType(waveform: WaveformType): OscillatorType {
  switch (waveform) {
    case 'blend':
      return 'sawtooth';
    case 'pulse':
      return 'square';
    case 'sine':
      return 'sine';
  }
}

// Per-waveform perceived-loudness normalization.  Square and sawtooth have
// higher RMS *and* excite more auditory critical bands than a pure sine,
// making them sound louder at the same amplitude.  Sine needs a boost (~3 dB)
// to match perceived loudness; square and sawtooth are attenuated.
export function waveformGain(waveform: WaveformType): number {
  switch (waveform) {
    case 'pulse':
      return 0.7; // square RMS ~= 1.41x sine, rich harmonics
    case 'blend':
      return 0.85; // sawtooth RMS ~= 1.15x sine
    case 'sine':
      return 1.4; // sine is single-partial; boost to match perceived loudness
  }
}

// ---- PWM Waveshaper for Square (Pulse) ----

function createPWMWaveshaper(audioCtx: AudioContext) {
  const ws = audioCtx.createWaveShaper();
  const samples = 1024;
  const curve = new Float32Array(samples);
  // Provide a static hard-clipping curve where pulse width is animated
  // dynamically by passing a DC bias through it.
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
// shelf.  Linear gradient crossfades formants between the two colors; gradient
// angle controls the blend bias.

interface FormantPoint {
  hue: number;
  f1: number;
  f2: number;
}

const FORMANT_ANCHORS: FormantPoint[] = [
  { hue: 0, f1: 730, f2: 1090 }, // /a/ -- open central
  { hue: 60, f1: 530, f2: 1840 }, // /e/ -- mid front
  { hue: 120, f1: 270, f2: 2290 }, // /i/ -- close front
  { hue: 180, f1: 300, f2: 870 }, // /u/ -- close back
  { hue: 240, f1: 570, f2: 840 }, // /o/ -- mid back
  { hue: 300, f1: 680, f2: 1100 }, // /a:/ -- open back
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

function applyFormantFilter(
  f1Node: BiquadFilterNode,
  f2Node: BiquadFilterNode,
  brightnessNode: BiquadFilterNode,
  fill: Fill,
) {
  let h = fill.h;
  let s = fill.s;
  let l = fill.l;

  if (fill.mode === 'linear') {
    // Crossfade formants between primary and secondary colors.
    // Gradient angle sets the blend: 0 deg = primary, 90 deg = 50/50, 180 deg = secondary.
    const blend = (((fill.gradAngle % 360) + 360) % 360) / 360;
    h = h + (fill.h2 - h) * blend;
    s = s + (fill.s2 - s) * blend;
    l = l + (fill.l2 - l) * blend;
  } else if (fill.mode === 'radial') {
    h = (h + fill.h2) / 2;
    s = (s + fill.s2) / 2;
    l = (l + fill.l2) / 2;
  }

  const formants = hueToFormants(h);
  const q = 1 + (s / 100) * 12; // 1 to 13

  f1Node.frequency.value = formants.f1;
  f1Node.Q.value = q;
  f2Node.frequency.value = formants.f2;
  f2Node.Q.value = q * 0.7;

  // Lightness -> brightness shelf: dark = muffled, light = bright
  brightnessNode.gain.value = (l / 100) * 14 - 7; // -7 to +7 dB
}

// ---- Layer EQ shelving ----

function createLayerEQ(audioCtx: AudioContext, layerIndex: number, totalLayers: number) {
  const normalized = totalLayers <= 1 ? 0.5 : layerIndex / (totalLayers - 1);
  const shelf = audioCtx.createBiquadFilter();
  if (normalized > 0.5) {
    shelf.type = 'highshelf';
    shelf.frequency.value = 3000;
    shelf.gain.value = (normalized - 0.5) * 6;
  } else {
    shelf.type = 'lowshelf';
    shelf.frequency.value = 300;
    shelf.gain.value = (0.5 - normalized) * 6;
  }
  return shelf;
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

interface AudioVoiceBase {
  outputNode: StereoPannerNode;
  effectDispose: (() => void) | null;
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

// ---- Auto EQ: spectral presence boost ----

// How much EQ help each waveform needs to be audible in a mix.
// Sine has no harmonics and gets easily masked; rich waveforms cut through.
function spectralNeed(waveform: WaveformType): number {
  switch (waveform) {
    case 'sine':
      return 1.0; // sine: single partial, easily masked
    case 'blend':
      return 0.3; // sawtooth blend: moderate harmonics
    case 'pulse':
      return 0.2; // pulse: rich harmonics, strong presence
  }
}

// Maximum number of EQ bands in the pool. Voices beyond this count
// don't get dedicated EQ presence bands (still audible via gain).
const MAX_EQ_BANDS = 8;

// ---- Audio Engine ----

export class AudioEngine {
  audioCtx: AudioContext | null;
  activeVoices: AnyAudioVoice[];
  masterGain: GainNode | null;
  envelopeGain: GainNode | null;
  compressor: DynamicsCompressorNode | null;
  isPlaying: boolean;
  playingShapeIds: Set<string>;
  _workletReady: boolean;
  _sessionId: number;
  _arpeggioGain: GainNode | null;
  _arpeggioReady: boolean;
  _autoEQ: BiquadFilterNode[];

  constructor() {
    this.audioCtx = null;
    this.activeVoices = [];
    this.masterGain = null;
    this.envelopeGain = null;
    this.compressor = null;
    this.isPlaying = false;
    this.playingShapeIds = new Set();
    this._workletReady = false;
    this._sessionId = 0;
    this._arpeggioGain = null;
    this._arpeggioReady = false;
    this._autoEQ = [];
  }

  async _init(): Promise<void> {
    if (this.audioCtx) return;
    this.audioCtx = new AudioContext();

    // Try to register bitcrusher worklet
    if (this.audioCtx.audioWorklet) {
      try {
        await this.audioCtx.audioWorklet.addModule('worklets/bitcrusher.js');
        this._workletReady = true;
      } catch {
        console.warn('AudioWorklet not available, using WaveShaper fallback');
      }
    }
  }

  async play(sigilState: SigilData, envelope: Envelope): Promise<void> {
    await this._init();
    this.stop();

    const ctx = this.audioCtx!;
    if (ctx.state === 'suspended') await ctx.resume();

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

    // Auto EQ: pool of peaking filters between masterGain and envelopeGain.
    const poolSize = Math.max(MAX_EQ_BANDS, sigilState.voices.length);
    this._autoEQ = [];
    for (let i = 0; i < poolSize; i++) {
      const band = ctx.createBiquadFilter();
      band.type = 'peaking';
      band.Q.value = 2;
      band.gain.value = 0;
      band.frequency.value = 440;
      this._autoEQ.push(band);
    }

    // Wire: masterGain -> [EQ bands] -> envelopeGain -> compressor -> dest
    let prev: AudioNode = this.masterGain;
    for (const band of this._autoEQ) {
      prev.connect(band);
      prev = band;
    }
    prev.connect(this.envelopeGain);
    this.envelopeGain.connect(this.compressor);
    this.compressor.connect(ctx.destination);

    this._applyAutoEQ(sigilState.voices);

    // Apply ADSR envelope
    const now = ctx.currentTime;
    const attack = Math.max(0.01, envelope.attack);
    const decay = Math.max(0.01, envelope.decay);
    const sustain = Math.max(0, Math.min(1, envelope.sustain));

    this.envelopeGain.gain.setValueAtTime(0, now);
    this.envelopeGain.gain.linearRampToValueAtTime(1.0, now + attack);
    this.envelopeGain.gain.linearRampToValueAtTime(sustain, now + attack + decay);

    // Build voices
    const totalLayers = sigilState.voices.length;
    this.playingShapeIds.clear();

    for (let i = 0; i < totalLayers; i++) {
      const voice = sigilState.voices[i]!;
      const audioVoice = this._buildVoice(ctx, voice, i, totalLayers);
      audioVoice.start(now);
      this.activeVoices.push(audioVoice);
      this.playingShapeIds.add(voice.id);
    }

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
          isTextVoice: true,
          textCarrier: carrier,
          outputNode: panner,
          effectDispose: () => {
            vocoder.dispose();
            safeDisconnect(textGain);
          },
        });
      }
    }

    this.isPlaying = true;
  }

  release(envelope: Envelope): void {
    if (!this.isPlaying || !this.envelopeGain) return;
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
        if (this._sessionId === sid) this._cleanup();
      },
      releaseTime * 1000 + 100,
    );
  }

  triggerArpeggio(sigilState: SigilData, envelope: Envelope, voiceId: string): void {
    // Trigger a single voice with a fast mini-envelope
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    const voice = sigilState.voices.find((v) => v.id === voiceId);
    if (!voice) return;

    const idx = sigilState.voices.indexOf(voice);
    const total = sigilState.voices.length;

    // Set up a dedicated arpeggio gain as the "masterGain" so _buildVoice
    // connects to it instead of ctx.destination (avoids double-routing)
    if (!this._arpeggioGain) {
      if (!this.compressor) {
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -6;
        this.compressor.knee.value = 12;
        this.compressor.ratio.value = 4;
        this.compressor.connect(ctx.destination);
      }
      this._arpeggioGain = ctx.createGain();
      this._arpeggioGain.gain.value = 0.7;
      this._arpeggioGain.connect(this.compressor);
    }

    // Temporarily set masterGain so _buildVoice routes to our arpeggio chain
    const prevMaster = this.masterGain;
    this.masterGain = this._arpeggioGain;
    const audioVoice = this._buildVoice(ctx, voice, idx, total);
    this.masterGain = prevMaster;

    // Mini envelope: quick attack, short sustain, quick release
    const miniGain = ctx.createGain();
    miniGain.gain.value = 0;
    const now = ctx.currentTime;
    miniGain.gain.setValueAtTime(0, now);
    miniGain.gain.linearRampToValueAtTime(0.6, now + 0.02);
    miniGain.gain.linearRampToValueAtTime(0.4, now + 0.1);
    miniGain.gain.linearRampToValueAtTime(0, now + 0.5);

    // Re-route voice output through the mini envelope
    audioVoice.outputNode.disconnect();
    audioVoice.outputNode.connect(miniGain);
    miniGain.connect(this._arpeggioGain!);

    audioVoice.start(now);
    // Schedule stop after 0.6s
    setTimeout(() => audioVoice.stop(0), 600);

    // Track voice for cleanup
    this.activeVoices.push(audioVoice);

    this.playingShapeIds.add(voiceId);
    setTimeout(() => {
      this.playingShapeIds.delete(voiceId);
      // Remove from activeVoices after it's done
      const i = this.activeVoices.indexOf(audioVoice);
      if (i !== -1) this.activeVoices.splice(i, 1);
      try {
        miniGain.disconnect();
      } catch {}
    }, 650);
  }

  setEnvelopePosition(t: number, envelope: Envelope): void {
    if (!this.isPlaying || !this.envelopeGain) return;
    const attack = Math.max(0.01, envelope.attack);
    const decay = Math.max(0.01, envelope.decay);
    const sustain = Math.max(0, Math.min(1, envelope.sustain));
    const totalTime = attack + decay;
    const actualTime = t * totalTime;
    let gain;
    if (actualTime <= attack) {
      gain = actualTime / attack;
    } else {
      gain = 1.0 - ((actualTime - attack) / decay) * (1.0 - sustain);
    }
    const ctx = this.audioCtx!;
    const now = ctx.currentTime;
    this.envelopeGain.gain.cancelScheduledValues(now);
    this.envelopeGain.gain.setValueAtTime(this.envelopeGain.gain.value, now);
    this.envelopeGain.gain.linearRampToValueAtTime(gain, now + 0.05);
  }

  updateVoices(sigilState: SigilData): void {
    if (!this.isPlaying || !this.audioCtx) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const voiceMap = new Map(sigilState.voices.map((v) => [v.id, v]));

    // Remove audio voices for deleted voices
    for (let i = this.activeVoices.length - 1; i >= 0; i--) {
      const audioVoice = this.activeVoices[i]!;
      if ('isTextVoice' in audioVoice) continue;
      if (!voiceMap.has(audioVoice.shapeId)) {
        this._stopVoice(audioVoice);
        this.activeVoices.splice(i, 1);
        this.playingShapeIds.delete(audioVoice.shapeId);
      }
    }

    // Add audio voices for new voices
    const totalLayers = sigilState.voices.length;

    for (let i = 0; i < totalLayers; i++) {
      const voice = sigilState.voices[i]!;
      if (!this.playingShapeIds.has(voice.id)) {
        const audioVoice = this._buildVoice(ctx, voice, i, totalLayers);
        audioVoice.start(now);
        this.activeVoices.push(audioVoice);
        this.playingShapeIds.add(voice.id);
      }
    }

    // Update existing audio voices
    for (const audioVoice of this.activeVoices) {
      if ('isTextVoice' in audioVoice) continue;
      const voice = voiceMap.get(audioVoice.shapeId);
      if (!voice) continue;

      const timbre = 'timbre' in voice ? voice.timbre : 0;
      const freq = yToFrequency(voice.y);

      switch (audioVoice.waveform) {
        case 'square':
          audioVoice.oscRaw.frequency.setValueAtTime(freq, now);
          audioVoice.pwmOffset.offset.setValueAtTime((timbre * 2 - 1) * 0.9, now);
          break;
        case 'triangle': {
          audioVoice.oscSaw.frequency.setValueAtTime(freq, now);
          audioVoice.oscTri.frequency.setValueAtTime(freq, now);
          const mix = 1.0 - Math.abs(timbre - 0.5) * 2;
          audioVoice.gainTri.gain.setValueAtTime(Math.sin((mix * Math.PI) / 2), now);
          audioVoice.gainSaw.gain.setValueAtTime(Math.cos((mix * Math.PI) / 2), now);
          break;
        }
        case 'sine':
          audioVoice.oscillator.frequency.setValueAtTime(freq, now);
          break;
      }

      audioVoice.gain.gain.setValueAtTime(
        areaToGain(voice.waveform, voice.size) * waveformGain(voice.waveform),
        now,
      );
      audioVoice.panner.pan.setValueAtTime(xToPan(voice.x), now);
      applyFormantFilter(audioVoice.formantF1, audioVoice.formantF2, audioVoice.brightness, voice.fill);
    }

    // Update auto EQ for changed positions/sizes
    this._applyAutoEQ(sigilState.voices);
  }

  stop(): void {
    if (!this.isPlaying) return;
    this._cleanup();
  }

  _applyAutoEQ(voices: Voice[]): void {
    if (!this.audioCtx || this._autoEQ.length === 0) return;
    const now = this.audioCtx.currentTime;

    for (let i = 0; i < this._autoEQ.length; i++) {
      const band = this._autoEQ[i]!;
      if (i < voices.length) {
        const voice = voices[i]!;
        const freq = yToFrequency(voice.y);
        const area = shapeAreaFraction(voice.waveform, voice.size);
        const need = spectralNeed(voice.waveform);

        // Boost: 4-18 dB for sine, 1-5 dB for rich waveforms
        const boostDb = need * (4 + area * 14);

        band.frequency.setValueAtTime(freq, now);
        band.gain.setValueAtTime(boostDb, now);
      } else {
        // Unused band -- passthrough
        band.gain.setValueAtTime(0, now);
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
      this.masterGain = null;
    }
    if (this.envelopeGain) {
      try {
        this.envelopeGain.disconnect();
      } catch {}
      this.envelopeGain = null;
    }
    for (const band of this._autoEQ) {
      safeDisconnect(band);
    }
    this._autoEQ = [];
    if (this.compressor) {
      try {
        this.compressor.disconnect();
      } catch {}
      this.compressor = null;
    }
    if (this._arpeggioGain) {
      try {
        this._arpeggioGain.disconnect();
      } catch {}
      this._arpeggioGain = null;
    }

    this.playingShapeIds.clear();
    this.isPlaying = false;
  }

  _stopVoice(audioVoice: AnyAudioVoice): void {
    if ('isTextVoice' in audioVoice) {
      safeDisconnect(audioVoice.textCarrier);
      safeDisconnect(audioVoice.outputNode);
      if (audioVoice.effectDispose) audioVoice.effectDispose();
      return;
    }

    audioVoice.stop(0);
    safeDisconnect(audioVoice.outputNode);
    audioVoice.effectDispose?.();
  }

  _buildVoice(
    ctx: AudioContext,
    voice: Voice,
    layerIndex: number,
    totalLayers: number,
  ): AudioVoice {
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
    formantMixer.gain.value = 0.7; // compensate for two-path sum
    const brightness = ctx.createBiquadFilter();
    brightness.type = 'highshelf';
    brightness.frequency.value = 2000;

    applyFormantFilter(formantF1, formantF2, brightness, voice.fill);

    const panner = ctx.createStereoPanner();
    panner.pan.value = xToPan(voice.x);

    const layerEQ = createLayerEQ(ctx, layerIndex, totalLayers);

    // Wire: gain -> F1 -> mixer -> brightness -> [effect] -> layerEQ -> panner -> master
    //       gain -> F2 -> mixer
    gain.connect(formantF1);
    gain.connect(formantF2);
    formantF1.connect(formantMixer);
    formantF2.connect(formantMixer);
    formantMixer.connect(brightness);

    let lastNode: AudioNode = brightness;
    let effectDispose: (() => void) | null = null;

    if (voice.effect) {
      const effect = createEffect(ctx, voice.effect, this._workletReady);
      if (effect) {
        lastNode.connect(effect.input);
        lastNode = effect.output;
        effectDispose = effect.dispose;
      }
    }

    lastNode.connect(layerEQ);
    layerEQ.connect(panner);
    panner.connect(this.masterGain || ctx.destination);

    const shared = {
      outputNode: panner,
      effectDispose,
      shapeId: voice.id,
      gain,
      formantF1,
      formantF2,
      brightness,
      panner,
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
        waveform: 'square',
        oscRaw: osc,
        pwmOffset,
        start(time: number) {
          try {
            osc.start(time);
          } catch {}
        },
        stop(_time: number) {
          safeStop(osc);
          safeStop(pwmOffset);
        },
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

      const mix = 1.0 - Math.abs(timbre - 0.5) * 2;
      gainTri.gain.value = Math.sin((mix * Math.PI) / 2);
      gainSaw.gain.value = Math.cos((mix * Math.PI) / 2);

      oscSaw.connect(gainSaw);
      oscTri.connect(gainTri);
      gainSaw.connect(gain);
      gainTri.connect(gain);

      return {
        ...shared,
        waveform: 'triangle',
        oscSaw,
        oscTri,
        gainSaw,
        gainTri,
        start(time: number) {
          oscSaw.start(time);
          oscTri.start(time);
        },
        stop(_time: number) {
          safeStop(oscSaw);
          safeStop(oscTri);
        },
      };
    }

    // Sine -- default
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);

    return {
      ...shared,
      waveform: 'sine',
      oscillator: osc,
      start(time: number) {
        osc.start(time);
      },
      stop(_time: number) {
        safeStop(osc);
      },
    };
  }
}
