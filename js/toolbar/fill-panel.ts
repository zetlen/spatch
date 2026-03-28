// fill-panel.ts — Fill color/gradient expansion panel

import { getSwatchColor, hexToHsl, hslToHex } from '../colors.ts';
import { qel } from '../dom.ts';
import type { BlendMode, FillDraft } from '../types.ts';
import { fillDraftToFill, fillToFillDraft } from '../types.ts';
import { DEFAULT_BLEND } from '../effects.ts';
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
  return input;
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
    gradAngle: 0,
    h: 200,
    h2: 180,
    l: 50,
    l2: 45,
    mode: 'solid',
    s: 80,
    s2: 80,
  };

  function commitFill(id: string, withUndo: boolean): void {
    if (withUndo) undo.snapshot();
    store.updateFill(id, fillDraftToFill(fillDraft));
  }

  function updateSwatch(): void {
    const sel = getSelectedVoice(deps);
    if (sel) {
      const colorEl = qel('#fill-swatch').querySelector<HTMLElement>('.swatch-color');
      if (colorEl) colorEl.style.background = getSwatchColor(sel.fill);
    }
  }

  function syncToSelected(): void {
    const sel = getSelectedVoice(deps);
    if (!sel) return;
    fillDraft = fillToFillDraft(sel.fill);
    updateSwatch();
  }

  function bindColorInput(
    input: HTMLInputElement,
    hKey: 'h' | 'h2',
    sKey: 's' | 's2',
    lKey: 'l' | 'l2',
  ): void {
    input.addEventListener('input', () => {
      const sel = getSelectedVoice(deps);
      if (!sel) return;
      const [h, s, l] = hexToHsl(input.value);
      fillDraft[hKey] = h;
      fillDraft[sKey] = s;
      fillDraft[lKey] = l;
      commitFill(sel.id, false);
      updateSwatch();
    });
  }

  function syncColorInputs() {
    const solid = area.querySelector<HTMLInputElement>('#color-solid');
    const lin2 = area.querySelector<HTMLInputElement>('#color-lin-2');
    if (solid) solid.value = hslToHex(fillDraft.h, fillDraft.s, fillDraft.l);
    if (lin2) lin2.value = hslToHex(fillDraft.h2, fillDraft.s2, fillDraft.l2);
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
            const input = buildColorInput('color-solid', isLinear ? 'Start Vowel' : 'Vowel');
            bindColorInput(input, 'h', 's', 'l');
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
            btn.title = 'Vowel Slide';
            btn.append(buildGradientIcon());
            return btn;
          },
        },
        {
          type: 'item' as const,
          className: isLinear ? undefined : 'hidden',
          create() {
            const input = buildColorInput('color-lin-2', 'End Vowel');
            bindColorInput(input, 'h2', 's2', 'l2');
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
                const sel = getSelectedVoice(deps);
                if (!sel) return;
                const currentBits = Math.round(fillDraft.gradAngle / 45) & 7;
                fillDraft.gradAngle = (currentBits ^ (1 << bit)) * 45;
                commitFill(sel.id, false);
                updateSwatch();
                syncColorInputs();
              });
              container.append(btn);
            }
            return container;
          },
        },
        { type: 'separator' as const },
        {
          type: 'icon' as const,
          symbol: 'tabler-skull',
          title: 'Exponential FM',
          key: 'blend:multiply',
        },
        {
          type: 'icon' as const,
          symbol: 'tabler-spiral',
          title: 'Linear FM',
          key: 'blend:difference',
        },
      ];
    },
    isActive(key) {
      if (key === 'grad-toggle') {
        const sel = getSelectedVoice(deps);
        return sel ? sel.fill.mode === 'linear' : fillDraft.mode === 'linear';
      }
      if (key?.startsWith('blend:')) {
        const blend = key.slice(6);
        return (getSelectedVoice(deps)?.blend ?? DEFAULT_BLEND) === blend;
      }
      return false;
    },
    onClick(key) {
      if (key?.startsWith('blend:')) {
        const voice = getSelectedVoice(deps);
        if (!voice) return;
        deps.undo.snapshot();
        const mode = key.slice(6) as BlendMode;
        deps.store.updateVoice(voice.id, {
          blend: voice.blend === mode ? DEFAULT_BLEND : mode,
        });
        return;
      }
      if (key !== 'grad-toggle') return;
      const sel = getSelectedVoice(deps);
      if (!sel) return;
      const nowLinear = fillDraft.mode !== 'linear';
      fillDraft.mode = nowLinear ? 'linear' : 'solid';
      commitFill(sel.id, false);
      updateSwatch();
      // Toggle visibility of gradient controls and update labels
      area.querySelector<HTMLElement>('#color-lin-2')?.classList.toggle('hidden', !nowLinear);
      area.querySelector<HTMLElement>('#angle-toggles')?.classList.toggle('hidden', !nowLinear);
      const solidInput = area.querySelector<HTMLInputElement>('#color-solid');
      if (solidInput) solidInput.title = nowLinear ? 'Start Vowel' : 'Vowel';
      syncColorInputs();
    },
    onUpdate() {
      syncColorInputs();
      const sel = getSelectedVoice(deps);
      const isLinear = sel ? sel.fill.mode === 'linear' : fillDraft.mode === 'linear';
      area.querySelector<HTMLElement>('#color-lin-2')?.classList.toggle('hidden', !isLinear);
      area.querySelector<HTMLElement>('#angle-toggles')?.classList.toggle('hidden', !isLinear);
      const solidInput = area.querySelector<HTMLInputElement>('#color-solid');
      if (solidInput) solidInput.title = isLinear ? 'Start Vowel' : 'Vowel';
    },
  });

  return { ...panel, syncToSelected, updateSwatch };
}
