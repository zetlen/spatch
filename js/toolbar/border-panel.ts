// border-panel.ts — Border expansion panel for the bottom toolbar
//
// Extracts the border color, style (single/double), and thickness
// controls from Toolbar into a standalone panel conforming to the
// ExpansionPanel interface, plus an updateButton() method.

import type { SigilStore, UndoManager } from '../state.ts';
import type { BorderColor, Voice } from '../types.ts';
import { normalizedCoord } from '../types.ts';
import type { ExpansionPanel } from './blend-panel.ts';
import { htmlEl, svgEl } from './dom-helpers.ts';

// ---- Shared panel context ----

interface BorderPanelCtx {
  area: HTMLElement;
  store: SigilStore;
  undo: UndoManager;
  getSelected(): Voice | undefined;
  update(): void;
  updateButton(): void;
}

// ---- UI construction ----

function buildColorButton(color: BorderColor, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'border-color-btn';
  btn.dataset.borderColor = color;
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
  btn.dataset.borderDouble = isDouble ? '1' : '0';
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

// ---- Event binding ----

function bindColorToggles(ctx: BorderPanelCtx): void {
  ctx.area.querySelectorAll<HTMLElement>('.border-color-btn').forEach((colorBtn) => {
    colorBtn.addEventListener('click', () => {
      const sel = ctx.getSelected();
      if (!sel) {
        return;
      }
      const clickedColor = colorBtn.dataset.borderColor as BorderColor;
      ctx.undo.snapshot();
      if (sel.border && sel.border.color === clickedColor) {
        ctx.store.updateVoice(sel.id, { border: undefined });
      } else if (sel.border) {
        ctx.store.updateVoice(sel.id, { border: { ...sel.border, color: clickedColor } });
      } else {
        ctx.store.updateVoice(sel.id, {
          border: { color: clickedColor, double: false, thickness: normalizedCoord(0.01) },
        });
      }
      ctx.update();
      ctx.updateButton();
    });
  });
}

function bindStyleToggles(ctx: BorderPanelCtx): void {
  ctx.area.querySelectorAll<HTMLElement>('.border-style-btn').forEach((styleBtn) => {
    styleBtn.addEventListener('click', () => {
      const sel = ctx.getSelected();
      if (!sel?.border) {
        return;
      }
      ctx.undo.snapshot();
      ctx.store.updateVoice(sel.id, {
        border: { ...sel.border, double: styleBtn.dataset.borderDouble === '1' },
      });
      ctx.update();
      ctx.updateButton();
    });
  });
}

function bindThicknessSlider(ctx: BorderPanelCtx): void {
  const slider = document.querySelector<HTMLInputElement>('#border-thickness');
  if (!slider) {
    return;
  }
  slider.addEventListener('input', () => {
    const sel = ctx.getSelected();
    if (!sel?.border) {
      return;
    }
    ctx.store.updateVoice(sel.id, {
      border: { ...sel.border, thickness: normalizedCoord(parseInt(slider.value) / 100) },
    });
  });
  slider.addEventListener('pointerdown', () => {
    ctx.undo.snapshot();
  });
}

function openPanel(ctx: BorderPanelCtx, syncMenuActive: () => void): void {
  ctx.area.replaceChildren();

  ctx.area.append(buildColorButton('white', 'Octave up'));
  ctx.area.append(buildColorButton('black', 'Octave down'));
  ctx.area.append(htmlEl('div', { className: 'separator' }));
  ctx.area.append(buildStyleButton(false, 'Single'));
  ctx.area.append(buildStyleButton(true, 'Double'));
  ctx.area.append(htmlEl('div', { className: 'separator' }));

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = 'border-thickness';
  slider.className = 'expansion-slider';
  slider.min = '1';
  slider.max = '100';
  slider.value = '1';
  slider.title = 'Thickness';
  ctx.area.append(slider);

  ctx.area.classList.remove('hidden');
  syncMenuActive();

  bindColorToggles(ctx);
  bindStyleToggles(ctx);
  bindThicknessSlider(ctx);

  ctx.update();
}

/**
 * Create a border expansion panel.
 *
 * The returned panel populates `area` with color buttons (white/black),
 * style buttons (single/double), and a thickness slider when opened.
 */
export function createBorderPanel(deps: {
  area: HTMLElement;
  store: SigilStore;
  undo: UndoManager;
  getSelectedId: () => string | undefined;
  syncMenuActive: () => void;
}): ExpansionPanel & {
  updateButton(): void;
} {
  const { area, store, undo, getSelectedId, syncMenuActive } = deps;

  const ctx: BorderPanelCtx = {
    area,
    getSelected() {
      const id = getSelectedId();
      return id ? (store.getVoice(id) ?? undefined) : undefined;
    },
    store,
    undo,
    update,
    updateButton,
  };

  function update(): void {
    const sel = ctx.getSelected();
    const border = sel?.border ?? undefined;

    area.querySelectorAll<HTMLElement>('.border-color-btn').forEach((b) => {
      b.classList.toggle('active', border != undefined && b.dataset.borderColor === border.color);
    });
    area.querySelectorAll<HTMLElement>('.border-style-btn').forEach((b) => {
      b.classList.toggle(
        'active',
        border != undefined && (b.dataset.borderDouble === '1') === border.double,
      );
    });

    const slider = document.querySelector<HTMLInputElement>('#border-thickness');
    if (slider) {
      slider.value = border ? String(Math.round(border.thickness * 100)) : '1';
    }
  }

  function updateButton(): void {
    const btn = document.querySelector<HTMLElement>('#btn-border');
    const sel = ctx.getSelected();
    btn?.classList.toggle('has-border', sel?.border != undefined);
  }

  function close(): void {
    area.classList.add('hidden');
    area.replaceChildren();
  }

  return { close, open: () => openPanel(ctx, syncMenuActive), update, updateButton };
}
