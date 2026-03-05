import { describe, expect, test } from 'bun:test';
import {
  getSolidFillColor,
  getSwatchColor,
  hexToHsl,
  hslToHex,
  hslToString,
} from '../../js/colors.ts';

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
    const fill = { h: 200, l: 50, mode: 'solid', s: 80 };
    expect(getSwatchColor(fill)).toBe('hsl(200, 80%, 50%)');
  });

  test('linear fill returns linear-gradient string', () => {
    const fill = {
      gradAngle: 45,
      h: 320,
      h2: 180,
      l: 55,
      l2: 45,
      mode: 'linear',
      s: 90,
      s2: 80,
    };
    const result = getSwatchColor(fill);
    expect(result).toContain('linear-gradient(');
    expect(result).toContain('135deg');
  });

  // Unknown fill mode test removed: Fill is now a discriminated union,
  // So only valid modes can be constructed.
});

describe('getSolidFillColor', () => {
  test('returns hsl string for solid fill', () => {
    const fill = { h: 200, l: 50, mode: 'solid', s: 80 };
    expect(getSolidFillColor(fill)).toBe('hsl(200, 80%, 50%)');
  });

  test('returns first color hsl for linear fill', () => {
    const fill = { gradAngle: 45, h: 320, h2: 180, l: 55, l2: 40, mode: 'linear', s: 90, s2: 70 };
    expect(getSolidFillColor(fill)).toBe('hsl(320, 90%, 55%)');
  });
});

describe('hslToHex / hexToHsl round-trip', () => {
  test('pure red round-trips', () => {
    const hex = hslToHex(0, 100, 50);
    expect(hex).toBe('#ff0000');
    const [h, s, l] = hexToHsl(hex);
    expect(h).toBe(0);
    expect(s).toBe(100);
    expect(l).toBe(50);
  });

  test('pure green round-trips', () => {
    const hex = hslToHex(120, 100, 50);
    expect(hex).toBe('#00ff00');
    const [h, s, l] = hexToHsl(hex);
    expect(h).toBe(120);
    expect(s).toBe(100);
    expect(l).toBe(50);
  });

  test('pure blue round-trips', () => {
    const hex = hslToHex(240, 100, 50);
    expect(hex).toBe('#0000ff');
    const [h, s, l] = hexToHsl(hex);
    expect(h).toBe(240);
    expect(s).toBe(100);
    expect(l).toBe(50);
  });

  test('white round-trips', () => {
    const hex = hslToHex(0, 0, 100);
    expect(hex).toBe('#ffffff');
    const [_h, s, l] = hexToHsl(hex);
    expect(s).toBe(0);
    expect(l).toBe(100);
  });

  test('black round-trips', () => {
    const hex = hslToHex(0, 0, 0);
    expect(hex).toBe('#000000');
    const [_h, s, l] = hexToHsl(hex);
    expect(s).toBe(0);
    expect(l).toBe(0);
  });

  test('mid-range color round-trips', () => {
    const hex = hslToHex(200, 80, 50);
    const [h, s, l] = hexToHsl(hex);
    expect(h).toBe(200);
    expect(s).toBe(80);
    expect(l).toBe(50);
  });
});
