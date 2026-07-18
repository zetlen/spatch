// Engine.ts — Web Audio engine: AudioEngine class
//
// Owns AudioContext lifecycle, voice map, play/stop/release orchestration,
// cross-voice modulation routing (FM, ring mod, raw FM), and solo mode.
//
// All signal processing after the voice summing point is delegated to Master.
// Per-voice gain/pan/border calculations are delegated to Mixer.

import {
  BLEND_CONFIG,
  computeFMDepth,
  computeOverlap,
  FM_MODULATOR_LPF_HZ,
  FM_MODULATOR_LPF_Q,
  type BlendConfig,
} from '../effects.ts';
import { createEffect } from '../patterns.ts';
import { type BlendMode, type Envelope, type SigilData, type Voice } from '../types.ts';
import { yToFrequency } from './mapping.ts';
import {
  applyColorParams,
  chromaToF2,
  hueToF1,
  isSweepReversed,
  lightnessToCutoff,
  scheduleColorSweep,
} from './filters.ts';
import { Mixer } from './mixer.ts';
import { Master } from './master.ts';
import type { ReverbConfig } from './master-types.ts';
import { type AudioVoice, buildVoice, fillToKey, safeDisconnect } from './voice-builder.ts';

export interface PlayOptions {
  irBuffer?: AudioBuffer;
}

interface FMPair {
  depthGain: GainNode;
}

interface FMPairFiltered {
  lowpass: BiquadFilterNode;
  depthGain: GainNode;
}

interface RingPair {
  overlapSource: ConstantSourceNode;
  shadowAmpAtoB: GainNode;
  shadowAmpBtoA: GainNode;
}

type CrossConnection =
  | { type: 'fm'; aToB: FMPair; bToA: FMPair }
  | { type: 'ring'; pair: RingPair }
  | { type: 'rawfm'; aToB: FMPairFiltered; bToA: FMPairFiltered };

// ---- Audio Engine ----

export class AudioEngine {
  audioCtx: AudioContext | undefined = undefined;
  activeVoices: AudioVoice[] = [];
  readonly mixer = new Mixer();
  readonly master = new Master();
  private _crossConnections = new Map<string, CrossConnection>();
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

    // Declare playback intent. Default audioSession.type is 'auto', which lets
    // iOS guess and transition the context to 'interrupted' on screen lock.
    // 'playback' tells the OS to leave us alone like the YouTube tab.
    // Experimental API — feature-detect before setting.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) {
      nav.audioSession.type = 'playback';
    }

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
    this._tryPlayKeepAlive('init', false);

    // Recovery net for OS-level interruptions outside any DOM event (system
    // sleep/wake, Bluetooth handoff, phone calls). audioSession.type='playback'
    // reduces how often we hit this state, but doesn't eliminate it.
    this.audioCtx.addEventListener('statechange', () => this._handleStateChange());

    // Permanent listeners for qualifying gestures (touchend, click). warmUp()
    // resumes the AudioContext itself — iOS only honors resume() from these
    // gestures, and the context may have been created in a non-qualifying
    // event (play-button pointerdown, embed postMessage). _tryPlayKeepAlive
    // resumes the keep-alive <audio> if it was paused after a previous stop
    // and we're currently playing — the touchend/click that follows a
    // pointerdown play() resumes the element in the same gesture.
    const resumeKeepAlive = () => {
      this.warmUp();
      this._tryPlayKeepAlive('gesture');
    };
    document.addEventListener('touchend', resumeKeepAlive);
    document.addEventListener('click', resumeKeepAlive);
  }

  /** Notify owner when an OS interruption forces playback to stop.
   *  Set by PlaybackController to keep its UI state in sync. */
  onInterrupted: (() => void) | undefined = undefined;

  /** Handle AudioContext state transitions. iOS transitions to 'interrupted'
   *  for OS-level audio session takeovers (sleep/wake, calls, headphone
   *  changes). We can't reliably resume() from here because iOS won't honor
   *  resume calls outside a user gesture for the interrupted state — so we
   *  cleanly stop instead and let the next user-initiated play() recover.
   *  Exposed for unit tests. */
  _handleStateChange(): void {
    if (this.audioCtx?.state === 'interrupted') {
      this.stop();
      this.onInterrupted?.();
    }
  }

  /** Single source of truth for resuming the keep-alive `<audio>` element.
   *  When `requireIsPlaying` is true (the default), only acts if isPlaying;
   *  callers in init/play set it false because they're about to enter a
   *  playing state. Logs failures with a label identifying the call site. */
  private _tryPlayKeepAlive(label: string, requireIsPlaying = true): void {
    if (!this._audioEl || !this._audioEl.paused) {
      return;
    }
    if (requireIsPlaying && !this.isPlaying) {
      return;
    }
    this._audioEl.play().catch((error: unknown) => {
      console.warn(`[audio] keep-alive failed (${label}):`, error);
    });
  }

  /** Call from any user gesture to pre-warm the AudioContext.
   *  Also resumes an existing context that isn't running: _init() early-
   *  returns when the context already exists, so a context first created in
   *  a non-qualifying event (play-button pointerdown, embed postMessage)
   *  would otherwise stay silent on iOS — qualifying gestures (touchend,
   *  click, keydown) are the only place iOS Safari honors resume().
   *  Best effort: resume() rejects without transient activation (e.g. an
   *  embed postMessage before any gesture); callers check state after. */
  warmUp(): void {
    this._init();
    if (this.audioCtx && this.audioCtx.state !== 'running') {
      void this.audioCtx.resume().catch(() => {});
    }
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
    // 'interrupted' is iOS-specific (OS audio session takeover); resume()
    // works here because play() is invoked from a user gesture.
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
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
    this._tryPlayKeepAlive('play', false);

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

    // Build cross-connections for all voice pairs upfront.
    // Set _lastBlend first so _syncCrossConnections reads the correct config.
    this._lastBlend = sigilState.blend;
    this._buildAllCrossConnections(sigilState.voices, sigilState.blend);
    this._syncCrossConnections(sigilState.voices);

    this._playEnvelope = envelope;

    // Schedule diphthong sweeps for linear-fill voices
    const sweepStart = now + attack;
    for (let i = 0; i < sigilState.voices.length; i++) {
      const voice = sigilState.voices[i]!;
      const av = this.activeVoices[i]!;
      if (voice.fill.mode === 'linear') {
        const rev = isSweepReversed(voice.fill.gradAngle);
        const startH = rev ? voice.fill.h2 : voice.fill.h;
        const startC = rev ? voice.fill.c2 : voice.fill.c;
        const startL = rev ? voice.fill.l2 : voice.fill.l;
        av.f1.frequency.setValueAtTime(hueToF1(startH), now);
        av.f2.frequency.setValueAtTime(chromaToF2(startC), now);
        av.brightness.frequency.setValueAtTime(lightnessToCutoff(startL), now);

        scheduleColorSweep(
          { f1: av.f1, f2: av.f2, brightness: av.brightness },
          voice.fill,
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
          const startH = rev ? voice.fill.h2 : voice.fill.h;
          const startC = rev ? voice.fill.c2 : voice.fill.c;
          const startL = rev ? voice.fill.l2 : voice.fill.l;
          audioVoice.f1.frequency.setValueAtTime(hueToF1(startH), now);
          audioVoice.f2.frequency.setValueAtTime(chromaToF2(startC), now);
          audioVoice.brightness.frequency.setValueAtTime(lightnessToCutoff(startL), now);
          const midDecay = Math.max(0.01, this._playEnvelope?.decay ?? 0.2);
          scheduleColorSweep(
            { f1: audioVoice.f1, f2: audioVoice.f2, brightness: audioVoice.brightness },
            voice.fill,
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
        audioVoice.f1.frequency.cancelScheduledValues(now);
        audioVoice.f2.frequency.cancelScheduledValues(now);
        audioVoice.brightness.frequency.cancelScheduledValues(now);

        const rev = isSweepReversed(voice.fill.gradAngle);
        const startH = rev ? voice.fill.h2 : voice.fill.h;
        const startC = rev ? voice.fill.c2 : voice.fill.c;
        const startL = rev ? voice.fill.l2 : voice.fill.l;
        audioVoice.f1.frequency.setValueAtTime(hueToF1(startH), now);
        audioVoice.f2.frequency.setValueAtTime(chromaToF2(startC), now);
        audioVoice.brightness.frequency.setValueAtTime(lightnessToCutoff(startL), now);

        const retrigDecay = Math.max(0.01, this._playEnvelope?.decay ?? 0.2);
        scheduleColorSweep(
          { f1: audioVoice.f1, f2: audioVoice.f2, brightness: audioVoice.brightness },
          voice.fill,
          now,
          retrigDecay,
        );
        audioVoice.currentFillKey = fillKey;
      }

      if (!audioVoice.hasSweep) {
        applyColorParams(audioVoice.f1, audioVoice.f2, audioVoice.brightness, voice.fill);
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

    // Global blend change — full cross-connection rebuild
    if (sigilState.blend !== this._lastBlend) {
      this._disposeAllCrossConnections();
      this._buildAllCrossConnections(sigilState.voices, sigilState.blend);
      this._syncCrossConnections(sigilState.voices);
      this._lastBlend = sigilState.blend;
    } else if (voicesChanged) {
      // Voice add/remove — reconcile connections for current pairs
      this._reconcileCrossConnections(sigilState.voices, sigilState.blend);
      this._syncCrossConnections(sigilState.voices);
    } else if (movedVoiceIds.size > 0) {
      this._syncCrossConnections(sigilState.voices, movedVoiceIds);
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

  /** Suspend audio when the page becomes hidden.
   *  Pauses both the AudioContext and the keep-alive <audio> element
   *  so iOS Safari fully releases the media session. */
  suspend(): void {
    this.audioCtx?.suspend();
    this._audioEl?.pause();
  }

  /** Resume audio when the page becomes visible again. */
  resume(): void {
    if (!this.audioCtx) {
      return;
    }
    this.audioCtx.resume();
    this._tryPlayKeepAlive('resume');
  }

  setSoloVoice(id: string | undefined): void {
    this._soloVoiceId = id;
  }

  /** Tear down all cross-connections. */
  private _disposeAllCrossConnections(): void {
    for (const conn of this._crossConnections.values()) {
      this._disposeCrossConnection(conn);
    }
    this._crossConnections.clear();
  }

  /** Tear down a single cross-connection, silencing it first to avoid clicks. */
  private _disposeCrossConnection(conn: CrossConnection): void {
    switch (conn.type) {
      case 'fm': {
        conn.aToB.depthGain.gain.value = 0;
        safeDisconnect(conn.aToB.depthGain);
        conn.bToA.depthGain.gain.value = 0;
        safeDisconnect(conn.bToA.depthGain);
        break;
      }
      case 'ring': {
        const { pair } = conn;
        pair.overlapSource.offset.value = 0;
        safeDisconnect(pair.overlapSource);
        try {
          pair.overlapSource.stop();
        } catch {}
        pair.shadowAmpAtoB.gain.value = 0;
        safeDisconnect(pair.shadowAmpAtoB);
        pair.shadowAmpBtoA.gain.value = 0;
        safeDisconnect(pair.shadowAmpBtoA);
        break;
      }
      case 'rawfm': {
        conn.aToB.depthGain.gain.value = 0;
        safeDisconnect(conn.aToB.depthGain);
        safeDisconnect(conn.aToB.lowpass);
        conn.bToA.depthGain.gain.value = 0;
        safeDisconnect(conn.bToA.depthGain);
        safeDisconnect(conn.bToA.lowpass);
        break;
      }
    }
  }

  /**
   * Build cross-connections for ALL voice pairs upfront.
   * Called on play() and blend mode change. Screen mode skips (no connections).
   */
  private _buildAllCrossConnections(voices: readonly Voice[], blend: BlendMode): void {
    const ctx = this.audioCtx;
    if (!ctx) {
      return;
    }

    const blendCfg = BLEND_CONFIG[blend];
    if (blendCfg.type === 'none') {
      return;
    }

    const audioById = new Map(this.activeVoices.map((v) => [v.shapeId, v]));

    for (let i = 0; i < voices.length; i++) {
      for (let j = i + 1; j < voices.length; j++) {
        const voiceA = voices[i]!;
        const voiceB = voices[j]!;
        const audioA = audioById.get(voiceA.id);
        const audioB = audioById.get(voiceB.id);
        if (!audioA || !audioB) {
          continue;
        }
        const key = `${voiceA.id}:${voiceB.id}`;
        const conn = this._createCrossConnection(ctx, blendCfg, audioA, audioB);
        this._crossConnections.set(key, conn);
      }
    }
  }

  /**
   * Reconcile cross-connections after voice add/remove.
   * Removes connections involving deleted voices, adds connections for new voices.
   */
  private _reconcileCrossConnections(voices: readonly Voice[], blend: BlendMode): void {
    const ctx = this.audioCtx;
    if (!ctx) {
      return;
    }

    const blendCfg = BLEND_CONFIG[blend];
    if (blendCfg.type === 'none') {
      // Screen mode: ensure no stale connections remain
      this._disposeAllCrossConnections();
      return;
    }

    const audioById = new Map(this.activeVoices.map((v) => [v.shapeId, v]));
    const voiceIds = new Set(voices.map((v) => v.id));

    // Remove connections involving deleted voices
    for (const [key, conn] of this._crossConnections) {
      const [aId, bId] = key.split(':');
      if (!voiceIds.has(aId!) || !voiceIds.has(bId!)) {
        this._disposeCrossConnection(conn);
        this._crossConnections.delete(key);
      }
    }

    // Add connections for new voice pairs
    for (let i = 0; i < voices.length; i++) {
      for (let j = i + 1; j < voices.length; j++) {
        const voiceA = voices[i]!;
        const voiceB = voices[j]!;
        const key = `${voiceA.id}:${voiceB.id}`;
        if (this._crossConnections.has(key)) {
          continue;
        }
        const audioA = audioById.get(voiceA.id);
        const audioB = audioById.get(voiceB.id);
        if (!audioA || !audioB) {
          continue;
        }
        const conn = this._createCrossConnection(ctx, blendCfg, audioA, audioB);
        this._crossConnections.set(key, conn);
      }
    }
  }

  /**
   * Update gain values on all cross-connections based on current overlap.
   * NO creation or destruction — only value changes.
   *
   * When `movedVoiceIds` is provided, only pairs involving a moved voice are
   * recomputed — unchanged pairs retain their existing gains.
   */
  private _syncCrossConnections(voices: readonly Voice[], movedVoiceIds?: Set<string>): void {
    if (this._crossConnections.size === 0) {
      return;
    }

    const blendCfg = BLEND_CONFIG[this._lastBlend];
    const voiceById = new Map(voices.map((v) => [v.id, v]));
    const audioById = new Map(this.activeVoices.map((v) => [v.shapeId, v]));

    for (const [key, conn] of this._crossConnections) {
      const sep = key.indexOf(':');
      const aId = key.slice(0, sep);
      const bId = key.slice(sep + 1);

      // Skip pairs where neither voice moved
      if (movedVoiceIds && !movedVoiceIds.has(aId) && !movedVoiceIds.has(bId)) {
        continue;
      }

      const voiceA = voiceById.get(aId);
      const voiceB = voiceById.get(bId);
      if (!voiceA || !voiceB) {
        continue;
      }

      const audioA = audioById.get(aId);
      const audioB = audioById.get(bId);
      if (!audioA || !audioB) {
        continue;
      }

      const overlap = computeOverlap(voiceA, voiceB);

      switch (conn.type) {
        case 'fm': {
          if (blendCfg.type !== 'fm') {
            break;
          }
          const freqA = audioA.getShadowNode!().frequency.value;
          const freqB = audioB.getShadowNode!().frequency.value;
          conn.aToB.depthGain.gain.value = computeFMDepth(overlap, blendCfg.config, freqA);
          conn.bToA.depthGain.gain.value = computeFMDepth(overlap, blendCfg.config, freqB);
          break;
        }
        case 'ring': {
          conn.pair.overlapSource.offset.value = -overlap;
          conn.pair.shadowAmpAtoB.gain.value = overlap;
          conn.pair.shadowAmpBtoA.gain.value = overlap;
          break;
        }
        case 'rawfm': {
          if (blendCfg.type !== 'rawfm') {
            break;
          }
          const freqA = audioA.getModulatorNode().frequency.value;
          const freqB = audioB.getModulatorNode().frequency.value;
          conn.aToB.depthGain.gain.value = computeFMDepth(overlap, blendCfg.config, freqA);
          conn.bToA.depthGain.gain.value = computeFMDepth(overlap, blendCfg.config, freqB);
          break;
        }
      }
    }
  }

  private _createCrossConnection(
    ctx: AudioContext,
    blendCfg: BlendConfig,
    audioA: AudioVoice,
    audioB: AudioVoice,
  ): CrossConnection {
    switch (blendCfg.type) {
      case 'fm': {
        return this._createFMCross(ctx, audioA, audioB);
      }
      case 'ring': {
        return this._createRingCross(ctx, audioA, audioB);
      }
      case 'rawfm': {
        return this._createRawFMCross(ctx, audioA, audioB);
      }
      default: {
        throw new Error('unreachable');
      }
    }
  }

  private _createFMCross(
    ctx: AudioContext,
    audioA: AudioVoice,
    audioB: AudioVoice,
  ): CrossConnection {
    const aToB = this._createFMPair(ctx, audioA.getShadowNode!(), audioB);
    const bToA = this._createFMPair(ctx, audioB.getShadowNode!(), audioA);
    return { type: 'fm', aToB, bToA };
  }

  private _createFMPair(ctx: AudioContext, shadow: OscillatorNode, carrier: AudioVoice): FMPair {
    const depthGain = new GainNode(ctx, { gain: 0 });
    shadow.connect(depthGain);
    for (const param of carrier.getCarrierFrequencyParams()) {
      depthGain.connect(param);
    }
    return { depthGain };
  }

  private _createRingCross(
    ctx: AudioContext,
    audioA: AudioVoice,
    audioB: AudioVoice,
  ): CrossConnection {
    // ConstantSourceNode with offset=-overlap drives both voices' outputGain.gain
    // reduction. At overlap=0: offset=0, so outputGain stays at base gain 1.
    // At overlap=1: offset=-1, reducing dry gain to 0 (pure ring mod).
    const overlapSource = new ConstantSourceNode(ctx, { offset: 0 });
    overlapSource.connect(audioA.outputGain.gain);
    overlapSource.connect(audioB.outputGain.gain);
    overlapSource.start();

    // B's shadow → shadowAmpAtoB → A's outputGain.gain (ring-modulates A)
    const shadowAmpAtoB = new GainNode(ctx, { gain: 0 });
    audioB.getShadowNode!().connect(shadowAmpAtoB);
    shadowAmpAtoB.connect(audioA.outputGain.gain);

    // A's shadow → shadowAmpBtoA → B's outputGain.gain (ring-modulates B)
    const shadowAmpBtoA = new GainNode(ctx, { gain: 0 });
    audioA.getShadowNode!().connect(shadowAmpBtoA);
    shadowAmpBtoA.connect(audioB.outputGain.gain);

    return { type: 'ring', pair: { overlapSource, shadowAmpAtoB, shadowAmpBtoA } };
  }

  private _createRawFMCross(
    ctx: AudioContext,
    audioA: AudioVoice,
    audioB: AudioVoice,
  ): CrossConnection {
    const aToB = this._createRawFMPair(ctx, audioA.getModulatorNode(), audioB);
    const bToA = this._createRawFMPair(ctx, audioB.getModulatorNode(), audioA);
    return { type: 'rawfm', aToB, bToA };
  }

  private _createRawFMPair(
    ctx: AudioContext,
    modulator: OscillatorNode,
    carrier: AudioVoice,
  ): FMPairFiltered {
    const lowpass = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: FM_MODULATOR_LPF_HZ,
      Q: FM_MODULATOR_LPF_Q,
    });
    const depthGain = new GainNode(ctx, { gain: 0 });
    modulator.connect(lowpass);
    lowpass.connect(depthGain);
    for (const param of carrier.getCarrierFrequencyParams()) {
      depthGain.connect(param);
    }
    return { lowpass, depthGain };
  }

  _cleanup(): void {
    this._sessionId++;

    this._disposeAllCrossConnections();

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
    safeDisconnect(audioVoice.outputGain);
    audioVoice.effectDispose?.();

    // Cross-connections hold node references from this voice's graph, which is
    // now stopped. Dispose them so reconciliation rebuilds the pairs against a
    // replacement graph (rebuild) or drops them (deletion).
    for (const [key, conn] of this._crossConnections) {
      const sep = key.indexOf(':');
      if (key.slice(0, sep) === audioVoice.shapeId || key.slice(sep + 1) === audioVoice.shapeId) {
        this._disposeCrossConnection(conn);
        this._crossConnections.delete(key);
      }
    }
  }

  _buildVoice(ctx: AudioContext, voice: Voice): AudioVoice {
    return buildVoice(ctx, voice, this.master.input!, this.mixer, createEffect);
  }
}
