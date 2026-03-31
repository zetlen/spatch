// Engine.ts — Web Audio engine: AudioEngine class
//
// Owns AudioContext lifecycle, voice map, play/stop/release orchestration,
// FM cross-voice routing, and solo mode.
//
// All signal processing after the voice summing point is delegated to Master.
// Per-voice gain/pan/border calculations are delegated to Mixer.

import { computeOverlap, FM_PARAMS, computeFMDepth } from '../effects.ts';
import { createEffect } from '../patterns.ts';
import { type BlendMode, type Envelope, type SigilData, type Voice } from '../types.ts';
import { yToFrequency } from './mapping.ts';
import {
  applyFormantFilter,
  computeFormantQ,
  hueToFormants,
  isSweepReversed,
  lightnessToCutoff,
  scheduleFormantSweep,
} from './formants.ts';
import { Mixer } from './mixer.ts';
import { Master } from './master.ts';
import type { ReverbConfig } from './master-types.ts';
import { type AudioVoice, buildVoice, fillToKey, safeDisconnect } from './voice-builder.ts';

export interface PlayOptions {
  irBuffer?: AudioBuffer;
}

/** A cross-voice FM connection: top voice modulates bottom voice's frequency. */
interface FMConnection {
  depthGain: GainNode;
  feedbackGain: GainNode | undefined;
}

// ---- Audio Engine ----

export class AudioEngine {
  audioCtx: AudioContext | undefined = undefined;
  activeVoices: AudioVoice[] = [];
  readonly mixer = new Mixer();
  readonly master = new Master();
  private _fmConnections = new Map<string, FMConnection>();
  isPlaying: boolean = false;
  private _sessionId: number = 0;
  private _streamDest: MediaStreamAudioDestinationNode | undefined;
  private _audioEl: HTMLAudioElement | undefined;
  private _soloVoiceId: string | undefined;
  private _lastBlend: BlendMode = 'screen';
  private _playEnvelope: Envelope | undefined;
  private _activeReverb: ReverbConfig | undefined;

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

  async play(
    sigilState: SigilData,
    envelope: Envelope,
    reverb: ReverbConfig,
    opts?: PlayOptions,
  ): Promise<void> {
    this._init();
    this.stop();

    const ctx = this.audioCtx!;
    // Don't await resume() — warmUp() already called it synchronously from
    // The user gesture. Awaiting here can hang on iOS Safari if the context
    // Is mid-resume. Fire-and-forget as a fallback only.
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Build the master signal chain (masterGain → envelope → effects → compressor → EQ → analyser → muffle → destination)
    this.master.build(ctx, { streamDest: this._streamDest, irBuffer: opts?.irBuffer });
    this.master.setReverb(ctx, reverb, opts?.irBuffer);
    this._activeReverb = reverb;

    // Resume keep-alive <audio> if it was paused after a previous stop.
    // May fail outside a user gesture (e.g. loop restart) — that's OK,
    // The AudioContext is already running and the permanent touchend/click
    // Listeners in _init() will resume it on the next qualifying gesture.
    if (this._audioEl && this._audioEl.paused) {
      this._audioEl.play().catch(() => {});
    }

    // Apply ADSR envelope
    this.master.scheduleEnvelope(ctx, envelope);

    // Build voices
    const soloActive =
      this._soloVoiceId !== undefined && sigilState.voices.some((v) => v.id === this._soloVoiceId);
    const now = ctx.currentTime;
    const attack = Math.max(0.01, envelope.attack);
    const decay = Math.max(0.01, envelope.decay);
    const decayTime = now + attack;
    for (const voice of sigilState.voices) {
      const audioVoice = this._buildVoice(ctx, voice);
      if (soloActive && voice.id !== this._soloVoiceId) {
        audioVoice.gain.gain.setValueAtTime(0, now);
      }
      audioVoice.start(now);
      audioVoice.onDecay?.(decayTime);
      this.activeVoices.push(audioVoice);
    }

    // Sync FM connections (only created for overlapping pairs)
    this._syncFMConnections(sigilState.voices, sigilState.blend);
    this._lastBlend = sigilState.blend;

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
          { f1: av.formantF1, f2: av.formantF2, brightness: av.brightness },
          voice.fill,
          voice.waveform,
          sweepStart,
          decay,
        );
        av.hasSweep = true;
      }
    }

    this.isPlaying = true;
  }

  release(envelope: Envelope): void {
    if (!this.isPlaying || !this.master.envelopeGain) {
      return;
    }
    const ctx = this.audioCtx!;

    this.master.scheduleRelease(ctx, envelope);

    // Fire onRelease hooks (e.g. release-triggered stamp samples)
    const releaseNow = ctx.currentTime;
    for (const av of this.activeVoices) {
      av.onRelease?.(releaseNow);
    }

    // Poll output level and clean up once inaudible, rather than guessing
    // A fixed timeout from release + reverb tail duration.
    const SILENCE_THRESHOLD = 0.001; // ~-60 dB
    const releaseTime = Math.max(0.01, envelope.release);
    const reverbTail = this.master.reverbTailDuration();
    const maxWaitMs = (releaseTime + reverbTail) * 1000 + 2000;
    const sid = this._sessionId;
    const startTime = performance.now();
    const pollSilence = () => {
      if (this._sessionId !== sid) {
        return;
      }
      if (this.master.getLevel() < SILENCE_THRESHOLD || performance.now() - startTime > maxWaitMs) {
        this._cleanup();
        return;
      }
      setTimeout(pollSilence, 50);
    };
    // Start polling after the envelope release finishes
    setTimeout(pollSilence, releaseTime * 1000);
  }

  setEnvelopePosition(t: number, envelope: Envelope): void {
    if (!this.isPlaying || !this.audioCtx) {
      return;
    }
    this.master.setEnvelopePosition(this.audioCtx, t, envelope);
  }

  update(sigilState: SigilData, reverb: ReverbConfig): void {
    this._updateVoices(sigilState);
    if (this.audioCtx) {
      this.master.syncReverb(this.audioCtx, reverb);
    }
    this._activeReverb = reverb;
  }

  private _updateVoices(sigilState: SigilData): void {
    if (!this.isPlaying || !this.audioCtx) {
      return;
    }
    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const voiceMap = new Map(sigilState.voices.map((v) => [v.id, v]));
    let voicesChanged = false;

    // Remove audio voices for deleted voices
    for (let i = this.activeVoices.length - 1; i >= 0; i--) {
      const audioVoice = this.activeVoices[i]!;
      if (!voiceMap.has(audioVoice.shapeId)) {
        this._stopVoice(audioVoice);
        this.activeVoices.splice(i, 1);
        voicesChanged = true;
      }
    }

    const soloActive = this._soloVoiceId !== undefined && voiceMap.has(this._soloVoiceId);

    // Add audio voices for new voices
    const activeIds = new Set(this.activeVoices.map((v) => v.shapeId));
    for (const voice of sigilState.voices) {
      if (!activeIds.has(voice.id)) {
        const audioVoice = this._buildVoice(ctx, voice);
        if (soloActive && voice.id !== this._soloVoiceId) {
          audioVoice.gain.gain.setValueAtTime(0, now);
        }
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
            {
              f1: audioVoice.formantF1,
              f2: audioVoice.formantF2,
              brightness: audioVoice.brightness,
            },
            voice.fill,
            voice.waveform,
            now,
            midDecay,
          );
          audioVoice.hasSweep = true;
        }
        this.activeVoices.push(audioVoice);
        voicesChanged = true;
      }
    }

    // Track which voices moved for incremental FM sync
    const movedVoiceIds = new Set<string>();

    // Update existing audio voices
    for (let i = this.activeVoices.length - 1; i >= 0; i--) {
      const audioVoice = this.activeVoices[i]!;
      const voice = voiceMap.get(audioVoice.shapeId);
      if (!voice) {
        continue;
      }

      // Effect or border changed — tear down and rebuild the entire voice
      const borderKey = voice.border
        ? `${voice.border.color}:${voice.border.double ? 1 : 0}`
        : undefined;
      if (voice.effect !== audioVoice.currentEffect || borderKey !== audioVoice.currentBorder) {
        this._stopVoice(audioVoice);
        this.activeVoices.splice(i, 1);
        const rebuilt = this._buildVoice(ctx, voice);
        if (soloActive && voice.id !== this._soloVoiceId) {
          rebuilt.gain.gain.setValueAtTime(0, now);
        }
        rebuilt.start(now);
        this.activeVoices.push(rebuilt);
        voicesChanged = true;
        continue;
      }

      audioVoice.updateParams(voice, now);

      const isMuted = soloActive && voice.id !== this._soloVoiceId;
      audioVoice.gain.gain.setValueAtTime(
        isMuted ? 0 : this.mixer.voiceGain(voice.waveform, voice.size),
        now,
      );
      audioVoice.panner.pan.setValueAtTime(this.mixer.xToPan(voice.x), now);

      // Detect position/size changes for incremental FM sync
      if (
        voice.x !== audioVoice.lastX ||
        voice.y !== audioVoice.lastY ||
        voice.size !== audioVoice.lastSize
      ) {
        movedVoiceIds.add(voice.id);
        audioVoice.lastX = voice.x;
        audioVoice.lastY = voice.y;
        audioVoice.lastSize = voice.size;
      }

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
          { f1: audioVoice.formantF1, f2: audioVoice.formantF2, brightness: audioVoice.brightness },
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
        const freq = yToFrequency(voice.y);
        const octaveShift = voice.border.double ? 2 : 1;
        const direction = voice.border.color === 'white' ? 1 : -1;
        const octaveFreq = freq * 2 ** (direction * octaveShift);
        audioVoice.octaveOsc.frequency.setValueAtTime(octaveFreq, now);
      }

      // Update border octave gain (relative to voice gain via shared gain node)
      if (audioVoice.octaveGainNode) {
        audioVoice.octaveGainNode.gain.setValueAtTime(
          voice.border
            ? this.mixer.borderOctaveGain(
                voice.border.thickness,
                voice.border.color,
                voice.border.double,
              )
            : 0,
          now,
        );
      }
    }

    // Global blend change or voice add/remove — full FM rebuild
    if (sigilState.blend !== this._lastBlend || voicesChanged) {
      this._disposeFMConnections();
      this._syncFMConnections(sigilState.voices, sigilState.blend);
      this._lastBlend = sigilState.blend;
    } else if (movedVoiceIds.size > 0) {
      this._syncFMConnections(sigilState.voices, sigilState.blend, movedVoiceIds);
    }
  }

  stop(): void {
    if (!this.isPlaying) {
      return;
    }
    this._cleanup();
  }

  /** Current RMS output level as 0–1. */
  getLevel(): number {
    return this.master.getLevel();
  }

  muffle(): void {
    if (this.audioCtx) {
      this.master.muffle(this.audioCtx);
    }
  }

  unmuffle(): void {
    if (this.audioCtx) {
      this.master.unmuffle(this.audioCtx);
    }
  }

  setSoloVoice(id: string | undefined): void {
    this._soloVoiceId = id;
  }

  /** Tear down all FM connections. */
  private _disposeFMConnections(): void {
    for (const conn of this._fmConnections.values()) {
      this._disposeFMConnection(conn);
    }
    this._fmConnections.clear();
  }

  /** Tear down a single FM connection, silencing it first to avoid clicks. */
  private _disposeFMConnection(conn: FMConnection): void {
    conn.depthGain.gain.value = 0;
    safeDisconnect(conn.depthGain);
    if (conn.feedbackGain) {
      conn.feedbackGain.gain.value = 0;
      safeDisconnect(conn.feedbackGain);
    }
  }

  /**
   * Lazily create, update, and tear down FM connections based on current overlap.
   * Connections are only created when overlap > 0 — non-overlapping voices have
   * NO nodes attached to their frequency AudioParams, keeping the audio graph clean.
   *
   * When `movedVoiceIds` is provided, only pairs involving a moved voice are
   * recomputed — unchanged pairs retain their existing connection and depth.
   * Pass undefined (or omit) for a full sweep (initial play, voice add/remove).
   */
  private _syncFMConnections(
    voices: readonly Voice[],
    blend: BlendMode,
    movedVoiceIds?: Set<string>,
  ): void {
    const ctx = this.audioCtx;
    if (!ctx) {
      return;
    }

    const audioById = new Map(this.activeVoices.map((v) => [v.shapeId, v]));
    const activeKeys = new Set<string>();

    for (let i = 0; i < voices.length; i++) {
      for (let j = i + 1; j < voices.length; j++) {
        const carrierData = voices[i]!;
        const modulatorData = voices[j]!;

        // Skip FM for blend modes with no modulation (e.g. screen) —
        // Check before computing overlap to avoid the sqrt
        const params = FM_PARAMS[blend];
        if (params.maxIndex <= 0) {
          continue;
        }

        const key = `${modulatorData.id}:${carrierData.id}`;

        // If we know which voices moved, skip pairs where neither voice
        // Changed position — their overlap and depth are unchanged.
        if (
          movedVoiceIds &&
          !movedVoiceIds.has(carrierData.id) &&
          !movedVoiceIds.has(modulatorData.id)
        ) {
          if (this._fmConnections.has(key)) {
            activeKeys.add(key);
          }
          continue;
        }

        const overlap = computeOverlap(modulatorData, carrierData);

        if (overlap <= 0) {
          continue;
        }

        activeKeys.add(key);

        const carrierAudio = audioById.get(carrierData.id);
        const modulatorAudio = audioById.get(modulatorData.id);
        if (!carrierAudio || !modulatorAudio) {
          continue;
        }

        let conn = this._fmConnections.get(key);
        if (!conn) {
          conn = this._createFMConnection(ctx, blend, modulatorAudio, carrierAudio);
          this._fmConnections.set(key, conn);
        }

        // Update depth
        const modNode = modulatorAudio.getModulatorNode();
        const modFreq = modNode.frequency.value;
        const depth = computeFMDepth(overlap, params, modFreq);

        conn.depthGain.gain.value = depth;

        if (conn.feedbackGain) {
          conn.feedbackGain.gain.value = overlap * params.feedback * modFreq * 0.5;
        }
      }
    }

    // Tear down connections for pairs that no longer overlap
    for (const [key, conn] of this._fmConnections) {
      if (!activeKeys.has(key)) {
        this._disposeFMConnection(conn);
        this._fmConnections.delete(key);
      }
    }
  }

  /** Create a single FM connection: modulator oscillator → depth → carrier frequency. */
  private _createFMConnection(
    ctx: AudioContext,
    blend: BlendMode,
    modulatorAudio: AudioVoice,
    carrierAudio: AudioVoice,
  ): FMConnection {
    const params = FM_PARAMS[blend];
    const depthGain = new GainNode(ctx, { gain: 0 });
    const modulatorNode = modulatorAudio.getModulatorNode();
    const carrierParams = carrierAudio.getCarrierFrequencyParams();

    modulatorNode.connect(depthGain);
    for (const freqParam of carrierParams) {
      depthGain.connect(freqParam);
    }

    // Self-modulation feedback for overlay mode
    let feedbackGain: GainNode | undefined;
    if (params.feedback > 0) {
      feedbackGain = new GainNode(ctx, { gain: 0 });
      modulatorNode.connect(feedbackGain);
      feedbackGain.connect(modulatorNode.frequency);
    }

    return { depthGain, feedbackGain };
  }

  _cleanup(): void {
    this._sessionId++;

    this._disposeFMConnections();

    for (const audioVoice of this.activeVoices) {
      this._stopVoice(audioVoice);
    }
    this.activeVoices = [];

    this.master.cleanup();
    this._playEnvelope = undefined;
    this._activeReverb = undefined;

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
    safeDisconnect(audioVoice.outputNode);
    audioVoice.effectDispose?.();
  }

  _buildVoice(ctx: AudioContext, voice: Voice): AudioVoice {
    return buildVoice(ctx, voice, this.master.input!, this.mixer, createEffect);
  }
}
