import { describe, test, expect } from 'bun:test';
import { Mixer } from '../../js/audio/mixer.ts';

describe('Mixer.areaToGain', () => {
  test('returns GAIN_MIN for zero size', () => {
    const mixer = new Mixer();
    expect(mixer.areaToGain('sine', 0)).toBeCloseTo(mixer.GAIN_MIN, 2);
  });

  test('returns value within bounds for medium size', () => {
    const mixer = new Mixer();
    const gain = mixer.areaToGain('sine', 0.5);
    expect(gain).toBeGreaterThanOrEqual(mixer.GAIN_MIN);
    expect(gain).toBeLessThanOrEqual(mixer.GAIN_MAX);
  });

  test('larger size produces higher gain', () => {
    const mixer = new Mixer();
    const small = mixer.areaToGain('sine', 0.2);
    const large = mixer.areaToGain('sine', 0.8);
    expect(large).toBeGreaterThan(small);
  });
});

describe('Mixer.voiceGain', () => {
  test('all waveforms converge at medium size', () => {
    const mixer = new Mixer();
    const sineGain = mixer.voiceGain('sine', 0.5);
    const pulseGain = mixer.voiceGain('pulse', 0.5);
    const blendGain = mixer.voiceGain('blend', 0.5);
    // Should be within 15% of each other
    expect(Math.abs(sineGain - pulseGain) / sineGain).toBeLessThan(0.15);
    expect(Math.abs(sineGain - blendGain) / sineGain).toBeLessThan(0.15);
  });

  test('never exceeds GAIN_MAX', () => {
    const mixer = new Mixer();
    expect(mixer.voiceGain('sine', 1)).toBeLessThanOrEqual(mixer.GAIN_MAX);
    expect(mixer.voiceGain('astroid', 1)).toBeLessThanOrEqual(mixer.GAIN_MAX);
  });
});

describe('Mixer.xToPan', () => {
  test('center maps to 0', () => {
    const mixer = new Mixer();
    expect(mixer.xToPan(0.5)).toBeCloseTo(0);
  });

  test('left edge maps to -1', () => {
    const mixer = new Mixer();
    expect(mixer.xToPan(0)).toBeCloseTo(-1);
  });

  test('right edge maps to 1', () => {
    const mixer = new Mixer();
    expect(mixer.xToPan(1)).toBeCloseTo(1);
  });
});

describe('Mixer.borderOctaveGain', () => {
  test('zero thickness returns 0', () => {
    const mixer = new Mixer();
    expect(mixer.borderOctaveGain(0, 'white', false)).toBe(0);
  });

  test('up-1 uses lower coefficient than down-1', () => {
    const mixer = new Mixer();
    const up = mixer.borderOctaveGain(0.5, 'white', false);
    const down = mixer.borderOctaveGain(0.5, 'black', false);
    expect(down).toBeGreaterThan(up);
  });

  test('double octave uses different coefficient than single', () => {
    const mixer = new Mixer();
    const single = mixer.borderOctaveGain(0.5, 'white', false);
    const double = mixer.borderOctaveGain(0.5, 'white', true);
    expect(single).not.toBeCloseTo(double);
  });
});
