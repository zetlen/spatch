import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Stage themes', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({
      path: path.join(import.meta.dirname, 'helpers/skip-splash.js'),
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('stage always has a background image', async ({ page }) => {
    const app = page.locator('#app');
    const bg = await app.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain('url(');
  });

  test('clicking advances to next image', async ({ page }) => {
    const app = page.locator('#app');
    const btn = page.locator('#btn-stage');

    const bg1 = await app.evaluate((el) => getComputedStyle(el).backgroundImage);
    await btn.click();
    const bg2 = await app.evaluate((el) => getComputedStyle(el).backgroundImage);

    expect(bg1).not.toEqual(bg2);
  });

  test('cycle wraps around to first image', async ({ page }) => {
    const app = page.locator('#app');
    const btn = page.locator('#btn-stage');

    const bg0 = await app.evaluate((el) => getComputedStyle(el).backgroundImage);
    // Click through all images (8 total) to wrap back to index 0
    for (let i = 0; i < 8; i++) await btn.click();
    const bgWrapped = await app.evaluate((el) => getComputedStyle(el).backgroundImage);

    expect(bgWrapped).toEqual(bg0);
  });

  test('image persists across reload', async ({ page }) => {
    const app = page.locator('#app');
    const btn = page.locator('#btn-stage');

    await btn.click();
    const bg1 = await app.evaluate((el) => getComputedStyle(el).backgroundImage);

    await page.reload();
    await page.waitForSelector('#sigil-canvas');

    const bg2 = await app.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg1).toEqual(bg2);
  });
});
