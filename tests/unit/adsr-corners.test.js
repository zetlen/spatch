import { describe, expect, test } from 'bun:test';
import { hitTestADSRCorner } from '../../js/shapes.ts';
import { dragToEnvelopeValue, envelopeToCornerRadii } from '../../js/envelope.ts';

const CANVAS_SIZE = 800;
const MAX_RADIUS = CANVAS_SIZE * 0.15; // 120px
const defaultEnvelope = { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 };

describe('ADSR corner hit testing', () => {
  test('attack corner (bottom-left) is hit near (0, 800)', () => {
    const result = hitTestADSRCorner(defaultEnvelope, 10, CANVAS_SIZE - 10, CANVAS_SIZE);
    expect(result).toBe('attack');
  });

  test('decay corner (top-left) is hit near (0, 0)', () => {
    const result = hitTestADSRCorner(defaultEnvelope, 10, 10, CANVAS_SIZE);
    expect(result).toBe('decay');
  });

  test('sustain corner (top-right) is hit near (800, 0)', () => {
    const result = hitTestADSRCorner(defaultEnvelope, CANVAS_SIZE - 10, 10, CANVAS_SIZE);
    expect(result).toBe('sustain');
  });

  test('release corner (bottom-right) is hit near (800, 800)', () => {
    const result = hitTestADSRCorner(
      defaultEnvelope,
      CANVAS_SIZE - 10,
      CANVAS_SIZE - 10,
      CANVAS_SIZE,
    );
    expect(result).toBe('release');
  });

  test('center of canvas hits no corner', () => {
    const result = hitTestADSRCorner(defaultEnvelope, 400, 400, CANVAS_SIZE);
    expect(result).toBeUndefined();
  });

  test('hit radius is proportional to canvas size (64px at 800px canvas)', () => {
    // Just inside hit radius: distance = 63 < 64
    const insideResult = hitTestADSRCorner(defaultEnvelope, 63, CANVAS_SIZE, CANVAS_SIZE);
    expect(insideResult).toBe('attack');

    // Just outside hit radius: distance = 65 > 64
    const outsideResult = hitTestADSRCorner(defaultEnvelope, 65, CANVAS_SIZE, CANVAS_SIZE);
    expect(outsideResult).toBeUndefined();

    // At half canvas size, hit radius should be 32px
    const halfCanvas = 400;
    const insideHalf = hitTestADSRCorner(defaultEnvelope, 31, halfCanvas, halfCanvas);
    expect(insideHalf).toBe('attack');

    const outsideHalf = hitTestADSRCorner(defaultEnvelope, 33, halfCanvas, halfCanvas);
    expect(outsideHalf).toBeUndefined();
  });
});

describe('ADSR drag to envelope value', () => {
  test('attack: small drag = small value', () => {
    const value = dragToEnvelopeValue('attack', 10, CANVAS_SIZE);
    expect(value).toBeGreaterThan(0.01);
    expect(value).toBeLessThan(0.5);
  });

  test('attack: large drag = clamped at max (2.0)', () => {
    const value = dragToEnvelopeValue('attack', MAX_RADIUS * 3, CANVAS_SIZE);
    expect(value).toBe(2);
  });

  test('attack: zero drag = minimum (0.01)', () => {
    const value = dragToEnvelopeValue('attack', 0, CANVAS_SIZE);
    expect(value).toBe(0.01);
  });

  test('sustain: clamped between 0 and 1', () => {
    const zero = dragToEnvelopeValue('sustain', 0, CANVAS_SIZE);
    expect(zero).toBe(0);

    const mid = dragToEnvelopeValue('sustain', MAX_RADIUS * 0.5, CANVAS_SIZE);
    expect(mid).toBeCloseTo(0.5);

    const maxed = dragToEnvelopeValue('sustain', MAX_RADIUS * 5, CANVAS_SIZE);
    expect(maxed).toBe(1);
  });

  test('release: max drag = 3.0', () => {
    const value = dragToEnvelopeValue('release', MAX_RADIUS, CANVAS_SIZE);
    expect(value).toBeCloseTo(3);

    const overMax = dragToEnvelopeValue('release', MAX_RADIUS * 10, CANVAS_SIZE);
    expect(overMax).toBe(3);
  });

  test('decay: matches attack scaling', () => {
    const distances = [10, 30, 60, MAX_RADIUS];
    for (const dist of distances) {
      const attackVal = dragToEnvelopeValue('attack', dist, CANVAS_SIZE);
      const decayVal = dragToEnvelopeValue('decay', dist, CANVAS_SIZE);
      expect(decayVal).toBeCloseTo(attackVal);
    }
  });
});

describe('ADSR corner radii', () => {
  test('default envelope produces non-zero radii', () => {
    const radii = envelopeToCornerRadii(defaultEnvelope, CANVAS_SIZE);
    expect(radii.bottomLeft).toBeGreaterThan(0);
    expect(radii.topLeft).toBeGreaterThan(0);
    expect(radii.topRight).toBeGreaterThan(0);
    expect(radii.bottomRight).toBeGreaterThan(0);
  });

  test('zero envelope produces zero radii', () => {
    const zeroEnvelope = { attack: 0, decay: 0, release: 0, sustain: 0 };
    const radii = envelopeToCornerRadii(zeroEnvelope, CANVAS_SIZE);
    expect(radii.bottomLeft).toBe(0);
    expect(radii.topLeft).toBe(0);
    expect(radii.topRight).toBe(0);
    expect(radii.bottomRight).toBe(0);
  });

  test('radii scale with canvas size', () => {
    const radii400 = envelopeToCornerRadii(defaultEnvelope, 400);
    const radii800 = envelopeToCornerRadii(defaultEnvelope, 800);

    expect(radii800.bottomLeft).toBeCloseTo(radii400.bottomLeft * 2);
    expect(radii800.topLeft).toBeCloseTo(radii400.topLeft * 2);
    expect(radii800.topRight).toBeCloseTo(radii400.topRight * 2);
    expect(radii800.bottomRight).toBeCloseTo(radii400.bottomRight * 2);
  });

  test('attack maps to bottomLeft', () => {
    const radii = envelopeToCornerRadii(defaultEnvelope, CANVAS_SIZE);
    const expectedAttackRadius = (defaultEnvelope.attack / 2) * MAX_RADIUS;
    expect(radii.bottomLeft).toBeCloseTo(expectedAttackRadius);
  });
});

describe('ADSR drag simulation (pointer event flow)', () => {
  test('dragging attack corner outward increases attack', () => {
    // Start: touch near attack corner (bottom-left)
    const startX = 5;
    const startY = CANVAS_SIZE - 5;

    // Verify we hit the attack corner
    const corner = hitTestADSRCorner(defaultEnvelope, startX, startY, CANVAS_SIZE);
    expect(corner).toBe('attack');

    // Simulate drag outward from corner — compute drag distance
    const dragEndX = 80;
    const dragEndY = CANVAS_SIZE - 80;
    const dragDistance = Math.hypot(Number(dragEndX), CANVAS_SIZE - dragEndY);

    // Get new envelope value from drag
    const newAttack = dragToEnvelopeValue('attack', dragDistance, CANVAS_SIZE);
    expect(newAttack).toBeGreaterThan(defaultEnvelope.attack);

    // Verify the radii update reflects increased attack
    const updatedEnvelope = { ...defaultEnvelope, attack: newAttack };
    const oldRadii = envelopeToCornerRadii(defaultEnvelope, CANVAS_SIZE);
    const newRadii = envelopeToCornerRadii(updatedEnvelope, CANVAS_SIZE);
    expect(newRadii.bottomLeft).toBeGreaterThan(oldRadii.bottomLeft);
  });

  test('dragging sustain corner outward increases sustain', () => {
    // Start: touch near sustain corner (top-right)
    const startX = CANVAS_SIZE - 5;
    const startY = 5;

    const corner = hitTestADSRCorner(defaultEnvelope, startX, startY, CANVAS_SIZE);
    expect(corner).toBe('sustain');

    // Drag inward from corner — distance from the corner position
    const dragEndX = CANVAS_SIZE - 90;
    const dragEndY = 90;
    const dragDistance = Math.hypot(CANVAS_SIZE - dragEndX, Number(dragEndY));

    const newSustain = dragToEnvelopeValue('sustain', dragDistance, CANVAS_SIZE);
    expect(newSustain).toBeGreaterThan(defaultEnvelope.sustain);

    const updatedEnvelope = { ...defaultEnvelope, sustain: newSustain };
    const oldRadii = envelopeToCornerRadii(defaultEnvelope, CANVAS_SIZE);
    const newRadii = envelopeToCornerRadii(updatedEnvelope, CANVAS_SIZE);
    expect(newRadii.topRight).toBeGreaterThan(oldRadii.topRight);
  });

  test('minimal drag keeps values near minimum', () => {
    // Tiny drag distance of 1 pixel from the attack corner
    const tinyDrag = 1;
    const attackValue = dragToEnvelopeValue('attack', tinyDrag, CANVAS_SIZE);
    // Should be very close to the minimum (0.01)
    expect(attackValue).toBeCloseTo(0.0167, 1); // (1/120)*2 = ~0.017
    expect(attackValue).toBeLessThan(0.1);

    const decayValue = dragToEnvelopeValue('decay', tinyDrag, CANVAS_SIZE);
    expect(decayValue).toBeLessThan(0.1);
  });

  test('touch coordinate scaling: pointer at canvas edge hits corner', () => {
    // Exact corner coordinates
    expect(hitTestADSRCorner(defaultEnvelope, 0, CANVAS_SIZE, CANVAS_SIZE)).toBe('attack');
    expect(hitTestADSRCorner(defaultEnvelope, 0, 0, CANVAS_SIZE)).toBe('decay');
    expect(hitTestADSRCorner(defaultEnvelope, CANVAS_SIZE, 0, CANVAS_SIZE)).toBe('sustain');
    expect(hitTestADSRCorner(defaultEnvelope, CANVAS_SIZE, CANVAS_SIZE, CANVAS_SIZE)).toBe(
      'release',
    );
  });

  test('touch near but not exactly on corner still hits (within 64px radius at 800px)', () => {
    // 45 degrees into canvas from attack corner (bottom-left),
    // Distance = 45 * sqrt(2) ~ 63.6 which is < 64
    const offset = 45;
    const attackHit = hitTestADSRCorner(defaultEnvelope, offset, CANVAS_SIZE - offset, CANVAS_SIZE);
    expect(attackHit).toBe('attack');

    // Same for decay corner (top-left)
    const decayHit = hitTestADSRCorner(defaultEnvelope, offset, offset, CANVAS_SIZE);
    expect(decayHit).toBe('decay');

    // Same for sustain corner (top-right)
    const sustainHit = hitTestADSRCorner(
      defaultEnvelope,
      CANVAS_SIZE - offset,
      offset,
      CANVAS_SIZE,
    );
    expect(sustainHit).toBe('sustain');

    // Same for release corner (bottom-right)
    const releaseHit = hitTestADSRCorner(
      defaultEnvelope,
      CANVAS_SIZE - offset,
      CANVAS_SIZE - offset,
      CANVAS_SIZE,
    );
    expect(releaseHit).toBe('release');
  });

  test('touch between two corners does not hit either (midpoint of top edge)', () => {
    // Midpoint of top edge: (400, 0) — equidistant from decay (0,0) and sustain (800,0)
    // Distance to either corner = 400, which is >> 64px hit radius
    const result = hitTestADSRCorner(defaultEnvelope, 400, 0, CANVAS_SIZE);
    expect(result).toBeUndefined();

    // Midpoint of left edge: (0, 400) — equidistant from decay (0,0) and attack (0,800)
    const leftMid = hitTestADSRCorner(defaultEnvelope, 0, 400, CANVAS_SIZE);
    expect(leftMid).toBeUndefined();

    // Midpoint of bottom edge: (400, 800)
    const bottomMid = hitTestADSRCorner(defaultEnvelope, 400, CANVAS_SIZE, CANVAS_SIZE);
    expect(bottomMid).toBeUndefined();

    // Midpoint of right edge: (800, 400)
    const rightMid = hitTestADSRCorner(defaultEnvelope, CANVAS_SIZE, 400, CANVAS_SIZE);
    expect(rightMid).toBeUndefined();
  });
});
