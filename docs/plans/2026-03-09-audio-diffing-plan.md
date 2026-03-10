# Audio Diffing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Catch audio synthesis regressions by snapshot-diffing waveform PNGs in Playwright tests.

**Architecture:** Monkey-patch `AudioContext` → `OfflineAudioContext` in a Playwright helper (same pattern as `audio-tap.js`). After the app builds its audio graph and triggers play, call `startRendering()` to deterministically process the buffer. Downsample to a 1024×256 canvas, transfer as PNG, diff with `toMatchSnapshot()`.

**Tech Stack:** Playwright, Web Audio OfflineAudioContext, Canvas 2D

---

### Task 1: Create audio-capture.js helper

**Files:**
- Create: `tests/integration/helpers/audio-capture.js`

**Step 1: Write the helper**

This follows the same IIFE + monkey-patch pattern as `audio-tap.js`. It replaces
`AudioContext` with an `OfflineAudioContext` and exposes a capture API.

```js
/**
 * Audio capture helper for Playwright snapshot tests.
 * Replaces AudioContext with OfflineAudioContext for deterministic rendering.
 * Call page.addInitScript({ path: '...helpers/audio-capture.js' }) before navigating.
 *
 * API: globalThis.__audioCapture.captureWaveform({ duration? }) → base64 PNG
 */

(function () {
  const OriginalOfflineAudioContext =
    globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OriginalOfflineAudioContext) {
    return;
  }

  const SAMPLE_RATE = 44100;
  const MAX_DURATION = 10; // seconds — pre-allocated buffer ceiling

  let capturedCtx = null;

  globalThis.AudioContext = function AudioContext() {
    const ctx = new OriginalOfflineAudioContext(
      2,
      SAMPLE_RATE * MAX_DURATION,
      SAMPLE_RATE,
    );
    capturedCtx = ctx;

    // Shim resume() — OfflineAudioContext.resume() resumes suspended rendering,
    // but the app calls it expecting AudioContext.resume() semantics (initial unlock).
    // Make it a safe no-op.
    ctx.resume = () => Promise.resolve();

    // Shim createMediaStreamDestination() — not available on OfflineAudioContext.
    // Returns a gain node connected nowhere (the iOS Safari keep-alive path is
    // irrelevant in headless test browsers).
    ctx.createMediaStreamDestination = () => {
      const dummy = ctx.createGain();
      // Give it a .stream property so the engine's `_streamDest.stream` access
      // doesn't throw.
      dummy.stream = new MediaStream();
      return dummy;
    };

    return ctx;
  };

  // Preserve prototype chain so instanceof checks don't break
  globalThis.AudioContext.prototype =
    OriginalOfflineAudioContext.prototype;

  // Expose capture API
  globalThis.__audioCapture = {
    /**
     * Render the offline context and return the AudioBuffer.
     * Can only be called once per page load (OfflineAudioContext limitation).
     */
    async render() {
      if (!capturedCtx) {
        throw new Error('No AudioContext was created');
      }
      return capturedCtx.startRendering();
    },

    /**
     * Render audio and return a downsampled waveform PNG as a base64 string.
     * @param {{ duration?: number }} opts
     *   duration: seconds of audio to draw (default: 5, max: MAX_DURATION)
     */
    async captureWaveform({ duration = 5 } = {}) {
      const buffer = await this.render();

      const WIDTH = 1024;
      const HEIGHT = 256;
      const HALF = HEIGHT / 2;

      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const g = canvas.getContext('2d');

      // Black background
      g.fillStyle = '#000';
      g.fillRect(0, 0, WIDTH, HEIGHT);

      // Clamp duration to actual buffer length
      const sampleCount = Math.min(
        Math.floor(duration * buffer.sampleRate),
        buffer.length,
      );
      const samplesPerPixel = Math.floor(sampleCount / WIDTH);

      // Draw each channel: L in top half, R in bottom half
      const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
      const colors = ['#00ff00', '#00cc88'];

      for (let ch = 0; ch < 2; ch++) {
        const data = channels[ch];
        const yOffset = ch * HALF;
        g.strokeStyle = colors[ch];
        g.lineWidth = 1;
        g.beginPath();

        for (let px = 0; px < WIDTH; px++) {
          // Average samples for this pixel column
          let sum = 0;
          const start = px * samplesPerPixel;
          for (let s = 0; s < samplesPerPixel; s++) {
            sum += data[start + s];
          }
          const avg = sum / samplesPerPixel;
          // Map [-1, 1] to [yOffset, yOffset + HALF]
          const y = yOffset + ((1 - avg) / 2) * HALF;
          if (px === 0) g.moveTo(px, y);
          else g.lineTo(px, y);
        }
        g.stroke();
      }

      // Return as base64 PNG
      return canvas.toDataURL('image/png').split(',')[1];
    },
  };
})();
```

**Step 2: Verify the helper loads without errors**

Run a quick Playwright sanity check (will be replaced by real tests in Task 2):

```bash
bunx playwright test tests/integration/audio-snapshot.test.js --reporter=list 2>&1 | head -20
```

Expected: file not found (test doesn't exist yet). That's fine — confirms setup.

**Step 3: Commit**

```bash
git add tests/integration/helpers/audio-capture.js
git commit -m "feat: add audio-capture Playwright helper for waveform snapshots"
```

---

### Task 2: Create audio-snapshot.test.js

**Files:**
- Create: `tests/integration/audio-snapshot.test.js`

**Step 1: Write the test file**

Start with two test cases: a single sine voice and a single triangle voice.
These establish the baseline pattern for all future audio snapshot tests.

```js
import { expect, test } from '@playwright/test';
import path from 'path';

/** Helper: place a shape at canvas center using the given tool. */
async function placeShape(page, tool) {
  await page.click(`[data-tool="${tool}"]`);
  const canvas = page.locator('#sigil-canvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
}

test.describe('Audio waveform snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({
      path: path.join(import.meta.dirname, 'helpers/skip-splash.js'),
    });
    await page.addInitScript({
      path: path.join(import.meta.dirname, 'helpers/audio-capture.js'),
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('single sine voice', async ({ page }) => {
    await placeShape(page, 'circle');

    // Trigger latched play via Space
    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    const png = await page.evaluate(async () => {
      return globalThis.__audioCapture.captureWaveform({ duration: 2 });
    });

    expect(Buffer.from(png, 'base64')).toMatchSnapshot('sine-voice.png');
  });

  test('single triangle voice', async ({ page }) => {
    await placeShape(page, 'triangle');

    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    const png = await page.evaluate(async () => {
      return globalThis.__audioCapture.captureWaveform({ duration: 2 });
    });

    expect(Buffer.from(png, 'base64')).toMatchSnapshot('triangle-voice.png');
  });
});
```

**Step 2: Run the tests to generate baseline snapshots**

```bash
bunx playwright test tests/integration/audio-snapshot.test.js --update-snapshots --reporter=list
```

Expected: both tests pass, baseline PNGs written to
`tests/integration/audio-snapshot.test.js-snapshots/`.

**Step 3: Verify the baselines visually**

Open the generated PNG files and confirm they show non-trivial waveforms
(not flat lines, not noise). The sine voice should show a smooth undulating
waveform. The triangle voice should show a slightly more angular shape with
harmonics.

**Step 4: Run tests again WITHOUT --update-snapshots**

```bash
bunx playwright test tests/integration/audio-snapshot.test.js --reporter=list
```

Expected: both tests pass (snapshots match baselines — deterministic rendering).

**Step 5: Commit everything**

```bash
git add tests/integration/audio-snapshot.test.js \
        tests/integration/audio-snapshot.test.js-snapshots/
git commit -m "test: add audio waveform snapshot tests for sine and triangle voices"
```

---

### Task 3: Verify CI compatibility

**Step 1: Run the full test suite**

```bash
bun run test
```

Expected: all existing tests still pass, new snapshot tests pass.

The audio-capture helper does NOT conflict with audio-tap.js because they
are loaded via separate `addInitScript` calls per test file. Tests that use
`audio-tap.js` keep using the real AudioContext. Tests that use
`audio-capture.js` get the OfflineAudioContext.

**Step 2: Run typecheck and lint**

```bash
bun run check && bun run lint
```

Expected: clean.

**Step 3: Final commit if any fixes needed, then push**

```bash
git push origin audio-diffing
```
