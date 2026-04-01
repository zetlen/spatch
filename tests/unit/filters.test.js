import { describe, expect, test } from 'bun:test';
import {
  hueToF1,
  chromaToF2,
  lightnessToCutoff,
  sweepParamsForAngle,
  buildSweepCurve,
  isSweepReversed,
} from '../../js/audio/filters.ts';

describe('hueToF1', () => {
  test('hue 0 maps to ~270 Hz (closed vowel)', () => {
    expect(hueToF1(0)).toBeCloseTo(270, -1);
  });

  test('hue 359 maps to ~730 Hz (open vowel)', () => {
    const f = hueToF1(359);
    expect(f).toBeGreaterThan(700);
    expect(f).toBeLessThan(740);
  });

  test('monotonically increasing across 0-359', () => {
    let prev = 0;
    for (let h = 0; h < 360; h += 10) {
      const f = hueToF1(h);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  test('wraps at 360 (same as 0)', () => {
    expect(hueToF1(360)).toBeCloseTo(hueToF1(0), 1);
  });
});

describe('chromaToF2', () => {
  test('zero chroma maps to ~840 Hz (back vowel)', () => {
    expect(chromaToF2(0)).toBeCloseTo(840, -1);
  });

  test('max chroma (0.4) maps to ~2290 Hz (front vowel)', () => {
    expect(chromaToF2(0.4)).toBeCloseTo(2290, -1);
  });

  test('monotonically increasing', () => {
    let prev = 0;
    for (let c = 0; c <= 0.4; c += 0.05) {
      const f = chromaToF2(c);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe('lightnessToCutoff', () => {
  test('L=0 (dark) maps to ~500 Hz', () => {
    expect(lightnessToCutoff(0)).toBeCloseTo(500, -1);
  });

  test('L=1 (light) maps to ~8000 Hz', () => {
    expect(lightnessToCutoff(1)).toBeCloseTo(8000, -2);
  });

  test('monotonically increasing', () => {
    let prev = 0;
    for (let l = 0; l <= 1; l += 0.1) {
      const f = lightnessToCutoff(l);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe('sweepParamsForAngle', () => {
  test('returns params for all 8 positions', () => {
    for (let a = 0; a < 360; a += 45) {
      const p = sweepParamsForAngle(a);
      expect(p.durationFrac).toBeGreaterThan(0);
      expect(p.durationFrac).toBeLessThanOrEqual(1);
      expect(p.exponent).toBeGreaterThan(0);
    }
  });

  test('0° (LR) uses full decay, linear', () => {
    const p = sweepParamsForAngle(0);
    expect(p.durationFrac).toBe(1);
    expect(p.exponent).toBe(1);
  });
});

describe('isSweepReversed', () => {
  test('false for angles 0–135°', () => {
    expect(isSweepReversed(0)).toBe(false);
    expect(isSweepReversed(135)).toBe(false);
  });

  test('true for angles 180–315°', () => {
    expect(isSweepReversed(180)).toBe(true);
    expect(isSweepReversed(315)).toBe(true);
  });
});

describe('buildSweepCurve', () => {
  test('starts at 0 and ends at 1', () => {
    const curve = buildSweepCurve(1, 64);
    expect(curve[0]).toBeCloseTo(0, 2);
    expect(curve[63]).toBeCloseTo(1, 2);
  });
});
