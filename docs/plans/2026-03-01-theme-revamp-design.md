# Theme Revamp: Flat Hybrid-Bevel Aesthetic

Replaces the synthwave neon theme with a light, neutral UI. Subtle beveled
edges on buttons only; everything else flat. The dark canvas viewport is the
sole source of color. No accent colors in the chrome.

## Color Palette

### UI Chrome

| Token            | Value     | Usage                              |
| ---------------- | --------- | ---------------------------------- |
| `--bg-body`      | `#e8e4e0` | Body, canvas area surround         |
| `--bg-toolbar`   | `#d5d0cb` | Toolbars, button faces             |
| `--bg-panel`     | `#ddd8d3` | Floating panels                    |
| `--border`       | `#b8b3ad` | Flat borders, dividers             |
| `--bevel-hi`     | `#f0ece8` | Bevel highlight (top/left)         |
| `--bevel-lo`     | `#a8a39d` | Bevel shadow (bottom/right)        |
| `--text-primary` | `#2a2a2a` | Primary text                       |
| `--text-muted`   | `#7a7570` | Secondary labels                   |
| `--danger`       | `#cc3344` | Delete button, destructive actions |

### Canvas

| Value           | Usage                         |
| --------------- | ----------------------------- |
| `#2a2a2a`       | Canvas background (CANVAS_BG) |
| 2px inset bevel | Canvas frame (sunken well)    |

### Interactive States (No Accent Color)

- Hover: background darkens ~5% → `#ccc7c1`
- Active/pressed: bevel flips (shadow top/left, highlight bottom/right), background `#c5c0ba`
- Danger hover: `rgba(204, 51, 68, 0.12)` background

## Buttons & Controls

### Bevel Treatment (buttons only)

- Size: 36px (up from 32px)
- Background: `var(--bg-toolbar)`
- Border: 1px — `var(--bevel-hi)` top/left, `var(--bevel-lo)` bottom/right
- Hover: background `#ccc7c1`
- Pressed/active: bevel edges swap, background `#c5c0ba`
- Border-radius: 2px

### Selects

Same bevel treatment. Native dropdown arrow.

### Range Sliders

- Track: `var(--border)`
- Thumb: raised bevel like a button
- No accent-color override

### Play Button

- Same bevel, larger padding
- No gradient — flat surface
- Text: `#2a2a2a`, Orbitron bold
- Playing: bevel flips to sunken

### Swatch

- Dynamic fill color (unchanged)
- 1px inset bevel border (sunken display well)

## Canvas & Shape Chrome

### Shape Outlines

- Idle: single 1.5px stroke, `rgba(255,255,255,0.4)`
- Playing: single 2px stroke, `#ffffff` — no glow, no animation

### Selection Handles

- Dashed outline: `rgba(255,255,255,0.5)` (white, not cyan)
- Corner/edge handles: `#ffffff` fill, `#2a2a2a` stroke
- Rotation handle: `#888888` fill, `#2a2a2a` stroke
- Rotation stem: `rgba(255,255,255,0.4)`
- Text decoration handles: same white treatment (was yellow)

### Chromatic Guides

- Octave: `rgba(255,255,255,0.12)` dashed
- Non-octave: `rgba(255,255,255,0.04)` dashed

## Panels

- Background: `var(--bg-panel)`
- Border: `1px solid var(--border)`
- Box-shadow: `0 2px 8px rgba(0,0,0,0.15)`
- Border-radius: 2px
- Tab buttons, stop buttons, border controls: same bevel treatment

## Animations — All Removed

- Delete `@keyframes pulse-glow`
- Delete `@keyframes canvas-glow`
- Delete scanline overlay (`#canvas-wrap::after`)
- Delete all neon box-shadows
- Keep `transition` properties for hover/press responsiveness

## Play Fan

- Fan options: `var(--bg-toolbar)` background, bevel border
- Hot state: sunken bevel + darker fill (no cyan glow)

## Logo

- Plain `#2a2a2a` text. No gradient. Orbitron weight-900.
- Will be revisited later.

## Embed Page

- Same palette: `#e8e4e0` body, `#2a2a2a` canvas
- Play button: flat bevel, no gradient
- Inline styles updated to match

## Fonts

Unchanged. Keep Orbitron and Share Tech Mono.

## Scope

Files affected:

- `css/style.css` — complete palette replacement, bevel system, remove animations
- `js/canvas.ts` — CANVAS_BG, glow layers, selection handle colors
- `js/colors.ts` — angle dial accent colors
- `js/embed-entry.ts` — inline text color
- `embed.html` — inline styles
- `index.html` — no structural changes, just the frame for new styles
