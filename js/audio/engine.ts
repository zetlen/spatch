// engine.ts — Web Audio engine: AudioEngine class

import { computeTotalOverlap, createEffect } from '../effects.ts';
import { type Envelope, type SigilData, type Voice } from '../types.ts';
import { yToFrequency } from './mapping.ts';
import {
  applyFormantFilter,
  computeFormantQ,
  hueToFormants,
  isSweepReversed,
  lightnessToCutoff,
  scheduleFormantSweep,
} from './formants.ts';
import { decodeIR } from './ir-loader.ts';
import { type Vibe, vibe } from './vibe.ts';
import {
  type AudioVoice,
  buildVoice,
  fillToKey,
  safeDisconnect,
  safeStop,
} from './voice-builder.ts';

export interface PlayOptions {
  irBuffer?: AudioBuffer;
}

// ---- Audio Engine ----

export class AudioEngine {
  audioCtx: AudioContext | undefined = undefined;
  activeVoices: AudioVoice[] = [];
  masterGain: GainNode | undefined;
  envelopeGain: GainNode | undefined;
  compressor: DynamicsCompressorNode | undefined;
  isPlaying: boolean = false;
  private _sessionId: number = 0;
  private _analyser: AnalyserNode | undefined;
  private _analyserBuf: Float32Array<ArrayBuffer> | undefined;
  private _reverbConvolver: ConvolverNode | undefined;
  private _reverbWet: GainNode | undefined;
  private _streamDest: MediaStreamAudioDestinationNode | undefined;
  private _audioEl: HTMLAudioElement | undefined;
  private _eqLow: BiquadFilterNode | undefined;
  private _eqMid: BiquadFilterNode | undefined;
  private _eqHigh: BiquadFilterNode | undefined;
  private _muffleFilter: BiquadFilterNode | undefined;
  private _muffled: boolean = false;
  private _reverbPreDelayNode: DelayNode | undefined;
  private _playEnvelope: Envelope | undefined;
  private _appliedVibe: Vibe | undefined;
  private _appliedIR: string | undefined;
  private _appliedReverbPreDelay: number = 0;
  private _pendingIRBuffer: AudioBuffer | undefined;

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
    const silent = new AudioBuffer({ numberOfChannels: 1, length: 1, sampleRate: 22_050 });
    const src = new AudioBufferSourceNode(this.audioCtx, { buffer: silent });
    src.connect(this.audioCtx.destination);
    src.start(0);

    // Resume synchronously — don't await the promise.
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    // Route audio through a MediaStreamDestination → <audio> element.
    // Safari aggressively suspends bare AudioContext output but treats
    // <audio> srcObject streams as "real" media that keeps playing.
    this._streamDest = new MediaStreamAudioDestinationNode(this.audioCtx);
    this._audioEl = document.createElement('audio');
    this._audioEl.srcObject = this._streamDest.stream;
    this._audioEl.volume = 0; // Must be silent — audio goes through ctx.destination
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

  async play(sigilState: SigilData, envelope: Envelope, opts?: PlayOptions): Promise<void> {
    this._init();
    this.stop();
    this._pendingIRBuffer = opts?.irBuffer;

    const ctx = this.audioCtx!;
    // Don't await resume() — warmUp() already called it synchronously from
    // The user gesture. Awaiting here can hang on iOS Safari if the context
    // Is mid-resume. Fire-and-forget as a fallback only.
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Master chain
    this.compressor = new DynamicsCompressorNode(ctx, {
      threshold: vibe.compThreshold,
      knee: vibe.compKnee,
      ratio: vibe.compRatio,
      attack: vibe.compAttack,
      release: vibe.compRelease,
    });

    this.envelopeGain = new GainNode(ctx, { gain: 0 });

    this.masterGain = new GainNode(ctx, { gain: vibe.masterGain });

    // Analyser for level metering (drives play glow)
    this._analyser = new AnalyserNode(ctx, { fftSize: 256 });
    this._analyserBuf = new Float32Array(this._analyser.fftSize);

    // 3-band EQ from vibe
    this._eqLow = new BiquadFilterNode(ctx, {
      type: 'lowshelf',
      frequency: vibe.eqLowFreq,
      gain: vibe.eqLowGain,
    });

    this._eqMid = new BiquadFilterNode(ctx, {
      type: 'peaking',
      frequency: vibe.eqMidFreq,
      gain: vibe.eqMidGain,
      Q: vibe.eqMidQ,
    });

    this._eqHigh = new BiquadFilterNode(ctx, {
      type: 'highshelf',
      frequency: vibe.eqHighFreq,
      gain: vibe.eqHighGain,
    });

    // Wire: masterGain -> envelopeGain -> compressor -> eqLow -> eqMid -> eqHigh -> analyser -> dest
    this.masterGain.connect(this.envelopeGain);
    this.envelopeGain.connect(this.compressor);
    this.compressor.connect(this._eqLow);
    this._eqLow.connect(this._eqMid);
    this._eqMid.connect(this._eqHigh);
    this._eqHigh.connect(this._analyser);
    // Muffle filter: low-pass that's normally transparent (20 kHz cutoff)
    // but drops to ~600 Hz when muffled (e.g. credits overlay).
    this._muffleFilter = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: this._muffled ? 600 : 20000,
      Q: 0.7,
    });
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
    this._buildReverb();

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

    this._playEnvelope = envelope;

    // Schedule diphthong sweeps for linear-fill voices
    const sweepStart = now + attack;
    for (let i = 0; i < sigilState.voices.length; i++) {
      const voice = sigilState.voices[i]!;
      const av = this.activeVoices[i]!;
      if (voice.fill.mode === 'linear') {
        const rev = isSweepReversed(voice.fill.gradAngle);
        const startF = hueToFormants(rev ? voice.fill.h2 : voice.fill.h);
        const startQ = computeFormantQ(rev ? voice.fill.s2 : voice.fill.s, voice.waveform);
        const startCutoff = lightnessToCutoff(rev ? voice.fill.l2 : voice.fill.l);
        av.formantF1.frequency.setValueAtTime(startF.f1, now);
        av.formantF1.Q.setValueAtTime(startQ, now);
        av.formantF2.frequency.setValueAtTime(startF.f2, now);
        av.formantF2.Q.setValueAtTime(startQ * 0.7, now);
        av.brightness.frequency.setValueAtTime(startCutoff, now);

        scheduleFormantSweep(
          av.formantF1,
          av.formantF2,
          av.brightness,
          voice.fill,
          voice.waveform,
          sweepStart,
          decay,
        );
        av.hasSweep = true;
      }
    }

    this._appliedVibe = vibe;
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

    // Poll output level and clean up once inaudible, rather than guessing
    // a fixed timeout from release + reverb tail duration.
    const SILENCE_THRESHOLD = 0.001; // ~-60 dB
    const reverbTail = this._reverbConvolver?.buffer
      ? this._reverbConvolver.buffer.duration + vibe.reverbPreDelay
      : 0;
    const maxWaitMs = (releaseTime + reverbTail) * 1000 + 2000;
    const sid = this._sessionId;
    const startTime = performance.now();
    const pollSilence = () => {
      if (this._sessionId !== sid) return;
      if (this.getLevel() < SILENCE_THRESHOLD || performance.now() - startTime > maxWaitMs) {
        this._cleanup();
        return;
      }
      setTimeout(pollSilence, 50);
    };
    // Start polling after the envelope release finishes
    setTimeout(pollSilence, releaseTime * 1000);
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
    this._syncReverb();
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
        // Schedule diphthong sweep for new linear-fill voices added mid-playback
        if (voice.fill.mode === 'linear') {
          const rev = isSweepReversed(voice.fill.gradAngle);
          const startF = hueToFormants(rev ? voice.fill.h2 : voice.fill.h);
          const startQ = computeFormantQ(rev ? voice.fill.s2 : voice.fill.s, voice.waveform);
          const startCutoff = lightnessToCutoff(rev ? voice.fill.l2 : voice.fill.l);
          audioVoice.formantF1.frequency.setValueAtTime(startF.f1, now);
          audioVoice.formantF1.Q.setValueAtTime(startQ, now);
          audioVoice.formantF2.frequency.setValueAtTime(startF.f2, now);
          audioVoice.formantF2.Q.setValueAtTime(startQ * 0.7, now);
          audioVoice.brightness.frequency.setValueAtTime(startCutoff, now);
          const midDecay = Math.max(0.01, this._playEnvelope?.decay ?? 0.2);
          scheduleFormantSweep(
            audioVoice.formantF1,
            audioVoice.formantF2,
            audioVoice.brightness,
            voice.fill,
            voice.waveform,
            now,
            midDecay,
          );
          audioVoice.hasSweep = true;
        }
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
      audioVoice.panner.pan.setValueAtTime(vibe.xToPan(voice.x), now);

      // Retrig diphthong sweep when linear fill params change during playback
      const fillKey = fillToKey(voice.fill);
      if (
        audioVoice.hasSweep &&
        fillKey !== audioVoice.currentFillKey &&
        voice.fill.mode === 'linear'
      ) {
        audioVoice.formantF1.frequency.cancelScheduledValues(now);
        audioVoice.formantF1.Q.cancelScheduledValues(now);
        audioVoice.formantF2.frequency.cancelScheduledValues(now);
        audioVoice.formantF2.Q.cancelScheduledValues(now);
        audioVoice.brightness.frequency.cancelScheduledValues(now);

        const rev = isSweepReversed(voice.fill.gradAngle);
        const startF = hueToFormants(rev ? voice.fill.h2 : voice.fill.h);
        const startQ = computeFormantQ(rev ? voice.fill.s2 : voice.fill.s, voice.waveform);
        const startCutoff = lightnessToCutoff(rev ? voice.fill.l2 : voice.fill.l);
        audioVoice.formantF1.frequency.setValueAtTime(startF.f1, now);
        audioVoice.formantF1.Q.setValueAtTime(startQ, now);
        audioVoice.formantF2.frequency.setValueAtTime(startF.f2, now);
        audioVoice.formantF2.Q.setValueAtTime(startQ * 0.7, now);
        audioVoice.brightness.frequency.setValueAtTime(startCutoff, now);

        const retrigDecay = Math.max(0.01, this._playEnvelope?.decay ?? 0.2);
        scheduleFormantSweep(
          audioVoice.formantF1,
          audioVoice.formantF2,
          audioVoice.brightness,
          voice.fill,
          voice.waveform,
          now,
          retrigDecay,
        );
        audioVoice.currentFillKey = fillKey;
      }

      if (!audioVoice.hasSweep) {
        applyFormantFilter(
          audioVoice.formantF1,
          audioVoice.formantF2,
          audioVoice.brightness,
          voice.fill,
          voice.waveform,
        );
      }

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

    // Sync voice-level vibe params when vibe instance changed (scene or tuner)
    if (vibe !== this._appliedVibe) {
      for (const av of this.activeVoices) {
        av.formantMixer.gain.setValueAtTime(vibe.formantMix, now);
        av.brightness.Q.setValueAtTime(vibe.brightnessQ, now);
        if (av.warmthShaper) {
          const warmSamples = 1024;
          const warmCurve = new Float32Array(warmSamples);
          for (let i = 0; i < warmSamples; i++) {
            const x = (i * 2) / warmSamples - 1;
            warmCurve[i] = Math.tanh(x * vibe.warmth);
          }
          av.warmthShaper.curve = warmCurve;
        }
      }
      this._appliedVibe = vibe;
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

  private _buildReverb(): void {
    this._appliedIR = vibe.ir;
    this._appliedReverbPreDelay = vibe.reverbPreDelay;
    if (!vibe.ir || !this.audioCtx || !this.envelopeGain || !this.compressor) return;

    const ctx = this.audioCtx;
    this._reverbConvolver = new ConvolverNode(ctx);
    this._reverbWet = new GainNode(ctx, { gain: vibe.reverbMix });

    if (vibe.reverbPreDelay > 0) {
      this._reverbPreDelayNode = new DelayNode(ctx, {
        maxDelayTime: 1,
        delayTime: vibe.reverbPreDelay,
      });
      this.envelopeGain.connect(this._reverbPreDelayNode);
      this._reverbPreDelayNode.connect(this._reverbConvolver);
    } else {
      this.envelopeGain.connect(this._reverbConvolver);
    }
    this._reverbConvolver.connect(this._reverbWet);
    this._reverbWet.connect(this.compressor);

    // Use pre-decoded buffer if provided, otherwise load async
    if (this._pendingIRBuffer) {
      this._reverbConvolver.buffer = this._pendingIRBuffer;
      this._pendingIRBuffer = undefined;
    } else {
      const convolver = this._reverbConvolver;
      decodeIR(ctx, vibe.ir)
        .then((buf) => {
          convolver.buffer = buf;
        })
        .catch(() => {});
    }
  }

  private _teardownReverb(): void {
    if (this._reverbPreDelayNode) {
      try {
        this.envelopeGain?.disconnect(this._reverbPreDelayNode);
      } catch {}
      safeDisconnect(this._reverbPreDelayNode);
      this._reverbPreDelayNode = undefined;
    } else if (this._reverbConvolver && this.envelopeGain) {
      try {
        this.envelopeGain.disconnect(this._reverbConvolver);
      } catch {}
    }
    if (this._reverbConvolver) {
      safeDisconnect(this._reverbConvolver);
      this._reverbConvolver = undefined;
    }
    if (this._reverbWet) {
      safeDisconnect(this._reverbWet);
      this._reverbWet = undefined;
    }
  }

  private _syncReverb(): void {
    if (!this.isPlaying) return;
    if (vibe.ir === this._appliedIR && vibe.reverbPreDelay === this._appliedReverbPreDelay) return;
    this._teardownReverb();
    this._buildReverb();
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
    this._teardownReverb();
    this._playEnvelope = undefined;
    this._appliedVibe = undefined;
    this._appliedIR = undefined;
    this._appliedReverbPreDelay = 0;
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

  _buildVoice(ctx: AudioContext, voice: Voice): AudioVoice {
    return buildVoice(ctx, voice, this.masterGain!, createEffect);
  }
}
