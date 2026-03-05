# Toolbar Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Redesign both toolbars as icon-driven, context-sensitive bars with
dropdowns and inline expansion, making all actions accessible without a
keyboard.

**Architecture:** Top bar = canvas-wide actions (play, share, reverb,
undo/redo, new). Bottom bar = context-sensitive (shape tools when nothing
selected, voice properties when selected). All text labels replaced with Tabler
Icons via an SVG sprite. Panels convert from floating overlays to inline
expansion within the bottom bar.

**Tech Stack:** TypeScript, vanilla DOM, CSS custom properties, Tabler Icons
SVG sprite (24 icons, 7KB).

**Design doc:** `docs/plans/2026-03-02-toolbar-redesign-design.md`

---

## Icon Strategy: SVG Sprite

Instead of an `icons.ts` module with innerHTML, use a **mini SVG sprite** file
containing only the ~24 icons we need. Reference icons with `<use href>`:

```html
<svg width="20" height="20"><use href="tabler-sprite.svg#tabler-arrow-back-up" /></svg>
```

Benefits: no JS for icon rendering, no innerHTML security concerns, browser
caches the sprite, clean HTML. The sprite is 7KB total.

### Icon inventory

| Usage                | Symbol ID                       | Style   |
|---------------------|---------------------------------|---------|
| Select tool          | `tabler-pointer`                | outline |
| Triangle shape       | (keep existing inline SVG)      | custom  |
| Square shape         | (keep existing inline SVG)      | custom  |
| Circle shape         | (keep existing inline SVG)      | custom  |
| Play                 | `tabler-player-play-filled`     | filled  |
| Stop                 | `tabler-player-stop-filled`     | filled  |
| Share                | `tabler-share`                  | outline |
| Reverb               | `tabler-ripple`                 | outline |
| Undo                 | `tabler-arrow-back-up`          | outline |
| Redo                 | `tabler-arrow-forward-up`       | outline |
| New                  | `tabler-file-plus`              | outline |
| Delete               | `tabler-trash`                  | outline |
| Pattern trigger      | `tabler-texture`                | outline |
| Blend trigger        | `tabler-layers-intersect`       | outline |
| Border               | `tabler-border-outer`           | outline |
| Fan: latch           | `tabler-lock`                   | outline |
| Fan: loop            | `tabler-repeat`                 | outline |
| Reverb glow          | `tabler-sun`                    | outline |
| Reverb dim           | `tabler-moon`                   | outline |
| Blend: soft-light    | `tabler-feather`                | outline |
| Blend: multiply      | `tabler-stack-2`                | outline |
| Blend: screen        | `tabler-sun`                    | outline |
| Blend: overlay       | `tabler-layers-linked`          | outline |
| Blend: burn          | `tabler-flame`                  | outline |
| Blend: difference    | `tabler-arrows-diff`            | outline |
| Blend: exclusion     | `tabler-code-minus`             | outline |

The triangle/square/circle shape buttons keep their existing hand-drawn inline
SVGs (they're already clean and match the app's visual language better than
generic Tabler shapes).

---

### Task 1: Generate and Commit the SVG Sprite

**Files:**
- Create: `tabler-sprite.svg` (project root, next to `index.html`)
- Modify: `build.ts` (copy sprite to dist/)

**Step 1: Install the sprite package and extract our icons**

```bash
cd /Volumes/CaseSensitive/repos/spatch
bun add -d @tabler/icons-sprite
```

Then write a small script (or do it manually) that:
1. Reads `node_modules/@tabler/icons-sprite/dist/tabler-sprite.svg`
2. Extracts only the `<symbol>` elements matching our icon IDs (see inventory)
3. Adds two manual filled symbols for `player-play-filled` and
   `player-stop-filled`
4. Writes the result to `tabler-sprite.svg`

The filled symbols to add manually:

```xml
<symbol id="tabler-player-play-filled" viewBox="0 0 24 24" fill="currentColor">
  <path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" />
</symbol>
<symbol id="tabler-player-stop-filled" viewBox="0 0 24 24" fill="currentColor">
  <path d="M17 4h-10a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3 -3v-10a3 3 0 0 0 -3 -3z" />
</symbol>
```

After generating, uninstall the package (we don't need it at runtime):

```bash
bun remove @tabler/icons-sprite
```

**Step 2: Update build.ts to copy the sprite**

Add a file copy after the HTML build succeeds (around line 32):

```ts
// Copy SVG sprite to dist (not handled by Bun's HTML bundler)
await Bun.$`cp tabler-sprite.svg dist/tabler-sprite.svg`;
```

**Step 3: Verify**

```bash
bun run build && ls -la dist/tabler-sprite.svg
```

Expected: File exists in dist/, ~7KB.

**Step 4: Test that `<use href>` works**

Temporarily add to `index.html` inside any button:

```html
<svg width="20" height="20"><use href="tabler-sprite.svg#tabler-pointer" /></svg>
```

Build and serve (`bun run dev && bunx serve dist`). Verify the icon renders.
Remove the test markup.

**Step 5: Commit**

```bash
git add tabler-sprite.svg build.ts
git commit -m "Add Tabler Icons mini sprite (24 icons, 7KB) (#36)"
```

---

### Task 2: Restructure Top Bar HTML

Replace the top bar with the new layout: SPATCH, play+fan, share,
reverb, undo/redo, new. All icons via sprite `<use>`.

**Files:**
- Modify: `index.html` — replace `<header id="toolbar-top">...</header>`

**Step 1: Replace top bar HTML**

Replace lines 11-120 (everything inside `<header id="toolbar-top">`) with:

```html
<header id="toolbar-top">
  <div class="toolbar-group title-group">
    <h1 class="logo">SPATCH</h1>
  </div>

  <div class="toolbar-group play-group">
    <div class="play-fan-wrap">
      <button id="btn-play" class="play-btn" title="Play">
        <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-player-play-filled" /></svg>
      </button>
      <div id="play-fan" class="play-fan" aria-hidden="true">
        <div class="fan-option fan-lock" title="Latch">
          <svg width="18" height="18"><use href="tabler-sprite.svg#tabler-lock" /></svg>
        </div>
        <div class="fan-option fan-loop" title="Loop">
          <svg width="18" height="18"><use href="tabler-sprite.svg#tabler-repeat" /></svg>
        </div>
      </div>
    </div>
    <button id="btn-share" class="action-btn" title="Share">
      <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-share" /></svg>
    </button>
    <div id="share-menu" class="share-menu hidden">
      <button class="share-menu-item" data-action="share">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <span>Share link</span>
      </button>
      <button class="share-menu-item" data-action="embed">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
        <span>Embed code</span>
      </button>
    </div>
  </div>

  <div class="separator"></div>

  <div class="toolbar-group reverb-group">
    <button id="btn-reverb" class="action-btn" title="Reverb">
      <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-ripple" /></svg>
    </button>
    <div id="reverb-panel" class="reverb-popover hidden">
      <div class="reverb-controls">
        <div class="reverb-row">
          <button class="reverb-style-btn active" data-reverb-style="glow" title="Glow">
            <svg width="16" height="16"><use href="tabler-sprite.svg#tabler-sun" /></svg>
          </button>
          <button class="reverb-style-btn" data-reverb-style="dim" title="Dim">
            <svg width="16" height="16"><use href="tabler-sprite.svg#tabler-moon" /></svg>
          </button>
        </div>
        <div class="reverb-row">
          <input id="reverb-depth" class="reverb-slider" type="range"
                 min="1" max="100" value="50" title="Reverb depth" />
        </div>
        <button id="btn-remove-reverb" class="reverb-remove-btn" title="Remove reverb">
          <svg width="14" height="14"><use href="tabler-sprite.svg#tabler-trash" /></svg>
        </button>
      </div>
    </div>
  </div>

  <div class="separator"></div>

  <div class="toolbar-group actions-group">
    <button id="btn-undo" class="action-btn" title="Undo (Ctrl+Z)">
      <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-arrow-back-up" /></svg>
    </button>
    <button id="btn-redo" class="action-btn" title="Redo (Ctrl+Y)">
      <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-arrow-forward-up" /></svg>
    </button>
  </div>

  <div class="separator"></div>

  <div class="toolbar-group new-group">
    <button id="btn-new" class="action-btn" title="New">
      <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-file-plus" /></svg>
    </button>
  </div>
</header>
```

**Step 2: Remove old floating panels**

Delete the `<!-- Color Picker Panel -->` block (old lines 129-161).
Delete the `<!-- Border Panel -->` block (old lines 163-205).
Delete the old `<!-- Reverb Panel -->` block (old lines 207-228) — reverb is
now inline in the top bar above.

**Step 3: Remove text tool elements**

The hidden text button, separator, and `#text-input` are already gone (they
were inside the old top bar tools-group which was fully replaced).

**Step 4: Commit**

```bash
git add index.html
git commit -m "Restructure top bar: play, share, reverb, undo/redo, new (#36)"
```

---

### Task 3: Restructure Bottom Bar HTML

Replace the bottom bar with two context-sensitive content areas.

**Files:**
- Modify: `index.html` — replace `<footer id="toolbar-bottom">...</footer>`

**Step 1: Replace bottom bar HTML**

```html
<footer id="toolbar-bottom">
  <!-- Shown when no voice is selected -->
  <div id="bottom-tools" class="toolbar-context">
    <div class="toolbar-group tools-group">
      <button class="tool-btn" data-tool="select" title="Select (V)">
        <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-pointer" /></svg>
      </button>
      <div class="separator"></div>
      <button class="tool-btn shape-btn" data-tool="triangle" title="Triangle">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <polygon points="12,3 22,21 2,21" fill="none" stroke="currentColor" stroke-width="2" />
        </svg>
      </button>
      <button class="tool-btn shape-btn" data-tool="square" title="Square">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect x="3" y="3" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" />
        </svg>
      </button>
      <button class="tool-btn shape-btn" data-tool="circle" title="Circle">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Shown when a voice is selected -->
  <div id="bottom-props" class="toolbar-context hidden">
    <!-- Inline expansion area (grows upward from icon row) -->
    <div id="bottom-expansion" class="expansion-area hidden"></div>

    <div class="toolbar-group props-group">
      <div id="fill-swatch" class="swatch" title="Fill color"></div>

      <div class="dropdown-wrap">
        <button id="btn-pattern" class="action-btn" title="Pattern">
          <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-texture" /></svg>
        </button>
        <div id="pattern-dropdown" class="dropdown hidden"></div>
      </div>

      <div class="dropdown-wrap">
        <button id="btn-blend" class="action-btn" title="Blend mode">
          <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-layers-intersect" /></svg>
        </button>
        <div id="blend-dropdown" class="dropdown hidden"></div>
      </div>

      <button id="btn-border" class="action-btn" title="Border">
        <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-border-outer" /></svg>
      </button>

      <div class="separator"></div>

      <button id="btn-delete" class="action-btn danger" title="Delete">
        <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-trash" /></svg>
      </button>
    </div>
  </div>
</footer>
```

Note: `.dropdown-wrap` elements need `position: relative` so the dropdown
floats above the correct button.

**Step 2: Commit**

```bash
git add index.html
git commit -m "Restructure bottom bar: context-sensitive tools/properties (#36)"
```

---

### Task 4: CSS — Layout, Dropdowns, Inline Expansion

Rewrite toolbar CSS for new structure. Keep canvas, splash, and base styles
intact.

**Files:**
- Modify: `css/style.css`

**Step 1: Update toolbar container styles**

The top bar stays a single flex row. The bottom bar uses `flex-direction:
column-reverse` so the expansion area appears above the icon row:

```css
#toolbar-bottom {
  background: var(--bg-toolbar);
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column-reverse;
  z-index: 10;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
```

**Step 2: Add context switching styles**

```css
.toolbar-context {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 12px;
  gap: 8px;
}
.toolbar-context.hidden { display: none !important; }
```

**Step 3: Update button sizes to 44x44**

All `.tool-btn` and `.action-btn` get `width: 44px; height: 44px`.
The `.play-btn` also becomes 44x44 icon-only (no text, no font-family).

**Step 4: Play fan drops DOWN**

Change `.play-fan` positioning from `bottom: calc(100% + 6px)` to
`top: calc(100% + 6px)`.

**Step 5: Add dropdown styles**

```css
.dropdown-wrap { position: relative; }

.dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 4px;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  min-width: 160px;
}
.dropdown.hidden { display: none !important; }

.dropdown-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 44px;
  background: transparent;
  border: none;
  color: var(--text-primary);
  padding: 4px 8px;
  border-radius: 2px;
  cursor: pointer;
  transition: background 0.15s;
}
.dropdown-item:hover { background: var(--hover-bg); }
.dropdown-item.active { background: var(--active-bg); }
```

**Step 6: Add inline expansion styles**

```css
.expansion-area {
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.2s ease-out, padding 0.2s ease-out;
}
.expansion-area.open {
  max-height: 200px;
  padding: 12px;
}
.expansion-area.hidden { display: none !important; }
```

**Step 7: Add pattern band preview styles**

```css
.pattern-band {
  width: 100%;
  height: 24px;
  border-radius: 2px;
}
.pattern-preview-none {
  background: var(--bg-toolbar);
  position: relative;
}
.pattern-preview-none::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, transparent calc(50% - 1px),
    var(--text-muted) calc(50% - 1px),
    var(--text-muted) calc(50% + 1px),
    transparent calc(50% + 1px));
}
.pattern-preview-stripes {
  background: repeating-linear-gradient(45deg,
    var(--text-primary) 0 3px, transparent 3px 6px);
}
.pattern-preview-checker {
  background-image:
    linear-gradient(45deg, var(--text-primary) 25%, transparent 25%),
    linear-gradient(-45deg, var(--text-primary) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--text-primary) 75%),
    linear-gradient(-45deg, transparent 75%, var(--text-primary) 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
}
.pattern-preview-noise {
  background-image: radial-gradient(var(--text-primary) 1px, transparent 1px);
  background-size: 4px 4px;
}
.pattern-preview-gradient {
  background: linear-gradient(90deg, var(--text-primary), transparent);
}
.pattern-preview-rough {
  background: repeating-linear-gradient(90deg,
    var(--text-primary) 0 2px, transparent 2px 5px);
}
```

**Step 8: Add reverb popover styles**

```css
.reverb-group { position: relative; }
.reverb-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 12px;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  min-width: 180px;
}
.reverb-popover.hidden { display: none !important; }
```

**Step 9: Remove dead CSS**

Delete styles for:
- `.pattern-btn` (replaced by `.dropdown-item`)
- `select` (native select removed)
- `.text-input` (text tool removed)
- Old `#border-panel` fixed positioning
- Old `#reverb-panel` fixed positioning
- Old `.panel` fixed positioning (the color picker panel)
- `.border-label`, `.reverb-label` (text labels removed)
- `.share-group { margin-left: auto }` (share moved, layout changed)

**Step 10: Update responsive breakpoint**

```css
@media (max-width: 400px) {
  #toolbar-top { flex-wrap: wrap; }
  .tool-btn, .action-btn, .play-btn { width: 40px; height: 40px; }
}
```

**Step 11: Commit**

```bash
git add css/style.css
git commit -m "Restyle toolbars: dropdowns, inline expansion, 44px targets (#36)"
```

---

### Task 5: Update toolbar.ts — Context Bar, Dropdowns, Expansion

Rewrite `toolbar.ts` to handle context-sensitive bottom bar, pattern/blend
dropdowns, fill/border inline expansion.

**Files:**
- Modify: `js/toolbar.ts`

**Step 1: Add bottom bar context switching**

Add `updateBottomBar()` method:

```ts
updateBottomBar(): void {
  const tools = document.getElementById('bottom-tools')!;
  const props = document.getElementById('bottom-props')!;
  if (this.selectedId) {
    tools.classList.add('hidden');
    props.classList.remove('hidden');
  } else {
    tools.classList.remove('hidden');
    props.classList.add('hidden');
    this._closeAllDropdowns();
    this._closeExpansion();
  }
}
```

**Step 2: Implement pattern dropdown**

Populate at init time in constructor:

```ts
_populatePatternDropdown(): void {
  const dropdown = document.getElementById('pattern-dropdown')!;
  const patterns = [
    { value: 'none', title: 'None' },
    { value: 'stripes', title: 'Stripes' },
    { value: 'checker', title: 'Checker' },
    { value: 'noise', title: 'Noise' },
    { value: 'gradient', title: 'Gradient' },
    { value: 'rough', title: 'Rough' },
  ];
  for (const p of patterns) {
    const btn = document.createElement('button');
    btn.className = 'dropdown-item';
    btn.dataset.pattern = p.value;
    btn.title = p.title;
    const band = document.createElement('div');
    band.className = `pattern-band pattern-preview-${p.value}`;
    btn.appendChild(band);
    dropdown.appendChild(btn);
  }
}
```

Bind `#btn-pattern` click to toggle `#pattern-dropdown` hidden class.
Bind dropdown item clicks to apply pattern (same logic as old
`_bindPatternButtons`). Close on outside click.

**Step 3: Implement blend dropdown**

Populate at init time with 7 icon items. Each item's inner SVG references
the sprite:

```ts
_populateBlendDropdown(): void {
  const dropdown = document.getElementById('blend-dropdown')!;
  const modes: Array<{ value: BlendMode; symbol: string; title: string }> = [
    { value: 'soft-light', symbol: 'tabler-feather', title: 'Soft Light' },
    { value: 'multiply', symbol: 'tabler-stack-2', title: 'Multiply' },
    { value: 'screen', symbol: 'tabler-sun', title: 'Screen' },
    { value: 'overlay', symbol: 'tabler-layers-linked', title: 'Overlay' },
    { value: 'color-burn', symbol: 'tabler-flame', title: 'Burn' },
    { value: 'difference', symbol: 'tabler-arrows-diff', title: 'Difference' },
    { value: 'exclusion', symbol: 'tabler-code-minus', title: 'Exclusion' },
  ];
  for (const m of modes) {
    const btn = document.createElement('button');
    btn.className = 'dropdown-item';
    btn.dataset.blend = m.value;
    btn.title = m.title;
    btn.innerHTML = `<svg width="20" height="20"><use href="tabler-sprite.svg#${m.symbol}" /></svg>`;
    dropdown.appendChild(btn);
  }
}
```

Bind `#btn-blend` click to toggle dropdown. Item clicks apply blend mode.

**Step 4: Convert fill swatch to inline expansion**

When `#fill-swatch` is clicked, populate `#bottom-expansion` with the color
picker HTML (same controls as before: solid/linear tabs, native color inputs,
angle slider). Use `element.innerHTML` to set it, then bind the inputs.

Key method: `_openFillExpansion()` which:
1. Sets `#bottom-expansion` innerHTML with the color picker markup
2. Removes `hidden`, adds `open` class
3. Binds input events on the dynamically created elements
4. Syncs values from `_fillDraft`

And `_closeFillExpansion()` which reverses.

**Step 5: Convert border to inline expansion**

Same pattern: `_openBorderExpansion()` populates `#bottom-expansion` with
border controls (color toggle, style toggle, thickness slider, remove button),
then binds events.

Only one expansion can be open at a time. Opening fill closes border and
vice versa.

**Step 6: Refactor reverb panel bindings**

The reverb panel HTML moved to the top bar but the DOM IDs are the same
(`#btn-reverb`, `#reverb-panel`, `#reverb-depth`, `#btn-remove-reverb`,
`.reverb-style-btn`). The existing `_bindReverbPanel()` and
`_updateReverbPanel()` methods should work with minimal changes — just verify
the outside-click handler still works since the panel position changed.

**Step 7: Remove dead code**

- Remove `_bindPatternButtons()` (replaced by dropdown)
- Remove `_updatePatternActive()` (replaced by `_updatePatternDropdown()`)
- Remove `_bindBlendSelector()` / `_updateBlendSelector()` (replaced by
  dropdown)
- Remove `_bindColorPicker()` (replaced by expansion)
- Remove `_bindBorderPanel()` (replaced by expansion)
- Update constructor to call new methods

**Step 8: Update `syncToSelectedShape()`**

```ts
syncToSelectedShape(): void {
  const sel = this.getSelected();
  if (!sel) return;
  this._fillDraft = fillToFillDraft(sel.fill);
  this.updateSwatchFromSelected();
  this._updatePatternDropdown();
  this._updateBlendDropdown();
  this._updateBorderButton();
  this._updateReverbPanel();
}
```

Where `_updatePatternDropdown()` highlights the active pattern item, and
`_updateBlendDropdown()` highlights the active blend item.

**Step 9: Commit**

```bash
git add js/toolbar.ts
git commit -m "Rewrite toolbar: context bar, dropdowns, inline expansion (#36)"
```

---

### Task 6: Update app.ts — Fan Direction, New, Share, Selection

**Files:**
- Modify: `js/app.ts`

**Step 1: Update play button icon swap**

Replace all `playBtn.textContent = '\u25B6 PLAY'` with setting innerHTML to
the play SVG sprite reference. Same for stop. Since we can't use innerHTML
with `<use>` reliably across browsers for dynamic swap, use a helper:

```ts
function setPlayIcon(playing: boolean): void {
  const symbol = playing ? 'tabler-player-stop-filled' : 'tabler-player-play-filled';
  playBtn.innerHTML = `<svg width="20" height="20"><use href="tabler-sprite.svg#${symbol}" /></svg>`;
}
```

Call `setPlayIcon(true)` in `startPlayback()` and `setPlayIcon(false)` in
`stopPlayback()` and `splashReveal()`.

**Step 2: Reverse fan direction**

In `fanZone()`, change the dy calculation from measuring upward to measuring
downward:

```ts
const dy = clientY - (r.top + r.height / 2); // positive = below button
```

Update the fan loop transform from `translateY(-${info.pull}px)` to
`translateY(${info.pull}px)`.

Update the early-move detection: the check `dy > 10` now means "dragged
10px below the button" which is correct for the downward fan.

**Step 3: Update share button reference**

Change `document.getElementById('btn-menu')` to
`document.getElementById('btn-share')`. The share menu ID `#share-menu`
stays the same.

**Step 4: Wire selection to bottom bar**

In `setSelection()`, add `toolbar.updateBottomBar()`:

```ts
function setSelection(shapeId: string | undefined, decoId: string | undefined = null): void {
  selectedId = shapeId;
  selectedDecoId = decoId;
  toolbar.selectedId = shapeId;
  toolbar.selectedDecoId = decoId;
  toolbar.updateBottomBar();
}
```

**Step 5: Add "new" button**

```ts
document.getElementById('btn-new')!.addEventListener('click', () => {
  if (store.data.voices.length === 0) return;
  undo.snapshot();
  for (const v of [...store.data.voices]) {
    store.removeVoice(v.id);
  }
  setSelection(null);
  needsRender = true;
});
```

**Step 6: Remove text tool references**

Remove `DecorationTool` import and instantiation (line 44).
Remove `decoTool.setTool()` calls.
Remove the text tool handling in pointerdown (lines 349-361).
Remove the `toolbar.onToolChange` callback that checks for text tool.
Remove the `#text-input` hide on Escape.

Keep the text decoration hit testing code (it's harmless and the data model
still supports it).

**Step 7: Handle select-tool deselection**

In the tool button click handler (currently in `toolbar.ts`), when the select
button is clicked and something is already selected, trigger deselection.
Add this to toolbar's `_bindToolButtons`:

```ts
if (btn.dataset.tool === 'select' && this.selectedId) {
  // Signal app.ts to deselect — use a callback
  if (this.onToolChange) this.onToolChange('deselect');
  return;
}
```

In `app.ts`, handle the 'deselect' signal:

```ts
toolbar.onToolChange = (tool: string) => {
  if (tool === 'deselect') {
    setSelection(null);
    needsRender = true;
  }
};
```

**Step 8: Commit**

```bash
git add js/app.ts
git commit -m "Update app: reversed fan, new button, selection wiring (#36)"
```

---

### Task 7: Update Embed Page

The embed page has its own play button that needs icon treatment.

**Files:**
- Modify: `embed.html`
- Modify: `js/embed-entry.ts`

**Step 1: Read embed.html**

Check the current embed play button markup. Update it to use the sprite icon.
The embed page also needs the sprite file — add a copy step or reference it.

Since the embed page is built to `dist/` alongside `index.html`, and we
already copy `tabler-sprite.svg` to `dist/`, the sprite is available.

Update the embed play button HTML to use the sprite:

```html
<button id="play-btn" title="Play">
  <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-player-play-filled" /></svg>
</button>
```

**Step 2: Update embed-entry.ts**

Replace the textContent swaps with innerHTML sprite references:

```ts
btn.innerHTML = '<svg width="20" height="20"><use href="tabler-sprite.svg#tabler-player-stop-filled" /></svg>';
// and
btn.innerHTML = '<svg width="20" height="20"><use href="tabler-sprite.svg#tabler-player-play-filled" /></svg>';
```

Set initial state at the bottom:
```ts
btn.innerHTML = '<svg width="20" height="20"><use href="tabler-sprite.svg#tabler-player-play-filled" /></svg>';
```

**Step 3: Commit**

```bash
git add embed.html js/embed-entry.ts
git commit -m "Update embed play button to use sprite icon (#36)"
```

---

### Task 8: Visual Testing and Polish

Build, serve, and walk through every interaction.

**Files:**
- Modify: any files needing fixes

**Step 1: Build and serve**

```bash
bun run dev
bunx serve dist
```

**Step 2: Test checklist**

- [ ] All sprite icons render (no broken images)
- [ ] Top bar: SPATCH logo, play, share, reverb, undo, redo, new — all visible
- [ ] Play: icon swaps play/stop, audio works
- [ ] Play fan: drops DOWN, latch/loop modes work
- [ ] Share: dropdown opens below share button
- [ ] Reverb: popover opens below reverb button, glow/dim/depth/remove work
- [ ] Undo/redo work
- [ ] New: clears canvas, undo reverses
- [ ] Bottom bar (no selection): select + 3 shape tools
- [ ] Placing shape: bottom bar swaps to properties
- [ ] Select button when shape selected: deselects, bar swaps back
- [ ] Fill swatch: shows color, inline expansion opens/closes
- [ ] Color picker: solid/linear tabs, color inputs work
- [ ] Pattern dropdown: visual bands, selection applies pattern
- [ ] Blend dropdown: icon items, selection applies blend mode
- [ ] Border: toggle on/off, inline expansion with controls
- [ ] Delete: removes shape
- [ ] Keyboard shortcuts: Ctrl+Z, Ctrl+C/V/D, Delete, Escape, Space, V
- [ ] Escape closes any open dropdown/expansion/popover
- [ ] All buttons have title attributes
- [ ] Touch targets >= 44px
- [ ] Mobile viewport (<400px): top bar wraps, bottom bar stays single row
- [ ] Splash screen works
- [ ] Embed page play button works

**Step 3: Fix issues**

Address visual/functional problems. Commit fixes.

**Step 4: Clean build**

```bash
rm -rf dist && bun run build
```

Verify no build errors and final sizes look reasonable.

**Step 5: Commit**

```bash
git add -u
git commit -m "Polish toolbar redesign after visual testing (#36)"
```

---

### Task 9: Cleanup

Remove any remaining dead code or styles.

**Files:**
- Modify: `css/style.css`, `js/toolbar.ts`, `js/app.ts`

**Step 1: Grep for orphaned references**

Search for IDs and classes that no longer exist in HTML:
- `btn-menu` (renamed to `btn-share`)
- `blend-mode` (native select removed)
- `text-input` (text tool removed)
- `pattern-btn` (class removed)
- `color-picker-panel` (removed)
- `border-panel` as old fixed panel (now `reverb-popover` class)

**Step 2: Remove any found dead references**

**Step 3: Verify build**

```bash
bun run build
```

**Step 4: Final commit**

```bash
git add -u
git commit -m "Remove dead code from toolbar redesign (#36)"
```
