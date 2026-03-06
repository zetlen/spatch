import { describe, expect, test } from 'bun:test';
import { deserializeState, serializeState } from '../../js/serialize.ts';

function makeState(overrides = {}) {
  return {
    envelope: { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
    reverb: undefined,
    voices: [],
    ...overrides,
  };
}

function makeVoice(overrides = {}) {
  return {
    blend: 'soft-light',
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

    expect(decoded.voices[0].waveform).toBe('sine');
    expect(decoded.voices[0].x).toBeCloseTo(0.3);
    expect(decoded.voices[0].y).toBeCloseTo(0.7);
    expect(decoded.voices[0].size).toBeCloseTo(0.15);

    expect(decoded.voices[1].waveform).toBe('pulse');
    expect(decoded.voices[1].effect).toBe('stripes');
    expect(decoded.voices[1].timbre).toBeCloseTo(0.5);

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
    expect(decoded.voices.map((v) => v.waveform)).toEqual(['blend', 'pulse', 'sine']);
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

    expect(decoded.voices[0].fill.mode).toBe('solid');
    expect(decoded.voices[0].fill.h).toBe(120);

    expect(decoded.voices[1].fill.mode).toBe('linear');
    expect(decoded.voices[1].fill.gradAngle).toBe(90);
    expect(decoded.voices[1].fill.h).toBe(100);

    expect(decoded.voices[2].fill.h).toBe(360);
    expect(decoded.voices[2].fill.s).toBe(100);
    expect(decoded.voices[2].fill.l).toBe(100);
  });

  test('all blend modes survive round-trip', () => {
    const blends = [
      'soft-light',
      'multiply',
      'screen',
      'overlay',
      'color-burn',
      'difference',
      'exclusion',
    ];
    const state = makeState({
      voices: blends.map((b) => makeVoice({ blend: b })),
    });

    const decoded = deserializeState(serializeState(state));
    const decodedBlends = decoded.voices.map((v) => v.blend);
    expect(decodedBlends).toEqual(blends);
  });

  test('borders survive round-trip', () => {
    const state = makeState({
      voices: [
        makeVoice({ border: undefined }),
        makeVoice({ border: { color: 'white', double: false, thickness: 0.5 } }),
        makeVoice({ border: { color: 'black', double: true, thickness: 0.8 } }),
        makeVoice({ border: { color: 'black', double: false, thickness: 0.2 } }),
        makeVoice({ border: { color: 'white', double: true, thickness: 0.9 } }),
      ],
    });

    const decoded = deserializeState(serializeState(state));
    expect(decoded.voices[0].border).toBeUndefined();

    expect(decoded.voices[1].border).not.toBeUndefined();
    expect(decoded.voices[1].border.color).toBe('white');
    expect(decoded.voices[1].border.double).toBe(false);
    expect(decoded.voices[1].border.thickness).toBeCloseTo(0.5);

    expect(decoded.voices[2].border).not.toBeUndefined();
    expect(decoded.voices[2].border.color).toBe('black');
    expect(decoded.voices[2].border.double).toBe(true);
    expect(decoded.voices[2].border.thickness).toBeCloseTo(0.8);

    expect(decoded.voices[3].border).not.toBeUndefined();
    expect(decoded.voices[3].border.color).toBe('black');
    expect(decoded.voices[3].border.double).toBe(false);
    expect(decoded.voices[3].border.thickness).toBeCloseTo(0.2);

    expect(decoded.voices[4].border).not.toBeUndefined();
    expect(decoded.voices[4].border.color).toBe('white');
    expect(decoded.voices[4].border.double).toBe(true);
    expect(decoded.voices[4].border.thickness).toBeCloseTo(0.9);
  });

  test('all effects survive round-trip', () => {
    const effects = ['stripes', 'checker', 'noise', 'gradient'];
    const state = makeState({
      voices: effects.map((e) => makeVoice({ effect: e })),
    });

    const decoded = deserializeState(serializeState(state));
    const decodedEffects = decoded.voices.map((v) => v.effect);
    expect(decodedEffects).toEqual(effects);
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

describe('reverb serialization', () => {
  test('null reverb round-trips', () => {
    const state = makeState({ reverb: undefined });
    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);
    expect(decoded.reverb).toBeUndefined();
  });

  test('glow reverb round-trips', () => {
    const state = makeState({ reverb: { depth: 0.6, style: 'glow' } });
    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);
    expect(decoded.reverb).not.toBeUndefined();
    expect(decoded.reverb.style).toBe('glow');
    expect(decoded.reverb.depth).toBeCloseTo(0.6);
  });

  test('dim reverb round-trips', () => {
    const state = makeState({ reverb: { depth: 0.3, style: 'dim' } });
    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);
    expect(decoded.reverb.style).toBe('dim');
    expect(decoded.reverb.depth).toBeCloseTo(0.3);
  });
});
