import { expect, test } from '@playwright/test';
import path from 'path';

/** Place a circle at a normalized position and return its voice id. */
async function placeCircle(page, nx = 0.5, ny = 0.5) {
  await page.click('[data-tool="circle"]');
  const canvas = page.locator('#sigil-canvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * nx, y: box.height * ny } });
  return page.evaluate(() => globalThis.__testStore.data.voices.at(-1).id);
}

test.describe('Keyboard shortcut guards', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    // Audio-capture shim exposes __testStore
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/audio-capture.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('Delete is ignored while a modal overlay is open', async ({ page }) => {
    const voiceId = await placeCircle(page);
    // Select the voice (click on it)
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.waitForFunction(() => globalThis.__testStore.data.voices.length === 1);

    // Open the share overlay — it blocks pointer events but not key events
    await page.click('#btn-share');
    await expect(page.locator('#share-overlay')).toBeVisible();

    await page.keyboard.press('Delete');

    const voices = await page.evaluate(() => globalThis.__testStore.data.voices.map((v) => v.id));
    expect(voices).toContain(voiceId);
  });

  test('solo shortcut does not arm without a selection', async ({ page }) => {
    await placeCircle(page);
    // Deselect everything
    await page.keyboard.press('Escape');

    await page.keyboard.press('s');
    await expect(page.locator('#btn-solo')).not.toHaveClass(/solo-active/);
  });

  test('solo shortcut arms with a selection and disarms even without one', async ({ page }) => {
    await placeCircle(page);
    // Select the voice
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.keyboard.press('s');
    await expect(page.locator('#btn-solo')).toHaveClass(/solo-active/);

    // Deselect, then 's' must still disarm the active solo
    await page.keyboard.press('Escape');
    await page.keyboard.press('s');
    await expect(page.locator('#btn-solo')).not.toHaveClass(/solo-active/);
  });
});
