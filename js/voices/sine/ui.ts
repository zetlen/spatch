// sine/ui.ts — SVG rendering and selection handles for sine (circle) voices.

import { resizeHandleEl, setAttrs, svgEl } from '../../dom.ts';
import type { Voice } from '../../types.ts';
import type { VoiceUI } from '../types.ts';

function circleAttrs(voice: Voice): Record<string, string> {
  const r = voice.size / 2;
  return { cx: String(voice.x), cy: String(voice.y), r: String(r) };
}

const ui: VoiceUI = {
  svgTag: 'circle',
  shapeName: 'circle',

  createSvgElement(voice: Voice): SVGElement {
    const el = svgEl('circle');
    setAttrs(el, circleAttrs(voice));
    return el;
  },

  updateSvgElement(el: SVGElement, voice: Voice): void {
    setAttrs(el, circleAttrs(voice));
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
