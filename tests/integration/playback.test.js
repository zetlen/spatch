import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Playback', () => {
  test.beforeEach(async ({ page }) => {
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

    // Press and hold play button
    const playBtn = page.locator('#btn-play');
    await playBtn.dispatchEvent('mousedown');

    // Canvas wrap should have .playing class
    await expect(page.locator('#canvas-wrap')).toHaveClass(/playing/);

    // Wait a bit for audio to stabilize
    await page.waitForTimeout(200);

    // Check audio tap shows non-zero amplitude
    const isPlaying = await page.evaluate(() => window.__audioTap?.isPlaying());
    expect(isPlaying).toBe(true);

    // Release play button
    await playBtn.dispatchEvent('mouseup');

    // After release time, .playing class should be removed
    await expect(page.locator('#canvas-wrap')).not.toHaveClass(/playing/, { timeout: 5000 });
  });

  test('play button shows stop text while playing', async ({ page }) => {
    // Place a shape first
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    const playBtn = page.locator('#btn-play');

    // Before playing
    await expect(playBtn).toContainText('PLAY');

    // Start playing
    await playBtn.dispatchEvent('mousedown');
    await expect(playBtn).toContainText('STOP');

    // Release
    await playBtn.dispatchEvent('mouseup');
    await expect(playBtn).toContainText('PLAY', { timeout: 5000 });
  });

  test('play does nothing with no shapes', async ({ page }) => {
    const playBtn = page.locator('#btn-play');
    await playBtn.dispatchEvent('mousedown');

    // Should not enter playing state
    await page.waitForTimeout(100);
    await expect(page.locator('#canvas-wrap')).not.toHaveClass(/playing/);
    await playBtn.dispatchEvent('mouseup');
  });
});
