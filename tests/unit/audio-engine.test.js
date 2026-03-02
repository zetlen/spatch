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
    expect(engine.playingShapeIds.has('a')).toBe(true);

    // Add a second voice
    const voiceB = makeVoice('b');
    engine.updateVoices(makeSigilState([voiceA, voiceB]));

    expect(engine.activeVoices.length).toBe(2);
    expect(engine.playingShapeIds.has('b')).toBe(true);
  });

  test('deleted shapes lose voices during playback', async () => {
    const voiceA = makeVoice('a');
    const voiceB = makeVoice('b');
    await startWith([voiceA, voiceB]);

    expect(engine.activeVoices.length).toBe(2);

    // Remove voice B
    engine.updateVoices(makeSigilState([voiceA]));

    expect(engine.activeVoices.length).toBe(1);
    expect(engine.playingShapeIds.has('a')).toBe(true);
    expect(engine.playingShapeIds.has('b')).toBe(false);
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
    expect(engine.playingShapeIds.has('a')).toBe(false);
    expect(engine.playingShapeIds.has('c')).toBe(true);
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
    expect(engine.playingShapeIds.size).toBe(0);
  });

  test('works with all three waveform types', async () => {
    await startWith([]);

    const voices = [makeVoice('circ', 'sine'), makeVoice('sq', 'pulse'), makeVoice('tri', 'blend')];
    engine.updateVoices(makeSigilState(voices));

    expect(engine.activeVoices.length).toBe(3);
    expect(engine.playingShapeIds.has('circ')).toBe(true);
    expect(engine.playingShapeIds.has('sq')).toBe(true);
    expect(engine.playingShapeIds.has('tri')).toBe(true);
  });

  test('does nothing when not playing', () => {
    engine.isPlaying = false;
    const voiceA = makeVoice('a');
    engine.updateVoices(makeSigilState([voiceA]));

    expect(engine.activeVoices.length).toBe(0);
  });
});

describe('AudioEngine — auto EQ', () => {
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

  test('creates EQ band pool during play()', async () => {
    await startWith([makeVoice('a')]);
    expect(engine._autoEQ.length).toBeGreaterThanOrEqual(1);
  });

  test('sine voices get higher EQ boost than pulse or blend', async () => {
    const voices = [
      makeVoice('circ', 'sine', { size: 0.3 }),
      makeVoice('sq', 'pulse', { size: 0.3 }),
      makeVoice('tri', 'blend', { size: 0.3 }),
    ];
    await startWith(voices);

    // Band 0 = sine, Band 1 = pulse, Band 2 = blend
    const sineBoost = engine._autoEQ[0].gain.value;
    const pulseBoost = engine._autoEQ[1].gain.value;
    const blendBoost = engine._autoEQ[2].gain.value;

    expect(sineBoost).toBeGreaterThan(pulseBoost);
    expect(sineBoost).toBeGreaterThan(blendBoost);
  });

  test('larger shapes get more EQ boost', async () => {
    const small = makeVoice('small', 'sine', { size: 0.1 });
    const big = makeVoice('big', 'sine', { size: 0.5 });
    await startWith([small, big]);

    const smallBoost = engine._autoEQ[0].gain.value;
    const bigBoost = engine._autoEQ[1].gain.value;

    expect(bigBoost).toBeGreaterThan(smallBoost);
  });

  test('unused EQ bands are at 0 dB', async () => {
    await startWith([makeVoice('a')]);

    // Pool has MAX_EQ_BANDS entries, only first is used
    for (let i = 1; i < engine._autoEQ.length; i++) {
      expect(engine._autoEQ[i].gain.value).toBe(0);
    }
  });

  test('EQ bands are cleaned up on stop', async () => {
    await startWith([makeVoice('a')]);
    expect(engine._autoEQ.length).toBeGreaterThan(0);

    engine.stop();
    expect(engine._autoEQ.length).toBe(0);
  });

  test('EQ updates when voices change', async () => {
    const voiceA = makeVoice('a', 'sine', { y: 0.3 });
    await startWith([voiceA]);

    const initialFreq = engine._autoEQ[0].frequency.value;

    // Move voice to different y position
    const movedA = makeVoice('a', 'sine', { y: 0.7 });
    engine.updateVoices(makeSigilState([movedA]));

    const updatedFreq = engine._autoEQ[0].frequency.value;
    expect(updatedFreq).not.toBe(initialFreq);
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
