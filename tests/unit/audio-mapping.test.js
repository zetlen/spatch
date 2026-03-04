import { describe, test, expect } from 'bun:test';
import {
  yToFrequency,
  xToPan,
  rotationToTimbre,
  waveformGain,
  shapeAreaFraction,
  areaToGain,
  snapYToNote,
  hueToFormants,
  lightnessToCutoff,
} from '../../js/audio.ts';

describe('yToFrequency', () => {
  test('y=0 (top) returns highest chromatic note (G5)', () => {
    const freq = yToFrequency(0);
    // y=0 → normalized=1 → index=36 → semitone 36 → MIDI 79 → G5
    // 440 * 2^((79-69)/12) ≈ 783.99
    expect(freq).toBeCloseTo(783.99, 0);
  });

  test('y=1 (bottom) returns lowest chromatic note (G2)', () => {
    const freq = yToFrequency(1);
    // y=1 → normalized=0 → index=0 → semitone 0 → MIDI 43 → G2
    // 440 * 2^((43-69)/12) ≈ 98.00
    expect(freq).toBeCloseTo(98.0, 0);
  });

  test('all positions snap to exact chromatic pitches (no detuning)', () => {
    // With MAX_DETUNE_CENTS=0, every y should land exactly on a chromatic note
    for (let y = 0; y <= 1; y += 0.01) {
      const freq = yToFrequency(y);
      const normalized = 1 - y;
      const index = Math.round(normalized * 36);
      const clamped = Math.max(0, Math.min(36, index));
      const baseFreq = 440 * Math.pow(2, (43 + clamped - 69) / 12);
      expect(freq).toBeCloseTo(baseFreq, 2);
    }
  });

  test('positions between notes snap to nearest chromatic pitch', () => {
    // y=0.5 → normalized=0.5 → continuous=18 → index 18 → MIDI 61 (C#4/Db4)
    // 440 * 2^((61-69)/12) ≈ 277.18
    const freq = yToFrequency(0.5);
    expect(freq).toBeCloseTo(277.18, 0);
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

  test('37 chromatic notes across 3 octaves', () => {
    // Each exact note position should give a unique chromatic pitch
    const freqs = new Set();
    for (let i = 0; i <= 36; i++) {
      const y = 1 - i / 36;
      const freq = yToFrequency(y);
      const rounded = Math.round(freq * 100) / 100;
      freqs.add(rounded);
    }
    expect(freqs.size).toBe(37);
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

describe('rotationToTimbre', () => {
  test('pulse (square): 0° and 90° both return 0 (period boundaries)', () => {
    expect(rotationToTimbre(0, 'pulse')).toBeCloseTo(0);
    expect(rotationToTimbre(90, 'pulse')).toBeCloseTo(0);
  });

  test('pulse (square): linear ramp — 45° returns 0.5', () => {
    expect(rotationToTimbre(45, 'pulse')).toBeCloseTo(0.5);
  });

  test('pulse (square): every angle in period is unique (no mirror symmetry)', () => {
    const t10 = rotationToTimbre(10, 'pulse');
    const t80 = rotationToTimbre(80, 'pulse');
    expect(t10).not.toBeCloseTo(t80, 2);
    expect(t10).toBeLessThan(t80);
  });

  test('blend (triangle): 0° and 120° both return 0 (period boundaries)', () => {
    expect(rotationToTimbre(0, 'blend')).toBeCloseTo(0);
    expect(rotationToTimbre(120, 'blend')).toBeCloseTo(0);
  });

  test('blend (triangle): linear ramp — 60° returns 0.5', () => {
    expect(rotationToTimbre(60, 'blend')).toBeCloseTo(0.5);
  });

  test('blend (triangle): every angle in period is unique (no mirror symmetry)', () => {
    const t20 = rotationToTimbre(20, 'blend');
    const t100 = rotationToTimbre(100, 'blend');
    expect(t20).not.toBeCloseTo(t100, 2);
    expect(t20).toBeLessThan(t100);
  });

  test('sine always returns 0 (no timbre parameter)', () => {
    expect(rotationToTimbre(0, 'sine')).toBe(0);
    expect(rotationToTimbre(45, 'sine')).toBe(0);
    expect(rotationToTimbre(180, 'sine')).toBe(0);
  });

  test('all values are in [0, 1]', () => {
    for (const waveform of ['pulse', 'blend']) {
      for (let r = 0; r < 360; r += 5) {
        const t = rotationToTimbre(r, waveform);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('waveformGain', () => {
  test('sine is boosted for perceived loudness matching', () => {
    expect(waveformGain('sine')).toBe(1.6);
  });

  test('pulse is attenuated below 1.0', () => {
    expect(waveformGain('pulse')).toBeLessThan(1.0);
    expect(waveformGain('pulse')).toBeGreaterThan(0);
  });

  test('blend (sawtooth) is attenuated below sine', () => {
    expect(waveformGain('blend')).toBeLessThan(waveformGain('sine'));
    expect(waveformGain('blend')).toBeGreaterThan(0);
  });

  test('pulse is attenuated more than blend', () => {
    expect(waveformGain('pulse')).toBeLessThan(waveformGain('blend'));
  });
});

describe('shapeAreaFraction', () => {
  test('sine (circle) area = π × (size/2)²', () => {
    expect(shapeAreaFraction('sine', 0.5)).toBeCloseTo(Math.PI * 0.25 * 0.25);
  });

  test('pulse (square) area = size²', () => {
    expect(shapeAreaFraction('pulse', 0.5)).toBeCloseTo(0.25);
  });

  test('blend (triangle) area < sine (circle) area < pulse (square) area at same size', () => {
    const size = 0.4;
    const tri = shapeAreaFraction('blend', size);
    const circ = shapeAreaFraction('sine', size);
    const sq = shapeAreaFraction('pulse', size);
    expect(tri).toBeLessThan(circ);
    expect(circ).toBeLessThan(sq);
  });

  test('area scales with size squared', () => {
    for (const type of ['sine', 'pulse', 'blend']) {
      const small = shapeAreaFraction(type, 0.2);
      const big = shapeAreaFraction(type, 0.4);
      // Doubling size should quadruple area
      expect(big / small).toBeCloseTo(4.0);
    }
  });
});

describe('areaToGain', () => {
  test('tiny shape returns near-minimum gain', () => {
    expect(areaToGain('sine', 0.025)).toBeCloseTo(0.05, 1);
  });

  test('large shape caps at 0.8', () => {
    expect(areaToGain('pulse', 0.95)).toBe(0.8);
  });

  test('gain increases with size for all waveform types', () => {
    for (const type of ['sine', 'pulse', 'blend']) {
      const small = areaToGain(type, 0.2);
      const big = areaToGain(type, 0.5);
      expect(big).toBeGreaterThan(small);
    }
  });

  test('same-size shapes produce gain proportional to visual area', () => {
    const size = 0.4;
    const sineGain = areaToGain('sine', size);
    const pulseGain = areaToGain('pulse', size);
    // Pulse (square) has more area, so more gain
    expect(pulseGain).toBeGreaterThan(sineGain);
  });
});

describe('snapYToNote', () => {
  // 37 chromatic notes, spacing = 1/36 ≈ 0.0278
  const spacing = 1 / 36;

  test('exact note positions are unchanged', () => {
    // y=0 (top, highest note) and y=1 (bottom, lowest note)
    expect(snapYToNote(0)).toBeCloseTo(0, 5);
    expect(snapYToNote(1)).toBeCloseTo(1, 5);
    // Middle note: index 18, normalized = 18/36 = 0.5, y = 0.5
    const midY = 1 - 18 * spacing;
    expect(snapYToNote(midY)).toBeCloseTo(midY, 5);
  });

  test('positions near a note are pulled toward it (magnetic)', () => {
    // Slightly above a note center should snap closer to it
    const noteY = 1 - 12 * spacing; // note at index 12
    const slightlyOff = noteY + spacing * 0.1;
    const snapped = snapYToNote(slightlyOff);
    // Snapped should be closer to the note than the raw position
    expect(Math.abs(snapped - noteY)).toBeLessThan(Math.abs(slightlyOff - noteY));
  });

  test('positions between notes are compressed but reachable', () => {
    // Halfway between two notes should still map to a position between them
    const note12Y = 1 - 12 * spacing;
    const note13Y = 1 - 13 * spacing;
    const halfway = (note12Y + note13Y) / 2;
    const snapped = snapYToNote(halfway);
    // Should still be between the two notes (not collapsed to either)
    expect(snapped).toBeLessThan(note12Y);
    expect(snapped).toBeGreaterThan(note13Y);
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

describe('lightnessToCutoff', () => {
  test('lightness 0 (black) returns ~300 Hz', () => {
    const freq = lightnessToCutoff(0);
    expect(freq).toBeCloseTo(300, -1); // within 10 Hz
  });

  test('lightness 50 (mid) returns ~1900 Hz', () => {
    const freq = lightnessToCutoff(50);
    // Geometric midpoint of 300–12000: 300 * sqrt(40) ≈ 1897
    expect(freq).toBeCloseTo(1897, -2); // within 100 Hz
  });

  test('lightness 100 (white) returns ~12000 Hz', () => {
    const freq = lightnessToCutoff(100);
    expect(freq).toBeCloseTo(12000, -2); // within 100 Hz
  });

  test('monotonically increasing', () => {
    let prev = lightnessToCutoff(0);
    for (let l = 1; l <= 100; l++) {
      const freq = lightnessToCutoff(l);
      expect(freq).toBeGreaterThan(prev);
      prev = freq;
    }
  });

  test('always returns positive frequency', () => {
    for (let l = 0; l <= 100; l++) {
      expect(lightnessToCutoff(l)).toBeGreaterThan(0);
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
