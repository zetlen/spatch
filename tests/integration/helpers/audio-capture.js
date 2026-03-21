/**
 * Audio capture helper for Playwright snapshot tests.
 * Replaces AudioContext with OfflineAudioContext for deterministic rendering.
 * Call page.addInitScript({ path: '...helpers/audio-capture.js' }) before navigating.
 *
 * API:
 *   __audioCapture.markEvent(label, timeSec) — register a labeled time marker
 *   __audioCapture.annotate(text) — add a text annotation line
 *   __audioCapture.captureWaveform({ duration? }) → base64 PNG (simple capture)
 *
 * Interaction recording (fake-timer style):
 *   __audioCapture.suspendAt(timeSec, label) — register a breakpoint
 *   __audioCapture.startRendering() — begin offline render (fire-and-forget)
 *   __audioCapture.isSuspended — true when paused at a breakpoint
 *   __audioCapture.resume() — continue past the current breakpoint
 *   __audioCapture.finishCapture({ duration? }) → base64 PNG
 *
 * Output image (1920 × 512):
 *   Top 256px  — time-domain waveform (L/R), peak-normalized, white on black
 *   Bottom 256px — frequency spectrum (FFT of sustained portion), dB scale
 *   Vertical dashed lines at marked events (gray, labeled at top)
 */

(function () {
  const OriginalOfflineAudioContext =
    globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OriginalOfflineAudioContext) {
    return;
  }

  const SAMPLE_RATE = 44100;
  const MAX_DURATION = 10; // seconds — pre-allocated buffer ceiling

  let capturedCtx = null;
  // True once startRendering() has been called. Before that, resume() is a
  // no-op (the app calls it during warmup expecting AudioContext semantics).
  let renderingStarted = false;
  // The real OfflineAudioContext.resume(), saved before shimming.
  let realResume = null;

  globalThis.AudioContext = function AudioContext() {
    const ctx = new OriginalOfflineAudioContext(2, SAMPLE_RATE * MAX_DURATION, SAMPLE_RATE);
    capturedCtx = ctx;

    // Save the real resume() for suspend/resume cycles during rendering.
    realResume = ctx.resume.bind(ctx);

    // Shim resume() — before rendering starts, the app calls it expecting
    // AudioContext.resume() semantics (initial unlock). Make that a no-op.
    // Once rendering starts, delegate to the real resume() so that
    // suspend()/resume() breakpoints work.
    ctx.resume = () => {
      if (renderingStarted) {
        return realResume();
      }
      return Promise.resolve();
    };

    // Shim createMediaStreamDestination() — not available on OfflineAudioContext.
    // Returns a gain node connected nowhere (the iOS Safari keep-alive path is
    // irrelevant in headless test browsers).
    ctx.createMediaStreamDestination = () => {
      const dummy = ctx.createGain();
      // Give it a .stream property so the engine's `_streamDest.stream` access
      // doesn't throw.
      dummy.stream = new MediaStream();
      return dummy;
    };

    return ctx;
  };

  // Preserve prototype chain so instanceof checks don't break
  globalThis.AudioContext.prototype = OriginalOfflineAudioContext.prototype;

  // Shim MediaStreamAudioDestinationNode constructor — not available on
  // OfflineAudioContext. Engine uses `new MediaStreamAudioDestinationNode(ctx)`.
  globalThis.MediaStreamAudioDestinationNode = function MediaStreamAudioDestinationNode(ctx) {
    const dummy = ctx.createGain();
    dummy.stream = new MediaStream();
    return dummy;
  };

  // ---- Radix-2 Cooley-Tukey FFT (in-place) ----

  function fft(real, imag) {
    const n = real.length;
    // Bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let tmp = real[i];
        real[i] = real[j];
        real[j] = tmp;
        tmp = imag[i];
        imag[i] = imag[j];
        imag[j] = tmp;
      }
    }
    // Butterfly passes
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wR = Math.cos(ang);
      const wI = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cR = 1;
        let cI = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j;
          const b = a + len / 2;
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
  }

  // Registered event markers: { label, time } pairs drawn as vertical lines.
  const events = [];
  // Annotation lines drawn at bottom-right.
  const annotations = [];
  // Pending suspension breakpoints: { time, label } sorted by time.
  const breakpoints = [];
  // Rendering state for interaction recording.
  let suspended = false;
  let renderBuffer = null;
  let renderResolve = null;

  /**
   * Draw a waveform + spectrum image from an AudioBuffer.
   * Shared by captureWaveform() and finishCapture().
   */
  function drawWaveform(buffer, duration) {
    const WIDTH = 1920;
    const WAVE_H = 256;
    const SPEC_H = 256;
    const HEIGHT = WAVE_H + SPEC_H;
    const HALF = WAVE_H / 2;

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const g = canvas.getContext('2d');

    g.fillStyle = '#000';
    g.fillRect(0, 0, WIDTH, HEIGHT);

    // Clamp duration to actual buffer length
    const sampleCount = Math.min(Math.floor(duration * buffer.sampleRate), buffer.length);
    const samplesPerPixel = Math.max(1, Math.floor(sampleCount / WIDTH));

    // Matches the 2-channel OfflineAudioContext created above.
    const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];

    // ---- Time-domain waveform (top) ----

    // Downsample, then peak-normalize so waveforms fill the canvas
    const downsampled = channels.map((data) => {
      const out = new Float32Array(WIDTH);
      for (let px = 0; px < WIDTH; px++) {
        let sum = 0;
        const start = px * samplesPerPixel;
        for (let s = 0; s < samplesPerPixel; s++) {
          sum += data[start + s];
        }
        out[px] = sum / samplesPerPixel;
      }
      return out;
    });

    let peak = 0;
    for (const ch of downsampled) {
      for (let i = 0; i < ch.length; i++) {
        const abs = Math.abs(ch[i]);
        if (abs > peak) peak = abs;
      }
    }
    const waveScale = peak > 0 ? 1 / peak : 1;

    g.strokeStyle = '#fff';
    g.lineWidth = 1;
    for (let ch = 0; ch < 2; ch++) {
      const data = downsampled[ch];
      const yOffset = ch * HALF;
      g.beginPath();
      for (let px = 0; px < WIDTH; px++) {
        const normalized = data[px] * waveScale;
        const y = yOffset + ((1 - normalized) / 2) * HALF;
        if (px === 0) g.moveTo(px, y);
        else g.lineTo(px, y);
      }
      g.stroke();
    }

    // ---- Frequency spectrum (bottom) ----

    // Use a 4096-point FFT from the sustain portion (30%-70% of capture)
    // to avoid attack/release transients. Average both channels.
    const FFT_N = 4096;
    const sustainStart = Math.min(Math.floor(sampleCount * 0.3), sampleCount - FFT_N);
    const real = new Float32Array(FFT_N);
    const imag = new Float32Array(FFT_N);

    // Average both channels and apply Hanning window
    for (let i = 0; i < FFT_N; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / FFT_N));
      real[i] = ((channels[0][sustainStart + i] + channels[1][sustainStart + i]) / 2) * w;
    }

    fft(real, imag);

    // Compute magnitude in dB (positive frequencies only = first half)
    const halfN = FFT_N / 2;
    const magDb = new Float32Array(halfN);
    let maxDb = -Infinity;
    for (let i = 0; i < halfN; i++) {
      const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
      magDb[i] = 20 * Math.log10(mag + 1e-12);
      if (magDb[i] > maxDb) maxDb = magDb[i];
    }

    // Show 0-8kHz range. At 44100Hz with 4096 FFT, each bin = ~10.77Hz.
    // 8kHz / 10.77 ≈ 743 bins.
    const maxFreq = 8000;
    const binCount = Math.min(halfN, Math.ceil((maxFreq / SAMPLE_RATE) * FFT_N));
    const DB_RANGE = 80; // show 80dB of dynamic range
    const dbFloor = maxDb - DB_RANGE;

    // Draw spectrum as filled area, white on black
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, WAVE_H + SPEC_H); // bottom-left

    for (let px = 0; px < WIDTH; px++) {
      // Map pixel to bin (linear frequency scale)
      const bin = Math.floor((px / WIDTH) * binCount);
      const db = Math.max(dbFloor, magDb[bin]);
      const normalized = (db - dbFloor) / DB_RANGE; // 0 = floor, 1 = peak
      const y = WAVE_H + SPEC_H * (1 - normalized);
      g.lineTo(px, y);
    }

    g.lineTo(WIDTH, WAVE_H + SPEC_H); // bottom-right
    g.closePath();
    g.fill();

    // ---- Event markers (vertical dashed lines) ----

    if (events.length > 0) {
      g.save();
      g.setLineDash([2, 6]);
      g.lineWidth = 5;
      g.strokeStyle = '#fff';
      g.font = "bold 72px 'Helvetica'";
      g.textBaseline = 'top';
      g.fillStyle = '#fff';

      for (const evt of events) {
        const px = Math.round((evt.time / duration) * WIDTH);
        if (px < 0 || px >= WIDTH) continue;

        g.beginPath();
        g.moveTo(px, 0);
        g.lineTo(px, HEIGHT);
        g.stroke();

        // Label with dark background for readability
        const textW = g.measureText(evt.label).width;
        g.fillStyle = '#000';
        g.fillRect(px + 6, 6, textW + 16, 80);
        g.fillStyle = '#fff';
        g.fillText(evt.label, px + 14, 10);
      }

      g.restore();
    }

    // ---- Bottom-right annotations ----

    if (annotations.length > 0) {
      g.save();
      g.font = "32px 'Helvetica'";
      g.textAlign = 'right';
      g.textBaseline = 'bottom';
      const lineH = 38;
      const pad = 12;
      let y = HEIGHT - pad;

      for (let i = annotations.length - 1; i >= 0; i--) {
        const text = annotations[i];
        const textW = g.measureText(text).width;
        g.fillStyle = '#000';
        g.fillRect(WIDTH - textW - pad * 2, y - lineH + 4, textW + pad * 2, lineH);
        g.fillStyle = '#fff';
        g.fillText(text, WIDTH - pad, y);
        y -= lineH;
      }

      g.restore();
    }

    return canvas.toDataURL('image/png').split(',')[1];
  }

  // Expose capture API
  globalThis.__audioCapture = {
    /** Register a labeled time marker (drawn as a vertical dashed line). */
    markEvent(label, timeSec) {
      events.push({ label, time: timeSec });
    },

    /** Add a text annotation line (drawn at bottom-right, 32px). */
    annotate(text) {
      annotations.push(text);
    },

    /**
     * Render the offline context and return the AudioBuffer.
     * Can only be called once per page load (OfflineAudioContext limitation).
     */
    async render() {
      if (!capturedCtx) {
        throw new Error('No AudioContext was created — already rendered or never initialized');
      }
      const ctx = capturedCtx;
      capturedCtx = null; // startRendering() can only be called once
      renderingStarted = true;
      return ctx.startRendering();
    },

    /**
     * Render audio and return a waveform + spectrum PNG as a base64 string.
     * Simple one-shot capture — for interaction recording, use the
     * suspendAt/startRendering/resume/finishCapture cycle instead.
     * @param {{ duration?: number }} opts
     *   duration: seconds of audio to draw (default: 5, max: MAX_DURATION)
     */
    async captureWaveform({ duration = 5 } = {}) {
      const buffer = await this.render();
      return drawWaveform(buffer, duration);
    },

    // ---- Interaction recording API ----

    /**
     * Register a suspension breakpoint. When startRendering() is called,
     * the offline context will pause at this time, allowing Playwright to
     * perform DOM interactions before resuming. Also marks an event line.
     */
    suspendAt(timeSec, label) {
      breakpoints.push({ time: timeSec, label });
      events.push({ label, time: timeSec });
    },

    /** True when the offline context is paused at a breakpoint. */
    get isSuspended() {
      return suspended;
    },

    /**
     * Begin offline rendering with registered breakpoints.
     * Fire-and-forget — the render runs asynchronously. Use isSuspended
     * to detect when it pauses, resume() to continue, and finishCapture()
     * to get the result after all breakpoints have been passed.
     */
    startRendering() {
      if (!capturedCtx) {
        throw new Error('No AudioContext was created — already rendered or never initialized');
      }
      const ctx = capturedCtx;
      capturedCtx = null;
      renderingStarted = true;

      // Sort breakpoints by time and register suspensions
      breakpoints.sort((a, b) => a.time - b.time);
      for (const bp of breakpoints) {
        ctx.suspend(bp.time).then(() => {
          suspended = true;
        });
      }

      // Start rendering — resolves when all suspensions are resumed and
      // the full buffer is rendered.
      const bufferPromise = ctx.startRendering();
      bufferPromise.then((buf) => {
        renderBuffer = buf;
        if (renderResolve) renderResolve();
      });
    },

    /**
     * Resume rendering past the current breakpoint. The context will
     * advance to the next breakpoint or to completion.
     */
    resume() {
      if (!suspended) {
        throw new Error('Not suspended — call startRendering() and wait for isSuspended');
      }
      suspended = false;
      realResume();
    },

    /**
     * Wait for rendering to complete and return the waveform PNG.
     * Call after all breakpoints have been resumed.
     * @param {{ duration?: number }} opts
     */
    async finishCapture({ duration = 5 } = {}) {
      if (!renderBuffer) {
        await new Promise((resolve) => {
          renderResolve = resolve;
        });
      }
      return drawWaveform(renderBuffer, duration);
    },
  };
})();
