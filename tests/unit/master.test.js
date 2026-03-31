import { afterEach, describe, expect, test } from 'bun:test';
import { createSampleLoader, setSampleLoader } from '../../js/audio/sample-loader.ts';
import { Master } from '../../js/audio/master.ts';

// Set up a mock sample loader so decodeSample calls don't throw.
setSampleLoader(
  createSampleLoader(() =>
    Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)) }),
  ),
);

// ---- Web Audio API stubs ----

function createStubAudioParam(initial = 0) {
  return {
    value: initial,
    setValueAtTime(v) {
      this.value = v;
    },
    linearRampToValueAtTime(v) {
      this.value = v;
    },
    cancelScheduledValues() {},
    setValueCurveAtTime() {},
  };
}

function createStubNode(extra = {}) {
  return { connect() {}, disconnect() {}, ...extra };
}

globalThis.GainNode = function (_ctx, opts = {}) {
  return createStubNode({ gain: createStubAudioParam(opts.gain ?? 1) });
};

globalThis.DynamicsCompressorNode = function (_ctx, opts = {}) {
  return createStubNode({
    threshold: createStubAudioParam(opts.threshold ?? -24),
    knee: createStubAudioParam(opts.knee ?? 30),
    ratio: createStubAudioParam(opts.ratio ?? 12),
    attack: createStubAudioParam(opts.attack ?? 0.003),
    release: createStubAudioParam(opts.release ?? 0.25),
  });
};

globalThis.BiquadFilterNode = function (_ctx, opts = {}) {
  return createStubNode({
    type: opts.type ?? 'lowpass',
    frequency: createStubAudioParam(opts.frequency ?? 350),
    gain: createStubAudioParam(opts.gain ?? 0),
    Q: createStubAudioParam(opts.Q ?? 1),
  });
};

globalThis.WaveShaperNode = function (_ctx, opts = {}) {
  return createStubNode({
    curve: opts.curve ?? null,
    oversample: opts.oversample ?? 'none',
  });
};

globalThis.DelayNode = function (_ctx, opts = {}) {
  return createStubNode({
    delayTime: createStubAudioParam(opts.delayTime ?? 0),
  });
};

globalThis.ConvolverNode = function (_ctx) {
  return createStubNode({ buffer: undefined });
};

globalThis.AnalyserNode = function (_ctx, opts = {}) {
  return createStubNode({
    fftSize: opts.fftSize ?? 256,
    getFloatTimeDomainData(arr) {
      // Fill with zeros to simulate silence
      arr.fill(0);
    },
  });
};

globalThis.MediaStreamAudioDestinationNode = function (_ctx) {
  return createStubNode({
    stream: {
      getTracks() {
        return [];
      },
    },
  });
};

// ---- Stub AudioContext ----

function createStubAudioContext() {
  return {
    currentTime: 0,
    destination: createStubNode(),
    sampleRate: 44_100,
    state: 'running',
    resume() {
      return Promise.resolve();
    },
    decodeAudioData() {
      return Promise.resolve({
        duration: 2,
        numberOfChannels: 1,
        sampleRate: 44_100,
        length: 88_200,
        getChannelData() {
          return new Float32Array(88_200);
        },
      });
    },
  };
}

// ---- Tests ----

describe('Master', () => {
  afterEach(() => {
    // No global state to reset
  });

  test('getLevel() returns 0 before build()', () => {
    const master = new Master();
    expect(master.getLevel()).toBe(0);
  });

  test('build() creates input and envelopeGain nodes', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    master.build(ctx);
    expect(master.input).toBeDefined();
    expect(master.envelopeGain).toBeDefined();
  });

  test('getLevel() returns 0 after build with silence', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    master.build(ctx);
    // Analyser stub fills with zeros, so RMS is 0
    expect(master.getLevel()).toBe(0);
  });

  test('isMuffled is false initially', () => {
    const master = new Master();
    expect(master.isMuffled).toBe(false);
  });

  test('muffle() sets isMuffled to true', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    master.build(ctx);
    master.muffle(ctx);
    expect(master.isMuffled).toBe(true);
  });

  test('unmuffle() sets isMuffled to false', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    master.build(ctx);
    master.muffle(ctx);
    master.unmuffle(ctx);
    expect(master.isMuffled).toBe(false);
  });

  test('setReverb() does not throw without an IR', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    master.build(ctx);
    expect(() => {
      master.setReverb(ctx, { ir: '', reverbMix: 0.5 });
    }).not.toThrow();
  });

  test('setReverb() does not throw with an IR string', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    master.build(ctx);
    expect(() => {
      master.setReverb(ctx, { ir: 'test.m4a', reverbMix: 0.7, reverbPreDelay: 0.05 });
    }).not.toThrow();
  });

  test('syncReverb() does not throw', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    master.build(ctx);
    master.setReverb(ctx, { ir: 'test.m4a', reverbMix: 0.5 });
    expect(() => {
      master.syncReverb(ctx, { ir: 'test.m4a', reverbMix: 0.6 });
    }).not.toThrow();
  });

  test('scheduleEnvelope() does not throw', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    master.build(ctx);
    const envelope = { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 };
    expect(() => {
      master.scheduleEnvelope(ctx, envelope);
    }).not.toThrow();
  });

  test('scheduleRelease() does not throw', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    master.build(ctx);
    const envelope = { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 };
    expect(() => {
      master.scheduleRelease(ctx, envelope);
    }).not.toThrow();
  });

  test('setEnvelopePosition() does not throw', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    master.build(ctx);
    const envelope = { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 };
    expect(() => {
      master.setEnvelopePosition(ctx, 0.5, envelope);
    }).not.toThrow();
  });

  test('reverbTailDuration() returns 0 when no reverb built', () => {
    const master = new Master();
    expect(master.reverbTailDuration()).toBe(0);
  });

  test('cleanup() clears input and envelopeGain', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    master.build(ctx);
    master.cleanup();
    expect(master.input).toBeUndefined();
    expect(master.envelopeGain).toBeUndefined();
  });

  test('cleanup() is safe to call before build()', () => {
    const master = new Master();
    expect(() => {
      master.cleanup();
    }).not.toThrow();
  });

  test('cleanup() is safe to call twice', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    master.build(ctx);
    master.cleanup();
    expect(() => {
      master.cleanup();
    }).not.toThrow();
  });

  test('build() with streamDest does not throw', () => {
    const master = new Master();
    const ctx = createStubAudioContext();
    const streamDest = new MediaStreamAudioDestinationNode(ctx);
    expect(() => {
      master.build(ctx, { streamDest });
    }).not.toThrow();
  });
});
