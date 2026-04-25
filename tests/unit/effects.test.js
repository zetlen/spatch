import { describe, expect, test } from 'bun:test';
import {
  BLEND_CONFIG,
  computeFMDepth,
  computeOverlap,
  computeTotalOverlap,
} from '../../js/effects.ts';

describe('computeOverlap', () => {
  test('identical positions and sizes return 1', () => {
    expect(computeOverlap({ x: 0.5, y: 0.5, size: 0.2 }, { x: 0.5, y: 0.5, size: 0.2 })).toBe(1);
  });

  test('non-overlapping shapes return 0', () => {
    // Two shapes far apart
    expect(computeOverlap({ x: 0.1, y: 0.1, size: 0.1 }, { x: 0.9, y: 0.9, size: 0.1 })).toBe(0);
  });

  test('partially overlapping shapes return between 0 and 1', () => {
    const overlap = computeOverlap({ x: 0.4, y: 0.5, size: 0.2 }, { x: 0.5, y: 0.5, size: 0.2 });
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(1);
  });

  test('overlap decreases with distance', () => {
    const close = computeOverlap({ x: 0.5, y: 0.5, size: 0.3 }, { x: 0.55, y: 0.5, size: 0.3 });
    const far = computeOverlap({ x: 0.5, y: 0.5, size: 0.3 }, { x: 0.7, y: 0.5, size: 0.3 });
    expect(close).toBeGreaterThan(far);
  });

  test('overlap increases with size', () => {
    const small = computeOverlap({ x: 0.4, y: 0.5, size: 0.1 }, { x: 0.6, y: 0.5, size: 0.1 });
    const big = computeOverlap({ x: 0.4, y: 0.5, size: 0.3 }, { x: 0.6, y: 0.5, size: 0.3 });
    expect(big).toBeGreaterThan(small);
  });

  test('zero size returns 0', () => {
    expect(computeOverlap({ x: 0.5, y: 0.5, size: 0 }, { x: 0.5, y: 0.5, size: 0 })).toBe(0);
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

describe('BLEND_CONFIG', () => {
  test('screen has type none', () => {
    expect(BLEND_CONFIG.screen.type).toBe('none');
  });

  test('multiply is sine cross-FM', () => {
    expect(BLEND_CONFIG.multiply.type).toBe('fm');
    expect(BLEND_CONFIG.multiply.config.maxIndex).toBeGreaterThan(0);
    expect(BLEND_CONFIG.multiply.config.maxIndex).toBeLessThanOrEqual(0.8);
    expect(BLEND_CONFIG.multiply.config.depthCurve).toBe('sqrt');
  });

  test('exclusion is ring modulation', () => {
    expect(BLEND_CONFIG.exclusion.type).toBe('ring');
  });

  test('difference is raw cross-FM', () => {
    expect(BLEND_CONFIG.difference.type).toBe('rawfm');
    expect(BLEND_CONFIG.difference.config.maxIndex).toBeGreaterThan(0);
    expect(BLEND_CONFIG.difference.config.maxIndex).toBeLessThanOrEqual(1.2);
    expect(BLEND_CONFIG.difference.config.depthCurve).toBe('linear');
  });

  test('FM modes are ordered: multiply < difference by intensity', () => {
    expect(BLEND_CONFIG.multiply.config.maxIndex).toBeLessThan(
      BLEND_CONFIG.difference.config.maxIndex,
    );
  });
});

describe('computeFMDepth', () => {
  const fmMultiply = BLEND_CONFIG.multiply.config;
  const fmDifference = BLEND_CONFIG.difference.config;

  test('returns 0 when overlap is 0', () => {
    expect(computeFMDepth(0, fmMultiply, 440)).toBe(0);
    expect(computeFMDepth(0, fmDifference, 440)).toBe(0);
  });

  test('is monotonic non-decreasing in overlap', () => {
    const steps = [0, 0.1, 0.25, 0.5, 0.75, 1];
    for (const cfg of [fmMultiply, fmDifference]) {
      const depths = steps.map((o) => computeFMDepth(o, cfg, 440));
      for (let i = 1; i < depths.length; i++) {
        expect(depths[i]).toBeGreaterThanOrEqual(depths[i - 1]);
      }
    }
  });

  test('respects the global deviation cap', () => {
    const highFreq = 784;
    const d = computeFMDepth(1, fmDifference, highFreq);
    expect(d).toBeLessThanOrEqual(600);
  });

  test('at full overlap, difference > multiply', () => {
    const m = computeFMDepth(1, fmMultiply, 200);
    const d = computeFMDepth(1, fmDifference, 200);
    expect(d).toBeGreaterThan(m);
  });
});
