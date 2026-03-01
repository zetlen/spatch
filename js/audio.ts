// audio.ts — Web Audio engine: oscillators, filters, spatial mapping

import { createEffect } from './effects.ts';
import { createVocoderChain } from './vocoder.ts';
import type {
  ShapeType,
  Shape,
  Fill,
  SigilData,
  Envelope,
  NormalizedCoord,
  Degrees,
  Cents,
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

export function yToFrequency(y: NormalizedCoord): number {
  // y is 0–1, where 0=top (high pitch), 1=bottom (low pitch)
  const normalized = 1 - y;
  const index = Math.round(normalized * (PENTATONIC_SEMITONES.length - 1));
  const clamped = Math.max(0, Math.min(PENTATONIC_SEMITONES.length - 1, index));
  return midiToFreq(BASE_MIDI + PENTATONIC_SEMITONES[clamped]);
}

export function xToPan(x: NormalizedCoord): number {
  return x * 2 - 1; // 0->-1 (left), 1->+1 (right)
}

export function sizeToGain(size: NormalizedCoord): number {
  return Math.min(0.8, 0.05 + size * 3);
}

// Area of a shape as a fraction of the 1×1 normalized canvas.
// All shapes use r = size/2 as bounding radius.
export function shapeAreaFraction(type: ShapeType, size: NormalizedCoord): number {
  const halfSize = size / 2;
  switch (type) {
    case 'circle':
      return Math.PI * halfSize * halfSize;
    case 'square':
      return size * size; // side = 2r = size
    case 'triangle':
      // Equilateral inscribed in circle of radius size/2
      return ((3 * Math.sqrt(3)) / 4) * halfSize * halfSize;
    default:
      return size * size;
  }
}

// Map a shape's canvas area fraction to gain.
// Max area for a shape at size 0.9: square = 0.81, circle ≈ 0.636, triangle ≈ 0.263.
export function areaToGain(type: ShapeType, size: NormalizedCoord): number {
  const fraction = shapeAreaFraction(type, size);
  return Math.min(0.8, 0.05 + fraction);
}

// Map rotation (0-360) to a parameter for wave shaping
export function rotationToParam(rotation: Degrees): number {
  return rotation / 360; // 0.0 to 1.0
}

export function curlicuesToDetune(count: number): Cents {
  return (count * 15) as Cents; // 15 cents per curlicue
}

function oscillatorType(shapeType: ShapeType): OscillatorType {
  switch (shapeType) {
    case 'triangle':
      return 'sawtooth';
    case 'square':
      return 'square';
    case 'circle':
      return 'sine';
    default:
      return 'sine';
  }
}

// Per-waveform perceived-loudness normalization.  Square and sawtooth have
// higher RMS *and* excite more auditory critical bands than a pure sine,
// making them sound louder at the same amplitude.  Sine needs a boost (~3 dB)
// to match perceived loudness; square and sawtooth are attenuated.
export function waveformGain(shapeType: ShapeType): number {
  switch (shapeType) {
    case 'square':
      return 0.7; // square RMS ≈ 1.41× sine, rich harmonics
    case 'triangle':
      return 0.85; // sawtooth RMS ≈ 1.15× sine
    case 'circle':
    default:
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

// ---- Color-to-filter mapping ----

function hueToFilterType(h: number): BiquadFilterType {
  if (h < 90) return 'lowpass';
  if (h < 180) return 'bandpass';
  if (h < 270) return 'highpass';
  return 'notch';
}

function applyColorFilter(filterNode: BiquadFilterNode, fill: Fill) {
  // Audio always maps from fill.h/s/l regardless of fill mode.
  // Different color pickers (Lab, linear HSL) are navigation interfaces
  // that update h/s/l via conversion, so the same color always sounds the same.
  filterNode.type = hueToFilterType(fill.h);
  filterNode.Q.value = 0.5 + (fill.s / 100) * 15;
  filterNode.frequency.value = 200 * Math.pow(40, fill.l / 100);
}

// ---- Overdrive for linear gradient fill ----

function createOverdrive(audioCtx: AudioContext, amount: number) {
  const ws = audioCtx.createWaveShaper();
  const k = (amount / 100) * 400;
  const samples = 8192;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  ws.curve = curve;
  ws.oversample = '4x';
  return ws;
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

// ---- Voice types (internal) ----

interface Startable {
  start(time: number): void;
  stop(time: number): void;
  disconnect?(): void;
}

interface Voice {
  oscillator: Startable;
  outputNode: StereoPannerNode;
  effectDispose: (() => void) | null;
  shapeId: string;
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  // Square voice extras
  oscRaw?: OscillatorNode;
  pwmOffset?: ConstantSourceNode;
  // Triangle voice extras
  oscSaw?: OscillatorNode;
  oscTri?: OscillatorNode;
  gainSaw?: GainNode;
  gainTri?: GainNode;
}

interface TextVoice {
  isTextVoice: true;
  textCarrier: OscillatorNode;
  outputNode: StereoPannerNode;
  effectDispose: () => void;
}

type AnyVoice = Voice | TextVoice;

// ---- Audio Engine ----

export class AudioEngine {
  audioCtx: AudioContext | null;
  activeVoices: AnyVoice[];
  masterGain: GainNode | null;
  envelopeGain: GainNode | null;
  compressor: DynamicsCompressorNode | null;
  isPlaying: boolean;
  playingShapeIds: Set<string>;
  _workletReady: boolean;
  _sessionId: number;
  _arpeggioGain: GainNode | null;

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
    this.compressor.threshold.value = -6;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    this.envelopeGain = ctx.createGain();
    this.envelopeGain.gain.value = 0;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.7;

    this.masterGain.connect(this.envelopeGain);
    this.envelopeGain.connect(this.compressor);
    this.compressor.connect(ctx.destination);

    // Apply ADSR envelope
    const now = ctx.currentTime;
    const attack = Math.max(0.01, envelope.attack);
    const decay = Math.max(0.01, envelope.decay);
    const sustain = Math.max(0, Math.min(1, envelope.sustain));

    this.envelopeGain.gain.setValueAtTime(0, now);
    this.envelopeGain.gain.linearRampToValueAtTime(1.0, now + attack);
    this.envelopeGain.gain.linearRampToValueAtTime(sustain, now + attack + decay);

    // Build voices
    const totalLayers = sigilState.shapes.length;
    this.playingShapeIds.clear();

    const curlicues = sigilState.decorations
      ? sigilState.decorations.filter((d) => d.type === 'curlicue').length
      : 0;

    for (let i = 0; i < totalLayers; i++) {
      const shape = sigilState.shapes[i];
      const voice = this._buildVoice(ctx, shape, i, totalLayers, curlicues);
      voice.oscillator.start(now);
      this.activeVoices.push(voice);
      this.playingShapeIds.add(shape.id);
    }

    // Play text vocoders
    const texts = sigilState.decorations
      ? sigilState.decorations.filter((d) => d.type === 'text')
      : [];
    for (const textDeco of texts) {
      const freq = yToFrequency(textDeco.y);
      const carrier = ctx.createOscillator();
      carrier.type = 'sawtooth';
      carrier.frequency.value = freq;

      const vocoder = createVocoderChain(ctx, textDeco.text, carrier);
      if (vocoder) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = xToPan(textDeco.x);

        vocoder.output.connect(panner);
        panner.connect(this.masterGain!);

        carrier.start(now);
        carrier.stop(now + vocoder.duration);

        this.activeVoices.push({
          isTextVoice: true,
          textCarrier: carrier,
          outputNode: panner,
          effectDispose: vocoder.dispose,
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

  triggerArpeggio(sigilState: SigilData, envelope: Envelope, shapeId: string): void {
    // Trigger a single shape with a fast mini-envelope
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    const shape = sigilState.shapes.find((s) => s.id === shapeId);
    if (!shape) return;

    const idx = sigilState.shapes.indexOf(shape);
    const total = sigilState.shapes.length;

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
    const curlicues = sigilState.decorations.filter((d) => d.type === 'curlicue').length;
    const voice = this._buildVoice(ctx, shape, idx, total, curlicues);
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
    voice.outputNode.disconnect();
    voice.outputNode.connect(miniGain);
    miniGain.connect(this._arpeggioGain!);

    voice.oscillator.start(now);
    voice.oscillator.stop(now + 0.6);

    // Track voice for cleanup
    this.activeVoices.push(voice);

    this.playingShapeIds.add(shapeId);
    setTimeout(() => {
      this.playingShapeIds.delete(shapeId);
      // Remove from activeVoices after it's done
      const i = this.activeVoices.indexOf(voice);
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
    const shapeMap = new Map(sigilState.shapes.map((s) => [s.id, s]));

    // Remove voices for deleted shapes
    for (let i = this.activeVoices.length - 1; i >= 0; i--) {
      const voice = this.activeVoices[i];
      if ('isTextVoice' in voice) continue;
      if (!shapeMap.has(voice.shapeId)) {
        this._stopVoice(voice);
        this.activeVoices.splice(i, 1);
        this.playingShapeIds.delete(voice.shapeId);
      }
    }

    // Add voices for new shapes
    const totalLayers = sigilState.shapes.length;
    const curlicues = sigilState.decorations
      ? sigilState.decorations.filter((d) => d.type === 'curlicue').length
      : 0;

    for (let i = 0; i < totalLayers; i++) {
      const shape = sigilState.shapes[i];
      if (!this.playingShapeIds.has(shape.id)) {
        const voice = this._buildVoice(ctx, shape, i, totalLayers, curlicues);
        voice.oscillator.start(now);
        this.activeVoices.push(voice);
        this.playingShapeIds.add(shape.id);
      }
    }

    // Update existing voices
    for (const voice of this.activeVoices) {
      if ('isTextVoice' in voice) continue;
      const shape = shapeMap.get(voice.shapeId);
      if (!shape) continue;

      const param = rotationToParam(shape.rotation);
      const freq = yToFrequency(shape.y);

      if (shape.type === 'square') {
        voice.oscRaw!.frequency.setValueAtTime(freq, now);
        voice.pwmOffset!.offset.setValueAtTime((param * 2 - 1) * 0.9, now);
      } else if (shape.type === 'triangle') {
        voice.oscSaw!.frequency.setValueAtTime(freq, now);
        voice.oscTri!.frequency.setValueAtTime(freq, now);
        const mix = 1.0 - Math.abs(param - 0.5) * 2;
        const gainTri = Math.sin((mix * Math.PI) / 2);
        const gainSaw = Math.cos((mix * Math.PI) / 2);
        voice.gainTri!.gain.setValueAtTime(gainTri, now);
        voice.gainSaw!.gain.setValueAtTime(gainSaw, now);
      } else {
        (voice.oscillator as OscillatorNode).frequency.setValueAtTime(freq, now);
      }

      voice.gain.gain.setValueAtTime(
        areaToGain(shape.type, shape.size) * waveformGain(shape.type),
        now,
      );
      voice.panner.pan.setValueAtTime(xToPan(shape.x), now);
      applyColorFilter(voice.filter, shape.fill);
    }
  }

  stop(): void {
    if (!this.isPlaying) return;
    this._cleanup();
  }

  _cleanup(): void {
    this._sessionId++;

    for (const voice of this.activeVoices) {
      this._stopVoice(voice);
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

  _stopVoice(voice: AnyVoice): void {
    if ('isTextVoice' in voice) {
      try {
        voice.textCarrier.disconnect();
      } catch {}
      try {
        voice.outputNode.disconnect();
      } catch {}
      if (voice.effectDispose) voice.effectDispose();
      return;
    }

    if (voice.oscRaw)
      try {
        voice.oscRaw.stop();
      } catch {}
    if (voice.oscSaw)
      try {
        voice.oscSaw.stop();
      } catch {}
    if (voice.oscTri)
      try {
        voice.oscTri.stop();
      } catch {}
    if (voice.pwmOffset)
      try {
        voice.pwmOffset.stop();
      } catch {}
    if (voice.oscillator && voice.oscillator.disconnect)
      try {
        voice.oscillator.disconnect();
      } catch {}
    if (voice.oscRaw)
      try {
        voice.oscRaw.disconnect();
      } catch {}
    if (voice.oscSaw)
      try {
        voice.oscSaw.disconnect();
      } catch {}
    if (voice.oscTri)
      try {
        voice.oscTri.disconnect();
      } catch {}
    if (voice.pwmOffset)
      try {
        voice.pwmOffset.disconnect();
      } catch {}
    try {
      voice.outputNode.disconnect();
    } catch {}
    if (voice.effectDispose) voice.effectDispose();
  }

  _buildVoice(
    ctx: AudioContext,
    shape: Shape,
    layerIndex: number,
    totalLayers: number,
    curlicues = 0,
  ): Voice {
    const gain = ctx.createGain();
    gain.gain.value = areaToGain(shape.type, shape.size) * waveformGain(shape.type);

    const freq = yToFrequency(shape.y);
    const param = rotationToParam(shape.rotation);
    const detuneCents = curlicuesToDetune(curlicues);
    let voiceSources: Partial<Voice> = {};

    if (shape.type === 'square') {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detuneCents;

      const pwmOffset = ctx.createConstantSource();
      // param 0..1 -> dc offset -0.9 .. +0.9
      pwmOffset.offset.value = (param * 2 - 1) * 0.9;

      const ws = createPWMWaveshaper(ctx);

      osc.connect(ws);
      pwmOffset.connect(ws);
      ws.connect(gain);

      pwmOffset.start();

      voiceSources = {
        oscillator: {
          start: (time: number) => {
            try {
              osc.start(time);
            } catch {}
          }, // pwmOffset already started
          stop: (time: number) => {
            try {
              osc.stop(time);
            } catch {}
          },
        },
        oscRaw: osc,
        pwmOffset: pwmOffset,
      };
    } else if (shape.type === 'triangle') {
      const oscSaw = ctx.createOscillator();
      oscSaw.type = 'sawtooth';
      oscSaw.frequency.value = freq;
      oscSaw.detune.value = detuneCents;

      const oscTri = ctx.createOscillator();
      oscTri.type = 'triangle';
      oscTri.frequency.value = freq;
      oscTri.detune.value = detuneCents;

      const gainSaw = ctx.createGain();
      const gainTri = ctx.createGain();

      const mix = 1.0 - Math.abs(param - 0.5) * 2;
      gainTri.gain.value = Math.sin((mix * Math.PI) / 2);
      gainSaw.gain.value = Math.cos((mix * Math.PI) / 2);

      oscSaw.connect(gainSaw);
      oscTri.connect(gainTri);
      gainSaw.connect(gain);
      gainTri.connect(gain);

      voiceSources = {
        oscillator: {
          start: (time: number) => {
            oscSaw.start(time);
            oscTri.start(time);
          },
          stop: (time: number) => {
            try {
              oscSaw.stop(time);
            } catch {}
            try {
              oscTri.stop(time);
            } catch {}
          },
        },
        oscSaw: oscSaw,
        oscTri: oscTri,
        gainSaw: gainSaw,
        gainTri: gainTri,
      };
    } else {
      const osc = ctx.createOscillator();
      osc.type = oscillatorType(shape.type);
      osc.frequency.value = freq;
      osc.detune.value = detuneCents;
      osc.connect(gain);
      voiceSources = { oscillator: osc };
    }

    const filter = ctx.createBiquadFilter();
    applyColorFilter(filter, shape.fill);

    const panner = ctx.createStereoPanner();
    panner.pan.value = xToPan(shape.x);

    const layerEQ = createLayerEQ(ctx, layerIndex, totalLayers);

    // Wire: gain -> filter -> [effect] -> [overdrive] -> layerEQ -> panner -> master
    gain.connect(filter);

    let lastNode: AudioNode = filter;
    let effectDispose: (() => void) | null = null;

    if (shape.pattern) {
      const effect = createEffect(ctx, shape.pattern, this._workletReady);
      if (effect) {
        lastNode.connect(effect.input);
        lastNode = effect.output;
        effectDispose = effect.dispose;
      }
    }

    if (shape.fill.mode === 'linear') {
      const overdrive = createOverdrive(ctx, shape.fill.l);
      lastNode.connect(overdrive);
      lastNode = overdrive;
    }

    lastNode.connect(layerEQ);
    layerEQ.connect(panner);
    panner.connect(this.masterGain || ctx.destination);

    return {
      ...voiceSources,
      outputNode: panner,
      effectDispose,
      shapeId: shape.id,
      gain,
      filter,
      panner,
    } as Voice;
  }
}
