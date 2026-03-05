# SVG Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the canvas-based renderer with inline SVG for retina crispness, code simplification, and CSS animation support. Remove the rough pattern and bitcrusher worklet.

**Architecture:** SVG with `viewBox="0 0 1 1"` uses normalized coords directly. DOM reconciler updates SVG element attributes on state change. Blend modes via CSS `isolation: isolate` + `mix-blend-mode`. Native pointer events on shapes for hit testing; algorithmic math for handles/ADSR.

**Tech Stack:** SVG DOM API, CSS mix-blend-mode, Bun test, Playwright

---

### Task 1: Remove rough pattern and bitcrusher worklet

Simplest change, reduces scope of later tasks. No rendering changes yet.

**Files:**
- Modify: `js/types.ts:40` (PatternType union)
- Modify: `js/effects.ts:5-24` (createEffect switch) and `js/effects.ts:163-189` (createBitcrusher)
- Modify: `js/audio.ts:386-394` (worklet registration)
- Modify: `js/serialize.ts:128-134` (effectMap)
- Modify: `js/toolbar.ts:110` (patterns array)
- Delete: `worklets/bitcrusher.js`

**Step 1: Remove 'rough' from PatternType**

In `js/types.ts:40`, change:
```typescript
export type PatternType = 'stripes' | 'checker' | 'noise' | 'gradient' | 'rough';
```
to:
```typescript
export type PatternType = 'stripes' | 'checker' | 'noise' | 'gradient';
```

**Step 2: Remove rough from pattern dropdown**

In `js/toolbar.ts`, remove the rough entry from the patterns array (line 110):
```typescript
      { value: 'rough', title: 'Rough' },
```

**Step 3: Remove bitcrusher from effects.ts**

In `js/effects.ts`, remove the rough case from the switch (lines 19-20):
```typescript
    case 'rough':
      return createBitcrusher(audioCtx, workletReady);
```

Delete the entire `createBitcrusher` function (lines 163-189).

Remove the `workletReady` parameter from `createEffect` signature (line 8) and update all callers. The signature becomes:
```typescript
export function createEffect(
  audioCtx: AudioContext,
  pattern: PatternType,
): AudioEffect | undefined {
```

**Step 4: Remove worklet registration from audio.ts**

In `js/audio.ts`, remove the bitcrusher worklet loading block (lines 386-394):
```typescript
    // Try to register bitcrusher worklet
    if (this.audioCtx.audioWorklet) {
      try {
        await this.audioCtx.audioWorklet.addModule('worklets/bitcrusher.js');
        this._workletReady = true;
      } catch {
        console.warn('AudioWorklet not available, using WaveShaper fallback');
      }
    }
```

Also remove the `_workletReady` field and any references to it in the class.

**Step 5: Remove 'r' from serialization**

In `js/serialize.ts:133`, remove:
```typescript
  r: 'rough',
```

**Step 6: Delete the worklet file**

```bash
rm worklets/bitcrusher.js
```

**Step 7: Run typecheck and tests**

```bash
bun run check
bun run test:unit
```

The `effects.test.js` tests should still pass since they test overlap math, not bitcrusher. The `serialize.test.js` may need a rough-related test removed if one exists.

**Step 8: Commit**

```bash
git add -A && git commit -m "Remove rough pattern and bitcrusher worklet"
```

---

### Task 2: Remove rough pattern rendering from patterns.ts

**Files:**
- Modify: `js/patterns.ts:89-108` (rough case in applyPattern)
- Modify: `js/patterns.ts:125-147` (remove private buildShapePath used only by rough)

**Step 1: Remove rough case from applyPattern**

In `js/patterns.ts`, delete lines 89-108 (the `if (pattern === 'rough')` block).

**Step 2: Remove the private buildShapePath function**

Delete `js/patterns.ts:125-147`. This function was only used by the rough pattern.

**Step 3: Run tests**

```bash
bun run check
bun run test:unit
```

**Step 4: Commit**

```bash
git add js/patterns.ts && git commit -m "Remove rough pattern rendering from patterns.ts"
```

---

### Task 3: Replace canvas element with SVG in HTML

**Files:**
- Modify: `index.html:112`
- Modify: `embed.html:69`
- Modify: `css/style.css:254-259`

**Step 1: Replace canvas with SVG in index.html**

Change line 112:
```html
<canvas id="sigil-canvas" width="800" height="800"></canvas>
```
to:
```html
<svg id="sigil-canvas" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet"></svg>
```

**Step 2: Replace canvas with SVG in embed.html**

Change line 69:
```html
<canvas id="c" width="800" height="800"></canvas>
```
to:
```html
<svg id="c" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet"></svg>
```

**Step 3: Update CSS for SVG element**

In `css/style.css`, replace the `#sigil-canvas` rule (lines 254-259):
```css
#sigil-canvas {
  position: relative;
  display: block;
  background: transparent;
  image-rendering: auto;
}
```
with:
```css
#sigil-canvas {
  position: relative;
  display: block;
  background: transparent;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
```

**Step 4: Commit**

```bash
git add index.html embed.html css/style.css && git commit -m "Replace canvas elements with SVG"
```

Note: The app will be broken after this task until canvas.ts is rewritten. That's expected.

---

### Task 4: Rewrite colors.ts for SVG compatibility

The current `getFillStyle` returns `CanvasGradient` objects for linear fills. SVG needs gradient definitions in `<defs>`. Split this into two functions: one for solid fill strings (unchanged), one for creating SVG gradient elements.

**Files:**
- Modify: `js/colors.ts:11-31`
- Modify: `tests/unit/colors.test.js`

**Step 1: Write tests for the new SVG fill functions**

Add to `tests/unit/colors.test.js`:
```javascript
describe('getSolidFillColor', () => {
  test('returns hsl string for solid fill', () => {
    const fill = { mode: 'solid', h: 200, s: 80, l: 50 };
    expect(getSolidFillColor(fill)).toBe('hsl(200, 80%, 50%)');
  });

  test('returns first color hsl for linear fill', () => {
    const fill = { mode: 'linear', h: 320, s: 90, l: 55, h2: 180, s2: 70, l2: 40, gradAngle: 45 };
    expect(getSolidFillColor(fill)).toBe('hsl(320, 90%, 55%)');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/unit/colors.test.js
```

**Step 3: Replace getFillStyle with SVG-compatible functions**

Replace the `getFillStyle` function in `js/colors.ts:11-31` with:

```typescript
/** Get the primary solid color for any fill (used for SVG fill attr on solid fills). */
export function getSolidFillColor(fill: Fill): string {
  return hslToString(fill.h, fill.s, fill.l);
}

/** Create or update an SVG <linearGradient> element for a linear fill. */
export function ensureLinearGradient(
  defs: SVGDefsElement,
  id: string,
  fill: LinearFill,
  shapeRotationDeg: number,
): void {
  let grad = defs.querySelector(`#${id}`) as SVGLinearGradientElement | undefined;
  if (!grad) {
    grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.id = id;
    grad.setAttribute('gradientUnits', 'objectBoundingBox');
    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%');
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%');
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
  }

  const angle = ((fill.gradAngle - shapeRotationDeg) * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Map unit-circle direction to 0-1 gradient coords
  grad.setAttribute('x1', String(0.5 - dx * 0.5));
  grad.setAttribute('y1', String(0.5 - dy * 0.5));
  grad.setAttribute('x2', String(0.5 + dx * 0.5));
  grad.setAttribute('y2', String(0.5 + dy * 0.5));

  const stops = grad.querySelectorAll('stop');
  stops[0]!.setAttribute('stop-color', hslToString(fill.h, fill.s, fill.l));
  stops[1]!.setAttribute('stop-color', hslToString(fill.h2, fill.s2, fill.l2));
}
```

Keep `hslToString` and `getSwatchColor` unchanged.

**Step 4: Run tests**

```bash
bun test tests/unit/colors.test.js
bun run check
```

**Step 5: Commit**

```bash
git add js/colors.ts tests/unit/colors.test.js && git commit -m "Add SVG-compatible fill functions to colors.ts"
```

---

### Task 5: Rewrite patterns.ts for SVG

Replace canvas tile-based patterns with SVG `<pattern>` elements in `<defs>`.

**Files:**
- Rewrite: `js/patterns.ts`

**Step 1: Rewrite patterns.ts**

Replace the entire file with SVG pattern definitions:

```typescript
// patterns.ts — SVG pattern definitions for visual overlays

import type { PatternType } from './types.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Ensure all pattern definitions exist in the given <defs> element. */
export function ensurePatternDefs(defs: SVGDefsElement): void {
  if (defs.querySelector('#pat-stripes')) return; // already defined

  // Stripes: repeating horizontal band
  const stripes = createPattern('pat-stripes', 0.0075, 0.0075);
  const stripesRect = document.createElementNS(SVG_NS, 'rect');
  stripesRect.setAttribute('width', '0.0075');
  stripesRect.setAttribute('height', '0.00375');
  stripesRect.setAttribute('fill', 'rgba(0,0,0,0.45)');
  stripes.appendChild(stripesRect);
  defs.appendChild(stripes);

  // Checker: 2x2 alternating squares
  const checker = createPattern('pat-checker', 0.01, 0.01);
  const cRect1 = document.createElementNS(SVG_NS, 'rect');
  cRect1.setAttribute('width', '0.005');
  cRect1.setAttribute('height', '0.005');
  cRect1.setAttribute('fill', 'rgba(0,0,0,0.35)');
  checker.appendChild(cRect1);
  const cRect2 = document.createElementNS(SVG_NS, 'rect');
  cRect2.setAttribute('x', '0.005');
  cRect2.setAttribute('y', '0.005');
  cRect2.setAttribute('width', '0.005');
  cRect2.setAttribute('height', '0.005');
  cRect2.setAttribute('fill', 'rgba(0,0,0,0.35)');
  checker.appendChild(cRect2);
  defs.appendChild(checker);

  // Noise: feTurbulence filter
  const noiseFilter = document.createElementNS(SVG_NS, 'filter');
  noiseFilter.id = 'pat-noise';
  noiseFilter.setAttribute('x', '0');
  noiseFilter.setAttribute('y', '0');
  noiseFilter.setAttribute('width', '100%');
  noiseFilter.setAttribute('height', '100%');
  const turb = document.createElementNS(SVG_NS, 'feTurbulence');
  turb.setAttribute('type', 'fractalNoise');
  turb.setAttribute('baseFrequency', '0.9');
  turb.setAttribute('numOctaves', '4');
  turb.setAttribute('seed', '1');
  turb.setAttribute('result', 'noise');
  noiseFilter.appendChild(turb);
  const colorMatrix = document.createElementNS(SVG_NS, 'feColorMatrix');
  colorMatrix.setAttribute('in', 'noise');
  colorMatrix.setAttribute('type', 'matrix');
  // Convert noise to black with variable alpha
  colorMatrix.setAttribute('values', '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.3 0');
  colorMatrix.setAttribute('result', 'darkNoise');
  noiseFilter.appendChild(colorMatrix);
  const composite = document.createElementNS(SVG_NS, 'feComposite');
  composite.setAttribute('in', 'darkNoise');
  composite.setAttribute('in2', 'SourceGraphic');
  composite.setAttribute('operator', 'atop');
  noiseFilter.appendChild(composite);
  defs.appendChild(noiseFilter);
}

function createPattern(id: string, width: number, height: number): SVGPatternElement {
  const pat = document.createElementNS(SVG_NS, 'pattern');
  pat.id = id;
  pat.setAttribute('patternUnits', 'userSpaceOnUse');
  pat.setAttribute('width', String(width));
  pat.setAttribute('height', String(height));
  return pat;
}

/**
 * Get the SVG attribute for applying a pattern to a shape.
 * Returns { attr, value } where attr is 'fill' or 'filter' depending on type.
 */
export function getPatternOverlay(pattern: PatternType): { attr: string; value: string } {
  switch (pattern) {
    case 'stripes':
      return { attr: 'fill', value: 'url(#pat-stripes)' };
    case 'checker':
      return { attr: 'fill', value: 'url(#pat-checker)' };
    case 'noise':
      return { attr: 'filter', value: 'url(#pat-noise)' };
    case 'gradient':
      // Gradient overlay is handled per-voice with a dedicated gradient def
      return { attr: 'fill', value: '' };
  }
}
```

**Step 2: Run typecheck**

```bash
bun run check
```

**Step 3: Commit**

```bash
git add js/patterns.ts && git commit -m "Rewrite patterns.ts for SVG pattern defs"
```

---

### Task 6: Rewrite canvas.ts as SVG DOM reconciler

This is the core task. Replace all canvas drawing with SVG DOM creation and updates.

**Files:**
- Rewrite: `js/canvas.ts`

**Step 1: Rewrite canvas.ts**

Replace the entire file. The new module:
- Exports `render(svg, state, selectedId, selectedDecoId)` — no canvasSize param
- Creates/updates SVG elements keyed by voice ID
- Uses `<defs>` for gradients and patterns
- Applies `mix-blend-mode` per voice
- Renders selection handles as SVG elements
- Uses safe DOM methods (no innerHTML) to clear and rebuild child elements

Key implementation notes:
- Use `while (el.firstChild) el.removeChild(el.firstChild)` instead of `el.innerHTML = ''` to clear elements safely
- Voice groups are keyed by `data-voice-id`, text elements by `data-deco-id`
- Selection UI is fully cleared and rebuilt each frame (it's cheap in SVG)
- Shape elements: `<circle>` for sine, `<rect>` for pulse, `<polygon>` for blend
- All coordinates in normalized 0-1 space (matching viewBox)

The render function signature changes from:
```typescript
export function render(ctx: CanvasRenderingContext2D, state: SigilData, canvasSize: number, selectedId: string | undefined, selectedDecoId?: string | undefined): void
```
to:
```typescript
export function render(svg: SVGSVGElement, state: SigilData, selectedId: string | undefined, selectedDecoId?: string | undefined): void
```

Also export `resetCache()` for embed use and `isLastInputTouch()` (unchanged).

See design doc `docs/plans/2026-03-03-svg-migration-design.md` for full architecture.

**Step 2: Run typecheck**

```bash
bun run check
```

Fix any type errors. The main issue will be callers that pass `ctx` and `canvasSize` — those are updated in the next task.

**Step 3: Commit**

```bash
git add js/canvas.ts && git commit -m "Rewrite canvas.ts as SVG DOM reconciler"
```

---

### Task 7: Update app.ts for SVG

This task wires the new SVG renderer into the app. Replace canvas init, coordinate conversion, hit testing, and render calls.

**Files:**
- Modify: `js/app.ts`

**Step 1: Replace canvas init with SVG**

Change lines 34-37:
```typescript
const canvas = document.getElementById('sigil-canvas') as HTMLCanvasElement;
const canvasFrame = document.getElementById('canvas-frame')!;
const ctx = canvas.getContext('2d')!;
const CANVAS_SIZE = 800;
```
to:
```typescript
const svg = document.getElementById('sigil-canvas') as unknown as SVGSVGElement;
const canvasFrame = document.getElementById('canvas-frame')!;
```

**Step 2: Replace coordinate conversion**

Replace `canvasCoordsFromClient` (lines 185-206) with:
```typescript
interface NormCoords {
  nx: number;
  ny: number;
}

function svgCoordsFromClient(clientX: number, clientY: number): NormCoords {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { nx: 0, ny: 0 };
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { nx: svgPt.x, ny: svgPt.y };
}

function svgCoords(e: PointerEvent): NormCoords {
  return svgCoordsFromClient(e.clientX, e.clientY);
}
```

**Step 3: Replace hit testing with native SVG events**

In the `pointerdown` handler (line 302+), replace the algorithmic shape hit testing.

Where it currently does:
```typescript
const hitId = hitTestShapes(store.data, px, py, CANVAS_SIZE);
```
replace with:
```typescript
const voiceEl = (e.target as Element).closest?.('[data-voice-id]');
const hitId = voiceEl ? (voiceEl as HTMLElement).dataset.voiceId ?? null : null;
```

Similarly for decoration hit testing, replace `hitTestDecorations` with:
```typescript
const decoEl = (e.target as Element).closest?.('[data-deco-id]');
const hitDecoId = decoEl ? (decoEl as HTMLElement).dataset.decoId ?? null : null;
```

For handle hit testing, replace `hitTestHandles` with:
```typescript
const handleEl = (e.target as Element).closest?.('[data-handle]');
const handle = handleEl ? (handleEl as HTMLElement).dataset.handle as HandleType ?? null : null;
```

**Step 4: Replace all px/py usage with nx/ny**

Since SVG coords are already normalized 0-1, there's no `px`/`py` distinction. The `nx`/`ny` values ARE the coordinates. Update all references:

- `isInClippedCorner(envelope, px, py, CANVAS_SIZE)` becomes `isInClippedCorner(envelope, nx, ny, 1)`
- `hitTestADSRCorner(envelope, px, py, CANVAS_SIZE)` becomes `hitTestADSRCorner(envelope, nx, ny, 1)`
- `calcResize(voice, handle, localDx, localDy, CANVAS_SIZE)` becomes `calcResize(voice, handle, localDx, localDy, 1)`
- `calcRotation(voice, px, py, CANVAS_SIZE)` becomes `calcRotation(voice, nx, ny, 1)`
- The ADSR drag helper `handleADSRDrag` and `envelopeValueToDist` change to use `canvasSize = 1`

**Step 5: Update render call**

Change:
```typescript
render(ctx, store.data, CANVAS_SIZE, selectedId, selectedDecoId);
```
to:
```typescript
render(svg, store.data, selectedId, selectedDecoId);
```

**Step 6: Update resizeCanvas**

Remove the canvas width/height/internal-resolution lines. The SVG scales automatically via CSS and `viewBox`. Keep the wrap sizing and frame updates:
```typescript
function resizeCanvas(): void {
  const area = document.getElementById('canvas-area')!;
  const maxH = area.clientHeight - 24;
  const maxW = area.clientWidth - 24;
  const size = Math.min(maxH, maxW, 800);

  const wrap = document.getElementById('canvas-wrap')!;
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';

  updateCanvasBorderRadius(canvasFrame, store.data.envelope, size);
  updateFrameShadow(canvasFrame, store.data.reverb, size, audio.getLevel());
  needsRender = true;
}
```

**Step 7: Update imports**

Remove imports of `hitTestShapes`, `hitTestHandles`, `hitTestDecorations`, `hitTestDecoHandles`, `getDecoBounds` from shapes.ts. Keep `hitTestADSRCorner`, `isInClippedCorner`, `calcResize`, `calcRotation`, `clampSize`.

**Step 8: Update the pinch-rotate handler**

The pinch-rotate code at line 320 currently calls `canvasCoordsFromClient` — replace with `svgCoordsFromClient`. The midpoint hit test replaces `hitTestShapes` with checking the SVG element under the midpoint (or just use `selectedId` as the fallback target, which the code already does).

**Step 9: Run typecheck**

```bash
bun run check
```

**Step 10: Commit**

```bash
git add js/app.ts && git commit -m "Wire SVG renderer into app.ts, replace canvas coord system"
```

---

### Task 8: Update shapes.ts — remove dead hit testing code

Now that app.ts uses native SVG hit testing for shapes and decorations, remove the dead code from shapes.ts.

**Files:**
- Modify: `js/shapes.ts`
- Modify: `tests/unit/shapes.test.js`

**Step 1: Remove dead functions from shapes.ts**

Delete:
- `hitTestShapes` (lines 38-52)
- `isPointInVoice` (lines 54-91)
- `pointInTriangle` (lines 93-106)
- `hitTestHandles` (lines 109-155) — handles are now SVG elements with `data-handle`
- `hitTestDecorations` (lines 280-300)
- `hitTestDecoHandles` (lines 303-325)
- `getDecoBounds` (lines 269-277) — SVG uses `getBBox()` natively

Keep:
- `clampSize` (line 24)
- `voiceRotation` (line 29) — still used by calcResize/calcRotation
- `isInClippedCorner` (line 163)
- `hitTestADSRCorner` (line 196)
- `calcResize` (line 220)
- `calcRotation` (line 253)
- Constants: `HANDLE_SIZE`, `ROT_HANDLE_OFFSET`, `MIN_SIZE`, `MAX_SIZE`

**Step 2: Update shapes.test.js**

Remove tests for `hitTestShapes` and `hitTestHandles`. Keep tests for `hitTestADSRCorner`, `calcResize`, `calcRotation`.

Remove imports of `hitTestShapes` and `hitTestHandles` from the test file.

**Step 3: Run tests**

```bash
bun run check
bun test tests/unit/shapes.test.js
```

**Step 4: Commit**

```bash
git add js/shapes.ts tests/unit/shapes.test.js && git commit -m "Remove canvas-era hit testing code from shapes.ts"
```

---

### Task 9: Update embed-entry.ts for SVG

**Files:**
- Modify: `js/embed-entry.ts`

**Step 1: Update embed to use SVG**

Replace canvas references with SVG. Key changes:
- `document.getElementById('c') as unknown as SVGSVGElement` instead of `HTMLCanvasElement`
- Remove `ctx = canvas.getContext('2d')!`
- Call `render(svg, sigil, null)` instead of `render(ctx, sigil, 800, null)`
- Render once instead of continuous `requestAnimationFrame` loop (embed is static)

**Step 2: Run typecheck**

```bash
bun run check
```

**Step 3: Commit**

```bash
git add js/embed-entry.ts && git commit -m "Update embed-entry.ts for SVG renderer"
```

---

### Task 10: Update integration tests

E2E tests reference `#sigil-canvas` which is now an SVG element. Selectors should still work, but interaction patterns may differ.

**Files:**
- Modify: `tests/integration/shape-placement.test.js`
- Modify: any other integration tests that reference `#sigil-canvas` or `canvas`

**Step 1: Check all integration tests for canvas references**

Search for `#sigil-canvas`, `canvas`, and `#c` in test files. The selector `#sigil-canvas` still matches the SVG element (same ID). But `page.locator('#sigil-canvas')` returns an SVG element now — `boundingBox()` should still work.

**Step 2: Run integration tests**

```bash
bun run dev
bun run test:e2e
```

Fix any failures. Likely issues:
- If tests check for canvas-specific attributes (width=800)
- If click coordinates need adjustment (unlikely since SVG scales the same way)

**Step 3: Commit fixes**

```bash
git add tests/ && git commit -m "Update integration tests for SVG renderer"
```

---

### Task 11: Build, manual test, and final cleanup

**Step 1: Build and typecheck**

```bash
bun run check
bun run build
```

**Step 2: Serve and manually verify**

```bash
bunx serve dist
```

Test in browser:
- [ ] Shapes render correctly (circle, square, triangle)
- [ ] Fill colors and gradients work
- [ ] Pattern overlays work (stripes, checker, noise, gradient)
- [ ] Blend modes work when shapes overlap
- [ ] Borders render correctly (single and double)
- [ ] Selection handles appear on click (desktop)
- [ ] Touch selection indicator appears (mobile/devtools)
- [ ] Drag, resize, and rotate work
- [ ] Text decorations render and are selectable
- [ ] ADSR corners draggable
- [ ] Play/latch/loop work
- [ ] Reverb shadow on frame works
- [ ] Embed page renders correctly
- [ ] Shapes are crisp on retina display
- [ ] Rough pattern button is gone from toolbar

**Step 3: Run all tests**

```bash
bun run test
```

**Step 4: Lint and format**

```bash
bun run lint
bun run fmt
```

**Step 5: Final commit**

```bash
git add -A && git commit -m "SVG migration: final cleanup and fixes"
```
