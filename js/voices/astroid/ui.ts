// Astroid/ui.ts — SVG rendering and selection handles for astroid voices.

import { resizeHandleEl, svgEl } from '../../dom.ts';
import type { Voice } from '../../types.ts';
import type { VoiceUI } from '../types.ts';

// Bezier control-point ratio. 0.4 gives sharper points than the true astroid
// (kappa ~ 0.61) — more like a recognisable 4-pointed star.
const KAPPA = 0.4;

function astroidPath(voice: Voice): string {
  const cx = voice.x as number;
  const cy = voice.y as number;
  const r = (voice.size as number) / 2;
  const k = r * KAPPA;
  return [
    `M ${cx + r},${cy}`,
    `C ${cx + k},${cy} ${cx},${cy - k} ${cx},${cy - r}`,
    `C ${cx},${cy - k} ${cx - k},${cy} ${cx - r},${cy}`,
    `C ${cx - k},${cy} ${cx},${cy + k} ${cx},${cy + r}`,
    `C ${cx},${cy + k} ${cx + k},${cy} ${cx + r},${cy}`,
    'Z',
  ].join(' ');
}

const ui: VoiceUI = {
  svgTag: 'path',
  shapeName: 'astroid',

  createSvgElement(voice: Voice): SVGElement {
    const el = svgEl('path');
    el.setAttribute('d', astroidPath(voice));
    return el;
  },

  updateSvgElement(el: SVGElement, voice: Voice): void {
    el.setAttribute('d', astroidPath(voice));
  },

  selectionHandles(voice: Voice): SVGElement[] {
    const r = voice.size / 2;
    return [
      resizeHandleEl('e', voice.x + r, voice.y),
      resizeHandleEl('n', voice.x, voice.y - r),
      resizeHandleEl('w', voice.x - r, voice.y),
      resizeHandleEl('s', voice.x, voice.y + r),
    ];
  },
};

export default ui;
