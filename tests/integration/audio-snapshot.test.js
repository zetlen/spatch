import { expect, test } from '@playwright/test';
import path from 'path';

/** Helper: place a shape using the given tool at a normalized position (0-1). */
async function placeShape(page, tool, nx = 0.5, ny = 0.5) {
  await page.click(`[data-tool="${tool}"]`);
  const canvas = page.locator('#sigil-canvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * nx, y: box.height * ny } });
}

/** Helper: mark ADSR envelope events on the capture timeline. */
async function markADSR(page) {
  await page.evaluate(() => {
    const { attack, decay } = globalThis.__testStore.data.envelope;
    globalThis.__audioCapture.markEvent('A', 0);
    globalThis.__audioCapture.markEvent('D', attack);
    globalThis.__audioCapture.markEvent('S', attack + decay);
  });
}

/** Helper: annotate scene name, voice waveforms, fills, and borders. */
async function annotateState(page) {
  await page.evaluate(() => {
    const store = globalThis.__testStore;
    const { voices, scene } = store.data;
    // Scene name from the stage credit text (visible in DOM)
    const credit = document.querySelector('.image-credit');
    const sceneName = credit?.textContent?.trim() || `scene ${scene}`;
    globalThis.__audioCapture.annotate(sceneName);
    for (const v of voices) {
      const fill =
        v.fill.mode === 'solid'
          ? `hsl(${v.fill.h},${v.fill.s}%,${v.fill.l}%)`
          : `grad(${v.fill.h}→${v.fill.h2})`;
      const oct = v.border
        ? `oct:${v.border.color === 'white' ? '+' : '-'}${v.border.double ? 2 : 1}`
        : '';
      globalThis.__audioCapture.annotate(`${v.waveform} ${fill}${oct ? ' ' + oct : ''}`);
    }
  });
}

/**
 * Helper: play audio, release at a breakpoint, and capture through the
 * reverb tail. Uses suspend/resume so the release flows through the real
 * playback controller path (Space → playback.stop → audio.release).
 *
 * @param {number} sustainTime  — seconds to sustain before releasing
 * @param {number} duration     — total capture length (must exceed sustain + release + reverb)
 */
async function captureAudio(page, { sustainTime = 1, duration = 4, adsr = false } = {}) {
  if (adsr) await markADSR(page);
  await annotateState(page);

  // Mark the release point and ADSR release marker
  await page.evaluate((t) => {
    const { release } = globalThis.__testStore.data.envelope;
    globalThis.__audioCapture.suspendAt(t, 'R');
    globalThis.__audioCapture.markEvent('0', t + release);
  }, sustainTime);

  // Start latched play and begin offline rendering
  await page.keyboard.press('Space');
  await expect(page.locator('#btn-play')).toHaveClass(/playing/);
  await page.evaluate(() => globalThis.__audioCapture.startRendering());

  // Wait for the sustain breakpoint, then press Space to release
  await page.waitForFunction(() => globalThis.__audioCapture.isSuspended);
  await page.keyboard.press('Space');

  // Resume rendering through the release + reverb tail
  await page.evaluate(() => globalThis.__audioCapture.resume());

  return page.evaluate((d) => globalThis.__audioCapture.finishCapture({ duration: d }), duration);
}

test.describe('Audio waveform snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({
      path: path.join(import.meta.dirname, 'helpers/skip-splash.js'),
    });
    await page.addInitScript({
      path: path.join(import.meta.dirname, 'helpers/seed-random.js'),
    });
    await page.addInitScript({
      path: path.join(import.meta.dirname, 'helpers/audio-capture.js'),
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('single sine voice', async ({ page }) => {
    await placeShape(page, 'circle');
    const png = await captureAudio(page, { adsr: true });
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('sine-voice.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('single triangle voice', async ({ page }) => {
    await placeShape(page, 'triangle');
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('triangle-voice.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('single square voice', async ({ page }) => {
    await placeShape(page, 'square');
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('square-voice.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('square voice at axis-aligned rotation (timbre=0)', async ({ page }) => {
    // At 0° rotation (and 90°, 180°, 270°) the pulse timbre maps to 0,
    // which should still produce audible audio — not collapse to silence.
    await placeShape(page, 'square');
    await page.evaluate(() => {
      const voices = globalThis.__testStore.data.voices;
      // Explicitly set timbre=0 (equivalent to 0° rotation for pulse)
      globalThis.__testStore.updateVoice(voices[0].id, { timbre: 0 });
    });
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('square-axis-rotation.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('high pitch vs low pitch', async ({ page }) => {
    // Place circle near top (high pitch) — y maps to frequency
    await placeShape(page, 'circle', 0.5, 0.2);
    const highPng = await captureAudio(page);
    expect(Buffer.from(highPng, 'base64')).toMatchSnapshot('high-pitch.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('low pitch', async ({ page }) => {
    // Place circle near bottom (low pitch)
    await placeShape(page, 'circle', 0.5, 0.8);
    const lowPng = await captureAudio(page);
    expect(Buffer.from(lowPng, 'base64')).toMatchSnapshot('low-pitch.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('two overlapping voices', async ({ page }) => {
    // Two shapes at same position triggers FM synthesis from overlap
    await placeShape(page, 'circle', 0.5, 0.5);
    await page.keyboard.press('Escape'); // deselect so tool buttons reappear
    await placeShape(page, 'triangle', 0.5, 0.5);
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('two-voices-overlap.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('slow envelope with ADSR markers', async ({ page }) => {
    await page.evaluate(() => {
      globalThis.__testStore.updateEnvelope({
        attack: 1.0,
        decay: 1.0,
        sustain: 0.3,
        release: 1.0,
      });
    });
    await placeShape(page, 'circle');
    // Sustain at t=3s (after A+D), capture 7s total to show full release + reverb
    const png = await captureAudio(page, { sustainTime: 3, duration: 7, adsr: true });
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('slow-envelope.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('two voices at different pitches', async ({ page }) => {
    // Spread voices vertically — different pitches, no overlap
    await placeShape(page, 'circle', 0.3, 0.3);
    await page.keyboard.press('Escape'); // deselect so tool buttons reappear
    await placeShape(page, 'triangle', 0.7, 0.7);
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('two-voices-spread.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('triangle rotation 0° → 60° mid-playback', async ({ page }) => {
    // Place triangle (timbre=0, pure saw), start playing, then at t=1s
    // perform a real rotation gesture. The OfflineAudioContext suspends at
    // that time so the engine's update() schedules param changes at the
    // correct point in the timeline — like fake timers for audio.
    await placeShape(page, 'triangle');
    await annotateState(page);
    await page.evaluate(() => {
      globalThis.__audioCapture.annotate('0° → 60° at t=1s');
    });

    // Start play to build the audio graph on the OfflineAudioContext
    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    // Register a breakpoint at t=1s and start rendering
    await page.evaluate(() => {
      globalThis.__audioCapture.suspendAt(1.0, 'rotate');
      globalThis.__audioCapture.startRendering();
    });

    // Wait for the offline context to pause at t=1s
    await page.waitForFunction(() => globalThis.__audioCapture.isSuspended);

    // Perform the real rotation gesture via pointerdown on the canvas-wrap
    // (which owns pointer capture for rotation). The shape is at (0.5, 0.5)
    // in normalized SVG coords. We compute pixel positions from the canvas
    // bounding box — SVG element boundingBox() is unreliable in Playwright.
    const canvasWrap = page.locator('#canvas-wrap');
    const box = await canvasWrap.boundingBox();
    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.5;

    // The rotate handle is above the shape center. Get its normalized y
    // from the SVG element's cy attribute, then convert to page pixels.
    const rotHandle = page.locator('[data-handle="rotate"]');
    await rotHandle.waitFor({ state: 'attached' });
    const handleNY = await rotHandle.evaluate((el) => parseFloat(el.getAttribute('cy')));
    const hx = cx; // handle is centered horizontally over the shape
    const hy = box.y + box.height * handleNY;

    // 60° clockwise from up: pointer at (cx + r·sin(60°), cy - r·cos(60°))
    const r = cy - hy; // distance from center to handle
    const targetX = cx + r * Math.sin((60 * Math.PI) / 180);
    const targetY = cy - r * Math.cos((60 * Math.PI) / 180);

    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 5 });
    await page.mouse.up();

    // Resume rendering past the breakpoint
    await page.evaluate(() => globalThis.__audioCapture.resume());

    // Finish and capture the waveform
    const png = await page.evaluate(() => globalThis.__audioCapture.finishCapture({ duration: 3 }));
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('triangle-rotation.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('FM synthesis: multiply blend overlapping voices', async ({ page }) => {
    await placeShape(page, 'circle', 0.5, 0.5);
    await page.keyboard.press('Escape');
    await placeShape(page, 'triangle', 0.5, 0.5);
    // Set multiply blend on the second voice for FM modulation
    await page.evaluate(() => {
      const voices = globalThis.__testStore.data.voices;
      globalThis.__testStore.updateVoice(voices[1].id, { blend: 'multiply' });
    });
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('fm-multiply-overlap.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('FM synthesis: difference blend overlapping voices', async ({ page }) => {
    await placeShape(page, 'circle', 0.5, 0.5);
    await page.keyboard.press('Escape');
    await placeShape(page, 'triangle', 0.5, 0.5);
    await page.evaluate(() => {
      const voices = globalThis.__testStore.data.voices;
      globalThis.__testStore.updateVoice(voices[1].id, { blend: 'difference' });
    });
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('fm-difference-overlap.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('screen blend: no FM even when overlapping', async ({ page }) => {
    // Screen is default — overlapping shapes should sound like non-overlapping
    await placeShape(page, 'circle', 0.5, 0.5);
    await page.keyboard.press('Escape');
    await placeShape(page, 'triangle', 0.5, 0.5);
    // Both voices have screen (default), so no FM
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('screen-no-fm-overlap.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  // ---- FM interaction tests ----
  // These exercise the FM connection lifecycle during mid-playback state
  // changes: creation, teardown, and multi-voice pairwise interactions.
  // The audio snapshot captures the full timeline so any regression in
  // FM depth, timing, or connection management shows as a pixel diff.

  test('3 voices with mixed blend modes and partial overlap', async ({ page }) => {
    // Circle at center (screen), square at left (multiply), triangle at right (difference).
    // Circle overlaps both neighbors; square and triangle don't overlap each other.
    // Tests simultaneous FM connections with different FM characters on one carrier.
    await placeShape(page, 'circle', 0.5, 0.5);
    await page.keyboard.press('Escape');
    await placeShape(page, 'square', 0.35, 0.5);
    await page.keyboard.press('Escape');
    await placeShape(page, 'triangle', 0.65, 0.5);
    await page.evaluate(() => {
      const voices = globalThis.__testStore.data.voices;
      globalThis.__testStore.updateVoice(voices[1].id, { blend: 'multiply' });
      globalThis.__testStore.updateVoice(voices[2].id, { blend: 'difference' });
    });
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('fm-3-voice-mixed-blend.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('non-overlapping voices with multiply blend produce no FM', async ({ page }) => {
    // Two voices far apart, both multiply blend. Distance exceeds combined
    // radius so overlap = 0 and no FM connections should be created.
    await placeShape(page, 'circle', 0.2, 0.2);
    await page.keyboard.press('Escape');
    await placeShape(page, 'square', 0.8, 0.8);
    await page.evaluate(() => {
      const voices = globalThis.__testStore.data.voices;
      globalThis.__testStore.updateVoice(voices[0].id, { blend: 'multiply' });
      globalThis.__testStore.updateVoice(voices[1].id, { blend: 'multiply' });
    });
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('fm-multiply-no-overlap.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('voice moved into overlap mid-playback activates FM', async ({ page }) => {
    // Two voices start far apart (no overlap). At t=1s the second voice moves
    // to overlap the first. The waveform should transition from clean to
    // FM-modulated at the move marker.
    await placeShape(page, 'circle', 0.5, 0.5);
    await page.keyboard.press('Escape');
    await placeShape(page, 'square', 0.9, 0.5);
    await page.evaluate(() => {
      const voices = globalThis.__testStore.data.voices;
      globalThis.__testStore.updateVoice(voices[1].id, { blend: 'multiply' });
    });
    await annotateState(page);
    await page.evaluate(() => {
      globalThis.__audioCapture.annotate('move to overlap at t=1s');
    });

    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    await page.evaluate(() => {
      globalThis.__audioCapture.suspendAt(1.0, 'move');
      const { release } = globalThis.__testStore.data.envelope;
      globalThis.__audioCapture.suspendAt(2.0, 'R');
      globalThis.__audioCapture.markEvent('0', 2.0 + release);
      globalThis.__audioCapture.startRendering();
    });

    // Wait for t=1s, move voice to overlap
    await page.waitForFunction(() => globalThis.__audioCapture.isSuspended);
    await page.evaluate(() => {
      const voices = globalThis.__testStore.data.voices;
      globalThis.__testStore.updateVoice(voices[1].id, { x: 0.5 });
    });
    await page.evaluate(() => globalThis.__audioCapture.resume());

    // Wait for t=2s, release
    await page.waitForFunction(() => globalThis.__audioCapture.isSuspended);
    await page.keyboard.press('Space');
    await page.evaluate(() => globalThis.__audioCapture.resume());

    const png = await page.evaluate(() => globalThis.__audioCapture.finishCapture({ duration: 4 }));
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('fm-move-into-overlap.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('voice moved out of overlap mid-playback deactivates FM', async ({ page }) => {
    // Two voices start fully overlapping with multiply blend (active FM).
    // At t=1s the second voice moves far away. The waveform should
    // transition from FM-modulated to clean at the move marker.
    await placeShape(page, 'circle', 0.5, 0.5);
    await page.keyboard.press('Escape');
    await placeShape(page, 'square', 0.5, 0.5);
    await page.evaluate(() => {
      const voices = globalThis.__testStore.data.voices;
      globalThis.__testStore.updateVoice(voices[1].id, { blend: 'multiply' });
    });
    await annotateState(page);
    await page.evaluate(() => {
      globalThis.__audioCapture.annotate('move away at t=1s');
    });

    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    await page.evaluate(() => {
      globalThis.__audioCapture.suspendAt(1.0, 'move');
      const { release } = globalThis.__testStore.data.envelope;
      globalThis.__audioCapture.suspendAt(2.0, 'R');
      globalThis.__audioCapture.markEvent('0', 2.0 + release);
      globalThis.__audioCapture.startRendering();
    });

    // Wait for t=1s, move voice away
    await page.waitForFunction(() => globalThis.__audioCapture.isSuspended);
    await page.evaluate(() => {
      const voices = globalThis.__testStore.data.voices;
      globalThis.__testStore.updateVoice(voices[1].id, { x: 0.9 });
    });
    await page.evaluate(() => globalThis.__audioCapture.resume());

    // Wait for t=2s, release
    await page.waitForFunction(() => globalThis.__audioCapture.isSuspended);
    await page.keyboard.press('Space');
    await page.evaluate(() => globalThis.__audioCapture.resume());

    const png = await page.evaluate(() => globalThis.__audioCapture.finishCapture({ duration: 4 }));
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('fm-move-out-of-overlap.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('5 voices with multiply blend in a diagonal cluster', async ({ page }) => {
    // 5 overlapping voices along a diagonal: each adjacent pair overlaps ~55%,
    // next-nearest pairs overlap ~10%, far pairs don't overlap.
    // This produces 7 active FM connections out of 10 total pairs — a stress
    // test for the pairwise FM loop at larger voice counts.
    await page.evaluate(() => {
      const store = globalThis.__testStore;
      const waveforms = ['sine', 'pulse', 'blend', 'sine', 'pulse'];
      const positions = [
        [0.3, 0.3],
        [0.38, 0.38],
        [0.46, 0.46],
        [0.54, 0.54],
        [0.62, 0.62],
      ];
      for (let i = 0; i < 5; i++) {
        store.addVoice(waveforms[i], positions[i][0], positions[i][1]);
      }
      for (const v of store.data.voices) {
        store.updateVoice(v.id, { blend: 'multiply' });
      }
    });
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('fm-5-voice-cluster.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
