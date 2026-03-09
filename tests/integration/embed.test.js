import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Embed viewer', () => {
  test('shows error without hash', async ({ page }) => {
    await page.goto('/embed.html');
    const msg = page.locator('.error-msg');
    await expect(msg).toBeVisible();
    await expect(msg).toHaveText('No sigil data found.');
  });

  test('renders sigil from valid hash', async ({ page }) => {
    // Create a sigil in the main app and capture the hash
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Wait for hash
    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });
    const hash = await page.evaluate(() => globalThis.location.hash);

    // Navigate to embed with captured hash
    await page.goto(`/embed.html${hash}`);
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

    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });
    const hash = await page.evaluate(() => globalThis.location.hash);

    await page.goto(`/embed.html${hash}`);
    const embed = page.locator('#embed');
    await expect(embed).toHaveClass(/ready/, { timeout: 5000 });
  });
});
