// border-panel.ts — Border expansion panel

import type { BorderColor } from '../types.ts';
import { normalizedCoord } from '../types.ts';
import {
  createExpansionPanel,
  getSelectedVoice,
  type ExpansionPanel,
  type PanelDeps,
} from './expansion-panel.ts';
import { svgEl } from './dom-helpers.ts';

// ---- SVG builders ----

function buildColorButton(color: BorderColor, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'border-color-btn';
  btn.title = title;

  if (color === 'white') {
    btn.append(
      svgEl(
        'svg',
        { height: 20, viewBox: '0 0 20 20', width: 20 },
        svgEl('line', {
          stroke: '#999',
          'stroke-linecap': 'round',
          'stroke-width': 5,
          x1: 4,
          x2: 16,
          y1: 10,
          y2: 10,
        }),
        svgEl('line', {
          stroke: 'white',
          'stroke-linecap': 'round',
          'stroke-width': 3,
          x1: 4,
          x2: 16,
          y1: 10,
          y2: 10,
        }),
      ),
    );
  } else {
    btn.append(
      svgEl(
        'svg',
        { height: 20, viewBox: '0 0 20 20', width: 20 },
        svgEl('line', {
          stroke: 'currentColor',
          'stroke-linecap': 'round',
          'stroke-width': 3,
          x1: 4,
          x2: 16,
          y1: 10,
          y2: 10,
        }),
      ),
    );
  }

  return btn;
}

function buildStyleButton(isDouble: boolean, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'border-style-btn';
  btn.title = title;

  if (isDouble) {
    btn.append(
      svgEl(
        'svg',
        { height: 20, viewBox: '0 0 20 20', width: 20 },
        svgEl('rect', {
          fill: 'none',
          height: 14,
          stroke: 'currentColor',
          'stroke-width': 1.5,
          width: 14,
          x: 3,
          y: 3,
        }),
        svgEl('rect', {
          fill: 'none',
          height: 8,
          stroke: 'currentColor',
          'stroke-width': 1.5,
          width: 8,
          x: 6,
          y: 6,
        }),
      ),
    );
  } else {
    btn.append(
      svgEl(
        'svg',
        { height: 20, viewBox: '0 0 20 20', width: 20 },
        svgEl('rect', {
          fill: 'none',
          height: 12,
          stroke: 'currentColor',
          'stroke-width': 2,
          width: 12,
          x: 4,
          y: 4,
        }),
      ),
    );
  }

  return btn;
}

// ---- Factory ----

export function createBorderPanel(
  deps: PanelDeps,
  triggerBtn: HTMLElement,
): ExpansionPanel & { updateButton(): void } {
  const { store, undo } = deps;

  function updateButton(): void {
    triggerBtn.classList.toggle('has-border', getSelectedVoice(deps)?.border != undefined);
  }

  const panel = createExpansionPanel({
    area: deps.area,
    entries: () => [
      { type: 'item', key: 'color:white', create: () => buildColorButton('white', 'Octave up') },
      { type: 'item', key: 'color:black', create: () => buildColorButton('black', 'Octave down') },
      { type: 'separator', className: 'border-extra' },
      {
        type: 'item',
        key: 'style:single',
        className: 'border-extra',
        create: () => buildStyleButton(false, 'Single'),
      },
      {
        type: 'item',
        key: 'style:double',
        className: 'border-extra',
        create: () => buildStyleButton(true, 'Double'),
      },
      { type: 'separator', className: 'border-extra' },
      {
        type: 'item',
        className: 'border-extra',
        create() {
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.id = 'border-thickness';
          slider.className = 'expansion-slider';
          slider.min = '1';
          slider.max = '100';
          slider.value = '1';
          slider.title = 'Thickness';
          slider.addEventListener('input', () => {
            const sel = getSelectedVoice(deps);
            if (!sel?.border) return;
            store.updateVoice(sel.id, {
              border: { ...sel.border, thickness: normalizedCoord(parseInt(slider.value) / 100) },
            });
          });
          slider.addEventListener('pointerdown', () => undo.snapshot());
          return slider;
        },
      },
    ],
    isActive(key) {
      const border = getSelectedVoice(deps)?.border;
      if (!border) return false;
      if (key === 'color:white' || key === 'color:black') return border.color === key.slice(6);
      if (key === 'style:single') return !border.double;
      if (key === 'style:double') return border.double;
      return false;
    },
    onClick(key) {
      const sel = getSelectedVoice(deps);
      if (!sel) return;
      undo.snapshot();
      if (key === 'color:white' || key === 'color:black') {
        const color = key.slice(6) as BorderColor;
        if (sel.border?.color === color) {
          store.updateVoice(sel.id, { border: undefined });
        } else if (sel.border) {
          store.updateVoice(sel.id, { border: { ...sel.border, color } });
        } else {
          store.updateVoice(sel.id, {
            border: { color, double: false, thickness: normalizedCoord(0.01) },
          });
        }
      } else if (key === 'style:single' || key === 'style:double') {
        if (!sel.border) return;
        store.updateVoice(sel.id, {
          border: { ...sel.border, double: key === 'style:double' },
        });
      }
    },
    onUpdate(area) {
      const border = getSelectedVoice(deps)?.border;
      area.querySelectorAll<HTMLElement>('.border-extra').forEach((el) => {
        el.classList.toggle('hidden', border == undefined);
      });
      const slider = area.querySelector<HTMLInputElement>('#border-thickness');
      if (slider) {
        slider.value = border ? String(Math.round(border.thickness * 100)) : '1';
      }
      triggerBtn.classList.toggle('has-border', border != undefined);
    },
  });

  return { ...panel, updateButton };
}
