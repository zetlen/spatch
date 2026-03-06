// Canvas.ts — SVG DOM reconciler
//
// Creates, updates, and removes SVG elements to match SigilData.
// Elements are keyed by voice ID for efficient reconciliation.

import { setAttrs, svgEl } from '../dom.ts';
import { ensureLinearGradient, getSolidFillColor } from '../colors.ts';
import { ensurePatternDefs, getPatternOverlay } from '../patterns.ts';
import { voiceRotation } from '../shapes.ts';
import { type HandleType, type SigilData, type Voice, waveformShape } from '../types.ts';

// SVG viewBox units (0-1 space)
const HANDLE_SIZE = 0.006_25;
const ROT_HANDLE_OFFSET = 0.031_25;

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

// ---- Shape geometry ----

function circleAttrs(voice: Voice): Record<string, string> {
  const r = voice.size / 2;
  return { cx: String(voice.x), cy: String(voice.y), r: String(r) };
}

function rectAttrs(voice: Voice): Record<string, string> {
  const r = voice.size / 2;
  return {
    height: String(voice.size),
    width: String(voice.size),
    x: String(voice.x - r),
    y: String(voice.y - r),
  };
}

function trianglePoints(voice: Voice): string {
  const r = voice.size / 2;
  const pts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
    const px = voice.x + Math.cos(angle) * r;
    const py = voice.y + Math.sin(angle) * r;
    pts.push(`${px},${py}`);
  }
  return pts.join(' ');
}

function createShapeElement(voice: Voice): SVGElement {
  const shape = waveformShape(voice.waveform);
  switch (shape) {
    case 'circle': {
      const el = svgEl('circle');
      setAttrs(el, circleAttrs(voice));
      return el;
    }
    case 'square': {
      const el = svgEl('rect');
      setAttrs(el, rectAttrs(voice));
      return el;
    }
    case 'triangle': {
      const el = svgEl('polygon');
      el.setAttribute('points', trianglePoints(voice));
      return el;
    }
  }
}

function updateShapeElement(el: SVGElement, voice: Voice): void {
  const shape = waveformShape(voice.waveform);
  switch (shape) {
    case 'circle': {
      setAttrs(el, circleAttrs(voice));
      break;
    }
    case 'square': {
      setAttrs(el, rectAttrs(voice));
      break;
    }
    case 'triangle': {
      el.setAttribute('points', trianglePoints(voice));
      break;
    }
  }
}

function shapeTagName(voice: Voice): string {
  const shape = waveformShape(voice.waveform);
  switch (shape) {
    case 'circle': {
      return 'circle';
    }
    case 'square': {
      return 'rect';
    }
    case 'triangle': {
      return 'polygon';
    }
  }
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

function applyPatternOverlay(group: SVGGElement, voice: Voice, defs: SVGDefsElement): void {
  // Remove existing overlay elements (marked with data-overlay)
  const existing = group.querySelectorAll('[data-overlay]');
  for (const el of existing) {
    el.remove();
  }
  // Remove old gradient overlay def
  const oldGradOverlay = defs.querySelector(`#grad-overlay-${voice.id}`);
  if (oldGradOverlay) {
    oldGradOverlay.remove();
  }

  if (!voice.effect) {
    return;
  }

  const mainShape = group.querySelector('circle, rect, polygon') as SVGElement | undefined;
  if (!mainShape) {
    return;
  }

  if (voice.effect === 'noise') {
    // Apply noise filter directly to the main shape
    mainShape.setAttribute('filter', 'url(#pat-noise)');
    return;
  }
  mainShape.removeAttribute('filter');

  if (voice.effect === 'gradient') {
    // Create a per-voice gradient overlay
    const gradId = `grad-overlay-${voice.id}`;
    const grad = svgEl('linearGradient');
    grad.id = gradId;
    grad.setAttribute('gradientUnits', 'objectBoundingBox');
    grad.setAttribute('x1', '0');
    grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '1');
    grad.setAttribute('y2', '1');
    const stop1 = svgEl('stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', 'white');
    stop1.setAttribute('stop-opacity', '0.35');
    const stop2 = svgEl('stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', 'black');
    stop2.setAttribute('stop-opacity', '0.35');
    grad.append(stop1);
    grad.append(stop2);
    defs.append(grad);

    const overlay = createShapeElement(voice);
    overlay.setAttribute('fill', `url(#${gradId})`);
    overlay.dataset.overlay = 'true';
    const transform = voiceTransform(voice);
    if (transform) {
      overlay.setAttribute('transform', transform);
    }
    group.append(overlay);
    return;
  }

  // Stripes or checker: clone shape geometry with pattern fill
  const { value } = getPatternOverlay(voice.effect);
  if (!value) {
    return;
  }

  const overlay = createShapeElement(voice);
  overlay.setAttribute('fill', value);
  overlay.dataset.overlay = 'true';
  const transform = voiceTransform(voice);
  if (transform) {
    overlay.setAttribute('transform', transform);
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

function reconcileVoice(group: SVGGElement, voice: Voice, defs: SVGDefsElement): void {
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

  // Apply blend mode on the group
  group.style.mixBlendMode = voice.blend;

  // Apply rotation transform on the main shape (not group, since selection uses group position)
  const transform = voiceTransform(voice);
  if (transform) {
    shapeEl.setAttribute('transform', transform);
  } else {
    shapeEl.removeAttribute('transform');
  }

  // Apply fill
  applyFill(shapeEl, voice, defs);

  // Remove noise filter if not using noise pattern
  if (voice.effect !== 'noise') {
    shapeEl.removeAttribute('filter');
  }

  // Apply pattern overlay
  applyPatternOverlay(group, voice, defs);

  // Apply borders
  applyBorders(group, voice);
}

function reconcileVoices(voiceLayer: SVGGElement, voices: Voice[], defs: SVGDefsElement): void {
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
      const gradOverlay = defs.querySelector(`#grad-overlay-${id}`);
      if (gradOverlay) {
        gradOverlay.remove();
      }
    }
  }

  // Add or update groups for each voice (in order, so z-order matches array order)
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
    } else {
      // Ensure correct order
      const expectedNext: ChildNode | null = prevGroup
        ? prevGroup.nextSibling
        : voiceLayer.firstChild;
      if (group !== expectedNext) {
        if (prevGroup?.nextSibling) {
          prevGroup.nextSibling.before(group);
        } else {
          voiceLayer.prepend(group);
        }
      }
    }

    reconcileVoice(group, voice, defs);
    prevGroup = group;
  }
}

// ---- Selection UI ----

function createShapeOutline(voice: Voice): SVGElement {
  const shape = waveformShape(voice.waveform);
  switch (shape) {
    case 'circle': {
      const el = svgEl('circle');
      setAttrs(el, circleAttrs(voice));
      return el;
    }
    case 'square': {
      const el = svgEl('rect');
      setAttrs(el, rectAttrs(voice));
      return el;
    }
    case 'triangle': {
      const el = svgEl('polygon');
      el.setAttribute('points', trianglePoints(voice));
      return el;
    }
  }
}

function shapeHandlePositions(voice: Voice): [HandleType, number, number][] {
  const r = voice.size / 2;
  const shape = waveformShape(voice.waveform);
  switch (shape) {
    case 'circle': {
      return [
        ['e', voice.x + r, voice.y],
        ['n', voice.x, voice.y - r],
        ['w', voice.x - r, voice.y],
        ['s', voice.x, voice.y + r],
      ];
    }
    case 'square': {
      return [
        ['nw', voice.x - r, voice.y - r],
        ['ne', voice.x + r, voice.y - r],
        ['se', voice.x + r, voice.y + r],
        ['sw', voice.x - r, voice.y + r],
      ];
    }
    case 'triangle': {
      const positions: [HandleType, number, number][] = [];
      for (let i = 0; i < 3; i++) {
        const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
        const px = voice.x + Math.cos(angle) * r;
        const py = voice.y + Math.sin(angle) * r;
        const handle: HandleType = i === 0 ? 'n' : i === 1 ? 'se' : 'sw';
        positions.push([handle, px, py]);
      }
      return positions;
    }
  }
}

function renderVoiceSelection(selectionLayer: SVGGElement, voice: Voice, isTouch: boolean): void {
  const rotDeg = voiceRotation(voice);
  const groupTransform = rotDeg !== 0 ? `rotate(${rotDeg}, ${voice.x}, ${voice.y})` : undefined;
  const strokeWidth = isTouch ? '0.003' : '0.002';
  const dashArray = '0.008 0.008';

  // Black shadow outline
  const shadow = createShapeOutline(voice);
  setAttrs(shadow, {
    fill: 'none',
    stroke: '#000000',
    'stroke-dasharray': dashArray,
    'stroke-width': strokeWidth,
  });
  if (groupTransform) {
    shadow.setAttribute('transform', groupTransform);
  }
  selectionLayer.append(shadow);

  // White marching ants outline
  const ants = createShapeOutline(voice);
  setAttrs(ants, {
    fill: 'none',
    stroke: '#ffffff',
    'stroke-dasharray': dashArray,
    'stroke-width': strokeWidth,
  });
  ants.style.animation = 'march 0.7s linear infinite';
  if (groupTransform) {
    ants.setAttribute('transform', groupTransform);
  }
  selectionLayer.append(ants);

  if (isTouch) {
    return;
  } // Touch: just the marching ants

  // Resize handles at shape vertices/cardinal points
  const handlePositions = shapeHandlePositions(voice);
  for (const [handle, hx, hy] of handlePositions) {
    const rect = svgEl('rect');
    setAttrs(rect, {
      'data-handle': handle,
      fill: '#ffffff',
      height: String(HANDLE_SIZE * 2),
      stroke: '#2a2a2a',
      'stroke-width': '0.001',
      width: String(HANDLE_SIZE * 2),
      x: String(hx - HANDLE_SIZE),
      y: String(hy - HANDLE_SIZE),
    });
    if (groupTransform) {
      rect.setAttribute('transform', groupTransform);
    }
    selectionLayer.append(rect);
  }

  // Rotation handle (not for sine)
  if (voice.waveform !== 'sine') {
    const r = voice.size / 2;
    const rotHandleY = voice.y - r - ROT_HANDLE_OFFSET;

    // Stem line
    const line = svgEl('line');
    setAttrs(line, {
      stroke: 'rgba(255,255,255,0.4)',
      'stroke-width': '0.001',
      x1: String(voice.x),
      x2: String(voice.x),
      y1: String(voice.y - r),
      y2: String(rotHandleY),
    });
    if (groupTransform) {
      line.setAttribute('transform', groupTransform);
    }
    selectionLayer.append(line);

    // Handle circle
    const circle = svgEl('circle');
    setAttrs(circle, {
      cx: String(voice.x),
      cy: String(rotHandleY),
      'data-handle': 'rotate',
      fill: '#888888',
      r: String(HANDLE_SIZE * 1.2),
      stroke: '#2a2a2a',
      'stroke-width': '0.001',
    });
    if (groupTransform) {
      circle.setAttribute('transform', groupTransform);
    }
    selectionLayer.append(circle);
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

  const isTouch = lastInputWasTouch;

  if (selectedId) {
    const voice = state.voices.find((v) => v.id === selectedId);
    if (voice) {
      renderVoiceSelection(selectionLayer, voice, isTouch);
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
 */
export function render(svg: SVGSVGElement, state: SigilData, selectedId: string | undefined): void {
  const { defs, voiceLayer, selectionLayer } = ensureLayers(svg);

  // Ensure shared pattern defs exist
  if (!_patternDefsReady) {
    ensurePatternDefs(defs);
    _patternDefsReady = true;
  }

  // Reconcile voices
  reconcileVoices(voiceLayer, state.voices, defs);

  // Render selection UI (rebuilt each frame — cheap for SVG)
  renderSelection(selectionLayer, state, selectedId);
}
