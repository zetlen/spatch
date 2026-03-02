# Theme Revamp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the synthwave neon theme with a light, neutral hybrid-bevel aesthetic where shapes on the dark canvas are the only color.

**Architecture:** Pure CSS/canvas color changes — no structural HTML changes, no new JS modules. CSS custom properties are replaced wholesale. Canvas hardcoded colors are updated in `canvas.ts` and `colors.ts`. Embed page inline styles updated. All neon glow animations deleted.

**Tech Stack:** CSS custom properties, Canvas 2D API, HTML inline styles.

**Design doc:** `docs/plans/2026-03-01-theme-revamp-design.md`

---

### Task 1: Replace CSS custom properties and body/toolbar/panel base styles

**Files:**
- Modify: `css/style.css:5-19` (custom properties)
- Modify: `css/style.css:27-36` (body)
- Modify: `css/style.css:52-68` (toolbars)
- Modify: `css/style.css:83-93` (logo)

**Step 1: Replace CSS custom properties**

Replace the `:root` block (lines 5-19) with:

```css
:root {
  --bg-body: #e8e4e0;
  --bg-toolbar: #d5d0cb;
  --bg-panel: #ddd8d3;
  --border: #b8b3ad;
  --bevel-hi: #f0ece8;
  --bevel-lo: #a8a39d;
  --text-primary: #2a2a2a;
  --text-muted: #7a7570;
  --hover-bg: #ccc7c1;
  --active-bg: #c5c0ba;
  --danger: #cc3344;
}
```

**Step 2: Update body styles**

```css
body {
  background: var(--bg-body);
  color: var(--text-primary);
  /* rest unchanged */
}
```

**Step 3: Update toolbar styles**

```css
#toolbar-top,
#toolbar-bottom {
  background: var(--bg-toolbar);
  border-bottom: 1px solid var(--border);
  /* rest unchanged */
}

#toolbar-bottom {
  border-bottom: none;
  border-top: 1px solid var(--border);
  /* rest unchanged */
}
```

**Step 4: Update logo**

Replace the gradient text with plain color:

```css
.logo {
  font-family: 'Orbitron', sans-serif;
  font-weight: 900;
  font-size: 16px;
  color: var(--text-primary);
  letter-spacing: 2px;
  white-space: nowrap;
}
```

Remove the `background`, `-webkit-background-clip`, `-webkit-text-fill-color`, `background-clip` properties.

**Step 5: Verify build**

Run: `npx tsc --noEmit && bun run build`

**Step 6: Commit**

```
git add css/style.css
git commit -m "Replace CSS custom properties and base styles with neutral palette"
```

---

### Task 2: Restyle buttons with hybrid bevel

**Files:**
- Modify: `css/style.css:96-136` (button styles)
- Modify: `css/style.css:137-172` (play button, pulse-glow animation)

**Step 1: Update tool/action/pattern buttons**

```css
.tool-btn,
.action-btn,
.pattern-btn {
  background: var(--bg-toolbar);
  border-width: 1px;
  border-style: solid;
  border-color: var(--bevel-hi) var(--bevel-lo) var(--bevel-lo) var(--bevel-hi);
  color: var(--text-primary);
  width: 36px;
  height: 36px;
  border-radius: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: background 0.15s;
}

.tool-btn:hover,
.action-btn:hover,
.pattern-btn:hover {
  background: var(--hover-bg);
}

.tool-btn.active,
.pattern-btn.active {
  background: var(--active-bg);
  border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
}
```

**Step 2: Update danger button**

```css
.action-btn.danger {
  color: var(--danger);
}

.action-btn.danger:hover {
  background: rgba(204, 51, 68, 0.12);
}
```

**Step 3: Update play button**

```css
.play-btn {
  background: var(--bg-toolbar);
  border-width: 1px;
  border-style: solid;
  border-color: var(--bevel-hi) var(--bevel-lo) var(--bevel-lo) var(--bevel-hi);
  color: var(--text-primary);
  font-family: 'Orbitron', sans-serif;
  font-weight: 700;
  font-size: 13px;
  padding: 8px 20px;
  border-radius: 2px;
  cursor: pointer;
  letter-spacing: 2px;
  transition: background 0.15s;
}

.play-btn:hover {
  background: var(--hover-bg);
}

.play-btn.playing {
  background: var(--active-bg);
  border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
}
```

**Step 4: Delete `@keyframes pulse-glow`**

Remove the entire `@keyframes pulse-glow` block and the `animation` line from `.play-btn.playing`.

**Step 5: Commit**

```
git add css/style.css
git commit -m "Restyle buttons with hybrid bevel, remove pulse-glow animation"
```

---

### Task 3: Update swatch, selects, text input, canvas area, and canvas element

**Files:**
- Modify: `css/style.css` (swatch, select, text input, canvas area, canvas element sections)

**Step 1: Update swatch**

```css
.swatch {
  width: 28px;
  height: 28px;
  border-radius: 2px;
  border-width: 1px;
  border-style: solid;
  border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
  cursor: pointer;
  background: hsl(200, 80%, 50%);
  transition: border-color 0.15s;
}

.swatch:hover {
  border-color: var(--text-muted);
}
```

**Step 2: Update select**

```css
select {
  background: var(--bg-toolbar);
  color: var(--text-primary);
  border-width: 1px;
  border-style: solid;
  border-color: var(--bevel-hi) var(--bevel-lo) var(--bevel-lo) var(--bevel-hi);
  border-radius: 2px;
  padding: 4px 8px;
  font-family: 'Share Tech Mono', monospace;
  font-size: 12px;
  cursor: pointer;
}
```

**Step 3: Update text input**

```css
.text-input {
  background: var(--bg-body);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 4px 8px;
  font-family: 'Share Tech Mono', monospace;
  font-size: 12px;
  width: 140px;
}

.text-input:focus {
  border-color: var(--text-muted);
  outline: none;
}
```

**Step 4: Update canvas area**

```css
#canvas-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  overflow: hidden;
  background: var(--bg-body);
}
```

Remove the `radial-gradient` background.

**Step 5: Update canvas element**

```css
#sigil-canvas {
  display: block;
  background: #2a2a2a;
  border-width: 2px;
  border-style: solid;
  border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
  image-rendering: auto;
}
```

Remove the `box-shadow` property entirely.

**Step 6: Commit**

```
git add css/style.css
git commit -m "Update swatch, selects, inputs, and canvas area styles"
```

---

### Task 4: Update play fan, panels, and remove remaining animations

**Files:**
- Modify: `css/style.css` (play fan, canvas glow, color picker panel, scanline overlay sections)

**Step 1: Update play fan**

```css
.fan-option {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-toolbar);
  border-width: 1px;
  border-style: solid;
  border-color: var(--bevel-hi) var(--bevel-lo) var(--bevel-lo) var(--bevel-hi);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease-out;
}

.fan-option.hot {
  border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
  color: var(--text-primary);
  background: var(--active-bg);
}
```

Remove the `box-shadow` and `transform: scale(1.15)` from `.fan-option.hot`.

**Step 2: Delete `@keyframes canvas-glow`**

Remove the entire `@keyframes canvas-glow` block and the `#canvas-wrap.playing #sigil-canvas` rule that uses it.

**Step 3: Delete scanline overlay**

Remove the entire `#canvas-wrap::after` rule.

**Step 4: Update color picker panel**

```css
.panel {
  position: fixed;
  top: 50px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 12px;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
```

**Step 5: Update panel tabs**

```css
.panel-tab {
  background: var(--bg-toolbar);
  border-width: 1px;
  border-style: solid;
  border-color: var(--bevel-hi) var(--bevel-lo) var(--bevel-lo) var(--bevel-hi);
  color: var(--text-muted);
  padding: 4px 12px;
  border-radius: 2px;
  cursor: pointer;
  font-family: 'Share Tech Mono', monospace;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.panel-tab.active {
  color: var(--text-primary);
  border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
  background: var(--active-bg);
}
```

**Step 6: Update stop buttons**

```css
.stop-btn {
  background: var(--bg-toolbar);
  border-width: 1px;
  border-style: solid;
  border-color: var(--bevel-hi) var(--bevel-lo) var(--bevel-lo) var(--bevel-hi);
  color: var(--text-muted);
  padding: 2px 10px;
  border-radius: 2px;
  cursor: pointer;
  font-family: 'Share Tech Mono', monospace;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stop-btn.active {
  color: var(--text-primary);
  border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
  background: var(--active-bg);
}
```

**Step 7: Update hue slider**

```css
.hue-slider {
  writing-mode: vertical-lr;
  direction: rtl;
  height: 160px;
}
```

Remove the `accent-color` property.

**Step 8: Commit**

```
git add css/style.css
git commit -m "Update panels, play fan, stop buttons, remove glow animations and scanlines"
```

---

### Task 5: Update border panel and share menu CSS

**Files:**
- Modify: `css/style.css` (border panel, share menu sections)

**Step 1: Update border panel position**

The `#border-panel` rule already extends `.panel`. Just update the colors:

```css
#border-panel {
  position: fixed;
  bottom: 50px;
  left: 12px;
  top: auto;
  transform: none;
}
```

**Step 2: Update border control buttons**

```css
.border-color-btn,
.border-style-btn {
  background: var(--bg-toolbar);
  border-width: 1px;
  border-style: solid;
  border-color: var(--bevel-hi) var(--bevel-lo) var(--bevel-lo) var(--bevel-hi);
  color: var(--text-muted);
  padding: 2px 10px;
  border-radius: 2px;
  cursor: pointer;
  font-family: 'Share Tech Mono', monospace;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.border-color-btn.active,
.border-style-btn.active {
  color: var(--text-primary);
  border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
  background: var(--active-bg);
}
```

**Step 3: Update border slider and has-border indicator**

```css
.border-slider {
  flex: 1;
  height: 4px;
}
```

Remove `accent-color`.

```css
#btn-border.has-border {
  background: var(--active-bg);
  border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
}
```

**Step 4: Update border remove button**

```css
.border-remove-btn {
  background: transparent;
  border: 1px solid rgba(204, 51, 68, 0.3);
  color: var(--danger);
  padding: 3px 10px;
  border-radius: 2px;
  cursor: pointer;
  font-family: 'Share Tech Mono', monospace;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 4px;
  align-self: flex-end;
}

.border-remove-btn:hover {
  background: rgba(204, 51, 68, 0.12);
  border-color: var(--danger);
}
```

**Step 5: Update share menu**

```css
.share-menu {
  /* position/layout unchanged */
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 2px;
  /* padding unchanged */
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  min-width: 160px;
}

.share-menu-item:hover {
  background: var(--hover-bg);
}
```

**Step 6: Update responsive breakpoint**

In the `@media (max-width: 700px)` block, update button sizes to `32px` (down from new default 36px):

```css
.tool-btn,
.action-btn,
.pattern-btn {
  width: 32px;
  height: 32px;
  font-size: 13px;
}
```

**Step 7: Commit**

```
git add css/style.css
git commit -m "Update border panel, share menu, and responsive styles"
```

---

### Task 6: Update canvas.ts colors

**Files:**
- Modify: `js/canvas.ts:9` (CANVAS_BG)
- Modify: `js/canvas.ts:107` (chromatic guides)
- Modify: `js/canvas.ts:175-201` (shape glow layers → simple strokes)
- Modify: `js/canvas.ts:259-298` (selection handles)
- Modify: `js/canvas.ts:315-328` (text decoration handles)

**Step 1: Update CANVAS_BG**

```ts
const CANVAS_BG = '#2a2a2a';
```

**Step 2: Update chromatic guides**

Change octave line color from `rgba(255,255,255,0.1)` to `rgba(255,255,255,0.12)`.

**Step 3: Replace glow layers with simple strokes**

Replace the entire glow rendering block (the `glowColor`, `glowLayers` variables and the `for (const layer of glowLayers)` loop) with:

```ts
  // Shape outline
  ctx.save();
  if (isPlaying) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
  }
  buildShapePath(ctx, voice, canvasSize);
  ctx.stroke();
  ctx.restore();
```

**Step 4: Update selection handles**

- Dashed outline: `rgba(255,255,255,0.5)` (was `rgba(0, 240, 255, 0.5)`)
- Handle fill: `#ffffff` (was `#00f0ff`)
- Handle stroke: `#2a2a2a` (was `#0a0a1a`)
- Rotation line: `rgba(255,255,255,0.4)` (was `rgba(0, 240, 255, 0.5)`)
- Rotation handle fill: `#888888` (was `#b44dff`)
- Rotation handle stroke: `#2a2a2a` (was `#0a0a1a`)

**Step 5: Update text decoration selection handles**

- Dashed outline: `rgba(255,255,255,0.5)` (was `rgba(255, 225, 86, 0.5)`)
- Handle fill: `#ffffff` (was `#ffe156`)
- Handle stroke: `#2a2a2a` (was `#0a0a1a`)

**Step 6: Verify types**

Run: `npx tsc --noEmit`

**Step 7: Commit**

```
git add js/canvas.ts
git commit -m "Update canvas colors: neutral background, simple strokes, white handles"
```

---

### Task 7: Update colors.ts and embed files

**Files:**
- Modify: `js/colors.ts:126,134,140` (angle dial colors)
- Modify: `js/embed-entry.ts:11,17` (inline text color)
- Modify: `embed.html:14,30-31,37,50,53` (inline styles)

**Step 1: Update angle dial colors in colors.ts**

- Outer ring stroke: `rgba(255,255,255,0.2)` → `'rgba(0,0,0,0.2)'` (dark ring on light panel)
- Direction indicator: `'#00f0ff'` → `'#2a2a2a'`
- Center dot: `'#00f0ff'` → `'#2a2a2a'`

**Step 2: Update embed-entry.ts inline colors**

- Line 11: `color:#e0e0ff` → `color:#2a2a2a`
- Line 17: `color:#e0e0ff` → `color:#2a2a2a`

**Step 3: Update embed.html inline styles**

- `body` background: `#0a0a1a` → `#e8e4e0`
- `canvas` background: `#1a1a2e` → `#2a2a2a`
- `canvas` box-shadow: remove entirely
- `#play-btn` background: remove gradient, use `#d5d0cb`
- `#play-btn` border: add `1px solid` with bevel colors
- `#play-btn` color: `white` → `#2a2a2a`
- `#play-btn` border-radius: `4px` → `2px`
- `#play-btn:hover` box-shadow: remove
- `#play-btn:hover` background: `#ccc7c1`
- `#play-btn.playing` background: `#c5c0ba` (no gradient)

**Step 4: Verify types**

Run: `npx tsc --noEmit`

**Step 5: Run tests**

Run: `bun test`

All 170 tests should pass (no behavioral changes).

**Step 6: Commit**

```
git add js/colors.ts js/embed-entry.ts embed.html
git commit -m "Update angle dial, embed page, and embed-entry colors"
```

---

### Task 8: Update CLAUDE.md and verify

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update theme references in CLAUDE.md**

In the CSS description in the project structure, change `synthwave theme` to `flat hybrid-bevel theme`.

**Step 2: Build and visual check**

Run: `bun run build`

Serve dist and verify in browser that:
- UI chrome is warm gray with beveled buttons
- Canvas is dark warm gray, sunken
- Shapes render with simple white outlines
- Selection handles are white/black (no neon)
- Play button is flat, no glow
- No scanlines visible
- Color picker panel matches new style

**Step 3: Run full test suite**

Run: `bun test`

All 170 tests should pass.

**Step 4: Commit**

```
git add CLAUDE.md
git commit -m "Update CLAUDE.md for new flat hybrid-bevel theme"
```
