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

/** Hann-windowed magnitude spectrum (plain DFT, n bins, DC skipped). */
function magnitudeSpectrum(samples, n = 2048) {
  const mags = [];
  for (let k = 1; k < n / 2; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      const phase = (2 * Math.PI * k * i) / n;
      re += samples[i] * w * Math.cos(phase);
      im -= samples[i] * w * Math.sin(phase);
    }
    mags.push(Math.hypot(re, im));
  }
  return mags;
}

/** Normalized correlation between two magnitude spectra (1 = identical). */
function spectralCorrelation(a, b) {
  const sa = magnitudeSpectrum(a);
  const sb = magnitudeSpectrum(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < sa.length; i++) {
    dot += sa[i] * sb[i];
    na += sa[i] ** 2;
    nb += sb[i] ** 2;
  }
  return dot / Math.sqrt(na * nb);
}

/**
 * Render a single latched voice at the given timbre through the
 * OfflineAudioContext shim and return 8192 raw samples from the sustain
 * (0.5s in, past the attack). Navigates to a fresh page state each call;
 * init scripts must already be registered (they re-run on navigation).
 */
async function capturePCM(page, waveform, timbre) {
  await page.goto('/');
  await page.waitForSelector('#sigil-canvas');

  await page.evaluate(
    ([wf, t]) => {
      const store = globalThis.__testStore;
      store.addVoice(wf, 0.5, 0.5);
      store.updateVoice(store.data.voices.at(-1).id, { timbre: t });
    },
    [waveform, timbre],
  );

  await page.keyboard.press('Space');
  await expect(page.locator('#btn-play')).toHaveClass(/playing/);
  await page.evaluate(() => globalThis.__audioCapture.startRendering());
  return page.evaluate(() =>
    globalThis.__audioCapture.getRenderedPCM({ length: 8192, offset: 22_050 }),
  );
}

// Bijection invariant (#369, #378, #379): visually distinct rotations within
// a shape's symmetry period must sound distinct, and a full-period rotation
// (timbre 1, reachable via serialization round-trip) renders identically to
// 0° so it must sound identical to timbre 0.
test.describe('Timbre bijection', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/seed-random.js') });
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/audio-capture.js') });
  });

  test('blend: mirror rotations differ; identical states stay deterministic', async ({ page }) => {
    const quarterA = await capturePCM(page, 'blend', 0.25);
    const quarterB = await capturePCM(page, 'blend', 0.25);
    const threeQuarter = await capturePCM(page, 'blend', 0.75);

    // Determinism control: same state renders the same PCM across loads
    expect(rmsDiff(quarterA, quarterB)).toBeLessThan(1e-6);

    // Visually distinct mirror orientations sound different. The rendered
    // voice RMS is ~0.02 at default size; the mirror pair differs by ~5e-3.
    expect(rmsDiff(quarterA, threeQuarter)).toBeGreaterThan(1e-3);
  });

  test('blend: timbre 1 (120°) sounds identical to timbre 0', async ({ page }) => {
    const zero = await capturePCM(page, 'blend', 0);
    const full = await capturePCM(page, 'blend', 1);
    expect(rmsDiff(zero, full)).toBeLessThan(1e-6);
  });

  test('pulse: mirror rotations have distinct spectra', async ({ page }) => {
    // Duty cycles d and 1−d are spectrally identical, so raw PCM equality
    // can't detect this collapse — compare magnitude spectra instead.
    const quarter = await capturePCM(page, 'pulse', 0.25);
    const threeQuarter = await capturePCM(page, 'pulse', 0.75);
    expect(spectralCorrelation(quarter, threeQuarter)).toBeLessThan(0.99);
  });

  test('pulse: timbre 1 (90°) sounds identical to timbre 0', async ({ page }) => {
    const zero = await capturePCM(page, 'pulse', 0);
    const full = await capturePCM(page, 'pulse', 1);
    expect(rmsDiff(zero, full)).toBeLessThan(1e-6);
  });

  test('astroid: timbre 1 (90°) sounds identical to timbre 0', async ({ page }) => {
    const zero = await capturePCM(page, 'astroid', 0);
    const full = await capturePCM(page, 'astroid', 1);
    expect(rmsDiff(zero, full)).toBeLessThan(1e-6);
  });
});
