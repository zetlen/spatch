/**
 * Audio frequency profiling script.
 *
 * PURPOSE: Compare the average spectral profile of random spatches across
 * branches or commits. Use this whenever you change the audio mapping
 * (filters, formants, waveshaping, signal chain) to verify that the
 * frequency distribution hasn't regressed — e.g., too much treble, lost
 * bass, or a flattened spectrum.
 *
 * HOW IT WORKS: Launches headless Chromium via Playwright, generates 30
 * random spatches (via the randomize button), captures each one's audio
 * through an OfflineAudioContext, computes a 4096-point FFT on the
 * sustained portion, and averages the magnitude spectrum across all 30
 * samples. Reports average energy in 6 frequency bands (sub, bass, lomid,
 * mid, himid, treble) as dB values + a text bar chart.
 *
 * HOW TO USE:
 *   1. Start the dev server:  bun run dev
 *   2. Run the script:        node scripts/audio-profile.js [label]
 *   3. The [label] arg names the output directory (defaults to git branch).
 *   4. To compare branches, run on each branch with a different label,
 *      then diff the band-summary.txt files or the printed output.
 *
 * OUTPUT (saved to tmp/audio-profiling-<label>/):
 *   - avg-spectrum.json: full 2048-bin average magnitude spectrum
 *   - band-summary.txt:  6-band energy summary (tab-separated)
 *   - Printed to stdout: bar chart with dB values and relative levels
 *
 * EXAMPLE COMPARISON (from the OKLCH parametric EQ work, 2026-03-31):
 *
 *   Band              Control (old HSL)   2D Formants (new OKLCH)
 *     sub (0-100)       -41.1  (-30.9)     -29.2  (-28.0)
 *    bass (100-300)     -13.8  ( -3.6)      -4.7  ( -3.5)
 *   lomid (300-800)     -10.2  (  0.0)      -1.2  (  0.0)   ← peak band
 *     mid (800-2k)      -14.6  ( -4.5)      -7.9  ( -6.7)
 *   himid (2k-4k)       -33.8  (-23.6)     -27.7  (-26.5)
 *   treble (4k-8k)      -61.5  (-51.3)     -52.5  (-51.3)
 *
 *   Good: same peak band (lomid), same treble rolloff (~51 dB below peak).
 *   Bad would be: treble creeping up, peak shifting to a different band,
 *   or the rolloff flattening (which indicates too much high-frequency energy).
 *
 * DEPENDENCIES: Requires Playwright (installed via bun install). Uses a
 * patched copy of the audio-capture test helper (audio-capture-profiling.js)
 * that exposes the rendered AudioBuffer on globalThis.__renderedBuffer.
 *
 * NOTE: Each run uses different random seeds, so absolute dB values will
 * vary by ~3-5 dB between runs. Compare the RELATIVE band levels (the
 * parenthesized numbers) and the overall shape, not absolute values.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

const N = 30;
const SUSTAIN_TIME = 1;
const CAPTURE_DURATION = 3;
const PORT = 5173;

const label =
  process.argv[2] ||
  execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' })
    .trim()
    .replace(/\//g, '-');
const outDir = path.resolve(import.meta.dirname, '..', 'tmp', `audio-profiling-${label}`);
const helpersDir = path.resolve(import.meta.dirname, '..', 'tests', 'integration', 'helpers');
const captureHelper = path.resolve(import.meta.dirname, 'audio-capture-profiling.js');

fs.mkdirSync(outDir, { recursive: true });

const BANDS = [
  { name: '  sub (0-100)', lo: 0, hi: 100 },
  { name: ' bass (100-300)', lo: 100, hi: 300 },
  { name: 'lomid (300-800)', lo: 300, hi: 800 },
  { name: '  mid (800-2k)', lo: 800, hi: 2000 },
  { name: 'himid (2k-4k)', lo: 2000, hi: 4000 },
  { name: 'treble (4k-8k)', lo: 4000, hi: 8000 },
];

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
});

console.log(`Profiling ${N} random spatches → ${outDir}/\n`);

const allSpectra = [];

for (let i = 0; i < N; i++) {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.addInitScript({ path: path.join(helpersDir, 'skip-splash.js') });
  await page.addInitScript({ path: captureHelper });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#sigil-canvas');

  // Randomize
  await page.click('#btn-randomize');

  // Schedule release breakpoint (same flow as working audio-snapshot tests)
  await page.evaluate((t) => {
    const { release } = globalThis.__testStore.data.envelope;
    globalThis.__audioCapture.suspendAt(t, 'R');
    globalThis.__audioCapture.markEvent('0', t + release);
  }, SUSTAIN_TIME);

  // Start playback, wait for audio graph to build, then start offline render
  await page.keyboard.press('Space');
  await page.waitForSelector('#btn-play.playing', { timeout: 5000 });
  await page.evaluate(() => globalThis.__audioCapture.startRendering());

  // Wait for sustain breakpoint, release
  await page.waitForFunction(() => globalThis.__audioCapture.isSuspended, null, {
    timeout: 30_000,
  });
  await page.keyboard.press('Space');
  await page.evaluate(() => globalThis.__audioCapture.resume());

  // Wait for render to complete (buffer exposed by patched helper)
  await page.waitForFunction(() => globalThis.__renderedBuffer !== undefined, null, {
    timeout: 30_000,
  });

  // Extract raw FFT magnitude data from the rendered buffer
  const spectrum = await page.evaluate((duration) => {
    const buffer = globalThis.__renderedBuffer;
    const sampleRate = buffer.sampleRate;
    const sampleCount = Math.min(Math.floor(duration * sampleRate), buffer.length);

    const FFT_N = 4096;
    const sustainStart = Math.max(0, Math.min(Math.floor(sampleCount * 0.3), sampleCount - FFT_N));

    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.getChannelData(1);
    const real = new Float32Array(FFT_N);
    const imag = new Float32Array(FFT_N);
    for (let j = 0; j < FFT_N; j++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * j) / FFT_N));
      real[j] = ((ch0[sustainStart + j] + ch1[sustainStart + j]) / 2) * w;
    }

    // Radix-2 Cooley-Tukey FFT
    const n = real.length;
    for (let ii = 1, j = 0; ii < n; ii++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) {
        j ^= bit;
      }
      j ^= bit;
      if (ii < j) {
        let tmp = real[ii];
        real[ii] = real[j];
        real[j] = tmp;
        tmp = imag[ii];
        imag[ii] = imag[j];
        imag[j] = tmp;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wR = Math.cos(ang),
        wI = Math.sin(ang);
      for (let ii = 0; ii < n; ii += len) {
        let cR = 1,
          cI = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = ii + j,
            b = a + len / 2;
          const tR = real[b] * cR - imag[b] * cI;
          const tI = real[b] * cI + imag[b] * cR;
          real[b] = real[a] - tR;
          imag[b] = imag[a] - tI;
          real[a] += tR;
          imag[a] += tI;
          const newCR = cR * wR - cI * wI;
          cI = cR * wI + cI * wR;
          cR = newCR;
        }
      }
    }

    const halfN = FFT_N / 2;
    const binHz = sampleRate / FFT_N;
    const result = Array.from({ length: halfN });
    for (let k = 0; k < halfN; k++) {
      const mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
      result[k] = { freq: k * binHz, db: 20 * Math.log10(mag + 1e-12) };
    }
    return result;
  }, CAPTURE_DURATION);

  allSpectra.push(spectrum);
  const peakDb = Math.max(...spectrum.map((b) => b.db));
  console.log(`  [${i + 1}/${N}] captured (peak ${peakDb.toFixed(1)} dB)`);

  await context.close();
}

await browser.close();

// Average spectrum
const binCount = allSpectra[0].length;
const avgSpectrum = [];
for (let bin = 0; bin < binCount; bin++) {
  const freq = allSpectra[0][bin].freq;
  let sumDb = 0;
  for (const s of allSpectra) {
    sumDb += s[bin].db;
  }
  avgSpectrum.push({ freq, db: sumDb / allSpectra.length });
}

fs.writeFileSync(path.join(outDir, 'avg-spectrum.json'), JSON.stringify(avgSpectrum));

// Band averages
const bandAvgs = BANDS.map((band) => {
  const bins = avgSpectrum.filter((b) => b.freq >= band.lo && b.freq < band.hi);
  const avgDb = bins.reduce((s, b) => s + b.db, 0) / (bins.length || 1);
  return Object.assign({}, band, { avgDb });
});

const maxBandDb = Math.max(...bandAvgs.map((b) => b.avgDb));

console.log(`\n=== Average Spectrum: ${label} (${N} samples) ===\n`);
for (const band of bandAvgs) {
  const relative = band.avgDb - maxBandDb;
  const barLen = Math.max(0, Math.round((relative + 60) * 0.8));
  const bar = '█'.repeat(barLen);
  console.log(
    `${band.name}  ${band.avgDb.toFixed(1)} dB  (${relative >= 0 ? ' ' : ''}${relative.toFixed(1)})  ${bar}`,
  );
}

fs.writeFileSync(
  path.join(outDir, 'band-summary.txt'),
  bandAvgs.map((b) => `${b.name}\t${b.avgDb.toFixed(1)} dB`).join('\n') + '\n',
);

console.log(`\nSaved to ${outDir}/`);
