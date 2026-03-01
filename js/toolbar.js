// toolbar.js — Toolbar UI, tool selection, color picker, pattern selector

import { getSwatchColor, drawSLSquare, drawAngleDial } from './colors.ts';

export class Toolbar {
  constructor(state) {
    this.state = state;
    this.currentTool = 'select';
    this.onToolChange = null;
    this._activeStop = { radial: 1, linear: 1 }; // which gradient stop each tab edits

    this._bindToolButtons();
    this._bindPatternButtons();
    this._bindActionButtons();
    this._bindColorPicker();
    this._bindFillMode();
    this._bindLayerButtons();
    this._updateToolActive();
  }

  _bindToolButtons() {
    document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.currentTool = btn.dataset.tool;
        this._updateToolActive();

        // Show/hide text input
        const textInput = document.getElementById('text-input');
        if (this.currentTool === 'text') {
          textInput.classList.remove('hidden');
          textInput.focus();
        } else {
          textInput.classList.add('hidden');
        }

        if (this.onToolChange) this.onToolChange(this.currentTool);
      });
    });
  }

  _updateToolActive() {
    document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === this.currentTool);
    });
  }

  _bindPatternButtons() {
    document.querySelectorAll('.pattern-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pattern = btn.dataset.pattern;
        const sel = this.state.getSelected();
        if (!sel) return;

        const newPattern = pattern === 'none' ? null : pattern;
        // Toggle: if already active, deselect
        const finalPattern = sel.pattern === newPattern ? null : newPattern;
        this.state.updateShapeWithUndo(sel.id, { pattern: finalPattern });
        this._updatePatternActive();
      });
    });
  }

  _updatePatternActive() {
    const sel = this.state.getSelected();
    const current = sel ? sel.pattern : null;
    document.querySelectorAll('.pattern-btn').forEach((btn) => {
      const p = btn.dataset.pattern;
      btn.classList.toggle('active', (p === 'none' && !current) || p === current);
    });
  }

  _bindActionButtons() {
    document.getElementById('btn-undo').addEventListener('click', () => this.state.undo());
    document.getElementById('btn-redo').addEventListener('click', () => this.state.redo());
    document.getElementById('btn-delete').addEventListener('click', () => {
      if (this.state.selectedId) {
        this.state.removeShape(this.state.selectedId);
      } else if (this.state.selectedDecoId) {
        this.state.removeDecoration(this.state.selectedDecoId);
      }
    });
  }

  _bindLayerButtons() {
    document.getElementById('btn-bring-front').addEventListener('click', () => {
      if (this.state.selectedId) this.state.bringToFront(this.state.selectedId);
    });
    document.getElementById('btn-send-back').addEventListener('click', () => {
      if (this.state.selectedId) this.state.sendToBack(this.state.selectedId);
    });
  }

  _bindFillMode() {
    const select = document.getElementById('fill-mode');
    select.addEventListener('change', () => {
      const sel = this.state.getSelected();
      if (sel) {
        this.state.updateFillWithUndo(sel.id, { mode: select.value });
        this.updateSwatchFromSelected();
      }
    });
  }

  // Returns the h/s/l or h2/s2/l2 fields for the active stop of a given tab
  _getStopFields(tab) {
    const stop = this._activeStop[tab] || 1;
    return stop === 2
      ? { hKey: 'h2', sKey: 's2', lKey: 'l2' }
      : { hKey: 'h', sKey: 's', lKey: 'l' };
  }

  _bindColorPicker() {
    const panel = document.getElementById('color-picker-panel');
    const swatch = document.getElementById('fill-swatch');

    // Toggle panel
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        this._renderColorPicker();
      }
    });

    // Close panel on outside click
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== swatch) {
        panel.classList.add('hidden');
      }
    });

    // Tab switching
    panel.querySelectorAll('.panel-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.panel-tab').forEach((t) => t.classList.remove('active'));
        panel.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const tabId = 'tab-' + tab.dataset.tab;
        document.getElementById(tabId).classList.add('active');

        // Also change fill mode
        const sel = this.state.getSelected();
        if (sel) {
          this.state.updateFill(sel.id, { mode: tab.dataset.tab });
          document.getElementById('fill-mode').value = tab.dataset.tab;
          this.updateSwatchFromSelected();
        }

        this._renderColorPicker();
      });
    });

    // --- Solid tab: SL square + hue slider ---
    this._bindSLSquare('sl-square', 'solid');
    this._bindHueSlider('hue-slider', 'solid');

    // --- Radial tab: SL square + hue slider + stop toggle ---
    this._bindSLSquare('sl-square-rad', 'radial');
    this._bindHueSlider('hue-slider-rad', 'radial');
    this._bindStopToggle('radial');

    // --- Linear tab: SL square + hue slider + stop toggle + angle dial ---
    this._bindSLSquare('sl-square-lin', 'linear');
    this._bindHueSlider('hue-slider-lin', 'linear');
    this._bindStopToggle('linear');

    // Angle dial click
    const angleDial = document.getElementById('angle-dial');
    if (angleDial) {
      angleDial.addEventListener('click', (e) => {
        const rect = angleDial.getBoundingClientRect();
        const x = e.clientX - rect.left - 50;
        const y = e.clientY - rect.top - 50;
        const angle = Math.round((Math.atan2(y, x) * 180) / Math.PI);
        const sel = this.state.getSelected();
        if (sel) {
          this.state.updateFill(sel.id, { gradAngle: (angle + 360) % 360 });
          this.updateSwatchFromSelected();
          this._renderAngleDial();
        }
      });
    }
  }

  _bindSLSquare(canvasId, tab) {
    const canvas = document.getElementById(canvasId);
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
        this.state.updateFill(sel.id, {
          [sKey]: Math.max(0, Math.min(100, s)),
          [lKey]: Math.max(0, Math.min(100, l)),
        });
        this.updateSwatchFromSelected();
        this._renderColorPicker();
      }
    });
  }

  _bindHueSlider(sliderId, tab) {
    const slider = document.getElementById(sliderId);
    if (!slider) return;
    slider.addEventListener('input', () => {
      const sel = this.state.getSelected();
      if (sel) {
        const { hKey } = this._getStopFields(tab);
        this.state.updateFill(sel.id, { [hKey]: parseInt(slider.value) });
        this.updateSwatchFromSelected();
        this._renderColorPicker();
      }
    });
  }

  _bindStopToggle(tab) {
    document.querySelectorAll(`.stop-btn[data-tab="${tab}"]`).forEach((btn) => {
      btn.addEventListener('click', () => {
        this._activeStop[tab] = parseInt(btn.dataset.stop);
        document
          .querySelectorAll(`.stop-btn[data-tab="${tab}"]`)
          .forEach((b) => b.classList.toggle('active', b.dataset.stop === btn.dataset.stop));
        // Sync hue slider to the newly active stop
        const sel = this.state.getSelected();
        if (sel) {
          const { hKey } = this._getStopFields(tab);
          const sliderId = tab === 'radial' ? 'hue-slider-rad' : 'hue-slider-lin';
          document.getElementById(sliderId).value = sel.fill[hKey];
          this._renderColorPicker();
        }
      });
    });
  }

  _renderColorPicker() {
    this._renderSLSquareForTab('sl-square', 'solid');
    this._renderSLSquareForTab('sl-square-rad', 'radial');
    this._renderSLSquareForTab('sl-square-lin', 'linear');
    this._renderAngleDial();
  }

  _renderSLSquareForTab(canvasId, tab) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const sel = this.state.getSelected();
    const { hKey, sKey, lKey } = this._getStopFields(tab);
    const hue = sel ? sel.fill[hKey] : 200;
    drawSLSquare(ctx, 0, 0, 160, 160, hue);

    // Indicator dot
    if (sel) {
      const ix = (sel.fill[sKey] / 100) * 160;
      const iy = (1 - sel.fill[lKey] / 100) * 160;
      ctx.beginPath();
      ctx.arc(ix, iy, 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  _renderAngleDial() {
    const canvas = document.getElementById('angle-dial');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const sel = this.state.getSelected();
    const angle = sel ? sel.fill.gradAngle || 0 : 0;
    drawAngleDial(ctx, 50, 50, 40, angle);
  }

  updateSwatchFromSelected() {
    const swatch = document.getElementById('fill-swatch');
    const sel = this.state.getSelected();
    if (sel) {
      swatch.style.background = getSwatchColor(sel.fill);
    }
  }

  syncToSelectedShape() {
    const sel = this.state.getSelected();
    if (!sel) return;

    // Sync fill mode
    document.getElementById('fill-mode').value = sel.fill.mode;

    // Sync hue sliders
    document.getElementById('hue-slider').value = sel.fill.h;
    document.getElementById('hue-slider-rad').value =
      this._activeStop.radial === 2 ? sel.fill.h2 : sel.fill.h;
    document.getElementById('hue-slider-lin').value =
      this._activeStop.linear === 2 ? sel.fill.h2 : sel.fill.h;

    // Reset stop toggles to stop 1
    this._activeStop = { radial: 1, linear: 1 };
    document
      .querySelectorAll('.stop-btn')
      .forEach((b) => b.classList.toggle('active', b.dataset.stop === '1'));

    // Re-sync hue sliders after resetting stops
    document.getElementById('hue-slider-rad').value = sel.fill.h;
    document.getElementById('hue-slider-lin').value = sel.fill.h;

    // Sync panel tab
    const panel = document.getElementById('color-picker-panel');
    panel
      .querySelectorAll('.panel-tab')
      .forEach((t) => t.classList.toggle('active', t.dataset.tab === sel.fill.mode));
    panel.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
    const activeTab = document.getElementById('tab-' + sel.fill.mode);
    if (activeTab) activeTab.classList.add('active');

    this.updateSwatchFromSelected();
    this._updatePatternActive();
  }
}
