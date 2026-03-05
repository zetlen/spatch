import { describe, expect, test } from 'bun:test';
import { cents, degrees, normalizedCoord } from '../../js/types.ts';

describe('normalizedCoord', () => {
  test('passes through in-range values', () => {
    expect(normalizedCoord(0.5)).toBe(0.5);
    expect(normalizedCoord(0)).toBe(0);
    expect(normalizedCoord(1)).toBe(1);
  });

  test('clamps values below 0', () => {
    expect(normalizedCoord(-0.5)).toBe(0);
    expect(normalizedCoord(-100)).toBe(0);
  });

  test('clamps values above 1', () => {
    expect(normalizedCoord(1.5)).toBe(1);
    expect(normalizedCoord(100)).toBe(1);
  });
});

describe('degrees', () => {
  test('passes through in-range values', () => {
    expect(degrees(0)).toBe(0);
    expect(degrees(180)).toBe(180);
    expect(degrees(359)).toBe(359);
  });

  test('wraps values >= 360', () => {
    expect(degrees(360)).toBe(0);
    expect(degrees(450)).toBe(90);
    expect(degrees(720)).toBe(0);
  });

  test('wraps negative values', () => {
    expect(degrees(-90)).toBe(270);
    expect(degrees(-360)).toBe(0);
    expect(degrees(-450)).toBe(270);
  });
});

describe('cents', () => {
  test('passes through any value', () => {
    expect(cents(0)).toBe(0);
    expect(cents(15)).toBe(15);
    expect(cents(-100)).toBe(-100);
    expect(cents(1200)).toBe(1200);
  });
});
