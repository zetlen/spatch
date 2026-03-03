# Stage Themes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add user-selectable cosmetic themes (minimal, subtle, florid) to the
stage area around the canvas, with a curated image library and audio-reactive
CSS effects.

**Architecture:** Pure CSS approach. Three theme modes are CSS classes on
`#canvas-area`, layered via `::before` (background image/gradient) and `::after`
(scan lines + tint overlay). A small `js/stage.ts` module manages the cycle
button, localStorage persistence, and setting `--audio-level` for reactive
effects. Background images are copied to `dist/stage/` by the build script.

**Tech Stack:** CSS pseudo-elements, CSS custom properties, Tabler icons
(`tabler-photo`), localStorage, Bun build script.

**Design doc:** `docs/plans/2026-03-03-stage-themes-design.md`

---

### Task 1: Copy stage images in build script

**Files:**
- Modify: `build.ts:90-136`

**Step 1: Add image copy to build function**

After the tabler sprite generation (line 128), add a step that copies the
`spatch-bgs/` directory to `dist/stage/`:

```typescript
  // Copy stage background images
  const stageDir = 'spatch-bgs';
  const stageOut = 'dist/stage';
  await Bun.$`mkdir -p ${stageOut}`;
  const stageGlob = new Bun.Glob('*.jpg');
  for (const file of stageGlob.scanSync(stageDir)) {
    await Bun.$`cp ${stageDir}/${file} ${stageOut}/${file}`;
  }
  console.log(`  Copied stage backgrounds to ${stageOut}/`);
```

**Step 2: Verify the build copies images**

Run: `bun run build && ls dist/stage/`

Expected: All 7 jpg files listed.

**Step 3: Commit**

```bash
git add build.ts
git commit -m "feat: copy stage background images to dist/stage/ during build"
```

---

### Task 2: Add stage theme button to HTML

**Files:**
- Modify: `index.html:39-42`

**Step 1: Add the button**

After the share button (line 41), add the stage theme cycle button:

```html
            <button id="btn-stage" class="action-btn" title="Stage: Minimal">
              <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-photo" /></svg>
            </button>
```

**Step 2: Verify the icon resolves**

Run: `bun run build`

Expected: Build succeeds, `tabler-sprite.svg` now includes the `photo` icon
(check console output for icon count increase).

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add stage theme cycle button to top toolbar"
```

---

### Task 3: Write stage theme CSS

**Files:**
- Modify: `css/style.css`

**Step 1: Add stage theme styles**

Insert a new section after the Canvas Area block (after line 261, before the
Play fan menu section). The styles define:

- `#canvas-area` base: add `position: relative` and `isolation: isolate` so
  pseudo-elements can be positioned.
- `#canvas-area::before` — gradient/image layer, hidden by default.
- `#canvas-area::after` — scan lines + tint overlay, hidden by default.
- `.stage-subtle` — shows `::before` as a soft pastel gradient, shows `::after`
  with faint scan lines.
- `.stage-florid` — shows `::before` as a background image (from
  `var(--stage-bg)`), shows `::after` with scan lines and a pastel gradient
  tint overlay.
- Reactive behavior via `--audio-level` custom property.
- `#canvas-wrap` gets `position: relative; z-index: 1` to sit above layers.

```css
/* ---- Stage Themes ---- */

#canvas-area {
  position: relative;
  isolation: isolate;
  --audio-level: 0;
  --stage-bg: none;
}

#canvas-area::before,
#canvas-area::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.4s ease;
}

/* Gradient / image layer */
#canvas-area::before {
  z-index: 0;
}

/* Scan lines + tint overlay */
#canvas-area::after {
  z-index: 0;
  background:
    repeating-linear-gradient(
      to bottom,
      transparent 0px,
      transparent 2px,
      rgba(0, 0, 0, 0.03) 2px,
      rgba(0, 0, 0, 0.03) 4px
    );
  transform: translateY(calc(var(--audio-level) * 4px));
}

#canvas-wrap {
  position: relative;
  z-index: 1;
}

/* Subtle: pastel gradient + faint scan lines */
.stage-subtle::before {
  opacity: 1;
  background: linear-gradient(
    135deg,
    #f0c4d0 0%,
    #d4bce8 35%,
    #b8d8e8 65%,
    #c8e8d4 100%
  );
}

.stage-subtle::after {
  opacity: 1;
  filter: hue-rotate(calc(var(--audio-level) * 30deg));
}

/* Florid: background image + gradient tint + scan lines */
.stage-florid::before {
  opacity: 1;
  background-image: var(--stage-bg);
  background-size: cover;
  background-position: center;
}

.stage-florid::after {
  opacity: 1;
  background:
    repeating-linear-gradient(
      to bottom,
      transparent 0px,
      transparent 2px,
      rgba(0, 0, 0, 0.03) 2px,
      rgba(0, 0, 0, 0.03) 4px
    ),
    linear-gradient(
      135deg,
      rgba(240, 196, 208, 0.3) 0%,
      rgba(212, 188, 232, 0.3) 35%,
      rgba(184, 216, 232, 0.3) 65%,
      rgba(200, 232, 212, 0.3) 100%
    );
  filter: hue-rotate(calc(var(--audio-level) * 30deg));
}
```

**Step 2: Verify build passes**

Run: `bun run build`

Expected: Build succeeds (CSS is bundled without errors).

**Step 3: Commit**

```bash
git add css/style.css
git commit -m "feat: add stage theme CSS classes with pseudo-element layers"
```

---

### Task 4: Create stage theme JS module

**Files:**
- Create: `js/stage.ts`

**Step 1: Write the module**

This module exports an `initStage` function that wires up the cycle button and
manages persistence. It also exports `setAudioLevel` for the render loop.

```typescript
const IMAGES = [
  'stage/blue-hall.jpg',
  'stage/cloud-carpet.jpg',
  'stage/excel-flyer.jpg',
  'stage/g-block.jpg',
  'stage/parking-elevator.jpg',
  'stage/shoe-dept.jpg',
  'stage/tile-towers.jpg',
];

const MODES = ['stage-minimal', 'stage-subtle', 'stage-florid'] as const;
type StageMode = (typeof MODES)[number];

const MODE_LABELS: Record<StageMode, string> = {
  'stage-minimal': 'Minimal',
  'stage-subtle': 'Subtle',
  'stage-florid': 'Florid',
};

interface StageState {
  modeIndex: number;
  imageIndex: number;
}

const STORAGE_KEY = 'stage-theme';

function load(): StageState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        modeIndex: typeof parsed.modeIndex === 'number' ? parsed.modeIndex % MODES.length : 0,
        imageIndex: typeof parsed.imageIndex === 'number' ? parsed.imageIndex % IMAGES.length : 0,
      };
    }
  } catch { /* ignore */ }
  return { modeIndex: 0, imageIndex: 0 };
}

function save(state: StageState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let area: HTMLElement;
let state: StageState;

function apply(): void {
  const mode = MODES[state.modeIndex]!;

  // Remove all stage classes
  for (const cls of MODES) area.classList.remove(cls);

  // Apply current (minimal has no class)
  if (mode !== 'stage-minimal') {
    area.classList.add(mode);
  }

  // Set background image for florid
  if (mode === 'stage-florid') {
    area.style.setProperty('--stage-bg', `url(${IMAGES[state.imageIndex]})`);
  }

  // Update button title
  const btn = document.getElementById('btn-stage');
  if (btn) {
    const label = MODE_LABELS[mode];
    const suffix = mode === 'stage-florid' ? ` (${state.imageIndex + 1}/${IMAGES.length})` : '';
    btn.title = `Stage: ${label}${suffix}`;
  }
}

export function initStage(): void {
  area = document.getElementById('canvas-area')!;
  state = load();
  apply();

  const btn = document.getElementById('btn-stage');
  if (btn) {
    btn.addEventListener('click', () => {
      const prevModeIndex = state.modeIndex;
      state.modeIndex = (state.modeIndex + 1) % MODES.length;

      // Advance image when wrapping from florid back to minimal
      if (prevModeIndex === MODES.length - 1 && state.modeIndex === 0) {
        state.imageIndex = (state.imageIndex + 1) % IMAGES.length;
      }

      save(state);
      apply();
    });
  }
}

export function setAudioLevel(level: number): void {
  if (area) {
    area.style.setProperty('--audio-level', level.toFixed(3));
  }
}
```

**Step 2: Verify typecheck**

Run: `bun run check`

Expected: No type errors.

**Step 3: Commit**

```bash
git add js/stage.ts
git commit -m "feat: add stage theme module with cycle, persistence, and audio level"
```

---

### Task 5: Wire stage module into app.ts

**Files:**
- Modify: `js/app.ts`

**Step 1: Import and initialize**

Add import at the top of `app.ts`:

```typescript
import { initStage, setAudioLevel } from './stage';
```

Call `initStage()` during initialization (after DOM is ready, near where
`resizeCanvas()` is first called).

**Step 2: Set audio level in render loop**

In the `renderLoop` function (around line 155), after the
`updateFrameShadow` call, add:

```typescript
    setAudioLevel(audio.getLevel());
```

**Step 3: Verify build and typecheck**

Run: `bun run check && bun run build`

Expected: Both pass.

**Step 4: Commit**

```bash
git add js/app.ts
git commit -m "feat: wire stage theme init and audio level into app render loop"
```

---

### Task 6: Write integration test

**Files:**
- Create: `tests/integration/stage-themes.test.js`

**Step 1: Write the test**

```javascript
import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Stage themes', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({
      path: path.join(import.meta.dirname, 'helpers/skip-splash.js'),
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('cycle button exists and starts on minimal', async ({ page }) => {
    const btn = page.locator('#btn-stage');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('title', 'Stage: Minimal');

    const area = page.locator('#canvas-area');
    await expect(area).not.toHaveClass(/stage-subtle/);
    await expect(area).not.toHaveClass(/stage-florid/);
  });

  test('clicking cycles through minimal → subtle → florid → minimal', async ({ page }) => {
    const btn = page.locator('#btn-stage');
    const area = page.locator('#canvas-area');

    // Click 1: minimal → subtle
    await btn.click();
    await expect(area).toHaveClass(/stage-subtle/);
    await expect(btn).toHaveAttribute('title', 'Stage: Subtle');

    // Click 2: subtle → florid
    await btn.click();
    await expect(area).toHaveClass(/stage-florid/);
    await expect(btn).toHaveAttribute('title', /Stage: Florid/);

    // Click 3: florid → minimal
    await btn.click();
    await expect(area).not.toHaveClass(/stage-subtle/);
    await expect(area).not.toHaveClass(/stage-florid/);
    await expect(btn).toHaveAttribute('title', 'Stage: Minimal');
  });

  test('theme persists across reload', async ({ page }) => {
    const btn = page.locator('#btn-stage');
    const area = page.locator('#canvas-area');

    // Set to subtle
    await btn.click();
    await expect(area).toHaveClass(/stage-subtle/);

    // Reload
    await page.reload();
    await page.waitForSelector('#sigil-canvas');

    await expect(area).toHaveClass(/stage-subtle/);
    await expect(btn).toHaveAttribute('title', 'Stage: Subtle');
  });

  test('florid mode advances image on full cycle', async ({ page }) => {
    const area = page.locator('#canvas-area');
    const btn = page.locator('#btn-stage');

    // Get to florid (image 1)
    await btn.click(); // subtle
    await btn.click(); // florid
    const bg1 = await area.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--stage-bg'),
    );

    // Full cycle: florid → minimal → subtle → florid (image 2)
    await btn.click(); // minimal
    await btn.click(); // subtle
    await btn.click(); // florid
    const bg2 = await area.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--stage-bg'),
    );

    expect(bg1).not.toEqual(bg2);
  });
});
```

**Step 2: Run integration tests**

Run: `bun run test:e2e`

Expected: All stage-themes tests pass. (This step requires the dev server to be
running. If using `bun run test:e2e`, ensure it starts the server or start it
manually with `bun run dev --serve` first.)

**Step 3: Commit**

```bash
git add tests/integration/stage-themes.test.js
git commit -m "test: add integration tests for stage theme cycling and persistence"
```

---

### Task 7: Manual verification and polish

**Step 1: Build and serve**

Run: `bun run dev --serve`

Open `http://localhost:3000` in a browser.

**Step 2: Verify visually**

- Click the stage button (photo icon in top toolbar).
- Confirm it cycles: flat gray → pastel gradient → background image → flat gray.
- Confirm each florid cycle shows a different image.
- Confirm the button title updates.
- Reload and confirm persistence.

**Step 3: Verify reactive behavior**

- Set theme to subtle or florid.
- Press and hold the play button.
- Confirm the gradient overlay subtly hue-shifts and scan lines drift during
  playback.

**Step 4: Run full test suite**

Run: `bun run test`

Expected: All tests pass (unit + integration).

**Step 5: Run typecheck and lint**

Run: `bun run check && bun run lint`

Expected: Clean.

**Step 6: Final commit if any polish was needed**

```bash
git add -A
git commit -m "chore: polish stage theme implementation"
```
