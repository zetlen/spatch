import { describe, expect, test } from 'bun:test';
import { getStrategy, ALL_STRATEGIES } from '../../js/waveforms/index.ts';

describe('waveform strategy registry', () => {
  test('getStrategy returns a strategy for each waveform type', () => {
    const waveforms = ['sine', 'pulse', 'blend', 'astroid', 'stamp'];
    for (const wf of waveforms) {
      const strategy = getStrategy(wf);
      expect(strategy).toBeDefined();
      expect(strategy.waveform).toBe(wf);
    }
  });

  test('ALL_STRATEGIES contains all strategies', () => {
    expect(ALL_STRATEGIES).toHaveLength(5);
    const waveforms = ALL_STRATEGIES.map((s) => s.waveform);
    expect(waveforms).toContain('sine');
    expect(waveforms).toContain('pulse');
    expect(waveforms).toContain('blend');
    expect(waveforms).toContain('astroid');
    expect(waveforms).toContain('stamp');
  });

  test('ALL_STRATEGIES is sorted by serializationIndex', () => {
    for (let i = 1; i < ALL_STRATEGIES.length; i++) {
      expect(ALL_STRATEGIES[i].serializationIndex).toBeGreaterThan(
        ALL_STRATEGIES[i - 1].serializationIndex,
      );
    }
  });

  test('serialization indices are 0–4', () => {
    expect(ALL_STRATEGIES[0].serializationIndex).toBe(0);
    expect(ALL_STRATEGIES[1].serializationIndex).toBe(1);
    expect(ALL_STRATEGIES[2].serializationIndex).toBe(2);
    expect(ALL_STRATEGIES[3].serializationIndex).toBe(3);
    expect(ALL_STRATEGIES[4].serializationIndex).toBe(4);
  });
});

describe('sine strategy identity', () => {
  const s = getStrategy('sine');

  test('identity properties', () => {
    expect(s.shapeName).toBe('circle');
    expect(s.svgTag).toBe('circle');
    expect(s.hasTimbre).toBe(false);
    expect(s.rotationPeriod).toBe(0);
    expect(s.serializationIndex).toBe(0);
    expect(s.oscillatorType).toBe('sine');
    expect(s.shapeAreaCoeff).toBeCloseTo(Math.PI);
    expect(s.formantMaxQ).toBe(4);
  });

  test('createVoice produces sine voice without timbre', () => {
    const base = {
      id: 'test1',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      fill: { mode: 'solid', h: 0, s: 50, l: 50 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const voice = s.createVoice(base);
    expect(voice.waveform).toBe('sine');
    expect('timbre' in voice).toBe(false);
    expect(voice.x).toBe(0.5);
  });

  test('packExtra returns empty string', () => {
    const voice = {
      waveform: 'sine',
      id: 'v1',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      fill: { mode: 'solid', h: 0, s: 50, l: 50 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    expect(s.packExtra(voice)).toBe('');
  });

  test('unpackExtra reads zero bytes', () => {
    const result = s.unpackExtra('ABCDEF', 0);
    expect(result.bytesRead).toBe(0);
    expect(Object.keys(result.fields)).toHaveLength(0);
  });
});

describe('pulse strategy identity', () => {
  const s = getStrategy('pulse');

  test('identity properties', () => {
    expect(s.shapeName).toBe('square');
    expect(s.svgTag).toBe('rect');
    expect(s.hasTimbre).toBe(true);
    expect(s.rotationPeriod).toBe(90);
    expect(s.serializationIndex).toBe(1);
    expect(s.oscillatorType).toBe('square');
    expect(s.shapeAreaCoeff).toBe(4);
    expect(s.formantMaxQ).toBe(8);
  });

  test('createVoice produces pulse voice with timbre', () => {
    const base = {
      id: 'test2',
      x: 0.3,
      y: 0.4,
      size: 0.15,
      fill: { mode: 'solid', h: 120, s: 80, l: 60 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const voice = s.createVoice(base);
    expect(voice.waveform).toBe('pulse');
    expect('timbre' in voice).toBe(true);
    expect(voice.timbre).toBe(0);
  });

  test('packExtra/unpackExtra round-trip timbre', () => {
    const voice = {
      waveform: 'pulse',
      timbre: 0.75,
      id: 'v2',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      fill: { mode: 'solid', h: 0, s: 50, l: 50 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const packed = s.packExtra(voice);
    expect(packed).toHaveLength(2);

    const result = s.unpackExtra(packed, 0);
    expect(result.bytesRead).toBe(2);
    expect(result.fields.timbre).toBeCloseTo(0.75);
  });
});

describe('blend strategy identity', () => {
  const s = getStrategy('blend');

  test('identity properties', () => {
    expect(s.shapeName).toBe('triangle');
    expect(s.svgTag).toBe('polygon');
    expect(s.hasTimbre).toBe(true);
    expect(s.rotationPeriod).toBe(120);
    expect(s.serializationIndex).toBe(2);
    expect(s.oscillatorType).toBe('sawtooth');
    expect(s.shapeAreaCoeff).toBeCloseTo((3 * Math.sqrt(3)) / 4);
    expect(s.formantMaxQ).toBe(8);
  });

  test('createVoice produces blend voice with timbre', () => {
    const base = {
      id: 'test3',
      x: 0.6,
      y: 0.2,
      size: 0.3,
      fill: { mode: 'solid', h: 240, s: 90, l: 40 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const voice = s.createVoice(base);
    expect(voice.waveform).toBe('blend');
    expect('timbre' in voice).toBe(true);
    expect(voice.timbre).toBe(0);
  });

  test('packExtra/unpackExtra round-trip timbre', () => {
    const voice = {
      waveform: 'blend',
      timbre: 0.333,
      id: 'v3',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      fill: { mode: 'solid', h: 0, s: 50, l: 50 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const packed = s.packExtra(voice);
    expect(packed).toHaveLength(2);

    const result = s.unpackExtra(packed, 0);
    expect(result.bytesRead).toBe(2);
    expect(result.fields.timbre).toBeCloseTo(0.333);
  });
});

describe('astroid strategy identity', () => {
  const s = getStrategy('astroid');

  test('identity properties', () => {
    expect(s.shapeName).toBe('astroid');
    expect(s.svgTag).toBe('path');
    expect(s.hasTimbre).toBe(true);
    expect(s.rotationPeriod).toBe(90);
    expect(s.serializationIndex).toBe(3);
    expect(s.oscillatorType).toBe('sawtooth');
    expect(s.shapeAreaCoeff).toBeCloseTo((3 * Math.PI) / 8);
    expect(s.formantMaxQ).toBe(8);
  });

  test('createVoice produces astroid voice with timbre', () => {
    const base = {
      id: 'test4',
      x: 0.4,
      y: 0.6,
      size: 0.2,
      fill: { mode: 'solid', h: 60, s: 70, l: 50 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const voice = s.createVoice(base);
    expect(voice.waveform).toBe('astroid');
    expect('timbre' in voice).toBe(true);
    expect(voice.timbre).toBe(0);
  });

  test('packExtra/unpackExtra round-trip timbre', () => {
    const voice = {
      waveform: 'astroid',
      timbre: 0.5,
      id: 'v4',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      fill: { mode: 'solid', h: 0, s: 50, l: 50 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const packed = s.packExtra(voice);
    expect(packed).toHaveLength(2);

    const result = s.unpackExtra(packed, 0);
    expect(result.bytesRead).toBe(2);
    expect(result.fields.timbre).toBeCloseTo(0.5);
  });
});

describe('strategy serialization indices match existing format', () => {
  test('sine = 0, pulse = 1, blend = 2, astroid = 3, stamp = 4', () => {
    expect(getStrategy('sine').serializationIndex).toBe(0);
    expect(getStrategy('pulse').serializationIndex).toBe(1);
    expect(getStrategy('blend').serializationIndex).toBe(2);
    expect(getStrategy('astroid').serializationIndex).toBe(3);
    expect(getStrategy('stamp').serializationIndex).toBe(4);
  });

  test('ALL_STRATEGIES[wf] lookup by index matches getStrategy', () => {
    expect(ALL_STRATEGIES[0]).toBe(getStrategy('sine'));
    expect(ALL_STRATEGIES[1]).toBe(getStrategy('pulse'));
    expect(ALL_STRATEGIES[2]).toBe(getStrategy('blend'));
    expect(ALL_STRATEGIES[3]).toBe(getStrategy('astroid'));
    expect(ALL_STRATEGIES[4]).toBe(getStrategy('stamp'));
  });
});

// ---- Stamp strategy tests ----

describe('stamp strategy', () => {
  const s = getStrategy('stamp');

  test('identity properties', () => {
    expect(s.shapeName).toBe('stamp');
    expect(s.svgTag).toBe('g');
    expect(s.hasTimbre).toBe(false);
    expect(s.rotationPeriod).toBe(0);
    expect(s.serializationIndex).toBe(4);
    expect(s.oscillatorType).toBe('sine');
  });

  test('createVoice produces stamp voice with stamp field', () => {
    const base = {
      id: 'st1',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      fill: { mode: 'solid', h: 0, s: 50, l: 50 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const voice = s.createVoice(base);
    expect(voice.waveform).toBe('stamp');
    expect('stamp' in voice).toBe(true);
    expect('timbre' in voice).toBe(false);
  });

  test('packExtra/unpackExtra round-trips stamp index', () => {
    const voice = {
      waveform: 'stamp',
      stamp: 2,
      id: 'st2',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      fill: { mode: 'solid', h: 0, s: 50, l: 50 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const packed = s.packExtra(voice);
    expect(packed).toHaveLength(1);

    const result = s.unpackExtra(packed, 0);
    expect(result.bytesRead).toBe(1);
    expect(result.fields.stamp).toBe(2);
  });

  test('packExtra/unpackExtra round-trips stamp index 0', () => {
    const voice = {
      waveform: 'stamp',
      stamp: 0,
      id: 'st3',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      fill: { mode: 'solid', h: 0, s: 50, l: 50 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const packed = s.packExtra(voice);
    const result = s.unpackExtra(packed, 0);
    expect(result.fields.stamp).toBe(0);
  });
});
