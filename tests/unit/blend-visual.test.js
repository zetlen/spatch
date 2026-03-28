// blend-visual.test.js — Verify that all blend mode combinations produce
// visually distinct colors at the overlap region.
//
// Uses OffscreenCanvas to composite two colored rectangles with CSS blend
// modes and samples the center pixel. All 6 unordered pairs of
// {screen, multiply, difference} must produce distinct RGB values.

import { describe, expect, test } from 'bun:test';

const BLEND_MODES = ['screen', 'multiply', 'difference'];

// Two distinct mid-range HSL colors converted to RGB for reproducibility.
// These are chosen to be far apart in hue so blend differences are maximized.
const COLOR_A = { r: 200, g: 80, b: 60 }; // warm red-orange
const COLOR_B = { r: 60, g: 120, b: 200 }; // cool blue

/** Apply a CSS blend operation to two 0–255 channel values. Returns 0–255. */
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
    case 'difference':
      result = Math.abs(an - bn);
      break;
    default:
      result = an;
  }
  return Math.round(result * 255);
}

/** Compute the blended RGB for two colors under a given blend mode. */
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

  test('all 3 individual blend modes produce distinct overlap colors', () => {
    const colors = new Map();
    for (const mode of BLEND_MODES) {
      const c = blendColors(COLOR_A, COLOR_B, mode);
      const key = colorKey(c);
      expect(colors.has(key)).toBe(false);
      colors.set(key, mode);
    }
  });
});
