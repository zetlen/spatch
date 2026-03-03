# SVG Migration Design

**Date:** 2026-03-03
**Issue:** #95

## Decision

Replace the `<canvas>` renderer with inline SVG. The app draws fewer than 20
shapes — SVG is the right tool. Canvas stays available as a future overlay for
pixel-level effects if needed.

## Why

1. **Retina crispness.** Canvas is fixed at 800×800 pixels, soft on 2x displays.
   SVG is resolution-independent.
2. **Code reduction.** ~150 lines of hit-testing math deleted (barycentric,
   isPointInVoice). Offscreen blend canvas hack deleted. Pattern tile cache
   deleted. Net reduction ~200–300 lines.
3. **CSS animations.** Selection glow (#115), marching-ant selection borders,
   and the play gleam animation (#117) become declarative CSS — no per-frame JS.
4. **Devtools debugging.** Every shape is inspectable in the DOM.
5. **Path drawing future.** Custom `<path>` shapes are native SVG citizens with
   free hit testing, blend modes, and serialization.

## Architecture

### Coordinate System

`<svg viewBox="0 0 1 1">` — normalized 0–1 coordinates map directly. No more
`CANVAS_SIZE` constant or `* 800` / `/ 800` scaling anywhere.

### Layer Stack

```
#canvas-frame (div — background, border-radius, shadows, ADSR corners)
  └─ <svg viewBox="0 0 1 1">  (shapes, text, selection UI)
```

A `<canvas>` overlay can be added later for pixel effects without changing the
SVG layer.

### Rendering Model

The current canvas renderer clears and repaints every frame. The SVG renderer
is a **DOM reconciler**: it creates SVG elements when voices are added, removes
them when deleted, and updates attributes (position, size, rotation, fill) on
change. Elements are keyed by voice ID.

### Blend Modes

All voice elements live inside a `<g style="isolation: isolate">`. Each voice
element gets `mix-blend-mode: <voice.blend>` via inline style. This replaces
the offscreen `_blendCanvas` / `_blendCtx` hack entirely. All 7 current blend
modes (`soft-light`, `multiply`, `screen`, `overlay`, `color-burn`,
`difference`, `exclusion`) have direct CSS `mix-blend-mode` equivalents.

### Hit Testing — Hybrid

- **Shape selection**: Native SVG pointer events. Each voice `<g>` has
  `data-voice-id`. `pointerdown` checks `event.target.closest('[data-voice-id]')`.
  Eliminates `hitTestShapes`, `isPointInVoice`, and barycentric math.
- **Text selection**: Same pattern with `data-deco-id` on `<text>` elements.
- **Resize/rotate handles**: SVG elements with `data-handle` attributes,
  positioned around the selected shape. The handle *math* (`calcResize`,
  `calcRotation`) stays in `shapes.ts`.
- **ADSR corners**: Stays algorithmic — corners are on the frame div, not in
  SVG. `hitTestADSRCorner` unchanged.
- **Clipped corners**: `isInClippedCorner` unchanged.
- **Coordinate conversion**: `svg.getScreenCTM().inverse()` + `DOMPoint`
  replaces `canvasCoordsFromClient`.

### Shapes

| Voice     | SVG Element | Notes |
|-----------|-------------|-------|
| sine      | `<circle cx={x} cy={y} r={size/2}>` | No rotation |
| pulse     | `<rect>` centered at (x,y) | `transform="rotate(...)"` from timbre |
| blend     | `<polygon>` equilateral triangle | `transform="rotate(...)"` from timbre |

### Fills

- **Solid**: `fill="hsl(h, s%, l%)"`
- **Linear**: `<linearGradient>` in `<defs>`, `fill="url(#grad-{voiceId})"`

### Patterns (4 remaining — rough removed)

Each pattern is an SVG `<pattern>` element in `<defs>`. Applied as a clipped
overlay rect inside the voice group.

| Pattern  | SVG Implementation |
|----------|-------------------|
| stripes  | `<pattern>` with alternating rects |
| checker  | `<pattern>` with 2×2 rect grid |
| noise    | `<pattern>` with feTurbulence filter or pre-rendered tile |
| gradient | `<linearGradient>` overlay at 35% opacity |

### Borders

SVG `stroke` on the shape element. Double borders: two concentric strokes
(outer + inner). `stroke-width` scaled to normalized coords.

### Text Decorations

`<text>` elements with `fill="black"`. `getBBox()` available for precise hit
testing (improvement over current approximate character-width calculation).

### Selection UI

SVG elements (dashed rect, small handle rects/circles) appended when a shape
is selected. CSS classes for styling. Selection glow and marching ants via CSS
animation.

## Removals

| Item | Files Affected |
|------|---------------|
| Rough pattern | `types.ts`, `patterns.ts`, `effects.ts`, `serialize.ts`, `toolbar.ts` |
| Bitcrusher worklet | `worklets/bitcrusher.js` (delete), `audio.ts` (worklet registration) |
| Offscreen blend canvas | `canvas.ts` (`_blendCanvas`, `_blendCtx`, `getBlendCanvas`) |
| CANVAS_SIZE constant | `app.ts` and all call sites |
| Canvas pattern tile cache | `patterns.ts` (`getPatternTile`) |

Serialization: drop `'r'` from effect pack/unpack in `serialize.ts`. No
backwards compatibility per project rules.

## File Impact

| File | Change |
|------|--------|
| `canvas.ts` | **Rewrite** — SVG DOM reconciler |
| `shapes.ts` | **Shrink** — delete hitTestShapes, isPointInVoice, barycentric math; keep calcResize, calcRotation, hitTestADSRCorner, isInClippedCorner |
| `patterns.ts` | **Rewrite** — SVG `<pattern>` defs |
| `colors.ts` | **Edit** — getFillStyle returns SVG-compatible values |
| `app.ts` | **Edit** — SVG element setup, getScreenCTM coord conversion, data-voice-id hit detection, remove CANVAS_SIZE |
| `effects.ts` | **Edit** — remove bitcrusher/rough case |
| `audio.ts` | **Edit** — remove worklet registration |
| `serialize.ts` | **Edit** — remove 'r' from effect map |
| `types.ts` | **Edit** — remove 'rough' from PatternType |
| `toolbar.ts` | **Edit** — remove rough button |
| `index.html` | **Edit** — `<canvas>` → `<svg>` |
| `embed.html` | **Edit** — same |
| `embed-entry.ts` | **Edit** — update render call |
| `css/style.css` | **Edit** — SVG sizing, isolation group |
| `worklets/bitcrusher.js` | **Delete** |
| `interaction.ts` | No change |
| `state.ts` | No change |
| `envelope.ts` | No change |

## Future Extensibility

- **Pixel effects layer**: Overlay a `<canvas pointer-events="none">` on top
  of the SVG. Activated only when needed.
- **Path drawing**: Capture points → simplify (Ramer-Douglas-Peucker) → emit
  `<path d="...">`. Native SVG citizen with free hit testing and blend modes.
- **CSS transitions**: Shape position/size changes can animate smoothly with
  CSS transitions on SVG attributes (via `transition` on inline styles).
