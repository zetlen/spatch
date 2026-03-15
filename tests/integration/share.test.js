import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Share overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
  });

  test('share button opens overlay with link and embed code', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // Place a shape so there's something to share
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Wait for URL path to be set
    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/s/'), undefined, {
      timeout: 3000,
    });

    // Click share button
    await page.click('#btn-share');

    // Overlay should be visible
    const overlay = page.locator('#share-overlay');
    await expect(overlay).toBeVisible();

    // Link code should contain origin URL with path
    const linkCode = page.locator('#share-link');
    const linkText = await linkCode.textContent();
    expect(linkText).toContain('/s/');

    // Embed code should contain iframe
    const embedCode = page.locator('#share-embed-code');
    const embedText = await embedCode.textContent();
    expect(embedText).toContain('<iframe');
    expect(embedText).toContain('/embed/');
  });

  test('size slider updates embed snippet', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/s/'), undefined, {
      timeout: 3000,
    });

    await page.click('#btn-share');

    // Change size slider
    await page.fill('#share-size', '200');
    await page.dispatchEvent('#share-size', 'input');

    const embedText = await page.locator('#share-embed-code').textContent();
    expect(embedText).toContain('width="200"');
    expect(embedText).toContain('height="200"');
  });

  test('embed preview iframe is visible and resizes with slider', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/s/'), undefined, {
      timeout: 3000,
    });

    await page.click('#btn-share');

    const preview = page.locator('#share-preview');
    await expect(preview).toBeVisible();

    // Preview src should point to embed URL
    const src = await preview.getAttribute('src');
    expect(src).toContain('/embed/');

    // Resize slider and verify preview dimensions update
    await page.fill('#share-size', '200');
    await page.dispatchEvent('#share-size', 'input');
    const width = await preview.evaluate((el) => el.style.width);
    const height = await preview.evaluate((el) => el.style.height);
    expect(width).toBe('200px');
    expect(height).toBe('200px');
  });

  test('clicking overlay background dismisses it', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/s/'), undefined, {
      timeout: 3000,
    });

    await page.click('#btn-share');
    const overlay = page.locator('#share-overlay');
    await expect(overlay).toBeVisible();

    // Click overlay background (top-left corner, outside content)
    await overlay.click({ position: { x: 10, y: 10 } });
    await expect(overlay).toBeHidden();
  });
});
