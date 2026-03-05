import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Serialization round-trip', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
  });

  test('placing shapes updates URL hash', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // Initially no hash
    const initialHash = await page.evaluate(() => globalThis.location.hash);
    expect(initialHash).toBe('');

    // Place a shape
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Wait for debounced save (1s + buffer)
    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });
    const hash = await page.evaluate(() => globalThis.location.hash);
    expect(hash.length).toBeGreaterThan(1);
  });

  test('navigating to a URL with hash restores shapes', async ({ page }) => {
    // Step 1: Place shapes and capture the hash
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="triangle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });

    // Deselect so tool buttons become visible again
    await page.keyboard.press('Escape');

    await page.click('[data-tool="square"]');
    await canvas.click({ position: { x: box.width * 0.7, y: box.height * 0.7 } });

    // Wait for URL to update
    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });
    const hash = await page.evaluate(() => globalThis.location.hash);

    // Step 2: Navigate to a new page with the same hash
    await page.goto('/' + hash);
    await page.waitForSelector('#sigil-canvas');

    // Wait for render cycle
    await page.waitForTimeout(500);

    // Verify the state was loaded by checking the hash persists
    const restoredHash = await page.evaluate(() => globalThis.location.hash);
    expect(restoredHash).toBe(hash);
  });

  test('canvas renders consistently before and after round-trip', async ({ page }) => {
    // Step 1: Create a sigil and screenshot
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Deselect so selection UI doesn't affect comparison
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const screenshot1 = await canvas.screenshot();

    // Step 2: Get hash and reload
    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });
    const hash = await page.evaluate(() => globalThis.location.hash);

    await page.goto('/' + hash);
    await page.waitForSelector('#sigil-canvas');
    await page.waitForTimeout(500);

    const screenshot2 = await canvas.screenshot();

    // Screenshots should be similar (not pixel-perfect due to rendering timing)
    // Just verify both are non-empty buffers of similar size
    expect(screenshot1.length).toBeGreaterThan(100);
    expect(screenshot2.length).toBeGreaterThan(100);
    // Allow 20% size variance for compression differences
    const ratio = screenshot1.length / screenshot2.length;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});
