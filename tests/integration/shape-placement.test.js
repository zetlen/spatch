import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Shape placement', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('clicking triangle tool then canvas places a triangle', async ({ page }) => {
    // Click triangle tool button
    await page.click('[data-tool="triangle"]');

    // Click on canvas center
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Tool should auto-switch to select
    await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);

    // Canvas should render the shape — take a screenshot to verify non-empty
    // We verify via the URL hash which updates after 1s debounce
    await page.waitForFunction(() => window.location.hash.length > 1, null, { timeout: 3000 });
  });

  test('clicking square tool then canvas places a square', async ({ page }) => {
    await page.click('[data-tool="square"]');

    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });

    await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);
    await page.waitForFunction(() => window.location.hash.length > 1, null, { timeout: 3000 });
  });

  test('clicking circle tool then canvas places a circle', async ({ page }) => {
    await page.click('[data-tool="circle"]');

    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.7, y: box.height * 0.7 } });

    await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);
    await page.waitForFunction(() => window.location.hash.length > 1, null, { timeout: 3000 });
  });

  test('multiple shapes can be placed sequentially', async ({ page }) => {
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();

    // Place triangle
    await page.click('[data-tool="triangle"]');
    await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });

    // Place circle
    await page.click('[data-tool="circle"]');
    await canvas.click({ position: { x: box.width * 0.7, y: box.height * 0.7 } });

    // Verify hash contains serialized state with both shapes
    await page.waitForFunction(() => window.location.hash.length > 1, null, { timeout: 3000 });
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash.length).toBeGreaterThan(5);
  });
});
