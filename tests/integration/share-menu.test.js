import { expect, test } from '@playwright/test';
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
    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });

    await page.click('#btn-share');
    await page.click('[data-action="share"]');

    // Check the icon changed to a check mark
    await expect(page.locator('[data-action="share"] use')).toHaveAttribute('href', /tabler-check/);

    // Icon should revert after ~1.5s
    await expect(page.locator('[data-action="share"] use')).toHaveAttribute('href', /tabler-link/, {
      timeout: 3000,
    });
  });

  test('Embed code shows Copied feedback', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.click('#btn-share');
    await page.click('[data-action="embed"]');

    // Check the icon changed to a check mark
    await expect(page.locator('[data-action="embed"] use')).toHaveAttribute('href', /tabler-check/);

    // Icon should revert after ~1.5s
    await expect(page.locator('[data-action="embed"] use')).toHaveAttribute('href', /tabler-code/, {
      timeout: 3000,
    });
  });
});
