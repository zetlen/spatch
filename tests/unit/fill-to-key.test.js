import { describe, expect, test } from 'bun:test';
import { fillToKey } from '../../js/audio/voice-builder.ts';

describe('fillToKey', () => {
  test('returns undefined for solid fills', () => {
    expect(fillToKey({ mode: 'solid', h: 120, c: 0.24, l: 0.5 })).toBeUndefined();
  });

  test('returns a string key for linear fills', () => {
    const key = fillToKey({
      mode: 'linear',
      h: 0,
      c: 0.24,
      l: 0.5,
      h2: 120,
      c2: 0.18,
      l2: 0.7,
      gradAngle: 90,
    });
    expect(typeof key).toBe('string');
    expect(key).toBe('0:0.24:0.5:120:0.18:0.7:90');
  });

  test('different fills produce different keys', () => {
    const base = {
      mode: 'linear',
      h: 0,
      c: 0.24,
      l: 0.5,
      h2: 120,
      c2: 0.18,
      l2: 0.7,
      gradAngle: 0,
    };
    const k1 = fillToKey(base);
    const k2 = fillToKey({ ...base, h2: 180 });
    const k3 = fillToKey({ ...base, gradAngle: 90 });
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });

  test('same fill produces same key', () => {
    const fill = {
      mode: 'linear',
      h: 0,
      c: 0.24,
      l: 0.5,
      h2: 120,
      c2: 0.18,
      l2: 0.7,
      gradAngle: 45,
    };
    expect(fillToKey(fill)).toBe(fillToKey({ ...fill }));
  });
});
