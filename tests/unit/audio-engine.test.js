import { describe, test, expect, beforeEach } from 'bun:test';
import { AudioEngine } from '../../js/audio.js';

// Minimal Web Audio API stubs for testing voice reconciliation logic.
// We only need enough to let _buildVoice wire up nodes and updateVoices
// track shape IDs — no actual audio output.

function createStubAudioParam(initial = 0) {
  return {
    value: initial,
    setValueAtTime() {},
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
  };
}

function makeShape(id, type = 'circle', overrides = {}) {
  return {
    id,
    type,
    x: 0.5,
    y: 0.5,
    size: 0.12,
    rotation: 0,
    fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    pattern: null,
    ...overrides,
  };
}

function makeSigilState(shapes) {
  return {
    shapes,
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

  async function startWith(shapes) {
    const state = makeSigilState(shapes);
    await engine.play(state, state.envelope);
    return state;
  }

  test('new shapes get voices during playback', async () => {
    const shapeA = makeShape('a');
    await startWith([shapeA]);

    expect(engine.activeVoices.length).toBe(1);
    expect(engine.playingShapeIds.has('a')).toBe(true);

    // Add a second shape
    const shapeB = makeShape('b');
    engine.updateVoices(makeSigilState([shapeA, shapeB]));

    expect(engine.activeVoices.length).toBe(2);
    expect(engine.playingShapeIds.has('b')).toBe(true);
  });

  test('deleted shapes lose voices during playback', async () => {
    const shapeA = makeShape('a');
    const shapeB = makeShape('b');
    await startWith([shapeA, shapeB]);

    expect(engine.activeVoices.length).toBe(2);

    // Remove shape B
    engine.updateVoices(makeSigilState([shapeA]));

    expect(engine.activeVoices.length).toBe(1);
    expect(engine.playingShapeIds.has('a')).toBe(true);
    expect(engine.playingShapeIds.has('b')).toBe(false);
  });

  test('simultaneous add and remove reconciles correctly', async () => {
    const shapeA = makeShape('a');
    const shapeB = makeShape('b');
    await startWith([shapeA, shapeB]);

    // Remove A, add C
    const shapeC = makeShape('c');
    engine.updateVoices(makeSigilState([shapeB, shapeC]));

    expect(engine.activeVoices.length).toBe(2);
    const ids = engine.activeVoices.map((v) => v.shapeId).sort();
    expect(ids).toEqual(['b', 'c']);
    expect(engine.playingShapeIds.has('a')).toBe(false);
    expect(engine.playingShapeIds.has('c')).toBe(true);
  });

  test('no-op when shapes unchanged', async () => {
    const shapeA = makeShape('a');
    await startWith([shapeA]);

    const voicesBefore = engine.activeVoices.length;
    engine.updateVoices(makeSigilState([shapeA]));

    expect(engine.activeVoices.length).toBe(voicesBefore);
  });

  test('all shapes removed clears all voices', async () => {
    const shapeA = makeShape('a');
    const shapeB = makeShape('b');
    await startWith([shapeA, shapeB]);

    engine.updateVoices(makeSigilState([]));

    expect(engine.activeVoices.length).toBe(0);
    expect(engine.playingShapeIds.size).toBe(0);
  });

  test('works with all three shape types', async () => {
    await startWith([]);

    const shapes = [
      makeShape('circ', 'circle'),
      makeShape('sq', 'square'),
      makeShape('tri', 'triangle'),
    ];
    engine.updateVoices(makeSigilState(shapes));

    expect(engine.activeVoices.length).toBe(3);
    expect(engine.playingShapeIds.has('circ')).toBe(true);
    expect(engine.playingShapeIds.has('sq')).toBe(true);
    expect(engine.playingShapeIds.has('tri')).toBe(true);
  });

  test('does nothing when not playing', () => {
    engine.isPlaying = false;
    const shapeA = makeShape('a');
    engine.updateVoices(makeSigilState([shapeA]));

    expect(engine.activeVoices.length).toBe(0);
  });
});
