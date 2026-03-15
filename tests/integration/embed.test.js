import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Embed viewer', () => {
  test('shows error without data', async ({ page }) => {
    await page.goto('/embed/');
    const msg = page.locator('.error-msg');
    await expect(msg).toBeVisible();
    await expect(msg).toHaveText('No sigil data found.');
  });

  test('renders sigil from valid path', async ({ page }) => {
    // Create a sigil in the main app and capture the data
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Wait for path
    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/s/'), undefined, {
      timeout: 3000,
    });
    const data = await page.evaluate(() => globalThis.location.pathname.slice(3));

    // Navigate to embed with captured data
    await page.goto(`/embed/${data}`);
    const svg = page.locator('svg#c');
    await expect(svg).toBeVisible();

    // Should have at least one rendered shape
    const shapes = svg.locator('[data-voice-id]');
    await expect(shapes).toHaveCount(1);
  });

  test('embed becomes visible after scene loads', async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/s/'), undefined, {
      timeout: 3000,
    });
    const data = await page.evaluate(() => globalThis.location.pathname.slice(3));

    await page.goto(`/embed/${data}`);
    const embed = page.locator('#embed');
    await expect(embed).toHaveClass(/ready/, { timeout: 5000 });
  });

  test('embed stays square in a non-square viewport', async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/s/'), undefined, {
      timeout: 3000,
    });
    const data = await page.evaluate(() => globalThis.location.pathname.slice(3));

    // Set a non-square viewport
    await page.setViewportSize({ width: 400, height: 200 });
    await page.goto(`/embed/${data}`);
    const embed = page.locator('#embed');
    await expect(embed).toHaveClass(/ready/, { timeout: 5000 });

    const embedBox = await embed.boundingBox();
    expect(Math.abs(embedBox.width - embedBox.height)).toBeLessThan(2);
  });

  test('old hash embed URLs are migrated to path URLs', async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/s/'), undefined, {
      timeout: 3000,
    });
    const data = await page.evaluate(() => globalThis.location.pathname.slice(3));

    // Navigate using old hash-based embed URL
    await page.goto(`/embed.html#${data}`);
    await page.waitForTimeout(500);

    // Should have migrated to path form
    const pathname = await page.evaluate(() => globalThis.location.pathname);
    expect(pathname).toBe(`/embed/${data}`);
  });
});
