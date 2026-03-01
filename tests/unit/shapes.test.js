import { describe, test, expect } from 'bun:test';
import {
  hitTestShapes,
  hitTestHandles,
  hitTestADSRCorner,
  calcResize,
  calcRotation,
} from '../../js/shapes.ts';

const CANVAS_SIZE = 800;

function makeShape(overrides = {}) {
  return {
    id: 'test1',
    type: 'circle',
    x: 0.5,
    y: 0.5,
    size: 0.12,
    rotation: 0,
    fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    pattern: null,
    ...overrides,
  };
}

describe('hitTestShapes', () => {
  test('returns shape id when clicking inside a circle', () => {
    const state = { shapes: [makeShape({ id: 'c1', type: 'circle', x: 0.5, y: 0.5, size: 0.12 })] };
    // Center of shape at (400, 400), radius = 0.06 * 800 = 48px
    const result = hitTestShapes(state, 400, 400, CANVAS_SIZE);
    expect(result).toBe('c1');
  });

  test('returns null when clicking outside all shapes', () => {
    const state = { shapes: [makeShape({ id: 'c1', x: 0.5, y: 0.5, size: 0.12 })] };
    // Click far from shape
    const result = hitTestShapes(state, 10, 10, CANVAS_SIZE);
    expect(result).toBeNull();
  });

  test('returns topmost (last) shape when overlapping', () => {
    const state = {
      shapes: [
        makeShape({ id: 'bottom', x: 0.5, y: 0.5, size: 0.2 }),
        makeShape({ id: 'top', x: 0.5, y: 0.5, size: 0.2 }),
      ],
    };
    const result = hitTestShapes(state, 400, 400, CANVAS_SIZE);
    expect(result).toBe('top');
  });

  test('hits a square shape', () => {
    const state = { shapes: [makeShape({ id: 'sq1', type: 'square', x: 0.5, y: 0.5, size: 0.2 })] };
    const result = hitTestShapes(state, 400, 400, CANVAS_SIZE);
    expect(result).toBe('sq1');
  });

  test('hits a triangle shape at center', () => {
    const state = {
      shapes: [makeShape({ id: 'tri1', type: 'triangle', x: 0.5, y: 0.5, size: 0.3 })],
    };
    const result = hitTestShapes(state, 400, 400, CANVAS_SIZE);
    expect(result).toBe('tri1');
  });

  test('returns null for empty state', () => {
    const result = hitTestShapes({ shapes: [] }, 400, 400, CANVAS_SIZE);
    expect(result).toBeNull();
  });
});

describe('hitTestHandles', () => {
  test('returns null when no shape provided', () => {
    expect(hitTestHandles(null, 400, 400, CANVAS_SIZE)).toBeNull();
  });

  test('detects rotation handle above shape', () => {
    const shape = makeShape({ x: 0.5, y: 0.5, size: 0.12, type: 'square' });
    // Rotation handle is at (cx, cy - r - 25) = (400, 400 - 48 - 25) = (400, 327)
    const result = hitTestHandles(shape, 400, 327, CANVAS_SIZE);
    expect(result).toBe('rotate');
  });

  test('detects corner resize handles', () => {
    const shape = makeShape({ x: 0.5, y: 0.5, size: 0.12 });
    const r = (0.12 / 2) * CANVAS_SIZE; // 48
    const cx = 0.5 * CANVAS_SIZE; // 400
    const cy = 0.5 * CANVAS_SIZE; // 400

    // SE corner: (cx + r, cy + r) = (448, 448)
    expect(hitTestHandles(shape, cx + r, cy + r, CANVAS_SIZE)).toBe('se');
    // NW corner: (cx - r, cy - r) = (352, 352)
    expect(hitTestHandles(shape, cx - r, cy - r, CANVAS_SIZE)).toBe('nw');
  });

  test('detects midpoint handles', () => {
    const shape = makeShape({ x: 0.5, y: 0.5, size: 0.12 });
    // East midpoint: (448, 400)
    expect(hitTestHandles(shape, 448, 400, CANVAS_SIZE)).toBe('e');
  });

  test('returns null when not near any handle', () => {
    const shape = makeShape({ x: 0.5, y: 0.5, size: 0.12 });
    // Click at center of shape (not on any handle)
    expect(hitTestHandles(shape, 400, 400, CANVAS_SIZE)).toBeNull();
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
  const shape = makeShape({ size: 0.12 });

  test('SE handle increases size with positive drag', () => {
    const newSize = calcResize(shape, 'se', 20, 20, CANVAS_SIZE);
    expect(newSize).toBeGreaterThan(shape.size);
  });

  test('NW handle increases size with negative drag', () => {
    const newSize = calcResize(shape, 'nw', -20, -20, CANVAS_SIZE);
    expect(newSize).toBeGreaterThan(shape.size);
  });

  test('E handle responds to horizontal drag only', () => {
    const bigger = calcResize(shape, 'e', 20, 0, CANVAS_SIZE);
    const same = calcResize(shape, 'e', 0, 20, CANVAS_SIZE);
    expect(bigger).toBeGreaterThan(shape.size);
    // Vertical drag should not change size for 'e' handle
    expect(same).toBeCloseTo(shape.size, 2);
  });

  test('clamps to minimum size', () => {
    const tiny = calcResize(shape, 'se', -1000, -1000, CANVAS_SIZE);
    expect(tiny).toBeGreaterThan(0);
    expect(tiny).toBeCloseTo((10 * 2) / CANVAS_SIZE, 5); // min radius 10 → size 20/800
  });

  test('clamps to maximum size', () => {
    const huge = calcResize(shape, 'se', 10000, 10000, CANVAS_SIZE);
    expect(huge).toBeLessThanOrEqual(0.9); // max radius 0.45*800 → size 0.9
  });
});

describe('calcRotation', () => {
  test('mouse directly above shape returns ~0 degrees', () => {
    const shape = makeShape({ x: 0.5, y: 0.5 });
    // Directly above: mx=400, my=300
    const deg = calcRotation(shape, 400, 300, CANVAS_SIZE);
    expect(deg).toBeCloseTo(0, 0);
  });

  test('mouse to the right returns ~90 degrees', () => {
    const shape = makeShape({ x: 0.5, y: 0.5 });
    const deg = calcRotation(shape, 500, 400, CANVAS_SIZE);
    expect(deg).toBeCloseTo(90, 0);
  });

  test('mouse below returns ~180 degrees', () => {
    const shape = makeShape({ x: 0.5, y: 0.5 });
    const deg = calcRotation(shape, 400, 500, CANVAS_SIZE);
    expect(deg).toBeCloseTo(180, 0);
  });

  test('mouse to the left returns ~270 degrees', () => {
    const shape = makeShape({ x: 0.5, y: 0.5 });
    const deg = calcRotation(shape, 300, 400, CANVAS_SIZE);
    expect(deg).toBeCloseTo(270, 0);
  });
});
