import { describe, test, expect } from 'bun:test';
import {
  yToFrequency,
  xToPan,
  sizeToGain,
  rotationToParam,
  waveformGain,
  shapeAreaFraction,
  areaToGain,
  curlicuesToDetune,
} from '../../js/audio.ts';

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

describe('rotationToParam', () => {
  test('rotation=0 returns 0.0', () => {
    expect(rotationToParam(0)).toBe(0);
  });

  test('rotation=180 returns 0.5', () => {
    expect(rotationToParam(180)).toBe(0.5);
  });

  test('rotation=360 returns 1.0', () => {
    expect(rotationToParam(360)).toBeCloseTo(1.0);
  });

  test('rotation=90 returns 0.25', () => {
    expect(rotationToParam(90)).toBeCloseTo(0.25);
  });
});

describe('waveformGain', () => {
  test('circle (sine) is boosted for perceived loudness matching', () => {
    expect(waveformGain('circle')).toBe(1.4);
  });

  test('square is attenuated below 1.0', () => {
    expect(waveformGain('square')).toBeLessThan(1.0);
    expect(waveformGain('square')).toBeGreaterThan(0);
  });

  test('triangle (sawtooth) is attenuated below sine', () => {
    expect(waveformGain('triangle')).toBeLessThan(waveformGain('circle'));
    expect(waveformGain('triangle')).toBeGreaterThan(0);
  });

  test('square is attenuated more than triangle', () => {
    expect(waveformGain('square')).toBeLessThan(waveformGain('triangle'));
  });
});

describe('shapeAreaFraction', () => {
  test('circle area = π × (size/2)²', () => {
    expect(shapeAreaFraction('circle', 0.5)).toBeCloseTo(Math.PI * 0.25 * 0.25);
  });

  test('square area = size²', () => {
    expect(shapeAreaFraction('square', 0.5)).toBeCloseTo(0.25);
  });

  test('triangle area < circle area < square area at same size', () => {
    const size = 0.4;
    const tri = shapeAreaFraction('triangle', size);
    const circ = shapeAreaFraction('circle', size);
    const sq = shapeAreaFraction('square', size);
    expect(tri).toBeLessThan(circ);
    expect(circ).toBeLessThan(sq);
  });

  test('area scales with size squared', () => {
    for (const type of ['circle', 'square', 'triangle']) {
      const small = shapeAreaFraction(type, 0.2);
      const big = shapeAreaFraction(type, 0.4);
      // Doubling size should quadruple area
      expect(big / small).toBeCloseTo(4.0);
    }
  });
});

describe('areaToGain', () => {
  test('tiny shape returns near-minimum gain', () => {
    expect(areaToGain('circle', 0.025)).toBeCloseTo(0.05, 1);
  });

  test('large shape caps at 0.8', () => {
    expect(areaToGain('square', 0.95)).toBe(0.8);
  });

  test('gain increases with size for all shape types', () => {
    for (const type of ['circle', 'square', 'triangle']) {
      const small = areaToGain(type, 0.2);
      const big = areaToGain(type, 0.5);
      expect(big).toBeGreaterThan(small);
    }
  });

  test('same-size shapes produce gain proportional to visual area', () => {
    const size = 0.4;
    const circGain = areaToGain('circle', size);
    const sqGain = areaToGain('square', size);
    // Square has more area, so more gain
    expect(sqGain).toBeGreaterThan(circGain);
  });
});

describe('curlicuesToDetune', () => {
  test('0 curlicues returns 0 cents', () => {
    expect(curlicuesToDetune(0)).toBe(0);
  });

  test('multiple curlicues add 15 cents each', () => {
    expect(curlicuesToDetune(1)).toBe(15);
    expect(curlicuesToDetune(3)).toBe(45);
  });
});
