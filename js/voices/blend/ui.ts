// blend/ui.ts — SVG rendering and selection handles for blend (triangle) voices.

import { resizeHandleEl, rotationHandleEls, svgEl } from '../../dom.ts';
import type { Voice } from '../../types.ts';
import type { VoiceUI } from '../types.ts';

function trianglePoints(voice: Voice): string {
  const r = voice.size / 2;
  const pts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
    const px = voice.x + Math.cos(angle) * r;
    const py = voice.y + Math.sin(angle) * r;
    pts.push(`${px},${py}`);
  }
  return pts.join(' ');
}

const ui: VoiceUI = {
  svgTag: 'polygon',
  shapeName: 'triangle',

  createSvgElement(voice: Voice): SVGElement {
    const el = svgEl('polygon');
    el.setAttribute('points', trianglePoints(voice));
    return el;
  },

  updateSvgElement(el: SVGElement, voice: Voice): void {
    el.setAttribute('points', trianglePoints(voice));
  },

  selectionHandles(voice: Voice): SVGElement[] {
    const r = voice.size / 2;
    const handles: SVGElement[] = [];
    const handleTypes = ['n', 'se', 'sw'] as [string, string, string];
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
      const px = voice.x + Math.cos(angle) * r;
      const py = voice.y + Math.sin(angle) * r;
      handles.push(resizeHandleEl(handleTypes[i]!, px, py));
    }
    handles.push(...rotationHandleEls(voice.x, voice.y - r));
    return handles;
  },
};

export default ui;
