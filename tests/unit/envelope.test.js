import { describe, expect, test } from 'bun:test';
import { dragToEnvelopeValue, envelopeToCornerRadii } from '../../js/envelope.ts';

const CANVAS_SIZE = 800;
const MAX_RADIUS = CANVAS_SIZE * 0.15; // 120

describe('envelopeToCornerRadii', () => {
  test('default envelope produces expected radii', () => {
    const envelope = { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 };
    const radii = envelopeToCornerRadii(envelope, CANVAS_SIZE);

    expect(radii.bottomLeft).toBeCloseTo((0.1 / 2) * MAX_RADIUS);
    expect(radii.topLeft).toBeCloseTo((0.2 / 2) * MAX_RADIUS);
    expect(radii.topRight).toBeCloseTo(0.7 * MAX_RADIUS);
    expect(radii.bottomRight).toBeCloseTo((0.4 / 3) * MAX_RADIUS);
  });

  test('zero envelope produces zero radii', () => {
    const envelope = { attack: 0, decay: 0, release: 0, sustain: 0 };
    const radii = envelopeToCornerRadii(envelope, CANVAS_SIZE);

    expect(radii.bottomLeft).toBe(0);
    expect(radii.topLeft).toBe(0);
    expect(radii.topRight).toBe(0);
    expect(radii.bottomRight).toBe(0);
  });

  test('max envelope values produce expected radii', () => {
    const envelope = { attack: 2, decay: 2, release: 3, sustain: 1 };
    const radii = envelopeToCornerRadii(envelope, CANVAS_SIZE);

    expect(radii.bottomLeft).toBeCloseTo(MAX_RADIUS);
    expect(radii.topLeft).toBeCloseTo(MAX_RADIUS);
    expect(radii.topRight).toBeCloseTo(MAX_RADIUS);
    expect(radii.bottomRight).toBeCloseTo(MAX_RADIUS);
  });

  test('scales with canvas size', () => {
    const envelope = { attack: 1, decay: 1, release: 1.5, sustain: 0.5 };
    const radii400 = envelopeToCornerRadii(envelope, 400);
    const radii800 = envelopeToCornerRadii(envelope, 800);

    expect(radii800.bottomLeft).toBeCloseTo(radii400.bottomLeft * 2);
    expect(radii800.topLeft).toBeCloseTo(radii400.topLeft * 2);
  });
});

describe('dragToEnvelopeValue', () => {
  test('attack: clamps to [0.01, 2.0]', () => {
    expect(dragToEnvelopeValue('attack', 0, CANVAS_SIZE)).toBe(0.01);
    expect(dragToEnvelopeValue('attack', MAX_RADIUS, CANVAS_SIZE)).toBeCloseTo(2);
    // Beyond max
    expect(dragToEnvelopeValue('attack', MAX_RADIUS * 2, CANVAS_SIZE)).toBe(2);
  });

  test('decay: clamps to [0.01, 2.0]', () => {
    expect(dragToEnvelopeValue('decay', 0, CANVAS_SIZE)).toBe(0.01);
    expect(dragToEnvelopeValue('decay', MAX_RADIUS, CANVAS_SIZE)).toBeCloseTo(2);
  });

  test('sustain: clamps to [0, 1.0]', () => {
    expect(dragToEnvelopeValue('sustain', 0, CANVAS_SIZE)).toBe(0);
    expect(dragToEnvelopeValue('sustain', MAX_RADIUS, CANVAS_SIZE)).toBeCloseTo(1);
    expect(dragToEnvelopeValue('sustain', MAX_RADIUS * 2, CANVAS_SIZE)).toBe(1);
  });

  test('release: clamps to [0.01, 3.0]', () => {
    expect(dragToEnvelopeValue('release', 0, CANVAS_SIZE)).toBe(0.01);
    expect(dragToEnvelopeValue('release', MAX_RADIUS, CANVAS_SIZE)).toBeCloseTo(3);
    expect(dragToEnvelopeValue('release', MAX_RADIUS * 2, CANVAS_SIZE)).toBe(3);
  });

  test('mid-range drag produces proportional value', () => {
    const halfMax = MAX_RADIUS / 2;
    expect(dragToEnvelopeValue('attack', halfMax, CANVAS_SIZE)).toBeCloseTo(1);
    expect(dragToEnvelopeValue('sustain', halfMax, CANVAS_SIZE)).toBeCloseTo(0.5);
    expect(dragToEnvelopeValue('release', halfMax, CANVAS_SIZE)).toBeCloseTo(1.5);
  });
});
