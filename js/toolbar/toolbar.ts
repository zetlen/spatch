// Toolbar.ts — Toolbar UI: context bar, dropdowns, inline expansion

import { effect } from '@preact/signals-core';
import { qel } from '../dom.ts';
import type { SigilStore, UndoManager } from '../state.ts';
import type { ExpansionPanel } from './blend-panel.ts';
import { createBlendPanel } from './blend-panel.ts';
import { createBorderPanel } from './border-panel.ts';
import { createFillPanel } from './fill-panel.ts';
import { createPatternPanel } from './pattern-panel.ts';
import type { Voice } from '../types.ts';

export class Toolbar {
  store: SigilStore;
  undo: UndoManager;
  currentTool: string;
  onToolChange: ((tool: string) => void) | undefined;
  onDuplicate: (() => void) | undefined;
  selectedId: string | undefined;

  /** Track which expansion is open so only one shows at a time. */
  private _openExpansion: 'fill' | 'blend' | 'border' | undefined = undefined;

  private _blendPanel: ExpansionPanel;
  private _borderPanel: ReturnType<typeof createBorderPanel>;
  private _fillPanel: ReturnType<typeof createFillPanel>;
  private _patternPanel: ReturnType<typeof createPatternPanel>;
  constructor(store: SigilStore, undo: UndoManager) {
    this.store = store;
    this.undo = undo;
    this.currentTool = 'select';
    this.onToolChange = undefined;
    this.onDuplicate = undefined;
    this.selectedId = undefined;

    this._blendPanel = createBlendPanel({
      area: qel('#bottom-expansion'),
      store: this.store,
      undo: this.undo,
      getSelectedId: () => this.selectedId,
      syncMenuActive: () => this._syncMenuActive(),
    });

    this._fillPanel = createFillPanel({
      area: qel('#bottom-expansion'),
      store: this.store,
      undo: this.undo,
      getSelectedId: () => this.selectedId,
      syncMenuActive: () => this._syncMenuActive(),
    });

    this._borderPanel = createBorderPanel({
      area: qel('#bottom-expansion'),
      store: this.store,
      undo: this.undo,
      getSelectedId: () => this.selectedId,
      syncMenuActive: () => this._syncMenuActive(),
    });

    this._patternPanel = createPatternPanel({
      store: this.store,
      undo: this.undo,
      getSelectedId: () => this.selectedId,
      closeExpansion: () => this._closeExpansion(),
      closeAllDropdowns: () => this._closeAllDropdowns(),
      syncMenuActive: () => this._syncMenuActive(),
    });

    this._bindToolButtons();
    this._patternPanel.populate();
    this._patternPanel.bind();
    this._bindExpansionToggle('#btn-blend', 'blend', this._blendPanel);
    this._bindExpansionToggle('#fill-swatch', 'fill', this._fillPanel);
    this._bindExpansionToggle(
      '#btn-border',
      'border',
      this._borderPanel,
      () => !!this.getSelected(),
    );
    this._bindActionButtons();
    this._updateToolActive();

    // Auto-sync toolbar panels when store data changes and a voice is selected.
    // Replaces explicit syncToSelectedShape() calls scattered across app.ts,
    // keyboard.ts, and interaction.ts — any store mutation now triggers the sync.
    {
      let first = true;
      effect(() => {
        void store.data; // subscribe to store signal
        if (first) {
          first = false;
          return; // skip initial run
        }
        if (this.selectedId) {
          this.syncToSelectedShape();
        }
      });
    }
  }

  getSelected(): Voice | undefined {
    return this.selectedId ? (this.store.getVoice(this.selectedId) ?? undefined) : undefined;
  }

  // ---- Bottom bar context switching ----

  updateBottomBar(): void {
    const tools = qel('#bottom-tools');
    const props = qel('#bottom-props');
    if (this.selectedId) {
      tools.classList.add('hidden');
      props.classList.remove('hidden');
    } else {
      tools.classList.remove('hidden');
      props.classList.add('hidden');
      this._closeAllDropdowns();
      this._closeExpansion();
    }
  }

  // ---- Tool buttons ----

  _bindToolButtons(): void {
    document.querySelectorAll<HTMLElement>('.tool-btn[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tool === 'select' && this.selectedId) {
          this.currentTool = 'select';
          this._updateToolActive();
          if (this.onToolChange) {
            this.onToolChange('deselect');
          }
          return;
        }
        this.currentTool = btn.dataset.tool!;
        this._updateToolActive();
        if (this.onToolChange) {
          this.onToolChange(this.currentTool);
        }
      });
    });
  }

  _updateToolActive(): void {
    document.querySelectorAll<HTMLElement>('.tool-btn[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === this.currentTool);
    });
  }

  // ---- Expansion panel toggle binding ----

  private _bindExpansionToggle(
    selector: string,
    name: 'blend' | 'fill' | 'border',
    panel: { open(): void },
    guard?: () => boolean,
  ): void {
    qel(selector).addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeAllDropdowns();
      if (guard && !guard()) {
        return;
      }
      if (this._openExpansion === name) {
        this._closeExpansion();
      } else {
        this._closeExpansion();
        this._openExpansion = name;
        panel.open();
      }
    });
  }

  // ---- Expansion helpers ----

  _closeExpansion(): void {
    this._openExpansion = undefined;
    const area = document.querySelector<HTMLElement>('#bottom-expansion');
    if (area) {
      area.classList.add('hidden');
      area.replaceChildren();
    }
    this._syncMenuActive();
  }

  _closeAllDropdowns(): void {
    document.querySelector<HTMLElement>('#pattern-dropdown')?.classList.add('hidden');
    this._syncMenuActive();
  }

  /** Sync .active on menu-trigger buttons to reflect open/closed state */
  _syncMenuActive(): void {
    const patternOpen = !document
      .querySelector<HTMLElement>('#pattern-dropdown')
      ?.classList.contains('hidden');
    document.querySelector<HTMLElement>('#btn-pattern')?.classList.toggle('active', patternOpen);
    document
      .querySelector('#fill-swatch')
      ?.classList.toggle('active', this._openExpansion === 'fill');
    document
      .querySelector('#btn-blend')
      ?.classList.toggle('active', this._openExpansion === 'blend');
    document
      .querySelector('#btn-border')
      ?.classList.toggle('active', this._openExpansion === 'border');
  }

  // ---- Action buttons ----

  _bindActionButtons(): void {
    qel('#btn-undo').addEventListener('click', () => this.undo.undo());
    qel('#btn-redo').addEventListener('click', () => this.undo.redo());
    qel('#btn-deselect').addEventListener('click', () => {
      if (this.onToolChange) {
        this.onToolChange('deselect');
      }
    });
    qel('#btn-duplicate').addEventListener('click', () => {
      if (this.onDuplicate) {
        this.onDuplicate();
      }
    });
    qel('#btn-delete').addEventListener('click', () => {
      if (this.selectedId) {
        this.undo.snapshot();
        this.store.removeVoice(this.selectedId);
      }
    });
  }

  // ---- Sync toolbar state to selected shape ----

  syncToSelectedShape(): void {
    const sel = this.getSelected();
    if (!sel) {
      return;
    }
    this._fillPanel.syncToSelected();
    this._patternPanel.update();
    this._borderPanel.updateButton();
    // Refresh open expansion if any
    if (this._openExpansion === 'fill') {
      this._fillPanel.update();
    } else if (this._openExpansion === 'blend') {
      this._blendPanel.update();
    } else if (this._openExpansion === 'border') {
      this._borderPanel.update();
    }
  }
}
