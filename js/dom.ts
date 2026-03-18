// dom.ts — Shared DOM helpers (HTML + SVG)

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Type-safe querySelector with runtime check. Throws if element not found. */
export function qel<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const el = root.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Element not found: ${selector}`);
  }
  return el;
}

/**
 * Create an SVG element with attributes and optional children.
 * @param tag - SVG element tag name
 * @param attrs - Attribute key-value pairs (values coerced to strings)
 * @param children - Child SVG elements to append
 * @returns The created SVG element
 */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  if (children.length > 0) {
    el.append(...children);
  }
  return el;
}

/** Set multiple attributes on an SVG element. */
export function setAttrs(el: SVGElement, attrs: Record<string, string | number>): void {
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
}

// ---- Selection handle constants and factories ----

/** Size of selection resize handle squares in SVG units (0–1 space). */
export const HANDLE_SIZE = 0.006_25;

/** Distance from the shape's topmost point to the rotation handle circle center. */
export const ROT_HANDLE_OFFSET = 0.031_25;

/** Create a resize handle square at the given position with data-handle set. */
export function resizeHandleEl(type: string, x: number, y: number): SVGRectElement {
  return svgEl('rect', {
    'data-handle': type,
    fill: '#ffffff',
    height: HANDLE_SIZE * 2,
    stroke: '#2a2a2a',
    'stroke-width': '0.001',
    width: HANDLE_SIZE * 2,
    x: x - HANDLE_SIZE,
    y: y - HANDLE_SIZE,
  });
}

/** Create the stem line and circle for a rotation handle above the shape's top point. */
export function rotationHandleEls(cx: number, shapeTopY: number): SVGElement[] {
  const handleY = shapeTopY - ROT_HANDLE_OFFSET;
  return [
    svgEl('line', {
      stroke: 'rgba(255,255,255,0.4)',
      'stroke-width': '0.001',
      x1: cx,
      x2: cx,
      y1: shapeTopY,
      y2: handleY,
    }),
    svgEl('circle', {
      cx,
      cy: handleY,
      'data-handle': 'rotate',
      fill: '#888888',
      r: HANDLE_SIZE * 1.2,
      stroke: '#2a2a2a',
      'stroke-width': '0.001',
    }),
  ];
}
