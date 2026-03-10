import { describe, expect, test } from 'bun:test';
import { getPatternOverlay } from '../../js/patterns.ts';

describe('getPatternOverlay', () => {
  test('stripes returns fill with url(#pat-stripes)', () => {
    const result = getPatternOverlay('stripes');
    expect(result.attr).toBe('fill');
    expect(result.value).toBe('url(#pat-stripes)');
  });

  test('checker returns fill with url(#pat-checker)', () => {
    const result = getPatternOverlay('checker');
    expect(result.attr).toBe('fill');
    expect(result.value).toBe('url(#pat-checker)');
  });

  test('noise returns filter with url(#pat-noise)', () => {
    const result = getPatternOverlay('noise');
    expect(result.attr).toBe('filter');
    expect(result.value).toBe('url(#pat-noise)');
  });

  test('plaid returns fill with pattern URL', () => {
    const result = getPatternOverlay('plaid');
    expect(result.attr).toBe('fill');
    expect(result.value).toBe('url(#pat-plaid)');
  });
});
