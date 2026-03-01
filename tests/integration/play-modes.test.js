import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Play modes', () => {
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

  test('mode selector highlights active mode', async ({ page }) => {
    const normalBtn = page.locator('.mode-btn[data-mode="normal"]');
    const latchBtn = page.locator('.mode-btn[data-mode="latch"]');
    const loopBtn = page.locator('.mode-btn[data-mode="loop"]');

    // Normal is active by default
    await expect(normalBtn).toHaveClass(/active/);
    await expect(latchBtn).not.toHaveClass(/active/);
    await expect(loopBtn).not.toHaveClass(/active/);

    // Switch to latch
    await latchBtn.click();
    await expect(normalBtn).not.toHaveClass(/active/);
    await expect(latchBtn).toHaveClass(/active/);
    await expect(loopBtn).not.toHaveClass(/active/);

    // Switch to loop
    await loopBtn.click();
    await expect(normalBtn).not.toHaveClass(/active/);
    await expect(latchBtn).not.toHaveClass(/active/);
    await expect(loopBtn).toHaveClass(/active/);

    // Switch back to normal
    await normalBtn.click();
    await expect(normalBtn).toHaveClass(/active/);
    await expect(latchBtn).not.toHaveClass(/active/);
    await expect(loopBtn).not.toHaveClass(/active/);
  });

  test('latch mode sustains audio after click', async ({ page }) => {
    const latchBtn = page.locator('.mode-btn[data-mode="latch"]');
    const playBtn = page.locator('#btn-play');

    // Enable latch mode
    await latchBtn.click();
    await expect(latchBtn).toHaveClass(/active/);

    // Click play (in latch mode, click toggles)
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

  test('switching mode while playing stops audio', async ({ page }) => {
    const latchBtn = page.locator('.mode-btn[data-mode="latch"]');
    const normalBtn = page.locator('.mode-btn[data-mode="normal"]');
    const playBtn = page.locator('#btn-play');

    // Enable latch and start playing
    await latchBtn.click();
    await playBtn.click();
    await expect(page.locator('#canvas-wrap')).toHaveClass(/playing/);

    // Switch to normal mode — should stop playback
    await normalBtn.click();
    await expect(page.locator('#canvas-wrap')).not.toHaveClass(/playing/, { timeout: 5000 });
  });

  test('loop mode auto-restarts playback', async ({ page }) => {
    const loopBtn = page.locator('.mode-btn[data-mode="loop"]');
    const playBtn = page.locator('#btn-play');

    // Enable loop mode
    await loopBtn.click();
    await expect(loopBtn).toHaveClass(/active/);

    // Start playback
    await playBtn.click();
    await expect(page.locator('#canvas-wrap')).toHaveClass(/playing/);

    // Wait for audio to initialize, then verify
    await page.waitForTimeout(200);
    const isPlaying = await page.evaluate(() => window.__audioTap?.isPlaying());
    expect(isPlaying).toBe(true);

    // Latch slider should NOT be visible in loop mode
    await expect(page.locator('#latch-position')).toHaveClass(/hidden/);

    // Stop playback
    await playBtn.click();
    await expect(page.locator('#canvas-wrap')).not.toHaveClass(/playing/, { timeout: 5000 });
  });
});
