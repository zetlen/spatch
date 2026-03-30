// Dom-helpers.ts — Toolbar-specific DOM construction helpers

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
