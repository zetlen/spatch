// toolbar.ts — Toolbar UI: context bar, dropdowns, inline expansion, reverb

import { getSwatchColor, hslToHex, hexToHsl } from './colors.ts';
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

  /** Track which expansion is open so only one shows at a time. */
  private _openExpansion: 'fill' | 'blend' | 'border' | null = null;

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
    this._populatePatternDropdown();
    this._bindPatternDropdown();
    this._bindBlendButton();
    this._bindFillSwatch();
    this._bindBorderButton();
    this._bindActionButtons();
    this._bindReverbPanel();
    this._updateToolActive();
  }

  getSelected(): Voice | null {
    return this.selectedId ? (this.store.getVoice(this.selectedId) ?? null) : null;
  }

  // ---- Bottom bar context switching ----

  updateBottomBar(): void {
    const tools = document.getElementById('bottom-tools')!;
    const props = document.getElementById('bottom-props')!;
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
          if (this.onToolChange) this.onToolChange('deselect');
          return;
        }
        this.currentTool = btn.dataset.tool!;
        this._updateToolActive();
        if (this.onToolChange) this.onToolChange(this.currentTool);
      });
    });
  }

  _updateToolActive(): void {
    document.querySelectorAll<HTMLElement>('.tool-btn[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === this.currentTool);
    });
  }

  // ---- Pattern dropdown ----

  _populatePatternDropdown(): void {
    const dropdown = document.getElementById('pattern-dropdown')!;
    const patterns = [
      { value: 'stripes', title: 'Stripes' },
      { value: 'checker', title: 'Checker' },
      { value: 'noise', title: 'Noise' },
      { value: 'gradient', title: 'Gradient' },
    ];
    for (const p of patterns) {
      const btn = document.createElement('button');
      btn.className = 'dropdown-item';
      btn.dataset.pattern = p.value;
      btn.title = p.title;
      const band = document.createElement('div');
      band.className = `pattern-band pattern-preview-${p.value}`;
      btn.appendChild(band);
      dropdown.appendChild(btn);
    }

    const sep = document.createElement('div');
    sep.className = 'separator';
    dropdown.appendChild(sep);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'action-btn danger';
    removeBtn.dataset.pattern = 'none';
    removeBtn.title = 'Remove pattern';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', 'tabler-sprite.svg#tabler-trash');
    svg.appendChild(use);
    removeBtn.appendChild(svg);
    dropdown.appendChild(removeBtn);
  }

  _bindPatternDropdown(): void {
    const toggle = document.getElementById('btn-pattern')!;
    const dropdown = document.getElementById('pattern-dropdown')!;

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeExpansion();
      const wasHidden = dropdown.classList.contains('hidden');
      this._closeAllDropdowns();
      if (wasHidden) {
        dropdown.classList.remove('hidden');
      }
      this._syncMenuActive();
    });

    dropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = (e.target as HTMLElement).closest('[data-pattern]') as HTMLElement | null;
      if (!item) return;
      const pattern = item.dataset.pattern;
      const sel = this.getSelected();
      if (!sel) return;

      const newPattern = pattern === 'none' ? null : (pattern as PatternType);
      const finalPattern = sel.effect === newPattern ? null : newPattern;
      this.undo.snapshot();
      this.store.updateVoice(sel.id, { effect: finalPattern });
      this._updatePatternDropdown();
      if (pattern === 'none') {
        dropdown.classList.add('hidden');
        this._syncMenuActive();
      }
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target as Node) && e.target !== toggle) {
        dropdown.classList.add('hidden');
        this._syncMenuActive();
      }
    });
  }

  _updatePatternDropdown(): void {
    const sel = this.getSelected();
    const current = sel ? sel.effect : null;
    document.querySelectorAll<HTMLElement>('#pattern-dropdown .dropdown-item').forEach((btn) => {
      const p = btn.dataset.pattern;
      btn.classList.toggle('active', (p === 'none' && !current) || p === current);
    });
    document.getElementById('btn-pattern')?.classList.toggle('has-pattern', current != null);
  }

  // ---- Blend button -> inline expansion ----

  _bindBlendButton(): void {
    const btn = document.getElementById('btn-blend')!;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeAllDropdowns();
      if (this._openExpansion === 'blend') {
        this._closeExpansion();
      } else {
        this._openBlendExpansion();
      }
    });
  }

  _openBlendExpansion(): void {
    this._closeExpansion();
    this._openExpansion = 'blend';

    const area = document.getElementById('bottom-expansion')!;
    area.replaceChildren();

    // Icon references for sprite scanner:
    // tabler-sprite.svg#tabler-ghost tabler-sprite.svg#tabler-skull
    // tabler-sprite.svg#tabler-diamond tabler-sprite.svg#tabler-meteor
    // tabler-sprite.svg#tabler-virus tabler-sprite.svg#tabler-spiral
    // tabler-sprite.svg#tabler-biohazard
    const modes: Array<{ value: BlendMode; symbol: string; title: string }> = [
      { value: 'soft-light', symbol: 'tabler-ghost', title: 'Soft Light' },
      { value: 'multiply', symbol: 'tabler-skull', title: 'Multiply' },
      { value: 'screen', symbol: 'tabler-diamond', title: 'Screen' },
      { value: 'overlay', symbol: 'tabler-meteor', title: 'Overlay' },
      { value: 'color-burn', symbol: 'tabler-virus', title: 'Burn' },
      { value: 'difference', symbol: 'tabler-spiral', title: 'Difference' },
      { value: 'exclusion', symbol: 'tabler-biohazard', title: 'Exclusion' },
    ];

    const sel = this.getSelected();
    const current = sel ? sel.blend : 'soft-light';

    for (const m of modes) {
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.dataset.blend = m.value;
      btn.title = m.title;
      if (m.value === current) btn.classList.add('active');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '20');
      svg.setAttribute('height', '20');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `tabler-sprite.svg#${m.symbol}`);
      svg.appendChild(use);
      btn.appendChild(svg);
      area.appendChild(btn);

      btn.addEventListener('click', () => {
        const voice = this.getSelected();
        if (!voice) return;
        this.undo.snapshot();
        this.store.updateVoice(voice.id, { blend: m.value });
        this._updateBlendExpansion();
      });
    }

    area.classList.remove('hidden');
    this._syncMenuActive();
  }

  _updateBlendExpansion(): void {
    const sel = this.getSelected();
    const current = sel ? sel.blend : 'soft-light';
    document
      .querySelectorAll<HTMLElement>('#bottom-expansion .action-btn[data-blend]')
      .forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.blend === current);
      });
  }

  // ---- Fill swatch -> inline expansion ----

  _bindFillSwatch(): void {
    const swatch = document.getElementById('fill-swatch')!;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeAllDropdowns();
      if (this._openExpansion === 'fill') {
        this._closeExpansion();
      } else {
        this._openFillExpansion();
      }
    });
  }

  _openFillExpansion(): void {
    this._closeExpansion();
    this._openExpansion = 'fill';

    const area = document.getElementById('bottom-expansion')!;
    area.replaceChildren();

    const sel = this.getSelected();
    const activeMode = sel ? sel.fill.mode : this._fillDraft.mode;
    const isLinear = activeMode === 'linear';

    // --- Solid mode button (filled square icon) ---
    const solidBtn = document.createElement('button');
    solidBtn.className = 'action-btn';
    solidBtn.dataset.tab = 'solid';
    solidBtn.title = 'Solid color';
    if (!isLinear) solidBtn.classList.add('active');
    const solidSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    solidSvg.setAttribute('width', '20');
    solidSvg.setAttribute('height', '20');
    solidSvg.setAttribute('viewBox', '0 0 20 20');
    const solidRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    solidRect.setAttribute('x', '4');
    solidRect.setAttribute('y', '4');
    solidRect.setAttribute('width', '12');
    solidRect.setAttribute('height', '12');
    solidRect.setAttribute('fill', 'currentColor');
    solidSvg.appendChild(solidRect);
    solidBtn.appendChild(solidSvg);
    area.appendChild(solidBtn);

    // --- Linear mode button (gradient bar icon) ---
    const linearBtn = document.createElement('button');
    linearBtn.className = 'action-btn';
    linearBtn.dataset.tab = 'linear';
    linearBtn.title = 'Gradient';
    if (isLinear) linearBtn.classList.add('active');
    const linSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    linSvg.setAttribute('width', '20');
    linSvg.setAttribute('height', '20');
    linSvg.setAttribute('viewBox', '0 0 20 20');
    const linDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const linGrad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    linGrad.setAttribute('id', 'fill-grad-icon');
    linGrad.setAttribute('x1', '0');
    linGrad.setAttribute('y1', '0');
    linGrad.setAttribute('x2', '1');
    linGrad.setAttribute('y2', '0');
    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', 'currentColor');
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', 'currentColor');
    stop2.setAttribute('stop-opacity', '0');
    linGrad.appendChild(stop1);
    linGrad.appendChild(stop2);
    linDefs.appendChild(linGrad);
    linSvg.appendChild(linDefs);
    const linRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    linRect.setAttribute('x', '4');
    linRect.setAttribute('y', '4');
    linRect.setAttribute('width', '12');
    linRect.setAttribute('height', '12');
    linRect.setAttribute('fill', 'url(#fill-grad-icon)');
    linSvg.appendChild(linRect);
    linearBtn.appendChild(linSvg);
    area.appendChild(linearBtn);

    // --- Separator ---
    const sep = document.createElement('div');
    sep.className = 'separator';
    area.appendChild(sep);

    // --- Color input 1 (always visible) ---
    const colorInput1 = document.createElement('input');
    colorInput1.type = 'color';
    colorInput1.id = 'color-solid';
    colorInput1.className = 'expansion-color-input';
    colorInput1.title = 'Color';
    area.appendChild(colorInput1);

    // --- Color input 2 (linear only) ---
    const colorInput2 = document.createElement('input');
    colorInput2.type = 'color';
    colorInput2.id = 'color-lin-2';
    colorInput2.className = 'expansion-color-input';
    colorInput2.title = 'Color 2';
    if (!isLinear) colorInput2.classList.add('hidden');
    area.appendChild(colorInput2);

    // --- Angle slider (linear only) ---
    const angleSlider = document.createElement('input');
    angleSlider.type = 'range';
    angleSlider.id = 'angle-slider';
    angleSlider.className = 'expansion-slider';
    angleSlider.min = '0';
    angleSlider.max = '359';
    angleSlider.value = '0';
    angleSlider.title = 'Angle';
    if (!isLinear) angleSlider.classList.add('hidden');
    area.appendChild(angleSlider);

    // Show expansion
    area.classList.remove('hidden');
    this._syncMenuActive();

    // Bind events
    this._bindExpansionColorPicker();

    // Sync values
    this._syncColorInputs();
  }

  _bindExpansionColorPicker(): void {
    const area = document.getElementById('bottom-expansion')!;

    // Tab switching (solid/linear toggle buttons)
    area.querySelectorAll<HTMLElement>('.action-btn[data-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.tab as FillMode;
        const isLinear = mode === 'linear';

        // Update active toggle
        area
          .querySelectorAll<HTMLElement>('.action-btn[data-tab]')
          .forEach((t) => t.classList.toggle('active', t.dataset.tab === mode));

        // Show/hide linear-only controls
        const colorInput2 = document.getElementById('color-lin-2');
        const angleSlider = document.getElementById('angle-slider');
        colorInput2?.classList.toggle('hidden', !isLinear);
        angleSlider?.classList.toggle('hidden', !isLinear);

        const sel = this.getSelected();
        if (sel) {
          this._fillDraft.mode = mode;
          this._commitFill(sel.id, false);
          this.updateSwatchFromSelected();
        }

        this._syncColorInputs();
      });
    });

    // Bind native color inputs
    // color-solid serves as the primary color for both solid and linear modes
    this._bindNativeColorInput('color-solid', 'h', 's', 'l');
    this._bindNativeColorInput('color-lin-2', 'h2', 's2', 'l2');

    // Angle slider
    const angleSlider = document.getElementById('angle-slider') as HTMLInputElement | null;
    if (angleSlider) {
      angleSlider.addEventListener('input', () => {
        const sel = this.getSelected();
        if (sel) {
          this._fillDraft.gradAngle = parseInt(angleSlider.value);
          this._commitFill(sel.id, false);
          this.updateSwatchFromSelected();
        }
      });
    }
  }

  // ---- Border button -> inline expansion ----

  _bindBorderButton(): void {
    const btn = document.getElementById('btn-border')!;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeAllDropdowns();

      const sel = this.getSelected();
      if (!sel) return;

      if (!sel.border) {
        // No border -- add default and open expansion
        this.undo.snapshot();
        this.store.updateVoice(sel.id, {
          border: { color: 'white', double: false, thickness: normalizedCoord(0.5) },
        });
        this._openBorderExpansion();
        this._updateBorderButton();
      } else if (this._openExpansion === 'border') {
        // Already showing border expansion -- close it
        this._closeExpansion();
      } else {
        // Has border, expansion not open -- open it
        this._openBorderExpansion();
      }
    });
  }

  _openBorderExpansion(): void {
    this._closeExpansion();
    this._openExpansion = 'border';

    const area = document.getElementById('bottom-expansion')!;
    area.replaceChildren();

    const SVG_NS = 'http://www.w3.org/2000/svg';

    // --- White circle button ---
    const whiteBtn = document.createElement('button');
    whiteBtn.className = 'border-color-btn';
    whiteBtn.dataset.borderColor = 'white';
    whiteBtn.title = 'Octave up';
    const whiteSvg = document.createElementNS(SVG_NS, 'svg');
    whiteSvg.setAttribute('width', '20');
    whiteSvg.setAttribute('height', '20');
    whiteSvg.setAttribute('viewBox', '0 0 20 20');
    const whiteCircle = document.createElementNS(SVG_NS, 'circle');
    whiteCircle.setAttribute('cx', '10');
    whiteCircle.setAttribute('cy', '10');
    whiteCircle.setAttribute('r', '6');
    whiteCircle.setAttribute('fill', 'white');
    whiteCircle.setAttribute('stroke', '#999');
    whiteCircle.setAttribute('stroke-width', '1');
    whiteSvg.appendChild(whiteCircle);
    whiteBtn.appendChild(whiteSvg);
    area.appendChild(whiteBtn);

    // --- Black circle button ---
    const blackBtn = document.createElement('button');
    blackBtn.className = 'border-color-btn';
    blackBtn.dataset.borderColor = 'black';
    blackBtn.title = 'Octave down';
    const blackSvg = document.createElementNS(SVG_NS, 'svg');
    blackSvg.setAttribute('width', '20');
    blackSvg.setAttribute('height', '20');
    blackSvg.setAttribute('viewBox', '0 0 20 20');
    const blackCircle = document.createElementNS(SVG_NS, 'circle');
    blackCircle.setAttribute('cx', '10');
    blackCircle.setAttribute('cy', '10');
    blackCircle.setAttribute('r', '6');
    blackCircle.setAttribute('fill', 'currentColor');
    blackSvg.appendChild(blackCircle);
    blackBtn.appendChild(blackSvg);
    area.appendChild(blackBtn);

    // --- Separator ---
    const sep1 = document.createElement('div');
    sep1.className = 'separator';
    area.appendChild(sep1);

    // --- Single border button (one rectangle outline) ---
    const singleBtn = document.createElement('button');
    singleBtn.className = 'border-style-btn';
    singleBtn.dataset.borderDouble = '0';
    singleBtn.title = 'Single';
    const singleSvg = document.createElementNS(SVG_NS, 'svg');
    singleSvg.setAttribute('width', '20');
    singleSvg.setAttribute('height', '20');
    singleSvg.setAttribute('viewBox', '0 0 20 20');
    const singleRect = document.createElementNS(SVG_NS, 'rect');
    singleRect.setAttribute('x', '4');
    singleRect.setAttribute('y', '4');
    singleRect.setAttribute('width', '12');
    singleRect.setAttribute('height', '12');
    singleRect.setAttribute('fill', 'none');
    singleRect.setAttribute('stroke', 'currentColor');
    singleRect.setAttribute('stroke-width', '2');
    singleSvg.appendChild(singleRect);
    singleBtn.appendChild(singleSvg);
    area.appendChild(singleBtn);

    // --- Double border button (two concentric rectangle outlines) ---
    const doubleBtn = document.createElement('button');
    doubleBtn.className = 'border-style-btn';
    doubleBtn.dataset.borderDouble = '1';
    doubleBtn.title = 'Double';
    const doubleSvg = document.createElementNS(SVG_NS, 'svg');
    doubleSvg.setAttribute('width', '20');
    doubleSvg.setAttribute('height', '20');
    doubleSvg.setAttribute('viewBox', '0 0 20 20');
    const outerRect = document.createElementNS(SVG_NS, 'rect');
    outerRect.setAttribute('x', '3');
    outerRect.setAttribute('y', '3');
    outerRect.setAttribute('width', '14');
    outerRect.setAttribute('height', '14');
    outerRect.setAttribute('fill', 'none');
    outerRect.setAttribute('stroke', 'currentColor');
    outerRect.setAttribute('stroke-width', '1.5');
    doubleSvg.appendChild(outerRect);
    const innerRect = document.createElementNS(SVG_NS, 'rect');
    innerRect.setAttribute('x', '6');
    innerRect.setAttribute('y', '6');
    innerRect.setAttribute('width', '8');
    innerRect.setAttribute('height', '8');
    innerRect.setAttribute('fill', 'none');
    innerRect.setAttribute('stroke', 'currentColor');
    innerRect.setAttribute('stroke-width', '1.5');
    doubleSvg.appendChild(innerRect);
    doubleBtn.appendChild(doubleSvg);
    area.appendChild(doubleBtn);

    // --- Separator ---
    const sep2 = document.createElement('div');
    sep2.className = 'separator';
    area.appendChild(sep2);

    // --- Thickness slider ---
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'border-thickness';
    slider.className = 'expansion-slider';
    slider.min = '1';
    slider.max = '100';
    slider.value = '50';
    slider.title = 'Thickness';
    area.appendChild(slider);

    // --- Separator ---
    const sep3 = document.createElement('div');
    sep3.className = 'separator';
    area.appendChild(sep3);

    // --- Remove button (trash icon from sprite) ---
    const removeBtn = document.createElement('button');
    removeBtn.id = 'btn-remove-border';
    removeBtn.className = 'border-remove-btn';
    removeBtn.title = 'Remove border';
    const trashSvg = document.createElementNS(SVG_NS, 'svg');
    trashSvg.setAttribute('width', '18');
    trashSvg.setAttribute('height', '18');
    const trashUse = document.createElementNS(SVG_NS, 'use');
    trashUse.setAttribute('href', 'tabler-sprite.svg#tabler-trash');
    trashSvg.appendChild(trashUse);
    removeBtn.appendChild(trashSvg);
    area.appendChild(removeBtn);

    // Show expansion
    area.classList.remove('hidden');
    this._syncMenuActive();

    // Bind events
    this._bindExpansionBorderControls();

    // Sync values
    this._updateBorderExpansion();
  }

  _bindExpansionBorderControls(): void {
    const area = document.getElementById('bottom-expansion')!;

    // Color toggles
    area.querySelectorAll<HTMLElement>('.border-color-btn').forEach((colorBtn) => {
      colorBtn.addEventListener('click', () => {
        const sel = this.getSelected();
        if (!sel?.border) return;
        this.undo.snapshot();
        this.store.updateVoice(sel.id, {
          border: { ...sel.border, color: colorBtn.dataset.borderColor as BorderColor },
        });
        this._updateBorderExpansion();
        this._updateBorderButton();
      });
    });

    // Style toggles
    area.querySelectorAll<HTMLElement>('.border-style-btn').forEach((styleBtn) => {
      styleBtn.addEventListener('click', () => {
        const sel = this.getSelected();
        if (!sel?.border) return;
        this.undo.snapshot();
        this.store.updateVoice(sel.id, {
          border: { ...sel.border, double: styleBtn.dataset.borderDouble === '1' },
        });
        this._updateBorderExpansion();
        this._updateBorderButton();
      });
    });

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
      slider.addEventListener('pointerdown', () => {
        this.undo.snapshot();
      });
    }

    // Remove border
    const removeBtn = document.getElementById('btn-remove-border');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        const sel = this.getSelected();
        if (!sel) return;
        this.undo.snapshot();
        this.store.updateVoice(sel.id, { border: null });
        this._closeExpansion();
        this._updateBorderButton();
      });
    }
  }

  _updateBorderExpansion(): void {
    const sel = this.getSelected();
    if (!sel?.border) return;
    const border = sel.border;

    // Update color toggles within expansion area
    document.querySelectorAll<HTMLElement>('#bottom-expansion .border-color-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.borderColor === border.color);
    });

    // Update style toggles within expansion area
    document.querySelectorAll<HTMLElement>('#bottom-expansion .border-style-btn').forEach((b) => {
      b.classList.toggle('active', (b.dataset.borderDouble === '1') === border.double);
    });

    // Update thickness slider
    const slider = document.getElementById('border-thickness') as HTMLInputElement | null;
    if (slider) {
      slider.value = String(Math.round(border.thickness * 100));
    }
  }

  _updateBorderButton(): void {
    const btn = document.getElementById('btn-border');
    const sel = this.getSelected();
    btn?.classList.toggle('has-border', sel?.border != null);
  }

  // ---- Expansion helpers ----

  _closeExpansion(): void {
    this._openExpansion = null;
    const area = document.getElementById('bottom-expansion');
    if (area) {
      area.classList.add('hidden');
      area.replaceChildren();
    }
    this._syncMenuActive();
  }

  _closeAllDropdowns(): void {
    document.getElementById('pattern-dropdown')?.classList.add('hidden');
    this._syncMenuActive();
  }

  /** Sync .active on menu-trigger buttons to reflect open/closed state */
  _syncMenuActive(): void {
    const patternOpen = !document.getElementById('pattern-dropdown')?.classList.contains('hidden');
    document.getElementById('btn-pattern')?.classList.toggle('active', patternOpen);
    document
      .getElementById('btn-blend')
      ?.classList.toggle('active', this._openExpansion === 'blend');
    document
      .getElementById('btn-border')
      ?.classList.toggle('active', this._openExpansion === 'border');
  }

  // ---- Action buttons ----

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

  // ---- Fill commit + color input helpers ----

  _commitFill(id: string, withUndo: boolean): void {
    const fill = fillDraftToFill(this._fillDraft);
    if (withUndo) {
      this.undo.snapshot();
    }
    this.store.updateFill(id, fill);
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
    this._setColorInput('color-lin-2', d.h2, d.s2, d.l2);
    const angleSlider = document.getElementById('angle-slider') as HTMLInputElement | null;
    if (angleSlider) angleSlider.value = String(d.gradAngle);
  }

  _setColorInput(inputId: string, h: number, s: number, l: number): void {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (input) input.value = hslToHex(h, s, l);
  }

  updateSwatchFromSelected(): void {
    const swatch = document.getElementById('fill-swatch')!;
    const sel = this.getSelected();
    if (sel) {
      swatch.style.background = getSwatchColor(sel.fill);
    }
  }

  // ---- Sync toolbar state to selected shape ----

  syncToSelectedShape(): void {
    const sel = this.getSelected();
    if (!sel) return;
    this._fillDraft = fillToFillDraft(sel.fill);
    this.updateSwatchFromSelected();
    this._updatePatternDropdown();
    this._updateBorderButton();
    this._updateReverbPanel();
    // Refresh open expansion if any
    if (this._openExpansion === 'fill') {
      this._syncColorInputs();
      // Update active tab to match new voice's fill mode
      const area = document.getElementById('bottom-expansion');
      if (area) {
        const isLinear = sel.fill.mode === 'linear';
        area
          .querySelectorAll<HTMLElement>('.action-btn[data-tab]')
          .forEach((t) => t.classList.toggle('active', t.dataset.tab === sel.fill.mode));
        // Show/hide linear-only controls
        document.getElementById('color-lin-2')?.classList.toggle('hidden', !isLinear);
        document.getElementById('angle-slider')?.classList.toggle('hidden', !isLinear);
      }
    } else if (this._openExpansion === 'blend') {
      this._updateBlendExpansion();
    } else if (this._openExpansion === 'border') {
      this._updateBorderExpansion();
    }
  }

  // ---- Reverb panel (binds to static HTML in top bar) ----

  _bindReverbPanel(): void {
    const btn = document.getElementById('btn-reverb');
    const panel = document.getElementById('reverb-panel');
    if (!btn || !panel) return;

    const syncReverbActive = () => {
      btn.classList.toggle('active', !panel.classList.contains('hidden'));
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();

      if (this.store.data.reverb) {
        panel.classList.toggle('hidden');
      } else {
        this.undo.snapshot();
        this.store.updateReverb({ depth: normalizedCoord(0.5), style: 'glow' });
        panel.classList.remove('hidden');
        this._updateReverbPanel();
      }
      syncReverbActive();
    });

    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target as Node) && e.target !== btn) {
        panel.classList.add('hidden');
        syncReverbActive();
      }
    });

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

    const removeBtn = document.getElementById('btn-remove-reverb');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        this.undo.snapshot();
        this.store.updateReverb(null);
        panel.classList.add('hidden');
        this._updateReverbPanel();
        syncReverbActive();
      });
    }

    const slider = document.getElementById('reverb-depth') as HTMLInputElement | null;
    if (slider) {
      slider.addEventListener('input', () => {
        if (!this.store.data.reverb) return;
        this.store.updateReverb({
          ...this.store.data.reverb,
          depth: normalizedCoord(parseInt(slider.value) / 100),
        });
      });
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

    document.querySelectorAll<HTMLElement>('.reverb-style-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.reverbStyle === reverb.style);
    });

    const slider = document.getElementById('reverb-depth') as HTMLInputElement | null;
    if (slider) {
      slider.value = String(Math.round(reverb.depth * 100));
    }
  }
}
