import { describe, test, expect } from 'bun:test';
import { hslToString, getSwatchColor } from '../../js/colors.ts';

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

describe('getSwatchColor', () => {
  test('solid fill returns hsl string', () => {
    const fill = { mode: 'solid', h: 200, s: 80, l: 50 };
    expect(getSwatchColor(fill)).toBe('hsl(200, 80%, 50%)');
  });

  test('linear fill returns linear-gradient string', () => {
    const fill = {
      mode: 'linear',
      gradAngle: 45,
      h: 320,
      s: 90,
      l: 55,
      h2: 180,
      s2: 80,
      l2: 45,
    };
    const result = getSwatchColor(fill);
    expect(result).toContain('linear-gradient(');
    expect(result).toContain('45deg');
  });

  // Unknown fill mode test removed: Fill is now a discriminated union,
  // so only valid modes can be constructed.
});
