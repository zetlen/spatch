import { describe, expect, test } from 'bun:test';
import { encodeInt, decodeInt } from '../../js/voices/b64.ts';
import { createOscillatorSerializer } from '../../js/voices/serializers/oscillator.ts';
import { createSampleSerializer } from '../../js/voices/serializers/sample.ts';

// ---- Test helpers ----

function makeVoice(overrides = {}) {
  return {
    blend: 'screen',
    border: undefined,
    effect: undefined,
    fill: { h: 200, l: 50, mode: 'solid', s: 80 },
    id: 'test1',
    size: 0.5,
    waveform: 'sine',
    x: 0.5,
    y: 0.5,
    ...overrides,
  };
}

// ---- Base64 utilities ----

describe('b64 encode/decode', () => {
  test('round-trips integer values', () => {
    for (const val of [0, 1, 42, 63, 4095]) {
      const chars = val > 63 ? 2 : 1;
      expect(decodeInt(encodeInt(val, chars), 0, chars)).toBe(val);
    }
  });

  test('encodes 0 as A', () => {
    expect(encodeInt(0, 1)).toBe('A');
  });

  test('encodes 63 as _', () => {
    expect(encodeInt(63, 1)).toBe('_');
  });

  test('multi-char encoding round-trips', () => {
    // 24 bits = 4 chars max = 16777215
    const val = 16777215;
    expect(decodeInt(encodeInt(val, 4), 0, 4)).toBe(val);
  });

  test('clamps negative values to 0', () => {
    expect(encodeInt(-5, 1)).toBe('A');
  });
});

// ---- OscillatorSerializer ----

describe('OscillatorSerializer', () => {
  const serializer = createOscillatorSerializer();

  describe('pack/unpack round-trip', () => {
    test('sine voice with solid fill', () => {
      const voice = makeVoice({ waveform: 'sine' });
      const packed = serializer.pack(voice);
      const unpacked = serializer.unpack(packed, 'sine');

      expect(unpacked.waveform).toBe('sine');
      expect(unpacked.fill.mode).toBe('solid');
      expect(unpacked.fill.h).toBe(200);
      expect(unpacked.fill.s).toBe(80);
      expect(unpacked.fill.l).toBe(50);
      expect(unpacked.blend).toBe('screen');
      expect(unpacked.effect).toBeUndefined();
      expect(unpacked.border).toBeUndefined();
      // IDs are regenerated
      expect(unpacked.id).toBeTruthy();
    });

    test('pulse voice with timbre', () => {
      const voice = makeVoice({ timbre: 0.75, waveform: 'pulse' });
      const packed = serializer.pack(voice);
      const unpacked = serializer.unpack(packed, 'pulse');

      expect(unpacked.waveform).toBe('pulse');
      // 6-bit timbre quantization: 0.75 * 63 = 47.25 → 47 → 47/63 ≈ 0.746
      expect(unpacked.timbre).toBeCloseTo(0.75, 1);
    });

    test('blend voice with timbre', () => {
      const voice = makeVoice({ timbre: 0.33, waveform: 'blend' });
      const packed = serializer.pack(voice);
      const unpacked = serializer.unpack(packed, 'blend');

      expect(unpacked.waveform).toBe('blend');
      expect(unpacked.timbre).toBeCloseTo(0.33, 1);
    });

    test('astroid voice with timbre', () => {
      const voice = makeVoice({ timbre: 0.5, waveform: 'astroid' });
      const packed = serializer.pack(voice);
      const unpacked = serializer.unpack(packed, 'astroid');

      expect(unpacked.waveform).toBe('astroid');
      expect(unpacked.timbre).toBeCloseTo(0.5, 1);
    });

    test('sine voice has timbre 0 after round-trip', () => {
      const voice = makeVoice({ waveform: 'sine' });
      const packed = serializer.pack(voice);
      const unpacked = serializer.unpack(packed, 'sine');

      // Sine has no timbre field — it should not appear on the output
      expect('timbre' in unpacked).toBe(false);
    });

    test('gradient fill round-trips', () => {
      const voice = makeVoice({
        fill: {
          gradAngle: 90,
          h: 100,
          h2: 200,
          l: 40,
          l2: 60,
          mode: 'linear',
          s: 50,
          s2: 70,
        },
      });
      const packed = serializer.pack(voice);
      const unpacked = serializer.unpack(packed, 'sine');

      expect(unpacked.fill.mode).toBe('linear');
      expect(unpacked.fill.gradAngle).toBe(90);
      expect(unpacked.fill.h).toBe(100);
      expect(unpacked.fill.s).toBe(50);
      expect(unpacked.fill.l).toBe(40);
      expect(unpacked.fill.h2).toBe(200);
      expect(unpacked.fill.s2).toBe(70);
      expect(unpacked.fill.l2).toBe(60);
    });

    test('all blend modes survive', () => {
      for (const blend of ['screen', 'multiply', 'difference']) {
        const voice = makeVoice({ blend });
        const unpacked = serializer.unpack(serializer.pack(voice), 'sine');
        expect(unpacked.blend).toBe(blend);
      }
    });

    test('all effects survive', () => {
      for (const effect of [undefined, 'stripes', 'checker', 'noise', 'plaid']) {
        const voice = makeVoice({ effect });
        const unpacked = serializer.unpack(serializer.pack(voice), 'sine');
        expect(unpacked.effect).toBe(effect);
      }
    });

    test('all border styles survive', () => {
      const borders = [
        undefined,
        { color: 'white', double: false, thickness: 0.5 },
        { color: 'black', double: false, thickness: 0.3 },
        { color: 'white', double: true, thickness: 0.7 },
        { color: 'black', double: true, thickness: 0.9 },
      ];
      for (const border of borders) {
        const voice = makeVoice({ border });
        const unpacked = serializer.unpack(serializer.pack(voice), 'sine');
        if (!border) {
          expect(unpacked.border).toBeUndefined();
        } else {
          expect(unpacked.border.color).toBe(border.color);
          expect(unpacked.border.double).toBe(border.double);
          // 3-bit thickness: 8 steps
          expect(unpacked.border.thickness).toBeCloseTo(border.thickness, 0);
        }
      }
    });
  });

  describe('widths', () => {
    test('solid voice has solidWidth chars', () => {
      const voice = makeVoice();
      expect(serializer.pack(voice)).toHaveLength(serializer.solidWidth);
    });

    test('gradient voice has gradientWidth chars', () => {
      const voice = makeVoice({
        fill: { gradAngle: 45, h: 100, h2: 200, l: 40, l2: 60, mode: 'linear', s: 50, s2: 70 },
      });
      expect(serializer.pack(voice)).toHaveLength(serializer.gradientWidth);
    });
  });

  describe('quantization accuracy', () => {
    test('X quantizes to 12 bits (4096 steps)', () => {
      const voice = makeVoice({ x: 0.5 });
      const unpacked = serializer.unpack(serializer.pack(voice), 'sine');
      expect(Math.abs(unpacked.x - 0.5)).toBeLessThan(0.001);
    });

    test('Y quantizes to note index (37 notes)', () => {
      // Y=0.5 → note index = round((1 - 0.5) * 36) = 18 → (1 - 18/36) = 0.5
      const voice = makeVoice({ y: 0.5 });
      const unpacked = serializer.unpack(serializer.pack(voice), 'sine');
      expect(Math.abs(unpacked.y - 0.5)).toBeLessThan(0.03);
    });

    test('size quantizes to 6 bits (64 steps)', () => {
      const voice = makeVoice({ size: 0.25 });
      const unpacked = serializer.unpack(serializer.pack(voice), 'sine');
      expect(Math.abs(unpacked.size - 0.25)).toBeLessThan(0.02);
    });

    test('timbre quantizes to 6 bits (64 steps)', () => {
      const voice = makeVoice({ timbre: 0.5, waveform: 'pulse' });
      const unpacked = serializer.unpack(serializer.pack(voice), 'pulse');
      expect(Math.abs(unpacked.timbre - 0.5)).toBeLessThan(0.02);
    });

    test('hue preserved exactly (9 bits, integer)', () => {
      for (const h of [0, 180, 360]) {
        const voice = makeVoice({ fill: { h, l: 50, mode: 'solid', s: 80 } });
        const unpacked = serializer.unpack(serializer.pack(voice), 'sine');
        expect(unpacked.fill.h).toBe(h);
      }
    });

    test('gradient angle preserved exactly (3 bits, 45° steps)', () => {
      for (const angle of [0, 45, 90, 135, 180, 225, 270, 315]) {
        const voice = makeVoice({
          fill: { gradAngle: angle, h: 100, h2: 200, l: 40, l2: 60, mode: 'linear', s: 50, s2: 70 },
        });
        const unpacked = serializer.unpack(serializer.pack(voice), 'sine');
        expect(unpacked.fill.gradAngle).toBe(angle);
      }
    });
  });

  describe('edge cases', () => {
    test('all-zero voice', () => {
      const voice = makeVoice({
        fill: { h: 0, l: 0, mode: 'solid', s: 0 },
        size: 0,
        x: 0,
        y: 0,
      });
      const unpacked = serializer.unpack(serializer.pack(voice), 'sine');
      expect(unpacked.x).toBe(0);
      // Y=0 → top of canvas → highest note index 36 → decoded: 1 - 36/36 = 0
      expect(unpacked.y).toBeCloseTo(0);
      expect(unpacked.fill.h).toBe(0);
    });

    test('max-value voice', () => {
      const voice = makeVoice({
        fill: { h: 360, l: 100, mode: 'solid', s: 100 },
        size: 1,
        x: 1,
        y: 1,
      });
      const unpacked = serializer.unpack(serializer.pack(voice), 'sine');
      expect(unpacked.x).toBeCloseTo(1, 1);
      expect(unpacked.y).toBeCloseTo(1, 1);
      expect(unpacked.size).toBeCloseTo(1, 1);
      expect(unpacked.fill.h).toBe(360);
    });
  });
});

// ---- SampleSerializer ----

describe('SampleSerializer', () => {
  const serializer = createSampleSerializer();

  test('stamp voice round-trips', () => {
    const voice = makeVoice({ stamp: 2, waveform: 'stamp' });
    const packed = serializer.pack(voice);
    const unpacked = serializer.unpack(packed, 'stamp');

    expect(unpacked.waveform).toBe('stamp');
    expect(unpacked.stamp).toBe(2);
  });

  test('stamp index 0-7 round-trips', () => {
    for (let i = 0; i < 8; i++) {
      const voice = makeVoice({ stamp: i, waveform: 'stamp' });
      const unpacked = serializer.unpack(serializer.pack(voice), 'stamp');
      expect(unpacked.stamp).toBe(i);
    }
  });

  test('solid width matches oscillator serializer', () => {
    const oscSerializer = createOscillatorSerializer();
    expect(serializer.solidWidth).toBe(oscSerializer.solidWidth);
  });

  test('gradient width matches oscillator serializer', () => {
    const oscSerializer = createOscillatorSerializer();
    expect(serializer.gradientWidth).toBe(oscSerializer.gradientWidth);
  });

  test('gradient fill round-trips', () => {
    const voice = makeVoice({
      fill: { gradAngle: 180, h: 50, h2: 300, l: 30, l2: 70, mode: 'linear', s: 90, s2: 40 },
      stamp: 3,
      waveform: 'stamp',
    });
    const unpacked = serializer.unpack(serializer.pack(voice), 'stamp');

    expect(unpacked.fill.mode).toBe('linear');
    expect(unpacked.fill.gradAngle).toBe(180);
    expect(unpacked.stamp).toBe(3);
  });

  test('border round-trips on stamp', () => {
    const voice = makeVoice({
      border: { color: 'black', double: true, thickness: 0.6 },
      stamp: 1,
      waveform: 'stamp',
    });
    const unpacked = serializer.unpack(serializer.pack(voice), 'stamp');

    expect(unpacked.border.color).toBe('black');
    expect(unpacked.border.double).toBe(true);
    expect(unpacked.border.thickness).toBeCloseTo(0.6, 0);
  });

  test('trigger 0-2 round-trips', () => {
    for (let t = 0; t < 3; t++) {
      const voice = makeVoice({ stamp: 1, trigger: t, waveform: 'stamp' });
      const unpacked = serializer.unpack(serializer.pack(voice), 'stamp');
      expect(unpacked.trigger).toBe(t);
    }
  });

  test('trigger defaults to 1 for value 3 (reserved)', () => {
    const voice = makeVoice({ stamp: 1, trigger: 0, waveform: 'stamp' });
    const packed = serializer.pack(voice);
    const sp4Raw = (1 << 3) | (3 << 1); // stamp=1, trigger=3 (reserved)
    const tampered = packed.slice(0, 8) + encodeInt(sp4Raw, 1) + packed.slice(9);
    const unpacked = serializer.unpack(tampered, 'stamp');
    expect(unpacked.trigger).toBe(1);
  });

  test('trigger + stamp index pack independently', () => {
    const voice = makeVoice({ stamp: 5, trigger: 2, waveform: 'stamp' });
    const unpacked = serializer.unpack(serializer.pack(voice), 'stamp');
    expect(unpacked.stamp).toBe(5);
    expect(unpacked.trigger).toBe(2);
  });
});

// ---- Canonical ordering ----

describe('canonical ordering', () => {
  const serializer = createOscillatorSerializer();

  test('identical voices produce identical strings', () => {
    const voice = makeVoice({ size: 0.3, x: 0.4, y: 0.6 });
    expect(serializer.pack(voice)).toBe(serializer.pack(voice));
  });

  test('different voices produce different strings', () => {
    const a = makeVoice({ x: 0.3 });
    const b = makeVoice({ x: 0.7 });
    expect(serializer.pack(a)).not.toBe(serializer.pack(b));
  });
});
