# Audio Diffing in E2E Tests

**Issue:** #235
**Date:** 2026-03-09

## Goal

Catch audio synthesis regressions in CI by snapshot-diffing waveform PNGs.
A change in pitch, timbre, amplitude, effects, or envelope shows up as a
visual difference in the waveform image.

## Approach

A new Playwright helper `audio-capture.js` monkey-patches `AudioContext` to
swap it for an `OfflineAudioContext`. The app builds its audio graph
identically, but rendering is deterministic — no hardware timing jitter.

### Monkey-patch strategy

Follows the same pattern as the existing `audio-tap.js`:

1. Save original `AudioContext`
2. Replace `globalThis.AudioContext` with a wrapper that creates
   `OfflineAudioContext(2, sampleRate * maxDuration, sampleRate)`
3. Shim incompatible APIs:
   - `resume()` → no-op returning resolved promise
   - `createMediaStreamDestination()` → returns a dummy gain node
     (iOS Safari keep-alive is irrelevant in tests)
4. Expose `globalThis.__audioCapture` with render and capture methods

### OfflineAudioContext buffer length

OfflineAudioContext requires a fixed buffer length at construction. The helper
pre-allocates a generous buffer (10s at 44100Hz). `captureWaveform()` accepts
a `duration` parameter to render/draw only the relevant portion.

### Waveform rendering

The captured buffer is downsampled by averaging samples per pixel. At 44.1kHz
and 5s, that's ~215 samples per pixel across 1024px width. Both stereo
channels are drawn (top half = L, bottom half = R) on a 1024×256 canvas with
black background and green waveform lines.

### `__audioCapture` API

- `render()` — calls `startRendering()`, stores and returns the AudioBuffer
- `captureWaveform({ duration? })` — renders, downsamples to canvas, returns
  base64-encoded PNG string

### Test pattern

```js
test('single sine voice waveform', async ({ page }) => {
  // ... place a circle, trigger play ...
  const png = await page.evaluate(async () => {
    return await globalThis.__audioCapture.captureWaveform({ duration: 2 });
  });
  expect(Buffer.from(png, 'base64')).toMatchSnapshot('sine-voice.png');
});
```

Baselines are per-browser (Playwright stores them automatically). First run
writes the snapshot; subsequent runs diff pixel-for-pixel.

## What it catches

- Wrong pitch (frequency change → different waveform shape)
- Missing/extra voices (amplitude envelope changes)
- Broken effects (chorus, reverb, blend effects alter the waveform)
- ADSR regressions (attack/decay/sustain visible in amplitude curve)
- Gain mapping changes (louder/quieter → different amplitude)

## What it doesn't catch (by design)

- Cross-browser floating-point differences (baselines are per-browser)
- Subtle stereo pan precision (downsampling smooths small shifts)

## Files

- `tests/integration/helpers/audio-capture.js` — monkey-patch + capture API
- `tests/integration/audio-snapshot.test.js` — snapshot tests

No app source changes needed.
