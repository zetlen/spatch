import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Play radial gesture', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
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

  test('hold for 1s shows radial overlay', async ({ page }) => {
    const playBtn = page.locator('#btn-play');
    const box = await playBtn.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Pointer down starts audio but overlay has 1s delay
    await page.mouse.move(cx, cy);
    await page.mouse.down();

    // Overlay not shown yet (quick tap)
    await page.waitForTimeout(200);
    await expect(page.locator('#radial-overlay')).not.toHaveClass(/active/);

    // After 1s delay, overlay appears
    await page.waitForTimeout(1000);
    await expect(page.locator('#radial-overlay')).toHaveClass(/active/);

    // Release on button to stop
    await page.mouse.up();
    await expect(page.locator('#radial-overlay')).not.toHaveClass(/active/);
  });

  test('drag to outer edge latches playback', async ({ page }) => {
    const playBtn = page.locator('#btn-play');
    const box = await playBtn.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Hold to open radial overlay (1s delay)
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.waitForTimeout(1200);
    await expect(page.locator('#radial-overlay')).toHaveClass(/active/);

    // Move far from button center into latch zone (outer 30% of max distance)
    await page.mouse.move(10, 10);

    // Release in latch zone
    await page.mouse.up();

    // Should still be playing (latched)
    await page.waitForTimeout(200);
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    // Click play to stop
    await page.mouse.click(centerX, centerY);
    await expect(page.locator('#btn-play')).not.toHaveClass(/playing/, { timeout: 5000 });
  });

  test('drag to middle zone starts loop', async ({ page }) => {
    const playBtn = page.locator('#btn-play');
    const box = await playBtn.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Hold to open radial overlay (1s delay)
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.waitForTimeout(1200);
    await expect(page.locator('#radial-overlay')).toHaveClass(/active/);

    // Move moderate distance from button center into loop zone (middle ring)
    await page.mouse.move(centerX, centerY - 150);

    // Release in loop zone
    await page.mouse.up();

    // Should be playing (looping)
    await page.waitForTimeout(200);
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    // Click play to stop
    await page.mouse.click(centerX, centerY);
    await expect(page.locator('#btn-play')).not.toHaveClass(/playing/, { timeout: 5000 });
  });

  test('space toggles latch', async ({ page }) => {
    // Use click to start playback (qualifying gesture for all browsers)
    const playBtn = page.locator('#btn-play');
    const box = await playBtn.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Hold + drag to latch zone to start latched playback via click
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.waitForTimeout(1200);
    await page.mouse.move(10, 10);
    await page.mouse.up();

    await page.waitForTimeout(300);
    await expect(playBtn).toHaveClass(/playing/);

    // Press Space to stop
    await page.keyboard.press('Space');
    await expect(playBtn).not.toHaveClass(/playing/, { timeout: 5000 });
  });
});
