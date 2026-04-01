import { describe, expect, test } from 'bun:test';
import {
  rotationToTimbre,
  snapYToNote,
  yToFrequency,
  yToPlaybackRate,
} from '../../js/audio/mapping.ts';
import {
  applyColorParams,
  hueToF1,
  chromaToF2,
  lightnessToCutoff,
} from '../../js/audio/filters.ts';

describe('yToFrequency', () => {
  test('y=0 (top) returns highest chromatic note (G5)', () => {
    const freq = yToFrequency(0);
    // Y=0 → normalized=1 → index=36 → semitone 36 → MIDI 79 → G5
    // 440 * 2^((79-69)/12) ≈ 783.99
    expect(freq).toBeCloseTo(783.99, 0);
  });

  test('y=1 (bottom) returns lowest chromatic note (G2)', () => {
    const freq = yToFrequency(1);
    // Y=1 → normalized=0 → index=0 → semitone 0 → MIDI 43 → G2
    // 440 * 2^((43-69)/12) ≈ 98.00
    expect(freq).toBeCloseTo(98, 0);
  });

  test('all positions snap to exact chromatic pitches (no detuning)', () => {
    // With MAX_DETUNE_CENTS=0, every y should land exactly on a chromatic note
    for (let y = 0; y <= 1; y += 0.01) {
      const freq = yToFrequency(y);
      const normalized = 1 - y;
      const index = Math.round(normalized * 36);
      const clamped = Math.max(0, Math.min(36, index));
      const baseFreq = 440 * 2 ** ((43 + clamped - 69) / 12);
      expect(freq).toBeCloseTo(baseFreq, 2);
    }
  });

  test('positions between notes snap to nearest chromatic pitch', () => {
    // Y=0.5 → normalized=0.5 → continuous=18 → index 18 → MIDI 61 (C#4/Db4)
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

describe('snapYToNote', () => {
  // 37 chromatic notes, spacing = 1/36 ≈ 0.0278
  const spacing = 1 / 36;

  test('exact note positions are unchanged', () => {
    // Y=0 (top, highest note) and y=1 (bottom, lowest note)
    expect(snapYToNote(0)).toBeCloseTo(0, 5);
    expect(snapYToNote(1)).toBeCloseTo(1, 5);
    // Middle note: index 18, normalized = 18/36 = 0.5, y = 0.5
    const midY = 1 - 18 * spacing;
    expect(snapYToNote(midY)).toBeCloseTo(midY, 5);
  });

  test('positions near a note are pulled toward it (magnetic)', () => {
    // Slightly above a note center should snap closer to it
    const noteY = 1 - 12 * spacing; // Note at index 12
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
      expect(snapped).toBeGreaterThanOrEqual(prev - 0.0001); // Small epsilon for float
      prev = snapped;
    }
  });
});

describe('lightnessToCutoff', () => {
  test('lightness 0 (black) returns ~500 Hz', () => {
    expect(lightnessToCutoff(0)).toBeCloseTo(500, -1);
  });

  test('lightness 0.5 (mid) returns geometric midpoint', () => {
    const f = lightnessToCutoff(0.5);
    expect(f).toBeGreaterThan(1500);
    expect(f).toBeLessThan(2500);
  });

  test('lightness 1 (white) returns ~8000 Hz', () => {
    expect(lightnessToCutoff(1)).toBeCloseTo(8000, -2);
  });

  test('monotonically increasing', () => {
    let prev = lightnessToCutoff(0);
    for (let l = 0.01; l <= 1; l += 0.01) {
      const f = lightnessToCutoff(l);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe('hueToF1', () => {
  test('hue 0 maps to ~270 Hz (closed vowel)', () => {
    expect(hueToF1(0)).toBeCloseTo(270, -1);
  });

  test('hue 359 maps to ~730 Hz (open vowel)', () => {
    const f = hueToF1(359);
    expect(f).toBeGreaterThan(700);
  });

  test('monotonically increasing across 0-359', () => {
    let prev = hueToF1(0);
    for (let h = 1; h <= 359; h++) {
      const f = hueToF1(h);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  test('all hues produce positive frequencies', () => {
    for (let h = 0; h <= 360; h += 5) {
      expect(hueToF1(h)).toBeGreaterThan(0);
    }
  });
});

describe('chromaToF2', () => {
  test('zero chroma maps to ~840 Hz (back vowel)', () => {
    expect(chromaToF2(0)).toBeCloseTo(840, -1);
  });

  test('max chroma (0.4) maps to ~2290 Hz (front vowel)', () => {
    expect(chromaToF2(0.4)).toBeCloseTo(2290, -1);
  });

  test('higher chroma increases F2', () => {
    expect(chromaToF2(0.3)).toBeGreaterThan(chromaToF2(0.1));
  });
});

// ---- applyColorParams tests ----

function createMockBiquad(freq = 500) {
  return { frequency: { value: freq }, Q: { value: 3 }, type: 'bandpass' };
}

function createMockLowpass(freq = 4000) {
  return { frequency: { value: freq }, Q: { value: Math.SQRT1_2 }, type: 'lowpass' };
}

describe('applyColorParams', () => {
  test('solid fill sets F1 from hue', () => {
    const f1 = createMockBiquad();
    const f2 = createMockBiquad();
    const brightness = createMockLowpass();
    applyColorParams(f1, f2, brightness, { mode: 'solid', h: 0, c: 0.2, l: 0.5 });
    expect(f1.frequency.value).toBeCloseTo(270, -1);
  });

  test('solid fill sets F2 from chroma', () => {
    const f1 = createMockBiquad();
    const f2Low = createMockBiquad();
    const f2High = createMockBiquad();
    const b1 = createMockLowpass();
    const b2 = createMockLowpass();
    applyColorParams(f1, f2Low, b1, { mode: 'solid', h: 0, c: 0.1, l: 0.5 });
    applyColorParams(createMockBiquad(), f2High, b2, { mode: 'solid', h: 0, c: 0.3, l: 0.5 });
    expect(f2High.frequency.value).toBeGreaterThan(f2Low.frequency.value);
  });

  test('solid fill sets brightness cutoff from lightness', () => {
    const bDark = createMockLowpass();
    applyColorParams(createMockBiquad(), createMockBiquad(), bDark, {
      mode: 'solid',
      h: 0,
      c: 0.15,
      l: 0.1,
    });

    const bLight = createMockLowpass();
    applyColorParams(createMockBiquad(), createMockBiquad(), bLight, {
      mode: 'solid',
      h: 0,
      c: 0.15,
      l: 0.9,
    });

    expect(bLight.frequency.value).toBeGreaterThan(bDark.frequency.value);
  });
});

describe('yToPlaybackRate', () => {
  test('returns 1.0 when y maps to the reference pitch', () => {
    // Find the Y that produces a frequency closest to 440 Hz
    // YToFrequency maps Y=0 to highest, Y=1 to lowest
    const freq = yToFrequency(0.5);
    const rate = yToPlaybackRate(0.5, freq);
    expect(rate).toBeCloseTo(1);
  });

  test('rate > 1 for y above reference (higher pitch)', () => {
    const refPitch = yToFrequency(0.5);
    // Y=0.3 is higher pitch than Y=0.5
    const rate = yToPlaybackRate(0.3, refPitch);
    expect(rate).toBeGreaterThan(1);
  });

  test('rate < 1 for y below reference (lower pitch)', () => {
    const refPitch = yToFrequency(0.5);
    // Y=0.7 is lower pitch than Y=0.5
    const rate = yToPlaybackRate(0.7, refPitch);
    expect(rate).toBeLessThan(1);
  });

  test('rate equals yToFrequency / referencePitch', () => {
    const refPitch = 440;
    const rate = yToPlaybackRate(0.25, refPitch);
    expect(rate).toBeCloseTo(yToFrequency(0.25) / refPitch);
  });
});
