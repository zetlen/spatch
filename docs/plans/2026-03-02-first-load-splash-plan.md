# First-Load Splash Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** On first visit per URL, hide toolbars and let the user click/hold the canvas to play the sigil, then reveal the editor during the audio release phase.

**Architecture:** A `body.splash` CSS class hides toolbars with `opacity: 0` (no layout shift). JS adds the class on load if localStorage says this URL hasn't been seen. Pointer events on the canvas area start/stop playback and orchestrate the reveal. One-shot — after reveal, splash code is inert.

**Tech Stack:** Vanilla CSS transitions, vanilla JS/TS pointer events, localStorage, existing AudioEngine API.

---

### Task 1: Add CSS splash rules

**Files:**

- Modify: `css/style.css` (append after line 655, before the closing of the file)

**Step 1: Add the CSS rules**

Append these rules at the end of `css/style.css`:

```css
/* ---- First-load splash ---- */

body.splash #toolbar-top,
body.splash #toolbar-bottom {
  opacity: 0;
  pointer-events: none;
  transition-property: opacity;
  transition-timing-function: ease-out;
  /* transition-duration set dynamically by JS at reveal time */
}

body.splash .panel {
  opacity: 0;
  pointer-events: none;
}
```

**Step 2: Verify build**

Run: `bun run build`
Expected: Clean build, no errors.

**Step 3: Commit**

```bash
git add css/style.css
git commit -m "Add CSS rules for first-load splash toolbar hiding (#56)"
```

---

### Task 2: Add splash initialization and localStorage gating

This task adds the splash class to the body on load and the localStorage check. No interaction logic yet.

**Files:**

- Modify: `js/app.ts:64-69` (after URL load, before reverb shadow section)

**Step 1: Write the failing test**

Create `tests/integration/splash.test.js`:

```js
import { test, expect } from '@playwright/test';

test.describe('First-load splash', () => {
  test.beforeEach(async ({ context }) => {
    // Clear localStorage so splash always activates
    await context.clearCookies();
  });

  test('splash class is present on first visit', async ({ page }) => {
    // Clear localStorage before navigating
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // body should have .splash on first visit
    await expect(page.locator('body')).toHaveClass(/splash/);

    // Toolbars should be invisible
    const topToolbar = page.locator('#toolbar-top');
    await expect(topToolbar).toHaveCSS('opacity', '0');
  });

  test('splash class is NOT present on repeat visit', async ({ page }) => {
    // Simulate a previous visit by setting the localStorage key
    await page.addInitScript(() => {
      localStorage.setItem('spatch-seen:/', '1');
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // body should NOT have .splash
    await expect(page.locator('body')).not.toHaveClass(/splash/);
  });

  test('splash class is URL-specific', async ({ page }) => {
    // Mark root as seen, but not a hash URL
    await page.addInitScript(() => {
      localStorage.setItem('spatch-seen:/', '1');
    });
    await page.goto('/#somehash');
    await page.waitForSelector('#sigil-canvas');

    // Different URL should still show splash
    await expect(page.locator('body')).toHaveClass(/splash/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bunx playwright test tests/integration/splash.test.js --reporter=line`
Expected: FAIL — body does not have class "splash".

**Step 3: Implement splash initialization in app.ts**

In `js/app.ts`, after the URL load block (line 69) and before the reverb shadow section (line 71), insert:

```typescript
// ---- First-load splash ----

const splashKey = `spatch-seen:${location.pathname}${location.hash}`;
const isSplash = !localStorage.getItem(splashKey);
if (isSplash) {
  document.body.classList.add('splash');
}
```

**Step 4: Run test to verify it passes**

Run: `bunx playwright test tests/integration/splash.test.js --reporter=line`
Expected: All 3 tests PASS.

**Step 5: Commit**

```bash
git add js/app.ts tests/integration/splash.test.js
git commit -m "Add splash initialization with localStorage gating (#56)"
```

---

### Task 3: Add splash pointer interaction and reveal

This task wires up the canvas-area pointer events for hold-to-play and the reveal transition.

**Files:**

- Modify: `js/app.ts` (add splash interaction code after the splash init block from Task 2, and guard keyboard Space handler)

**Step 1: Write the failing tests**

Append to `tests/integration/splash.test.js`:

```js
test.describe('First-load splash interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
  });

  test('clicking canvas during splash starts playback and reveals editor', async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/audio-tap.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // Place a shape so there's something to play
    // We need to bypass splash for shape placement, so we'll load a URL with a sigil
    // Actually — during splash, pointer events on canvas are captured by splash handler,
    // so we need a sigil pre-loaded via URL hash.
    // For this test, just test the empty-canvas case (silence).
    const canvas = page.locator('#sigil-canvas');

    // Verify splash is active
    await expect(page.locator('body')).toHaveClass(/splash/);

    // Click and hold on canvas for 2.5 seconds
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();

    // Wait 2.5 seconds (past the 2s minimum)
    await page.waitForTimeout(2500);

    // Release
    await page.mouse.up();

    // After release, splash class should be removed (with some time for the transition)
    await expect(page.locator('body')).not.toHaveClass(/splash/, { timeout: 5000 });

    // Toolbars should now be visible
    await expect(page.locator('#toolbar-top')).toHaveCSS('opacity', '1');
  });

  test('quick tap waits 2 seconds before revealing', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    const canvas = page.locator('#sigil-canvas');
    await expect(page.locator('body')).toHaveClass(/splash/);

    // Quick tap (click and immediately release)
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Splash should still be present immediately after click (2s minimum)
    await page.waitForTimeout(500);
    await expect(page.locator('body')).toHaveClass(/splash/);

    // But after 2s + release time, it should be gone
    await expect(page.locator('body')).not.toHaveClass(/splash/, { timeout: 5000 });
  });

  test('localStorage is set after splash completes', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Wait for splash to complete
    await expect(page.locator('body')).not.toHaveClass(/splash/, { timeout: 5000 });

    // Check localStorage was set
    const key = await page.evaluate(() => localStorage.getItem('spatch-seen:/'));
    expect(key).toBe('1');
  });

  test('keyboard Space is blocked during splash', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await expect(page.locator('body')).toHaveClass(/splash/);

    // Press Space — should NOT start playback or toggle latch
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);

    // Play button should not be in playing state
    await expect(page.locator('#btn-play')).not.toHaveClass(/playing/);

    // Splash should still be active
    await expect(page.locator('body')).toHaveClass(/splash/);
  });
});
```

Add the `path` import at the top of the file if not already present:

```js
import path from 'path';
```

**Step 2: Run tests to verify they fail**

Run: `bunx playwright test tests/integration/splash.test.js --reporter=line`
Expected: The new tests FAIL (splash interaction not yet implemented).

**Step 3: Implement splash interaction in app.ts**

After the splash init block (from Task 2), add the splash interaction code:

```typescript
if (isSplash) {
  const canvasArea = document.getElementById('canvas-area')!;
  const MIN_SUSTAIN_MS = 2000;
  let splashDownTime = 0;
  let splashMinTimer: ReturnType<typeof setTimeout> | null = null;
  let splashPointerDown = false;

  function splashReveal(): void {
    const releaseSeconds = Math.max(0.3, store.data.envelope.release);
    const topBar = document.getElementById('toolbar-top')!;
    const botBar = document.getElementById('toolbar-bottom')!;

    // Set transition duration to match release time
    topBar.style.transitionDuration = `${releaseSeconds}s`;
    botBar.style.transitionDuration = `${releaseSeconds}s`;

    // Trigger audio release
    audio.release(store.data.envelope);

    // Update play button state
    playBtn.classList.remove('playing');
    playBtn.textContent = '\u25B6 PLAY';
    playState = 'idle';

    // Schedule glow cleanup
    const releaseMs = store.data.envelope.release * 1000 + 100;
    releaseGlowTimeoutId = setTimeout(() => {
      releaseGlowTimeoutId = null;
      needsRender = true;
    }, releaseMs);

    // Remove splash class — triggers CSS opacity transition
    document.body.classList.remove('splash');

    // Mark URL as seen
    localStorage.setItem(splashKey, '1');

    // Clean up inline transition-duration after transition ends
    topBar.addEventListener(
      'transitionend',
      () => {
        topBar.style.transitionDuration = '';
        botBar.style.transitionDuration = '';
      },
      { once: true },
    );

    // Remove splash pointer listeners
    canvasArea.removeEventListener('pointerdown', splashDown);
    canvasArea.removeEventListener('pointerup', splashUp);
  }

  function splashDown(e: PointerEvent): void {
    e.preventDefault();
    if (splashPointerDown) return; // Ignore multi-touch
    splashPointerDown = true;
    splashDownTime = Date.now();

    // Start playback (works even with empty canvas — silence)
    startPlayback();
  }

  function splashUp(e: PointerEvent): void {
    if (!splashPointerDown) return;
    splashPointerDown = false;

    const elapsed = Date.now() - splashDownTime;

    if (elapsed >= MIN_SUSTAIN_MS) {
      // Held long enough — reveal immediately
      splashReveal();
    } else {
      // Quick tap — wait for remainder of 2s, then reveal
      splashMinTimer = setTimeout(() => {
        splashMinTimer = null;
        splashReveal();
      }, MIN_SUSTAIN_MS - elapsed);
    }
  }

  canvasArea.addEventListener('pointerdown', splashDown);
  canvasArea.addEventListener('pointerup', splashUp);
}
```

Then guard the keyboard Space handler. In the existing `keydown` handler (around line 644), wrap the Space block:

Change:

```typescript
  if (e.key === ' ') {
    e.preventDefault();
    if (playState !== 'idle') {
```

To:

```typescript
  if (e.key === ' ') {
    e.preventDefault();
    if (isSplash && document.body.classList.contains('splash')) return;
    if (playState !== 'idle') {
```

But `isSplash` is scoped inside the splash init block. To fix this, hoist the `isSplash` variable. Change the splash init from:

```typescript
const isSplash = !localStorage.getItem(splashKey);
```

The `splashKey` and `isSplash` should be declared at module scope (right after `const loaded = loadFromURL()` and its block):

```typescript
const splashKey = `spatch-seen:${location.pathname}${location.hash}`;
let splashActive = !localStorage.getItem(splashKey);
if (splashActive) {
  document.body.classList.add('splash');
}
```

Then the Space guard becomes:

```typescript
  if (e.key === ' ') {
    e.preventDefault();
    if (splashActive) return;
    if (playState !== 'idle') {
```

And in `splashReveal`, set `splashActive = false` alongside removing the class.

**Step 4: Run tests to verify they pass**

Run: `bunx playwright test tests/integration/splash.test.js --reporter=line`
Expected: All tests PASS.

**Step 5: Run the full test suite**

Run: `bun run test`
Expected: All existing tests still pass. (Existing playback tests may need adjustment since they navigate to `/` which now has splash active. See Task 4.)

**Step 6: Commit**

```bash
git add js/app.ts tests/integration/splash.test.js
git commit -m "Add splash pointer interaction and editor reveal (#56)"
```

---

### Task 4: Fix existing integration tests for splash

Existing integration tests navigate to `/` which now shows the splash. They need to either dismiss the splash first or bypass it by pre-setting localStorage.

**Files:**

- Modify: All files in `tests/integration/` that use `page.goto('/')` — add a `beforeEach` or `addInitScript` that sets the localStorage key to skip splash.

**Step 1: Create a shared helper**

Create `tests/integration/helpers/skip-splash.js`:

```js
// Skip the first-load splash by marking the current URL as seen.
// Use via: await page.addInitScript({ path: 'tests/integration/helpers/skip-splash.js' });
localStorage.setItem('spatch-seen:/', '1');
```

**Step 2: Add the helper to existing test files**

For each test file in `tests/integration/` (except `splash.test.js`), add the skip-splash init script in the `beforeEach`:

```js
await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
```

Files to update:

- `tests/integration/playback.test.js`
- `tests/integration/play-modes.test.js`
- `tests/integration/adsr-corners.test.js`
- `tests/integration/share-menu.test.js`
- `tests/integration/serialization.test.js`
- `tests/integration/shape-placement.test.js`

Check each file — if it already has a `beforeEach`, add the line there. If it doesn't, add one. Make sure `path` is imported.

**Step 3: Run the full test suite**

Run: `bun run test`
Expected: All tests pass, including the new splash tests and all existing tests.

**Step 4: Commit**

```bash
git add tests/integration/
git commit -m "Add skip-splash helper to existing integration tests (#56)"
```

---

### Task 5: Manual QA and edge case verification

No code changes — manual verification in the browser.

**Step 1: Build and serve**

Run: `bun run dev && bunx serve dist`

**Step 2: Test first visit (empty canvas)**

1. Open incognito window, navigate to `http://localhost:3000`
2. Verify: Only the canvas frame is visible (dark square). No toolbars.
3. Click and hold the canvas. Audio plays (silence since no shapes).
4. Release after 3 seconds. Toolbars fade in.
5. Refresh. Toolbars should appear immediately (no splash).

**Step 3: Test first visit with sigil URL**

1. Open the app normally, create a sigil, copy the share link.
2. Open incognito window, paste the share link.
3. Verify: Sigil visible on canvas, no toolbars.
4. Quick tap the canvas. Audio plays for 2 seconds, then toolbars fade in.

**Step 4: Test URL specificity**

1. After dismissing splash at `/`, navigate to `/#somehash`.
2. Verify: Splash shows again for the new URL.

**Step 5: Commit any fixes**

If issues are found, fix and commit each one individually.
