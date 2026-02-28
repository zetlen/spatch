// effects.js — Audio effect builders mapped to visual patterns

export function createEffect(audioCtx, pattern, workletReady) {
  switch (pattern) {
    case 'stripes':  return createChorus(audioCtx);
    case 'checker':  return createTremolo(audioCtx);
    case 'noise':    return createFlanger(audioCtx);
    case 'gradient': return createPhaser(audioCtx);
    case 'rough':    return createBitcrusher(audioCtx, workletReady);
    default:         return null;
  }
}

// Raster stripes → Chorus
function createChorus(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 0.7;
  const wet = ctx.createGain(); wet.gain.value = 0.5;

  const delay = ctx.createDelay(0.1);
  delay.delayTime.value = 0.025;

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 1.5;

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.002;

  lfo.connect(lfoGain);
  lfoGain.connect(delay.delayTime);
  lfo.start();

  input.connect(dry);
  input.connect(delay);
  delay.connect(wet);
  dry.connect(output);
  wet.connect(output);

  return { input, output, dispose: () => lfo.stop() };
}

// Checkerboard → LFO Tremolo
function createTremolo(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const tremoloGain = ctx.createGain();
  tremoloGain.gain.value = 0.5;

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 6;

  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.5;

  lfo.connect(lfoDepth);
  lfoDepth.connect(tremoloGain.gain);
  lfo.start();

  input.connect(tremoloGain);
  tremoloGain.connect(output);

  return { input, output, dispose: () => lfo.stop() };
}

// Noise texture → Flanger
function createFlanger(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 0.7;
  const wet = ctx.createGain(); wet.gain.value = 0.7;

  const delay = ctx.createDelay(0.02);
  delay.delayTime.value = 0.005;

  const feedback = ctx.createGain();
  feedback.gain.value = 0.6;

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.25;

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.004;

  lfo.connect(lfoGain);
  lfoGain.connect(delay.delayTime);
  lfo.start();

  input.connect(dry);
  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  dry.connect(output);
  wet.connect(output);

  return { input, output, dispose: () => lfo.stop() };
}

// Gradient overlay → Phaser
function createPhaser(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 0.8;
  const wet = ctx.createGain(); wet.gain.value = 0.6;

  const allpassFreqs = [350, 1100, 2700, 5500];
  const filters = allpassFreqs.map(freq => {
    const f = ctx.createBiquadFilter();
    f.type = 'allpass';
    f.frequency.value = freq;
    f.Q.value = 0.7;
    return f;
  });

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.5;

  const lfos = [];
  for (const f of filters) {
    const lg = ctx.createGain();
    lg.gain.value = 500;
    lfo.connect(lg);
    lg.connect(f.frequency);
    lfos.push(lg);
  }
  lfo.start();

  // Chain allpass filters
  input.connect(filters[0]);
  for (let i = 0; i < filters.length - 1; i++) {
    filters[i].connect(filters[i + 1]);
  }
  filters[filters.length - 1].connect(wet);

  input.connect(dry);
  dry.connect(output);
  wet.connect(output);

  return { input, output, dispose: () => lfo.stop() };
}

// Rough/distressed → Bitcrusher
function createBitcrusher(ctx, workletReady) {
  if (workletReady) {
    try {
      const node = new AudioWorkletNode(ctx, 'bitcrusher-processor');
      node.parameters.get('bitDepth').value = 6;
      node.parameters.get('frequencyReduction').value = 0.3;
      return { input: node, output: node, dispose: () => {} };
    } catch (e) {
      // fall through to waveshaper
    }
  }

  // Fallback: WaveShaper distortion
  const ws = ctx.createWaveShaper();
  const samples = 4096;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    // Hard clipping with some staircasing
    const quantized = Math.round(x * 8) / 8;
    curve[i] = quantized;
  }
  ws.curve = curve;
  ws.oversample = '2x';
  return { input: ws, output: ws, dispose: () => {} };
}
