// toolbar.ts — Toolbar UI, tool selection, color picker, pattern selector

import { getSwatchColor, drawSLSquare, drawAngleDial } from './colors.ts';
import type { SigilState } from './state.ts';
import type { FillDraft, FillMode, PatternType } from './types.ts';
import { fillToFillDraft, fillDraftToFill } from './types.ts';

export class Toolbar {
  state: SigilState;
  currentTool: string;
  onToolChange: ((tool: string) => void) | null;
  _activeStop: { radial: number; linear: number };
  _fillDraft: FillDraft;

  constructor(state: SigilState) {
    this.state = state;
    this.currentTool = 'select';
    this.onToolChange = null;
    this._activeStop = { radial: 1, linear: 1 };
    this._fillDraft = {
      mode: 'solid',
      h: 200,
      s: 80,
      l: 50,
      h2: 180,
      s2: 80,
      l2: 45,
      gradAngle: 0,
    };

    this._bindToolButtons();
    this._bindPatternButtons();
    this._bindActionButtons();
    this._bindColorPicker();
    this._bindFillMode();
    this._bindLayerButtons();
    this._updateToolActive();
  }

  _bindToolButtons(): void {
    document.querySelectorAll<HTMLElement>('.tool-btn[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.currentTool = btn.dataset.tool!;
        this._updateToolActive();

        const textInput = document.getElementById('text-input')!;
        if (this.currentTool === 'text') {
          textInput.classList.remove('hidden');
          (textInput as HTMLInputElement).focus();
        } else {
          textInput.classList.add('hidden');
        }

        if (this.onToolChange) this.onToolChange(this.currentTool);
      });
    });
  }

  _updateToolActive(): void {
    document.querySelectorAll<HTMLElement>('.tool-btn[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === this.currentTool);
    });
  }

  _bindPatternButtons(): void {
    document.querySelectorAll<HTMLElement>('.pattern-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pattern = btn.dataset.pattern;
        const sel = this.state.getSelected();
        if (!sel) return;

        const newPattern = pattern === 'none' ? null : (pattern as PatternType);
        const finalPattern = sel.pattern === newPattern ? null : newPattern;
        this.state.updateShapeWithUndo(sel.id, { pattern: finalPattern });
        this._updatePatternActive();
      });
    });
  }

  _updatePatternActive(): void {
    const sel = this.state.getSelected();
    const current = sel ? sel.pattern : null;
    document.querySelectorAll<HTMLElement>('.pattern-btn').forEach((btn) => {
      const p = btn.dataset.pattern;
      btn.classList.toggle('active', (p === 'none' && !current) || p === current);
    });
  }

  _bindActionButtons(): void {
    document.getElementById('btn-undo')!.addEventListener('click', () => this.state.undo());
    document.getElementById('btn-redo')!.addEventListener('click', () => this.state.redo());
    document.getElementById('btn-delete')!.addEventListener('click', () => {
      if (this.state.selectedId) {
        this.state.removeShape(this.state.selectedId);
      } else if (this.state.selectedDecoId) {
        this.state.removeDecoration(this.state.selectedDecoId);
      }
    });
  }

  _bindLayerButtons(): void {
    document.getElementById('btn-bring-front')!.addEventListener('click', () => {
      if (this.state.selectedId) this.state.bringToFront(this.state.selectedId);
    });
    document.getElementById('btn-send-back')!.addEventListener('click', () => {
      if (this.state.selectedId) this.state.sendToBack(this.state.selectedId);
    });
  }

  _bindFillMode(): void {
    const select = document.getElementById('fill-mode') as HTMLSelectElement;
    select.addEventListener('change', () => {
      const sel = this.state.getSelected();
      if (sel) {
        this._fillDraft.mode = select.value as FillMode;
        this._commitFill(sel.id, true);
        this.updateSwatchFromSelected();
      }
    });
  }

  _getStopFields(tab: string): { hKey: 'h' | 'h2'; sKey: 's' | 's2'; lKey: 'l' | 'l2' } {
    const stop = (this._activeStop as any)[tab] || 1;
    return stop === 2
      ? { hKey: 'h2', sKey: 's2', lKey: 'l2' }
      : { hKey: 'h', sKey: 's', lKey: 'l' };
  }

  _commitFill(id: string, withUndo: boolean): void {
    const fill = fillDraftToFill(this._fillDraft);
    if (withUndo) {
      this.state.updateFillWithUndo(id, fill);
    } else {
      this.state.updateFill(id, fill);
    }
  }

  _bindColorPicker(): void {
    const panel = document.getElementById('color-picker-panel')!;
    const swatch = document.getElementById('fill-swatch')!;

    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        this._renderColorPicker();
      }
    });

    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target as Node) && e.target !== swatch) {
        panel.classList.add('hidden');
      }
    });

    panel.querySelectorAll<HTMLElement>('.panel-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.panel-tab').forEach((t) => t.classList.remove('active'));
        panel.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const tabId = 'tab-' + tab.dataset.tab;
        document.getElementById(tabId)!.classList.add('active');

        const sel = this.state.getSelected();
        if (sel) {
          this._fillDraft.mode = tab.dataset.tab as FillMode;
          this._commitFill(sel.id, false);
          (document.getElementById('fill-mode') as HTMLSelectElement).value = tab.dataset.tab!;
          this.updateSwatchFromSelected();
        }

        this._renderColorPicker();
      });
    });

    this._bindSLSquare('sl-square', 'solid');
    this._bindHueSlider('hue-slider', 'solid');

    this._bindSLSquare('sl-square-rad', 'radial');
    this._bindHueSlider('hue-slider-rad', 'radial');
    this._bindStopToggle('radial');

    this._bindSLSquare('sl-square-lin', 'linear');
    this._bindHueSlider('hue-slider-lin', 'linear');
    this._bindStopToggle('linear');

    const angleDial = document.getElementById('angle-dial') as HTMLCanvasElement | null;
    if (angleDial) {
      angleDial.addEventListener('click', (e) => {
        const rect = angleDial.getBoundingClientRect();
        const x = e.clientX - rect.left - 50;
        const y = e.clientY - rect.top - 50;
        const angle = Math.round((Math.atan2(y, x) * 180) / Math.PI);
        const sel = this.state.getSelected();
        if (sel) {
          this._fillDraft.gradAngle = (angle + 360) % 360;
          this._commitFill(sel.id, false);
          this.updateSwatchFromSelected();
          this._renderAngleDial();
        }
      });
    }
  }

  _bindSLSquare(canvasId: string, tab: string): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) return;
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const s = Math.round((x / 160) * 100);
      const l = Math.round((1 - y / 160) * 100);
      const sel = this.state.getSelected();
      if (sel) {
        const { sKey, lKey } = this._getStopFields(tab);
        this._fillDraft[sKey] = Math.max(0, Math.min(100, s));
        this._fillDraft[lKey] = Math.max(0, Math.min(100, l));
        this._commitFill(sel.id, false);
        this.updateSwatchFromSelected();
        this._renderColorPicker();
      }
    });
  }

  _bindHueSlider(sliderId: string, tab: string): void {
    const slider = document.getElementById(sliderId) as HTMLInputElement | null;
    if (!slider) return;
    slider.addEventListener('input', () => {
      const sel = this.state.getSelected();
      if (sel) {
        const { hKey } = this._getStopFields(tab);
        this._fillDraft[hKey] = parseInt(slider.value);
        this._commitFill(sel.id, false);
        this.updateSwatchFromSelected();
        this._renderColorPicker();
      }
    });
  }

  _bindStopToggle(tab: string): void {
    document.querySelectorAll<HTMLElement>(`.stop-btn[data-tab="${tab}"]`).forEach((btn) => {
      btn.addEventListener('click', () => {
        (this._activeStop as any)[tab] = parseInt(btn.dataset.stop!);
        document
          .querySelectorAll<HTMLElement>(`.stop-btn[data-tab="${tab}"]`)
          .forEach((b) => b.classList.toggle('active', b.dataset.stop === btn.dataset.stop));
        const sel = this.state.getSelected();
        if (sel) {
          const { hKey } = this._getStopFields(tab);
          const sliderId = tab === 'radial' ? 'hue-slider-rad' : 'hue-slider-lin';
          (document.getElementById(sliderId) as HTMLInputElement).value = String(
            this._fillDraft[hKey],
          );
          this._renderColorPicker();
        }
      });
    });
  }

  _renderColorPicker(): void {
    this._renderSLSquareForTab('sl-square', 'solid');
    this._renderSLSquareForTab('sl-square-rad', 'radial');
    this._renderSLSquareForTab('sl-square-lin', 'linear');
    this._renderAngleDial();
  }

  _renderSLSquareForTab(canvasId: string, tab: string): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const { hKey, sKey, lKey } = this._getStopFields(tab);
    const hue = this._fillDraft[hKey];
    drawSLSquare(ctx, 0, 0, 160, 160, hue);

    const ix = (this._fillDraft[sKey] / 100) * 160;
    const iy = (1 - this._fillDraft[lKey] / 100) * 160;
    ctx.beginPath();
    ctx.arc(ix, iy, 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _renderAngleDial(): void {
    const canvas = document.getElementById('angle-dial') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const angle = this._fillDraft.gradAngle;
    drawAngleDial(ctx, 50, 50, 40, angle);
  }

  updateSwatchFromSelected(): void {
    const swatch = document.getElementById('fill-swatch')!;
    const sel = this.state.getSelected();
    if (sel) {
      swatch.style.background = getSwatchColor(sel.fill);
    }
  }

  syncToSelectedShape(): void {
    const sel = this.state.getSelected();
    if (!sel) return;

    // Populate draft from selected shape's fill
    this._fillDraft = fillToFillDraft(sel.fill);

    (document.getElementById('fill-mode') as HTMLSelectElement).value = sel.fill.mode;

    (document.getElementById('hue-slider') as HTMLInputElement).value = String(this._fillDraft.h);
    (document.getElementById('hue-slider-rad') as HTMLInputElement).value = String(
      this._activeStop.radial === 2 ? this._fillDraft.h2 : this._fillDraft.h,
    );
    (document.getElementById('hue-slider-lin') as HTMLInputElement).value = String(
      this._activeStop.linear === 2 ? this._fillDraft.h2 : this._fillDraft.h,
    );

    this._activeStop = { radial: 1, linear: 1 };
    document
      .querySelectorAll<HTMLElement>('.stop-btn')
      .forEach((b) => b.classList.toggle('active', b.dataset.stop === '1'));

    (document.getElementById('hue-slider-rad') as HTMLInputElement).value = String(
      this._fillDraft.h,
    );
    (document.getElementById('hue-slider-lin') as HTMLInputElement).value = String(
      this._fillDraft.h,
    );

    const panel = document.getElementById('color-picker-panel')!;
    panel
      .querySelectorAll<HTMLElement>('.panel-tab')
      .forEach((t) => t.classList.toggle('active', t.dataset.tab === sel.fill.mode));
    panel.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
    const activeTab = document.getElementById('tab-' + sel.fill.mode);
    if (activeTab) activeTab.classList.add('active');

    this.updateSwatchFromSelected();
    this._updatePatternActive();
  }
}
