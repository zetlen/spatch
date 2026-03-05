// Patterns.ts — SVG pattern definitions for visual overlays

import type { PatternType } from './types.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Ensure all pattern definitions exist in the given <defs> element. */
export function ensurePatternDefs(defs: SVGDefsElement): void {
  if (defs.querySelector('#pat-stripes')) {
    return;
  } // Already defined

  // Stripes: repeating horizontal band
  const stripes = createPattern('pat-stripes', 0.0075, 0.0075);
  const stripesRect = document.createElementNS(SVG_NS, 'rect');
  stripesRect.setAttribute('width', '0.0075');
  stripesRect.setAttribute('height', '0.00375');
  stripesRect.setAttribute('fill', 'rgba(0,0,0,0.45)');
  stripes.append(stripesRect);
  defs.append(stripes);

  // Checker: 2x2 alternating squares
  const checker = createPattern('pat-checker', 0.01, 0.01);
  const cRect1 = document.createElementNS(SVG_NS, 'rect');
  cRect1.setAttribute('width', '0.005');
  cRect1.setAttribute('height', '0.005');
  cRect1.setAttribute('fill', 'rgba(0,0,0,0.35)');
  checker.append(cRect1);
  const cRect2 = document.createElementNS(SVG_NS, 'rect');
  cRect2.setAttribute('x', '0.005');
  cRect2.setAttribute('y', '0.005');
  cRect2.setAttribute('width', '0.005');
  cRect2.setAttribute('height', '0.005');
  cRect2.setAttribute('fill', 'rgba(0,0,0,0.35)');
  checker.append(cRect2);
  defs.append(checker);

  // Noise: feTurbulence filter
  const noiseFilter = document.createElementNS(SVG_NS, 'filter');
  noiseFilter.id = 'pat-noise';
  noiseFilter.setAttribute('x', '0');
  noiseFilter.setAttribute('y', '0');
  noiseFilter.setAttribute('width', '100%');
  noiseFilter.setAttribute('height', '100%');
  const turb = document.createElementNS(SVG_NS, 'feTurbulence');
  turb.setAttribute('type', 'fractalNoise');
  turb.setAttribute('baseFrequency', '0.9');
  turb.setAttribute('numOctaves', '4');
  turb.setAttribute('seed', '1');
  turb.setAttribute('result', 'noise');
  noiseFilter.append(turb);
  const colorMatrix = document.createElementNS(SVG_NS, 'feColorMatrix');
  colorMatrix.setAttribute('in', 'noise');
  colorMatrix.setAttribute('type', 'matrix');
  // Convert noise to black with variable alpha
  colorMatrix.setAttribute('values', '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.3 0');
  colorMatrix.setAttribute('result', 'darkNoise');
  noiseFilter.append(colorMatrix);
  const composite = document.createElementNS(SVG_NS, 'feComposite');
  composite.setAttribute('in', 'darkNoise');
  composite.setAttribute('in2', 'SourceGraphic');
  composite.setAttribute('operator', 'atop');
  noiseFilter.append(composite);
  defs.append(noiseFilter);
}

function createPattern(id: string, width: number, height: number): SVGPatternElement {
  const pat = document.createElementNS(SVG_NS, 'pattern');
  pat.id = id;
  pat.setAttribute('patternUnits', 'userSpaceOnUse');
  pat.setAttribute('width', String(width));
  pat.setAttribute('height', String(height));
  return pat;
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
    case 'gradient': {
      // Gradient overlay is handled per-voice with a dedicated gradient def
      return { attr: 'fill', value: '' };
    }
  }
}
