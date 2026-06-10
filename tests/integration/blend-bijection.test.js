import { expect, test } from '@playwright/test';
import path from 'path';

/** Root-mean-square difference between two equal-length PCM arrays. */
function rmsDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum / a.length);
}

/**
 * Render a single latched blend voice at the given timbre through the
 * OfflineAudioContext shim and return 8192 raw samples from the sustain
 * (0.5s in, past the attack). Navigates to a fresh page state each call;
 * init scripts must already be registered (they re-run on navigation).
 */
async function captureBlendPCM(page, timbre) {
  await page.goto('/');
  await page.waitForSelector('#sigil-canvas');

  await page.evaluate((t) => {
    const store = globalThis.__testStore;
    store.addVoice('blend', 0.5, 0.5);
    store.updateVoice(store.data.voices.at(-1).id, { timbre: t });
  }, timbre);

  await page.keyboard.press('Space');
  await expect(page.locator('#btn-play')).toHaveClass(/playing/);
  await page.evaluate(() => globalThis.__audioCapture.startRendering());
  return page.evaluate(() =>
    globalThis.__audioCapture.getRenderedPCM({ length: 8192, offset: 22_050 }),
  );
}

// Bijection invariant (#369): a triangle at 30° (timbre 0.25) and at 90°
// (timbre 0.75) are visually distinct mirror orientations, so they must
// sound distinct. The old tent-curve mapping collapsed them to identical
// audio.
test.describe('Blend timbre bijection', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/seed-random.js') });
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/audio-capture.js') });
  });

  test('mirror rotations produce different audio; identical states stay deterministic', async ({
    page,
  }) => {
    const quarterA = await captureBlendPCM(page, 0.25);
    const quarterB = await captureBlendPCM(page, 0.25);
    const threeQuarter = await captureBlendPCM(page, 0.75);

    // Determinism control: same state renders the same PCM across loads
    expect(rmsDiff(quarterA, quarterB)).toBeLessThan(1e-6);

    // The fix: visually distinct mirror orientations sound different.
    // The rendered voice RMS is ~0.02 at default size; the mirror pair
    // differs by ~5e-3 RMS post-fix and exactly 0 pre-fix.
    expect(rmsDiff(quarterA, threeQuarter)).toBeGreaterThan(1e-3);
  });

  test('timbre 1 (120° rotation) sounds identical to timbre 0 (0°)', async ({ page }) => {
    const zero = await captureBlendPCM(page, 0);
    const full = await captureBlendPCM(page, 1);

    // 120° renders identically to 0° for a triangle, so it must sound
    // identical too (timbre wraps at the symmetry period)
    expect(rmsDiff(zero, full)).toBeLessThan(1e-6);
  });
});
