// render.ts — SVG DOM reconciler
//
// Creates, updates, and removes SVG elements to match SigilData.
// Elements are keyed by voice ID for efficient reconciliation.

import { setAttrs, svgEl } from '../dom.ts';
import { ensureLinearGradient, getSolidFillColor } from '../colors.ts';
import { DEFAULT_BLEND } from '../effects.ts';
import { computeOverlap } from '../effects.ts';
import { ensurePatternDefs, getPatternFill } from '../patterns.ts';
import { voiceRotation } from '../shapes.ts';
import type { SigilData, Voice } from '../types.ts';
import { get } from '../voices/registry.ts';

// ---- Touch tracking ----

let lastInputWasTouch = false;
globalThis.addEventListener(
  'pointerdown',
  (e) => {
    lastInputWasTouch = (e as PointerEvent).pointerType === 'touch';
  },
  true,
);

// ---- Reconciler state ----

let _voiceLayer: SVGGElement | undefined;
let _selectionLayer: SVGGElement | undefined;
let _defs: SVGDefsElement | undefined;
let _patternDefsReady = false;

/** Reset internal cache — call when switching SVG roots (e.g. embed). */
export function resetCache(): void {
  _voiceLayer = undefined;
  _selectionLayer = undefined;
  _defs = undefined;
  _patternDefsReady = false;
}

// ---- Layer bootstrapping ----

function ensureLayers(svg: SVGSVGElement): {
  defs: SVGDefsElement;
  voiceLayer: SVGGElement;
  selectionLayer: SVGGElement;
} {
  if (_voiceLayer && _selectionLayer && _defs) {
    return {
      defs: _defs,
      selectionLayer: _selectionLayer,
      voiceLayer: _voiceLayer,
    };
  }

  // Find or create <defs>
  let defs = svg.querySelector('defs') as SVGDefsElement | undefined;
  if (!defs) {
    defs = svgEl('defs');
    svg.prepend(defs);
  }

  // Find or create voice layer (first <g> with isolation)
  let voiceLayer = svg.querySelector('g[data-layer="voices"]') as SVGGElement | undefined;
  if (!voiceLayer) {
    voiceLayer = svgEl('g');
    voiceLayer.dataset.layer = 'voices';
    voiceLayer.style.isolation = 'isolate';
    svg.append(voiceLayer);
  }

  // Find or create selection layer
  let selectionLayer = svg.querySelector('g[data-layer="selection"]') as SVGGElement | undefined;
  if (!selectionLayer) {
    selectionLayer = svgEl('g');
    selectionLayer.dataset.layer = 'selection';
    svg.append(selectionLayer);
  }

  _defs = defs;
  _voiceLayer = voiceLayer;
  _selectionLayer = selectionLayer;

  return { defs, selectionLayer, voiceLayer };
}

// ---- Shape geometry (delegated to waveform strategies) ----

function createShapeElement(voice: Voice): SVGElement {
  return get(voice.waveform).ui.createSvgElement(voice);
}

function updateShapeElement(el: SVGElement, voice: Voice): void {
  get(voice.waveform).ui.updateSvgElement(el, voice);
}

function shapeTagName(voice: Voice): string {
  return get(voice.waveform).ui.svgTag;
}

// ---- Transform for rotation ----

function voiceTransform(voice: Voice): string | undefined {
  const rotDeg = voiceRotation(voice);
  if (rotDeg === 0) {
    return;
  }
  return `rotate(${rotDeg}, ${voice.x}, ${voice.y})`;
}

// ---- Fill ----

function applyFill(shapeEl: SVGElement, voice: Voice, defs: SVGDefsElement): void {
  if (voice.fill.mode === 'linear') {
    const gradId = `grad-${voice.id}`;
    const rotDeg = voiceRotation(voice);
    ensureLinearGradient(defs, gradId, voice.fill, rotDeg);
    shapeEl.setAttribute('fill', `url(#${gradId})`);
  } else {
    shapeEl.setAttribute('fill', getSolidFillColor(voice.fill));
    // Remove stale gradient def if fill mode changed
    const oldGrad = defs.querySelector(`#grad-${voice.id}`);
    if (oldGrad) {
      oldGrad.remove();
    }
  }
}

// ---- Pattern overlays ----

function applyPatternOverlay(group: SVGGElement, voice: Voice): void {
  // Remove existing overlay elements (marked with data-overlay)
  const existing = group.querySelectorAll('[data-overlay]');
  for (const el of existing) {
    el.remove();
  }

  // Clean up any per-voice pattern def from a previous render
  const defs = group.closest('svg')?.querySelector('defs');
  defs?.querySelector(`#pat-v-${voice.id}`)?.remove();

  if (!voice.effect) {
    return;
  }

  // Duplicate the shape geometry and fill it with the bitmap tile pattern.
  // The overlay rotates with the shape, but the pattern fill must stay fixed
  // in canvas space. For rotated voices, we clone the shared pattern def and
  // apply an inverse patternTransform to cancel the element rotation.
  const overlay = createShapeElement(voice);
  overlay.dataset.overlay = 'true';

  const rotDeg = voiceRotation(voice);
  if (rotDeg !== 0 && defs) {
    const src = defs.querySelector(`#pat-${voice.effect}`);
    if (src) {
      const clone = src.cloneNode(true) as SVGPatternElement;
      const patId = `pat-v-${voice.id}`;
      clone.id = patId;
      clone.setAttribute('patternTransform', `rotate(${-rotDeg}, ${voice.x}, ${voice.y})`);
      defs.append(clone);
      overlay.setAttribute('fill', `url(#${patId})`);
    }
    overlay.setAttribute('transform', `rotate(${rotDeg}, ${voice.x}, ${voice.y})`);
  } else {
    overlay.setAttribute('fill', getPatternFill(voice.effect));
    const transform = voiceTransform(voice);
    if (transform) {
      overlay.setAttribute('transform', transform);
    }
  }

  group.append(overlay);
}

// ---- Borders ----

function applyBorders(group: SVGGElement, voice: Voice): void {
  // Remove existing border elements
  const existing = group.querySelectorAll('[data-border]');
  for (const el of existing) {
    el.remove();
  }

  if (!voice.border) {
    return;
  }

  const r = voice.size / 2;
  const maxW = r * 0.12;
  const w = Math.max(0.001, voice.border.thickness * maxW);

  // Outer border
  const outerBorder = createShapeElement(voice);
  outerBorder.setAttribute('fill', 'none');
  outerBorder.setAttribute('stroke', voice.border.color);
  outerBorder.setAttribute('stroke-width', String(w));
  outerBorder.dataset.border = 'outer';
  const transform = voiceTransform(voice);
  if (transform) {
    outerBorder.setAttribute('transform', transform);
  }
  group.append(outerBorder);

  if (voice.border.double) {
    // Inner border: concentric shape inset past outer + gap
    const gap = w * 0.6;
    const innerR = r - w - gap;
    if (innerR > 0) {
      const innerVoice = { ...voice, size: innerR * 2 } as Voice;
      const innerBorder = createShapeElement(innerVoice);
      innerBorder.setAttribute('fill', 'none');
      innerBorder.setAttribute('stroke', voice.border.color);
      innerBorder.setAttribute('stroke-width', String(w * 0.5));
      innerBorder.dataset.border = 'inner';
      if (transform) {
        innerBorder.setAttribute('transform', transform);
      }
      group.append(innerBorder);
    }
  }
}

// ---- Voice reconciliation ----

function reconcileVoice(
  group: SVGGElement,
  voice: Voice,
  defs: SVGDefsElement,
  hasOverlap: boolean,
): void {
  const expectedTag = shapeTagName(voice);

  // Get or create the main shape element (first child that isn't an overlay/border)
  let shapeEl = group.querySelector(':scope > :not([data-overlay]):not([data-border])') as
    | SVGElement
    | undefined;

  if (!shapeEl || shapeEl.tagName.toLowerCase() !== expectedTag) {
    // Shape type changed or first render — rebuild main shape
    if (shapeEl) {
      shapeEl.remove();
    }
    shapeEl = createShapeElement(voice);
    // Insert as first child
    group.prepend(shapeEl);
  } else {
    updateShapeElement(shapeEl, voice);
  }

  // Apply blend mode only when overlapping — bijection requires that blend
  // has no visual effect when it has no audio effect.
  group.style.mixBlendMode = hasOverlap ? voice.blend : DEFAULT_BLEND;

  // Apply rotation transform on the main shape (not group, since selection uses group position)
  const transform = voiceTransform(voice);
  if (transform) {
    shapeEl.setAttribute('transform', transform);
  } else {
    shapeEl.removeAttribute('transform');
  }

  // Apply fill
  applyFill(shapeEl, voice, defs);

  // Apply pattern overlay
  applyPatternOverlay(group, voice);

  // Apply borders
  applyBorders(group, voice);
}

function reconcileVoices(
  voiceLayer: SVGGElement,
  voices: Voice[],
  defs: SVGDefsElement,
  soloVoiceId: string | undefined,
): void {
  const voiceIds = new Set(voices.map((v) => v.id));

  // Remove groups for deleted voices
  const existingGroups = voiceLayer.querySelectorAll<SVGGElement>(':scope > g[data-voice-id]');
  for (const g of existingGroups) {
    const id = g.dataset.voiceId!;
    if (!voiceIds.has(id)) {
      g.remove();
      // Clean up gradient defs
      const grad = defs.querySelector(`#grad-${id}`);
      if (grad) {
        grad.remove();
      }
    }
  }

  // Precompute which voices have overlap (for blend mode bijection)
  const overlapping = new Set<string>();
  for (let i = 0; i < voices.length; i++) {
    for (let j = i + 1; j < voices.length; j++) {
      if (
        computeOverlap(
          voices[i]!.x as number,
          voices[i]!.y as number,
          voices[i]!.size as number,
          voices[j]!.x as number,
          voices[j]!.y as number,
          voices[j]!.size as number,
        ) > 0
      ) {
        overlapping.add(voices[i]!.id);
        overlapping.add(voices[j]!.id);
      }
    }
  }

  // Add or update groups for each voice (new groups inserted near siblings;
  // existing groups keep their current DOM position — voice order is not data)
  let prevGroup;
  for (const voice of voices) {
    let group = voiceLayer.querySelector<SVGGElement>(`g[data-voice-id="${voice.id}"]`);
    if (!group) {
      group = svgEl('g');
      group.dataset.voiceId = voice.id;
      // Insert after previous sibling to maintain order
      if (prevGroup && prevGroup.nextSibling) {
        prevGroup.nextSibling.before(group);
      } else if (!prevGroup) {
        voiceLayer.prepend(group);
      } else {
        voiceLayer.append(group);
      }
    }

    reconcileVoice(group, voice, defs, overlapping.has(voice.id));
    group.classList.toggle('muted', soloVoiceId !== undefined && voice.id !== soloVoiceId);
    prevGroup = group;
  }
}

// ---- Selection UI ----

function renderVoiceSelection(selectionLayer: SVGGElement, voice: Voice, isTouch: boolean): void {
  const ui = get(voice.waveform).ui;
  const rotDeg = voiceRotation(voice);
  const groupTransform = rotDeg !== 0 ? `rotate(${rotDeg}, ${voice.x}, ${voice.y})` : undefined;
  const strokeWidth = isTouch ? '0.003' : '0.002';
  const dashArray = '0.008 0.008';

  const makeOutline = ui.createSelectionElement
    ? () => ui.createSelectionElement!(voice)
    : () => ui.createSvgElement(voice);

  // Black shadow outline
  const shadow = makeOutline();
  setAttrs(shadow, {
    fill: 'none',
    stroke: '#000000',
    'stroke-dasharray': dashArray,
    'stroke-width': strokeWidth,
  });
  if (groupTransform) shadow.setAttribute('transform', groupTransform);
  selectionLayer.append(shadow);

  // White marching ants outline
  const ants = makeOutline();
  setAttrs(ants, {
    fill: 'none',
    stroke: '#ffffff',
    'stroke-dasharray': dashArray,
    'stroke-width': strokeWidth,
  });
  ants.style.animation = 'march 0.7s linear infinite';
  if (groupTransform) ants.setAttribute('transform', groupTransform);
  selectionLayer.append(ants);

  if (isTouch) return; // Touch: just the marching ants

  // Resize + rotation handles — fully owned by the UI delegate
  for (const handle of ui.selectionHandles(voice)) {
    if (groupTransform) handle.setAttribute('transform', groupTransform);
    selectionLayer.append(handle);
  }
}

function renderSelection(
  selectionLayer: SVGGElement,
  state: SigilData,
  selectedId: string | undefined,
): void {
  // Clear previous selection UI
  while (selectionLayer.firstChild) {
    selectionLayer.removeChild(selectionLayer.firstChild);
  }

  if (selectedId) {
    const voice = state.voices.find((v) => v.id === selectedId);
    if (voice) {
      renderVoiceSelection(selectionLayer, voice, lastInputWasTouch);
    }
  }
}

// ---- Main render ----

/**
 * Reconcile the SVG DOM to match the given sigil state. Creates, updates, and
 * removes voice shapes and selection UI elements.
 * @param svg - The root SVG element (viewBox 0 0 1 1)
 * @param state - Current sigil state to render
 * @param selectedId - ID of the currently selected voice, or undefined
 * @param soloVoiceId - ID of the soloed voice, or undefined; non-solo voices get a `muted` CSS class
 */
export function render(
  svg: SVGSVGElement,
  state: SigilData,
  selectedId: string | undefined,
  soloVoiceId?: string | undefined,
): void {
  const { defs, voiceLayer, selectionLayer } = ensureLayers(svg);

  // Ensure shared pattern defs exist
  if (!_patternDefsReady) {
    ensurePatternDefs(defs);
    _patternDefsReady = true;
  }

  // Reconcile voices
  reconcileVoices(voiceLayer, state.voices, defs, soloVoiceId);

  // Render selection UI (rebuilt each frame — cheap for SVG)
  renderSelection(selectionLayer, state, selectedId);
}
