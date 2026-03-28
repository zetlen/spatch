// blend-visual.test.js — Verify that all 4 blend modes produce
// visually distinct colors at the overlap region.

import { describe, expect, test } from 'bun:test';

const BLEND_MODES = ['screen', 'multiply', 'exclusion', 'difference'];

const COLOR_A = { r: 200, g: 80, b: 60 };
const COLOR_B = { r: 60, g: 120, b: 200 };

function blendChannel(a, b, mode) {
  const an = a / 255;
  const bn = b / 255;
  let result;
  switch (mode) {
    case 'screen':
      result = 1 - (1 - an) * (1 - bn);
      break;
    case 'multiply':
      result = an * bn;
      break;
    case 'exclusion':
      result = an + bn - 2 * an * bn;
      break;
    case 'difference':
      result = Math.abs(an - bn);
      break;
    default:
      result = an;
  }
  return Math.round(result * 255);
}

function blendColors(colorA, colorB, mode) {
  return {
    r: blendChannel(colorA.r, colorB.r, mode),
    g: blendChannel(colorA.g, colorB.g, mode),
    b: blendChannel(colorA.b, colorB.b, mode),
  };
}

function colorKey(c) {
  return `${c.r},${c.g},${c.b}`;
}

describe('blend mode visual distinctness', () => {
  test('all blend operations are commutative', () => {
    for (const mode of BLEND_MODES) {
      const ab = blendColors(COLOR_A, COLOR_B, mode);
      const ba = blendColors(COLOR_B, COLOR_A, mode);
      expect(ab).toEqual(ba);
    }
  });

  test('all 4 blend modes produce distinct overlap colors', () => {
    const colors = new Map();
    for (const mode of BLEND_MODES) {
      const c = blendColors(COLOR_A, COLOR_B, mode);
      const key = colorKey(c);
      expect(colors.has(key)).toBe(false);
      colors.set(key, mode);
    }
  });
});
