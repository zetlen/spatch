# Stage Appearance Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve stage backgrounds, splash timing, and toolbar presentation per #172.

**Architecture:** Remove scanline overlays and binary stage toggle. Replace with a simple linear image cycle (minimal texture first). Delay splash toolbar fade until audio stops. Add toolbar drop shadows.

**Tech Stack:** CSS, TypeScript, Vite virtual module, Playwright integration tests.

---

### Task 1: Remove Scanlines Overlay

Remove the `::before`/`::after` pseudo-elements on `#stage` and the
`--audio-level` CSS variable and JS plumbing that drives them.

**Files:**
- Modify: `css/style.css:193-535` (stage section)
- Modify: `js/stage.ts:79-83` (delete `setAudioLevel`)
- Modify: `js/app.ts:11,114` (remove `setAudioLevel` import and call)

**Step 1: Remove `setAudioLevel` from stage.ts**

Delete the export and its body (lines 79–83):

```typescript
// DELETE these lines from stage.ts:
export function setAudioLevel(level: number): void {
  if (area) {
    area.style.setProperty('--audio-level', level.toFixed(3));
  }
}
```

**Step 2: Remove `setAudioLevel` from app.ts**

In `js/app.ts` line 11, change the import:
```typescript
// FROM:
import { initStage, setAudioLevel } from './stage.ts';
// TO:
import { initStage } from './stage.ts';
```

In `js/app.ts` line 114, delete the `setAudioLevel` call:
```typescript
// DELETE this line from the renderLoop function:
    setAudioLevel(audio.getLevel());
```

**Step 3: Remove scanline CSS**

In `css/style.css`, delete the `--audio-level` variable from `#stage` (line 204),
and delete the entire pseudo-element block (lines 474–535):

```css
/* DELETE all of these rules: */

#stage::before,
#stage::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.4s ease;
  z-index: 0;
}

#stage::after {
  background: repeating-linear-gradient(/* ... */);
  transform: translateY(calc(var(--audio-level) * 4px));
}

#stage.stage-florid::before {
  opacity: 1;
  background-image: var(--stage-bg);
  background-size: cover;
  background-position: center;
}

#stage.stage-florid::after {
  opacity: 1;
  background: /* ... */;
  filter: hue-rotate(calc(var(--audio-level) * 30deg));
}
```

**Step 4: Verify build**

Run: `bun run check && bun run build`
Expected: Clean typecheck, successful build.

**Step 5: Commit**

```bash
git add js/stage.ts js/app.ts css/style.css
git commit -m "refactor: remove scanlines overlay and setAudioLevel (#172)"
```

---

### Task 2: Simplify Stage to Linear Image Cycle

Replace the binary white/florid toggle with a simple cycle through all images.
The background always shows an image (no "white" mode). Remove `stage-florid`
class entirely.

**Files:**
- Modify: `js/stage.ts` (simplify state and cycling)
- Modify: `css/style.css` (remove `stage-florid` rules, make background always active)
- Modify: `tests/integration/stage-themes.test.js` (update assertions)

**Step 1: Simplify stage.ts**

Rewrite `stage.ts` to remove the `florid` boolean. State is just `imageIndex`.
Every click advances to the next image. Background is always applied.

```typescript
import IMAGES from 'virtual:scene-images';
import { qel } from './dom.ts';

const STORAGE_KEY = 'stage-theme';

function loadIndex(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Support old format (had florid + imageIndex) and new (just index)
      const idx = typeof parsed === 'number' ? parsed : parsed.imageIndex ?? 0;
      return idx % IMAGES.length;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

function saveIndex(index: number): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
}

let app: HTMLElement;
let area: HTMLElement;
let imageIndex: number;

function apply(): void {
  const bgUrl = `url(${IMAGES[imageIndex]})`;
  area.style.setProperty('--stage-bg', bgUrl);
  app.style.setProperty('--stage-bg', bgUrl);
}

export function initStage(): void {
  app = qel('#app');
  area = qel('#stage');
  imageIndex = loadIndex();
  apply();

  const btn = document.querySelector<HTMLElement>('#btn-stage');
  if (btn) {
    btn.addEventListener('click', () => {
      imageIndex = (imageIndex + 1) % IMAGES.length;
      saveIndex(imageIndex);
      apply();
    });
  }
}
```

**Step 2: Update CSS — remove stage-florid, always show background**

Remove the `stage-florid` gated rules and make the background always active.
In `css/style.css`:

Remove `--stage-bg: none;` default from `#stage` (line 205). Instead keep
`--stage-bg` unset (it's set by JS immediately).

Replace the florid-gated rules (lines 486–495 area) with always-on rules:

```css
/* Scene background on app — extends behind transparent toolbars */
#app {
  background-image: var(--stage-bg);
  background-size: cover;
  background-position: center;
}

#stage {
  /* stage background is transparent — image shows through from #app */
  background: transparent;
}
```

Delete these rules entirely:
- `#app.stage-florid` (lines 486–491)
- `#app.stage-florid #stage` (lines 493–495)
- `#app.stage-florid .toolbar-expansion` (lines 653–656) — the expansion
  backdrop blur should now always apply; change the selector to just
  `.toolbar-expansion`:

```css
.toolbar-expansion {
  background: color-mix(in srgb, var(--bg-toolbar) 80%, transparent);
  backdrop-filter: blur(8px);
}
```

Update the base `.toolbar-expansion` rule (lines 66–74) to merge with this
(remove the old `background: var(--bg-toolbar)` since the color-mix replaces it).

**Step 3: Update stage integration tests**

Rewrite `tests/integration/stage-themes.test.js`:

```javascript
import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Stage themes', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({
      path: path.join(import.meta.dirname, 'helpers/skip-splash.js'),
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('stage always has a background image', async ({ page }) => {
    const app = page.locator('#app');
    const bg = await app.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain('url(');
  });

  test('clicking advances to next image', async ({ page }) => {
    const app = page.locator('#app');
    const btn = page.locator('#btn-stage');

    const bg1 = await app.evaluate((el) => getComputedStyle(el).backgroundImage);
    await btn.click();
    const bg2 = await app.evaluate((el) => getComputedStyle(el).backgroundImage);

    expect(bg1).not.toEqual(bg2);
  });

  test('image persists across reload', async ({ page }) => {
    const app = page.locator('#app');
    const btn = page.locator('#btn-stage');

    await btn.click();
    const bg1 = await app.evaluate((el) => getComputedStyle(el).backgroundImage);

    await page.reload();
    await page.waitForSelector('#sigil-canvas');

    const bg2 = await app.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg1).toEqual(bg2);
  });

  test('cycle wraps around', async ({ page }) => {
    const app = page.locator('#app');
    const btn = page.locator('#btn-stage');

    const bg0 = await app.evaluate((el) => getComputedStyle(el).backgroundImage);

    // Click through all images (count = number of scene images)
    const count = await page.evaluate(() => {
      // Read the CSS variable to count distinct images
      return 8; // 7 scene images + 1 minimal texture
    });
    for (let i = 0; i < count; i++) {
      await btn.click();
    }

    const bgWrapped = await app.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bgWrapped).toEqual(bg0);
  });
});
```

**Step 4: Run tests**

Run: `bun run check && bun run test:e2e -- --grep "Stage themes"`
Expected: All stage theme tests pass.

**Step 5: Commit**

```bash
git add js/stage.ts css/style.css tests/integration/stage-themes.test.js
git commit -m "refactor: simplify stage to linear image cycle (#172)"
```

---

### Task 3: Create Minimal Stage Texture

Create a tileable Snow White / Platinum texture image and add it as the first
scene image in the cycle.

**Files:**
- Create: `img/scene/00-minimal.jpg`

**Step 1: Generate the texture**

Use ImageMagick to create a 512x512 tileable warm-grey speckled texture
resembling the Apple Snow White / Platinum plastic finish. The color should
be close to the toolbar beige (`#d5d0cb` to `#e0dbd6`).

```bash
convert -size 512x512 xc:'#ddd8d3' \
  -seed 42 +noise Gaussian \
  -blur 0x0.5 \
  -modulate 100,30,100 \
  -level 35%,65% \
  -quality 90 \
  img/scene/00-minimal.jpg
```

If the result doesn't look right, iterate. The key properties:
- Base color: warm platinum grey (~`#ddd8d3`)
- Very subtle fine-grained speckle (like matte plastic)
- Should tile seamlessly
- Should be barely distinguishable from a flat color at small sizes

**Step 2: Verify it appears first in the cycle**

Run: `ls img/scene/` and confirm `00-minimal.jpg` sorts first alphabetically.
The Vite config (`vite.config.ts:11-13`) sorts scene files with `.toSorted()`,
so `00-` prefix ensures it's first.

**Step 3: Test in browser**

Run: `bun run dev`
Open http://localhost:5173 — the minimal texture should be the default stage
background on first load. Click the stage button to cycle through all images.

**Step 4: Commit**

```bash
git add img/scene/00-minimal.jpg
git commit -m "feat: add Snow White minimal stage texture (#172)"
```

---

### Task 4: Toolbar Drop Shadows

Add subtle, always-present box-shadows to both toolbars.

**Files:**
- Modify: `css/style.css:52-57,86-94` (toolbar rules)

**Step 1: Add box-shadow to toolbar CSS**

In `css/style.css`, add `box-shadow` to the toolbar rules:

```css
#toolbar-top {
  /* ...existing properties... */
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12);
}

#toolbar-bottom {
  /* ...existing properties... */
  box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.12);
}
```

**Step 2: Verify visually**

Run: `bun run dev`
Both toolbars should have a subtle shadow separating them from the stage.

**Step 3: Commit**

```bash
git add css/style.css
git commit -m "feat: add drop shadows to toolbars (#172)"
```

---

### Task 5: Delay Splash Fade Until Audio Stops

Change the splash reveal so toolbars remain hidden until playback fully ends
(release + reverb tail), then fade in.

**Files:**
- Modify: `js/splash.ts:105-152` (`splashReveal` method)
- Modify: `tests/integration/splash.test.js` (update timing expectations)

**Step 1: Rewrite splashReveal to wait for audio stop**

The current flow: reveal UI immediately, release audio after sustain delay.
New flow: release audio after sustain delay, wait for release to finish,
THEN reveal UI.

```typescript
private splashReveal(delayAudioRelease: number, playReady: Promise<void>): void {
  const FADE_DURATION = 0.5;
  const topBar = qel('#toolbar-top');
  const botBar = qel('#toolbar-bottom');

  // Mark URL as seen immediately (even though UI isn't visible yet)
  this._isActive = false;
  localStorage.setItem(this.splashKey, '1');

  const doRelease = async () => {
    try {
      await playReady;
    } catch {}
    if (!this.audio.isPlaying) {
      this.playback.forceStop();
      this.revealToolbars(topBar, botBar, FADE_DURATION);
      return;
    }
    this.playback.releaseAndIdle();

    // Wait for the release envelope + reverb tail to finish before revealing
    const state = this.playback['getState']();
    const releaseMs = state.envelope.release * 1000 + 100;
    setTimeout(() => {
      this.revealToolbars(topBar, botBar, FADE_DURATION);
    }, releaseMs);
  };

  if (delayAudioRelease > 0) {
    setTimeout(doRelease, delayAudioRelease);
  } else {
    doRelease();
  }

  this.removeSplashListeners();
}

private revealToolbars(topBar: HTMLElement, botBar: HTMLElement, duration: number): void {
  topBar.style.transitionDuration = `${duration}s`;
  botBar.style.transitionDuration = `${duration}s`;
  document.body.classList.add('is-editing');

  topBar.addEventListener(
    'transitionend',
    () => {
      topBar.style.transitionDuration = '';
      botBar.style.transitionDuration = '';
    },
    { once: true },
  );
}
```

Note: accessing `this.playback['getState']()` is not ideal. Instead, we can
compute `releaseMs` from the playback controller. The `releaseAndIdle` method
already computes `releaseMs` internally. A cleaner approach: have
`releaseAndIdle()` return the release duration in ms.

**Alternative — modify `releaseAndIdle` to return releaseMs:**

In `js/playback.ts`, change `releaseAndIdle`:
```typescript
releaseAndIdle(): number {
  const state = this.getState();
  this.audio.release(state.envelope);
  this.playBtn.classList.remove('playing');
  this.setPlayIcon(false);
  this.playState = 'idle';
  this.updatePlayIndicators();
  const releaseMs = state.envelope.release * 1000 + 100;
  this.releaseGlowTimeoutId = setTimeout(() => {
    this.releaseGlowTimeoutId = undefined;
    this.requestRender();
  }, releaseMs);
  return releaseMs;
}
```

Then in `splashReveal`:
```typescript
const releaseMs = this.playback.releaseAndIdle();
setTimeout(() => {
  this.revealToolbars(topBar, botBar, FADE_DURATION);
}, releaseMs);
```

**Step 2: Update splash integration tests**

The "quick tap reveals UI immediately" test needs a longer timeout since the
UI now waits for audio release. Update the assertion timeout:

In `tests/integration/splash.test.js`, the test "quick tap reveals UI
immediately" should be renamed and its timeout increased:

```javascript
test('tap reveals UI after audio finishes', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.waitForSelector('#sigil-canvas');

  await expect(page.locator('body')).not.toHaveClass(/is-editing/);

  const canvas = page.locator('#sigil-canvas');
  const box = await canvas.boundingBox();

  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

  // UI reveals after audio release — allow up to 8s for sustain + release + fade
  await expect(page.locator('body')).toHaveClass(/is-editing/, { timeout: 8000 });
});
```

**Step 3: Run tests**

Run: `bun run check && bun run test:e2e -- --grep "splash"`
Expected: All splash tests pass.

**Step 4: Commit**

```bash
git add js/splash.ts js/playback.ts tests/integration/splash.test.js
git commit -m "feat: delay splash toolbar reveal until audio stops (#172)"
```

---

### Task 6: Final Verification

**Step 1: Run full test suite**

Run: `bun run test`
Expected: All unit and integration tests pass.

**Step 2: Run typecheck and lint**

Run: `bun run check && bun run lint`
Expected: Clean.

**Step 3: Manual smoke test**

Run: `bun run dev`
Verify:
- Default stage shows minimal platinum texture
- Stage button cycles through all images (minimal first, then scenes, wraps)
- No scanline overlay on any stage
- Splash: audio plays, toolbars appear after sound fades out
- Toolbars have subtle drop shadow in all modes
- No color bands visible during splash

**Step 4: Commit any remaining fixes, then push**
