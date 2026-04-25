import { beforeEach, describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../js/audio/engine.ts';
import { createSampleLoader, setSampleLoader } from '../../js/audio/sample-loader.ts';

// Set up a mock sample loader so decodeSample calls in the engine don't throw.
setSampleLoader(
  createSampleLoader(() =>
    Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)) }),
  ),
);

/** Default reverb config for tests: no reverb. */
const TEST_REVERB = { ir: '', reverbMix: 0 };

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
  });

  async function startWith(voices) {
    const state = makeSigilState(voices);
    await engine.play(state, state.envelope, TEST_REVERB);
    return state;
  }

  test('new shapes get voices during playback', async () => {
    const voiceA = makeVoice('a');
    await startWith([voiceA]);

    expect(engine.activeVoices.length).toBe(1);
    expect(engine.activeVoices[0].shapeId).toBe('a');

    // Add a second voice
    const voiceB = makeVoice('b');
    engine.update(makeSigilState([voiceA, voiceB]), TEST_REVERB);

    expect(engine.activeVoices.length).toBe(2);
    expect(engine.activeVoices.map((v) => v.shapeId).toSorted()).toEqual(['a', 'b']);
  });

  test('deleted shapes lose voices during playback', async () => {
    const voiceA = makeVoice('a');
    const voiceB = makeVoice('b');
    await startWith([voiceA, voiceB]);

    expect(engine.activeVoices.length).toBe(2);

    // Remove voice B
    engine.update(makeSigilState([voiceA]), TEST_REVERB);

    expect(engine.activeVoices.length).toBe(1);
    expect(engine.activeVoices[0].shapeId).toBe('a');
  });

  test('simultaneous add and remove reconciles correctly', async () => {
    const voiceA = makeVoice('a');
    const voiceB = makeVoice('b');
    await startWith([voiceA, voiceB]);

    // Remove A, add C
    const voiceC = makeVoice('c');
    engine.update(makeSigilState([voiceB, voiceC]), TEST_REVERB);

    expect(engine.activeVoices.length).toBe(2);
    const ids = engine.activeVoices.map((v) => v.shapeId).toSorted();
    expect(ids).toEqual(['b', 'c']);
    expect(ids).not.toContain('a');
  });

  test('no-op when shapes unchanged', async () => {
    const voiceA = makeVoice('a');
    await startWith([voiceA]);

    const voicesBefore = engine.activeVoices.length;
    engine.update(makeSigilState([voiceA]), TEST_REVERB);

    expect(engine.activeVoices.length).toBe(voicesBefore);
  });

  test('all shapes removed clears all voices', async () => {
    const voiceA = makeVoice('a');
    const voiceB = makeVoice('b');
    await startWith([voiceA, voiceB]);

    engine.update(makeSigilState([]), TEST_REVERB);

    expect(engine.activeVoices.length).toBe(0);
  });

  test('works with all three waveform types', async () => {
    await startWith([]);

    const voices = [makeVoice('circ', 'sine'), makeVoice('sq', 'pulse'), makeVoice('tri', 'blend')];
    engine.update(makeSigilState(voices), TEST_REVERB);

    expect(engine.activeVoices.length).toBe(3);
    expect(engine.activeVoices.map((v) => v.shapeId).toSorted()).toEqual(['circ', 'sq', 'tri']);
  });

  test('does nothing when not playing', () => {
    engine.isPlaying = false;
    const voiceA = makeVoice('a');
    engine.update(makeSigilState([voiceA]), TEST_REVERB);

    expect(engine.activeVoices.length).toBe(0);
  });
});

describe('AudioEngine — blend modes and FM synthesis', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
  });

  async function startWith(voices, blend = 'screen') {
    const state = makeSigilState(voices, blend);
    await engine.play(state, state.envelope, TEST_REVERB);
    return state;
  }

  test('voices are built during play', async () => {
    await startWith([makeVoice('a')]);
    expect(engine.activeVoices.length).toBe(1);
    expect(engine.activeVoices[0].shapeId).toBe('a');
  });

  test('global blend change triggers cross-connection rebuild', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    await startWith(voices);
    expect(engine._crossConnections.size).toBe(0);

    engine.update(makeSigilState(voices, 'multiply'), TEST_REVERB);
    expect(engine._crossConnections.size).toBeGreaterThan(0);
  });

  test('all blend modes can be applied without error', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    for (const blend of ['screen', 'multiply', 'exclusion', 'difference']) {
      await startWith(voices);
      engine.update(makeSigilState(voices, blend), TEST_REVERB);
      expect(engine.activeVoices.length).toBe(2);
      engine.stop();
    }
  });

  test('each blend mode creates the correct connection type', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    for (const [blend, expectedType] of [
      ['multiply', 'fm'],
      ['exclusion', 'ring'],
      ['difference', 'rawfm'],
    ]) {
      await startWith(voices, blend);
      expect(engine._crossConnections.size).toBe(1);
      expect([...engine._crossConnections.values()][0].type).toBe(expectedType);
      engine.stop();
    }
  });

  test('non-overlapping voices have dormant cross-connections (zero gains)', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.1, y: 0.1, size: 0.05 }),
      makeVoice('b', 'sine', { x: 0.9, y: 0.9, size: 0.05 }),
    ];
    await startWith(voices, 'multiply');
    expect(engine._crossConnections.size).toBe(1);
    const conn = [...engine._crossConnections.values()][0];
    expect(conn.type).toBe('fm');
    expect(conn.aToB.depthGain.gain.value).toBe(0);
    expect(conn.bToA.depthGain.gain.value).toBe(0);
  });

  test('screen blend creates no cross-connections even when overlapping', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    await startWith(voices);
    expect(engine._crossConnections.size).toBe(0);
  });

  test('FM connections go dormant when voices separate', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    await startWith(voices, 'multiply');
    const conn = [...engine._crossConnections.values()][0];
    expect(conn.aToB.depthGain.gain.value).toBeGreaterThan(0);

    const moved = [
      makeVoice('a', 'sine', { x: 0.1, y: 0.1, size: 0.05 }),
      makeVoice('b', 'sine', { x: 0.9, y: 0.9, size: 0.05 }),
    ];
    engine.update(makeSigilState(moved, 'multiply'), TEST_REVERB);
    expect(engine._crossConnections.size).toBe(1);
    expect(conn.aToB.depthGain.gain.value).toBe(0);
    expect(conn.bToA.depthGain.gain.value).toBe(0);
  });

  test('ring mod connections go dormant when voices separate', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    await startWith(voices, 'exclusion');
    const conn = [...engine._crossConnections.values()][0];
    expect(conn.pair.shadowAmpAtoB.gain.value).toBeGreaterThan(0);

    const moved = [
      makeVoice('a', 'sine', { x: 0.1, y: 0.1, size: 0.05 }),
      makeVoice('b', 'sine', { x: 0.9, y: 0.9, size: 0.05 }),
    ];
    engine.update(makeSigilState(moved, 'exclusion'), TEST_REVERB);
    expect(engine._crossConnections.size).toBe(1);
    expect(conn.pair.overlapSource.offset.value).toBeCloseTo(0);
    expect(conn.pair.shadowAmpAtoB.gain.value).toBeCloseTo(0);
  });

  test('voices have a sine shadow oscillator that tracks pitch', async () => {
    await startWith([makeVoice('a', 'pulse', { x: 0.5, y: 0.5, size: 0.2 })]);
    const shadow = engine.activeVoices[0].getShadowNode();
    expect(shadow).toBeDefined();
    expect(shadow.type).toBe('sine');
    const origFreq = shadow.frequency.value;

    engine.update(
      makeSigilState([makeVoice('a', 'pulse', { x: 0.5, y: 0.3, size: 0.2 })]),
      TEST_REVERB,
    );
    expect(shadow.frequency.value).not.toBeCloseTo(origFreq, 0);
  });

  test('cross-connection count equals n*(n-1)/2 for all voice pairs', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.1, y: 0.1, size: 0.05 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.05 }),
      makeVoice('c', 'sine', { x: 0.9, y: 0.9, size: 0.05 }),
    ];
    await startWith(voices, 'multiply');
    expect(engine._crossConnections.size).toBe(3);
  });

  test('ring mod uses ConstantSourceNode for base gain reduction', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    await startWith(voices, 'exclusion');
    const conn = [...engine._crossConnections.values()][0];
    expect(conn.pair.overlapSource.offset.value).toBeLessThan(0);
    expect(conn.pair.shadowAmpAtoB.gain.value).toBeGreaterThan(0);
    expect(conn.pair.shadowAmpBtoA.gain.value).toBeGreaterThan(0);
  });

  test('voice add/remove reconciles cross-connections', async () => {
    const [a, b, c] = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('c', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    await startWith([a, b], 'multiply');
    expect(engine._crossConnections.size).toBe(1);

    // Add voice → 3 pairs
    engine.update(makeSigilState([a, b, c], 'multiply'), TEST_REVERB);
    expect(engine._crossConnections.size).toBe(3);

    // Remove voice → 1 pair
    engine.update(makeSigilState([a, b], 'multiply'), TEST_REVERB);
    expect(engine._crossConnections.size).toBe(1);
  });

  test('all voices have outputGain node', async () => {
    await startWith([makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 })]);
    const av = engine.activeVoices[0];
    expect(av.outputGain).toBeDefined();
    expect(av.outputGain.gain.value).toBe(1);
  });

  test('FM is bidirectional: aToB and bToA both active with overlap', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    await startWith(voices, 'multiply');
    const conn = [...engine._crossConnections.values()][0];
    expect(conn.aToB.depthGain.gain.value).toBeGreaterThan(0);
    expect(conn.bToA.depthGain.gain.value).toBeGreaterThan(0);
  });

  test('ring mod offset tracks overlap as -overlap', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    // Full overlap → offset = -1 (pure ring mod)
    await startWith(voices, 'exclusion');
    const conn = [...engine._crossConnections.values()][0];
    expect(conn.pair.overlapSource.offset.value).toBeCloseTo(-1);

    // Move to no overlap → offset = 0 (full dry signal)
    engine.update(
      makeSigilState(
        [
          makeVoice('a', 'sine', { x: 0.1, y: 0.1, size: 0.05 }),
          makeVoice('b', 'sine', { x: 0.9, y: 0.9, size: 0.05 }),
        ],
        'exclusion',
      ),
      TEST_REVERB,
    );
    expect(conn.pair.overlapSource.offset.value).toBeCloseTo(0);
  });

  test('sequential blend mode switches mid-play without stop', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    await startWith(voices, 'multiply');
    expect([...engine._crossConnections.values()][0].type).toBe('fm');

    engine.update(makeSigilState(voices, 'exclusion'), TEST_REVERB);
    expect(engine._crossConnections.size).toBe(1);
    expect([...engine._crossConnections.values()][0].type).toBe('ring');

    engine.update(makeSigilState(voices, 'difference'), TEST_REVERB);
    expect([...engine._crossConnections.values()][0].type).toBe('rawfm');

    engine.update(makeSigilState(voices, 'multiply'), TEST_REVERB);
    expect([...engine._crossConnections.values()][0].type).toBe('fm');

    engine.update(makeSigilState(voices, 'screen'), TEST_REVERB);
    expect(engine._crossConnections.size).toBe(0);

    expect(engine.activeVoices.length).toBe(2);
  });

  test('engine.stop() clears all cross-connections', async () => {
    const voices = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    await startWith(voices, 'multiply');
    expect(engine._crossConnections.size).toBe(1);
    engine.stop();
    expect(engine._crossConnections.size).toBe(0);
  });

  test('rawfm uses voice modulator node, not shadow oscillator', async () => {
    const voices = [
      makeVoice('a', 'pulse', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'pulse', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    await startWith(voices, 'difference');
    const [a, b] = engine.activeVoices;
    // Modulator (the voice's primary oscillator) is distinct from shadow (sine helper)
    expect(a.getModulatorNode()).not.toBe(a.getShadowNode());
    expect(b.getModulatorNode()).not.toBe(b.getShadowNode());

    const conn = [...engine._crossConnections.values()][0];
    expect(conn.type).toBe('rawfm');
    // Lowpass filters are present on the modulator path
    expect(conn.aToB.lowpass).toBeDefined();
    expect(conn.bToA.lowpass).toBeDefined();
  });

  test('shadow oscillator is sine for every waveform type', async () => {
    const voices = [
      makeVoice('s', 'sine', { x: 0.2, y: 0.5, size: 0.1 }),
      makeVoice('p', 'pulse', { x: 0.4, y: 0.5, size: 0.1 }),
      makeVoice('b', 'blend', { x: 0.6, y: 0.5, size: 0.1 }),
    ];
    await startWith(voices);
    for (const av of engine.activeVoices) {
      const shadow = av.getShadowNode();
      expect(shadow).toBeDefined();
      expect(shadow.type).toBe('sine');
      expect(shadow.frequency.value).toBeGreaterThan(0);
    }
  });

  test('removing one voice from a 3-voice cluster preserves remaining pair', async () => {
    const [a, b, c] = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('c', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    await startWith([a, b, c], 'multiply');
    expect(engine._crossConnections.size).toBe(3);
    const acConn = engine._crossConnections.get('a:c');
    expect(acConn).toBeDefined();

    // Remove b → only a:c should remain, and it should be the SAME object
    engine.update(makeSigilState([a, c], 'multiply'), TEST_REVERB);
    expect(engine._crossConnections.size).toBe(1);
    expect(engine._crossConnections.get('a:c')).toBe(acConn);
  });
});

describe('AudioEngine — border / octave doubling', () => {
  let engine;
  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
  });
  async function startWith(voices) {
    const s = makeSigilState(voices);
    await engine.play(s, s.envelope, TEST_REVERB);
  }
  const WB = { color: 'white', double: false, thickness: 0.5 };

  test('border presence/absence sets octaveOsc', async () => {
    await startWith([makeVoice('a', 'sine', { border: undefined })]);
    expect(engine.activeVoices[0].octaveOsc).toBeUndefined();
    expect(engine.activeVoices[0].currentBorder).toBeUndefined();
    engine.stop();
    await startWith([makeVoice('a', 'sine', { border: WB })]);
    expect(engine.activeVoices[0].octaveOsc).not.toBeUndefined();
    expect(engine.activeVoices[0].currentBorder).toBe('white:0');
  });

  test('border change triggers voice rebuild', async () => {
    await startWith([makeVoice('a', 'sine', { border: WB })]);
    const orig = engine.activeVoices[0];
    engine.update(
      makeSigilState([
        makeVoice('a', 'sine', { border: { color: 'black', double: false, thickness: 0.5 } }),
      ]),
      TEST_REVERB,
    );
    const nv = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(nv).not.toBe(orig);
    expect(nv.currentBorder).toBe('black:0');
  });

  test('adding/removing border triggers voice rebuild', async () => {
    await startWith([makeVoice('a', 'sine', { border: undefined })]);
    const orig = engine.activeVoices[0];
    engine.update(
      makeSigilState([
        makeVoice('a', 'sine', { border: { color: 'white', double: true, thickness: 0.7 } }),
      ]),
      TEST_REVERB,
    );
    const added = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(added).not.toBe(orig);
    expect(added.octaveOsc).not.toBeUndefined();
    expect(added.currentBorder).toBe('white:1');
    engine.update(makeSigilState([makeVoice('a', 'sine', { border: undefined })]), TEST_REVERB);
    const removed = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(removed.octaveOsc).toBeUndefined();
  });

  test('thickness change updates gain smoothly without rebuild', async () => {
    await startWith([
      makeVoice('a', 'sine', { border: { color: 'white', double: false, thickness: 0.3 } }),
    ]);
    const orig = engine.activeVoices[0];
    engine.update(
      makeSigilState([
        makeVoice('a', 'sine', { border: { color: 'white', double: false, thickness: 0.8 } }),
      ]),
      TEST_REVERB,
    );
    expect(engine.activeVoices.find((v) => v.shapeId === 'a')).toBe(orig);
  });

  test('octave gain tracks thickness, not size', async () => {
    await startWith([
      makeVoice('a', 'sine', {
        border: { color: 'white', double: false, thickness: 0.3 },
        size: 0.3,
      }),
    ]);
    const av = engine.activeVoices[0];
    const initGain = av.octaveGainNode.gain.value;
    engine.update(
      makeSigilState([
        makeVoice('a', 'sine', {
          border: { color: 'white', double: false, thickness: 0.3 },
          size: 0.7,
        }),
      ]),
      TEST_REVERB,
    );
    expect(av.octaveGainNode.gain.value).toBeCloseTo(initGain);
    engine.update(
      makeSigilState([
        makeVoice('a', 'sine', {
          border: { color: 'white', double: false, thickness: 0.8 },
          size: 0.7,
        }),
      ]),
      TEST_REVERB,
    );
    expect(av.octaveGainNode.gain.value).toBeGreaterThan(initGain);
  });

  test('border works with all waveform types', async () => {
    const border = { color: 'white', double: false, thickness: 0.5 };
    await startWith([
      makeVoice('circ', 'sine', { border }),
      makeVoice('sq', 'pulse', { border }),
      makeVoice('tri', 'blend', { border }),
    ]);
    for (const av of engine.activeVoices) {
      expect(av.octaveOsc).not.toBeUndefined();
    }
  });
});

describe('AudioEngine — master reverb', () => {
  let engine;
  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
  });
  async function startWith(voices, reverb = TEST_REVERB) {
    const s = makeSigilState(voices);
    await engine.play(s, s.envelope, reverb);
    return s;
  }

  test('convolver requires both ir and reverbMix', async () => {
    await startWith([makeVoice('a')], TEST_REVERB);
    expect(engine.master._reverbConvolver).toBeUndefined();
    engine.stop();
    await startWith([makeVoice('a')], { ir: '', reverbMix: 0.5 });
    expect(engine.master._reverbConvolver).toBeUndefined();
    engine.stop();
    await startWith([makeVoice('a')], { ir: 'test.m4a', reverbMix: 0.5 });
    expect(engine.master._reverbConvolver).not.toBeUndefined();
    expect(engine.master._reverbWet).not.toBeUndefined();
  });

  test('reverb wet gain matches reverbMix', async () => {
    await startWith([makeVoice('a')], { ir: 'test.m4a', reverbMix: 0.75 });
    expect(engine.master._reverbWet.gain.value).toBe(0.75);
  });

  test('cleanup nulls reverb and EQ nodes', async () => {
    await startWith([makeVoice('a')], { ir: 'test.m4a', reverbMix: 0.5 });
    expect(engine.master._reverbConvolver).not.toBeUndefined();
    engine.stop();
    expect(engine.master._reverbConvolver).toBeUndefined();
    expect(engine.master._reverbWet).toBeUndefined();
    expect(engine.master._eqLow).toBeUndefined();
  });

  test('master uses fixed compressor and gain params', async () => {
    await startWith([makeVoice('a')]);
    expect(engine.master._compressor.threshold.value).toBe(-10);
    expect(engine.master._compressor.knee.value).toBe(18);
    expect(engine.master._compressor.ratio.value).toBe(3);
    expect(engine.master.input.gain.value).toBe(0.5);
  });

  test('3-band EQ nodes are created with flat response', async () => {
    await startWith([makeVoice('a')]);
    expect(engine.master._eqLow).not.toBeUndefined();
    expect(engine.master._eqLow.gain.value).toBe(0);
    expect(engine.master._eqMid.gain.value).toBe(0);
    expect(engine.master._eqHigh.gain.value).toBe(0);
  });

  test('preloaded IR buffer sets convolver buffer synchronously', async () => {
    const irBuffer = { duration: 1.5, length: 66_150 };
    const s = makeSigilState([makeVoice('a')]);
    await engine.play(s, s.envelope, { ir: 'preloaded.m4a', reverbMix: 0.6 }, { irBuffer });
    expect(engine.master._reverbConvolver).not.toBeUndefined();
    expect(engine.master._reverbConvolver.buffer).toBe(irBuffer);
  });
});

describe('AudioEngine — reverb tail cleanup delay', () => {
  let engine;
  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
  });

  test('release without reverb uses normal cleanup delay', async () => {
    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope, TEST_REVERB);
    engine.release(state.envelope);
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

  test('returns 0 for silent buffer and after stop', async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope, TEST_REVERB);
    expect(engine.getLevel()).toBe(0);
    engine.stop();
    expect(engine.getLevel()).toBe(0);
  });

  test('returns correct RMS for known signal', async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope, TEST_REVERB);
    const buf = new Float32Array(256);
    buf.fill(0.5);
    engine.master._analyserBuf = buf;
    engine.master._analyser.getFloatTimeDomainData = (arr) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = buf[i];
      }
    };
    expect(engine.getLevel()).toBeCloseTo(0.5, 5);
  });
});

describe('AudioEngine — diphthong sweep', () => {
  let engine;
  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
  });
  async function startWith(voices) {
    const s = makeSigilState(voices);
    await engine.play(s, s.envelope, TEST_REVERB);
    return s;
  }
  const LIN = { mode: 'linear', h: 0, c: 0.24, l: 0.5, h2: 120, c2: 0.18, l2: 0.7, gradAngle: 0 };

  test('hasSweep reflects fill mode', async () => {
    await startWith([makeVoice('a', 'sine', { fill: LIN })]);
    expect(engine.activeVoices[0].hasSweep).toBe(true);
    engine.stop();
    await startWith([makeVoice('a', 'sine', { fill: { mode: 'solid', h: 200, c: 0.2, l: 0.5 } })]);
    expect(engine.activeVoices[0].hasSweep).toBe(false);
  });

  test('linear fill change retrigs sweep without voice rebuild', async () => {
    await startWith([makeVoice('a', 'sine', { fill: LIN })]);
    const orig = engine.activeVoices[0];
    engine.update(
      makeSigilState([makeVoice('a', 'sine', { fill: { ...LIN, gradAngle: 90 } })]),
      TEST_REVERB,
    );
    const same = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(same).toBe(orig);
    expect(same.hasSweep).toBe(true);
    expect(same.currentFillKey).toContain('90');
  });

  test('linear fill color change retrigs sweep', async () => {
    await startWith([makeVoice('a', 'sine', { fill: LIN })]);
    const orig = engine.activeVoices[0];
    engine.update(
      makeSigilState([makeVoice('a', 'sine', { fill: { ...LIN, h2: 200 } })]),
      TEST_REVERB,
    );
    expect(engine.activeVoices.find((v) => v.shapeId === 'a')).toBe(orig);
  });

  test('solid fill hue change updates filter smoothly (no rebuild)', async () => {
    await startWith([makeVoice('a', 'sine', { fill: { mode: 'solid', h: 200, c: 0.2, l: 0.5 } })]);
    const orig = engine.activeVoices[0];
    engine.update(
      makeSigilState([makeVoice('a', 'sine', { fill: { mode: 'solid', h: 100, c: 0.2, l: 0.5 } })]),
      TEST_REVERB,
    );
    expect(engine.activeVoices.find((v) => v.shapeId === 'a')).toBe(orig);
  });
});

describe('AudioEngine — solo mode', () => {
  let engine;
  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
  });
  async function startWith(voices) {
    const s = makeSigilState(voices);
    await engine.play(s, s.envelope, TEST_REVERB);
    return s;
  }

  test('setSoloVoice mutes non-solo voices on next update', async () => {
    const [a, b] = [makeVoice('a', 'sine', { size: 0.2 }), makeVoice('b', 'sine', { size: 0.2 })];
    const state = await startWith([a, b]);
    engine.setSoloVoice('a');
    engine.update(state, TEST_REVERB);
    expect(engine.activeVoices.find((v) => v.shapeId === 'a').gain.gain.value).toBeGreaterThan(0);
    expect(engine.activeVoices.find((v) => v.shapeId === 'b').gain.gain.value).toBe(0);
  });

  test('setSoloVoice(undefined) unmutes all voices', async () => {
    const [a, b] = [makeVoice('a', 'sine', { size: 0.2 }), makeVoice('b', 'sine', { size: 0.2 })];
    const state = await startWith([a, b]);
    engine.setSoloVoice('a');
    engine.update(state, TEST_REVERB);
    engine.setSoloVoice(undefined);
    engine.update(state, TEST_REVERB);
    expect(engine.activeVoices.find((v) => v.shapeId === 'a').gain.gain.value).toBeGreaterThan(0);
    expect(engine.activeVoices.find((v) => v.shapeId === 'b').gain.gain.value).toBeGreaterThan(0);
  });

  test('solo voice that does not exist unmutes all', async () => {
    const state = await startWith([makeVoice('a', 'sine', { size: 0.2 })]);
    engine.setSoloVoice('nonexistent');
    engine.update(state, TEST_REVERB);
    expect(engine.activeVoices.find((v) => v.shapeId === 'a').gain.gain.value).toBeGreaterThan(0);
  });

  test('cross-connections stay active when voice is soloed', async () => {
    const [a, b] = [
      makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
      makeVoice('b', 'sine', { x: 0.5, y: 0.5, size: 0.2 }),
    ];
    const state = makeSigilState([a, b], 'multiply');
    await engine.play(state, state.envelope, TEST_REVERB);
    engine.setSoloVoice('a');
    engine.update(state, TEST_REVERB);
    expect(engine._crossConnections.size).toBeGreaterThan(0);
  });

  test('solo respects initial play — muted voices start at gain 0', async () => {
    const [a, b] = [makeVoice('a', 'sine', { size: 0.2 }), makeVoice('b', 'sine', { size: 0.2 })];
    engine.setSoloVoice('a');
    await startWith([a, b]);
    expect(engine.activeVoices.find((v) => v.shapeId === 'a').gain.gain.value).toBeGreaterThan(0);
    expect(engine.activeVoices.find((v) => v.shapeId === 'b').gain.gain.value).toBe(0);
  });
});
