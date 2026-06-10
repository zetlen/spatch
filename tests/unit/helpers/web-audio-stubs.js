// Web-audio-stubs.js — Minimal Web Audio API stubs for unit-testing audio code.
//
// Importing this module stubs the Web Audio constructors on globalThis so
// production code using `new GainNode(ctx, opts)` etc. works in the test
// environment, and installs a mock sample loader so decodeSample calls don't
// throw. Only enough surface to let voice graphs wire up and track parameter
// values — no actual audio output.

import { createSampleLoader, setSampleLoader } from '../../../js/audio/sample-loader.ts';

setSampleLoader(
  createSampleLoader(() =>
    Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)) }),
  ),
);

/** Default reverb config for tests: no reverb. */
export const TEST_REVERB = { ir: '', reverbMix: 0 };

export function createStubAudioParam(initial = 0) {
  return {
    cancelScheduledValues() {},
    linearRampToValueAtTime() {},
    setValueAtTime(v) {
      this.value = v;
    },
    setValueCurveAtTime() {},
    value: initial,
  };
}

export function createStubNode(extraProps = {}) {
  return {
    connect(target) {
      return target;
    },
    disconnect() {},
    ...extraProps,
  };
}

function stubAudioBuffer(opts = {}) {
  const channels = opts.numberOfChannels ?? 1;
  const length = opts.length ?? 1;
  const sampleRate = opts.sampleRate ?? 44_100;
  const channelData = [];
  for (let i = 0; i < channels; i++) {
    channelData.push(new Float32Array(length));
  }
  return {
    duration: length / sampleRate,
    getChannelData(ch) {
      return channelData[ch];
    },
    length,
    numberOfChannels: channels,
    sampleRate,
  };
}

globalThis.AudioBuffer = function (opts) {
  return stubAudioBuffer(opts);
};
globalThis.AudioBufferSourceNode = function (_ctx, opts = {}) {
  return createStubNode({
    buffer: opts.buffer ?? null,
    playbackRate: createStubAudioParam(opts.playbackRate ?? 1),
    start() {},
    stop() {},
  });
};
globalThis.GainNode = function (_ctx, opts = {}) {
  return createStubNode({ gain: createStubAudioParam(opts.gain ?? 1) });
};
globalThis.OscillatorNode = function (_ctx, opts = {}) {
  return {
    connect(target) {
      return target;
    },
    detune: createStubAudioParam(0),
    disconnect() {},
    frequency: createStubAudioParam(opts.frequency ?? 440),
    start() {},
    stop() {},
    type: opts.type ?? 'sine',
  };
};
globalThis.BiquadFilterNode = function (_ctx, opts = {}) {
  return createStubNode({
    Q: createStubAudioParam(opts.Q ?? 1),
    frequency: createStubAudioParam(opts.frequency ?? 350),
    gain: createStubAudioParam(opts.gain ?? 0),
    type: opts.type ?? 'lowpass',
  });
};
globalThis.DynamicsCompressorNode = function (_ctx, opts = {}) {
  return createStubNode({
    attack: createStubAudioParam(opts.attack ?? 0.003),
    knee: createStubAudioParam(opts.knee ?? 30),
    ratio: createStubAudioParam(opts.ratio ?? 12),
    release: createStubAudioParam(opts.release ?? 0.25),
    threshold: createStubAudioParam(opts.threshold ?? -24),
  });
};
globalThis.StereoPannerNode = function (_ctx, opts = {}) {
  return createStubNode({ pan: createStubAudioParam(opts.pan ?? 0) });
};
globalThis.WaveShaperNode = function (_ctx, opts = {}) {
  return createStubNode({ curve: opts.curve ?? null, oversample: opts.oversample ?? 'none' });
};
globalThis.DelayNode = function (_ctx, opts = {}) {
  return createStubNode({ delayTime: createStubAudioParam(opts.delayTime ?? 0) });
};
globalThis.ConstantSourceNode = function (_ctx, opts = {}) {
  return {
    connect(target) {
      return target;
    },
    disconnect() {},
    offset: createStubAudioParam(opts.offset ?? 0),
    start() {},
    stop() {},
  };
};
globalThis.ConvolverNode = function (_ctx) {
  return createStubNode({ buffer: undefined });
};
globalThis.AnalyserNode = function (_ctx, opts = {}) {
  return createStubNode({
    fftSize: opts.fftSize ?? 256,
    getFloatTimeDomainData() {},
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

export function createStubAudioContext() {
  return {
    createBuffer(numberOfChannels, length, sampleRate) {
      return stubAudioBuffer({ length, numberOfChannels, sampleRate });
    },
    currentTime: 0,
    destination: createStubNode(),
    resume() {
      return Promise.resolve();
    },
    sampleRate: 44_100,
    state: 'running',
  };
}

export function makeVoice(id, waveform = 'sine', overrides = {}) {
  const base = {
    border: undefined,
    effect: undefined,
    fill: { h: 200, c: 0.2, l: 0.5, mode: 'solid' },
    id,
    size: 0.12,
    waveform,
    x: 0.5,
    y: 0.5,
    ...overrides,
  };
  if (waveform === 'pulse' || waveform === 'blend') {
    base.timbre = overrides.timbre ?? 0;
  }
  if (waveform === 'stamp') {
    base.stamp = overrides.stamp ?? 0;
    base.trigger = overrides.trigger ?? 1;
  }
  return base;
}

export function makeSigilState(voices, blend = 'screen') {
  return {
    blend,
    envelope: { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
    scene: 0,
    voices,
  };
}
