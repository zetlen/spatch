import { describe, expect, test } from 'bun:test';
import { fillToKey } from '../../js/audio/voice-builder.ts';

describe('fillToKey', () => {
  test('returns undefined for solid fills', () => {
    expect(fillToKey({ mode: 'solid', h: 120, s: 80, l: 50 })).toBeUndefined();
  });

  test('returns a string key for linear fills', () => {
    const key = fillToKey({
      mode: 'linear',
      h: 0,
      s: 80,
      l: 50,
      h2: 120,
      s2: 60,
      l2: 70,
      gradAngle: 90,
    });
    expect(typeof key).toBe('string');
    expect(key).toBe('0:80:50:120:60:70:90');
  });

  test('different fills produce different keys', () => {
    const base = { mode: 'linear', h: 0, s: 80, l: 50, h2: 120, s2: 60, l2: 70, gradAngle: 0 };
    const k1 = fillToKey(base);
    const k2 = fillToKey({ ...base, h2: 180 });
    const k3 = fillToKey({ ...base, gradAngle: 90 });
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });

  test('same fill produces same key', () => {
    const fill = { mode: 'linear', h: 0, s: 80, l: 50, h2: 120, s2: 60, l2: 70, gradAngle: 45 };
    expect(fillToKey(fill)).toBe(fillToKey({ ...fill }));
  });
});
