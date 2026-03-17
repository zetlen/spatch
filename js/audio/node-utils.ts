// node-utils.ts — Pure Web Audio utility functions with no vibe or waveform dependencies.
//
// Kept separate from voice-builder.ts so that waveform strategy files can import
// these utilities without creating a circular dependency:
//   strategies → voice-builder → waveforms/index → strategies

/** Safely stop and disconnect an AudioScheduledSourceNode. */
export function safeStop(node: AudioScheduledSourceNode): void {
  try {
    node.stop();
    node.disconnect();
  } catch {}
}

/** Safely disconnect an AudioNode. */
export function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {}
}

/** Build a tanh saturation curve for analog warmth. */
export function makeSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * drive);
  }
  return curve;
}

/** Create a hard-clipping waveshaper curve for pulse-width modulation. */
export function createPWMWaveshaper(audioCtx: AudioContext): WaveShaperNode {
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = x > 0 ? 1 : -1;
  }
  const ws = new WaveShaperNode(audioCtx, { curve, oversample: '4x' });
  return ws;
}
