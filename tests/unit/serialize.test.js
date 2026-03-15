import { describe, expect, test } from 'bun:test';
import { deserializeState, pathToState, serializeState, stateToPath } from '../../js/serialize.ts';

function makeState(overrides = {}) {
  return {
    envelope: { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
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
    size: 0.12,
    waveform: 'sine',
    x: 0.5,
    y: 0.5,
    ...overrides,
  };
}

describe('serializeState / deserializeState round-trip', () => {
  test('empty state round-trips correctly', () => {
    const state = makeState();
    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);

    expect(decoded).not.toBeUndefined();
    expect(decoded.envelope.attack).toBeCloseTo(state.envelope.attack);
    expect(decoded.envelope.decay).toBeCloseTo(state.envelope.decay);
    expect(decoded.envelope.sustain).toBeCloseTo(state.envelope.sustain);
    expect(decoded.envelope.release).toBeCloseTo(state.envelope.release);
    expect(decoded.voices).toHaveLength(0);
  });

  test('state with voices round-trips (values preserved, IDs regenerated)', () => {
    const state = makeState({
      voices: [
        makeVoice({ size: 0.15, waveform: 'sine', x: 0.3, y: 0.7 }),
        makeVoice({
          effect: 'stripes',
          size: 0.2,
          timbre: 0.5,
          waveform: 'pulse',
          x: 0.8,
          y: 0.2,
        }),
      ],
    });

    const decoded = deserializeState(serializeState(state));

    expect(decoded.voices).toHaveLength(2);

    const sine = decoded.voices.find((v) => v.waveform === 'sine');
    const pulse = decoded.voices.find((v) => v.waveform === 'pulse');

    expect(sine.x).toBeCloseTo(0.3);
    expect(sine.y).toBeCloseTo(0.7);
    expect(sine.size).toBeCloseTo(0.15);

    expect(pulse.effect).toBe('stripes');
    expect(pulse.timbre).toBeCloseTo(0.5);

    // IDs are regenerated on load, not preserved
    expect(decoded.voices[0].id).toBeTruthy();
    expect(decoded.voices[1].id).toBeTruthy();
    expect(decoded.voices[0].id).not.toBe(decoded.voices[1].id);
  });

  test('all waveform types survive round-trip', () => {
    const state = makeState({
      voices: [
        makeVoice({ timbre: 0.3, waveform: 'blend' }),
        makeVoice({ timbre: 0.7, waveform: 'pulse' }),
        makeVoice({ waveform: 'sine' }),
      ],
    });

    const decoded = deserializeState(serializeState(state));
    expect(decoded.voices.map((v) => v.waveform).sort()).toEqual(['blend', 'pulse', 'sine']);
  });

  test('all fill modes survive round-trip', () => {
    const solidVoice = makeVoice({
      fill: { h: 120, l: 60, mode: 'solid', s: 50 },
    });
    const linearVoice = makeVoice({
      fill: { gradAngle: 90, h: 100, h2: 200, l: 40, l2: 60, mode: 'linear', s: 50, s2: 70 },
    });
    const boundaryVoice = makeVoice({
      fill: { h: 360, l: 100, mode: 'solid', s: 100 },
    });

    const state = makeState({ voices: [solidVoice, linearVoice, boundaryVoice] });
    const decoded = deserializeState(serializeState(state));

    const solid = decoded.voices.find((v) => v.fill.mode === 'solid' && v.fill.h === 120);
    const linear = decoded.voices.find((v) => v.fill.mode === 'linear');
    const boundary = decoded.voices.find((v) => v.fill.mode === 'solid' && v.fill.h === 360);

    expect(solid.fill.mode).toBe('solid');
    expect(solid.fill.h).toBe(120);

    expect(linear.fill.mode).toBe('linear');
    expect(linear.fill.gradAngle).toBe(90);
    expect(linear.fill.h).toBe(100);

    expect(boundary.fill.h).toBe(360);
    expect(boundary.fill.s).toBe(100);
    expect(boundary.fill.l).toBe(100);
  });

  test('all blend modes survive round-trip', () => {
    const blends = ['screen', 'multiply', 'difference'];
    const state = makeState({
      voices: blends.map((b, i) => makeVoice({ blend: b, x: 0.1 * (i + 1) })),
    });

    const decoded = deserializeState(serializeState(state));
    const decodedBlends = decoded.voices.map((v) => v.blend).sort();
    expect(decodedBlends).toEqual([...blends].sort());
  });

  test('borders survive round-trip', () => {
    const state = makeState({
      voices: [
        makeVoice({ border: undefined, x: 0.1 }),
        makeVoice({ border: { color: 'white', double: false, thickness: 0.5 }, x: 0.2 }),
        makeVoice({ border: { color: 'black', double: true, thickness: 0.8 }, x: 0.3 }),
        makeVoice({ border: { color: 'black', double: false, thickness: 0.2 }, x: 0.4 }),
        makeVoice({ border: { color: 'white', double: true, thickness: 0.9 }, x: 0.5 }),
      ],
    });

    const decoded = deserializeState(serializeState(state));

    const byX = (x) => decoded.voices.find((v) => Math.abs(v.x - x) < 0.01);

    expect(byX(0.1).border).toBeUndefined();

    expect(byX(0.2).border).not.toBeUndefined();
    expect(byX(0.2).border.color).toBe('white');
    expect(byX(0.2).border.double).toBe(false);
    expect(byX(0.2).border.thickness).toBeCloseTo(0.5);

    expect(byX(0.3).border).not.toBeUndefined();
    expect(byX(0.3).border.color).toBe('black');
    expect(byX(0.3).border.double).toBe(true);
    expect(byX(0.3).border.thickness).toBeCloseTo(0.8);

    expect(byX(0.4).border).not.toBeUndefined();
    expect(byX(0.4).border.color).toBe('black');
    expect(byX(0.4).border.double).toBe(false);
    expect(byX(0.4).border.thickness).toBeCloseTo(0.2);

    expect(byX(0.5).border).not.toBeUndefined();
    expect(byX(0.5).border.color).toBe('white');
    expect(byX(0.5).border.double).toBe(true);
    expect(byX(0.5).border.thickness).toBeCloseTo(0.9);
  });

  test('all effects survive round-trip', () => {
    const effects = ['stripes', 'checker', 'noise', 'plaid'];
    const state = makeState({
      voices: effects.map((e, i) => makeVoice({ effect: e, x: 0.1 * (i + 1) })),
    });

    const decoded = deserializeState(serializeState(state));
    const decodedEffects = decoded.voices.map((v) => v.effect).sort();
    expect(decodedEffects).toEqual([...effects].sort());
  });

  test('complex voice with all optional fields round-trips correctly', () => {
    const state = makeState({
      voices: [
        makeVoice({
          waveform: 'pulse',
          timbre: 0.6,
          border: { color: 'black', double: true, thickness: 0.1 },
          fill: { gradAngle: 180, h: 20, h2: 40, l: 30, l2: 50, mode: 'linear', s: 40, s2: 60 },
          effect: 'noise',
        }),
      ],
    });
    const decoded = deserializeState(serializeState(state));
    const v = decoded.voices[0];
    expect(v.waveform).toBe('pulse');
    expect(v.timbre).toBeCloseTo(0.6);
    expect(v.border.color).toBe('black');
    expect(v.border.double).toBe(true);
    expect(v.border.thickness).toBeCloseTo(0.1);
    expect(v.fill.mode).toBe('linear');
    expect(v.fill.gradAngle).toBe(180);
    expect(v.fill.h).toBe(20);
    expect(v.effect).toBe('noise');
  });

  test('max envelope values round-trip', () => {
    const state = makeState({
      envelope: { attack: 2, decay: 2, release: 3, sustain: 1 },
    });
    const decoded = deserializeState(serializeState(state));
    expect(decoded.envelope.attack).toBe(2);
    expect(decoded.envelope.decay).toBe(2);
    expect(decoded.envelope.sustain).toBe(1);
    expect(decoded.envelope.release).toBe(3);
  });
});

describe('canonical voice ordering', () => {
  test('voice permutations produce identical URLs', () => {
    const voiceA = makeVoice({ waveform: 'sine', x: 0.3, y: 0.7, size: 0.15 });
    const voiceB = makeVoice({
      waveform: 'pulse',
      timbre: 0.5,
      x: 0.8,
      y: 0.2,
      size: 0.2,
      effect: 'stripes',
    });
    const voiceC = makeVoice({
      waveform: 'blend',
      timbre: 0.3,
      x: 0.5,
      y: 0.5,
      size: 0.1,
      blend: 'multiply',
    });

    const abc = serializeState(makeState({ voices: [voiceA, voiceB, voiceC] }));
    const bca = serializeState(makeState({ voices: [voiceB, voiceC, voiceA] }));
    const cab = serializeState(makeState({ voices: [voiceC, voiceA, voiceB] }));
    const cba = serializeState(makeState({ voices: [voiceC, voiceB, voiceA] }));

    expect(abc).toBe(bca);
    expect(abc).toBe(cab);
    expect(abc).toBe(cba);
  });

  test('identical voices in different order still round-trip all data', () => {
    const voiceA = makeVoice({ waveform: 'sine', x: 0.2, y: 0.8 });
    const voiceB = makeVoice({ waveform: 'pulse', timbre: 0.6, x: 0.9, y: 0.1 });

    const stateAB = makeState({ voices: [voiceA, voiceB] });
    const stateBA = makeState({ voices: [voiceB, voiceA] });

    const decodedAB = deserializeState(serializeState(stateAB));
    const decodedBA = deserializeState(serializeState(stateBA));

    expect(decodedAB.voices).toHaveLength(2);
    expect(decodedBA.voices).toHaveLength(2);

    // Both should decode to the same voice set
    const sinAB = decodedAB.voices.find((v) => v.waveform === 'sine');
    const sinBA = decodedBA.voices.find((v) => v.waveform === 'sine');
    expect(sinAB.x).toBeCloseTo(sinBA.x);
    expect(sinAB.y).toBeCloseTo(sinBA.y);
  });
});

describe('deserializeState edge cases', () => {
  test('returns undefined for empty input', () => {
    expect(deserializeState('')).toBeUndefined();
  });

  test('returns undefined for garbage input at start of string', () => {
    expect(deserializeState('xyz')).toBeUndefined();
  });

  test('gracefully ignores trailing garbage and truncated voices', () => {
    const validVoice = makeVoice({ size: 0.15, waveform: 'sine', x: 0.3, y: 0.7 });
    const state = makeState({ voices: [validVoice, validVoice] });
    const encoded = serializeState(state);

    // Test trailing garbage
    const withGarbage = deserializeState(encoded + 'xyZ12$');
    expect(withGarbage).not.toBeUndefined();
    expect(withGarbage.voices).toHaveLength(2);

    // Test truncated voice (should return 1 voice instead of 2)
    // The second voice is 12 chars long, so slicing off 4 chars corrupts it.
    const truncated = deserializeState(encoded.slice(0, encoded.length - 4));
    expect(truncated).not.toBeUndefined();
    expect(truncated.voices).toHaveLength(1);

    // The first voice should be fully intact
    expect(truncated.voices[0].x).toBeCloseTo(0.3);
    expect(truncated.voices[0].y).toBeCloseTo(0.7);
    expect(truncated.envelope.attack).toBeCloseTo(state.envelope.attack);
  });
});

describe('scene serialization', () => {
  test('scene 0 round-trips', () => {
    const state = makeState({ scene: 0 });
    const decoded = deserializeState(serializeState(state));
    expect(decoded.scene).toBe(0);
  });

  test('scene index round-trips', () => {
    const state = makeState({ scene: 5 });
    const decoded = deserializeState(serializeState(state));
    expect(decoded.scene).toBe(5);
  });

  test('max scene index (63) round-trips', () => {
    const state = makeState({ scene: 63 });
    const decoded = deserializeState(serializeState(state));
    expect(decoded.scene).toBe(63);
  });
});

describe('URL path helpers', () => {
  test('stateToPath produces /s/ path', () => {
    const state = makeState({
      voices: [makeVoice()],
    });
    const encoded = serializeState(state);
    const path = stateToPath(state);
    expect(path).toBe(`/s/${encoded}`);
  });

  test('stateToPath produces / for empty voices', () => {
    const state = makeState();
    expect(stateToPath(state)).toBe('/');
  });

  test('pathToState parses /s/<data>', () => {
    const state = makeState({ voices: [makeVoice()] });
    const encoded = serializeState(state);
    const parsed = pathToState(`/s/${encoded}`);
    expect(parsed).not.toBeUndefined();
    expect(parsed.voices).toHaveLength(1);
    expect(parsed.voices[0].x).toBeCloseTo(0.5);
  });

  test('pathToState returns undefined for /', () => {
    expect(pathToState('/')).toBeUndefined();
  });

  test('pathToState returns undefined for non-/s/ paths', () => {
    expect(pathToState('/vibecheck')).toBeUndefined();
    expect(pathToState('/embed/foo')).toBeUndefined();
  });

  test('pathToState returns undefined for invalid data', () => {
    expect(pathToState('/s/!!invalid!!')).toBeUndefined();
  });
});
