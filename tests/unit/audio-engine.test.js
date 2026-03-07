import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AudioEngine } from '../../js/audio/engine.ts';
import { Vibe, setVibe } from '../../js/audio/vibe.ts';

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

function createStubOscillator() {
  return {
    connect() {},
    detune: createStubAudioParam(0),
    disconnect() {},
    frequency: createStubAudioParam(440),
    start() {},
    stop() {},
    type: 'sine',
  };
}

function createStubAudioContext() {
  return {
    createAnalyser() {
      return createStubNode({
        fftSize: 256,
        getFloatTimeDomainData() {},
      });
    },
    createBiquadFilter() {
      return createStubNode({
        Q: createStubAudioParam(1),
        frequency: createStubAudioParam(350),
        gain: createStubAudioParam(0),
        type: 'lowpass',
      });
    },
    createBuffer(channels, length, sampleRate) {
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
    },
    createConstantSource() {
      return {
        connect() {},
        disconnect() {},
        offset: createStubAudioParam(0),
        start() {},
        stop() {},
      };
    },
    createConvolver() {
      return createStubNode({ buffer: undefined });
    },
    createDelay() {
      return createStubNode({ delayTime: createStubAudioParam(0) });
    },
    createDynamicsCompressor() {
      return createStubNode({
        attack: createStubAudioParam(0.003),
        knee: createStubAudioParam(30),
        ratio: createStubAudioParam(12),
        release: createStubAudioParam(0.25),
        threshold: createStubAudioParam(-24),
      });
    },
    createGain() {
      return createStubNode({ gain: createStubAudioParam(1) });
    },
    createOscillator() {
      return createStubOscillator();
    },
    createStereoPanner() {
      return createStubNode({ pan: createStubAudioParam(0) });
    },
    createWaveShaper() {
      return createStubNode({ curve: undefined, oversample: 'none' });
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

function makeVoice(id, waveform = 'sine', overrides = {}) {
  const base = {
    blend: 'soft-light',
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

function makeSigilState(voices) {
  return {
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
    expect(audioVoice.blendEffect).not.toBeUndefined();
    expect(audioVoice.currentBlend).toBe('soft-light');
  });

  test('blend change triggers voice rebuild', async () => {
    const voiceA = makeVoice('a', 'sine', { blend: 'soft-light' });
    await startWith([voiceA]);

    const originalVoice = engine.activeVoices[0];

    // Change blend mode
    const updated = makeVoice('a', 'sine', { blend: 'multiply' });
    engine.update(makeSigilState([updated]));

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

  test('octave gain updates when shape size changes', async () => {
    const voice = makeVoice('a', 'sine', {
      border: { color: 'white', double: false, thickness: 0.5 },
      size: 0.3,
    });
    await startWith([voice]);

    const audioVoice = engine.activeVoices[0];
    const initialGain = audioVoice.octaveGainNode.gain.value;

    // Increase size
    const updated = makeVoice('a', 'sine', {
      border: { color: 'white', double: false, thickness: 0.5 },
      size: 0.7,
    });
    engine.update(makeSigilState([updated]));

    expect(audioVoice.octaveGainNode.gain.value).toBeGreaterThan(initialGain);
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
    engine.masterGain = engine.audioCtx.createGain();
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

  test('play with positive reverbMix creates convolver and wet gain', async () => {
    setVibe(new Vibe({ reverbMix: 0.5 }));
    await startWith([makeVoice('a')]);

    expect(engine._reverbConvolver).not.toBeUndefined();
    expect(engine._reverbWet).not.toBeUndefined();
  });

  test('reverb wet gain matches vibe.reverbMix', async () => {
    setVibe(new Vibe({ reverbMix: 0.75 }));
    await startWith([makeVoice('a')]);

    expect(engine._reverbWet.gain.value).toBe(0.75);
  });

  test('cleanup nulls reverb nodes', async () => {
    setVibe(new Vibe({ reverbMix: 0.5 }));
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
});

describe('AudioEngine — reverb tail cleanup delay (vibe-based)', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = engine.audioCtx.createGain();
  });

  test('release without reverb uses normal cleanup delay', async () => {
    setVibe(new Vibe({ reverbMix: 0 }));
    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope);

    engine.release(state.envelope);

    // After releaseTime + 100ms, cleanup should have fired
    const releaseMs = state.envelope.release * 1000 + 150;
    await new Promise((r) => setTimeout(r, releaseMs));
    expect(engine.isPlaying).toBe(false);
  });

  test('release with reverb delays cleanup for IR duration', async () => {
    setVibe(new Vibe({ reverbMix: 0.5, reverbDuration: 0.5 }));
    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope);

    engine.release(state.envelope);

    // After releaseTime + 100ms, reverb should STILL be connected (tail still ringing)
    const releaseMs = state.envelope.release * 1000 + 100;
    await new Promise((r) => setTimeout(r, releaseMs + 50));
    expect(engine.isPlaying).toBe(true); // Not cleaned up yet

    // After releaseTime + IR duration + 100ms, cleanup should have fired
    const irDurationMs = 500; // vibe.reverbDuration = 0.5s
    await new Promise((r) => setTimeout(r, irDurationMs));
    expect(engine.isPlaying).toBe(false);
  });
});

describe('AudioEngine — reverb IR caching (vibe-based)', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = engine.audioCtx.createGain();
  });

  test('same vibe reuses cached IR buffer across plays', async () => {
    setVibe(new Vibe({ reverbMix: 0.5 }));
    const state = makeSigilState([makeVoice('a')]);

    await engine.play(state, state.envelope);
    const firstBuffer = engine._reverbConvolver.buffer;

    engine.stop();

    await engine.play(state, state.envelope);
    const secondBuffer = engine._reverbConvolver.buffer;

    expect(secondBuffer).toBe(firstBuffer);
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
    engine.masterGain = engine.audioCtx.createGain();

    const state = makeSigilState([makeVoice('a')]);
    await engine.play(state, state.envelope);
    engine.stop();

    expect(engine.getLevel()).toBe(0);
  });
});
