import { describe, expect, test } from 'bun:test';
import { hitTestADSRCorner, voiceRotation } from '../../js/shapes.ts';

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
