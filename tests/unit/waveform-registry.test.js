import { describe, expect, test } from 'bun:test';
import { get, getById, all, hasTimbre, createVoice } from '../../js/voices/registry.ts';

describe('voice registry', () => {
  test('get() returns an entry for each waveform type', () => {
    const waveforms = ['sine', 'pulse', 'blend', 'astroid', 'stamp'];
    for (const wf of waveforms) {
      const entry = get(wf);
      expect(entry).toBeDefined();
      expect(entry.waveform).toBe(wf);
    }
  });

  test('all() returns 5 entries', () => {
    expect(all()).toHaveLength(5);
    const waveforms = all().map((e) => e.waveform);
    expect(waveforms).toContain('sine');
    expect(waveforms).toContain('pulse');
    expect(waveforms).toContain('blend');
    expect(waveforms).toContain('astroid');
    expect(waveforms).toContain('stamp');
  });

  test('all() is sorted by id', () => {
    const entries = all();
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].id).toBeGreaterThan(entries[i - 1].id);
    }
  });

  test('IDs are 0-4', () => {
    const entries = all();
    expect(entries[0].id).toBe(0);
    expect(entries[1].id).toBe(1);
    expect(entries[2].id).toBe(2);
    expect(entries[3].id).toBe(3);
    expect(entries[4].id).toBe(4);
  });

  test('getById() matches get()', () => {
    for (const entry of all()) {
      expect(getById(entry.id)).toBe(entry);
    }
  });

  test('getById() returns undefined for invalid ID', () => {
    expect(getById(99)).toBeUndefined();
  });
});

describe('sine entry', () => {
  const entry = get('sine');

  test('identity', () => {
    expect(entry.ui.shapeName).toBe('circle');
    expect(entry.ui.svgTag).toBe('circle');
    expect(entry.rotationPeriod).toBe(0);
    expect(entry.id).toBe(0);
    expect(entry.player.oscillatorType).toBe('sine');
    expect(entry.player.shapeAreaCoeff).toBeCloseTo(Math.PI);
    //.toBe(2);
  });

  test('hasTimbre is false', () => {
    expect(hasTimbre('sine')).toBe(false);
  });

  test('createVoice produces sine voice without timbre', () => {
    const base = {
      id: 'test1',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      fill: { mode: 'solid', h: 0, c: 0.15, l: 0.5 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const voice = createVoice('sine', base);
    expect(voice.waveform).toBe('sine');
    expect('timbre' in voice).toBe(false);
  });
});

describe('pulse entry', () => {
  const entry = get('pulse');

  test('identity', () => {
    expect(entry.ui.shapeName).toBe('square');
    expect(entry.ui.svgTag).toBe('rect');
    expect(entry.rotationPeriod).toBe(90);
    expect(entry.id).toBe(1);
    expect(entry.player.oscillatorType).toBe('square');
    expect(entry.player.shapeAreaCoeff).toBe(4);
    //.toBe(3);
  });

  test('hasTimbre is true', () => {
    expect(hasTimbre('pulse')).toBe(true);
  });

  test('createVoice produces pulse voice with timbre', () => {
    const base = {
      id: 'test2',
      x: 0.3,
      y: 0.4,
      size: 0.15,
      fill: { mode: 'solid', h: 120, c: 0.24, l: 0.6 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const voice = createVoice('pulse', base);
    expect(voice.waveform).toBe('pulse');
    expect('timbre' in voice).toBe(true);
    expect(voice.timbre).toBe(0);
  });
});

describe('blend entry', () => {
  const entry = get('blend');

  test('identity', () => {
    expect(entry.ui.shapeName).toBe('triangle');
    expect(entry.ui.svgTag).toBe('polygon');
    expect(entry.rotationPeriod).toBe(120);
    expect(entry.id).toBe(2);
    expect(entry.player.oscillatorType).toBe('sawtooth');
    expect(entry.player.shapeAreaCoeff).toBeCloseTo((3 * Math.sqrt(3)) / 4);
    //.toBe(3);
  });

  test('hasTimbre is true', () => {
    expect(hasTimbre('blend')).toBe(true);
  });
});

describe('astroid entry', () => {
  const entry = get('astroid');

  test('identity', () => {
    expect(entry.ui.shapeName).toBe('astroid');
    expect(entry.ui.svgTag).toBe('path');
    expect(entry.rotationPeriod).toBe(90);
    expect(entry.id).toBe(3);
    expect(entry.player.oscillatorType).toBe('sawtooth');
    expect(entry.player.shapeAreaCoeff).toBeCloseTo((3 * Math.PI) / 8);
    //.toBe(3.5);
  });
});

describe('stamp entry', () => {
  const entry = get('stamp');

  test('identity', () => {
    expect(entry.ui.shapeName).toBe('stamp');
    expect(entry.ui.svgTag).toBe('g');
    expect(entry.rotationPeriod).toBe(0);
    expect(entry.id).toBe(4);
    expect(entry.player.oscillatorType).toBe('sine');
  });

  test('hasTimbre is false', () => {
    expect(hasTimbre('stamp')).toBe(false);
  });

  test('createVoice produces stamp voice with stamp field', () => {
    const base = {
      id: 'st1',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      fill: { mode: 'solid', h: 0, c: 0.15, l: 0.5 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const voice = createVoice('stamp', base);
    expect(voice.waveform).toBe('stamp');
    expect('stamp' in voice).toBe(true);
    expect('timbre' in voice).toBe(false);
  });
});

describe('panels descriptor', () => {
  test('all entries have a panels object', () => {
    for (const entry of all()) {
      expect(entry.panels).toBeDefined();
      expect(typeof entry.panels.border).toBe('boolean');
      expect(typeof entry.panels.stample).toBe('boolean');
    }
  });

  test('oscillator voices have border but not stample', () => {
    for (const wf of ['sine', 'pulse', 'blend', 'astroid']) {
      const entry = get(wf);
      expect(entry.panels.border).toBe(true);
      expect(entry.panels.stample).toBe(false);
    }
  });

  test('stamp voice has stample but not border', () => {
    const entry = get('stamp');
    expect(entry.panels.border).toBe(false);
    expect(entry.panels.stample).toBe(true);
  });
});

describe('stamp createVoice defaults', () => {
  test('createVoice sets trigger to 1 (Decay)', () => {
    const base = {
      id: 'test',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      fill: { mode: 'solid', h: 0, c: 0.15, l: 0.5 },
      effect: undefined,
      blend: 'screen',
      border: undefined,
    };
    const voice = createVoice('stamp', base);
    expect(voice.trigger).toBe(1);
  });

  test('createVoice forces border to undefined', () => {
    const base = {
      id: 'test',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      fill: { mode: 'solid', h: 0, c: 0.15, l: 0.5 },
      effect: undefined,
      blend: 'screen',
      border: { color: 'white', double: false, thickness: 0.5 },
    };
    const voice = createVoice('stamp', base);
    expect(voice.border).toBeUndefined();
  });
});
