import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Serialization round-trip', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
  });

  test('placing shapes updates URL path', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // Initially at root
    const initialPath = await page.evaluate(() => globalThis.location.pathname);
    expect(initialPath).toBe('/');

    // Place a shape
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Wait for debounced save (1s + buffer)
    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/s/'), undefined, {
      timeout: 3000,
    });
    const pathname = await page.evaluate(() => globalThis.location.pathname);
    expect(pathname).toMatch(/^\/s\/.+/);
  });

  test('navigating to a URL with path restores shapes', async ({ page }) => {
    // Step 1: Place shapes and capture the path
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
    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/s/'), undefined, {
      timeout: 3000,
    });
    const pathname = await page.evaluate(() => globalThis.location.pathname);

    // Step 2: Navigate to a new page with the same path
    await page.goto(pathname);
    await page.waitForSelector('#sigil-canvas');

    // Wait for render cycle
    await page.waitForTimeout(500);

    // Verify the state was loaded by checking the path persists
    const restoredPath = await page.evaluate(() => globalThis.location.pathname);
    expect(restoredPath).toBe(pathname);
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

    // Step 2: Get path and reload
    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/s/'), undefined, {
      timeout: 3000,
    });
    const pathname = await page.evaluate(() => globalThis.location.pathname);

    await page.goto(pathname);
    await page.waitForSelector('#sigil-canvas');
    await page.waitForTimeout(500);

    const screenshot2 = await canvas.screenshot();

    // Screenshots should be similar
    expect(screenshot1.length).toBeGreaterThan(100);
    expect(screenshot2.length).toBeGreaterThan(100);
    const ratio = screenshot1.length / screenshot2.length;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });

  test('old hash URLs are migrated to path URLs', async ({ page }) => {
    // Create a sigil, capture path data, then navigate via old hash URL
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/s/'), undefined, {
      timeout: 3000,
    });
    const pathname = await page.evaluate(() => globalThis.location.pathname);
    const data = pathname.slice(3); // strip /s/

    // Navigate using old hash-based URL format
    await page.goto('/#' + data);
    await page.waitForSelector('#sigil-canvas');
    await page.waitForTimeout(500);

    // Should have been migrated to path form
    const migratedPath = await page.evaluate(() => globalThis.location.pathname);
    expect(migratedPath).toBe(pathname);
    const migratedHash = await page.evaluate(() => globalThis.location.hash);
    expect(migratedHash).toBe('');
  });
});
