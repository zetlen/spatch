// canvas.ts — SVG DOM reconciler
//
// Creates, updates, and removes SVG elements to match SigilData.
// Elements are keyed by voice ID for efficient reconciliation.

import { getSolidFillColor, ensureLinearGradient } from './colors.ts';
import { ensurePatternDefs, getPatternOverlay } from './patterns.ts';
import { voiceRotation } from './shapes.ts';
import type { Voice, TextDecoration, SigilData, HandleType } from './types.ts';
import { waveformShape } from './types.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

// SVG viewBox units (0-1 space)
const HANDLE_SIZE = 0.00625;
const ROT_HANDLE_OFFSET = 0.03125;

// ---- Touch tracking ----

let lastInputWasTouch = false;
window.addEventListener(
  'pointerdown',
  (e) => {
    lastInputWasTouch = e.pointerType === 'touch';
  },
  true,
);

// ---- Reconciler state ----

let _voiceLayer: SVGGElement | null = null;
let _textLayer: SVGGElement | null = null;
let _selectionLayer: SVGGElement | null = null;
let _defs: SVGDefsElement | null = null;
let _patternDefsReady = false;

/** Reset internal cache — call when switching SVG roots (e.g. embed). */
export function resetCache(): void {
  _voiceLayer = null;
  _textLayer = null;
  _selectionLayer = null;
  _defs = null;
  _patternDefsReady = false;
}

// ---- SVG element helpers ----

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
}

function setAttrs(el: SVGElement, attrs: Record<string, string>): void {
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
}

// ---- Layer bootstrapping ----

function ensureLayers(svg: SVGSVGElement): {
  defs: SVGDefsElement;
  voiceLayer: SVGGElement;
  textLayer: SVGGElement;
  selectionLayer: SVGGElement;
} {
  if (_voiceLayer && _textLayer && _selectionLayer && _defs) {
    return {
      defs: _defs,
      voiceLayer: _voiceLayer,
      textLayer: _textLayer,
      selectionLayer: _selectionLayer,
    };
  }

  // Find or create <defs>
  let defs = svg.querySelector('defs') as SVGDefsElement | null;
  if (!defs) {
    defs = svgEl('defs');
    svg.prepend(defs);
  }

  // Find or create voice layer (first <g> with isolation)
  let voiceLayer = svg.querySelector('g[data-layer="voices"]') as SVGGElement | null;
  if (!voiceLayer) {
    voiceLayer = svgEl('g');
    voiceLayer.setAttribute('data-layer', 'voices');
    voiceLayer.style.isolation = 'isolate';
    svg.appendChild(voiceLayer);
  }

  // Find or create text layer
  let textLayer = svg.querySelector('g[data-layer="texts"]') as SVGGElement | null;
  if (!textLayer) {
    textLayer = svgEl('g');
    textLayer.setAttribute('data-layer', 'texts');
    svg.appendChild(textLayer);
  }

  // Find or create selection layer
  let selectionLayer = svg.querySelector('g[data-layer="selection"]') as SVGGElement | null;
  if (!selectionLayer) {
    selectionLayer = svgEl('g');
    selectionLayer.setAttribute('data-layer', 'selection');
    svg.appendChild(selectionLayer);
  }

  _defs = defs;
  _voiceLayer = voiceLayer;
  _textLayer = textLayer;
  _selectionLayer = selectionLayer;

  return { defs, voiceLayer, textLayer, selectionLayer };
}

// ---- Shape geometry ----

function circleAttrs(voice: Voice): Record<string, string> {
  const r = voice.size / 2;
  return { cx: String(voice.x), cy: String(voice.y), r: String(r) };
}

function rectAttrs(voice: Voice): Record<string, string> {
  const r = voice.size / 2;
  return {
    x: String(voice.x - r),
    y: String(voice.y - r),
    width: String(voice.size),
    height: String(voice.size),
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
    case 'circle':
      setAttrs(el, circleAttrs(voice));
      break;
    case 'square':
      setAttrs(el, rectAttrs(voice));
      break;
    case 'triangle':
      el.setAttribute('points', trianglePoints(voice));
      break;
  }
}

function shapeTagName(voice: Voice): string {
  const shape = waveformShape(voice.waveform);
  switch (shape) {
    case 'circle':
      return 'circle';
    case 'square':
      return 'rect';
    case 'triangle':
      return 'polygon';
  }
}

// ---- Transform for rotation ----

function voiceTransform(voice: Voice): string | null {
  const rotDeg = voiceRotation(voice);
  if (rotDeg === 0) return null;
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
    if (oldGrad) oldGrad.remove();
  }
}

// ---- Pattern overlays ----

function applyPatternOverlay(group: SVGGElement, voice: Voice, defs: SVGDefsElement): void {
  // Remove existing overlay elements (marked with data-overlay)
  const existing = group.querySelectorAll('[data-overlay]');
  for (const el of existing) el.remove();
  // Remove old gradient overlay def
  const oldGradOverlay = defs.querySelector(`#grad-overlay-${voice.id}`);
  if (oldGradOverlay) oldGradOverlay.remove();

  if (!voice.effect) return;

  const mainShape = group.querySelector('circle, rect, polygon') as SVGElement | null;
  if (!mainShape) return;

  if (voice.effect === 'noise') {
    // Apply noise filter directly to the main shape
    mainShape.setAttribute('filter', 'url(#pat-noise)');
    return;
  } else {
    mainShape.removeAttribute('filter');
  }

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
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);

    const overlay = createShapeElement(voice);
    overlay.setAttribute('fill', `url(#${gradId})`);
    overlay.setAttribute('data-overlay', 'true');
    const transform = voiceTransform(voice);
    if (transform) overlay.setAttribute('transform', transform);
    group.appendChild(overlay);
    return;
  }

  // Stripes or checker: clone shape geometry with pattern fill
  const { value } = getPatternOverlay(voice.effect);
  if (!value) return;

  const overlay = createShapeElement(voice);
  overlay.setAttribute('fill', value);
  overlay.setAttribute('data-overlay', 'true');
  const transform = voiceTransform(voice);
  if (transform) overlay.setAttribute('transform', transform);
  group.appendChild(overlay);
}

// ---- Borders ----

function applyBorders(group: SVGGElement, voice: Voice): void {
  // Remove existing border elements
  const existing = group.querySelectorAll('[data-border]');
  for (const el of existing) el.remove();

  if (!voice.border) return;

  const r = voice.size / 2;
  const maxW = r * 0.12;
  const w = Math.max(0.001, voice.border.thickness * maxW);

  // Outer border
  const outerBorder = createShapeElement(voice);
  outerBorder.setAttribute('fill', 'none');
  outerBorder.setAttribute('stroke', voice.border.color);
  outerBorder.setAttribute('stroke-width', String(w));
  outerBorder.setAttribute('data-border', 'outer');
  const transform = voiceTransform(voice);
  if (transform) outerBorder.setAttribute('transform', transform);
  group.appendChild(outerBorder);

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
      innerBorder.setAttribute('data-border', 'inner');
      if (transform) innerBorder.setAttribute('transform', transform);
      group.appendChild(innerBorder);
    }
  }
}

// ---- Voice reconciliation ----

function reconcileVoice(group: SVGGElement, voice: Voice, defs: SVGDefsElement): void {
  const expectedTag = shapeTagName(voice);

  // Get or create the main shape element (first child that isn't an overlay/border)
  let shapeEl = group.querySelector(
    ':scope > :not([data-overlay]):not([data-border])',
  ) as SVGElement | null;

  if (!shapeEl || shapeEl.tagName.toLowerCase() !== expectedTag) {
    // Shape type changed or first render — rebuild main shape
    if (shapeEl) shapeEl.remove();
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
    const id = g.getAttribute('data-voice-id')!;
    if (!voiceIds.has(id)) {
      g.remove();
      // Clean up gradient defs
      const grad = defs.querySelector(`#grad-${id}`);
      if (grad) grad.remove();
      const gradOverlay = defs.querySelector(`#grad-overlay-${id}`);
      if (gradOverlay) gradOverlay.remove();
    }
  }

  // Add or update groups for each voice (in order, so z-order matches array order)
  let prevGroup: SVGGElement | null = null;
  for (const voice of voices) {
    let group = voiceLayer.querySelector<SVGGElement>(`g[data-voice-id="${voice.id}"]`);
    if (!group) {
      group = svgEl('g');
      group.setAttribute('data-voice-id', voice.id);
      // Insert after previous sibling to maintain order
      if (prevGroup && prevGroup.nextSibling) {
        voiceLayer.insertBefore(group, prevGroup.nextSibling);
      } else if (!prevGroup) {
        voiceLayer.prepend(group);
      } else {
        voiceLayer.appendChild(group);
      }
    } else {
      // Ensure correct order
      const expectedNext: ChildNode | null = prevGroup
        ? prevGroup.nextSibling
        : voiceLayer.firstChild;
      if (group !== expectedNext) {
        if (prevGroup) {
          voiceLayer.insertBefore(group, prevGroup.nextSibling);
        } else {
          voiceLayer.prepend(group);
        }
      }
    }

    reconcileVoice(group, voice, defs);
    prevGroup = group;
  }
}

// ---- Text reconciliation ----

function reconcileTexts(textLayer: SVGGElement, texts: TextDecoration[]): void {
  const textIds = new Set(texts.map((t) => t.id));

  // Remove deleted texts
  const existingTexts = textLayer.querySelectorAll<SVGTextElement>(':scope > text[data-deco-id]');
  for (const el of existingTexts) {
    const id = el.getAttribute('data-deco-id')!;
    if (!textIds.has(id)) {
      el.remove();
    }
  }

  // Add or update texts
  for (const text of texts) {
    let el = textLayer.querySelector<SVGTextElement>(`text[data-deco-id="${text.id}"]`);
    if (!el) {
      el = svgEl('text');
      el.setAttribute('data-deco-id', text.id);
      el.setAttribute('fill', 'black');
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('dominant-baseline', 'central');
      el.setAttribute('font-family', "'Imbue', serif");
      textLayer.appendChild(el);
    }

    el.setAttribute('x', String(text.x));
    el.setAttribute('y', String(text.y));
    el.setAttribute('font-size', String(text.size));
    if (el.textContent !== text.text) {
      el.textContent = text.text;
    }
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
    case 'circle':
      return [
        ['e', voice.x + r, voice.y],
        ['n', voice.x, voice.y - r],
        ['w', voice.x - r, voice.y],
        ['s', voice.x, voice.y + r],
      ];
    case 'square':
      return [
        ['nw', voice.x - r, voice.y - r],
        ['ne', voice.x + r, voice.y - r],
        ['se', voice.x + r, voice.y + r],
        ['sw', voice.x - r, voice.y + r],
      ];
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
    'stroke-width': strokeWidth,
    'stroke-dasharray': dashArray,
  });
  if (groupTransform) shadow.setAttribute('transform', groupTransform);
  selectionLayer.appendChild(shadow);

  // White marching ants outline
  const ants = createShapeOutline(voice);
  setAttrs(ants, {
    fill: 'none',
    stroke: '#ffffff',
    'stroke-width': strokeWidth,
    'stroke-dasharray': dashArray,
  });
  ants.style.animation = 'march 0.7s linear infinite';
  if (groupTransform) ants.setAttribute('transform', groupTransform);
  selectionLayer.appendChild(ants);

  if (isTouch) return; // Touch: just the marching ants

  // Resize handles at shape vertices/cardinal points
  const handlePositions = shapeHandlePositions(voice);
  for (const [handle, hx, hy] of handlePositions) {
    const rect = svgEl('rect');
    setAttrs(rect, {
      x: String(hx - HANDLE_SIZE),
      y: String(hy - HANDLE_SIZE),
      width: String(HANDLE_SIZE * 2),
      height: String(HANDLE_SIZE * 2),
      fill: '#ffffff',
      stroke: '#2a2a2a',
      'stroke-width': '0.001',
      'data-handle': handle,
    });
    if (groupTransform) rect.setAttribute('transform', groupTransform);
    selectionLayer.appendChild(rect);
  }

  // Rotation handle (not for sine)
  if (voice.waveform !== 'sine') {
    const r = voice.size / 2;
    const rotHandleY = voice.y - r - ROT_HANDLE_OFFSET;

    // Stem line
    const line = svgEl('line');
    setAttrs(line, {
      x1: String(voice.x),
      y1: String(voice.y - r),
      x2: String(voice.x),
      y2: String(rotHandleY),
      stroke: 'rgba(255,255,255,0.4)',
      'stroke-width': '0.001',
    });
    if (groupTransform) line.setAttribute('transform', groupTransform);
    selectionLayer.appendChild(line);

    // Handle circle
    const circle = svgEl('circle');
    setAttrs(circle, {
      cx: String(voice.x),
      cy: String(rotHandleY),
      r: String(HANDLE_SIZE * 1.2),
      fill: '#888888',
      stroke: '#2a2a2a',
      'stroke-width': '0.001',
      'data-handle': 'rotate',
    });
    if (groupTransform) circle.setAttribute('transform', groupTransform);
    selectionLayer.appendChild(circle);
  }
}

function renderDecoSelection(
  selectionLayer: SVGGElement,
  text: TextDecoration,
  isTouch: boolean,
): void {
  // Use the SVG text element's BBox for accurate bounds
  const textEl = _textLayer?.querySelector<SVGTextElement>(`text[data-deco-id="${text.id}"]`);
  if (!textEl) return;

  let bbox: DOMRect;
  try {
    bbox = textEl.getBBox();
  } catch {
    // getBBox can throw if element is not rendered
    return;
  }

  if (bbox.width === 0 && bbox.height === 0) return;

  // Dashed bounding rect
  const dashRect = svgEl('rect');
  setAttrs(dashRect, {
    x: String(bbox.x),
    y: String(bbox.y),
    width: String(bbox.width),
    height: String(bbox.height),
    fill: 'none',
    stroke: 'rgba(255,255,255,0.5)',
    'stroke-width': isTouch ? '0.002' : '0.0015',
    'stroke-dasharray': isTouch ? '0.008 0.008' : '0.005 0.005',
  });
  selectionLayer.appendChild(dashRect);

  if (isTouch) return;

  // Corner resize handles
  const corners: [HandleType, number, number][] = [
    ['nw', bbox.x, bbox.y],
    ['ne', bbox.x + bbox.width, bbox.y],
    ['se', bbox.x + bbox.width, bbox.y + bbox.height],
    ['sw', bbox.x, bbox.y + bbox.height],
  ];

  for (const [handle, hx, hy] of corners) {
    const rect = svgEl('rect');
    setAttrs(rect, {
      x: String(hx - HANDLE_SIZE),
      y: String(hy - HANDLE_SIZE),
      width: String(HANDLE_SIZE * 2),
      height: String(HANDLE_SIZE * 2),
      fill: '#ffffff',
      stroke: '#2a2a2a',
      'stroke-width': '0.001',
      'data-handle': handle,
    });
    selectionLayer.appendChild(rect);
  }
}

function renderSelection(
  selectionLayer: SVGGElement,
  state: SigilData,
  selectedId: string | null,
  selectedDecoId: string | null | undefined,
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

  if (selectedDecoId) {
    const text = state.texts.find((t) => t.id === selectedDecoId);
    if (text) {
      renderDecoSelection(selectionLayer, text, isTouch);
    }
  }
}

// ---- Main render ----

export function render(
  svg: SVGSVGElement,
  state: SigilData,
  selectedId: string | null,
  selectedDecoId?: string | null,
): void {
  const { defs, voiceLayer, textLayer, selectionLayer } = ensureLayers(svg);

  // Ensure shared pattern defs exist
  if (!_patternDefsReady) {
    ensurePatternDefs(defs);
    _patternDefsReady = true;
  }

  // Reconcile voices
  reconcileVoices(voiceLayer, state.voices, defs);

  // Reconcile text decorations
  reconcileTexts(textLayer, state.texts);

  // Render selection UI (rebuilt each frame — cheap for SVG)
  renderSelection(selectionLayer, state, selectedId, selectedDecoId);
}
