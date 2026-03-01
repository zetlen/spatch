import { describe, test, expect } from 'bun:test';
import { labToRgb, hslToString, labToString, getSwatchColor } from '../../js/colors.js';

describe('labToRgb', () => {
  test('L=0, a=0, b=0 (Lab black) → RGB near black', () => {
    const [r, g, b] = labToRgb(0, 0, 0);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  test('L=100, a=0, b=0 (Lab white) → RGB near white', () => {
    const [r, g, b] = labToRgb(100, 0, 0);
    expect(r).toBeGreaterThanOrEqual(254);
    expect(g).toBeGreaterThanOrEqual(254);
    expect(b).toBeGreaterThanOrEqual(254);
  });

  test('L=50, a=0, b=0 (Lab mid-gray) → RGB mid-gray', () => {
    const [r, g, b] = labToRgb(50, 0, 0);
    // Mid-gray is around 119
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(140);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  test('clamps output to 0-255 range', () => {
    // Extreme Lab values that might produce out-of-gamut results
    const [r, g, b] = labToRgb(50, 128, 128);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(255);
  });

  test('returns integers', () => {
    const [r, g, b] = labToRgb(60, 20, -30);
    expect(Number.isInteger(r)).toBe(true);
    expect(Number.isInteger(g)).toBe(true);
    expect(Number.isInteger(b)).toBe(true);
  });
});

describe('hslToString', () => {
  test('formats HSL values correctly', () => {
    expect(hslToString(200, 80, 50)).toBe('hsl(200, 80%, 50%)');
  });

  test('handles zero values', () => {
    expect(hslToString(0, 0, 0)).toBe('hsl(0, 0%, 0%)');
  });

  test('handles max values', () => {
    expect(hslToString(360, 100, 100)).toBe('hsl(360, 100%, 100%)');
  });
});

describe('labToString', () => {
  test('converts Lab to rgb() string', () => {
    const result = labToString(0, 0, 0);
    expect(result).toBe('rgb(0,0,0)');
  });

  test('converts Lab white to rgb string near 255', () => {
    const result = labToString(100, 0, 0);
    expect(result).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });
});

describe('getSwatchColor', () => {
  test('solid fill returns hsl string', () => {
    const fill = { mode: 'solid', h: 200, s: 80, l: 50 };
    expect(getSwatchColor(fill)).toBe('hsl(200, 80%, 50%)');
  });

  test('radial fill returns rgb string from Lab values', () => {
    const fill = { mode: 'radial', labL: 60, labA: 0, labB: 0 };
    const result = getSwatchColor(fill);
    expect(result).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  test('linear fill returns linear-gradient string', () => {
    const fill = {
      mode: 'linear',
      gradAngle: 45,
      h1: 320,
      s1: 90,
      l1: 55,
      h2: 180,
      s2: 80,
      l2: 45,
    };
    const result = getSwatchColor(fill);
    expect(result).toContain('linear-gradient(');
    expect(result).toContain('45deg');
  });

  test('unknown fill mode returns fallback magenta', () => {
    const fill = { mode: 'unknown' };
    expect(getSwatchColor(fill)).toBe('#ff00ff');
  });
});
