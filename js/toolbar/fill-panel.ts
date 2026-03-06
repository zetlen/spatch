// fill-panel.ts — Fill color/gradient expansion panel for the bottom toolbar
//
// Extracts the fill swatch, color picker expansion, color inputs,
// angle toggles, and fill draft state from Toolbar into a standalone
// panel conforming to the ExpansionPanel interface.

import { getSwatchColor, hexToHsl, hslToHex } from '../colors.ts';
import { qel } from '../dom.ts';
import type { SigilStore, UndoManager } from '../state.ts';
import type { FillDraft, Voice } from '../types.ts';
import { fillDraftToFill, fillToFillDraft } from '../types.ts';
import type { ExpansionPanel } from './blend-panel.ts';
import { createIconButton, svgEl } from './dom-helpers.ts';

// ---- Shared panel context ----

interface FillPanelCtx {
  area: HTMLElement;
  store: SigilStore;
  undo: UndoManager;
  getSelectedId: () => string | undefined;
  syncMenuActive: () => void;
  fillDraft: FillDraft;
  getSelected(): Voice | undefined;
  commitFill(id: string, withUndo: boolean): void;
  updateSwatch(): void;
}

// ---- Fill commit + color input helpers ----

function setColorInput(inputId: string, h: number, s: number, l: number): void {
  const input = document.querySelector(`#${inputId}`) as HTMLInputElement | undefined;
  if (input) {
    input.value = hslToHex(h, s, l);
  }
}

function syncAngleToggles(draft: FillDraft): void {
  const bits = Math.round(draft.gradAngle / 45) & 7;
  document.querySelectorAll<HTMLElement>('.angle-toggle').forEach((btn) => {
    const bit = parseInt(btn.dataset.angleBit!);
    btn.classList.toggle('active', (bits & (1 << bit)) !== 0);
  });
}

function syncColorInputs(draft: FillDraft): void {
  setColorInput('color-solid', draft.h, draft.s, draft.l);
  setColorInput('color-lin-2', draft.h2, draft.s2, draft.l2);
  syncAngleToggles(draft);
}

function bindNativeColorInput(
  ctx: FillPanelCtx,
  inputId: string,
  hKey: 'h' | 'h2',
  sKey: 's' | 's2',
  lKey: 'l' | 'l2',
): void {
  const input = document.querySelector(`#${inputId}`) as HTMLInputElement | undefined;
  if (!input) {
    return;
  }
  input.addEventListener('input', () => {
    const sel = ctx.getSelected();
    if (!sel) {
      return;
    }
    const [h, s, l] = hexToHsl(input.value);
    ctx.fillDraft[hKey] = h;
    ctx.fillDraft[sKey] = s;
    ctx.fillDraft[lKey] = l;
    ctx.commitFill(sel.id, false);
    ctx.updateSwatch();
  });
}

function bindExpansionColorPicker(ctx: FillPanelCtx): void {
  const gradToggle = document.querySelector<HTMLElement>('#grad-toggle');
  if (gradToggle) {
    gradToggle.addEventListener('click', () => {
      const isLinear = !gradToggle.classList.contains('active');
      gradToggle.classList.toggle('active', isLinear);
      document.querySelector<HTMLElement>('#color-lin-2')?.classList.toggle('hidden', !isLinear);
      document.querySelector<HTMLElement>('#angle-toggles')?.classList.toggle('hidden', !isLinear);

      const sel = ctx.getSelected();
      if (sel) {
        ctx.fillDraft.mode = isLinear ? 'linear' : 'solid';
        ctx.commitFill(sel.id, false);
        ctx.updateSwatch();
      }
      syncColorInputs(ctx.fillDraft);
    });
  }

  bindNativeColorInput(ctx, 'color-solid', 'h', 's', 'l');
  bindNativeColorInput(ctx, 'color-lin-2', 'h2', 's2', 'l2');

  ctx.area.querySelectorAll<HTMLElement>('.angle-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sel = ctx.getSelected();
      if (!sel) {
        return;
      }
      const bit = parseInt(btn.dataset.angleBit!);
      const currentBits = Math.round(ctx.fillDraft.gradAngle / 45) & 7;
      const newBits = currentBits ^ (1 << bit);
      ctx.fillDraft.gradAngle = newBits * 45;
      ctx.commitFill(sel.id, false);
      ctx.updateSwatch();
      syncAngleToggles(ctx.fillDraft);
    });
  });
}

// ---- DOM builders ----

function buildGradientIcon(): SVGElement {
  return svgEl(
    'svg',
    { height: 20, viewBox: '0 0 20 20', width: 20 },
    svgEl(
      'defs',
      {},
      svgEl(
        'linearGradient',
        { id: 'fill-grad-icon', x1: 0, x2: 1, y1: 0, y2: 0 },
        svgEl('stop', { offset: '0%', 'stop-color': 'currentColor' }),
        svgEl('stop', { offset: '100%', 'stop-color': 'currentColor', 'stop-opacity': 0 }),
      ),
    ),
    svgEl('rect', { fill: 'url(#fill-grad-icon)', height: 12, width: 12, x: 4, y: 4 }),
  );
}

function buildAngleToggles(isLinear: boolean): HTMLDivElement {
  // Icon references for sprite scanner:
  // #tabler-feather #tabler-mushroom #tabler-anchor
  const angleToggles = document.createElement('div');
  angleToggles.id = 'angle-toggles';
  angleToggles.className = 'angle-toggles';
  if (!isLinear) {
    angleToggles.classList.add('hidden');
  }

  const bits = [
    { bit: 0, icon: 'feather' },
    { bit: 1, icon: 'mushroom' },
    { bit: 2, icon: 'anchor' },
  ];
  for (const { icon, bit } of bits) {
    const btn = createIconButton({
      className: 'action-btn angle-toggle',
      dataset: { angleBit: String(bit) },
      size: 20,
      symbol: `tabler-${icon}`,
      title: icon.charAt(0).toUpperCase() + icon.slice(1),
    });
    angleToggles.append(btn);
  }
  return angleToggles;
}

function openPanel(ctx: FillPanelCtx): void {
  ctx.area.replaceChildren();

  const sel = ctx.getSelected();
  const activeMode = sel ? sel.fill.mode : ctx.fillDraft.mode;
  const isLinear = activeMode === 'linear';

  const colorInput1 = document.createElement('input');
  colorInput1.type = 'color';
  colorInput1.id = 'color-solid';
  colorInput1.className = 'expansion-color-input';
  colorInput1.title = 'Color';
  ctx.area.append(colorInput1);

  const gradBtn = document.createElement('button');
  gradBtn.className = 'action-btn';
  gradBtn.id = 'grad-toggle';
  gradBtn.title = 'Gradient';
  if (isLinear) {
    gradBtn.classList.add('active');
  }
  gradBtn.append(buildGradientIcon());
  ctx.area.append(gradBtn);

  const colorInput2 = document.createElement('input');
  colorInput2.type = 'color';
  colorInput2.id = 'color-lin-2';
  colorInput2.className = 'expansion-color-input';
  colorInput2.title = 'Color 2';
  if (!isLinear) {
    colorInput2.classList.add('hidden');
  }
  ctx.area.append(colorInput2);

  ctx.area.append(buildAngleToggles(isLinear));

  ctx.area.classList.remove('hidden');
  ctx.syncMenuActive();

  bindExpansionColorPicker(ctx);
  syncColorInputs(ctx.fillDraft);
}

/**
 * Create a fill color/gradient expansion panel.
 *
 * The returned panel populates `area` with color inputs, a gradient toggle,
 * and angle toggles when opened. It maintains a `FillDraft` bag internally
 * to allow mode-switching without data loss.
 */
export function createFillPanel(deps: {
  area: HTMLElement;
  store: SigilStore;
  undo: UndoManager;
  getSelectedId: () => string | undefined;
  syncMenuActive: () => void;
}): ExpansionPanel & {
  syncToSelected(): void;
  updateSwatch(): void;
} {
  const { area, store, undo, getSelectedId, syncMenuActive } = deps;

  const ctx: FillPanelCtx = {
    area,
    commitFill(id: string, withUndo: boolean): void {
      const fill = fillDraftToFill(this.fillDraft);
      if (withUndo) {
        undo.snapshot();
      }
      store.updateFill(id, fill);
    },
    fillDraft: {
      gradAngle: 0,
      h: 200,
      h2: 180,
      l: 50,
      l2: 45,
      mode: 'solid',
      s: 80,
      s2: 80,
    },
    getSelected(): Voice | undefined {
      const id = getSelectedId();
      return id ? (store.getVoice(id) ?? undefined) : undefined;
    },
    getSelectedId,
    store,
    syncMenuActive,
    undo,
    updateSwatch,
  };

  function updateSwatch(): void {
    const swatch = qel('#fill-swatch');
    const sel = ctx.getSelected();
    if (sel) {
      const colorEl = swatch.querySelector<HTMLElement>('.swatch-color');
      if (colorEl) {
        colorEl.style.background = getSwatchColor(sel.fill);
      }
    }
  }
  ctx.updateSwatch = updateSwatch;

  function syncToSelected(): void {
    const sel = ctx.getSelected();
    if (!sel) {
      return;
    }
    ctx.fillDraft = fillToFillDraft(sel.fill);
    updateSwatch();
  }

  function update(): void {
    syncColorInputs(ctx.fillDraft);
    const sel = ctx.getSelected();
    const isLinear = sel ? sel.fill.mode === 'linear' : ctx.fillDraft.mode === 'linear';
    document.querySelector<HTMLElement>('#grad-toggle')?.classList.toggle('active', isLinear);
    document.querySelector<HTMLElement>('#color-lin-2')?.classList.toggle('hidden', !isLinear);
    document.querySelector<HTMLElement>('#angle-toggles')?.classList.toggle('hidden', !isLinear);
  }

  function close(): void {
    area.classList.add('hidden');
    area.replaceChildren();
  }

  return {
    close,
    open: () => openPanel(ctx),
    syncToSelected,
    update,
    updateSwatch,
  };
}
