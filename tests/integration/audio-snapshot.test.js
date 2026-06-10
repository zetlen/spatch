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
          ? `oklch(${v.fill.l.toFixed(2)} ${v.fill.c.toFixed(3)} ${Math.round(v.fill.h)})`
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
  if (adsr) {
    await markADSR(page);
  }
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
    // Which should still produce audible audio — not collapse to silence.
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
    await page.keyboard.press('Escape'); // Deselect so tool buttons reappear
    await placeShape(page, 'triangle', 0.5, 0.5);
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('two-voices-overlap.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('slow envelope with ADSR markers', async ({ page }) => {
    await page.evaluate(() => {
      globalThis.__testStore.updateEnvelope({
        attack: 1,
        decay: 1,
        sustain: 0.3,
        release: 1,
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
    await page.keyboard.press('Escape'); // Deselect so tool buttons reappear
    await placeShape(page, 'triangle', 0.7, 0.7);
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('two-voices-spread.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('triangle rotation 0° → 60° mid-playback', async ({ page }) => {
    // Place triangle (timbre=0, pure saw), start playing, then at t=1s
    // Perform a real rotation gesture. The OfflineAudioContext suspends at
    // That time so the engine's update() schedules param changes at the
    // Correct point in the timeline — like fake timers for audio.
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
      globalThis.__audioCapture.suspendAt(1, 'rotate');
      globalThis.__audioCapture.startRendering();
    });

    // Wait for the offline context to pause at t=1s
    await page.waitForFunction(() => globalThis.__audioCapture.isSuspended);

    // Perform the real rotation gesture via pointerdown on the canvas-wrap
    // (which owns pointer capture for rotation). The shape is at (0.5, 0.5)
    // In normalized SVG coords. We compute pixel positions from the canvas
    // Bounding box — SVG element boundingBox() is unreliable in Playwright.
    const canvasWrap = page.locator('#canvas-wrap');
    const box = await canvasWrap.boundingBox();
    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.5;

    // Use the north resize handle (directly above center) as the drag
    // Origin — tangential motion around the center produces rotation.
    const nHandle = page.locator('[data-handle="n"]');
    await nHandle.waitFor({ state: 'attached' });
    const handleNY = await nHandle.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.y + rect.height / 2;
    });
    const hx = cx; // Handle is centered horizontally over the shape
    const hy = handleNY;

    // 60° clockwise from up: pointer at (cx + r·sin(60°), cy - r·cos(60°))
    const r = cy - hy; // Distance from center to handle
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
    // Set multiply blend for FM modulation
    await page.evaluate(() => {
      globalThis.__testStore.updateBlend('multiply');
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
      globalThis.__testStore.updateBlend('difference');
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
  // Changes: creation, teardown, and multi-voice pairwise interactions.
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
      globalThis.__testStore.updateBlend('multiply');
    });
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('fm-3-voice-mixed-blend.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('non-overlapping voices with multiply blend produce no FM', async ({ page }) => {
    // Two voices far apart, both multiply blend. Distance exceeds combined
    // Radius so overlap = 0 and no FM connections should be created.
    await placeShape(page, 'circle', 0.2, 0.2);
    await page.keyboard.press('Escape');
    await placeShape(page, 'square', 0.8, 0.8);
    await page.evaluate(() => {
      globalThis.__testStore.updateBlend('multiply');
    });
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('fm-multiply-no-overlap.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('voice moved into overlap mid-playback activates FM', async ({ page }) => {
    // Two voices start far apart (no overlap). At t=1s the second voice moves
    // To overlap the first. The waveform should transition from clean to
    // FM-modulated at the move marker.
    await placeShape(page, 'circle', 0.5, 0.5);
    await page.keyboard.press('Escape');
    await placeShape(page, 'square', 0.9, 0.5);
    await page.evaluate(() => {
      globalThis.__testStore.updateBlend('multiply');
    });
    await annotateState(page);
    await page.evaluate(() => {
      globalThis.__audioCapture.annotate('move to overlap at t=1s');
    });

    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    await page.evaluate(() => {
      globalThis.__audioCapture.suspendAt(1, 'move');
      const { release } = globalThis.__testStore.data.envelope;
      globalThis.__audioCapture.suspendAt(2, 'R');
      globalThis.__audioCapture.markEvent('0', 2 + release);
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
    // Transition from FM-modulated to clean at the move marker.
    await placeShape(page, 'circle', 0.5, 0.5);
    await page.keyboard.press('Escape');
    await placeShape(page, 'square', 0.5, 0.5);
    await page.evaluate(() => {
      globalThis.__testStore.updateBlend('multiply');
    });
    await annotateState(page);
    await page.evaluate(() => {
      globalThis.__audioCapture.annotate('move away at t=1s');
    });

    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);

    await page.evaluate(() => {
      globalThis.__audioCapture.suspendAt(1, 'move');
      const { release } = globalThis.__testStore.data.envelope;
      globalThis.__audioCapture.suspendAt(2, 'R');
      globalThis.__audioCapture.markEvent('0', 2 + release);
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

  // ---- Astroid waveform tests ----
  test.describe('astroid waveform', () => {
    test('single astroid voice at timbre=0 (center pair only)', async ({ page }) => {
      await placeShape(page, 'astroid');
      await page.evaluate(() => {
        const voices = globalThis.__testStore.data.voices;
        globalThis.__testStore.updateVoice(voices[0].id, { timbre: 0 });
      });
      const png = await captureAudio(page);
      // Astroid's 6-oscillator supersaw is sensitive to cross-platform audio
      // differences (macOS vs CI Docker WebKit). Slightly wider tolerance.
      expect(Buffer.from(png, 'base64')).toMatchSnapshot('astroid-timbre-0.png', {
        maxDiffPixelRatio: 0.08,
      });
    });

    test('single astroid voice at timbre=63/64 (near-full spread)', async ({ page }) => {
      // Timbre 1 wraps to 0 (90° ≡ 0° for the 4-fold-symmetric astroid), so
      // the widest representable spread is the last serialization step
      await placeShape(page, 'astroid');
      await page.evaluate(() => {
        const voices = globalThis.__testStore.data.voices;
        globalThis.__testStore.updateVoice(voices[0].id, { timbre: 63 / 64 });
      });
      const png = await captureAudio(page);
      expect(Buffer.from(png, 'base64')).toMatchSnapshot('astroid-timbre-1.png', {
        maxDiffPixelRatio: 0.05,
      });
    });

    test('astroid rotation 0° → 45° mid-playback', async ({ page }) => {
      await placeShape(page, 'astroid');
      await annotateState(page);
      await page.evaluate(() => {
        globalThis.__audioCapture.annotate('0° → 45° at t=1s');
      });

      await page.keyboard.press('Space');
      await expect(page.locator('#btn-play')).toHaveClass(/playing/);

      await page.evaluate(() => {
        globalThis.__audioCapture.suspendAt(1, 'rotate');
        globalThis.__audioCapture.startRendering();
      });

      await page.waitForFunction(() => globalThis.__audioCapture.isSuspended);

      // Set timbre programmatically instead of via mouse drag to eliminate
      // Layout-dependent coordinate math that caused CI flakiness (#328).
      // 45° / 360° = 0.125 normalized timbre.
      await page.evaluate(() => {
        const store = globalThis.__testStore;
        const voices = store.data.voices;
        store.updateVoice(voices[0].id, { timbre: 0.125 });
      });

      await page.evaluate(() => globalThis.__audioCapture.resume());

      const png = await page.evaluate(() =>
        globalThis.__audioCapture.finishCapture({ duration: 3 }),
      );
      expect(Buffer.from(png, 'base64')).toMatchSnapshot('astroid-rotation.png', {
        maxDiffPixelRatio: 0.05,
      });
    });
  });

  test('5 voices with multiply blend in a diagonal cluster', async ({ page }) => {
    // 5 overlapping voices along a diagonal: each adjacent pair overlaps ~55%,
    // Next-nearest pairs overlap ~10%, far pairs don't overlap.
    // This produces 7 active FM connections out of 10 total pairs — a stress
    // Test for the pairwise FM loop at larger voice counts.
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
      store.updateBlend('multiply');
    });
    const png = await captureAudio(page);
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('fm-5-voice-cluster.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('blend mode switching mid-playback cycles FM character', async ({ page }) => {
    // Two overlapping voices — same setup as other FM tests to keep
    // Cross-platform divergence within tolerance. Cycles through all 4
    // Blend modes at 1s intervals so each FM character is captured.
    await placeShape(page, 'circle', 0.5, 0.5);
    await page.keyboard.press('Escape');
    await placeShape(page, 'triangle', 0.5, 0.5);
    await page.evaluate(() => {
      globalThis.__testStore.recomputeOverlap();
    });

    await annotateState(page);
    await page.evaluate(() => {
      globalThis.__audioCapture.annotate('screen → multiply → exclusion → difference');
    });

    // Schedule suspend points at 1s intervals to switch blend modes
    await page.evaluate(() => {
      globalThis.__audioCapture.suspendAt(1, 'multiply');
      globalThis.__audioCapture.suspendAt(2, 'exclusion');
      globalThis.__audioCapture.suspendAt(3, 'difference');
      globalThis.__audioCapture.suspendAt(4, 'R');
      const { release } = globalThis.__testStore.data.envelope;
      globalThis.__audioCapture.markEvent('0', 4 + release);
    });

    // Start playing (screen blend = no FM)
    await page.keyboard.press('Space');
    await expect(page.locator('#btn-play')).toHaveClass(/playing/);
    await page.evaluate(() => globalThis.__audioCapture.startRendering());

    // T=1s: switch to multiply
    await page.waitForFunction(() => globalThis.__audioCapture.isSuspended);
    await page.evaluate(() => globalThis.__testStore.updateBlend('multiply'));
    await page.evaluate(() => globalThis.__audioCapture.resume());

    // T=2s: switch to exclusion
    await page.waitForFunction(() => globalThis.__audioCapture.isSuspended);
    await page.evaluate(() => globalThis.__testStore.updateBlend('exclusion'));
    await page.evaluate(() => globalThis.__audioCapture.resume());

    // T=3s: switch to difference
    await page.waitForFunction(() => globalThis.__audioCapture.isSuspended);
    await page.evaluate(() => globalThis.__testStore.updateBlend('difference'));
    await page.evaluate(() => globalThis.__audioCapture.resume());

    // T=4s: release
    await page.waitForFunction(() => globalThis.__audioCapture.isSuspended);
    await page.keyboard.press('Space');
    await page.evaluate(() => globalThis.__audioCapture.resume());

    const png = await page.evaluate(() => globalThis.__audioCapture.finishCapture({ duration: 6 }));
    expect(Buffer.from(png, 'base64')).toMatchSnapshot('blend-mode-switching.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  // Stamp audio tests verify non-silence rather than pixel-exact snapshots.
  // Sample decoding (decodeAudioData) varies across platforms — the same MP3
  // Decoded on macOS vs the CI Docker image produces different PCM, making
  // Snapshot comparisons brittle. Oscillator tests don't have this problem
  // Because the math is deterministic.
  test.describe('stamp voices', () => {
    /** Assert captured audio PNG has non-trivial content (not all-black). */
    function expectNonSilent(pngBase64) {
      const buf = Buffer.from(pngBase64, 'base64');
      // A silent capture is ~5KB (axes + labels only). Real audio is 30KB+.
      expect(buf.length).toBeGreaterThan(15_000);
    }

    test('single palm-tree stamp produces audio', async ({ page }) => {
      await page.evaluate(() => {
        const store = globalThis.__testStore;
        store.addVoice('stamp', 0.5, 0.5);
        store.updateVoice(store.data.voices.at(-1).id, { stamp: 0 });
      });
      const png = await captureAudio(page);
      expectNonSilent(png);
    });

    test('single energy-dome stamp at high pitch produces audio', async ({ page }) => {
      await page.evaluate(() => {
        const store = globalThis.__testStore;
        store.addVoice('stamp', 0.5, 0.2);
        store.updateVoice(store.data.voices.at(-1).id, { stamp: 1 });
      });
      const png = await captureAudio(page);
      expectNonSilent(png);
    });

    test('single champagne stamp at low pitch produces audio', async ({ page }) => {
      await page.evaluate(() => {
        const store = globalThis.__testStore;
        store.addVoice('stamp', 0.5, 0.8);
        store.updateVoice(store.data.voices.at(-1).id, { stamp: 2 });
      });
      const png = await captureAudio(page);
      expectNonSilent(png);
    });

    test('stamp mixed with oscillator voices produces audio', async ({ page }) => {
      await page.evaluate(() => {
        const store = globalThis.__testStore;
        store.addVoice('sine', 0.3, 0.3);
        store.addVoice('stamp', 0.5, 0.5);
        store.updateVoice(store.data.voices.at(-1).id, { stamp: 0 });
        store.addVoice('pulse', 0.6, 0.55);
        store.updateVoice(store.data.voices.at(-1).id, { size: 0.3 });
        store.updateBlend('multiply');
      });
      const png = await captureAudio(page);
      expectNonSilent(png);
    });

    test('two stamps at different pitches produce audio', async ({ page }) => {
      await page.evaluate(() => {
        const store = globalThis.__testStore;
        store.addVoice('stamp', 0.3, 0.2);
        store.updateVoice(store.data.voices.at(-1).id, { stamp: 1 });
        store.addVoice('stamp', 0.7, 0.7);
        store.updateVoice(store.data.voices.at(-1).id, { stamp: 2 });
      });
      const png = await captureAudio(page);
      expectNonSilent(png);
    });
  });
});
