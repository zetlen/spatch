import { describe, expect, test } from 'bun:test';
import { _serializeToJSON, deserializeState, serializeState } from '../../js/serialize.ts';

function makeState(overrides = {}) {
  return {
    envelope: { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
    reverb: undefined,
    texts: [],
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
    expect(decoded.texts).toHaveLength(0);
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

    const state = makeState({ voices: [solidVoice, linearVoice] });
    const decoded = deserializeState(serializeState(state));

    expect(decoded.voices[0].fill.mode).toBe('solid');
    expect(decoded.voices[0].fill.h).toBe(120);

    expect(decoded.voices[1].fill.mode).toBe('linear');
    expect(decoded.voices[1].fill.gradAngle).toBe(90);
    expect(decoded.voices[1].fill.h).toBe(100);
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

  test('text decorations round-trip', () => {
    const state = makeState({
      texts: [{ id: 't1', size: 0.06, text: 'Hello World', x: 0.5, y: 0.5 }],
    });

    const decoded = deserializeState(serializeState(state));
    expect(decoded.texts).toHaveLength(1);
    expect(decoded.texts[0].text).toBe('Hello World');
    expect(decoded.texts[0].size).toBeCloseTo(0.06);
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
  test('returns null for invalid input', () => {
    expect(deserializeState('')).toBeUndefined();
    expect(deserializeState('garbage')).toBeUndefined();
  });

  test('returns null for empty string', () => {
    expect(deserializeState('')).toBeUndefined();
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

  test('old URLs without reverb deserialize with null reverb', () => {
    const state = makeState();
    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);
    expect(decoded.reverb).toBeUndefined();
  });
});

describe('serializeState output', () => {
  test('produces a non-empty string', () => {
    const encoded = serializeState(makeState());
    expect(encoded.length).toBeGreaterThan(0);
  });

  test('output is URL-safe (no special chars needing encoding)', () => {
    const encoded = serializeState(
      makeState({
        texts: [{ id: 't1', size: 0.06, text: 'Test!@#', x: 0, y: 0 }],
        voices: [makeVoice()],
      }),
    );
    // LZ-string compressToEncodedURIComponent uses A-Z, a-z, 0-9, +, -, =
    expect(encoded).toMatch(/^[A-Za-z0-9+\-=]*$/);
  });

  test('wire format is positional arrays with no keys or IDs', () => {
    const json = _serializeToJSON(makeState({ voices: [makeVoice()] }));
    const packed = JSON.parse(json);
    // Top level is [envelope, voices, texts]
    expect(Array.isArray(packed)).toBe(true);
    expect(packed).toHaveLength(3);
    // Envelope is [a, d, s, r]
    expect(packed[0]).toEqual([0.1, 0.2, 0.7, 0.4]);
    // Voice is [waveform, x, y, size, fill, effect, blend, border]
    expect(packed[1]).toHaveLength(1);
    expect(packed[1][0][0]).toBe('s'); // Sine
    expect(packed[1][0][6]).toBe('S'); // Soft-light blend
    expect(packed[1][0][7]).toBe(0); // No border
    // No keys, no IDs anywhere
    expect(json).not.toContain('"id"');
    expect(json).not.toContain('"waveform"');
    expect(json).not.toContain('"voices"');
  });
});
