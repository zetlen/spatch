import { describe, test, expect, beforeEach } from 'bun:test';
import { AudioEngine } from '../../js/audio.ts';

// Minimal Web Audio API stubs for testing voice reconciliation logic.
// We only need enough to let _buildVoice wire up nodes and updateVoices
// track shape IDs — no actual audio output.

function createStubAudioParam(initial = 0) {
  return {
    value: initial,
    setValueAtTime(v) {
      this.value = v;
    },
    linearRampToValueAtTime() {},
    cancelScheduledValues() {},
  };
}

function createStubNode(extraProps = {}) {
  return {
    connect() {},
    disconnect() {},
    ...extraProps,
  };
}

function createStubOscillator() {
  return {
    type: 'sine',
    frequency: createStubAudioParam(440),
    detune: createStubAudioParam(0),
    connect() {},
    disconnect() {},
    start() {},
    stop() {},
  };
}

function createStubAudioContext() {
  return {
    currentTime: 0,
    sampleRate: 44100,
    state: 'running',
    destination: createStubNode(),
    resume() {
      return Promise.resolve();
    },
    createGain() {
      return createStubNode({ gain: createStubAudioParam(1) });
    },
    createOscillator() {
      return createStubOscillator();
    },
    createBiquadFilter() {
      return createStubNode({
        type: 'lowpass',
        frequency: createStubAudioParam(350),
        Q: createStubAudioParam(1),
        gain: createStubAudioParam(0),
      });
    },
    createStereoPanner() {
      return createStubNode({ pan: createStubAudioParam(0) });
    },
    createDynamicsCompressor() {
      return createStubNode({
        threshold: createStubAudioParam(-24),
        knee: createStubAudioParam(30),
        ratio: createStubAudioParam(12),
        attack: createStubAudioParam(0.003),
        release: createStubAudioParam(0.25),
      });
    },
    createConstantSource() {
      return {
        offset: createStubAudioParam(0),
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
      };
    },
    createWaveShaper() {
      return createStubNode({ curve: null, oversample: 'none' });
    },
    createDelay() {
      return createStubNode({ delayTime: createStubAudioParam(0) });
    },
    createAnalyser() {
      return createStubNode({
        fftSize: 256,
        getFloatTimeDomainData() {},
      });
    },
    createConvolver() {
      return createStubNode({ buffer: null });
    },
    createBuffer(channels, length, sampleRate) {
      const channelData = [];
      for (let i = 0; i < channels; i++) {
        channelData.push(new Float32Array(length));
      }
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData(ch) {
          return channelData[ch];
        },
      };
    },
  };
}

function makeVoice(id, waveform = 'sine', overrides = {}) {
  const base = {
    id,
    waveform,
    x: 0.5,
    y: 0.5,
    size: 0.12,
    fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    effect: null,
    blend: 'soft-light',
    border: null,
    ...overrides,
  };
  if (waveform === 'pulse' || waveform === 'blend') {
    base.timbre = overrides.timbre ?? 0;
  }
  return base;
}

function makeSigilState(voices) {
  return {
    voices,
    texts: [],
    envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    reverb: null,
  };
}

describe('AudioEngine.updateVoices — voice reconciliation', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    // Inject stub context so we skip real AudioContext
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = engine.audioCtx.createGain();
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
    engine.updateVoices(makeSigilState([voiceA, voiceB]));

    expect(engine.activeVoices.length).toBe(2);
    expect(engine.activeVoices.map((v) => v.shapeId).sort()).toEqual(['a', 'b']);
  });

  test('deleted shapes lose voices during playback', async () => {
    const voiceA = makeVoice('a');
    const voiceB = makeVoice('b');
    await startWith([voiceA, voiceB]);

    expect(engine.activeVoices.length).toBe(2);

    // Remove voice B
    engine.updateVoices(makeSigilState([voiceA]));

    expect(engine.activeVoices.length).toBe(1);
    expect(engine.activeVoices[0].shapeId).toBe('a');
  });

  test('simultaneous add and remove reconciles correctly', async () => {
    const voiceA = makeVoice('a');
    const voiceB = makeVoice('b');
    await startWith([voiceA, voiceB]);

    // Remove A, add C
    const voiceC = makeVoice('c');
    engine.updateVoices(makeSigilState([voiceB, voiceC]));

    expect(engine.activeVoices.length).toBe(2);
    const ids = engine.activeVoices.map((v) => v.shapeId).sort();
    expect(ids).toEqual(['b', 'c']);
    expect(ids).not.toContain('a');
  });

  test('no-op when shapes unchanged', async () => {
    const voiceA = makeVoice('a');
    await startWith([voiceA]);

    const voicesBefore = engine.activeVoices.length;
    engine.updateVoices(makeSigilState([voiceA]));

    expect(engine.activeVoices.length).toBe(voicesBefore);
  });

  test('all shapes removed clears all voices', async () => {
    const voiceA = makeVoice('a');
    const voiceB = makeVoice('b');
    await startWith([voiceA, voiceB]);

    engine.updateVoices(makeSigilState([]));

    expect(engine.activeVoices.length).toBe(0);
  });

  test('works with all three waveform types', async () => {
    await startWith([]);

    const voices = [makeVoice('circ', 'sine'), makeVoice('sq', 'pulse'), makeVoice('tri', 'blend')];
    engine.updateVoices(makeSigilState(voices));

    expect(engine.activeVoices.length).toBe(3);
    expect(engine.activeVoices.map((v) => v.shapeId).sort()).toEqual(['circ', 'sq', 'tri']);
  });

  test('does nothing when not playing', () => {
    engine.isPlaying = false;
    const voiceA = makeVoice('a');
    engine.updateVoices(makeSigilState([voiceA]));

    expect(engine.activeVoices.length).toBe(0);
  });
});

describe('AudioEngine — blend effects', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = engine.audioCtx.createGain();
  });

  async function startWith(voices) {
    const state = makeSigilState(voices);
    await engine.play(state, state.envelope);
    return state;
  }

  test('voices get blend effects during play', async () => {
    const voiceA = makeVoice('a');
    await startWith([voiceA]);

    const audioVoice = engine.activeVoices[0];
    expect(audioVoice.blendEffect).not.toBeNull();
    expect(audioVoice.currentBlend).toBe('soft-light');
  });

  test('blend change triggers voice rebuild', async () => {
    const voiceA = makeVoice('a', 'sine', { blend: 'soft-light' });
    await startWith([voiceA]);

    const originalVoice = engine.activeVoices[0];

    // Change blend mode
    const updated = makeVoice('a', 'sine', { blend: 'multiply' });
    engine.updateVoices(makeSigilState([updated]));

    // Voice should have been rebuilt (different object)
    const newVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(newVoice).not.toBe(originalVoice);
    expect(newVoice.currentBlend).toBe('multiply');
  });

  test('all blend modes can be built without error', async () => {
    const blends = [
      'soft-light',
      'multiply',
      'screen',
      'overlay',
      'color-burn',
      'difference',
      'exclusion',
    ];
    for (const blend of blends) {
      const voiceA = makeVoice('a', 'sine', { blend });
      await startWith([voiceA]);
      expect(engine.activeVoices.length).toBe(1);
      expect(engine.activeVoices[0].currentBlend).toBe(blend);
      engine.stop();
    }
  });
});

describe('AudioEngine — border / octave doubling', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = engine.audioCtx.createGain();
  });

  async function startWith(voices) {
    const state = makeSigilState(voices);
    await engine.play(state, state.envelope);
    return state;
  }

  test('voice without border has null octaveOsc', async () => {
    const voice = makeVoice('a', 'sine', { border: null });
    await startWith([voice]);

    const audioVoice = engine.activeVoices[0];
    expect(audioVoice.octaveOsc).toBeNull();
    expect(audioVoice.currentBorder).toBeNull();
  });

  test('voice with border has octaveOsc', async () => {
    const voice = makeVoice('a', 'sine', {
      border: { color: 'white', double: false, thickness: 0.5 },
    });
    await startWith([voice]);

    const audioVoice = engine.activeVoices[0];
    expect(audioVoice.octaveOsc).not.toBeNull();
    expect(audioVoice.currentBorder).toBe('white:0:0.5');
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
    engine.updateVoices(makeSigilState([updated]));

    const newVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(newVoice).not.toBe(originalVoice);
    expect(newVoice.currentBorder).toBe('black:0:0.5');
  });

  test('adding border triggers voice rebuild', async () => {
    const voice = makeVoice('a', 'sine', { border: null });
    await startWith([voice]);

    const originalVoice = engine.activeVoices[0];

    // Add border
    const updated = makeVoice('a', 'sine', {
      border: { color: 'white', double: true, thickness: 0.7 },
    });
    engine.updateVoices(makeSigilState([updated]));

    const newVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(newVoice).not.toBe(originalVoice);
    expect(newVoice.octaveOsc).not.toBeNull();
    expect(newVoice.currentBorder).toBe('white:1:0.7');
  });

  test('removing border triggers voice rebuild', async () => {
    const voice = makeVoice('a', 'sine', {
      border: { color: 'white', double: false, thickness: 0.5 },
    });
    await startWith([voice]);

    // Remove border
    const updated = makeVoice('a', 'sine', { border: null });
    engine.updateVoices(makeSigilState([updated]));

    const newVoice = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(newVoice.octaveOsc).toBeNull();
    expect(newVoice.currentBorder).toBeNull();
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
      expect(av.octaveOsc).not.toBeNull();
    }
  });
});

describe('AudioEngine — master reverb', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = engine.audioCtx.createGain();
  });

  async function startWith(voices, reverb = null) {
    const state = makeSigilState(voices);
    state.reverb = reverb;
    await engine.play(state, state.envelope);
    return state;
  }

  test('play with null reverb creates no convolver', async () => {
    await startWith([makeVoice('a')], null);

    expect(engine._reverbConvolver).toBeNull();
    expect(engine._reverbWet).toBeNull();
    expect(engine._reverbStyle).toBeNull();
  });

  test('play with reverb creates convolver and wet gain', async () => {
    await startWith([makeVoice('a')], { style: 'dim', depth: 0.5 });

    expect(engine._reverbConvolver).not.toBeNull();
    expect(engine._reverbWet).not.toBeNull();
    expect(engine._reverbStyle).toBe('dim');
  });

  test('reverb wet gain matches depth', async () => {
    await startWith([makeVoice('a')], { style: 'glow', depth: 0.75 });

    expect(engine._reverbWet.gain.value).toBe(0.75);
  });

  test('cleanup nulls reverb nodes', async () => {
    await startWith([makeVoice('a')], { style: 'dim', depth: 0.5 });

    expect(engine._reverbConvolver).not.toBeNull();

    engine.stop();

    expect(engine._reverbConvolver).toBeNull();
    expect(engine._reverbWet).toBeNull();
    expect(engine._reverbStyle).toBeNull();
  });

  test('updateReverb changes wet gain during playback', async () => {
    await startWith([makeVoice('a')], { style: 'dim', depth: 0.3 });

    expect(engine._reverbWet.gain.value).toBe(0.3);

    engine.updateReverb({ style: 'dim', depth: 0.8 });

    expect(engine._reverbWet.gain.value).toBe(0.8);
  });

  test('updateReverb with null removes reverb nodes', async () => {
    await startWith([makeVoice('a')], { style: 'glow', depth: 0.5 });

    expect(engine._reverbConvolver).not.toBeNull();

    engine.updateReverb(null);

    expect(engine._reverbConvolver).toBeNull();
    expect(engine._reverbWet).toBeNull();
    expect(engine._reverbStyle).toBeNull();
  });

  test('updateReverb with different style rebuilds convolver', async () => {
    await startWith([makeVoice('a')], { style: 'glow', depth: 0.5 });

    const originalConvolver = engine._reverbConvolver;

    engine.updateReverb({ style: 'dim', depth: 0.6 });

    expect(engine._reverbConvolver).not.toBe(originalConvolver);
    expect(engine._reverbStyle).toBe('dim');
    expect(engine._reverbWet.gain.value).toBe(0.6);
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
    engine.masterGain = engine.audioCtx.createGain();

    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope);

    // Stub fills buffer with zeros by default
    expect(engine.getLevel()).toBe(0);
  });

  test('returns correct RMS for known signal', async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = engine.audioCtx.createGain();

    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope);

    // Inject a known buffer: all 0.5 → RMS = 0.5
    const buf = new Float32Array(256);
    buf.fill(0.5);
    engine._analyserBuf = buf;
    engine._analyser.getFloatTimeDomainData = (arr) => {
      for (let i = 0; i < arr.length; i++) arr[i] = buf[i];
    };

    const level = engine.getLevel();
    expect(level).toBeCloseTo(0.5, 5);
  });

  test('returns 0 after stop', async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = engine.audioCtx.createGain();

    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope);
    engine.stop();

    expect(engine.getLevel()).toBe(0);
  });
});
