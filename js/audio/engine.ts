// engine.ts — Web Audio engine: AudioEngine class

import { computeTotalOverlap, createEffect } from '../effects.ts';
import { type Envelope, type SigilData, type Voice } from '../types.ts';
import { xToPan, yToFrequency } from './mapping.ts';
import { applyFormantFilter } from './formants.ts';
import { vibe } from './vibe.ts';
import {
  type AudioVoice,
  buildVoice,
  generateImpulseResponse,
  safeDisconnect,
  safeStop,
} from './voice-builder.ts';

// ---- Audio Engine ----

export class AudioEngine {
  audioCtx: AudioContext | undefined = undefined;
  activeVoices: AudioVoice[];
  masterGain: GainNode | undefined;
  envelopeGain: GainNode | undefined;
  compressor: DynamicsCompressorNode | undefined;
  isPlaying: boolean;
  _sessionId: number;
  _analyser: AnalyserNode | undefined;
  _analyserBuf: Float32Array<ArrayBuffer> | undefined;
  _reverbConvolver: ConvolverNode | undefined;
  _reverbWet: GainNode | undefined;
  _streamDest: MediaStreamAudioDestinationNode | undefined;
  _audioEl: HTMLAudioElement | undefined;
  _irCache: AudioBuffer | undefined;
  _eqLow: BiquadFilterNode | undefined;
  _eqMid: BiquadFilterNode | undefined;
  _eqHigh: BiquadFilterNode | undefined;
  _muffleFilter: BiquadFilterNode | undefined;
  _muffled: boolean;

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
    this._streamDest = undefined;
    this._audioEl = undefined;
    this._irCache = undefined;
    this._eqLow = undefined;
    this._eqMid = undefined;
    this._eqHigh = undefined;
    this._muffleFilter = undefined;
    this._muffled = false;
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
    this.compressor.threshold.value = vibe.compThreshold;
    this.compressor.knee.value = vibe.compKnee;
    this.compressor.ratio.value = vibe.compRatio;
    this.compressor.attack.value = vibe.compAttack;
    this.compressor.release.value = vibe.compRelease;

    this.envelopeGain = ctx.createGain();
    this.envelopeGain.gain.value = 0;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = vibe.masterGain;

    // Analyser for level metering (drives play glow)
    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 256;
    this._analyserBuf = new Float32Array(this._analyser.fftSize);

    // 3-band EQ from vibe
    this._eqLow = ctx.createBiquadFilter();
    this._eqLow.type = 'lowshelf';
    this._eqLow.frequency.value = vibe.eqLowFreq;
    this._eqLow.gain.value = vibe.eqLowGain;

    this._eqMid = ctx.createBiquadFilter();
    this._eqMid.type = 'peaking';
    this._eqMid.frequency.value = vibe.eqMidFreq;
    this._eqMid.gain.value = vibe.eqMidGain;
    this._eqMid.Q.value = vibe.eqMidQ;

    this._eqHigh = ctx.createBiquadFilter();
    this._eqHigh.type = 'highshelf';
    this._eqHigh.frequency.value = vibe.eqHighFreq;
    this._eqHigh.gain.value = vibe.eqHighGain;

    // Wire: masterGain -> envelopeGain -> compressor -> eqLow -> eqMid -> eqHigh -> analyser -> dest
    this.masterGain.connect(this.envelopeGain);
    this.envelopeGain.connect(this.compressor);
    this.compressor.connect(this._eqLow);
    this._eqLow.connect(this._eqMid);
    this._eqMid.connect(this._eqHigh);
    this._eqHigh.connect(this._analyser);
    // Muffle filter: low-pass that's normally transparent (20 kHz cutoff)
    // but drops to ~600 Hz when muffled (e.g. credits overlay).
    this._muffleFilter = ctx.createBiquadFilter();
    this._muffleFilter.type = 'lowpass';
    this._muffleFilter.frequency.value = this._muffled ? 600 : 20000;
    this._muffleFilter.Q.value = 0.7;
    this._analyser.connect(this._muffleFilter);
    // Actual audio output goes through ctx.destination as normal.
    this._muffleFilter.connect(ctx.destination);
    // Also feed the stream destination — its <audio> element keeps Safari
    // From suspending the AudioContext, but doesn't produce audible output.
    if (this._streamDest) {
      this._muffleFilter.connect(this._streamDest);
      // Resume keep-alive <audio> if it was paused after a previous stop.
      // May fail outside a user gesture (e.g. loop restart) — that's OK,
      // The AudioContext is already running and the permanent touchend/click
      // Listeners in _init() will resume it on the next qualifying gesture.
      if (this._audioEl && this._audioEl.paused) {
        this._audioEl.play().catch(() => {});
      }
    }

    // Master reverb from vibe
    if (vibe.reverbMix > 0) {
      this._reverbConvolver = ctx.createConvolver();
      this._reverbConvolver.buffer = this._getImpulseResponse(ctx);
      this._reverbWet = ctx.createGain();
      this._reverbWet.gain.value = vibe.reverbMix;

      // Pre-delay
      if (vibe.reverbPreDelay > 0) {
        const preDelay = ctx.createDelay(1);
        preDelay.delayTime.value = vibe.reverbPreDelay;
        this.envelopeGain.connect(preDelay);
        preDelay.connect(this._reverbConvolver);
      } else {
        this.envelopeGain.connect(this._reverbConvolver);
      }
      this._reverbConvolver.connect(this._reverbWet);
      this._reverbWet.connect(this.compressor);
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

    // Schedule cleanup after release + reverb tail have fully decayed.
    // Without this, the convolver tail gets cut short by early cleanup.
    const reverbTail =
      this._reverbConvolver && this._irCache ? this._irCache.duration + vibe.reverbPreDelay : 0;
    const sid = this._sessionId;
    setTimeout(
      () => {
        if (this._sessionId === sid) {
          this._cleanup();
        }
      },
      (releaseTime + reverbTail) * 1000 + 100,
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

  update(sigilState: SigilData): void {
    this._updateVoices(sigilState);
    this._updateMasterChain();
  }

  private _updateMasterChain(): void {
    if (!this.isPlaying || !this.audioCtx) {
      return;
    }
    const now = this.audioCtx.currentTime;

    if (this.compressor) {
      this.compressor.threshold.setValueAtTime(vibe.compThreshold, now);
      this.compressor.knee.setValueAtTime(vibe.compKnee, now);
      this.compressor.ratio.setValueAtTime(vibe.compRatio, now);
      this.compressor.attack.setValueAtTime(vibe.compAttack, now);
      this.compressor.release.setValueAtTime(vibe.compRelease, now);
    }
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(vibe.masterGain, now);
    }
    if (this._eqLow) {
      this._eqLow.frequency.setValueAtTime(vibe.eqLowFreq, now);
      this._eqLow.gain.setValueAtTime(vibe.eqLowGain, now);
    }
    if (this._eqMid) {
      this._eqMid.frequency.setValueAtTime(vibe.eqMidFreq, now);
      this._eqMid.gain.setValueAtTime(vibe.eqMidGain, now);
      this._eqMid.Q.setValueAtTime(vibe.eqMidQ, now);
    }
    if (this._eqHigh) {
      this._eqHigh.frequency.setValueAtTime(vibe.eqHighFreq, now);
      this._eqHigh.gain.setValueAtTime(vibe.eqHighGain, now);
    }
    if (this._reverbWet) {
      this._reverbWet.gain.setValueAtTime(vibe.reverbMix, now);
    }
  }

  private _updateVoices(sigilState: SigilData): void {
    if (!this.isPlaying || !this.audioCtx) {
      return;
    }
    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const voiceMap = new Map(sigilState.voices.map((v) => [v.id, v]));

    // Remove audio voices for deleted voices
    for (let i = this.activeVoices.length - 1; i >= 0; i--) {
      const audioVoice = this.activeVoices[i]!;
      if (!voiceMap.has(audioVoice.shapeId)) {
        this._stopVoice(audioVoice);
        this.activeVoices.splice(i, 1);
      }
    }

    // Add audio voices for new voices
    const activeIds = new Set(this.activeVoices.map((v) => v.shapeId));
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

      audioVoice.gain.gain.setValueAtTime(vibe.voiceGain(voice.waveform, voice.size), now);
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
          vibe.borderOctaveGain(
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

  muffle(): void {
    this._muffled = true;
    if (this._muffleFilter && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this._muffleFilter.frequency.cancelScheduledValues(now);
      this._muffleFilter.frequency.setValueAtTime(this._muffleFilter.frequency.value, now);
      this._muffleFilter.frequency.linearRampToValueAtTime(600, now + 0.15);
    }
  }

  unmuffle(): void {
    this._muffled = false;
    if (this._muffleFilter && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this._muffleFilter.frequency.cancelScheduledValues(now);
      this._muffleFilter.frequency.setValueAtTime(this._muffleFilter.frequency.value, now);
      this._muffleFilter.frequency.linearRampToValueAtTime(20000, now + 0.15);
    }
  }

  _updateBlendOverlaps(voices: readonly Voice[]): void {
    for (const audioVoice of this.activeVoices) {
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
    if (this._eqLow) {
      safeDisconnect(this._eqLow);
      this._eqLow = undefined;
    }
    if (this._eqMid) {
      safeDisconnect(this._eqMid);
      this._eqMid = undefined;
    }
    if (this._eqHigh) {
      safeDisconnect(this._eqHigh);
      this._eqHigh = undefined;
    }
    if (this._muffleFilter) {
      safeDisconnect(this._muffleFilter);
      this._muffleFilter = undefined;
    }

    // Pause the keep-alive <audio> element so iOS drops the audio session
    // Indicator (speaker icon in status bar / Control Center). It will be
    // Resumed in play() or by the permanent touchend/click listeners
    // Registered in _init().
    if (this._audioEl) {
      this._audioEl.pause();
    }

    this.isPlaying = false;
  }

  _stopVoice(audioVoice: AudioVoice): void {
    audioVoice.stop(0);
    if (audioVoice.octaveOsc) {
      safeStop(audioVoice.octaveOsc);
    }
    safeDisconnect(audioVoice.outputNode);
    audioVoice.effectDispose?.();
    audioVoice.blendEffect?.dispose();
  }

  /** Return a cached impulse response buffer.
   *  Caching ensures reverb sounds identical across repeated plays. */
  _getImpulseResponse(ctx: AudioContext): AudioBuffer {
    if (!this._irCache) {
      this._irCache = generateImpulseResponse(ctx);
    }
    return this._irCache;
  }

  _buildVoice(ctx: AudioContext, voice: Voice): AudioVoice {
    return buildVoice(ctx, voice, this.masterGain!, createEffect);
  }
}
