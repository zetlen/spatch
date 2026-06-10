import { expect, test } from '@playwright/test';
import path from 'path';

// In-browser tests for the rasterized overlap detector (overlap.ts).
// OffscreenCanvas is unavailable under bun test, so these run in Playwright,
// driving the exposed __testStore and reading store.overlappingIds.
test.describe('Rasterized overlap detection', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    // __testStore is only exposed when the audio-capture shim is present
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/audio-capture.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('two overlapping circles are detected, distant circle is not', async ({ page }) => {
    const result = await page.evaluate(() => {
      const store = globalThis.__testStore;
      const a = store.addVoice('sine', 0.5, 0.5);
      const b = store.addVoice('sine', 0.55, 0.5);
      const far = store.addVoice('sine', 0.9, 0.9);
      return {
        farId: far.id,
        overlapping: [...store.overlappingIds].toSorted(),
        pairIds: [a.id, b.id].toSorted(),
      };
    });
    expect(result.overlapping).toEqual(result.pairIds);
    expect(result.overlapping).not.toContain(result.farId);
  });

  // The champagne stample's hull uses Q (quadratic bezier) path commands.
  // Probe circles sit at viewBox-derived positions: one inside the flute's
  // bowl (must overlap), one in the empty space beside the stem but within
  // the stamp's bounding box (must not overlap). Geometry, for a stamp at
  // (0.5, 0.5) size 0.4 with viewBox "0 0 120 240": scale = 1/600, so
  // viewBox point (px, py) lands at (0.4 + px/600, 0.3 + py/600).
  test('champagne stamp hull (Q path commands) rasterizes its true silhouette', async ({
    page,
  }) => {
    const insideBowl = await page.evaluate(() => {
      const store = globalThis.__testStore;
      const stamp = store.addVoice('stamp', 0.5, 0.5);
      store.updateVoice(stamp.id, { size: 0.4, stamp: 2, trigger: 1 });
      // Probe at viewBox (78, 60): inside the bowl, right of center
      const probe = store.addVoice('sine', 0.53, 0.4);
      store.updateVoice(probe.id, { size: 0.025 });
      store.recomputeOverlap();
      return { ids: [...store.overlappingIds].toSorted(), probeId: probe.id, stampId: stamp.id };
    });
    expect(insideBowl.ids).toEqual([insideBowl.probeId, insideBowl.stampId].toSorted());

    const besideStem = await page.evaluate((probeId) => {
      const store = globalThis.__testStore;
      // Move probe to viewBox (45, 180): inside the bbox, outside the glass
      store.updateVoice(probeId, { x: 0.475, y: 0.6 });
      store.recomputeOverlap();
      return [...store.overlappingIds];
    }, insideBowl.probeId);
    expect(besideStem).toEqual([]);
  });
});
