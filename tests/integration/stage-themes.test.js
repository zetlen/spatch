import { expect, test } from '@playwright/test';
import path from 'path';

/** Return the backgroundImage of the active (non-faded) .stage-bg layer. */
async function getActiveBg(page) {
  return page.evaluate(() => {
    const layers = document.querySelectorAll('.stage-bg');
    for (const layer of layers) {
      if (
        !layer.classList.contains('fade-out') &&
        getComputedStyle(layer).backgroundImage !== 'none'
      ) {
        return getComputedStyle(layer).backgroundImage;
      }
    }
    return 'none';
  });
}

test.describe('Stage themes', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({
      path: path.join(import.meta.dirname, 'helpers/skip-splash.js'),
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('stage always has a background image', async ({ page }) => {
    // Wait for async prefetch to settle
    await page.waitForFunction(() => {
      const layers = document.querySelectorAll('.stage-bg');
      for (const layer of layers) {
        if (
          !layer.classList.contains('fade-out') &&
          getComputedStyle(layer).backgroundImage !== 'none'
        ) {
          return true;
        }
      }
      return false;
    });
    const bg = await getActiveBg(page);
    expect(bg).toContain('url(');
  });

  test('clicking advances to next image', async ({ page }) => {
    const btn = page.locator('#btn-stage');

    // Wait for initial scene to load
    await page.waitForFunction(() => {
      const layers = document.querySelectorAll('.stage-bg');
      for (const layer of layers) {
        if (
          !layer.classList.contains('fade-out') &&
          getComputedStyle(layer).backgroundImage !== 'none'
        ) {
          return true;
        }
      }
      return false;
    });

    const bg1 = await getActiveBg(page);
    await btn.click();

    // Wait for crossfade to complete (new active layer with different image)
    await page.waitForFunction((prevBg) => {
      const layers = document.querySelectorAll('.stage-bg');
      for (const layer of layers) {
        if (
          !layer.classList.contains('fade-out') &&
          getComputedStyle(layer).backgroundImage !== 'none'
        ) {
          return getComputedStyle(layer).backgroundImage !== prevBg;
        }
      }
      return false;
    }, bg1);

    const bg2 = await getActiveBg(page);
    expect(bg1).not.toEqual(bg2);
  });

  test('scene persists across reload when sigil exists', async ({ page }) => {
    // Place a voice so the URL hash gets saved (scene is serialized with the sigil)
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    const btn = page.locator('#btn-stage');

    await btn.click();
    // Wait for debounced URL save (1s debounce in app.ts)
    await page.waitForFunction(() => location.pathname.startsWith('/s/'));

    // Wait for crossfade to settle
    await page.waitForFunction(() => {
      const layers = document.querySelectorAll('.stage-bg');
      for (const layer of layers) {
        if (
          !layer.classList.contains('fade-out') &&
          getComputedStyle(layer).backgroundImage !== 'none'
        ) {
          return true;
        }
      }
      return false;
    });

    const bg1 = await getActiveBg(page);

    await page.reload();
    await page.waitForSelector('#sigil-canvas');

    // Wait for scene to load after reload
    await page.waitForFunction(() => {
      const layers = document.querySelectorAll('.stage-bg');
      for (const layer of layers) {
        if (
          !layer.classList.contains('fade-out') &&
          getComputedStyle(layer).backgroundImage !== 'none'
        ) {
          return true;
        }
      }
      return false;
    });

    const bg2 = await getActiveBg(page);
    expect(bg1).toEqual(bg2);
  });
});
