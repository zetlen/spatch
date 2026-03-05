/**
 * Audio tap helper for Playwright integration tests.
 * Monkey-patches AudioContext to inject an AnalyserNode before destination.
 * Call page.addInitScript({ path: 'tests/integration/helpers/audio-tap.js' })
 * before navigating.
 */

(function () {
  const OriginalAudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!OriginalAudioContext) {
    return;
  }

  const origConnect = AudioNode.prototype.connect;

  globalThis.AudioContext = function AudioContext(...args) {
    const ctx = new OriginalAudioContext(...args);

    // Create analyser tap
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;

    // Intercept connections to destination
    const origDestination = ctx.destination;
    const tapGain = ctx.createGain();
    tapGain.gain.value = 1;
    origConnect.call(tapGain, analyser);
    origConnect.call(analyser, origDestination);

    // Patch connect so anything going to destination routes through our tap
    AudioNode.prototype.connect = function connect(dest, ...rest) {
      if (dest === origDestination) {
        return origConnect.call(this, tapGain, ...rest);
      }
      return origConnect.call(this, dest, ...rest);
    };

    // Expose tap API
    globalThis.__audioTap = {
      analyser,
      context: ctx,

      getAmplitude() {
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i] * data[i];
        }
        return Math.sqrt(sum / data.length);
      },

      getFrequencyData() {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        return [...data];
      },

      getPeakFrequency() {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        let maxVal = 0;
        let maxIdx = 0;
        for (let i = 0; i < data.length; i++) {
          if (data[i] > maxVal) {
            maxVal = data[i];
            maxIdx = i;
          }
        }
        const nyquist = ctx.sampleRate / 2;
        return (maxIdx / data.length) * nyquist;
      },

      isPlaying() {
        return this.getAmplitude() > 0.001;
      },
    };

    return ctx;
  };

  // Preserve prototype chain
  globalThis.AudioContext.prototype = OriginalAudioContext.prototype;
})();
