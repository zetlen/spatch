// dom-helpers.ts — Toolbar-specific DOM construction helpers
//
// Builds on shared svgEl/setAttrs from dom.ts. Adds createIconButton
// and htmlEl which are only needed in toolbar panel code.

import { svgEl } from '../dom.ts';

export { svgEl };

/**
 * Create a button element with an SVG icon from the sprite sheet.
 * @param opts - Button configuration
 * @returns The button element with the SVG icon appended
 */
export function createIconButton(opts: {
  className: string;
  symbol: string;
  title?: string;
  size?: number;
  dataset?: Record<string, string>;
}): HTMLButtonElement {
  const size = opts.size ?? 20;
  const btn = document.createElement('button');
  btn.className = opts.className;
  if (opts.title) {
    btn.title = opts.title;
  }
  if (opts.dataset) {
    for (const [k, v] of Object.entries(opts.dataset)) {
      btn.dataset[k] = v;
    }
  }
  const svg = svgEl(
    'svg',
    { width: size, height: size },
    svgEl('use', { href: `#${opts.symbol}` }),
  );
  btn.append(svg);
  return btn;
}

/**
 * Create an HTML element with attributes and children.
 * @param tag - HTML element tag name
 * @param attrs - Attribute key-value pairs. 'className' and 'id' are set as
 *   properties; all others go through setAttribute.
 * @param children - Child elements or text strings to append
 * @returns The created HTML element
 */
export function htmlEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: (HTMLElement | SVGElement | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') {
      el.className = String(v);
    } else if (k === 'id') {
      el.id = String(v);
    } else if (k === 'title') {
      el.title = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      el.append(document.createTextNode(child));
    } else {
      el.append(child);
    }
  }
  return el;
}
