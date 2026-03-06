import { describe, expect, test } from 'bun:test';
import { dragToEnvelopeValue } from '../../js/shapes.ts';

const MAX_RADIUS = 0.15; // MAX_RADIUS_PCT / 100

describe('dragToEnvelopeValue', () => {
  test('attack: clamps to [0.01, 2.0]', () => {
    expect(dragToEnvelopeValue('attack', 0)).toBe(0.01);
    expect(dragToEnvelopeValue('attack', MAX_RADIUS)).toBeCloseTo(2);
    // Beyond max
    expect(dragToEnvelopeValue('attack', MAX_RADIUS * 2)).toBe(2);
  });

  test('decay: clamps to [0.01, 2.0]', () => {
    expect(dragToEnvelopeValue('decay', 0)).toBe(0.01);
    expect(dragToEnvelopeValue('decay', MAX_RADIUS)).toBeCloseTo(2);
  });

  test('sustain: clamps to [0, 1.0]', () => {
    expect(dragToEnvelopeValue('sustain', 0)).toBe(0);
    expect(dragToEnvelopeValue('sustain', MAX_RADIUS)).toBeCloseTo(1);
    expect(dragToEnvelopeValue('sustain', MAX_RADIUS * 2)).toBe(1);
  });

  test('release: clamps to [0.01, 3.0]', () => {
    expect(dragToEnvelopeValue('release', 0)).toBe(0.01);
    expect(dragToEnvelopeValue('release', MAX_RADIUS)).toBeCloseTo(3);
    expect(dragToEnvelopeValue('release', MAX_RADIUS * 2)).toBe(3);
  });

  test('mid-range drag produces proportional value', () => {
    const halfMax = MAX_RADIUS / 2;
    expect(dragToEnvelopeValue('attack', halfMax)).toBeCloseTo(1);
    expect(dragToEnvelopeValue('sustain', halfMax)).toBeCloseTo(0.5);
    expect(dragToEnvelopeValue('release', halfMax)).toBeCloseTo(1.5);
  });
});
