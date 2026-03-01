// audio.js — Web Audio engine: oscillators, filters, spatial mapping

import { createEffect } from './effects.js';

// ---- Pentatonic scale ----
const PENTATONIC_INTERVALS = [0, 2, 4, 7, 9];
const PENTATONIC_SEMITONES = [];
for (let octave = 0; octave < 3; octave++) {
  for (const interval of PENTATONIC_INTERVALS) {
    PENTATONIC_SEMITONES.push(octave * 12 + interval);
  }
}
PENTATONIC_SEMITONES.push(36); // top: 3 octaves above root

const BASE_MIDI = 48; // C3

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---- Mapping functions ----

export function yToFrequency(y) {
  // y is 0–1, where 0=top (high pitch), 1=bottom (low pitch)
  const normalized = 1 - y;
  const index = Math.round(normalized * (PENTATONIC_SEMITONES.length - 1));
  const clamped = Math.max(0, Math.min(PENTATONIC_SEMITONES.length - 1, index));
  return midiToFreq(BASE_MIDI + PENTATONIC_SEMITONES[clamped]);
}

export function xToPan(x) {
  return x * 2 - 1; // 0->-1 (left), 1->+1 (right)
}

export function sizeToGain(size) {
  return Math.min(0.8, 0.05 + size * 3);
}

export function rotationToDetune(rotation) {
  return (rotation / 360) * 50; // 0–50 cents
}

function oscillatorType(shapeType) {
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

// ---- Color-to-filter mapping ----

function hueToFilterType(h) {
  if (h < 90) return 'lowpass';
  if (h < 180) return 'bandpass';
  if (h < 270) return 'highpass';
  return 'notch';
}

function applyColorFilter(filterNode, fill) {
  switch (fill.mode) {
    case 'solid':
      filterNode.type = hueToFilterType(fill.h);
      filterNode.Q.value = 0.5 + (fill.s / 100) * 15;
      filterNode.frequency.value = 200 * Math.pow(40, fill.l / 100);
      break;

    case 'radial':
      filterNode.frequency.value = 200 * Math.pow(40, fill.labL / 100);
      filterNode.Q.value = 0.5 + ((fill.labA + 128) / 256) * 20;
      if (fill.labB < -40) filterNode.type = 'lowpass';
      else if (fill.labB < 40) filterNode.type = 'bandpass';
      else filterNode.type = 'highpass';
      break;

    case 'linear':
      filterNode.type = 'lowpass';
      filterNode.frequency.value = 200 * Math.pow(50, fill.h1 / 360);
      filterNode.Q.value = 0.5 + (fill.s1 / 100) * 15;
      break;
  }
}

// ---- Overdrive for linear gradient fill ----

function createOverdrive(audioCtx, amount) {
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

function createLayerEQ(audioCtx, layerIndex, totalLayers) {
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

// ---- Audio Engine ----

export class AudioEngine {
  constructor() {
    this.audioCtx = null;
    this.activeVoices = [];
    this.masterGain = null;
    this.envelopeGain = null;
    this.compressor = null;
    this.isPlaying = false;
    this.playingShapeIds = new Set();
    this._workletReady = false;
    this._sessionId = 0; // generation counter to prevent stale cleanup
  }

  async _init() {
    if (this.audioCtx) return;
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

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

  async play(sigilState, envelope) {
    await this._init();
    this.stop();

    const ctx = this.audioCtx;
    if (ctx.state === 'suspended') await ctx.resume();

    // Master chain
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
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

    for (let i = 0; i < totalLayers; i++) {
      const shape = sigilState.shapes[i];
      const voice = this._buildVoice(ctx, shape, i, totalLayers);
      voice.oscillator.start(now);
      this.activeVoices.push(voice);
      this.playingShapeIds.add(shape.id);
    }

    this.isPlaying = true;
  }

  release(envelope) {
    if (!this.isPlaying || !this.envelopeGain) return;
    const ctx = this.audioCtx;
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

  triggerArpeggio(sigilState, envelope, shapeId) {
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
        this.compressor.threshold.value = -24;
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
    const voice = this._buildVoice(ctx, shape, idx, total);
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
    miniGain.connect(this._arpeggioGain);

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

  setEnvelopePosition(t, envelope) {
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
    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    this.envelopeGain.gain.cancelScheduledValues(now);
    this.envelopeGain.gain.setValueAtTime(this.envelopeGain.gain.value, now);
    this.envelopeGain.gain.linearRampToValueAtTime(gain, now + 0.05);
  }

  updateVoices(sigilState) {
    if (!this.isPlaying || !this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    for (const voice of this.activeVoices) {
      const shape = sigilState.shapes.find((s) => s.id === voice.shapeId);
      if (!shape) continue;
      voice.oscillator.frequency.setValueAtTime(yToFrequency(shape.y), now);
      voice.oscillator.detune.setValueAtTime(rotationToDetune(shape.rotation), now);
      voice.gain.gain.setValueAtTime(sizeToGain(shape.size), now);
      voice.panner.pan.setValueAtTime(xToPan(shape.x), now);
      applyColorFilter(voice.filter, shape.fill);
    }
  }

  stop() {
    if (!this.isPlaying) return;
    this._cleanup();
  }

  _cleanup() {
    this._sessionId++;

    for (const voice of this.activeVoices) {
      try {
        voice.oscillator.stop();
      } catch {}
      try {
        voice.oscillator.disconnect();
      } catch {}
      try {
        voice.outputNode.disconnect();
      } catch {}
      if (voice.effectDispose) voice.effectDispose();
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

  _buildVoice(ctx, shape, layerIndex, totalLayers) {
    const osc = ctx.createOscillator();
    osc.type = oscillatorType(shape.type);
    osc.frequency.value = yToFrequency(shape.y);
    osc.detune.value = rotationToDetune(shape.rotation);

    const gain = ctx.createGain();
    gain.gain.value = sizeToGain(shape.size);

    const filter = ctx.createBiquadFilter();
    applyColorFilter(filter, shape.fill);

    const panner = ctx.createStereoPanner();
    panner.pan.value = xToPan(shape.x);

    const layerEQ = createLayerEQ(ctx, layerIndex, totalLayers);

    // Wire: osc -> gain -> filter -> [effect] -> [overdrive] -> layerEQ -> panner -> master
    osc.connect(gain);
    gain.connect(filter);

    let lastNode = filter;
    let effectDispose = null;

    if (shape.pattern) {
      const effect = createEffect(ctx, shape.pattern, this._workletReady);
      if (effect) {
        lastNode.connect(effect.input);
        lastNode = effect.output;
        effectDispose = effect.dispose;
      }
    }

    if (shape.fill.mode === 'linear') {
      const overdrive = createOverdrive(ctx, shape.fill.l1);
      lastNode.connect(overdrive);
      lastNode = overdrive;
    }

    lastNode.connect(layerEQ);
    layerEQ.connect(panner);
    panner.connect(this.masterGain || ctx.destination);

    return {
      oscillator: osc,
      outputNode: panner,
      effectDispose,
      shapeId: shape.id,
      gain,
      filter,
      panner,
    };
  }
}
