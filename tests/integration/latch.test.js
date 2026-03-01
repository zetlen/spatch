import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Latch mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/audio-tap.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // Place a circle shape
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  });

  test('latch button toggles active class', async ({ page }) => {
    const latchBtn = page.locator('#btn-latch');

    // Initially not active
    await expect(latchBtn).not.toHaveClass(/active/);

    // Click to enable
    await latchBtn.click();
    await expect(latchBtn).toHaveClass(/active/);

    // Click to disable
    await latchBtn.click();
    await expect(latchBtn).not.toHaveClass(/active/);
  });

  test('latch mode sustains audio after click', async ({ page }) => {
    const latchBtn = page.locator('#btn-latch');
    const playBtn = page.locator('#btn-play');

    // Enable latch
    await latchBtn.click();
    await expect(latchBtn).toHaveClass(/active/);

    // Click play (in latch mode, click toggles instead of mousedown/mouseup)
    await playBtn.click();

    // Should be playing
    await expect(page.locator('#canvas-wrap')).toHaveClass(/playing/);

    // Wait and verify audio is still sustaining
    await page.waitForTimeout(500);
    const isPlaying = await page.evaluate(() => window.__audioTap?.isPlaying());
    expect(isPlaying).toBe(true);

    // Latch slider should be visible
    await expect(page.locator('#latch-position')).not.toHaveClass(/hidden/);

    // Click play again to stop
    await playBtn.click();
    await expect(page.locator('#canvas-wrap')).not.toHaveClass(/playing/, { timeout: 5000 });
  });

  test('disabling latch while playing stops audio', async ({ page }) => {
    const latchBtn = page.locator('#btn-latch');
    const playBtn = page.locator('#btn-play');

    // Enable latch and start playing
    await latchBtn.click();
    await playBtn.click();
    await expect(page.locator('#canvas-wrap')).toHaveClass(/playing/);

    // Disable latch — should stop playback
    await latchBtn.click();
    await expect(page.locator('#canvas-wrap')).not.toHaveClass(/playing/, { timeout: 5000 });
  });
});
