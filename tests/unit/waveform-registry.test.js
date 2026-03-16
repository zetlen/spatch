import { describe, expect, test } from 'bun:test';
import { getStrategy, ALL_STRATEGIES } from '../../js/waveforms/index.ts';

describe('waveform strategy registry', () => {
  test('getStrategy returns a strategy for each waveform type', () => {
    const waveforms = ['sine', 'pulse', 'blend'];
    for (const wf of waveforms) {
      const strategy = getStrategy(wf);
      expect(strategy).toBeDefined();
      expect(strategy.waveform).toBe(wf);
    }
  });

  test('ALL_STRATEGIES contains all three strategies', () => {
    expect(ALL_STRATEGIES).toHaveLength(3);
    const waveforms = ALL_STRATEGIES.map((s) => s.waveform);
    expect(waveforms).toContain('sine');
    expect(waveforms).toContain('pulse');
    expect(waveforms).toContain('blend');
  });

  test('ALL_STRATEGIES is sorted by serializationIndex', () => {
    for (let i = 1; i < ALL_STRATEGIES.length; i++) {
      expect(ALL_STRATEGIES[i].serializationIndex).toBeGreaterThan(
        ALL_STRATEGIES[i - 1].serializationIndex,
      );
    }
  });

  test('serialization indices are 0, 1, 2', () => {
    expect(ALL_STRATEGIES[0].serializationIndex).toBe(0);
    expect(ALL_STRATEGIES[1].serializationIndex).toBe(1);
    expect(ALL_STRATEGIES[2].serializationIndex).toBe(2);
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

  test('svgAttrs returns circle attributes', () => {
    const voice = { x: 0.3, y: 0.7, size: 0.2 };
    const attrs = s.svgAttrs(voice);
    expect(attrs.cx).toBe('0.3');
    expect(attrs.cy).toBe('0.7');
    expect(attrs.r).toBe('0.1');
  });

  test('handlePositions returns cardinal positions', () => {
    const voice = { x: 0.5, y: 0.5, size: 0.2 };
    const handles = s.handlePositions(voice);
    expect(handles).toHaveLength(4);
    const types = handles.map((h) => h[0]);
    expect(types).toContain('n');
    expect(types).toContain('e');
    expect(types).toContain('s');
    expect(types).toContain('w');
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

  test('svgAttrs returns rect attributes', () => {
    const voice = { x: 0.5, y: 0.5, size: 0.2 };
    const attrs = s.svgAttrs(voice);
    expect(attrs.width).toBe('0.2');
    expect(attrs.height).toBe('0.2');
    expect(attrs.x).toBe('0.4');
    expect(attrs.y).toBe('0.4');
  });

  test('handlePositions returns corner positions', () => {
    const voice = { x: 0.5, y: 0.5, size: 0.2 };
    const handles = s.handlePositions(voice);
    expect(handles).toHaveLength(4);
    const types = handles.map((h) => h[0]);
    expect(types).toContain('nw');
    expect(types).toContain('ne');
    expect(types).toContain('se');
    expect(types).toContain('sw');
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

  test('svgAttrs returns points attribute', () => {
    const voice = { x: 0.5, y: 0.5, size: 0.2 };
    const attrs = s.svgAttrs(voice);
    expect(attrs.points).toBeDefined();
    expect(typeof attrs.points).toBe('string');
    // Triangle should have 3 vertices (space-separated pairs)
    const points = attrs.points.split(' ');
    expect(points).toHaveLength(3);
  });

  test('handlePositions returns 3 vertex positions', () => {
    const voice = { x: 0.5, y: 0.5, size: 0.2 };
    const handles = s.handlePositions(voice);
    expect(handles).toHaveLength(3);
    const types = handles.map((h) => h[0]);
    expect(types).toContain('n');
    expect(types).toContain('se');
    expect(types).toContain('sw');
  });
});

describe('strategy svgAttrs match original geometry', () => {
  test('sine circle attrs match circleAttrs', () => {
    const voice = { x: 0.35, y: 0.65, size: 0.18 };
    const attrs = getStrategy('sine').svgAttrs(voice);
    expect(parseFloat(attrs.cx)).toBeCloseTo(0.35);
    expect(parseFloat(attrs.cy)).toBeCloseTo(0.65);
    expect(parseFloat(attrs.r)).toBeCloseTo(0.09);
  });

  test('pulse rect attrs match rectAttrs', () => {
    const voice = { x: 0.4, y: 0.6, size: 0.3 };
    const attrs = getStrategy('pulse').svgAttrs(voice);
    expect(parseFloat(attrs.x)).toBeCloseTo(0.25);
    expect(parseFloat(attrs.y)).toBeCloseTo(0.45);
    expect(parseFloat(attrs.width)).toBeCloseTo(0.3);
    expect(parseFloat(attrs.height)).toBeCloseTo(0.3);
  });

  test('blend triangle points match trianglePoints', () => {
    const voice = { x: 0.5, y: 0.5, size: 0.2 };
    const attrs = getStrategy('blend').svgAttrs(voice);
    const points = attrs.points.split(' ').map((p) => p.split(',').map(Number));
    expect(points).toHaveLength(3);

    // Top vertex: should be at (x, y - r) before rotation offset
    const r = 0.1;
    // vertex 0: angle = -PI/2 (top)
    expect(points[0][0]).toBeCloseTo(0.5);
    expect(points[0][1]).toBeCloseTo(0.5 - r);
  });
});

describe('strategy serialization indices match existing format', () => {
  test('sine = 0, pulse = 1, blend = 2', () => {
    expect(getStrategy('sine').serializationIndex).toBe(0);
    expect(getStrategy('pulse').serializationIndex).toBe(1);
    expect(getStrategy('blend').serializationIndex).toBe(2);
  });

  test('ALL_STRATEGIES[wf] lookup by index matches getStrategy', () => {
    expect(ALL_STRATEGIES[0]).toBe(getStrategy('sine'));
    expect(ALL_STRATEGIES[1]).toBe(getStrategy('pulse'));
    expect(ALL_STRATEGIES[2]).toBe(getStrategy('blend'));
  });
});
