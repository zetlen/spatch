// Pulse/ui.ts — SVG rendering and selection handles for pulse (square) voices.

import { resizeHandleEl, setAttrs, svgEl } from '../../dom.ts';
import type { Voice } from '../../types.ts';
import type { VoiceUI } from '../types.ts';

function rectAttrs(voice: Voice): Record<string, string> {
  const r = voice.size / 2;
  return {
    height: String(voice.size),
    width: String(voice.size),
    x: String(voice.x - r),
    y: String(voice.y - r),
  };
}

const ui: VoiceUI = {
  svgTag: 'rect',
  shapeName: 'square',

  createSvgElement(voice: Voice): SVGElement {
    const el = svgEl('rect');
    setAttrs(el, rectAttrs(voice));
    return el;
  },

  updateSvgElement(el: SVGElement, voice: Voice): void {
    setAttrs(el, rectAttrs(voice));
  },

  selectionHandles(voice: Voice): SVGElement[] {
    const r = voice.size / 2;
    return [
      resizeHandleEl('nw', voice.x - r, voice.y - r),
      resizeHandleEl('ne', voice.x + r, voice.y - r),
      resizeHandleEl('se', voice.x + r, voice.y + r),
      resizeHandleEl('sw', voice.x - r, voice.y + r),
    ];
  },
};

export default ui;
