import { describe, test, expect } from 'bun:test';
import {
  hitTestShapes,
  hitTestHandles,
  hitTestADSRCorner,
  calcResize,
  calcRotation,
} from '../../js/shapes.ts';

const CANVAS_SIZE = 800;

function makeVoice(overrides = {}) {
  return {
    id: 'test1',
    waveform: 'sine',
    x: 0.5,
    y: 0.5,
    size: 0.12,
    fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    effect: null,
    ...overrides,
  };
}

describe('hitTestShapes', () => {
  test('returns shape id when clicking inside a circle', () => {
    const state = {
      voices: [makeVoice({ id: 'c1', waveform: 'sine', x: 0.5, y: 0.5, size: 0.12 })],
      texts: [],
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    };
    // Center of shape at (400, 400), radius = 0.06 * 800 = 48px
    const result = hitTestShapes(state, 400, 400, CANVAS_SIZE);
    expect(result).toBe('c1');
  });

  test('returns null when clicking outside all shapes', () => {
    const state = {
      voices: [makeVoice({ id: 'c1', x: 0.5, y: 0.5, size: 0.12 })],
      texts: [],
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    };
    // Click far from shape
    const result = hitTestShapes(state, 10, 10, CANVAS_SIZE);
    expect(result).toBeNull();
  });

  test('returns topmost (last) shape when overlapping', () => {
    const state = {
      voices: [
        makeVoice({ id: 'bottom', x: 0.5, y: 0.5, size: 0.2 }),
        makeVoice({ id: 'top', x: 0.5, y: 0.5, size: 0.2 }),
      ],
      texts: [],
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    };
    const result = hitTestShapes(state, 400, 400, CANVAS_SIZE);
    expect(result).toBe('top');
  });

  test('hits a square shape', () => {
    const state = {
      voices: [makeVoice({ id: 'sq1', waveform: 'pulse', x: 0.5, y: 0.5, size: 0.2, timbre: 0 })],
      texts: [],
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    };
    const result = hitTestShapes(state, 400, 400, CANVAS_SIZE);
    expect(result).toBe('sq1');
  });

  test('hits a triangle shape at center', () => {
    const state = {
      voices: [makeVoice({ id: 'tri1', waveform: 'blend', x: 0.5, y: 0.5, size: 0.3, timbre: 0 })],
      texts: [],
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 },
    };
    const result = hitTestShapes(state, 400, 400, CANVAS_SIZE);
    expect(result).toBe('tri1');
  });

  test('returns null for empty state', () => {
    const result = hitTestShapes(
      { voices: [], texts: [], envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 } },
      400,
      400,
      CANVAS_SIZE,
    );
    expect(result).toBeNull();
  });
});

describe('hitTestHandles', () => {
  test('returns null when no shape provided', () => {
    expect(hitTestHandles(null, 400, 400, CANVAS_SIZE)).toBeNull();
  });

  test('detects rotation handle above shape', () => {
    const voice = makeVoice({ x: 0.5, y: 0.5, size: 0.12, waveform: 'pulse', timbre: 0 });
    // Rotation handle is at (cx, cy - r - 25) = (400, 400 - 48 - 25) = (400, 327)
    const result = hitTestHandles(voice, 400, 327, CANVAS_SIZE);
    expect(result).toBe('rotate');
  });

  test('detects corner resize handles', () => {
    const voice = makeVoice({ x: 0.5, y: 0.5, size: 0.12 });
    const r = (0.12 / 2) * CANVAS_SIZE; // 48
    const cx = 0.5 * CANVAS_SIZE; // 400
    const cy = 0.5 * CANVAS_SIZE; // 400

    // SE corner: (cx + r, cy + r) = (448, 448)
    expect(hitTestHandles(voice, cx + r, cy + r, CANVAS_SIZE)).toBe('se');
    // NW corner: (cx - r, cy - r) = (352, 352)
    expect(hitTestHandles(voice, cx - r, cy - r, CANVAS_SIZE)).toBe('nw');
  });

  test('detects midpoint handles', () => {
    const voice = makeVoice({ x: 0.5, y: 0.5, size: 0.12 });
    // East midpoint: (448, 400)
    expect(hitTestHandles(voice, 448, 400, CANVAS_SIZE)).toBe('e');
  });

  test('returns null when not near any handle', () => {
    const voice = makeVoice({ x: 0.5, y: 0.5, size: 0.12 });
    // Click at center of shape (not on any handle)
    expect(hitTestHandles(voice, 400, 400, CANVAS_SIZE)).toBeNull();
  });
});

describe('hitTestADSRCorner', () => {
  const envelope = { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.4 };

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
    expect(result).toBeNull();
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
    expect(tiny).toBeCloseTo((10 * 2) / CANVAS_SIZE, 5); // min radius 10 → size 20/800
  });

  test('clamps to maximum size', () => {
    const huge = calcResize(voice, 'se', 10000, 10000, CANVAS_SIZE);
    expect(huge).toBeLessThanOrEqual(0.9); // max radius 0.45*800 → size 0.9
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
