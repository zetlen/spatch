// blend-panel.ts — Blend mode expansion panel for the bottom toolbar
//
// Extracts the blend mode selection UI from Toolbar into a standalone
// panel conforming to the ExpansionPanel interface.

import type { SigilStore, UndoManager } from '../state.ts';
import type { BlendMode } from '../types.ts';
import { createIconButton } from './dom-helpers.ts';

/** Generic interface for bottom-bar expansion panels. */
export interface ExpansionPanel {
  open(): void;
  close(): void;
  update(): void;
}

/**
 * Create a blend-mode expansion panel.
 *
 * The returned panel populates `area` with one icon button per blend mode
 * when opened, highlights the active mode, and updates highlight state
 * when `update()` is called.
 */
export function createBlendPanel(deps: {
  area: HTMLElement;
  store: SigilStore;
  undo: UndoManager;
  getSelectedId: () => string | undefined;
  syncMenuActive: () => void;
}): ExpansionPanel {
  const { area, store, undo, getSelectedId, syncMenuActive } = deps;

  function getSelected() {
    const id = getSelectedId();
    return id ? (store.getVoice(id) ?? undefined) : undefined;
  }

  // Icon references for sprite scanner:
  // #tabler-ghost #tabler-skull #tabler-diamond #tabler-meteor
  // #tabler-virus #tabler-spiral #tabler-biohazard
  const modes: { value: BlendMode; symbol: string; title: string }[] = [
    { symbol: 'tabler-ghost', title: 'Soft Light', value: 'soft-light' },
    { symbol: 'tabler-skull', title: 'Multiply', value: 'multiply' },
    { symbol: 'tabler-diamond', title: 'Screen', value: 'screen' },
    { symbol: 'tabler-meteor', title: 'Overlay', value: 'overlay' },
    { symbol: 'tabler-virus', title: 'Burn', value: 'color-burn' },
    { symbol: 'tabler-spiral', title: 'Difference', value: 'difference' },
    { symbol: 'tabler-biohazard', title: 'Exclusion', value: 'exclusion' },
  ];

  function open(): void {
    area.replaceChildren();

    const sel = getSelected();
    const current = sel ? sel.blend : 'soft-light';

    for (const m of modes) {
      const btn = createIconButton({
        className: 'action-btn',
        dataset: { blend: m.value },
        symbol: m.symbol,
        title: m.title,
      });
      if (m.value === current) {
        btn.classList.add('active');
      }
      area.append(btn);

      btn.addEventListener('click', () => {
        const voice = getSelected();
        if (!voice) {
          return;
        }
        undo.snapshot();
        store.updateVoice(voice.id, { blend: m.value });
        update();
      });
    }

    area.classList.remove('hidden');
    syncMenuActive();
  }

  function close(): void {
    area.classList.add('hidden');
    area.replaceChildren();
  }

  function update(): void {
    const sel = getSelected();
    const current = sel ? sel.blend : 'soft-light';
    area.querySelectorAll<HTMLElement>('.action-btn[data-blend]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.blend === current);
    });
  }

  return { close, open, update };
}
