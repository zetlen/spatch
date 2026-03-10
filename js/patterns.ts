// Patterns.ts — SVG pattern definitions for visual overlays

import { svgEl } from './dom.ts';
import type { PatternType } from './types.ts';

/** Ensure all pattern definitions exist in the given <defs> element. */
export function ensurePatternDefs(defs: SVGDefsElement): void {
  if (defs.querySelector('#pat-stripes')) {
    return;
  } // Already defined

  // Stripes: repeating horizontal band
  const stripes = createPattern('pat-stripes', 0.0075, 0.0075);
  stripes.append(svgEl('rect', { width: 0.0075, height: 0.00375, fill: 'rgba(0,0,0,0.45)' }));
  defs.append(stripes);

  // Checker: 2x2 alternating squares
  const checker = createPattern('pat-checker', 0.01, 0.01);
  checker.append(
    svgEl('rect', { width: 0.005, height: 0.005, fill: 'rgba(0,0,0,0.35)' }),
    svgEl('rect', { x: 0.005, y: 0.005, width: 0.005, height: 0.005, fill: 'rgba(0,0,0,0.35)' }),
  );
  defs.append(checker);

  // Plaid: cross-hatched horizontal + vertical stripes
  const plaid = createPattern('pat-plaid', 0.01, 0.01);
  plaid.append(
    svgEl('rect', { width: 0.01, height: 0.003, fill: 'rgba(0,0,0,0.3)' }),
    svgEl('rect', { width: 0.003, height: 0.01, fill: 'rgba(0,0,0,0.3)' }),
  );
  defs.append(plaid);

  // Noise: feTurbulence filter
  const noiseFilter = svgEl(
    'filter',
    { id: 'pat-noise', x: 0, y: 0, width: '100%', height: '100%' },
    svgEl('feTurbulence', {
      type: 'fractalNoise',
      baseFrequency: 0.9,
      numOctaves: 4,
      seed: 1,
      result: 'noise',
    }),
    svgEl('feColorMatrix', {
      in: 'noise',
      type: 'matrix',
      // Convert noise to black with variable alpha
      values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.3 0',
      result: 'darkNoise',
    }),
    svgEl('feComposite', {
      in: 'darkNoise',
      in2: 'SourceGraphic',
      operator: 'atop',
    }),
  );
  defs.append(noiseFilter);
}

function createPattern(id: string, width: number, height: number): SVGPatternElement {
  return svgEl('pattern', {
    id,
    patternUnits: 'userSpaceOnUse',
    width,
    height,
  });
}

/**
 * Get the SVG attribute for applying a pattern to a shape.
 * Returns { attr, value } where attr is 'fill' or 'filter' depending on type.
 */
export function getPatternOverlay(pattern: PatternType): { attr: string; value: string } {
  switch (pattern) {
    case 'stripes': {
      return { attr: 'fill', value: 'url(#pat-stripes)' };
    }
    case 'checker': {
      return { attr: 'fill', value: 'url(#pat-checker)' };
    }
    case 'noise': {
      return { attr: 'filter', value: 'url(#pat-noise)' };
    }
    case 'plaid': {
      return { attr: 'fill', value: 'url(#pat-plaid)' };
    }
  }
}
