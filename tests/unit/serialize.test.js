import { describe, test, expect } from 'bun:test';
import LZString from 'lz-string';
import { serializeState, deserializeState, _serializeToJSON } from '../../js/serialize.ts';

function makeState(overrides = {}) {
  return {
    envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    shapes: [],
    decorations: [],
    ...overrides,
  };
}

function makeShape(overrides = {}) {
  return {
    id: 'test1',
    type: 'circle',
    x: 0.5,
    y: 0.5,
    size: 0.12,
    rotation: 45,
    fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    pattern: null,
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
    expect(decoded.shapes).toHaveLength(0);
    expect(decoded.decorations).toHaveLength(0);
  });

  test('state with shapes round-trips (values and IDs preserved)', () => {
    const state = makeState({
      shapes: [
        makeShape({ id: 'original1', type: 'circle', x: 0.3, y: 0.7, size: 0.15, rotation: 90 }),
        makeShape({
          id: 'original2',
          type: 'square',
          x: 0.8,
          y: 0.2,
          size: 0.2,
          rotation: 180,
          pattern: 'stripes',
        }),
      ],
    });

    const encoded = serializeState(state);
    const decoded = deserializeState(encoded);

    expect(decoded.shapes).toHaveLength(2);

    // Values preserved
    expect(decoded.shapes[0].type).toBe('circle');
    expect(decoded.shapes[0].x).toBeCloseTo(0.3);
    expect(decoded.shapes[0].y).toBeCloseTo(0.7);
    expect(decoded.shapes[0].size).toBeCloseTo(0.15);
    expect(decoded.shapes[0].rotation).toBe(90);

    expect(decoded.shapes[1].type).toBe('square');
    expect(decoded.shapes[1].pattern).toBe('stripes');

    // IDs are preserved through round-trip
    expect(decoded.shapes[0].id).toBe('original1');
    expect(decoded.shapes[1].id).toBe('original2');
  });

  test('all shape types survive round-trip', () => {
    const state = makeState({
      shapes: [
        makeShape({ type: 'triangle' }),
        makeShape({ type: 'square' }),
        makeShape({ type: 'circle' }),
      ],
    });

    const decoded = deserializeState(serializeState(state));
    expect(decoded.shapes.map((s) => s.type)).toEqual(['triangle', 'square', 'circle']);
  });

  test('all fill modes survive round-trip', () => {
    const solidShape = makeShape({
      fill: { mode: 'solid', h: 120, s: 50, l: 60 },
    });
    const radialShape = makeShape({
      fill: { mode: 'radial', h: 200, s: 80, l: 50, h2: 100, s2: 60, l2: 40 },
    });
    const linearShape = makeShape({
      fill: { mode: 'linear', gradAngle: 90, h: 100, s: 50, l: 40, h2: 200, s2: 70, l2: 60 },
    });

    const state = makeState({ shapes: [solidShape, radialShape, linearShape] });
    const decoded = deserializeState(serializeState(state));

    expect(decoded.shapes[0].fill.mode).toBe('solid');
    expect(decoded.shapes[0].fill.h).toBe(120);

    expect(decoded.shapes[1].fill.mode).toBe('radial');
    expect(decoded.shapes[1].fill.h).toBe(200);
    expect(decoded.shapes[1].fill.h2).toBe(100);

    expect(decoded.shapes[2].fill.mode).toBe('linear');
    expect(decoded.shapes[2].fill.gradAngle).toBe(90);
    expect(decoded.shapes[2].fill.h).toBe(100);
  });

  test('all patterns survive round-trip', () => {
    const patterns = ['stripes', 'checker', 'noise', 'gradient', 'rough'];
    const state = makeState({
      shapes: patterns.map((p) => makeShape({ pattern: p })),
    });

    const decoded = deserializeState(serializeState(state));
    const decodedPatterns = decoded.shapes.map((s) => s.pattern);
    expect(decodedPatterns).toEqual(patterns);
  });

  test('decorations round-trip (squiggle with points)', () => {
    const state = makeState({
      decorations: [
        {
          id: 'd1',
          type: 'squiggle',
          points: [
            [0.1, 0.2],
            [0.3, 0.4],
            [0.5, 0.6],
          ],
          text: null,
          targetShapeId: null,
          x: 0.1,
          y: 0.2,
          strokeColor: 'hsl(320, 100%, 60%)',
          strokeWidth: 3,
          fontSize: 24,
        },
      ],
    });

    const decoded = deserializeState(serializeState(state));
    expect(decoded.decorations).toHaveLength(1);
    expect(decoded.decorations[0].type).toBe('squiggle');
    expect(decoded.decorations[0].points).toHaveLength(3);
    expect(decoded.decorations[0].points[0][0]).toBeCloseTo(0.1);
    expect(decoded.decorations[0].points[0][1]).toBeCloseTo(0.2);
  });

  test('text decoration round-trips', () => {
    const state = makeState({
      decorations: [
        {
          id: 'd2',
          type: 'text',
          points: [],
          text: 'Hello World',
          targetShapeId: null,
          x: 0.5,
          y: 0.5,
          strokeColor: '#fff',
          strokeWidth: 2,
          fontSize: 32,
        },
      ],
    });

    const decoded = deserializeState(serializeState(state));
    expect(decoded.decorations[0].type).toBe('text');
    expect(decoded.decorations[0].text).toBe('Hello World');
    expect(decoded.decorations[0].fontSize).toBe(32);
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
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });

  test('output is URL-safe (no special chars needing encoding)', () => {
    const encoded = serializeState(
      makeState({
        shapes: [makeShape()],
        decorations: [
          {
            id: 'd1',
            type: 'text',
            points: [],
            text: 'Test!@#',
            targetShapeId: null,
            x: 0,
            y: 0,
            strokeColor: '#fff',
            strokeWidth: 2,
            fontSize: 24,
          },
        ],
      }),
    );
    // LZ-string compressToEncodedURIComponent uses A-Z, a-z, 0-9, +, -, =
    expect(encoded).toMatch(/^[A-Za-z0-9+\-=]*$/);
  });

  test('serialized output includes v: 1 version field', () => {
    const json = _serializeToJSON(makeState({ shapes: [makeShape()] }));
    const compact = JSON.parse(json);
    expect(compact.v).toBe(1);
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
    expect(decoded.shapes).toHaveLength(1);
    expect(decoded.shapes[0].id).toBe('legacy1');
    expect(decoded.shapes[0].type).toBe('circle');
    expect(decoded.shapes[0].x).toBeCloseTo(0.5);
    expect(decoded.shapes[0].fill.mode).toBe('solid');
  });

  test('legacy format with decorations still works', () => {
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
          c: '#fff',
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
    expect(decoded.decorations).toHaveLength(1);
    expect(decoded.decorations[0].type).toBe('text');
    expect(decoded.decorations[0].text).toBe('Legacy Text');
    expect(decoded.decorations[0].fontSize).toBe(32);
  });
});
