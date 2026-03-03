# Stage Themes Design

**Date:** 2026-03-03
**Status:** Design

## Summary

The "stage" — the area between the toolbars but outside the canvas frame
(`#canvas-area`) — is currently flat warm gray (`#e8e4e0`). This feature adds
user-selectable cosmetic themes to the stage with a vaporwave/liminal aesthetic.

Stage themes are purely cosmetic. They do not affect `SigilData`, audio, or
serialization. The bijection principle does not apply.

## Modes

Three modes, cycled by a single button:

| Mode       | Description |
|------------|-------------|
| **Minimal** | Current look — flat warm gray, no decoration. |
| **Subtle**  | Soft pastel gradient (pink → lavender → teal), faint horizontal scan lines. |
| **Florid**  | Background image from a curated library, pastel gradient overlay, scan lines. |

All modes gain reactive behavior automatically during playback: the gradient
overlay hue-rotates and scan lines drift, driven by the existing per-frame
`audioLevel` value from the AnalyserNode. No separate "reactive" mode.

## Cycle Behavior

The stage button cycles: **minimal → subtle → florid(image 1) → minimal →
subtle → florid(image 2) → ...**

Each complete cycle through all three modes advances the florid background to
the next image in the library. The current position (mode + image index) is
persisted to `localStorage` so it survives reload.

## Image Library

Seven images ship in a `stage/` directory in the build output:

| Filename            | Description                                    |
|---------------------|------------------------------------------------|
| `blue-hall.jpg`     | Curving empty corridor, soft blue and beige    |
| `cloud-carpet.jpg`  | Hotel hallway with cloud mural, dotted carpet  |
| `excel-flyer.jpg`   | Retro wireframe landscape, magenta/cyan        |
| `g-block.jpg`       | Sunlit brutalist geometry, warm ochre           |
| `parking-elevator.jpg` | Rooftop elevator booth at night, cool concrete |
| `shoe-dept.jpg`     | Dead mall interior, Shoe Dept. sign            |
| `tile-towers.jpg`   | Pink tiled pool with columns, pastel sky       |

Images are served as-is (JPEG, already reasonably sized at 30–390 KB). They are
set as `background-image` on `#canvas-area::before` with `background-size:
cover` and `background-position: center`.

A semi-transparent pastel gradient is composited on top via
`#canvas-area::after` to unify the color palette regardless of source image.

## CSS Architecture

Each mode is a CSS class on `#canvas-area`: `.stage-minimal`, `.stage-subtle`,
`.stage-florid`.

### Pseudo-element layers

```
#canvas-area            — base background (minimal gray or transparent)
  ::before              — background image (florid only) or gradient (subtle)
  ::after               — scan lines overlay + pastel gradient tint
  #canvas-wrap          — the actual instrument (above both layers)
```

Both pseudo-elements are `position: absolute; inset: 0; pointer-events: none;
z-index: 0`. `#canvas-wrap` has `position: relative; z-index: 1` to sit above.

### Reactive behavior

`updateFrameShadow` in `app.ts` already runs every frame during playback and
has access to `audio.getLevel()`. It will additionally set a CSS custom property
`--audio-level` (0–1) on `#canvas-area`. CSS uses this to drive:

- `filter: hue-rotate(calc(var(--audio-level) * 30deg))` on the gradient overlay
- `transform: translateY(calc(var(--audio-level) * 4px))` on the scan lines

When not playing, `--audio-level` is 0 and no visual change occurs.

### Scan lines

Implemented as a `repeating-linear-gradient` on `::after`:

```css
repeating-linear-gradient(
  transparent 0px,
  transparent 2px,
  rgba(0, 0, 0, 0.03) 2px,
  rgba(0, 0, 0, 0.03) 4px
)
```

Subtle enough to read as texture, not as a rendering artifact.

## Button

A cycle button in the top toolbar's `play-group`, after the share button. Uses
a Tabler icon (`tabler-photo` or similar scene/landscape icon). Each tap:

1. Advances to the next mode in the cycle.
2. If wrapping from florid back to minimal, increments the image index (mod
   library length).
3. Updates `localStorage` with the new mode + image index.
4. Swaps the CSS class on `#canvas-area`.
5. If entering florid, sets `background-image` on `::before` via a CSS custom
   property `--stage-bg` or inline style.

The button's `title` attribute updates to show the current mode name.

## Persistence

```
localStorage key: "stage-theme"
value: JSON string { mode: 0|1|2, imageIndex: number }
```

Read on app init, applied before first render. Default is mode 0 (minimal),
image index 0.

## Build

The `spatch-bgs/` source directory is copied to `dist/stage/` by the build
script. No processing — images ship as-is. The image filename list is hardcoded
in the JS module that manages stage themes (a small array of strings).

## Non-goals

- No image upload or custom backgrounds.
- No per-sigil stage theme (it's a user preference, not part of state).
- No animated transitions between modes (just a class swap; CSS handles any
  transition if desired).
- No interaction between stage theme and audio/canvas/serialization.
