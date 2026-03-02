import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Play fan gesture', () => {
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

  test('quick click plays and stops', async ({ page }) => {
    const playBtn = page.locator('#btn-play');
    const box = await playBtn.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Real pointer down starts playback
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    // Quick release stops playback
    await page.mouse.up();
    await expect(page.locator('#btn-play')).not.toHaveClass(/playing/, { timeout: 5000 });
  });

  test('hold opens fan', async ({ page }) => {
    const playBtn = page.locator('#btn-play');

    await playBtn.dispatchEvent('pointerdown', { pointerId: 1 });
    await page.waitForTimeout(400);

    // Fan should be open
    await expect(page.locator('.play-fan')).toHaveClass(/open/);

    // Release on button to stop
    await playBtn.dispatchEvent('pointerup', { pointerId: 1 });
    await expect(page.locator('.play-fan')).not.toHaveClass(/open/);
  });

  test('drag to lock latches playback', async ({ page }) => {
    const playBtn = page.locator('#btn-play');
    const box = await playBtn.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // pointerdown + wait for fan
    await playBtn.dispatchEvent('pointerdown', {
      pointerId: 1,
      clientX: centerX,
      clientY: centerY,
    });
    await page.waitForTimeout(400);
    await expect(page.locator('.play-fan')).toHaveClass(/open/);

    // Simulate pointermove into lock zone (50px above center)
    await playBtn.dispatchEvent('pointermove', {
      pointerId: 1,
      clientX: centerX,
      clientY: centerY - 50,
    });

    // Release in lock zone
    await playBtn.dispatchEvent('pointerup', {
      pointerId: 1,
      clientX: centerX,
      clientY: centerY - 50,
    });

    // Should still be playing (latched)
    await page.waitForTimeout(200);
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);
    const isPlaying = await page.evaluate(() => window.__audioTap?.isPlaying());
    expect(isPlaying).toBe(true);

    // Click play to stop
    await playBtn.dispatchEvent('pointerdown', { pointerId: 2 });
    await expect(page.locator('#btn-play')).not.toHaveClass(/playing/, { timeout: 5000 });
  });

  test('drag to loop starts loop', async ({ page }) => {
    const playBtn = page.locator('#btn-play');
    const box = await playBtn.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // pointerdown + wait for fan
    await playBtn.dispatchEvent('pointerdown', {
      pointerId: 1,
      clientX: centerX,
      clientY: centerY,
    });
    await page.waitForTimeout(400);

    // Move into loop zone (120px above center)
    await playBtn.dispatchEvent('pointermove', {
      pointerId: 1,
      clientX: centerX,
      clientY: centerY - 120,
    });

    // Release in loop zone
    await playBtn.dispatchEvent('pointerup', {
      pointerId: 1,
      clientX: centerX,
      clientY: centerY - 120,
    });

    // Should be playing (looping)
    await page.waitForTimeout(200);
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    // Click play to stop
    await playBtn.dispatchEvent('pointerdown', { pointerId: 2 });
    await expect(page.locator('#btn-play')).not.toHaveClass(/playing/, { timeout: 5000 });
  });

  test('space toggles latch', async ({ page }) => {
    // Press Space to start (latched)
    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    await page.waitForTimeout(300);
    const isPlaying = await page.evaluate(() => window.__audioTap?.isPlaying());
    expect(isPlaying).toBe(true);

    // Press Space to stop
    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).not.toHaveClass(/playing/, { timeout: 5000 });
  });
});
