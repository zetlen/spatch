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

  test('cycle button exists and starts on minimal', async ({ page }) => {
    const btn = page.locator('#btn-stage');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('title', 'Stage: Minimal');

    const area = page.locator('#canvas-area');
    await expect(area).not.toHaveClass(/stage-subtle/);
    await expect(area).not.toHaveClass(/stage-florid/);
  });

  test('clicking cycles through minimal → subtle → florid → minimal', async ({ page }) => {
    const btn = page.locator('#btn-stage');
    const area = page.locator('#canvas-area');

    // Click 1: minimal → subtle
    await btn.click();
    await expect(area).toHaveClass(/stage-subtle/);
    await expect(btn).toHaveAttribute('title', 'Stage: Subtle');

    // Click 2: subtle → florid
    await btn.click();
    await expect(area).toHaveClass(/stage-florid/);
    await expect(btn).toHaveAttribute('title', /Stage: Florid/);

    // Click 3: florid → minimal
    await btn.click();
    await expect(area).not.toHaveClass(/stage-subtle/);
    await expect(area).not.toHaveClass(/stage-florid/);
    await expect(btn).toHaveAttribute('title', 'Stage: Minimal');
  });

  test('theme persists across reload', async ({ page }) => {
    const btn = page.locator('#btn-stage');
    const area = page.locator('#canvas-area');

    // Set to subtle
    await btn.click();
    await expect(area).toHaveClass(/stage-subtle/);

    // Reload
    await page.reload();
    await page.waitForSelector('#sigil-canvas');

    await expect(area).toHaveClass(/stage-subtle/);
    await expect(btn).toHaveAttribute('title', 'Stage: Subtle');
  });

  test('florid mode advances image on full cycle', async ({ page }) => {
    const area = page.locator('#canvas-area');
    const btn = page.locator('#btn-stage');

    // Get to florid (image 1)
    await btn.click(); // subtle
    await btn.click(); // florid
    const bg1 = await area.evaluate((el) => getComputedStyle(el).getPropertyValue('--stage-bg'));

    // Full cycle: florid → minimal → subtle → florid (image 2)
    await btn.click(); // minimal
    await btn.click(); // subtle
    await btn.click(); // florid
    const bg2 = await area.evaluate((el) => getComputedStyle(el).getPropertyValue('--stage-bg'));

    expect(bg1).not.toEqual(bg2);
  });
});
