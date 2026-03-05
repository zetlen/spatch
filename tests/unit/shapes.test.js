import { describe, expect, test } from 'bun:test';
import { calcResize, calcRotation, hitTestADSRCorner, voiceRotation } from '../../js/shapes.ts';

const CANVAS_SIZE = 800;

function makeVoice(overrides = {}) {
  return {
    effect: undefined,
    fill: { h: 200, l: 50, mode: 'solid', s: 80 },
    id: 'test1',
    size: 0.12,
    waveform: 'sine',
    x: 0.5,
    y: 0.5,
    ...overrides,
  };
}

describe('hitTestADSRCorner', () => {
  const envelope = { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 };

  test('detects attack corner (bottom-left)', () => {
    const result = hitTestADSRCorner(envelope, 5, CANVAS_SIZE - 5, CANVAS_SIZE);
    expect(result).toBe('attack');
  });

  test('detects decay corner (top-left)', () => {
    const result = hitTestADSRCorner(envelope, 5, 5, CANVAS_SIZE);
    expect(result).toBe('decay');
  });

  test('detects sustain corner (top-right)', () => {
    const result = hitTestADSRCorner(envelope, CANVAS_SIZE - 5, 5, CANVAS_SIZE);
    expect(result).toBe('sustain');
  });

  test('detects release corner (bottom-right)', () => {
    const result = hitTestADSRCorner(envelope, CANVAS_SIZE - 5, CANVAS_SIZE - 5, CANVAS_SIZE);
    expect(result).toBe('release');
  });

  test('returns null for center of canvas', () => {
    const result = hitTestADSRCorner(envelope, 400, 400, CANVAS_SIZE);
    expect(result).toBeUndefined();
  });
});

describe('calcResize', () => {
  const voice = makeVoice({ size: 0.12 });

  test('SE handle increases size with positive drag', () => {
    const newSize = calcResize(voice, 'se', 20, 20, CANVAS_SIZE);
    expect(newSize).toBeGreaterThan(voice.size);
  });

  test('NW handle increases size with negative drag', () => {
    const newSize = calcResize(voice, 'nw', -20, -20, CANVAS_SIZE);
    expect(newSize).toBeGreaterThan(voice.size);
  });

  test('E handle responds to horizontal drag only', () => {
    const bigger = calcResize(voice, 'e', 20, 0, CANVAS_SIZE);
    const same = calcResize(voice, 'e', 0, 20, CANVAS_SIZE);
    expect(bigger).toBeGreaterThan(voice.size);
    // Vertical drag should not change size for 'e' handle
    expect(same).toBeCloseTo(voice.size, 2);
  });

  test('clamps to minimum size', () => {
    const tiny = calcResize(voice, 'se', -1000, -1000, CANVAS_SIZE);
    expect(tiny).toBeGreaterThan(0);
    expect(tiny).toBeCloseTo((10 * 2) / CANVAS_SIZE, 5); // Min radius 10 → size 20/800
  });

  test('clamps to maximum size', () => {
    const huge = calcResize(voice, 'se', 10_000, 10_000, CANVAS_SIZE);
    expect(huge).toBeLessThanOrEqual(0.9); // Max radius 0.45*800 → size 0.9
  });
});

describe('calcRotation', () => {
  test('mouse directly above shape returns ~0 degrees', () => {
    const voice = makeVoice({ x: 0.5, y: 0.5 });
    // Directly above: mx=400, my=300
    const deg = calcRotation(voice, 400, 300, CANVAS_SIZE);
    expect(deg).toBeCloseTo(0, 0);
  });

  test('mouse to the right returns ~90 degrees', () => {
    const voice = makeVoice({ x: 0.5, y: 0.5 });
    const deg = calcRotation(voice, 500, 400, CANVAS_SIZE);
    expect(deg).toBeCloseTo(90, 0);
  });

  test('mouse below returns ~180 degrees', () => {
    const voice = makeVoice({ x: 0.5, y: 0.5 });
    const deg = calcRotation(voice, 400, 500, CANVAS_SIZE);
    expect(deg).toBeCloseTo(180, 0);
  });

  test('mouse to the left returns ~270 degrees', () => {
    const voice = makeVoice({ x: 0.5, y: 0.5 });
    const deg = calcRotation(voice, 300, 400, CANVAS_SIZE);
    expect(deg).toBeCloseTo(270, 0);
  });
});

describe('voiceRotation', () => {
  test('sine voice always returns 0', () => {
    const voice = makeVoice({ waveform: 'sine' });
    expect(voiceRotation(voice)).toBe(0);
  });

  test('pulse voice with timbre 0 returns 0', () => {
    const voice = makeVoice({ timbre: 0, waveform: 'pulse' });
    expect(voiceRotation(voice)).toBe(0);
  });

  test('pulse voice with timbre 1 returns 90 (full period)', () => {
    const voice = makeVoice({ timbre: 1, waveform: 'pulse' });
    expect(voiceRotation(voice)).toBe(90);
  });

  test('pulse voice with timbre 0.5 returns 45', () => {
    const voice = makeVoice({ timbre: 0.5, waveform: 'pulse' });
    expect(voiceRotation(voice)).toBe(45);
  });

  test('blend voice with timbre 1 returns 120 (full period)', () => {
    const voice = makeVoice({ timbre: 1, waveform: 'blend' });
    expect(voiceRotation(voice)).toBe(120);
  });

  test('blend voice with timbre 0.5 returns 60', () => {
    const voice = makeVoice({ timbre: 0.5, waveform: 'blend' });
    expect(voiceRotation(voice)).toBe(60);
  });
});
