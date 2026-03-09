# Embed Mode Design

Issue: #118

## Overview

Two deliverables: a reworked embed viewer (`embed.html`) and a share UI in the
main app for generating link/embed snippets.

## Embed Viewer

Self-contained HTML page loaded via iframe. Receives sigil state from URL hash.
No editing interactions — the only interaction is press-to-play.

### Visual

- Scene background image fills the entire embed edge to edge.
- Dark bevel gradient tile overlays the full area. Same gradient as the main
  app's tile, but colors ~30% more transparent so the scene bleeds through.
- SVG shapes rendered on top with all fills, patterns, borders, blend modes.
- ADSR corner radii applied to the outer container.
- Optional "spatch" text link at bottom center, linking to the full app with
  the same hash. Controlled by `?nolink` query param — present by default,
  hidden when the param is set.
- No visible play button. The entire tile is the touch/click target.
- Cursor: `pointer` to signal clickability.

### Interaction

- Press/click anywhere on the tile to play. Release to begin the release phase.
- Minimum 2 seconds of playback: if you tap (short press), it plays for 2s
  before releasing. If you hold longer than 2s, it plays until you release.
- No latch, no loop, no toggle. Simple press-and-hold with a minimum duration.

### Animations

**Gleam (load only):** A diagonal highlight sweeps across the tile like a
sunbeam crossing a surface. CSS pseudo-element with a linear gradient
(transparent → white at ~0.15 opacity → transparent), translated diagonally
across the tile. Fires once on load after assets are ready and the tile is
revealed.

**Press-down (play):** On pointer down, the whole tile scales down slightly
(~0.97) as though being pressed like a button. On pointer up / release, it
scales back to 1. CSS transition on `transform: scale()`.

### Audio

- Warm up AudioContext on first qualifying gesture (`touchend`, `click`,
  `keydown`) — same iOS Safari unlock strategy as main app.
- Load scene IR, set vibe from scene definition.
- `audio.play()` on pointer down. `audio.release()` on pointer up or after 2s
  minimum timer, whichever is later.

### Build

- Separate Vite entry point (multi-entry, as it is now).
- Shares core modules: `serialize.ts`, `canvas/render.ts`, `audio/engine.ts`,
  `scenes/`, `audio/vibe.ts`.
- Rewrite `embed.html` and `js/embed-entry.ts` from scratch.

## Share UI (Main App)

### Button

- Share button on the stage, upper left corner.
- Same style family as credits button (absolute positioned, icon, drop-shadow)
  but slightly larger (~52px vs 44px) and more opaque at rest (~0.5 vs 0.3).
- Only visible when `body.is-editing`.
- Icon: `tabler-share` or `tabler-link`.

### Panel

- Click share button opens a blur overlay covering the entire stage. Same
  treatment as credits overlay: `backdrop-filter: blur(12px)`, semi-transparent
  black background.
- Click anywhere on the overlay (outside interactive elements) to dismiss.
- Audio muffles while open (same as credits).

### Layout

Two sections: **Link** and **Embed**.

#### Link

- Read-only code block showing the full URL: `https://spatch.music/#ABC...`
- Copy button next to it.
- No other options.

#### Embed

- **Size slider**: continuous, sets pixel dimensions. Range ~150px–600px,
  default ~300px. Embed is always square.
- **"Show spatch link" checkbox**: default on. When off, adds `?nolink` to the
  embed URL so the attribution link is hidden.
- Read-only code block showing the generated `<iframe>` snippet. Updates live
  as slider/checkbox change:
  ```html
  <iframe src="https://spatch.music/embed.html#ABC..."
          width="300" height="300" style="border:none"></iframe>
  ```
- Copy button next to it.

### Behavior

- Hash is generated fresh from current `SigilStore` state via `serializeState()`
  when the share panel opens.
- Link and embed sections share the same hash.
