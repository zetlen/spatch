import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Stage themes', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({
      path: path.join(import.meta.dirname, 'helpers/skip-splash.js'),
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('cycle button exists and starts on white', async ({ page }) => {
    const btn = page.locator('#btn-stage');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('title', 'Stage: White');

    const area = page.locator('#canvas-area');
    await expect(area).not.toHaveClass(/stage-florid/);
  });

  test('clicking cycles white → florid → white', async ({ page }) => {
    const btn = page.locator('#btn-stage');
    const area = page.locator('#canvas-area');

    // Click 1: white → florid
    await btn.click();
    await expect(area).toHaveClass(/stage-florid/);
    await expect(btn).toHaveAttribute('title', /Stage: Image/);

    // Click 2: florid → white
    await btn.click();
    await expect(area).not.toHaveClass(/stage-florid/);
    await expect(btn).toHaveAttribute('title', 'Stage: White');
  });

  test('theme persists across reload', async ({ page }) => {
    const btn = page.locator('#btn-stage');
    const area = page.locator('#canvas-area');

    // Set to florid
    await btn.click();
    await expect(area).toHaveClass(/stage-florid/);

    // Reload
    await page.reload();
    await page.waitForSelector('#sigil-canvas');

    await expect(area).toHaveClass(/stage-florid/);
    await expect(btn).toHaveAttribute('title', /Stage: Image/);
  });

  test('florid mode advances image on each cycle', async ({ page }) => {
    const area = page.locator('#canvas-area');
    const btn = page.locator('#btn-stage');

    // Get to florid (image 1)
    await btn.click(); // florid
    const bg1 = await area.evaluate((el) => getComputedStyle(el).getPropertyValue('--stage-bg'));

    // Cycle: florid → white → florid (image 2)
    await btn.click(); // white
    await btn.click(); // florid
    const bg2 = await area.evaluate((el) => getComputedStyle(el).getPropertyValue('--stage-bg'));

    expect(bg1).not.toEqual(bg2);
  });
});
