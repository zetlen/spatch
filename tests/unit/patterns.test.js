import { describe, expect, test } from 'bun:test';
import { getPatternFill, getPatternPreviewCSS } from '../../js/patterns.ts';
import { PATTERN_TYPES } from '../../js/types.ts';

describe('getPatternFill', () => {
  test('every pattern type returns a fill URL', () => {
    for (const p of PATTERN_TYPES) {
      expect(getPatternFill(p)).toBe(`url(#pat-${p})`);
    }
  });
});

describe('getPatternPreviewCSS', () => {
  test('every pattern returns a non-empty data URI', () => {
    for (const p of PATTERN_TYPES) {
      const css = getPatternPreviewCSS(p);
      expect(css).toContain('data:image/svg+xml');
    }
  });
});

describe('PATTERN_TYPES', () => {
  test('has exactly 7 entries (3-bit serialization budget)', () => {
    expect(PATTERN_TYPES).toHaveLength(7);
  });
});
