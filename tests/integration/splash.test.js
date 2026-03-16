import { expect, test } from '@playwright/test';

test.describe('Splash rules', () => {
  test('homepage has no splash — is-editing immediately', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.clear());
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
    await expect(page.locator('body')).toHaveClass(/is-editing/);
    await expect(page.locator('#toolbar-top')).toHaveCSS('opacity', '1');
  });

  test('shared URL splashes on first visit', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.clear());
    await page.goto('/s/somehash');
    await page.waitForSelector('#sigil-canvas');
    await expect(page.locator('body')).not.toHaveClass(/is-editing/);
    await expect(page.locator('#toolbar-top')).toHaveCSS('opacity', '0');
  });

  test('shared URL click reveals editor and marks seen', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.clear());
    await page.goto('/s/somehash');
    await page.waitForSelector('#sigil-canvas');

    await expect(page.locator('body')).not.toHaveClass(/is-editing/);

    const overlay = page.locator('#splash-overlay');
    await overlay.click();

    await expect(page.locator('body')).toHaveClass(/is-editing/, { timeout: 8000 });

    const seen = await page.evaluate(() => {
      const raw = sessionStorage.getItem('spatch-seen');
      return raw ? JSON.parse(raw) : [];
    });
    expect(seen).toContain('/s/somehash');
  });

  test('seen shared URL does not splash again', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('spatch-seen', JSON.stringify(['/s/somehash']));
    });
    await page.goto('/s/somehash');
    await page.waitForSelector('#sigil-canvas');
    await expect(page.locator('body')).toHaveClass(/is-editing/);
  });

  test('keyboard Space is blocked during splash', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.clear());
    await page.goto('/s/somehash');
    await page.waitForSelector('#sigil-canvas');

    await expect(page.locator('body')).not.toHaveClass(/is-editing/);

    await page.keyboard.press('Space');
    await page.waitForTimeout(200);

    await expect(page.locator('#btn-play')).not.toHaveClass(/playing/);
    await expect(page.locator('body')).not.toHaveClass(/is-editing/);
  });
});

test.describe('Splash preview', () => {
  test('preview button enters splash without affecting seen state', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.clear());
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
    await expect(page.locator('body')).toHaveClass(/is-editing/);

    // Place a shape so the preview button becomes visible
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.locator('body')).toHaveClass(/has-voices/);

    // Click preview button — should enter splash mode
    await page.click('#btn-splash');
    await expect(page.locator('body')).not.toHaveClass(/is-editing/);

    // Click overlay to dismiss — should return to editing
    const overlay = page.locator('#splash-overlay');
    await overlay.click();
    await expect(page.locator('body')).toHaveClass(/is-editing/, { timeout: 8000 });

    // sessionStorage should NOT have '/' in seen list (preview doesn't write seen)
    const seen = await page.evaluate(() => {
      const raw = sessionStorage.getItem('spatch-seen');
      return raw ? JSON.parse(raw) : [];
    });
    expect(seen).not.toContain('/');
  });
});
