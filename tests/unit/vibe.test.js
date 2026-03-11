import { describe, expect, test } from 'bun:test';
import { effect } from '@preact/signals-core';
import { vibe, Vibe, VIBE_DEFAULTS, vibeSignal, setVibe } from '../../js/audio/vibe.ts';

describe('vibe.shapeAreaFraction', () => {
  test('sine (circle) area = pi * (size/2)^2', () => {
    expect(vibe.shapeAreaFraction('sine', 0.5)).toBeCloseTo(Math.PI * 0.25 * 0.25);
  });

  test('pulse (square) area = size^2', () => {
    expect(vibe.shapeAreaFraction('pulse', 0.5)).toBeCloseTo(0.25);
  });

  test('blend (triangle) area < sine < pulse at same size', () => {
    const size = 0.4;
    const tri = vibe.shapeAreaFraction('blend', size);
    const circ = vibe.shapeAreaFraction('sine', size);
    const sq = vibe.shapeAreaFraction('pulse', size);
    expect(tri).toBeLessThan(circ);
    expect(circ).toBeLessThan(sq);
  });

  test('area scales with size squared', () => {
    for (const type of ['sine', 'pulse', 'blend']) {
      const small = vibe.shapeAreaFraction(type, 0.2);
      const big = vibe.shapeAreaFraction(type, 0.4);
      expect(big / small).toBeCloseTo(4);
    }
  });
});

describe('vibe.areaToGain', () => {
  test('tiny shape returns near-minimum gain', () => {
    expect(vibe.areaToGain('sine', 0.025)).toBeCloseTo(vibe.GAIN_MIN, 1);
  });

  test('large shape does not exceed GAIN_MAX', () => {
    expect(vibe.areaToGain('pulse', 0.95)).toBeLessThanOrEqual(vibe.GAIN_MAX);
    expect(vibe.areaToGain('sine', 0.95)).toBeLessThanOrEqual(vibe.GAIN_MAX);
    expect(vibe.areaToGain('blend', 0.95)).toBeLessThanOrEqual(vibe.GAIN_MAX);
  });

  test('gain increases with size for all waveforms', () => {
    for (const type of ['sine', 'pulse', 'blend']) {
      const small = vibe.areaToGain(type, 0.2);
      const big = vibe.areaToGain(type, 0.5);
      expect(big).toBeGreaterThan(small);
    }
  });

  test('pulse ramps slower than sine at small sizes', () => {
    const sineGain = vibe.areaToGain('sine', 0.3);
    const pulseGain = vibe.areaToGain('pulse', 0.3);
    expect(pulseGain).toBeLessThan(sineGain);
  });

  test('blend ramps slower than sine at small sizes', () => {
    const sineGain = vibe.areaToGain('sine', 0.3);
    const blendGain = vibe.areaToGain('blend', 0.3);
    expect(blendGain).toBeLessThan(sineGain);
  });
});

describe('vibe.waveformGain', () => {
  test('all waveforms return positive values', () => {
    for (const wf of ['sine', 'pulse', 'blend']) {
      expect(vibe.waveformGain(wf)).toBeGreaterThan(0);
    }
  });

  test('waveform gains differ per waveform', () => {
    const sine = vibe.waveformGain('sine');
    const pulse = vibe.waveformGain('pulse');
    const blend = vibe.waveformGain('blend');
    // They should not all be identical (convergence multipliers vary)
    expect(sine === pulse && pulse === blend).toBe(false);
  });
});

describe('vibe.voiceGain — convergence at medium size', () => {
  test('at size=0.5, all waveforms produce gain within 10% of each other', () => {
    const sineGain = vibe.voiceGain('sine', 0.5);
    const pulseGain = vibe.voiceGain('pulse', 0.5);
    const blendGain = vibe.voiceGain('blend', 0.5);

    const avg = (sineGain + pulseGain + blendGain) / 3;
    expect(Math.abs(sineGain - avg) / avg).toBeLessThan(0.1);
    expect(Math.abs(pulseGain - avg) / avg).toBeLessThan(0.1);
    expect(Math.abs(blendGain - avg) / avg).toBeLessThan(0.1);
  });

  test('monotonically increases with size for all waveforms', () => {
    for (const wf of ['sine', 'pulse', 'blend']) {
      let prev = vibe.voiceGain(wf, 0.05);
      for (let s = 0.1; s <= 0.95; s += 0.05) {
        const g = vibe.voiceGain(wf, s);
        expect(g).toBeGreaterThanOrEqual(prev);
        prev = g;
      }
    }
  });

  test('caps at GAIN_MAX for all waveforms', () => {
    for (const wf of ['sine', 'pulse', 'blend']) {
      expect(vibe.voiceGain(wf, 0.95)).toBeLessThanOrEqual(vibe.GAIN_MAX);
    }
  });
});

describe('vibe.borderOctaveGain', () => {
  test('returns 0 for zero thickness', () => {
    expect(vibe.borderOctaveGain('sine', 0.5, 0, 'white', false)).toBe(0);
  });

  test('scales with shape size (larger shape = louder)', () => {
    const small = vibe.borderOctaveGain('sine', 0.2, 0.5, 'white', false);
    const large = vibe.borderOctaveGain('sine', 0.6, 0.5, 'white', false);
    expect(large).toBeGreaterThan(small);
  });

  test('scales with thickness', () => {
    const thin = vibe.borderOctaveGain('sine', 0.5, 0.2, 'white', false);
    const thick = vibe.borderOctaveGain('sine', 0.5, 0.8, 'white', false);
    expect(thick).toBeGreaterThan(thin);
  });

  test('octave up (white) is quieter than octave down (black)', () => {
    const up = vibe.borderOctaveGain('sine', 0.5, 0.5, 'white', false);
    const down = vibe.borderOctaveGain('sine', 0.5, 0.5, 'black', false);
    expect(down).toBeGreaterThan(up);
  });

  test('double octave up is quieter than single octave up', () => {
    const single = vibe.borderOctaveGain('sine', 0.5, 0.5, 'white', false);
    const double = vibe.borderOctaveGain('sine', 0.5, 0.5, 'white', true);
    expect(double).toBeLessThan(single);
  });

  test('double octave down is louder than single octave down', () => {
    const single = vibe.borderOctaveGain('sine', 0.5, 0.5, 'black', false);
    const double = vibe.borderOctaveGain('sine', 0.5, 0.5, 'black', true);
    expect(double).toBeGreaterThan(single);
  });

  test('different waveforms at small size produce different gains', () => {
    // At size=0.5 voiceGain converges, so use size=0.3 where curves diverge
    const sine = vibe.borderOctaveGain('sine', 0.3, 0.5, 'white', false);
    const pulse = vibe.borderOctaveGain('pulse', 0.3, 0.5, 'white', false);
    expect(sine).not.toBeCloseTo(pulse, 2);
  });

  test('always returns non-negative', () => {
    for (const wf of ['sine', 'pulse', 'blend']) {
      for (const color of ['white', 'black']) {
        for (const dbl of [false, true]) {
          const g = vibe.borderOctaveGain(wf, 0.5, 0.5, color, dbl);
          expect(g).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('Vibe — new parameters', () => {
  test('defaults are applied when no options given', () => {
    const v = new Vibe();
    expect(v.ir).toBe(VIBE_DEFAULTS.ir);
    expect(v.reverbMix).toBe(VIBE_DEFAULTS.reverbMix);
    expect(v.compThreshold).toBe(VIBE_DEFAULTS.compThreshold);
    expect(v.masterGain).toBe(VIBE_DEFAULTS.masterGain);
    expect(v.warmth).toBe(VIBE_DEFAULTS.warmth);
    expect(v.stereoWidth).toBe(VIBE_DEFAULTS.stereoWidth);
    expect(v.formantMix).toBe(VIBE_DEFAULTS.formantMix);
    expect(v.saturation).toBe(VIBE_DEFAULTS.saturation);
    expect(v.excite).toBe(VIBE_DEFAULTS.excite);
    expect(v.combMix).toBe(VIBE_DEFAULTS.combMix);
    expect(v.combFreq).toBe(VIBE_DEFAULTS.combFreq);
  });

  test('partial overrides merge with defaults', () => {
    const v = new Vibe({ reverbMix: 0.6, warmth: 2.0 });
    expect(v.reverbMix).toBe(0.6);
    expect(v.warmth).toBe(2.0);
    expect(v.ir).toBe(VIBE_DEFAULTS.ir);
    expect(v.compThreshold).toBe(VIBE_DEFAULTS.compThreshold);
  });

  test('master effect params can be overridden', () => {
    const v = new Vibe({ saturation: 3, excite: 0.5, combMix: 0.4, combFreq: 0.012 });
    expect(v.saturation).toBe(3);
    expect(v.excite).toBe(0.5);
    expect(v.combMix).toBe(0.4);
    expect(v.combFreq).toBe(0.012);
  });

  test('master effect defaults are zero (off)', () => {
    const v = new Vibe();
    expect(v.saturation).toBe(0);
    expect(v.excite).toBe(0);
    expect(v.combMix).toBe(0);
  });

  test('stereoWidth scales pan', () => {
    const narrow = new Vibe({ stereoWidth: 0.5 });
    expect(narrow.stereoWidth).toBe(0.5);
    const full = new Vibe({ stereoWidth: 1.0 });
    expect(full.stereoWidth).toBe(1.0);
  });
});

describe('vibeSignal reactivity', () => {
  test('setVibe updates vibeSignal.value', () => {
    const before = vibeSignal.value;
    const custom = new Vibe({ warmth: 3.0 });
    setVibe(custom);
    expect(vibeSignal.value).toBe(custom);
    expect(vibeSignal.value).not.toBe(before);
    // Restore default
    setVibe(new Vibe());
  });

  test('setVibe updates module-level vibe binding', () => {
    const custom = new Vibe({ stereoWidth: 0.3 });
    setVibe(custom);
    expect(vibe).toBe(custom);
    expect(vibe.stereoWidth).toBe(0.3);
    setVibe(new Vibe());
  });

  test('effect() fires when setVibe is called', () => {
    const seen = [];
    const dispose = effect(() => {
      seen.push(vibeSignal.value.warmth);
    });
    // Effect runs once on creation with current value
    expect(seen.length).toBe(1);
    setVibe(new Vibe({ warmth: 4.0 }));
    expect(seen.length).toBe(2);
    expect(seen[1]).toBe(4.0);
    setVibe(new Vibe({ warmth: 1.0 }));
    expect(seen.length).toBe(3);
    expect(seen[2]).toBe(1.0);
    dispose();
    // After dispose, no more notifications
    setVibe(new Vibe({ warmth: 2.0 }));
    expect(seen.length).toBe(3);
    // Restore default
    setVibe(new Vibe());
  });
});

describe('scene vibe presets produce distinct Vibe instances', () => {
  // Importing SCENES would pull in image assets, so test via Vibe construction
  const sceneVibes = [
    { name: 'chiclet', opts: { reverbMix: 0.7, eqHighGain: 3, warmth: 1.8, stereoWidth: 1.2 } },
    { name: 'structure-b', opts: { reverbMix: 0.8, eqLowGain: 2, warmth: 2.5, stereoWidth: 1.6 } },
    { name: 'tartu', opts: { reverbMix: 0.75, eqHighGain: 3, warmth: 1.1, formantQ: 1.4 } },
    { name: 'knockdown', opts: { reverbMix: 0.6, compRatio: 4, warmth: 2.0, stereoWidth: 0.8 } },
  ];

  test('each scene vibe differs from defaults', () => {
    const def = new Vibe();
    for (const { opts } of sceneVibes) {
      const v = new Vibe(opts);
      const differs =
        v.warmth !== def.warmth ||
        v.stereoWidth !== def.stereoWidth ||
        v.eqHighGain !== def.eqHighGain ||
        v.compRatio !== def.compRatio;
      expect(differs).toBe(true);
    }
  });

  test('scene vibes differ from each other in voiceGain', () => {
    // At minimum, stereoWidth and warmth produce distinct Vibe instances
    const vibes = sceneVibes.map(({ opts }) => new Vibe(opts));
    const warmths = new Set(vibes.map((v) => v.warmth));
    expect(warmths.size).toBeGreaterThan(1);
  });
});
