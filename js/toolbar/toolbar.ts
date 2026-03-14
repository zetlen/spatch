// Toolbar.ts — Toolbar UI: context bar, panel management, inline expansion

import { effect } from '@preact/signals-core';
import { qel } from '../dom.ts';
import type { SigilStore, UndoManager } from '../state.ts';
import type { Voice } from '../types.ts';
import { PanelManager } from './expansion-panel.ts';
import { createBlendPanel } from './blend-panel.ts';
import { createBorderPanel } from './border-panel.ts';
import { createFillPanel } from './fill-panel.ts';
import { createPatternPanel } from './pattern-panel.ts';

export class Toolbar {
  store: SigilStore;
  undo: UndoManager;
  currentTool: string;
  onToolChange: ((tool: string) => void) | undefined;
  onDuplicate: (() => void) | undefined;
  selectedId: string | undefined;

  panels: PanelManager;
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

    this.panels = new PanelManager();

    const expansionArea = qel('#bottom-expansion');
    const patternArea = qel('#pattern-dropdown');
    const btnBlend = qel('#btn-blend');
    const btnFill = qel('#fill-swatch');
    const btnBorder = qel('#btn-border');
    const btnPattern = qel('#btn-pattern');

    const sharedDeps = {
      store: this.store,
      undo: this.undo,
      getSelectedId: () => this.selectedId,
    };

    const blendPanel = createBlendPanel({ ...sharedDeps, area: expansionArea });
    this._fillPanel = createFillPanel({ ...sharedDeps, area: expansionArea });
    this._borderPanel = createBorderPanel({ ...sharedDeps, area: expansionArea }, btnBorder);
    this._patternPanel = createPatternPanel({ ...sharedDeps, area: patternArea }, btnPattern);

    // Register all panels with the manager for unified mutex
    this.panels.register('blend', blendPanel, btnBlend, expansionArea);
    this.panels.register('fill', this._fillPanel, btnFill, expansionArea);
    this.panels.register('border', this._borderPanel, btnBorder, expansionArea);
    this.panels.register('pattern', this._patternPanel, btnPattern, patternArea);

    this._bindToolButtons();

    // Bind panel toggle buttons
    btnBlend.addEventListener('click', (e) => {
      e.stopPropagation();
      this.panels.toggle('blend');
    });
    btnFill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.panels.toggle('fill');
    });
    btnBorder.addEventListener('click', (e) => {
      e.stopPropagation();
      this.panels.toggle('border', () => !!this.getSelected());
    });
    btnPattern.addEventListener('click', (e) => {
      e.stopPropagation();
      this.panels.toggle('pattern');
    });

    this._bindActionButtons();
    this._updateToolActive();

    // Auto-sync toolbar panels when store data changes and a voice is selected.
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
      this.panels.close();
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

  // ---- Action buttons ----

  _bindActionButtons(): void {
    const btnUndo = qel<HTMLButtonElement>('#btn-undo');
    const btnRedo = qel<HTMLButtonElement>('#btn-redo');
    const { hasUndos, hasRedos } = this.undo;
    effect(() => {
      btnUndo.disabled = !hasUndos.value;
      btnRedo.disabled = !hasRedos.value;
    });
    btnUndo.addEventListener('click', () => {
      if (hasUndos.value) this.undo.undo();
    });
    btnRedo.addEventListener('click', () => {
      if (hasRedos.value) this.undo.redo();
    });
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
    if (!sel) return;
    this._fillPanel.syncToSelected();
    this._borderPanel.updateButton();
    this._patternPanel.update(); // has-pattern indicator needs sync even when closed
    this.panels.updateOpen();
  }
}
