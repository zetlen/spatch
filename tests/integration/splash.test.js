import { expect, test } from '@playwright/test';

test.describe('First-load splash', () => {
  test('splash class is present on first visit', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
    await expect(page.locator('body')).toHaveClass(/splash/);
    const topToolbar = page.locator('#toolbar-top');
    await expect(topToolbar).toHaveCSS('opacity', '0');
  });

  test('splash class is NOT present on repeat visit', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spatch-seen:/', '1');
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
    await expect(page.locator('body')).not.toHaveClass(/splash/);
  });

  test('splash class is URL-specific', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('spatch-seen:/', '1');
    });
    await page.goto('/#somehash');
    await page.waitForSelector('#sigil-canvas');
    await expect(page.locator('body')).toHaveClass(/splash/);
  });
});

test.describe('First-load splash interaction', () => {
  test('clicking canvas during splash reveals editor', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // Verify splash is active
    await expect(page.locator('body')).toHaveClass(/splash/);

    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();

    // Click and hold for 2.5 seconds (past 2s minimum)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(2500);
    await page.mouse.up();

    // After release, splash should be removed
    await expect(page.locator('body')).not.toHaveClass(/splash/, { timeout: 5000 });

    // Toolbars should be visible
    await expect(page.locator('#toolbar-top')).toHaveCSS('opacity', '1');
  });

  test('quick tap reveals UI immediately', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await expect(page.locator('body')).toHaveClass(/splash/);

    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();

    // Quick tap — UI should start revealing right away
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Splash class removed immediately (fade handled by CSS transition)
    await expect(page.locator('body')).not.toHaveClass(/splash/, { timeout: 2000 });
  });

  test('localStorage is set after splash completes', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();

    // Quick tap to trigger splash
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Wait for splash to complete
    await expect(page.locator('body')).not.toHaveClass(/splash/, { timeout: 5000 });

    // Check localStorage was set
    const key = await page.evaluate(() => localStorage.getItem('spatch-seen:/'));
    expect(key).toBe('1');
  });

  test('keyboard Space is blocked during splash', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await expect(page.locator('body')).toHaveClass(/splash/);

    // Press Space — should NOT start playback
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);

    // Play button should not be in playing state
    await expect(page.locator('#btn-play')).not.toHaveClass(/playing/);

    // Splash should still be active
    await expect(page.locator('body')).toHaveClass(/splash/);
  });
});
