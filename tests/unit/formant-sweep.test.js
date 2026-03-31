import { describe, expect, test } from 'bun:test';
import {
  sweepParamsForAngle,
  buildSweepCurve,
  isSweepReversed,
  scheduleFormantSweep,
} from '../../js/audio/formants.ts';

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

  test('180° (RL) is fastest', () => {
    const p = sweepParamsForAngle(180);
    expect(p.durationFrac).toBeLessThan(sweepParamsForAngle(0).durationFrac);
    expect(p.exponent).toBe(1);
  });

  test('45° is ease-in (exponent > 1)', () => {
    expect(sweepParamsForAngle(45).exponent).toBeGreaterThan(1);
  });

  test('135° is ease-out (exponent < 1)', () => {
    expect(sweepParamsForAngle(135).exponent).toBeLessThan(1);
  });

  test('wraps at 360°', () => {
    const a = sweepParamsForAngle(0);
    const b = sweepParamsForAngle(360);
    expect(a.durationFrac).toBe(b.durationFrac);
    expect(a.exponent).toBe(b.exponent);
  });

  test('rounds to nearest 45° for non-standard angles', () => {
    const p = sweepParamsForAngle(20);
    expect(p.durationFrac).toBe(sweepParamsForAngle(0).durationFrac);
  });
});

describe('isSweepReversed', () => {
  test('false for angles 0–135° (bit 2 unset)', () => {
    expect(isSweepReversed(0)).toBe(false);
    expect(isSweepReversed(45)).toBe(false);
    expect(isSweepReversed(90)).toBe(false);
    expect(isSweepReversed(135)).toBe(false);
  });

  test('true for angles 180–315° (bit 2 set)', () => {
    expect(isSweepReversed(180)).toBe(true);
    expect(isSweepReversed(225)).toBe(true);
    expect(isSweepReversed(270)).toBe(true);
    expect(isSweepReversed(315)).toBe(true);
  });
});

describe('buildSweepCurve', () => {
  test('returns Float32Array of requested length', () => {
    const curve = buildSweepCurve(1, 64);
    expect(curve).toBeInstanceOf(Float32Array);
    expect(curve.length).toBe(64);
  });

  test('starts at 0 and ends at 1', () => {
    for (const exp of [0.5, 1, 2]) {
      const curve = buildSweepCurve(exp, 64);
      expect(curve[0]).toBeCloseTo(0, 2);
      expect(curve[63]).toBeCloseTo(1, 2);
    }
  });

  test('exponent 1 produces linear curve', () => {
    const curve = buildSweepCurve(1, 5);
    expect(curve[1]).toBeCloseTo(0.25, 2);
    expect(curve[2]).toBeCloseTo(0.5, 2);
    expect(curve[3]).toBeCloseTo(0.75, 2);
  });

  test('exponent > 1 (ease-in) is below linear at midpoint', () => {
    const curve = buildSweepCurve(2, 64);
    expect(curve[32]).toBeLessThan(0.5);
  });

  test('exponent < 1 (ease-out) is above linear at midpoint', () => {
    const curve = buildSweepCurve(0.5, 64);
    expect(curve[32]).toBeGreaterThan(0.5);
  });

  test('all values in [0, 1] and monotonically non-decreasing', () => {
    for (const exp of [0.5, 1, 2]) {
      const curve = buildSweepCurve(exp, 64);
      for (let i = 0; i < curve.length; i++) {
        expect(curve[i]).toBeGreaterThanOrEqual(0);
        expect(curve[i]).toBeLessThanOrEqual(1);
        if (i > 0) {
          expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1] - 0.001);
        }
      }
    }
  });
});

function createMockAudioParam(initial = 0) {
  const calls = [];
  return {
    calls,
    setValueAtTime(v, t) {
      this.value = v;
      calls.push({ method: 'setValueAtTime', value: v, time: t });
    },
    setValueCurveAtTime(values, t, d) {
      calls.push({
        method: 'setValueCurveAtTime',
        values: [...values],
        time: t,
        duration: d,
      });
    },
    cancelScheduledValues() {},
    linearRampToValueAtTime() {},
    value: initial,
  };
}

function createMockBiquadFilter(freq = 350, q = 1) {
  return {
    frequency: createMockAudioParam(freq),
    Q: createMockAudioParam(q),
    type: 'bandpass',
  };
}

describe('scheduleFormantSweep', () => {
  const linearFill = {
    mode: 'linear',
    h: 0,
    s: 80,
    l: 50,
    h2: 120,
    s2: 60,
    l2: 70,
    gradAngle: 0,
  };

  test('schedules setValueCurveAtTime on all three nodes', () => {
    const f1 = createMockBiquadFilter();
    const f2 = createMockBiquadFilter();
    const brightness = createMockBiquadFilter(1900, 0.7);
    brightness.type = 'lowpass';

    scheduleFormantSweep({ f1, f2, brightness }, linearFill, 'pulse', 0.1, 0.5);

    const f1FreqCurve = f1.frequency.calls.find((c) => c.method === 'setValueCurveAtTime');
    expect(f1FreqCurve).not.toBeUndefined();
    expect(f1FreqCurve.time).toBeCloseTo(0.1, 5);

    const f2FreqCurve = f2.frequency.calls.find((c) => c.method === 'setValueCurveAtTime');
    expect(f2FreqCurve).not.toBeUndefined();

    const f1QCurve = f1.Q.calls.find((c) => c.method === 'setValueCurveAtTime');
    expect(f1QCurve).not.toBeUndefined();

    const f2QCurve = f2.Q.calls.find((c) => c.method === 'setValueCurveAtTime');
    expect(f2QCurve).not.toBeUndefined();

    const brightCurve = brightness.frequency.calls.find((c) => c.method === 'setValueCurveAtTime');
    expect(brightCurve).not.toBeUndefined();
  });

  test('sweep starts at color1 formants and ends at color2 formants', () => {
    const f1 = createMockBiquadFilter();
    const f2 = createMockBiquadFilter();
    const brightness = createMockBiquadFilter(1900, 0.7);
    brightness.type = 'lowpass';

    scheduleFormantSweep({ f1, f2, brightness }, linearFill, 'pulse', 0, 1);

    const f1Curve = f1.frequency.calls.find((c) => c.method === 'setValueCurveAtTime');
    const values = f1Curve.values;
    expect(values[0]).toBeCloseTo(730, -1);
    expect(values[values.length - 1]).toBeCloseTo(270, -1);
  });

  test('reversed angle (180°) sweeps from color2 to color1', () => {
    const f1 = createMockBiquadFilter();
    const f2 = createMockBiquadFilter();
    const brightness = createMockBiquadFilter(1900, 0.7);
    brightness.type = 'lowpass';

    const reversedFill = { ...linearFill, gradAngle: 180 };
    scheduleFormantSweep({ f1, f2, brightness }, reversedFill, 'pulse', 0, 1);

    const f1Curve = f1.frequency.calls.find((c) => c.method === 'setValueCurveAtTime');
    const values = f1Curve.values;
    // Reversed: starts at color2 (hue 120 → F1 ≈ 270) and ends at color1 (hue 0 → F1 ≈ 730)
    expect(values[0]).toBeCloseTo(270, -1);
    expect(values[values.length - 1]).toBeCloseTo(730, -1);
  });

  test('sweep duration is decay × durationFrac from angle', () => {
    const f1 = createMockBiquadFilter();
    const f2 = createMockBiquadFilter();
    const brightness = createMockBiquadFilter(1900, 0.7);
    brightness.type = 'lowpass';

    const decay = 0.8;
    scheduleFormantSweep({ f1, f2, brightness }, linearFill, 'pulse', 0, decay);

    const f1Curve = f1.frequency.calls.find((c) => c.method === 'setValueCurveAtTime');
    const expectedDuration = decay * sweepParamsForAngle(0).durationFrac;
    expect(f1Curve.duration).toBeCloseTo(expectedDuration, 3);
  });
});
