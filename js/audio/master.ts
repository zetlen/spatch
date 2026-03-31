// Master.ts — Post-summing master signal chain.
//
// Owns all nodes between the voice summing point and ctx.destination:
//   input (masterGain) → envelopeGain → [saturation → exciter → comb]
//     → compressor → eqLow → eqMid → eqHigh → analyser → muffleFilter
//       → ctx.destination + streamDest
//
// Reverb runs in parallel from envelopeGain:
//   envelopeGain → [optional preDelay →] convolver → reverbWet → compressor
//
// All mastering parameters are fixed constants (VIBE_DEFAULTS values).
// Only reverb is configurable via ReverbConfig.

import type { Envelope } from '../types.ts';
import type { ReverbConfig } from './master-types.ts';
import { decodeSample } from './sample-loader.ts';
import { makeSaturationCurve, safeDisconnect } from './node-utils.ts';

// ---- Fixed master constants (from VIBE_DEFAULTS) ----

const COMP_THRESHOLD = -10;
const COMP_KNEE = 18;
const COMP_RATIO = 3;
const COMP_ATTACK = 0.005;
const COMP_RELEASE = 0.25;
const MASTER_GAIN_VALUE = 0.5;
const EQ_LOW_FREQ = 200;
const EQ_LOW_GAIN = 0;
const EQ_MID_FREQ = 1000;
const EQ_MID_GAIN = 0;
const EQ_MID_Q = 1;
const EQ_HIGH_FREQ = 4000;
const EQ_HIGH_GAIN = 0;
const SATURATION = 0;
const EXCITE = 0;
const COMB_MIX = 0;
const COMB_FREQ = 0.008;

export class Master {
  /** Voice outputs connect here. Replaces engine.masterGain. */
  input: GainNode | undefined;

  /** Exposed for reverb wet path. */
  envelopeGain: GainNode | undefined;

  get isMuffled(): boolean {
    return this._muffled;
  }

  private _compressor: DynamicsCompressorNode | undefined;
  private _analyser: AnalyserNode | undefined;
  private _analyserBuf: Float32Array<ArrayBuffer> | undefined;
  private _eqLow: BiquadFilterNode | undefined;
  private _eqMid: BiquadFilterNode | undefined;
  private _eqHigh: BiquadFilterNode | undefined;
  private _saturationShaper: WaveShaperNode | undefined;
  private _saturationDry: GainNode | undefined;
  private _saturationWet: GainNode | undefined;
  private _exciterShaper: WaveShaperNode | undefined;
  private _exciterHP: BiquadFilterNode | undefined;
  private _exciterDry: GainNode | undefined;
  private _exciterWet: GainNode | undefined;
  private _combDelay: DelayNode | undefined;
  private _combFeedback: GainNode | undefined;
  private _combDry: GainNode | undefined;
  private _combWet: GainNode | undefined;
  private _muffleFilter: BiquadFilterNode | undefined;
  private _muffled: boolean = false;
  private _reverbConvolver: ConvolverNode | undefined;
  private _reverbWet: GainNode | undefined;
  private _reverbPreDelayNode: DelayNode | undefined;
  private _appliedIR: string | undefined;
  private _appliedReverbPreDelay: number = 0;

  /**
   * Build the full master signal chain.
   *
   * After build(), voice outputs should connect to `this.input`.
   * Call setReverb() afterwards if reverb is needed.
   */
  build(
    ctx: AudioContext,
    opts?: { streamDest?: MediaStreamAudioDestinationNode; irBuffer?: AudioBuffer },
  ): void {
    // Input gain (master level)
    this.input = new GainNode(ctx, { gain: MASTER_GAIN_VALUE });

    // Envelope gain (ADSR ramp, starts at 0)
    this.envelopeGain = new GainNode(ctx, { gain: 0 });

    // Compressor
    this._compressor = new DynamicsCompressorNode(ctx, {
      threshold: COMP_THRESHOLD,
      knee: COMP_KNEE,
      ratio: COMP_RATIO,
      attack: COMP_ATTACK,
      release: COMP_RELEASE,
    });

    // Analyser for level metering (drives play glow)
    this._analyser = new AnalyserNode(ctx, { fftSize: 256 });
    this._analyserBuf = new Float32Array(this._analyser.fftSize);

    // 3-band EQ
    this._eqLow = new BiquadFilterNode(ctx, {
      type: 'lowshelf',
      frequency: EQ_LOW_FREQ,
      gain: EQ_LOW_GAIN,
    });

    this._eqMid = new BiquadFilterNode(ctx, {
      type: 'peaking',
      frequency: EQ_MID_FREQ,
      gain: EQ_MID_GAIN,
      Q: EQ_MID_Q,
    });

    this._eqHigh = new BiquadFilterNode(ctx, {
      type: 'highshelf',
      frequency: EQ_HIGH_FREQ,
      gain: EQ_HIGH_GAIN,
    });

    // Master effects chain (between envelope and compressor)
    this._buildMasterEffects(ctx);

    // Wire: input → envelopeGain → [saturation → exciter → comb] → compressor → EQ → analyser
    this.input.connect(this.envelopeGain);
    let lastNode: AudioNode = this.envelopeGain;
    lastNode = this._wireMasterEffect(
      ctx,
      lastNode,
      this._saturationDry!,
      this._saturationWet!,
      this._saturationShaper!,
    );
    lastNode = this._wireMasterEffect(
      ctx,
      lastNode,
      this._exciterDry!,
      this._exciterWet!,
      this._exciterShaper!,
    );
    lastNode = this._wireMasterEffect(
      ctx,
      lastNode,
      this._combDry!,
      this._combWet!,
      this._combDelay!,
    );
    lastNode.connect(this._compressor);
    this._compressor.connect(this._eqLow);
    this._eqLow.connect(this._eqMid);
    this._eqMid.connect(this._eqHigh);
    this._eqHigh.connect(this._analyser);

    // Muffle filter: normally transparent (20 kHz), drops to ~600 Hz when muffled
    this._muffleFilter = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: this._muffled ? 600 : 20_000,
      Q: 0.7,
    });
    this._analyser.connect(this._muffleFilter);

    // Route to ctx.destination
    this._muffleFilter.connect(ctx.destination);

    // Also feed stream destination for Safari keep-alive
    if (opts?.streamDest) {
      this._muffleFilter.connect(opts.streamDest);
    }

    // Load reverb IR if provided
    if (opts?.irBuffer) {
      this._storeIRBuffer(opts.irBuffer);
    }
  }

  private _pendingIRBuffer: AudioBuffer | undefined;

  private _storeIRBuffer(buf: AudioBuffer): void {
    this._pendingIRBuffer = buf;
  }

  /**
   * Build or rebuild the reverb chain.
   * Safe to call multiple times — tears down previous reverb first.
   */
  setReverb(ctx: AudioContext, reverb: ReverbConfig, irBuffer?: AudioBuffer): void {
    this._teardownReverb();

    this._appliedIR = reverb.ir;
    this._appliedReverbPreDelay = reverb.reverbPreDelay ?? 0;

    if (!reverb.ir || !this.envelopeGain || !this._compressor) {
      return;
    }

    this._reverbConvolver = new ConvolverNode(ctx);
    this._reverbWet = new GainNode(ctx, { gain: reverb.reverbMix });

    const preDelay = reverb.reverbPreDelay ?? 0;
    if (preDelay > 0) {
      this._reverbPreDelayNode = new DelayNode(ctx, {
        maxDelayTime: 1,
        delayTime: preDelay,
      });
      this.envelopeGain.connect(this._reverbPreDelayNode);
      this._reverbPreDelayNode.connect(this._reverbConvolver);
    } else {
      this.envelopeGain.connect(this._reverbConvolver);
    }

    this._reverbConvolver.connect(this._reverbWet);
    this._reverbWet.connect(this._compressor);

    // Use pre-decoded buffer if provided, otherwise load async
    if (irBuffer) {
      this._reverbConvolver.buffer = irBuffer;
    } else if (this._pendingIRBuffer) {
      this._reverbConvolver.buffer = this._pendingIRBuffer;
      this._pendingIRBuffer = undefined;
    } else {
      const convolver = this._reverbConvolver;
      decodeSample(ctx, reverb.ir)
        .then((buf) => {
          convolver.buffer = buf;
        })
        .catch(() => {});
    }
  }

  /**
   * Sync reverb only if IR or pre-delay changed.
   * Tears down and rebuilds the reverb chain if needed.
   */
  syncReverb(ctx: AudioContext, reverb: ReverbConfig): void {
    const preDelay = reverb.reverbPreDelay ?? 0;
    if (reverb.ir === this._appliedIR && preDelay === this._appliedReverbPreDelay) {
      // Just update the wet gain in-place
      if (this._reverbWet) {
        this._reverbWet.gain.setValueAtTime(reverb.reverbMix, ctx.currentTime);
      }
      return;
    }
    this.setReverb(ctx, reverb);
  }

  /** Schedule ADSR envelope gain ramp from start. */
  scheduleEnvelope(ctx: AudioContext, envelope: Envelope): void {
    if (!this.envelopeGain) {
      return;
    }
    const now = ctx.currentTime;
    const attack = Math.max(0.01, envelope.attack);
    const decay = Math.max(0.01, envelope.decay);
    const sustain = Math.max(0, Math.min(1, envelope.sustain));

    this.envelopeGain.gain.setValueAtTime(0, now);
    this.envelopeGain.gain.linearRampToValueAtTime(1, now + attack);
    this.envelopeGain.gain.linearRampToValueAtTime(sustain, now + attack + decay);
  }

  /** Schedule release ramp from current value to 0. */
  scheduleRelease(ctx: AudioContext, envelope: Envelope): void {
    if (!this.envelopeGain) {
      return;
    }
    const now = ctx.currentTime;
    const releaseTime = Math.max(0.01, envelope.release);

    this.envelopeGain.gain.cancelScheduledValues(now);
    this.envelopeGain.gain.setValueAtTime(this.envelopeGain.gain.value, now);
    this.envelopeGain.gain.linearRampToValueAtTime(0, now + releaseTime);
  }

  /** Seek the envelope gain to a position t in [0, 1] of attack+decay. */
  setEnvelopePosition(ctx: AudioContext, t: number, envelope: Envelope): void {
    if (!this.envelopeGain) {
      return;
    }
    const attack = Math.max(0.01, envelope.attack);
    const decay = Math.max(0.01, envelope.decay);
    const sustain = Math.max(0, Math.min(1, envelope.sustain));
    const totalTime = attack + decay;
    const actualTime = t * totalTime;

    let gain: number;
    if (actualTime <= attack) {
      gain = actualTime / attack;
    } else {
      gain = 1 - ((actualTime - attack) / decay) * (1 - sustain);
    }

    const now = ctx.currentTime;
    this.envelopeGain.gain.cancelScheduledValues(now);
    this.envelopeGain.gain.setValueAtTime(this.envelopeGain.gain.value, now);
    this.envelopeGain.gain.linearRampToValueAtTime(gain, now + 0.05);
  }

  /** Duration of the reverb tail in seconds (IR buffer duration + pre-delay). */
  reverbTailDuration(): number {
    if (!this._reverbConvolver?.buffer) {
      return 0;
    }
    return this._reverbConvolver.buffer.duration + this._appliedReverbPreDelay;
  }

  /** RMS level of the analyser output. Returns 0 before build(). */
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

  /** Apply low-pass muffle (e.g. for credits overlay). */
  muffle(ctx: AudioContext): void {
    this._muffled = true;
    if (this._muffleFilter) {
      const now = ctx.currentTime;
      this._muffleFilter.frequency.cancelScheduledValues(now);
      this._muffleFilter.frequency.setValueAtTime(this._muffleFilter.frequency.value, now);
      this._muffleFilter.frequency.linearRampToValueAtTime(600, now + 0.15);
    }
  }

  /** Remove low-pass muffle. */
  unmuffle(ctx: AudioContext): void {
    this._muffled = false;
    if (this._muffleFilter) {
      const now = ctx.currentTime;
      this._muffleFilter.frequency.cancelScheduledValues(now);
      this._muffleFilter.frequency.setValueAtTime(this._muffleFilter.frequency.value, now);
      this._muffleFilter.frequency.linearRampToValueAtTime(20_000, now + 0.15);
    }
  }

  /** Disconnect and clear all nodes. */
  cleanup(): void {
    if (this.input) {
      safeDisconnect(this.input);
      this.input = undefined;
    }
    if (this.envelopeGain) {
      safeDisconnect(this.envelopeGain);
      this.envelopeGain = undefined;
    }
    if (this._compressor) {
      safeDisconnect(this._compressor);
      this._compressor = undefined;
    }
    if (this._analyser) {
      safeDisconnect(this._analyser);
      this._analyser = undefined;
      this._analyserBuf = undefined;
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
    this._teardownReverb();
    this._cleanupMasterEffects();

    this._appliedIR = undefined;
    this._appliedReverbPreDelay = 0;
    this._pendingIRBuffer = undefined;
  }

  // ---- Private helpers ----

  /** Build the 3 master effect chains: saturation, exciter, comb filter. */
  private _buildMasterEffects(ctx: AudioContext): void {
    // Tape saturation — tanh waveshaper with variable drive
    const satCurve = makeSaturationCurve(Math.max(0.1, SATURATION));
    this._saturationShaper = new WaveShaperNode(ctx, { curve: satCurve, oversample: '2x' });
    this._saturationDry = new GainNode(ctx, { gain: SATURATION > 0 ? 0 : 1 });
    this._saturationWet = new GainNode(ctx, { gain: SATURATION > 0 ? 1 : 0 });
    this._saturationShaper.connect(this._saturationWet);

    // Harmonic exciter — asymmetric waveshaper + high-pass to isolate added harmonics
    const exciteCurve = this._makeExciterCurve();
    this._exciterShaper = new WaveShaperNode(ctx, { curve: exciteCurve, oversample: '2x' });
    this._exciterHP = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 2000, Q: 0.5 });
    this._exciterDry = new GainNode(ctx, { gain: 1 - EXCITE });
    this._exciterWet = new GainNode(ctx, { gain: EXCITE });
    this._exciterShaper.connect(this._exciterHP);
    this._exciterHP.connect(this._exciterWet);

    // Comb filter — delay with negative feedback for spectral notches
    this._combDelay = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: COMB_FREQ });
    this._combFeedback = new GainNode(ctx, { gain: -0.7 });
    this._combDry = new GainNode(ctx, { gain: 1 - COMB_MIX });
    this._combWet = new GainNode(ctx, { gain: COMB_MIX });
    this._combDelay.connect(this._combFeedback);
    this._combFeedback.connect(this._combDelay);
    this._combDelay.connect(this._combWet);
  }

  /**
   * Wire a dry/wet master effect into the chain.
   *
   * Source feeds both the dry path and the effectInput node (which is already
   * wired to the wet GainNode in _buildMasterEffects). Returns the output merge node.
   */
  private _wireMasterEffect(
    ctx: AudioContext,
    source: AudioNode,
    dry: GainNode,
    wet: GainNode,
    effectInput: AudioNode,
  ): GainNode {
    const merge = new GainNode(ctx);
    source.connect(dry);
    dry.connect(merge);
    source.connect(effectInput);
    wet.connect(merge);
    return merge;
  }

  private _makeExciterCurve(): Float32Array {
    const samples = 1024;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = x >= 0 ? Math.tanh(x * 4) : Math.tanh(x * 2) * 0.8;
    }
    return curve;
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
    this._appliedIR = undefined;
    this._appliedReverbPreDelay = 0;
  }

  private _cleanupMasterEffects(): void {
    for (const node of [
      this._saturationShaper,
      this._saturationDry,
      this._saturationWet,
      this._exciterShaper,
      this._exciterHP,
      this._exciterDry,
      this._exciterWet,
      this._combDelay,
      this._combFeedback,
      this._combDry,
      this._combWet,
    ]) {
      if (node) {
        safeDisconnect(node);
      }
    }
    this._saturationShaper = undefined;
    this._saturationDry = undefined;
    this._saturationWet = undefined;
    this._exciterShaper = undefined;
    this._exciterHP = undefined;
    this._exciterDry = undefined;
    this._exciterWet = undefined;
    this._combDelay = undefined;
    this._combFeedback = undefined;
    this._combDry = undefined;
    this._combWet = undefined;
  }
}
