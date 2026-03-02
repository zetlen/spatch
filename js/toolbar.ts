// toolbar.ts — Toolbar UI, tool selection, color picker, pattern selector

import { getSwatchColor, drawAngleDial, hslToHex, hexToHsl } from './colors.ts';
import type { SigilStore, UndoManager } from './state.ts';
import type {
  Voice,
  FillDraft,
  FillMode,
  PatternType,
  BlendMode,
  BorderColor,
  ReverbStyle,
} from './types.ts';
import { normalizedCoord, fillToFillDraft, fillDraftToFill } from './types.ts';

export class Toolbar {
  store: SigilStore;
  undo: UndoManager;
  currentTool: string;
  onToolChange: ((tool: string) => void) | null;
  selectedId: string | null;
  selectedDecoId: string | null;
  _fillDraft: FillDraft;

  constructor(store: SigilStore, undo: UndoManager) {
    this.store = store;
    this.undo = undo;
    this.currentTool = 'select';
    this.onToolChange = null;
    this.selectedId = null;
    this.selectedDecoId = null;
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
    this._bindBlendSelector();
    this._bindBorderPanel();
    this._bindReverbPanel();
    this._updateToolActive();
  }

  getSelected(): Voice | null {
    return this.selectedId ? (this.store.getVoice(this.selectedId) ?? null) : null;
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
        const sel = this.getSelected();
        if (!sel) return;

        const newPattern = pattern === 'none' ? null : (pattern as PatternType);
        const finalPattern = sel.effect === newPattern ? null : newPattern;
        this.undo.snapshot();
        this.store.updateVoice(sel.id, { effect: finalPattern });
        this._updatePatternActive();
      });
    });
  }

  _updatePatternActive(): void {
    const sel = this.getSelected();
    const current = sel ? sel.effect : null;
    document.querySelectorAll<HTMLElement>('.pattern-btn').forEach((btn) => {
      const p = btn.dataset.pattern;
      btn.classList.toggle('active', (p === 'none' && !current) || p === current);
    });
  }

  _bindActionButtons(): void {
    document.getElementById('btn-undo')!.addEventListener('click', () => this.undo.undo());
    document.getElementById('btn-redo')!.addEventListener('click', () => this.undo.redo());
    document.getElementById('btn-delete')!.addEventListener('click', () => {
      if (this.selectedId) {
        this.undo.snapshot();
        this.store.removeVoice(this.selectedId);
      } else if (this.selectedDecoId) {
        this.undo.snapshot();
        this.store.removeText(this.selectedDecoId);
      }
    });
  }

  _bindBlendSelector(): void {
    const select = document.getElementById('blend-mode') as HTMLSelectElement | null;
    if (!select) return;
    select.addEventListener('change', () => {
      const sel = this.getSelected();
      if (sel) {
        this.undo.snapshot();
        this.store.updateVoice(sel.id, { blend: select.value as BlendMode });
      }
    });
  }

  _updateBlendSelector(): void {
    const select = document.getElementById('blend-mode') as HTMLSelectElement | null;
    if (!select) return;
    const sel = this.getSelected();
    select.value = sel ? sel.blend : 'soft-light';
  }

  _bindBorderPanel(): void {
    const btn = document.getElementById('btn-border');
    const panel = document.getElementById('border-panel');
    if (!btn || !panel) return;

    // Toggle border on/off and open/close panel
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sel = this.getSelected();
      if (!sel) return;

      if (sel.border) {
        // Has border — toggle panel open/close
        panel.classList.toggle('hidden');
      } else {
        // No border — add one and open panel
        this.undo.snapshot();
        this.store.updateVoice(sel.id, {
          border: { color: 'white', double: false, thickness: normalizedCoord(0.5) },
        });
        panel.classList.remove('hidden');
        this._updateBorderPanel();
      }
    });

    // Close panel on outside click
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target as Node) && e.target !== btn) {
        panel.classList.add('hidden');
      }
    });

    // Color toggles
    panel.querySelectorAll<HTMLElement>('.border-color-btn').forEach((colorBtn) => {
      colorBtn.addEventListener('click', () => {
        const sel = this.getSelected();
        if (!sel?.border) return;
        this.undo.snapshot();
        this.store.updateVoice(sel.id, {
          border: { ...sel.border, color: colorBtn.dataset.borderColor as BorderColor },
        });
        this._updateBorderPanel();
      });
    });

    // Style toggles (single/double)
    panel.querySelectorAll<HTMLElement>('.border-style-btn').forEach((styleBtn) => {
      styleBtn.addEventListener('click', () => {
        const sel = this.getSelected();
        if (!sel?.border) return;
        this.undo.snapshot();
        this.store.updateVoice(sel.id, {
          border: { ...sel.border, double: styleBtn.dataset.borderDouble === '1' },
        });
        this._updateBorderPanel();
      });
    });

    // Remove border button
    const removeBtn = document.getElementById('btn-remove-border');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        const sel = this.getSelected();
        if (!sel) return;
        this.undo.snapshot();
        this.store.updateVoice(sel.id, { border: null });
        panel.classList.add('hidden');
        this._updateBorderPanel();
      });
    }

    // Thickness slider
    const slider = document.getElementById('border-thickness') as HTMLInputElement | null;
    if (slider) {
      slider.addEventListener('input', () => {
        const sel = this.getSelected();
        if (!sel?.border) return;
        this.store.updateVoice(sel.id, {
          border: { ...sel.border, thickness: normalizedCoord(parseInt(slider.value) / 100) },
        });
      });
      // Snapshot on pointerdown for undo
      slider.addEventListener('pointerdown', () => {
        this.undo.snapshot();
      });
    }
  }

  _updateBorderPanel(): void {
    const btn = document.getElementById('btn-border');
    const sel = this.getSelected();
    const hasBorder = sel?.border != null;

    btn?.classList.toggle('has-border', hasBorder);

    if (!hasBorder) return;
    const border = sel!.border!;

    // Update color toggles
    document.querySelectorAll<HTMLElement>('.border-color-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.borderColor === border.color);
    });

    // Update style toggles
    document.querySelectorAll<HTMLElement>('.border-style-btn').forEach((b) => {
      b.classList.toggle('active', (b.dataset.borderDouble === '1') === border.double);
    });

    // Update thickness slider
    const slider = document.getElementById('border-thickness') as HTMLInputElement | null;
    if (slider) {
      slider.value = String(Math.round(border.thickness * 100));
    }
  }

  _bindFillMode(): void {
    const select = document.getElementById('fill-mode') as HTMLSelectElement;
    select.addEventListener('change', () => {
      const sel = this.getSelected();
      if (sel) {
        this._fillDraft.mode = select.value as FillMode;
        this._commitFill(sel.id, true);
        this.updateSwatchFromSelected();
      }
    });
  }

  _commitFill(id: string, withUndo: boolean): void {
    const fill = fillDraftToFill(this._fillDraft);
    if (withUndo) {
      this.undo.snapshot();
    }
    this.store.updateFill(id, fill);
  }

  _bindColorPicker(): void {
    const panel = document.getElementById('color-picker-panel')!;
    const swatch = document.getElementById('fill-swatch')!;

    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        this._syncColorInputs();
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

        const sel = this.getSelected();
        if (sel) {
          this._fillDraft.mode = tab.dataset.tab as FillMode;
          this._commitFill(sel.id, false);
          (document.getElementById('fill-mode') as HTMLSelectElement).value = tab.dataset.tab!;
          this.updateSwatchFromSelected();
        }

        this._syncColorInputs();
      });
    });

    // Bind all native color inputs
    this._bindNativeColorInput('color-solid', 'h', 's', 'l');
    this._bindNativeColorInput('color-rad-1', 'h', 's', 'l');
    this._bindNativeColorInput('color-rad-2', 'h2', 's2', 'l2');
    this._bindNativeColorInput('color-lin-1', 'h', 's', 'l');
    this._bindNativeColorInput('color-lin-2', 'h2', 's2', 'l2');

    const angleDial = document.getElementById('angle-dial') as HTMLCanvasElement | null;
    if (angleDial) {
      angleDial.addEventListener('click', (e) => {
        const rect = angleDial.getBoundingClientRect();
        const x = e.clientX - rect.left - 50;
        const y = e.clientY - rect.top - 50;
        const angle = Math.round((Math.atan2(y, x) * 180) / Math.PI);
        const sel = this.getSelected();
        if (sel) {
          this._fillDraft.gradAngle = (angle + 360) % 360;
          this._commitFill(sel.id, false);
          this.updateSwatchFromSelected();
          this._renderAngleDial();
        }
      });
    }
  }

  _bindNativeColorInput(
    inputId: string,
    hKey: 'h' | 'h2',
    sKey: 's' | 's2',
    lKey: 'l' | 'l2',
  ): void {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (!input) return;
    input.addEventListener('input', () => {
      const sel = this.getSelected();
      if (!sel) return;
      const [h, s, l] = hexToHsl(input.value);
      this._fillDraft[hKey] = h;
      this._fillDraft[sKey] = s;
      this._fillDraft[lKey] = l;
      this._commitFill(sel.id, false);
      this.updateSwatchFromSelected();
    });
  }

  _syncColorInputs(): void {
    const d = this._fillDraft;
    this._setColorInput('color-solid', d.h, d.s, d.l);
    this._setColorInput('color-rad-1', d.h, d.s, d.l);
    this._setColorInput('color-rad-2', d.h2, d.s2, d.l2);
    this._setColorInput('color-lin-1', d.h, d.s, d.l);
    this._setColorInput('color-lin-2', d.h2, d.s2, d.l2);
    this._renderAngleDial();
  }

  _setColorInput(inputId: string, h: number, s: number, l: number): void {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (input) input.value = hslToHex(h, s, l);
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
    const sel = this.getSelected();
    if (sel) {
      swatch.style.background = getSwatchColor(sel.fill);
    }
  }

  syncToSelectedShape(): void {
    const sel = this.getSelected();
    if (!sel) return;

    // Populate draft from selected voice's fill
    this._fillDraft = fillToFillDraft(sel.fill);

    (document.getElementById('fill-mode') as HTMLSelectElement).value = sel.fill.mode;

    this._syncColorInputs();

    const panel = document.getElementById('color-picker-panel')!;
    panel
      .querySelectorAll<HTMLElement>('.panel-tab')
      .forEach((t) => t.classList.toggle('active', t.dataset.tab === sel.fill.mode));
    panel.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
    const activeTab = document.getElementById('tab-' + sel.fill.mode);
    if (activeTab) activeTab.classList.add('active');

    this.updateSwatchFromSelected();
    this._updatePatternActive();
    this._updateBlendSelector();
    this._updateBorderPanel();
    this._updateReverbPanel();
  }

  _bindReverbPanel(): void {
    const btn = document.getElementById('btn-reverb');
    const panel = document.getElementById('reverb-panel');
    if (!btn || !panel) return;

    // Toggle reverb on/off and open/close panel
    btn.addEventListener('click', (e) => {
      e.stopPropagation();

      if (this.store.data.reverb) {
        // Has reverb — toggle panel open/close
        panel.classList.toggle('hidden');
      } else {
        // No reverb — add one and open panel
        this.undo.snapshot();
        this.store.updateReverb({ depth: normalizedCoord(0.5), style: 'glow' });
        panel.classList.remove('hidden');
        this._updateReverbPanel();
      }
    });

    // Close panel on outside click
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target as Node) && e.target !== btn) {
        panel.classList.add('hidden');
      }
    });

    // Style toggle buttons
    panel.querySelectorAll<HTMLElement>('.reverb-style-btn').forEach((styleBtn) => {
      styleBtn.addEventListener('click', () => {
        if (!this.store.data.reverb) return;
        this.undo.snapshot();
        this.store.updateReverb({
          ...this.store.data.reverb,
          style: styleBtn.dataset.reverbStyle as ReverbStyle,
        });
        this._updateReverbPanel();
      });
    });

    // Remove reverb button
    const removeBtn = document.getElementById('btn-remove-reverb');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        this.undo.snapshot();
        this.store.updateReverb(null);
        panel.classList.add('hidden');
        this._updateReverbPanel();
      });
    }

    // Depth slider
    const slider = document.getElementById('reverb-depth') as HTMLInputElement | null;
    if (slider) {
      slider.addEventListener('input', () => {
        if (!this.store.data.reverb) return;
        this.store.updateReverb({
          ...this.store.data.reverb,
          depth: normalizedCoord(parseInt(slider.value) / 100),
        });
      });
      // Snapshot on pointerdown for undo
      slider.addEventListener('pointerdown', () => {
        this.undo.snapshot();
      });
    }
  }

  _updateReverbPanel(): void {
    const btn = document.getElementById('btn-reverb');
    const hasReverb = this.store.data.reverb != null;

    btn?.classList.toggle('has-reverb', hasReverb);

    if (!hasReverb) return;
    const reverb = this.store.data.reverb!;

    // Update style button active state
    document.querySelectorAll<HTMLElement>('.reverb-style-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.reverbStyle === reverb.style);
    });

    // Update depth slider value
    const slider = document.getElementById('reverb-depth') as HTMLInputElement | null;
    if (slider) {
      slider.value = String(Math.round(reverb.depth * 100));
    }
  }
}
