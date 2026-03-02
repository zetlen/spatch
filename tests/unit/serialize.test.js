import { describe, test, expect } from 'bun:test';
import LZString from 'lz-string';
import { serializeState, deserializeState, _serializeToJSON } from '../../js/serialize.ts';

function makeState(overrides = {}) {
  return {
    envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    voices: [],
    texts: [],
    ...overrides,
  };
}

function makeVoice(overrides = {}) {
  return {
    id: 'test1',
    waveform: 'sine',
    x: 0.5,
    y: 0.5,
    size: 0.12,
    fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    effect: null,
    ...overrides,
  };
}

describe('serializeState / deserializeState round-trip', () => {
  test('empty state round-trips correctly', () => {
    const state = makeState();
    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded.envelope.attack).toBeCloseTo(state.envelope.attack);
    expect(decoded.envelope.decay).toBeCloseTo(state.envelope.decay);
    expect(decoded.envelope.sustain).toBeCloseTo(state.envelope.sustain);
    expect(decoded.envelope.release).toBeCloseTo(state.envelope.release);
    expect(decoded.voices).toHaveLength(0);
    expect(decoded.texts).toHaveLength(0);
  });

  test('state with voices round-trips (values and IDs preserved)', () => {
    const state = makeState({
      voices: [
        makeVoice({ id: 'original1', waveform: 'sine', x: 0.3, y: 0.7, size: 0.15 }),
        makeVoice({
          id: 'original2',
          waveform: 'pulse',
          x: 0.8,
          y: 0.2,
          size: 0.2,
          timbre: 0.5,
          effect: 'stripes',
        }),
      ],
    });

    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);

    expect(decoded.voices).toHaveLength(2);

    // Values preserved
    expect(decoded.voices[0].waveform).toBe('sine');
    expect(decoded.voices[0].x).toBeCloseTo(0.3);
    expect(decoded.voices[0].y).toBeCloseTo(0.7);
    expect(decoded.voices[0].size).toBeCloseTo(0.15);

    expect(decoded.voices[1].waveform).toBe('pulse');
    expect(decoded.voices[1].effect).toBe('stripes');
    expect(decoded.voices[1].timbre).toBeCloseTo(0.5);

    // IDs are preserved through round-trip
    expect(decoded.voices[0].id).toBe('original1');
    expect(decoded.voices[1].id).toBe('original2');
  });

  test('all waveform types survive round-trip', () => {
    const state = makeState({
      voices: [
        makeVoice({ waveform: 'blend', timbre: 0.3 }),
        makeVoice({ waveform: 'pulse', timbre: 0.7 }),
        makeVoice({ waveform: 'sine' }),
      ],
    });

    const decoded = deserializeState(serializeState(state));
    expect(decoded.voices.map((v) => v.waveform)).toEqual(['blend', 'pulse', 'sine']);
  });

  test('all fill modes survive round-trip', () => {
    const solidVoice = makeVoice({
      fill: { mode: 'solid', h: 120, s: 50, l: 60 },
    });
    const radialVoice = makeVoice({
      fill: { mode: 'radial', h: 200, s: 80, l: 50, h2: 100, s2: 60, l2: 40 },
    });
    const linearVoice = makeVoice({
      fill: { mode: 'linear', gradAngle: 90, h: 100, s: 50, l: 40, h2: 200, s2: 70, l2: 60 },
    });

    const state = makeState({ voices: [solidVoice, radialVoice, linearVoice] });
    const decoded = deserializeState(serializeState(state));

    expect(decoded.voices[0].fill.mode).toBe('solid');
    expect(decoded.voices[0].fill.h).toBe(120);

    expect(decoded.voices[1].fill.mode).toBe('radial');
    expect(decoded.voices[1].fill.h).toBe(200);
    expect(decoded.voices[1].fill.h2).toBe(100);

    expect(decoded.voices[2].fill.mode).toBe('linear');
    expect(decoded.voices[2].fill.gradAngle).toBe(90);
    expect(decoded.voices[2].fill.h).toBe(100);
  });

  test('all effects survive round-trip', () => {
    const effects = ['stripes', 'checker', 'noise', 'gradient', 'rough'];
    const state = makeState({
      voices: effects.map((e) => makeVoice({ effect: e })),
    });

    const decoded = deserializeState(serializeState(state));
    const decodedEffects = decoded.voices.map((v) => v.effect);
    expect(decodedEffects).toEqual(effects);
  });

  test('text decorations round-trip', () => {
    const state = makeState({
      texts: [
        {
          id: 't1',
          text: 'Hello World',
          x: 0.5,
          y: 0.5,
          size: 0.06,
          color: { h: 50, s: 100, l: 60 },
        },
      ],
    });

    const decoded = deserializeState(serializeState(state));
    expect(decoded.texts).toHaveLength(1);
    expect(decoded.texts[0].text).toBe('Hello World');
    expect(decoded.texts[0].color.h).toBe(50);
    expect(decoded.texts[0].size).toBeCloseTo(0.06);
  });

  test('max envelope values round-trip', () => {
    const state = makeState({
      envelope: { attack: 2.0, decay: 2.0, sustain: 1.0, release: 3.0 },
    });
    const decoded = deserializeState(serializeState(state));
    expect(decoded.envelope.attack).toBe(2.0);
    expect(decoded.envelope.decay).toBe(2.0);
    expect(decoded.envelope.sustain).toBe(1.0);
    expect(decoded.envelope.release).toBe(3.0);
  });
});

describe('deserializeState edge cases', () => {
  test('returns null for invalid input', () => {
    expect(deserializeState('')).toBeNull();
    expect(deserializeState('garbage')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(deserializeState('')).toBeNull();
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
        voices: [makeVoice()],
        texts: [
          {
            id: 't1',
            text: 'Test!@#',
            x: 0,
            y: 0,
            size: 0.06,
            color: { h: 50, s: 100, l: 60 },
          },
        ],
      }),
    );
    // LZ-string compressToEncodedURIComponent uses A-Z, a-z, 0-9, +, -, =
    expect(encoded).toMatch(/^[A-Za-z0-9+\-=]*$/);
  });

  test('serialized output includes v: 2 version field', () => {
    const json = _serializeToJSON(makeState({ voices: [makeVoice()] }));
    const compact = JSON.parse(json);
    expect(compact.v).toBe(2);
  });
});

describe('legacy format (no v field) backwards compat', () => {
  test('deserializes legacy format without v field', () => {
    // Manually construct a legacy compact format (no v field)
    const legacy = {
      e: { a: 0.1, d: 0.2, s: 0.7, r: 0.4 },
      sh: [
        {
          i: 'legacy1',
          t: 'c',
          x: 0.5,
          y: 0.5,
          z: 0.12,
          r: 45,
          f: { m: 's', h: 200, s: 80, l: 50 },
          p: 0,
        },
      ],
      d: [],
    };
    const json = JSON.stringify(legacy);
    const encoded = LZString.compressToEncodedURIComponent(json);
    const decoded = deserializeState(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded.voices).toHaveLength(1);
    expect(decoded.voices[0].id).toBe('legacy1');
    expect(decoded.voices[0].waveform).toBe('sine'); // 'c' (circle) -> sine
    expect(decoded.voices[0].x).toBeCloseTo(0.5);
    expect(decoded.voices[0].fill.mode).toBe('solid');
  });

  test('legacy format with text decorations still works', () => {
    const legacy = {
      e: { a: 0.1, d: 0.2, s: 0.7, r: 0.4 },
      sh: [],
      d: [
        {
          i: 'dlegacy1',
          t: 't',
          p: [],
          x: 0.5,
          y: 0.5,
          c: 'hsl(50, 100%, 60%)',
          w: 2,
          tx: 'Legacy Text',
          fs: 32,
        },
      ],
    };
    const json = JSON.stringify(legacy);
    const encoded = LZString.compressToEncodedURIComponent(json);
    const decoded = deserializeState(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded.texts).toHaveLength(1);
    expect(decoded.texts[0].text).toBe('Legacy Text');
    expect(decoded.texts[0].color.h).toBe(50);
    expect(decoded.texts[0].color.s).toBe(100);
    expect(decoded.texts[0].color.l).toBe(60);
  });

  test('legacy format drops squiggles and curlicues', () => {
    const legacy = {
      e: { a: 0.1, d: 0.2, s: 0.7, r: 0.4 },
      sh: [],
      d: [
        { i: 'd1', t: 's', p: [[0.1, 0.2], [0.3, 0.4]], x: 0, y: 0, c: '#f00', w: 3 },
        { i: 'd2', t: 'c', p: [], x: 0.5, y: 0.5, c: '#0f0', w: 2 },
        { i: 'd3', t: 't', p: [], x: 0.5, y: 0.5, c: 'hsl(100, 80%, 50%)', w: 2, tx: 'Keep me' },
      ],
    };
    const json = JSON.stringify(legacy);
    const encoded = LZString.compressToEncodedURIComponent(json);
    const decoded = deserializeState(encoded);

    // Only the text decoration should survive
    expect(decoded.texts).toHaveLength(1);
    expect(decoded.texts[0].text).toBe('Keep me');
  });
});
