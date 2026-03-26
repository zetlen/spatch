import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Button visibility on empty canvas', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
  });

  test('share, splash, and play buttons are hidden when canvas is empty', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
    await expect(page.locator('body')).toHaveClass(/is-editing/);

    // These buttons should not be interactive when no voices exist
    await expect(page.locator('#btn-share')).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('#btn-splash')).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('#btn-play')).toHaveCSS('pointer-events', 'none');
  });

  test('share, splash, and play buttons appear after placing a shape', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // Place a circle
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Now buttons should be interactive
    await expect(page.locator('#btn-share')).toHaveCSS('pointer-events', 'auto');
    await expect(page.locator('#btn-splash')).toHaveCSS('pointer-events', 'auto');
    await expect(page.locator('#btn-play')).toHaveCSS('pointer-events', 'auto');
  });

  test('share, splash, and play buttons hide again after clearing all voices', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // Place a circle
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Verify buttons are interactive
    await expect(page.locator('#btn-play')).toHaveCSS('pointer-events', 'auto');

    // Clear all voices
    await page.click('#btn-new');

    // Buttons should hide again
    await expect(page.locator('#btn-share')).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('#btn-splash')).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('#btn-play')).toHaveCSS('pointer-events', 'none');
  });

  test('tutorial button remains visible on empty canvas', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // Tutorial should always be interactive when is-editing
    await expect(page.locator('#btn-tutorial')).toHaveCSS('pointer-events', 'auto');
  });
});
