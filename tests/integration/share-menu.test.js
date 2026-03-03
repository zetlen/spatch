import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Share menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('menu button toggles popover visibility', async ({ page }) => {
    const menu = page.locator('#share-menu');
    await expect(menu).toBeHidden();

    await page.click('#btn-share');
    await expect(menu).toBeVisible();

    await page.click('#btn-share');
    await expect(menu).toBeHidden();
  });

  test('clicking outside closes the menu', async ({ page }) => {
    await page.click('#btn-share');
    await expect(page.locator('#share-menu')).toBeVisible();

    await page.click('#sigil-canvas');
    await expect(page.locator('#share-menu')).toBeHidden();
  });

  test('Escape closes the menu', async ({ page }) => {
    await page.click('#btn-share');
    await expect(page.locator('#share-menu')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#share-menu')).toBeHidden();
  });

  test('Share link shows Copied feedback', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Place a shape so the URL gets a hash
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Wait for URL hash to be set (debounced serialization)
    await page.waitForFunction(() => window.location.hash.length > 1, null, { timeout: 3000 });

    await page.click('#btn-share');
    await page.click('[data-action="share"]');

    // Check the label changed to "Copied!"
    await expect(page.locator('[data-action="share"] span')).toHaveText('Copied!');

    // Label should revert after ~1.5s
    await expect(page.locator('[data-action="share"] span')).toHaveText('Share link', {
      timeout: 3000,
    });
  });

  test('Embed code shows Copied feedback', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.click('#btn-share');
    await page.click('[data-action="embed"]');

    await expect(page.locator('[data-action="embed"] span')).toHaveText('Copied!');

    await expect(page.locator('[data-action="embed"] span')).toHaveText('Embed code', {
      timeout: 3000,
    });
  });
});
