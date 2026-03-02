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
  snapYToNote,
  hueToFormants,
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

  test('exact note position has no micro-detuning', () => {
    // y=0 and y=1 land exactly on note centers (offset=0)
    // so they should be pure pentatonic pitches
    const freqTop = yToFrequency(0);
    const freqBottom = yToFrequency(1);
    expect(freqTop).toBeCloseTo(1046.5, 0); // C6
    expect(freqBottom).toBeCloseTo(130.81, 0); // C3
  });

  test('between-note positions produce micro-detuned pitch', () => {
    // y=0.5 → continuous=7.5, rounds to index 8 (G4=392Hz), offset=-0.5
    // Detuning: 40 * tanh(-0.5 * 3) ≈ -36.2 cents → slightly flat G4
    const freq = yToFrequency(0.5);
    expect(freq).toBeLessThan(392.0); // detuned flat
    expect(freq).toBeGreaterThan(380.0); // but still recognizably G4
  });

  test('nearby y values produce distinct frequencies', () => {
    // This was the original problem: slight position changes must produce
    // audible differences, not dead zones
    const f1 = yToFrequency(0.5);
    const f2 = yToFrequency(0.51);
    const f3 = yToFrequency(0.52);
    expect(f1).not.toBeCloseTo(f2, 2);
    expect(f2).not.toBeCloseTo(f3, 2);
  });

  test('micro-detuning stays within ±40 cents of the base note', () => {
    // Test many positions and verify detuning never exceeds max
    for (let y = 0; y <= 1; y += 0.01) {
      const freq = yToFrequency(y);
      // Find the nearest pure note frequency (what the old rounding would give)
      const normalized = 1 - y;
      const semitones = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
      const index = Math.round(normalized * (semitones.length - 1));
      const clamped = Math.max(0, Math.min(semitones.length - 1, index));
      const baseFreq = 440 * Math.pow(2, (48 + semitones[clamped] - 69) / 12);
      // Detuning in cents: 1200 * log2(freq / baseFreq)
      const detuneCents = 1200 * Math.log2(freq / baseFreq);
      expect(Math.abs(detuneCents)).toBeLessThanOrEqual(40.01);
    }
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

describe('snapYToNote', () => {
  // 16 pentatonic notes, spacing = 1/15 ≈ 0.0667
  const spacing = 1 / 15;

  test('exact note positions are unchanged', () => {
    // y=0 (top, highest note) and y=1 (bottom, lowest note)
    expect(snapYToNote(0)).toBeCloseTo(0, 5);
    expect(snapYToNote(1)).toBeCloseTo(1, 5);
    // Middle note: index 8, normalized = 8/15, y = 1 - 8/15
    const midY = 1 - 8 * spacing;
    expect(snapYToNote(midY)).toBeCloseTo(midY, 5);
  });

  test('positions near a note are pulled toward it (magnetic)', () => {
    // Slightly above a note center should snap closer to it
    const noteY = 1 - 5 * spacing; // note at index 5
    const slightlyOff = noteY + spacing * 0.1;
    const snapped = snapYToNote(slightlyOff);
    // Snapped should be closer to the note than the raw position
    expect(Math.abs(snapped - noteY)).toBeLessThan(Math.abs(slightlyOff - noteY));
  });

  test('positions between notes are compressed but reachable', () => {
    // Halfway between two notes should still map to a position between them
    const note5Y = 1 - 5 * spacing;
    const note6Y = 1 - 6 * spacing;
    const halfway = (note5Y + note6Y) / 2;
    const snapped = snapYToNote(halfway);
    // Should still be between the two notes (not collapsed to either)
    expect(snapped).toBeLessThan(note5Y);
    expect(snapped).toBeGreaterThan(note6Y);
  });

  test('result is always clamped to [0, 1]', () => {
    expect(snapYToNote(0)).toBeGreaterThanOrEqual(0);
    expect(snapYToNote(0)).toBeLessThanOrEqual(1);
    expect(snapYToNote(1)).toBeGreaterThanOrEqual(0);
    expect(snapYToNote(1)).toBeLessThanOrEqual(1);
    expect(snapYToNote(0.5)).toBeGreaterThanOrEqual(0);
    expect(snapYToNote(0.5)).toBeLessThanOrEqual(1);
  });

  test('monotonic: increasing y never decreases snapped y', () => {
    let prev = snapYToNote(0);
    for (let y = 0.01; y <= 1; y += 0.01) {
      const snapped = snapYToNote(y);
      expect(snapped).toBeGreaterThanOrEqual(prev - 0.0001); // small epsilon for float
      prev = snapped;
    }
  });
});

describe('hueToFormants', () => {
  test('returns anchor values at exact anchor hues', () => {
    // hue=0 → /a/: F1=730, F2=1090
    const a = hueToFormants(0);
    expect(a.f1).toBeCloseTo(730, 0);
    expect(a.f2).toBeCloseTo(1090, 0);

    // hue=120 → /i/: F1=270, F2=2290
    const i = hueToFormants(120);
    expect(i.f1).toBeCloseTo(270, 0);
    expect(i.f2).toBeCloseTo(2290, 0);
  });

  test('interpolates smoothly between anchors', () => {
    // hue=30 should be halfway between /a/ (F1=730) and /e/ (F1=530)
    const mid = hueToFormants(30);
    expect(mid.f1).toBeCloseTo(630, 0); // (730+530)/2
    expect(mid.f2).toBeCloseTo(1465, 0); // (1090+1840)/2
  });

  test('wraps around at 360°', () => {
    const h0 = hueToFormants(0);
    const h360 = hueToFormants(360);
    expect(h360.f1).toBeCloseTo(h0.f1, 0);
    expect(h360.f2).toBeCloseTo(h0.f2, 0);
  });

  test('negative hues wrap correctly', () => {
    const h350 = hueToFormants(350);
    const hNeg10 = hueToFormants(-10);
    expect(hNeg10.f1).toBeCloseTo(h350.f1, 0);
    expect(hNeg10.f2).toBeCloseTo(h350.f2, 0);
  });

  test('all hues produce positive frequencies', () => {
    for (let h = 0; h < 360; h += 5) {
      const f = hueToFormants(h);
      expect(f.f1).toBeGreaterThan(0);
      expect(f.f2).toBeGreaterThan(0);
    }
  });

  test('F1 and F2 vary continuously across the hue range', () => {
    // No abrupt jumps — adjacent hues should produce similar frequencies
    let prevF1 = hueToFormants(0).f1;
    let prevF2 = hueToFormants(0).f2;
    for (let h = 1; h < 360; h++) {
      const f = hueToFormants(h);
      // Max change between adjacent degrees should be modest
      expect(Math.abs(f.f1 - prevF1)).toBeLessThan(20);
      expect(Math.abs(f.f2 - prevF2)).toBeLessThan(30);
      prevF1 = f.f1;
      prevF2 = f.f2;
    }
  });
});
