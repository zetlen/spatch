import { describe, test, expect } from 'bun:test';
import { yToFrequency, xToPan, sizeToGain, rotationToDetune } from '../../js/audio.js';

describe('yToFrequency', () => {
  test('y=0 (top) returns highest pentatonic note', () => {
    const freq = yToFrequency(0);
    // y=0 → normalized=1 → index=16 (last in array of 16) → semitone 36 → MIDI 84 → C6
    // PENTATONIC_SEMITONES has 16 entries (3 octaves × 5 + top note 36)
    // 440 * 2^((84-69)/12) = 440 * 2^(15/12) ≈ 1046.50
    expect(freq).toBeCloseTo(1046.5, 0);
  });

  test('y=1 (bottom) returns lowest pentatonic note', () => {
    const freq = yToFrequency(1);
    // y=1 → normalized=0 → index=0 → semitone 0 → MIDI 48 → C3
    // 440 * 2^((48-69)/12) ≈ 130.81
    expect(freq).toBeCloseTo(130.81, 0);
  });

  test('y=0.5 (middle) returns a mid-range pentatonic note', () => {
    const freq = yToFrequency(0.5);
    // y=0.5 → normalized=0.5 → index=round(0.5*16)=8 → PENTATONIC_SEMITONES[8]
    // Semitones: [0,2,4,7,9, 12,14,16,19,21, 24,26,28,31,33, 36]
    // Index 8 = 19 → MIDI 48+19=67 → G4
    // But actual result is 392 Hz which is MIDI 67 = G4... let me just use the actual value
    expect(freq).toBeCloseTo(392.0, 0);
  });

  test('returns positive frequency for any valid y', () => {
    for (const y of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(yToFrequency(y)).toBeGreaterThan(0);
    }
  });

  test('higher y means lower frequency (pitch goes down)', () => {
    const freqTop = yToFrequency(0);
    const freqBottom = yToFrequency(1);
    expect(freqTop).toBeGreaterThan(freqBottom);
  });
});

describe('xToPan', () => {
  test('x=0 pans full left (-1)', () => {
    expect(xToPan(0)).toBe(-1);
  });

  test('x=0.5 pans center (0)', () => {
    expect(xToPan(0.5)).toBe(0);
  });

  test('x=1 pans full right (+1)', () => {
    expect(xToPan(1)).toBe(1);
  });

  test('x=0.25 pans half-left (-0.5)', () => {
    expect(xToPan(0.25)).toBe(-0.5);
  });
});

describe('sizeToGain', () => {
  test('size=0 returns minimum gain 0.05', () => {
    expect(sizeToGain(0)).toBeCloseTo(0.05);
  });

  test('large size caps at 0.8', () => {
    expect(sizeToGain(1)).toBe(0.8);
    expect(sizeToGain(10)).toBe(0.8);
  });

  test('moderate size returns intermediate gain', () => {
    const gain = sizeToGain(0.1);
    expect(gain).toBeGreaterThan(0.05);
    expect(gain).toBeLessThan(0.8);
  });
});

describe('rotationToDetune', () => {
  test('rotation=0 returns 0 cents', () => {
    expect(rotationToDetune(0)).toBe(0);
  });

  test('rotation=180 returns 25 cents', () => {
    expect(rotationToDetune(180)).toBe(25);
  });

  test('rotation=360 returns 50 cents', () => {
    expect(rotationToDetune(360)).toBeCloseTo(50);
  });

  test('rotation=90 returns 12.5 cents', () => {
    expect(rotationToDetune(90)).toBeCloseTo(12.5);
  });
});
