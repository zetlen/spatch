// toolbar.js — Toolbar UI, tool selection, color picker, pattern selector

import { getSwatchColor, drawHueRing, drawSLSquare, drawLabPlane, drawAngleDial } from './colors.js';

export class Toolbar {
  constructor(state) {
    this.state = state;
    this.currentTool = 'select';
    this.onToolChange = null;

    this._bindToolButtons();
    this._bindPatternButtons();
    this._bindActionButtons();
    this._bindColorPicker();
    this._bindFillMode();
    this._bindLayerButtons();
    this._updateToolActive();
  }

  _bindToolButtons() {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
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
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === this.currentTool);
    });
  }

  _bindPatternButtons() {
    document.querySelectorAll('.pattern-btn').forEach(btn => {
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
    document.querySelectorAll('.pattern-btn').forEach(btn => {
      const p = btn.dataset.pattern;
      btn.classList.toggle('active',
        (p === 'none' && !current) || p === current
      );
    });
  }

  _bindActionButtons() {
    document.getElementById('btn-undo').addEventListener('click', () => this.state.undo());
    document.getElementById('btn-redo').addEventListener('click', () => this.state.redo());
    document.getElementById('btn-delete').addEventListener('click', () => {
      if (this.state.selectedId) {
        this.state.removeShape(this.state.selectedId);
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
    panel.querySelectorAll('.panel-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        panel.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
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

    // HSL inputs
    ['h', 's', 'l'].forEach(prop => {
      const input = document.getElementById('inp-' + prop);
      input.addEventListener('input', () => {
        const sel = this.state.getSelected();
        if (sel) {
          this.state.updateFill(sel.id, { [prop]: parseInt(input.value) || 0 });
          this.updateSwatchFromSelected();
          this._renderColorPicker();
        }
      });
    });

    // Linear gradient inputs
    ['h1', 's1', 'l1', 'h2', 's2', 'l2'].forEach(prop => {
      const input = document.getElementById('inp-' + prop);
      if (!input) return;
      input.addEventListener('input', () => {
        const sel = this.state.getSelected();
        if (sel) {
          this.state.updateFill(sel.id, { [prop]: parseInt(input.value) || 0 });
          this.updateSwatchFromSelected();
        }
      });
    });

    // Lab L* slider
    const labSlider = document.getElementById('lab-l-slider');
    if (labSlider) {
      labSlider.addEventListener('input', () => {
        const sel = this.state.getSelected();
        if (sel) {
          this.state.updateFill(sel.id, { labL: parseInt(labSlider.value) });
          this.updateSwatchFromSelected();
          this._renderLabPlane();
        }
      });
    }

    // Hue ring click
    const hueRing = document.getElementById('hue-ring');
    hueRing.addEventListener('click', (e) => {
      const rect = hueRing.getBoundingClientRect();
      const x = e.clientX - rect.left - 100;
      const y = e.clientY - rect.top - 100;
      const angle = Math.atan2(y, x) * 180 / Math.PI;
      const hue = ((angle + 360) % 360) | 0;
      const dist = Math.hypot(x, y);
      if (dist >= 70 && dist <= 95) {
        const sel = this.state.getSelected();
        if (sel) {
          this.state.updateFill(sel.id, { h: hue });
          document.getElementById('inp-h').value = hue;
          this.updateSwatchFromSelected();
          this._renderSLSquare();
        }
      }
    });

    // SL square click
    const slSquare = document.getElementById('sl-square');
    slSquare.addEventListener('click', (e) => {
      const rect = slSquare.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const s = Math.round((x / 150) * 100);
      const l = Math.round((1 - y / 150) * 100);
      const sel = this.state.getSelected();
      if (sel) {
        this.state.updateFill(sel.id, {
          s: Math.max(0, Math.min(100, s)),
          l: Math.max(0, Math.min(100, l)),
        });
        document.getElementById('inp-s').value = sel.fill.s;
        document.getElementById('inp-l').value = sel.fill.l;
        this.updateSwatchFromSelected();
      }
    });

    // Lab plane click
    const labPlane = document.getElementById('lab-plane');
    if (labPlane) {
      labPlane.addEventListener('click', (e) => {
        const rect = labPlane.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const a = Math.round((x / 160) * 256 - 128);
        const b = Math.round(128 - (y / 160) * 256);
        const sel = this.state.getSelected();
        if (sel) {
          this.state.updateFill(sel.id, { labA: a, labB: b });
          this.updateSwatchFromSelected();
        }
      });
    }

    // Angle dial click
    const angleDial = document.getElementById('angle-dial');
    if (angleDial) {
      angleDial.addEventListener('click', (e) => {
        const rect = angleDial.getBoundingClientRect();
        const x = e.clientX - rect.left - 50;
        const y = e.clientY - rect.top - 50;
        const angle = Math.round(Math.atan2(y, x) * 180 / Math.PI);
        const sel = this.state.getSelected();
        if (sel) {
          this.state.updateFill(sel.id, { gradAngle: ((angle + 360) % 360) });
          this.updateSwatchFromSelected();
          this._renderAngleDial();
        }
      });
    }
  }

  _renderColorPicker() {
    this._renderHueRing();
    this._renderSLSquare();
    this._renderLabPlane();
    this._renderAngleDial();
  }

  _renderHueRing() {
    const canvas = document.getElementById('hue-ring');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 200, 200);
    drawHueRing(ctx, 100, 100, 95, 70);

    // Indicator
    const sel = this.state.getSelected();
    if (sel && sel.fill.mode === 'solid') {
      const rad = sel.fill.h * Math.PI / 180;
      const indicatorR = 82;
      ctx.beginPath();
      ctx.arc(100 + Math.cos(rad) * indicatorR, 100 + Math.sin(rad) * indicatorR, 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  _renderSLSquare() {
    const canvas = document.getElementById('sl-square');
    const ctx = canvas.getContext('2d');
    const sel = this.state.getSelected();
    const hue = sel ? sel.fill.h : 200;
    drawSLSquare(ctx, 0, 0, 150, 150, hue);

    // Indicator
    if (sel) {
      const ix = (sel.fill.s / 100) * 150;
      const iy = (1 - sel.fill.l / 100) * 150;
      ctx.beginPath();
      ctx.arc(ix, iy, 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  _renderLabPlane() {
    const canvas = document.getElementById('lab-plane');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const sel = this.state.getSelected();
    const L = sel ? sel.fill.labL : 60;
    drawLabPlane(ctx, 0, 0, 160, 160, L);
  }

  _renderAngleDial() {
    const canvas = document.getElementById('angle-dial');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const sel = this.state.getSelected();
    const angle = sel ? (sel.fill.gradAngle || 0) : 0;
    drawAngleDial(ctx, 50, 50, 40, angle);
  }

  updateSwatchFromSelected() {
    const swatch = document.getElementById('fill-swatch');
    const sel = this.state.getSelected();
    if (sel) {
      const color = getSwatchColor(sel.fill);
      if (color.startsWith('linear-gradient')) {
        swatch.style.background = color;
      } else {
        swatch.style.background = color;
      }
    }
  }

  syncToSelectedShape() {
    const sel = this.state.getSelected();
    if (!sel) return;

    // Sync fill mode
    document.getElementById('fill-mode').value = sel.fill.mode;

    // Sync HSL inputs
    document.getElementById('inp-h').value = sel.fill.h;
    document.getElementById('inp-s').value = sel.fill.s;
    document.getElementById('inp-l').value = sel.fill.l;

    // Sync linear inputs
    const h1 = document.getElementById('inp-h1');
    if (h1) {
      h1.value = sel.fill.h1;
      document.getElementById('inp-s1').value = sel.fill.s1;
      document.getElementById('inp-l1').value = sel.fill.l1;
      document.getElementById('inp-h2').value = sel.fill.h2;
      document.getElementById('inp-s2').value = sel.fill.s2;
      document.getElementById('inp-l2').value = sel.fill.l2;
    }

    // Sync Lab slider
    const labSlider = document.getElementById('lab-l-slider');
    if (labSlider) labSlider.value = sel.fill.labL;

    // Sync panel tab
    const panel = document.getElementById('color-picker-panel');
    panel.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === sel.fill.mode));
    panel.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const activeTab = document.getElementById('tab-' + sel.fill.mode);
    if (activeTab) activeTab.classList.add('active');

    this.updateSwatchFromSelected();
    this._updatePatternActive();
  }
}
