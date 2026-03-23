import { describe, expect, test } from 'bun:test';
import { deserializeState, pathToState, serializeState, stateToPath } from '../../js/serialize.ts';

// v2 quantization: envelope uses 3-bit (8 steps), spatial uses 6-bit (64 steps).
// Tolerances must account for this coarser resolution.

function makeState(overrides = {}) {
  return {
    envelope: { attack: 0.571, decay: 0.571, release: 1.286, sustain: 0.571 },
    scene: 0,
    voices: [],
    ...overrides,
  };
}

function makeVoice(overrides = {}) {
  return {
    blend: 'screen',
    border: undefined,
    effect: undefined,
    fill: { h: 200, l: 50, mode: 'solid', s: 80 },
    id: 'test1',
    size: 0.5,
    waveform: 'sine',
    x: 0.5,
    y: 0.5,
    ...overrides,
  };
}

describe('v2 serializeState / deserializeState round-trip', () => {
  test('empty state round-trips correctly', () => {
    const state = makeState();
    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);

    expect(decoded).not.toBeUndefined();
    // 3-bit envelope: 8 steps, tolerance ~0.15 for attack/decay, ~0.22 for release
    expect(decoded.envelope.attack).toBeCloseTo(state.envelope.attack, 0);
    expect(decoded.envelope.decay).toBeCloseTo(state.envelope.decay, 0);
    expect(decoded.envelope.sustain).toBeCloseTo(state.envelope.sustain, 0);
    expect(decoded.envelope.release).toBeCloseTo(state.envelope.release, 0);
    expect(decoded.voices).toHaveLength(0);
  });

  test('version byte is present', () => {
    const state = makeState();
    const encoded = serializeState(state);
    // First char is version. B64 'C' = 2
    expect(encoded.charAt(0)).toBe('C');
  });

  test('scene index survives round-trip', () => {
    for (const scene of [0, 5, 11, 63]) {
      const state = makeState({ scene });
      const decoded = deserializeState(serializeState(state));
      expect(decoded.scene).toBe(scene);
    }
  });

  test('state with voices round-trips (values preserved within quantization)', () => {
    const state = makeState({
      voices: [
        makeVoice({ size: 0.5, waveform: 'sine', x: 0.5, y: 0.5 }),
        makeVoice({
          effect: 'stripes',
          size: 0.5,
          timbre: 0.5,
          waveform: 'pulse',
          x: 0.25,
          y: 0.25,
        }),
      ],
    });

    const decoded = deserializeState(serializeState(state));
    expect(decoded.voices).toHaveLength(2);

    const sine = decoded.voices.find((v) => v.waveform === 'sine');
    const pulse = decoded.voices.find((v) => v.waveform === 'pulse');

    // 6-bit quantization: ±0.02
    expect(sine.x).toBeCloseTo(0.5, 1);
    expect(sine.y).toBeCloseTo(0.5, 1);
    expect(sine.size).toBeCloseTo(0.5, 1);

    expect(pulse.effect).toBe('stripes');
    expect(pulse.timbre).toBeCloseTo(0.5, 1);

    // IDs are regenerated on load
    expect(decoded.voices[0].id).toBeTruthy();
    expect(decoded.voices[1].id).toBeTruthy();
    expect(decoded.voices[0].id).not.toBe(decoded.voices[1].id);
  });

  test('all waveform types survive round-trip', () => {
    const state = makeState({
      voices: [
        makeVoice({ timbre: 0.3, waveform: 'blend', x: 0.1 }),
        makeVoice({ timbre: 0.7, waveform: 'pulse', x: 0.2 }),
        makeVoice({ waveform: 'sine', x: 0.3 }),
        makeVoice({ timbre: 0.5, waveform: 'astroid', x: 0.4 }),
        makeVoice({ stamp: 2, waveform: 'stamp', x: 0.5 }),
      ],
    });

    const decoded = deserializeState(serializeState(state));
    expect(decoded.voices.map((v) => v.waveform).sort()).toEqual([
      'astroid',
      'blend',
      'pulse',
      'sine',
      'stamp',
    ]);
  });

  test('all fill modes survive round-trip', () => {
    const solidVoice = makeVoice({
      fill: { h: 120, l: 60, mode: 'solid', s: 50 },
      x: 0.1,
    });
    const linearVoice = makeVoice({
      fill: { gradAngle: 90, h: 100, h2: 200, l: 40, l2: 60, mode: 'linear', s: 50, s2: 70 },
      x: 0.3,
    });

    const state = makeState({ voices: [solidVoice, linearVoice] });
    const decoded = deserializeState(serializeState(state));

    const solid = decoded.voices.find((v) => v.fill.mode === 'solid');
    const linear = decoded.voices.find((v) => v.fill.mode === 'linear');

    expect(solid.fill.mode).toBe('solid');
    expect(solid.fill.h).toBe(120);

    expect(linear.fill.mode).toBe('linear');
    expect(linear.fill.gradAngle).toBe(90);
    expect(linear.fill.h).toBe(100);
    expect(linear.fill.h2).toBe(200);
  });

  test('all blend modes survive round-trip', () => {
    const blends = ['screen', 'multiply', 'difference'];
    const state = makeState({
      voices: blends.map((b, i) => makeVoice({ blend: b, x: i * 0.3 })),
    });

    const decoded = deserializeState(serializeState(state));
    const decodedBlends = decoded.voices.map((v) => v.blend).sort();
    expect(decodedBlends).toEqual([...blends].sort());
  });

  test('borders survive round-trip', () => {
    const state = makeState({
      voices: [
        makeVoice({ border: undefined, x: 0.1 }),
        makeVoice({ border: { color: 'white', double: false, thickness: 0.5 }, x: 0.3 }),
        makeVoice({ border: { color: 'black', double: true, thickness: 0.85 }, x: 0.5 }),
      ],
    });

    const decoded = deserializeState(serializeState(state));

    const byX = (target) => decoded.voices.find((v) => Math.abs(v.x - target) < 0.05);

    expect(byX(0.1).border).toBeUndefined();
    expect(byX(0.3).border.color).toBe('white');
    expect(byX(0.3).border.double).toBe(false);
    // 3-bit thickness: 8 steps, tolerance ±0.15
    expect(byX(0.3).border.thickness).toBeCloseTo(0.5, 0);
    expect(byX(0.5).border.color).toBe('black');
    expect(byX(0.5).border.double).toBe(true);
  });

  test('canonical ordering — voice permutations produce identical strings', () => {
    const a = makeVoice({ waveform: 'sine', x: 0.1 });
    const b = makeVoice({ timbre: 0.5, waveform: 'pulse', x: 0.5 });
    const c = makeVoice({ timbre: 0.3, waveform: 'blend', x: 0.9 });

    const s1 = serializeState(makeState({ voices: [a, b, c] }));
    const s2 = serializeState(makeState({ voices: [c, a, b] }));
    const s3 = serializeState(makeState({ voices: [b, c, a] }));

    expect(s1).toBe(s2);
    expect(s2).toBe(s3);
  });

  test('stamp voice survives round-trip', () => {
    const state = makeState({
      voices: [makeVoice({ stamp: 3, waveform: 'stamp' })],
    });
    const decoded = deserializeState(serializeState(state));
    expect(decoded.voices[0].waveform).toBe('stamp');
    expect(decoded.voices[0].stamp).toBe(3);
  });
});

describe('v2 format structure', () => {
  test('global header is 4 chars (version + scene + envelope)', () => {
    const state = makeState();
    const encoded = serializeState(state);
    // No voices = just 4 header chars
    expect(encoded).toHaveLength(4);
  });

  test('solid voice adds 12 chars (1 header + 11 registers)', () => {
    const state = makeState({ voices: [makeVoice()] });
    const encoded = serializeState(state);
    // 4 header + 12 voice = 16
    expect(encoded).toHaveLength(16);
  });

  test('gradient voice adds 17 chars (1 header + 16 registers)', () => {
    const state = makeState({
      voices: [
        makeVoice({
          fill: { gradAngle: 90, h: 100, h2: 200, l: 40, l2: 60, mode: 'linear', s: 50, s2: 70 },
        }),
      ],
    });
    const encoded = serializeState(state);
    // 4 header + 17 voice = 21
    expect(encoded).toHaveLength(21);
  });

  test('old v1 URLs return undefined', () => {
    // v1 URLs start with envelope chars, not version byte
    const v1Data = 'AKHPGMAKBDgAGAG8OEIhDnJPDgAJJGFOEIhDnJP';
    expect(deserializeState(v1Data)).toBeUndefined();
  });
});

describe('stateToPath / pathToState', () => {
  test('empty state returns root path', () => {
    expect(stateToPath(makeState())).toBe('/');
  });

  test('state with voices returns /s/ path', () => {
    const state = makeState({ voices: [makeVoice()] });
    const path = stateToPath(state);
    expect(path.startsWith('/s/')).toBe(true);
  });

  test('pathToState round-trips with stateToPath', () => {
    const state = makeState({
      voices: [
        makeVoice({ waveform: 'sine' }),
        makeVoice({ timbre: 0.5, waveform: 'pulse', x: 0.75 }),
      ],
    });
    const path = stateToPath(state);
    const decoded = pathToState(path);

    expect(decoded).not.toBeUndefined();
    expect(decoded.voices).toHaveLength(2);
  });

  test('invalid paths return undefined', () => {
    expect(pathToState('/')).toBeUndefined();
    expect(pathToState('/s/')).toBeUndefined();
    expect(pathToState('/s/!!invalid!!')).toBeUndefined();
    expect(pathToState('/other/path')).toBeUndefined();
  });
});
