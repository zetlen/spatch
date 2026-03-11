import { beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

// Set up a DOM environment before importing the module under test
let createIconButton, svgEl;

beforeAll(async () => {
  const win = new Window();
  globalThis.document = win.document;
  globalThis.HTMLElement = win.window.HTMLElement;
  globalThis.SVGElement = win.window.SVGElement;
  globalThis.HTMLButtonElement = win.window.HTMLButtonElement;

  const mod = await import('../../js/toolbar/dom-helpers.ts');
  createIconButton = mod.createIconButton;
  svgEl = mod.svgEl;
});

// ---- createIconButton ----

describe('createIconButton', () => {
  test('creates a button element', () => {
    const btn = createIconButton({
      className: 'action-btn',
      symbol: 'tabler-ghost',
    });
    expect(btn.tagName).toBe('BUTTON');
  });

  test('sets className on the button', () => {
    const btn = createIconButton({
      className: 'action-btn',
      symbol: 'tabler-ghost',
    });
    expect(btn.className).toBe('action-btn');
  });

  test('sets title when provided', () => {
    const btn = createIconButton({
      className: 'action-btn',
      symbol: 'tabler-ghost',
      title: 'Soft Light',
    });
    expect(btn.title).toBe('Soft Light');
  });

  test('does not set title when omitted', () => {
    const btn = createIconButton({
      className: 'action-btn',
      symbol: 'tabler-ghost',
    });
    expect(btn.title).toBe('');
  });

  test('sets dataset properties', () => {
    const btn = createIconButton({
      className: 'action-btn',
      symbol: 'tabler-ghost',
      dataset: { blend: 'screen', foo: 'bar' },
    });
    expect(btn.dataset.blend).toBe('screen');
    expect(btn.dataset.foo).toBe('bar');
  });

  test('contains an SVG element with default size 20', () => {
    const btn = createIconButton({
      className: 'action-btn',
      symbol: 'tabler-ghost',
    });
    // Use children[0] instead of querySelector — happy-dom doesn't support
    // querySelector across namespace boundaries on detached elements.
    const svg = btn.children[0];
    expect(svg).not.toBeUndefined();
    expect(svg.tagName).toBe('svg');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
  });

  test('respects custom size', () => {
    const btn = createIconButton({
      className: 'action-btn',
      symbol: 'tabler-ghost',
      size: 16,
    });
    const svg = btn.children[0];
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
  });

  test('contains a use element with correct href', () => {
    const btn = createIconButton({
      className: 'action-btn',
      symbol: 'tabler-ghost',
    });
    const svg = btn.children[0];
    const use = svg.children[0];
    expect(use).not.toBeUndefined();
    expect(use.tagName).toBe('use');
    expect(use.getAttribute('href')).toBe('#tabler-ghost');
  });
});

// ---- svgEl ----

describe('svgEl', () => {
  test('creates an SVG element in the SVG namespace', () => {
    const rect = svgEl('rect', { x: 4, y: 4, width: 12, height: 12 });
    expect(rect.tagName).toBe('rect');
    expect(rect.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  test('sets attributes from the attrs object', () => {
    const rect = svgEl('rect', {
      x: 4,
      y: 4,
      width: 12,
      height: 12,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
    });
    expect(rect.getAttribute('x')).toBe('4');
    expect(rect.getAttribute('y')).toBe('4');
    expect(rect.getAttribute('width')).toBe('12');
    expect(rect.getAttribute('height')).toBe('12');
    expect(rect.getAttribute('fill')).toBe('none');
    expect(rect.getAttribute('stroke')).toBe('currentColor');
    expect(rect.getAttribute('stroke-width')).toBe('2');
  });

  test('coerces number values to strings', () => {
    const line = svgEl('line', { x1: 0, y1: 10, x2: 16, y2: 10 });
    expect(line.getAttribute('x1')).toBe('0');
    expect(line.getAttribute('y1')).toBe('10');
  });

  test('appends child elements', () => {
    const stop1 = svgEl('stop', { offset: '0%', 'stop-color': 'red' });
    const stop2 = svgEl('stop', { offset: '100%', 'stop-color': 'blue' });
    const grad = svgEl('linearGradient', { id: 'test-grad' }, stop1, stop2);
    expect(grad.children.length).toBe(2);
    expect(grad.children[0].getAttribute('stop-color')).toBe('red');
    expect(grad.children[1].getAttribute('stop-color')).toBe('blue');
  });

  test('works with no attrs and no children', () => {
    const g = svgEl('g');
    expect(g.tagName).toBe('g');
    expect(g.attributes.length).toBe(0);
    expect(g.children.length).toBe(0);
  });

  test('creates nested structures', () => {
    const svg = svgEl(
      'svg',
      { width: 20, height: 20 },
      svgEl('defs', {}, svgEl('linearGradient', { id: 'lg' }, svgEl('stop', { offset: '0%' }))),
      svgEl('rect', { x: 0, y: 0, width: 20, height: 20 }),
    );
    expect(svg.children.length).toBe(2);
    expect(svg.children[0].tagName).toBe('defs');
    // Traverse children directly instead of querySelector
    const defs = svg.children[0];
    const grad = defs.children[0];
    expect(grad).not.toBeUndefined();
    expect(grad.tagName).toBe('linearGradient');
    expect(grad.getAttribute('id')).toBe('lg');
  });
});
