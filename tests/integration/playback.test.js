import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Playback', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/audio-tap.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('pressing play with a shape produces audio', async ({ page }) => {
    // Place a circle shape
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Use Space to latch-play (verifies audio starts)
    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    // Wait a bit for audio to stabilize
    await page.waitForTimeout(200);

    // Check audio tap shows non-zero amplitude
    const isPlaying = await page.evaluate(() => globalThis.__audioTap?.isPlaying());
    expect(isPlaying).toBe(true);

    // Press Space again to stop
    await page.keyboard.press('Space');

    // After release time, .playing class should be removed
    await expect(page.locator('#btn-play')).not.toHaveClass(/playing/, { timeout: 5000 });
  });

  test('play button shows stop icon while playing', async ({ page }) => {
    // Place a shape first
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    const playBtn = page.locator('#btn-play');
    const playIcon = playBtn.locator('.play-icon');

    // Before playing — inline path (custom play triangle, no <use>)
    await expect(playIcon.locator('path')).toBeVisible();
    await expect(playIcon.locator('use')).toHaveCount(0);

    // Start playing via Space (latched)
    await page.keyboard.press('Space');
    await expect(playIcon.locator('use')).toHaveAttribute('href', /player-stop-filled/);

    // Press Space again to stop
    await page.keyboard.press('Space');
    await expect(playIcon.locator('path')).toBeVisible({ timeout: 5000 });
    await expect(playIcon.locator('use')).toHaveCount(0);
  });

  test('play does nothing with no shapes', async ({ page }) => {
    // Press Space with no shapes on canvas
    await page.keyboard.press('Space');

    // Should not enter playing state
    await page.waitForTimeout(100);
    await expect(page.locator('#btn-play')).not.toHaveClass(/playing/);
  });
});

test.describe('Volume curves — relative loudness', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/audio-tap.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  // Helper: place a shape, play, measure amplitude, stop, clean up
  async function measureAmplitude(page, tool) {
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();

    await page.click(`[data-tool="${tool}"]`);
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);
    await page.waitForTimeout(500);

    const amplitude = await page.evaluate(async () => {
      const samples = [];
      for (let i = 0; i < 8; i++) {
        samples.push(globalThis.__audioTap.getAmplitude());
        await new Promise((r) => setTimeout(r, 50));
      }
      return samples.reduce((a, b) => a + b, 0) / samples.length;
    });

    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).not.toHaveClass(/playing/, { timeout: 5000 });
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Escape');

    return amplitude;
  }

  test('circle and triangle produce similar amplitude at medium size', async ({ page }) => {
    // Pulse/square (PWM waveshaper synthesis) produces near-silent output in
    // headless Chromium, so we compare circle (sine) and triangle (blend) only.
    // The unit tests cover all three waveforms' convergence at size=0.5.
    const sineAmp = await measureAmplitude(page, 'circle');
    const blendAmp = await measureAmplitude(page, 'triangle');

    expect(sineAmp).toBeGreaterThan(0.001);
    expect(blendAmp).toBeGreaterThan(0.001);

    // At medium size, amplitudes should be in the same ballpark.
    // Allow 8x tolerance since real audio RMS depends on more than just gain
    // (waveform harmonics, formant filtering, master effects chain, compressor,
    // analyser timing — CI headless Chromium is especially variable).
    const ratio = Math.max(sineAmp, blendAmp) / Math.min(sineAmp, blendAmp);
    expect(ratio).toBeLessThan(8);
  });
});
