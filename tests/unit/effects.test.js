import { describe, expect, test } from 'bun:test';
import { computeOverlap, computeTotalOverlap } from '../../js/effects.ts';

describe('computeOverlap', () => {
  test('identical positions and sizes return 1', () => {
    expect(computeOverlap(0.5, 0.5, 0.2, 0.5, 0.5, 0.2)).toBe(1);
  });

  test('non-overlapping shapes return 0', () => {
    // Two shapes far apart
    expect(computeOverlap(0.1, 0.1, 0.1, 0.9, 0.9, 0.1)).toBe(0);
  });

  test('partially overlapping shapes return between 0 and 1', () => {
    const overlap = computeOverlap(0.4, 0.5, 0.2, 0.5, 0.5, 0.2);
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(1);
  });

  test('overlap decreases with distance', () => {
    const close = computeOverlap(0.5, 0.5, 0.3, 0.55, 0.5, 0.3);
    const far = computeOverlap(0.5, 0.5, 0.3, 0.7, 0.5, 0.3);
    expect(close).toBeGreaterThan(far);
  });

  test('overlap increases with size', () => {
    const small = computeOverlap(0.4, 0.5, 0.1, 0.6, 0.5, 0.1);
    const big = computeOverlap(0.4, 0.5, 0.3, 0.6, 0.5, 0.3);
    expect(big).toBeGreaterThan(small);
  });

  test('zero size returns 0', () => {
    expect(computeOverlap(0.5, 0.5, 0, 0.5, 0.5, 0)).toBe(0);
  });
});

describe('computeTotalOverlap', () => {
  test('single voice has 0 overlap', () => {
    const voices = [{ size: 0.2, x: 0.5, y: 0.5 }];
    expect(computeTotalOverlap(0, voices)).toBe(0);
  });

  test('two distant voices have 0 overlap', () => {
    const voices = [
      { size: 0.1, x: 0.1, y: 0.1 },
      { size: 0.1, x: 0.9, y: 0.9 },
    ];
    expect(computeTotalOverlap(0, voices)).toBe(0);
    expect(computeTotalOverlap(1, voices)).toBe(0);
  });

  test('two overlapping voices produce non-zero total', () => {
    const voices = [
      { size: 0.3, x: 0.5, y: 0.5 },
      { size: 0.3, x: 0.55, y: 0.5 },
    ];
    expect(computeTotalOverlap(0, voices)).toBeGreaterThan(0);
  });

  test('total overlap is clamped to 1', () => {
    // Many voices stacked on top of each other
    const voices = Array.from({ length: 10 }, () => ({ size: 0.3, x: 0.5, y: 0.5 }));
    expect(computeTotalOverlap(0, voices)).toBe(1);
  });
});
