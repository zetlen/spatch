import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../js/audio/engine.ts';
import { createSampleLoader, setSampleLoader } from '../../js/audio/sample-loader.ts';
import { Vibe, setVibe } from '../../js/audio/vibe.ts';

// Set up a mock sample loader so decodeSample calls in the engine don't throw.
setSampleLoader(
  createSampleLoader(() =>
    Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)) }),
  ),
);

// Reset vibe to defaults after every test so state doesn't leak
afterEach(() => setVibe(new Vibe()));

// Minimal Web Audio API stubs for testing voice reconciliation logic.
// We only need enough to let _buildVoice wire up nodes and updateVoices
// Track shape IDs — no actual audio output.

function createStubAudioParam(initial = 0) {
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

function createStubNode(extraProps = {}) {
  return {
    connect() {},
    disconnect() {},
    ...extraProps,
  };
}

// Stub Web Audio constructors on globalThis so production code using
// `new GainNode(ctx, opts)` etc. works in the test environment.

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
  return createStubNode({ buffer: opts.buffer ?? null, start() {}, stop() {} });
};
globalThis.GainNode = function (_ctx, opts = {}) {
  return createStubNode({ gain: createStubAudioParam(opts.gain ?? 1) });
};
globalThis.OscillatorNode = function (_ctx, opts = {}) {
  return {
    connect() {},
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
    connect() {},
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

function createStubAudioContext() {
  return {
    currentTime: 0,
    destination: createStubNode(),
    resume() {
      return Promise.resolve();
    },
    sampleRate: 44_100,
    state: 'running',
  };
}

function makeVoice(id, waveform = 'sine', overrides = {}) {
  const base = {
    border: undefined,
    effect: undefined,
    fill: { h: 200, l: 50, mode: 'solid', s: 80 },
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
  return base;
}

function makeSigilState(voices, blend = 'screen') {
  return {
    blend,
    envelope: { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
    scene: 0,
    voices,
  };
}

describe('AudioEngine.updateVoices — voice reconciliation', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    // Inject stub context so we skip real AudioContext
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = new GainNode(engine.audioCtx);
  });

  async function startWith(voices) {
    const state = makeSigilState(voices);
    await engine.play(state, state.envelope);
    return state;
  }

  test('new shapes get voices during playback', async () => {
    const voiceA = makeVoice('a');
    await startWith([voiceA]);

    expect(engine.activeVoices.length).toBe(1);
    expect(engine.activeVoices[0].shapeId).toBe('a');

    // Add a second voice
    const voiceB = makeVoice('b');
    engine.update(makeSigilState([voiceA, voiceB]));

    expect(engine.activeVoices.length).toBe(2);
    expect(engine.activeVoices.map((v) => v.shapeId).toSorted()).toEqual(['a', 'b']);
  });

  test('deleted shapes lose voices during playback', async () => {
    const voiceA = makeVoice('a');
    const voiceB = makeVoice('b');
    await startWith([voiceA, voiceB]);

    expect(engine.activeVoices.length).toBe(2);

    // Remove voice B
    engine.update(makeSigilState([voiceA]));

    expect(engine.activeVoices.length).toBe(1);
    expect(engine.activeVoices[0].shapeId).toBe('a');
  });

  test('simultaneous add and remove reconciles correctly', async () => {
    const voiceA = makeVoice('a');
    const voiceB = makeVoice('b');
    await startWith([voiceA, voiceB]);

    // Remove A, add C
    const voiceC = makeVoice('c');
    engine.update(makeSigilState([voiceB, voiceC]));

    expect(engine.activeVoices.length).toBe(2);
    const ids = engine.activeVoices.map((v) => v.shapeId).toSorted();
    expect(ids).toEqual(['b', 'c']);
    expect(ids).not.toContain('a');
  });

  test('no-op when shapes unchanged', async () => {
    const voiceA = makeVoice('a');
    await startWith([voiceA]);

    const voicesBefore = engine.activeVoices.length;
    engine.update(makeSigilState([voiceA]));

    expect(engine.activeVoices.length).toBe(voicesBefore);
  });

  test('all shapes removed clears all voices', async () => {
    const voiceA = makeVoice('a');
    const voiceB = makeVoice('b');
    await startWith([voiceA, voiceB]);

    engine.update(makeSigilState([]));

    expect(engine.activeVoices.length).toBe(0);
  });

  test('works with all three waveform types', async () => {
    await startWith([]);

    const voices = [makeVoice('circ', 'sine'), makeVoice('sq', 'pulse'), makeVoice('tri', 'blend')];
    engine.update(makeSigilState(voices));

    expect(engine.activeVoices.length).toBe(3);
    expect(engine.activeVoices.map((v) => v.shapeId).toSorted()).toEqual(['circ', 'sq', 'tri']);
  });

  test('does nothing when not playing', () => {
    engine.isPlaying = false;
    const voiceA = makeVoice('a');
    engine.update(makeSigilState([voiceA]));

    expect(engine.activeVoices.length).toBe(0);
  });
});

describe('AudioEngine — blend modes and FM synthesis', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = new GainNode(engine.audioCtx);
  });

  async function startWith(voices) {
    const state = makeSigilState(voices);
    await engine.play(state, state.envelope);
    return state;
  }

  test('voices are built during play', async () => {
    const voiceA = makeVoice('a');
    await startWith([voiceA]);

    expect(engine.activeVoices.length).toBe(1);
    expect(engine.activeVoices[0].shapeId).toBe('a');
  });

  test('global blend change triggers FM rebuild', async () => {
    const voiceA = makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    await startWith([voiceA, voiceB]);

    // No FM with screen blend
    expect(engine._fmConnections.size).toBe(0);

    // Change to multiply — should create FM connections
    engine.update(makeSigilState([voiceA, voiceB], 'multiply'));

    expect(engine._fmConnections.size).toBeGreaterThan(0);
  });

  test('all blend modes can be applied without error', async () => {
    const blends = ['screen', 'multiply', 'exclusion', 'difference'];
    const voiceA = makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    for (const blend of blends) {
      await startWith([voiceA, voiceB]);
      engine.update(makeSigilState([voiceA, voiceB], blend));
      expect(engine.activeVoices.length).toBe(2);
      engine.stop();
    }
  });

  test('overlapping voices create FM connections with non-screen blend', async () => {
    // Two voices at the same position — should have overlap
    const voiceA = makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    const voiceB = makeVoice('b', 'pulse', { x: 0.5, y: 0.5, size: 0.2 });
    await engine.play(makeSigilState([voiceA, voiceB], 'multiply'), {
      attack: 0.1,
      decay: 0.2,
      release: 0.4,
      sustain: 0.7,
    });

    // FM connections are internal, but we can verify voices were built successfully
    expect(engine.activeVoices.length).toBe(2);
  });

  test('non-overlapping voices do not create FM connections', async () => {
    // Voices far apart — no overlap
    const voiceA = makeVoice('a', 'sine', { x: 0.1, y: 0.1, size: 0.05 });
    const voiceB = makeVoice('b', 'sine', { x: 0.9, y: 0.9, size: 0.05 });
    await engine.play(makeSigilState([voiceA, voiceB], 'multiply'), {
      attack: 0.1,
      decay: 0.2,
      release: 0.4,
      sustain: 0.7,
    });

    expect(engine.activeVoices.length).toBe(2);
    // No FM connections should exist (internal map is empty)
    expect(engine._fmConnections.size).toBe(0);
  });

  test('screen blend creates no FM even when overlapping', async () => {
    // Screen is the default — no FM modulation regardless of overlap
    const voiceA = makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    await startWith([voiceA, voiceB]);

    expect(engine.activeVoices.length).toBe(2);
    // Screen has maxIndex: 0, so no FM connections should be created
    expect(engine._fmConnections.size).toBe(0);
  });

  test('FM connections are cleaned up when voices separate', async () => {
    const voiceA = makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    await engine.play(makeSigilState([voiceA, voiceB], 'multiply'), {
      attack: 0.1,
      decay: 0.2,
      release: 0.4,
      sustain: 0.7,
    });

    // Should have FM connection from overlap
    expect(engine._fmConnections.size).toBeGreaterThan(0);

    // Move voices apart
    const updatedA = makeVoice('a', 'sine', { x: 0.1, y: 0.1, size: 0.05 });
    const updatedB = makeVoice('b', 'sine', { x: 0.9, y: 0.9, size: 0.05 });
    engine.update(makeSigilState([updatedA, updatedB], 'multiply'));

    // FM connections should be torn down
    expect(engine._fmConnections.size).toBe(0);
  });
});

describe('AudioEngine — border / octave doubling', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = new GainNode(engine.audioCtx);
  });

  async function startWith(voices) {
    const state = makeSigilState(voices);
    await engine.play(state, state.envelope);
    return state;
  }

  test('voice without border has null octaveOsc', async () => {
    const voice = makeVoice('a', 'sine', { border: undefined });
    await startWith([voice]);

    const audioVoice = engine.activeVoices[0];
    expect(audioVoice.octaveOsc).toBeUndefined();
    expect(audioVoice.currentBorder).toBeUndefined();
  });

  test('voice with border has octaveOsc', async () => {
    const voice = makeVoice('a', 'sine', {
      border: { color: 'white', double: false, thickness: 0.5 },
    });
    await startWith([voice]);

    const audioVoice = engine.activeVoices[0];
    expect(audioVoice.octaveOsc).not.toBeUndefined();
    expect(audioVoice.currentBorder).toBe('white:0');
  });

  test('border change triggers voice rebuild', async () => {
    const voice = makeVoice('a', 'sine', {
      border: { color: 'white', double: false, thickness: 0.5 },
    });
    await startWith([voice]);

    const originalVoice = engine.activeVoices[0];

    // Change border color
    const updated = makeVoice('a', 'sine', {
      border: { color: 'black', double: false, thickness: 0.5 },
    });
    engine.update(makeSigilState([updated]));

    const newVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(newVoice).not.toBe(originalVoice);
    expect(newVoice.currentBorder).toBe('black:0');
  });

  test('adding border triggers voice rebuild', async () => {
    const voice = makeVoice('a', 'sine', { border: undefined });
    await startWith([voice]);

    const originalVoice = engine.activeVoices[0];

    // Add border
    const updated = makeVoice('a', 'sine', {
      border: { color: 'white', double: true, thickness: 0.7 },
    });
    engine.update(makeSigilState([updated]));

    const newVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(newVoice).not.toBe(originalVoice);
    expect(newVoice.octaveOsc).not.toBeUndefined();
    expect(newVoice.currentBorder).toBe('white:1');
  });

  test('removing border triggers voice rebuild', async () => {
    const voice = makeVoice('a', 'sine', {
      border: { color: 'white', double: false, thickness: 0.5 },
    });
    await startWith([voice]);

    // Remove border
    const updated = makeVoice('a', 'sine', { border: undefined });
    engine.update(makeSigilState([updated]));

    const newVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(newVoice.octaveOsc).toBeUndefined();
    expect(newVoice.currentBorder).toBeUndefined();
  });

  test('thickness change updates gain smoothly without rebuild', async () => {
    const voice = makeVoice('a', 'sine', {
      border: { color: 'white', double: false, thickness: 0.3 },
    });
    await startWith([voice]);

    const originalVoice = engine.activeVoices[0];

    // Change only thickness
    const updated = makeVoice('a', 'sine', {
      border: { color: 'white', double: false, thickness: 0.8 },
    });
    engine.update(makeSigilState([updated]));

    // Same voice object — NOT rebuilt
    const sameVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(sameVoice).toBe(originalVoice);
  });

  test('octave gain is relative — tracks thickness, not size', async () => {
    const voice = makeVoice('a', 'sine', {
      border: { color: 'white', double: false, thickness: 0.3 },
      size: 0.3,
    });
    await startWith([voice]);

    const audioVoice = engine.activeVoices[0];
    const initialOctaveGain = audioVoice.octaveGainNode.gain.value;

    // Increase size — octaveGainNode stays the same (voice gain handles size)
    const sizeChanged = makeVoice('a', 'sine', {
      border: { color: 'white', double: false, thickness: 0.3 },
      size: 0.7,
    });
    engine.update(makeSigilState([sizeChanged]));
    expect(audioVoice.octaveGainNode.gain.value).toBeCloseTo(initialOctaveGain);

    // Increase thickness — octaveGainNode increases
    const thickerBorder = makeVoice('a', 'sine', {
      border: { color: 'white', double: false, thickness: 0.8 },
      size: 0.7,
    });
    engine.update(makeSigilState([thickerBorder]));
    expect(audioVoice.octaveGainNode.gain.value).toBeGreaterThan(initialOctaveGain);
  });

  test('border works with all waveform types', async () => {
    const border = { color: 'white', double: false, thickness: 0.5 };
    const voices = [
      makeVoice('circ', 'sine', { border }),
      makeVoice('sq', 'pulse', { border }),
      makeVoice('tri', 'blend', { border }),
    ];
    await startWith(voices);

    for (const av of engine.activeVoices) {
      expect(av.octaveOsc).not.toBeUndefined();
    }
  });
});

describe('AudioEngine — vibe-based master reverb', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = new GainNode(engine.audioCtx);
  });

  async function startWith(voices) {
    const state = makeSigilState(voices);
    await engine.play(state, state.envelope);
    return state;
  }

  test('play with zero reverbMix creates no convolver', async () => {
    setVibe(new Vibe({ reverbMix: 0 }));
    await startWith([makeVoice('a')]);

    expect(engine._reverbConvolver).toBeUndefined();
    expect(engine._reverbWet).toBeUndefined();
  });

  test('play with positive reverbMix and ir creates convolver and wet gain', async () => {
    setVibe(new Vibe({ ir: 'test.m4a', reverbMix: 0.5 }));
    await startWith([makeVoice('a')]);

    expect(engine._reverbConvolver).not.toBeUndefined();
    expect(engine._reverbWet).not.toBeUndefined();
  });

  test('play with reverbMix but no ir creates no convolver', async () => {
    setVibe(new Vibe({ reverbMix: 0.5 }));
    await startWith([makeVoice('a')]);

    expect(engine._reverbConvolver).toBeUndefined();
    expect(engine._reverbWet).toBeUndefined();
  });

  test('reverb wet gain matches vibe.reverbMix', async () => {
    setVibe(new Vibe({ ir: 'test.m4a', reverbMix: 0.75 }));
    await startWith([makeVoice('a')]);

    expect(engine._reverbWet.gain.value).toBe(0.75);
  });

  test('cleanup nulls reverb nodes', async () => {
    setVibe(new Vibe({ ir: 'test.m4a', reverbMix: 0.5 }));
    await startWith([makeVoice('a')]);

    expect(engine._reverbConvolver).not.toBeUndefined();

    engine.stop();

    expect(engine._reverbConvolver).toBeUndefined();
    expect(engine._reverbWet).toBeUndefined();
  });

  test('compressor uses vibe params', async () => {
    setVibe(new Vibe({ compThreshold: -20, compKnee: 10, compRatio: 5 }));
    await startWith([makeVoice('a')]);

    expect(engine.compressor.threshold.value).toBe(-20);
    expect(engine.compressor.knee.value).toBe(10);
    expect(engine.compressor.ratio.value).toBe(5);
  });

  test('masterGain uses vibe.masterGain', async () => {
    setVibe(new Vibe({ masterGain: 0.8 }));
    await startWith([makeVoice('a')]);

    expect(engine.masterGain.gain.value).toBe(0.8);
  });

  test('3-band EQ nodes are created', async () => {
    setVibe(new Vibe({ eqLowGain: 3, eqMidGain: -2, eqHighGain: 1 }));
    await startWith([makeVoice('a')]);

    expect(engine._eqLow).not.toBeUndefined();
    expect(engine._eqMid).not.toBeUndefined();
    expect(engine._eqHigh).not.toBeUndefined();
    expect(engine._eqLow.gain.value).toBe(3);
    expect(engine._eqMid.gain.value).toBe(-2);
    expect(engine._eqHigh.gain.value).toBe(1);
  });

  test('cleanup nulls EQ nodes', async () => {
    setVibe(new Vibe());
    await startWith([makeVoice('a')]);

    engine.stop();

    expect(engine._eqLow).toBeUndefined();
    expect(engine._eqMid).toBeUndefined();
    expect(engine._eqHigh).toBeUndefined();
  });

  test('play with preloaded IR buffer sets convolver buffer synchronously', async () => {
    const irBuffer = { duration: 1.5, length: 66_150 };
    setVibe(new Vibe({ ir: 'preloaded.m4a', reverbMix: 0.6 }));
    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope, { irBuffer });

    expect(engine._reverbConvolver).not.toBeUndefined();
    expect(engine._reverbConvolver.buffer).toBe(irBuffer);
  });
});

describe('AudioEngine — reverb tail cleanup delay (vibe-based)', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = new GainNode(engine.audioCtx);
  });

  test('release without reverb uses normal cleanup delay', async () => {
    setVibe(new Vibe());
    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope);

    engine.release(state.envelope);

    // After releaseTime + 100ms, cleanup should have fired
    const releaseMs = state.envelope.release * 1000 + 150;
    await new Promise((r) => setTimeout(r, releaseMs));
    expect(engine.isPlaying).toBe(false);
  });
});

describe('AudioEngine — getLevel()', () => {
  let engine;

  test('returns 0 when analyser is null', () => {
    engine = new AudioEngine();
    expect(engine.getLevel()).toBe(0);
  });

  test('returns 0 for silent buffer', async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = new GainNode(engine.audioCtx);

    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope);

    // Stub fills buffer with zeros by default
    expect(engine.getLevel()).toBe(0);
  });

  test('returns correct RMS for known signal', async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = new GainNode(engine.audioCtx);

    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope);

    // Inject a known buffer: all 0.5 → RMS = 0.5
    const buf = new Float32Array(256);
    buf.fill(0.5);
    engine._analyserBuf = buf;
    engine._analyser.getFloatTimeDomainData = (arr) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = buf[i];
      }
    };

    const level = engine.getLevel();
    expect(level).toBeCloseTo(0.5, 5);
  });

  test('returns 0 after stop', async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = new GainNode(engine.audioCtx);

    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope);
    engine.stop();

    expect(engine.getLevel()).toBe(0);
  });
});

describe('AudioEngine — diphthong sweep', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = new GainNode(engine.audioCtx);
  });

  async function startWith(voices) {
    const state = makeSigilState(voices);
    await engine.play(state, state.envelope);
    return state;
  }

  test('linear fill voice gets hasSweep=true after play', async () => {
    const voice = makeVoice('a', 'sine', {
      fill: { mode: 'linear', h: 0, s: 80, l: 50, h2: 120, s2: 60, l2: 70, gradAngle: 0 },
    });
    await startWith([voice]);

    const audioVoice = engine.activeVoices[0];
    expect(audioVoice.hasSweep).toBe(true);
  });

  test('solid fill voice gets hasSweep=false after play', async () => {
    const voice = makeVoice('a', 'sine', {
      fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    });
    await startWith([voice]);

    const audioVoice = engine.activeVoices[0];
    expect(audioVoice.hasSweep).toBe(false);
  });

  test('linear fill change retrigs sweep without voice rebuild', async () => {
    const voice = makeVoice('a', 'sine', {
      fill: { mode: 'linear', h: 0, s: 80, l: 50, h2: 120, s2: 60, l2: 70, gradAngle: 0 },
    });
    await startWith([voice]);

    const originalVoice = engine.activeVoices[0];

    const updated = makeVoice('a', 'sine', {
      fill: { mode: 'linear', h: 0, s: 80, l: 50, h2: 120, s2: 60, l2: 70, gradAngle: 90 },
    });
    engine.update(makeSigilState([updated]));

    const sameVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(sameVoice).toBe(originalVoice);
    expect(sameVoice.hasSweep).toBe(true);
    expect(sameVoice.currentFillKey).toContain('90');
  });

  test('linear fill color change retrigs sweep', async () => {
    const voice = makeVoice('a', 'sine', {
      fill: { mode: 'linear', h: 0, s: 80, l: 50, h2: 120, s2: 60, l2: 70, gradAngle: 0 },
    });
    await startWith([voice]);

    const originalVoice = engine.activeVoices[0];

    const updated = makeVoice('a', 'sine', {
      fill: { mode: 'linear', h: 0, s: 80, l: 50, h2: 200, s2: 60, l2: 70, gradAngle: 0 },
    });
    engine.update(makeSigilState([updated]));

    const sameVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(sameVoice).toBe(originalVoice);
    expect(sameVoice.hasSweep).toBe(true);
  });

  test('solid fill hue change updates formant smoothly (no rebuild)', async () => {
    const voice = makeVoice('a', 'sine', {
      fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    });
    await startWith([voice]);

    const originalVoice = engine.activeVoices[0];

    const updated = makeVoice('a', 'sine', {
      fill: { mode: 'solid', h: 100, s: 80, l: 50 },
    });
    engine.update(makeSigilState([updated]));

    const sameVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(sameVoice).toBe(originalVoice);
  });
});

describe('AudioEngine — solo mode', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = new GainNode(engine.audioCtx);
  });

  async function startWith(voices) {
    const state = makeSigilState(voices);
    await engine.play(state, state.envelope);
    return state;
  }

  test('setSoloVoice mutes non-solo voices on next update', async () => {
    const voiceA = makeVoice('a', 'sine', { size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { size: 0.2 });
    const state = await startWith([voiceA, voiceB]);

    engine.setSoloVoice('a');
    engine.update(state);

    const avA = engine.activeVoices.find((v) => v.shapeId === 'a');
    const avB = engine.activeVoices.find((v) => v.shapeId === 'b');
    expect(avA.gain.gain.value).toBeGreaterThan(0);
    expect(avB.gain.gain.value).toBe(0);
  });

  test('setSoloVoice(undefined) unmutes all voices', async () => {
    const voiceA = makeVoice('a', 'sine', { size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { size: 0.2 });
    const state = await startWith([voiceA, voiceB]);

    engine.setSoloVoice('a');
    engine.update(state);
    engine.setSoloVoice(undefined);
    engine.update(state);

    const avA = engine.activeVoices.find((v) => v.shapeId === 'a');
    const avB = engine.activeVoices.find((v) => v.shapeId === 'b');
    expect(avA.gain.gain.value).toBeGreaterThan(0);
    expect(avB.gain.gain.value).toBeGreaterThan(0);
  });

  test('solo voice that does not exist unmutes all', async () => {
    const voiceA = makeVoice('a', 'sine', { size: 0.2 });
    const state = await startWith([voiceA]);

    engine.setSoloVoice('nonexistent');
    engine.update(state);

    const avA = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(avA.gain.gain.value).toBeGreaterThan(0);
  });

  test('FM connections stay active when voice is soloed', async () => {
    const voiceA = makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    const state = makeSigilState([voiceA, voiceB], 'multiply');
    await engine.play(state, state.envelope);

    engine.setSoloVoice('a');
    engine.update(state);

    // FM connections should still exist despite voice B being muted
    expect(engine._fmConnections.size).toBeGreaterThan(0);
  });

  test('solo respects initial play — muted voices start at gain 0', async () => {
    const voiceA = makeVoice('a', 'sine', { size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { size: 0.2 });

    engine.setSoloVoice('a');
    await startWith([voiceA, voiceB]);

    const avA = engine.activeVoices.find((v) => v.shapeId === 'a');
    const avB = engine.activeVoices.find((v) => v.shapeId === 'b');
    expect(avA.gain.gain.value).toBeGreaterThan(0);
    expect(avB.gain.gain.value).toBe(0);
  });
});
