// Fill-panel.ts — Fill color/gradient expansion panel

import { getSwatchColor, oklchToString } from '../colors.ts';
import { qel } from '../dom.ts';
import { fillDraftToFill, fillToFillDraft, type FillDraft } from '../types.ts';
import {
  createExpansionPanel,
  getSelectedVoice,
  type ExpansionPanel,
  type PanelDeps,
} from './expansion-panel.ts';
import { createIconButton, svgEl } from './dom-helpers.ts';

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

function buildColorInput(id: string, title: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'color';
  input.id = id;
  input.className = 'expansion-color-input';
  input.title = title;
  input.setAttribute('colorspace', 'limited-srgb');
  return input;
}

// ---- Color parsing helpers ----

/** Parse a color value returned by <input type="color"> into OKLCH components. */
function parseColorValue(value: string): { h: number; c: number; l: number } | null {
  const oklchMatch = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (oklchMatch) {
    return {
      l: parseFloat(oklchMatch[1]!),
      c: parseFloat(oklchMatch[2]!),
      h: parseFloat(oklchMatch[3]!),
    };
  }
  // Fallback: use canvas to convert CSS color to sRGB, then compute OKLCH
  if (!parseColorValue._ctx) {
    parseColorValue._ctx = document.createElement('canvas').getContext('2d')!;
  }
  parseColorValue._ctx.fillStyle = value;
  const hex = parseColorValue._ctx.fillStyle;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return srgbToOklch(r, g, b);
}
parseColorValue._ctx = null as CanvasRenderingContext2D | null;

function srgbToOklch(r: number, g: number, b: number): { h: number; c: number; l: number } {
  const rl = r <= 0.04045 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4;
  const gl = g <= 0.04045 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
  const bl = b <= 0.04045 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4;
  const l_ = Math.cbrt(0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl);
  const m_ = Math.cbrt(0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl);
  const s_ = Math.cbrt(0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bk = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.sqrt(a * a + bk * bk);
  const h = c < 0.001 ? 0 : ((Math.atan2(bk, a) * 180) / Math.PI + 360) % 360;
  return { h, c, l: L };
}

// ---- Factory ----

// Icon references for sprite scanner: #tabler-feather #tabler-mushroom #tabler-anchor
const ANGLE_BITS = [
  { bit: 0, icon: 'feather', label: 'Easing' },
  { bit: 1, icon: 'mushroom', label: 'Speed' },
  { bit: 2, icon: 'anchor', label: 'Direction' },
];

export function createFillPanel(deps: PanelDeps): ExpansionPanel & {
  syncToSelected(): void;
  updateSwatch(): void;
} {
  const { area, store, undo } = deps;

  let fillDraft: FillDraft = {
    mode: 'solid',
    h: 200,
    c: 0.15,
    l: 0.55,
    h2: 180,
    c2: 0.15,
    l2: 0.55,
    gradAngle: 0,
  };

  function commitFill(id: string, withUndo: boolean): void {
    if (withUndo) {
      undo.snapshot();
    }
    store.updateFill(id, fillDraftToFill(fillDraft));
  }

  function updateSwatch(): void {
    const sel = getSelectedVoice(deps);
    if (sel) {
      const colorEl = qel('#fill-swatch').querySelector<HTMLElement>('.swatch-color');
      if (colorEl) {
        colorEl.style.background = getSwatchColor(sel.fill);
      }
    }
  }

  function syncToSelected(): void {
    const sel = getSelectedVoice(deps);
    if (!sel) {
      return;
    }
    fillDraft = fillToFillDraft(sel.fill);
    updateSwatch();
  }

  function bindColorInput(
    input: HTMLInputElement,
    hKey: 'h' | 'h2',
    cKey: 'c' | 'c2',
    lKey: 'l' | 'l2',
  ): void {
    input.addEventListener('input', () => {
      const sel = getSelectedVoice(deps);
      if (!sel) {
        return;
      }
      const parsed = parseColorValue(input.value);
      if (parsed) {
        fillDraft[hKey] = parsed.h;
        fillDraft[cKey] = parsed.c;
        fillDraft[lKey] = parsed.l;
        commitFill(sel.id, false);
        updateSwatch();
      }
    });
  }

  function syncColorInputs() {
    const solid = area.querySelector<HTMLInputElement>('#color-solid');
    const lin2 = area.querySelector<HTMLInputElement>('#color-lin-2');
    if (solid) {
      solid.value = oklchToString(fillDraft.h, fillDraft.c, fillDraft.l);
    }
    if (lin2) {
      lin2.value = oklchToString(fillDraft.h2, fillDraft.c2, fillDraft.l2);
    }
    const bits = Math.round(fillDraft.gradAngle / 45) & 7;
    area.querySelectorAll<HTMLElement>('.angle-toggle').forEach((btn) => {
      const bit = parseInt(btn.dataset.angleBit!);
      btn.classList.toggle('active', (bits & (1 << bit)) !== 0);
    });
  }

  const panel = createExpansionPanel({
    area,
    entries() {
      const sel = getSelectedVoice(deps);
      const isLinear = sel ? sel.fill.mode === 'linear' : fillDraft.mode === 'linear';
      return [
        {
          type: 'item' as const,
          create() {
            const input = buildColorInput('color-solid', isLinear ? 'Start Color' : 'Color');
            bindColorInput(input, 'h', 'c', 'l');
            return input;
          },
        },
        {
          type: 'item' as const,
          key: 'grad-toggle',
          create() {
            const btn = document.createElement('button');
            btn.className = 'action-btn';
            btn.id = 'grad-toggle';
            btn.title = 'Gradient';
            btn.append(buildGradientIcon());
            return btn;
          },
        },
        {
          type: 'item' as const,
          className: isLinear ? undefined : 'hidden',
          create() {
            const input = buildColorInput('color-lin-2', 'End Color');
            bindColorInput(input, 'h2', 'c2', 'l2');
            return input;
          },
        },
        {
          type: 'item' as const,
          className: isLinear ? undefined : 'hidden',
          create() {
            const container = document.createElement('div');
            container.id = 'angle-toggles';
            container.className = 'angle-toggles';
            for (const { icon, bit, label } of ANGLE_BITS) {
              const btn = createIconButton({
                className: 'action-btn angle-toggle',
                dataset: { angleBit: String(bit) },
                size: 20,
                symbol: `tabler-${icon}`,
                title: label,
              });
              btn.addEventListener('click', () => {
                const selected = getSelectedVoice(deps);
                if (!selected) {
                  return;
                }
                const currentBits = Math.round(fillDraft.gradAngle / 45) & 7;
                fillDraft.gradAngle = (currentBits ^ (1 << bit)) * 45;
                commitFill(selected.id, false);
                updateSwatch();
                syncColorInputs();
              });
              container.append(btn);
            }
            return container;
          },
        },
      ];
    },
    isActive(key) {
      if (key === 'grad-toggle') {
        const sel = getSelectedVoice(deps);
        return sel ? sel.fill.mode === 'linear' : fillDraft.mode === 'linear';
      }
      return false;
    },
    onClick(key) {
      if (key !== 'grad-toggle') {
        return;
      }
      const sel = getSelectedVoice(deps);
      if (!sel || sel.waveform === 'stamp') {
        return;
      }
      const nowLinear = fillDraft.mode !== 'linear';
      fillDraft.mode = nowLinear ? 'linear' : 'solid';
      commitFill(sel.id, false);
      updateSwatch();
      // Toggle visibility of gradient controls and update labels
      area.querySelector<HTMLElement>('#color-lin-2')?.classList.toggle('hidden', !nowLinear);
      area.querySelector<HTMLElement>('#angle-toggles')?.classList.toggle('hidden', !nowLinear);
      const solidInput = area.querySelector<HTMLInputElement>('#color-solid');
      if (solidInput) {
        solidInput.title = nowLinear ? 'Start Color' : 'Color';
      }
      syncColorInputs();
    },
    onUpdate() {
      syncColorInputs();
      const sel = getSelectedVoice(deps);
      const isStamp = sel?.waveform === 'stamp';
      const isLinear = !isStamp && (sel ? sel.fill.mode === 'linear' : fillDraft.mode === 'linear');
      area.querySelector<HTMLElement>('#grad-toggle')?.classList.toggle('hidden', isStamp);
      area.querySelector<HTMLElement>('#color-lin-2')?.classList.toggle('hidden', !isLinear);
      area.querySelector<HTMLElement>('#angle-toggles')?.classList.toggle('hidden', !isLinear);
      const solidInput = area.querySelector<HTMLInputElement>('#color-solid');
      if (solidInput) {
        solidInput.title = isLinear ? 'Start Color' : 'Color';
      }
    },
  });

  return { ...panel, syncToSelected, updateSwatch };
}
