import { describe, expect, test } from 'bun:test';
import {
  clearDragTilt,
  getDragTilt,
  hardSnapTrigger,
  hitTestADSRCorner,
  setDragTilt,
  snapTriggerTilt,
  voiceRotation,
} from '../../js/shapes.ts';

const CANVAS_SIZE = 800;

function makeVoice(overrides = {}) {
  return {
    effect: undefined,
    fill: { h: 200, c: 0.2, l: 0.5, mode: 'solid' },
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

  test('stamp trigger=0 returns -15', () => {
    const voice = makeVoice({ waveform: 'stamp', trigger: 0, stamp: 0 });
    expect(voiceRotation(voice)).toBe(-15);
  });

  test('stamp trigger=1 returns 0', () => {
    const voice = makeVoice({ waveform: 'stamp', trigger: 1, stamp: 0 });
    expect(voiceRotation(voice)).toBe(0);
  });

  test('stamp trigger=2 returns 15', () => {
    const voice = makeVoice({ waveform: 'stamp', trigger: 2, stamp: 0 });
    expect(voiceRotation(voice)).toBe(15);
  });

  test('drag tilt override takes precedence', () => {
    const voice = makeVoice({ waveform: 'stamp', trigger: 1, stamp: 0 });
    setDragTilt('test1', 8.5);
    expect(voiceRotation(voice)).toBe(8.5);
    clearDragTilt('test1');
    expect(voiceRotation(voice)).toBe(0);
  });
});

describe('snapTriggerTilt', () => {
  test('at stop center returns exact stop and correct trigger', () => {
    expect(snapTriggerTilt(-15)).toEqual({ tilt: -15, trigger: 0 });
    expect(snapTriggerTilt(0)).toEqual({ tilt: 0, trigger: 1 });
    expect(snapTriggerTilt(15)).toEqual({ tilt: 15, trigger: 2 });
  });

  test('small offset from center snaps close (quintic compression)', () => {
    const result = snapTriggerTilt(2);
    expect(result.trigger).toBe(1);
    expect(Math.abs(result.tilt)).toBeLessThan(0.1);
  });

  test('large offset still returns correct trigger', () => {
    const result = snapTriggerTilt(6);
    expect(result.trigger).toBe(1);
    expect(result.tilt).toBeGreaterThan(0);
    expect(result.tilt).toBeLessThan(6);
  });

  test('beyond half-zone snaps to adjacent trigger', () => {
    const result = snapTriggerTilt(8);
    expect(result.trigger).toBe(2);
  });

  test('values beyond ±15 clamp to outer stops', () => {
    const far = snapTriggerTilt(25);
    expect(far.trigger).toBe(2);
    expect(far.tilt).toBe(15);

    const farNeg = snapTriggerTilt(-25);
    expect(farNeg.trigger).toBe(0);
    expect(farNeg.tilt).toBe(-15);
  });
});

describe('hardSnapTrigger', () => {
  test('snaps to nearest trigger', () => {
    expect(hardSnapTrigger(-20)).toBe(0);
    expect(hardSnapTrigger(-8)).toBe(0);
    expect(hardSnapTrigger(-7)).toBe(1);
    expect(hardSnapTrigger(0)).toBe(1);
    expect(hardSnapTrigger(7)).toBe(1);
    expect(hardSnapTrigger(8)).toBe(2);
    expect(hardSnapTrigger(20)).toBe(2);
  });
});

describe('drag tilt override', () => {
  test('get returns undefined when not set', () => {
    expect(getDragTilt('nonexistent')).toBeUndefined();
  });

  test('set and get round-trip', () => {
    setDragTilt('v1', 12.5);
    expect(getDragTilt('v1')).toBe(12.5);
    clearDragTilt('v1');
    expect(getDragTilt('v1')).toBeUndefined();
  });
});
