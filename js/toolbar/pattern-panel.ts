// pattern-panel.ts — Pattern dropdown panel for the bottom toolbar
//
// Extracts pattern dropdown population, binding, and update logic from
// Toolbar into a standalone factory function.

import { qel } from '../dom.ts';
import type { SigilStore, UndoManager } from '../state.ts';
import type { PatternType, Voice } from '../types.ts';

// ---- Shared context ----

interface PatternPanelCtx {
  store: SigilStore;
  undo: UndoManager;
  closeExpansion: () => void;
  closeAllDropdowns: () => void;
  syncMenuActive: () => void;
  getSelected(): Voice | undefined;
  update(): void;
}

// ---- DOM population ----

function populateDropdown(): void {
  const dropdown = qel('#pattern-dropdown');
  const patterns = [
    { title: 'Stripes', value: 'stripes' },
    { title: 'Checker', value: 'checker' },
    { title: 'Noise', value: 'noise' },
    { title: 'Gradient', value: 'gradient' },
  ];
  for (const p of patterns) {
    const btn = document.createElement('button');
    btn.className = 'dropdown-item';
    btn.dataset.pattern = p.value;
    btn.title = p.title;
    const band = document.createElement('div');
    band.className = `pattern-band pattern-preview-${p.value}`;
    btn.append(band);
    dropdown.append(btn);
  }
}

// ---- Event binding ----

function bindDropdown(ctx: PatternPanelCtx): void {
  const toggle = qel('#btn-pattern');
  const dropdown = qel('#pattern-dropdown');

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.closeExpansion();
    const wasHidden = dropdown.classList.contains('hidden');
    ctx.closeAllDropdowns();
    if (wasHidden) {
      dropdown.classList.remove('hidden');
    }
    ctx.syncMenuActive();
  });

  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = (e.target as HTMLElement).closest('[data-pattern]') as HTMLElement | undefined;
    if (!item) {
      return;
    }
    const sel = ctx.getSelected();
    if (!sel) {
      return;
    }
    const newPattern = item.dataset.pattern as PatternType;
    const finalPattern = sel.effect === newPattern ? undefined : newPattern;
    ctx.undo.snapshot();
    ctx.store.updateVoice(sel.id, { effect: finalPattern });
    ctx.update();
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target as Node) && e.target !== toggle) {
      dropdown.classList.add('hidden');
      ctx.syncMenuActive();
    }
  });
}

/** Create a pattern dropdown panel. */
export function createPatternPanel(deps: {
  store: SigilStore;
  undo: UndoManager;
  getSelectedId: () => string | undefined;
  closeExpansion: () => void;
  closeAllDropdowns: () => void;
  syncMenuActive: () => void;
}): {
  populate(): void;
  bind(): void;
  update(): void;
} {
  const { store, undo, getSelectedId, closeExpansion, closeAllDropdowns, syncMenuActive } = deps;

  function getSelected(): Voice | undefined {
    const id = getSelectedId();
    return id ? (store.getVoice(id) ?? undefined) : undefined;
  }

  function update(): void {
    const sel = getSelected();
    const current = sel ? sel.effect : undefined;
    document.querySelectorAll<HTMLElement>('#pattern-dropdown .dropdown-item').forEach((btn) => {
      const p = btn.dataset.pattern;
      btn.classList.toggle('active', (p === 'none' && !current) || p === current);
    });
    document
      .querySelector<HTMLElement>('#btn-pattern')
      ?.classList.toggle('has-pattern', current != undefined);
  }

  const ctx: PatternPanelCtx = {
    closeAllDropdowns,
    closeExpansion,
    getSelected,
    store,
    syncMenuActive,
    undo,
    update,
  };

  return { bind: () => bindDropdown(ctx), populate: populateDropdown, update };
}
