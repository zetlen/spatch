import { describe, expect, test } from 'bun:test';
import {
  clampChromaToSRGB,
  getSolidFillColor,
  getSwatchColor,
  oklchToString,
} from '../../js/colors.ts';

describe('oklchToString', () => {
  test('formats OKLCH values correctly', () => {
    expect(oklchToString(200, 0.2, 0.5)).toBe('oklch(0.5 0.2 200)');
  });

  test('handles zero values', () => {
    expect(oklchToString(0, 0, 0)).toBe('oklch(0 0 0)');
  });

  test('handles max hue', () => {
    expect(oklchToString(360, 0.3, 1)).toBe('oklch(1 0.3 360)');
  });
});

describe('clampChromaToSRGB', () => {
  test('returns 0 for zero chroma', () => {
    expect(clampChromaToSRGB(0, 0, 0.5)).toBe(0);
  });

  test('returns input chroma when already in gamut', () => {
    // Low chroma values are always in gamut
    const result = clampChromaToSRGB(200, 0.05, 0.5);
    expect(result).toBeCloseTo(0.05, 2);
  });

  test('clamps high chroma that would be out of sRGB gamut', () => {
    // Very high chroma should be clamped
    const result = clampChromaToSRGB(200, 1.0, 0.5);
    expect(result).toBeLessThan(1.0);
    expect(result).toBeGreaterThan(0);
  });

  test('returns negative zero as 0', () => {
    expect(clampChromaToSRGB(0, -0.1, 0.5)).toBe(0);
  });
});

describe('getSwatchColor', () => {
  test('solid fill returns oklch string', () => {
    const fill = { h: 200, c: 0.2, l: 0.5, mode: 'solid' };
    expect(getSwatchColor(fill)).toBe('oklch(0.5 0.2 200)');
  });

  test('linear fill returns linear-gradient string', () => {
    const fill = {
      gradAngle: 45,
      h: 320,
      c: 0.25,
      l: 0.55,
      h2: 180,
      c2: 0.2,
      l2: 0.45,
      mode: 'linear',
    };
    const result = getSwatchColor(fill);
    expect(result).toContain('linear-gradient(');
    expect(result).toContain('135deg');
  });
});

describe('getSolidFillColor', () => {
  test('returns oklch string for solid fill', () => {
    const fill = { h: 200, c: 0.2, l: 0.5, mode: 'solid' };
    expect(getSolidFillColor(fill)).toBe('oklch(0.5 0.2 200)');
  });

  test('returns first color oklch for linear fill', () => {
    const fill = {
      gradAngle: 45,
      h: 320,
      c: 0.25,
      l: 0.55,
      h2: 180,
      c2: 0.2,
      l2: 0.45,
      mode: 'linear',
    };
    expect(getSolidFillColor(fill)).toBe('oklch(0.55 0.25 320)');
  });
});
