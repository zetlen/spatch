// Debug-only vibe tuner panel. Async-imported when ?debug=vibe is in URL.
// Elided entirely from production builds via __VIBE_DEBUG__ define.

import { Vibe, VIBE_DEFAULTS, setVibe } from '../audio/vibe.ts';
import { SCENES } from '../audio/vibe-presets.ts';
import type { VibeOptions } from '../audio/vibe.ts';
import type { AudioEngine } from '../audio/engine.ts';
import type { SigilStore } from '../state.ts';
import type { WaveformType } from '../types.ts';

interface TunerDeps {
  audio: AudioEngine;
  store: SigilStore;
}

const WAVEFORM_COLORS: Record<WaveformType, string> = {
  sine: '#4488ff',
  pulse: '#ff4444',
  blend: '#44cc44',
};

interface SliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

interface SliderSection {
  title: string;
  sliders: SliderDef[];
}

const SECTIONS: SliderSection[] = [
  {
    title: 'Gain Curve',
    sliders: [
      { key: 'norm', label: 'norm', min: 0.05, max: 1.0, step: 0.01 },
      { key: 'refMult', label: 'refMult', min: 0.3, max: 2.5, step: 0.05 },
      { key: 'exp:sine', label: 'exp:sine', min: 0.3, max: 3.0, step: 0.1 },
      { key: 'exp:pulse', label: 'exp:pulse', min: 0.3, max: 3.0, step: 0.1 },
      { key: 'exp:blend', label: 'exp:blend', min: 0.3, max: 3.0, step: 0.1 },
    ],
  },
  {
    title: 'Reverb / Ambience',
    sliders: [
      { key: 'reverbDuration', label: 'reverbDuration', min: 0.1, max: 5.0, step: 0.1 },
      { key: 'reverbDecay', label: 'reverbDecay', min: 0.5, max: 10.0, step: 0.1 },
      { key: 'reverbTone', label: 'reverbTone', min: 0.0, max: 1.0, step: 0.05 },
      { key: 'reverbMix', label: 'reverbMix', min: 0.0, max: 1.0, step: 0.01 },
      { key: 'reverbPreDelay', label: 'reverbPreDelay', min: 0.0, max: 0.5, step: 0.01 },
    ],
  },
  {
    title: 'Mastering',
    sliders: [
      { key: 'compThreshold', label: 'compThreshold', min: -40, max: 0, step: 1 },
      { key: 'compKnee', label: 'compKnee', min: 0, max: 40, step: 1 },
      { key: 'compRatio', label: 'compRatio', min: 1, max: 20, step: 0.5 },
      { key: 'compAttack', label: 'compAttack', min: 0.001, max: 0.1, step: 0.001 },
      { key: 'compRelease', label: 'compRelease', min: 0.01, max: 1.0, step: 0.01 },
      { key: 'masterGain', label: 'masterGain', min: 0.0, max: 1.0, step: 0.01 },
    ],
  },
  {
    title: 'EQ',
    sliders: [
      { key: 'eqLowFreq', label: 'eqLowFreq', min: 50, max: 500, step: 10 },
      { key: 'eqLowGain', label: 'eqLowGain', min: -12, max: 12, step: 0.5 },
      { key: 'eqMidFreq', label: 'eqMidFreq', min: 200, max: 5000, step: 50 },
      { key: 'eqMidGain', label: 'eqMidGain', min: -12, max: 12, step: 0.5 },
      { key: 'eqMidQ', label: 'eqMidQ', min: 0.1, max: 10, step: 0.1 },
      { key: 'eqHighFreq', label: 'eqHighFreq', min: 1000, max: 16000, step: 100 },
      { key: 'eqHighGain', label: 'eqHighGain', min: -12, max: 12, step: 0.5 },
    ],
  },
  {
    title: 'Synthesis',
    sliders: [
      { key: 'warmth', label: 'warmth', min: 0.5, max: 5.0, step: 0.1 },
      { key: 'formantMix', label: 'formantMix', min: 0.0, max: 1.0, step: 0.01 },
      { key: 'formantQ', label: 'formantQ', min: 0.1, max: 3.0, step: 0.1 },
      { key: 'brightnessQ', label: 'brightnessQ', min: 0.1, max: 3.0, step: 0.1 },
      { key: 'stereoWidth', label: 'stereoWidth', min: 0.0, max: 2.0, step: 0.05 },
    ],
  },
  {
    title: 'Octave Gain',
    sliders: [
      { key: 'oct:up-1', label: 'up-1', min: 0, max: 3, step: 0.05 },
      { key: 'oct:up-2', label: 'up-2', min: 0, max: 3, step: 0.05 },
      { key: 'oct:down-1', label: 'down-1', min: 0, max: 3, step: 0.05 },
      { key: 'oct:down-2', label: 'down-2', min: 0, max: 3, step: 0.05 },
    ],
  },
];

/** Get the precision needed to display a step value (e.g. step=0.01 -> 2 decimals). */
function stepPrecision(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Read a param value from state by slider key. */
function readState(state: Record<string, number>, key: string): number {
  return state[key]!;
}

/** Read the default value for a slider key from VIBE_DEFAULTS. */
function defaultForKey(key: string): number {
  if (key.startsWith('exp:')) {
    return VIBE_DEFAULTS.exponents[key.slice(4) as WaveformType];
  }
  if (key.startsWith('oct:')) {
    return VIBE_DEFAULTS.octaveGainCoeffs[key.slice(4)]!;
  }
  return (VIBE_DEFAULTS as unknown as Record<string, number>)[key]!;
}

/** Build a VibeOptions from the flat state map. */
function stateToVibeOptions(state: Record<string, number>): VibeOptions {
  return {
    norm: state['norm'],
    refMult: state['refMult'],
    exponents: {
      sine: state['exp:sine'],
      pulse: state['exp:pulse'],
      blend: state['exp:blend'],
    },
    reverbDuration: state['reverbDuration'],
    reverbDecay: state['reverbDecay'],
    reverbTone: state['reverbTone'],
    reverbMix: state['reverbMix'],
    reverbPreDelay: state['reverbPreDelay'],
    compThreshold: state['compThreshold'],
    compKnee: state['compKnee'],
    compRatio: state['compRatio'],
    compAttack: state['compAttack'],
    compRelease: state['compRelease'],
    masterGain: state['masterGain'],
    eqLowFreq: state['eqLowFreq'],
    eqLowGain: state['eqLowGain'],
    eqMidFreq: state['eqMidFreq'],
    eqMidGain: state['eqMidGain'],
    eqMidQ: state['eqMidQ'],
    eqHighFreq: state['eqHighFreq'],
    eqHighGain: state['eqHighGain'],
    warmth: state['warmth'],
    formantMix: state['formantMix'],
    formantQ: state['formantQ'],
    brightnessQ: state['brightnessQ'],
    stereoWidth: state['stereoWidth'],
    octaveGainCoeffs: {
      'up-1': state['oct:up-1'],
      'up-2': state['oct:up-2'],
      'down-1': state['oct:down-1'],
      'down-2': state['oct:down-2'],
    },
  };
}

/** Initialize the flat state from VIBE_DEFAULTS. */
function createDefaultState(): Record<string, number> {
  const s: Record<string, number> = {};
  for (const section of SECTIONS) {
    for (const def of section.sliders) {
      s[def.key] = defaultForKey(def.key);
    }
  }
  return s;
}

/** Apply a VibeOptions (potentially partial) on top of defaults into the flat state map. */
function applyVibeToState(state: Record<string, number>, opts: Partial<VibeOptions>): void {
  const full = { ...VIBE_DEFAULTS, ...opts };
  const exponents = { ...VIBE_DEFAULTS.exponents, ...opts.exponents };
  const octave = { ...VIBE_DEFAULTS.octaveGainCoeffs, ...opts.octaveGainCoeffs };

  for (const section of SECTIONS) {
    for (const def of section.sliders) {
      if (def.key.startsWith('exp:')) {
        state[def.key] = exponents[def.key.slice(4) as WaveformType];
      } else if (def.key.startsWith('oct:')) {
        state[def.key] = octave[def.key.slice(4)]!;
      } else {
        state[def.key] = (full as unknown as Record<string, number>)[def.key]!;
      }
    }
  }
}

export function init(deps: TunerDeps): void {
  const { audio, store } = deps;

  const state = createDefaultState();

  // Apply current scene's vibe to state
  const currentScene = SCENES[store.data.scene % SCENES.length];
  if (currentScene) applyVibeToState(state, currentScene.vibe);

  // --- Slider input references for syncing ---
  const sliderInputs: Record<string, HTMLInputElement> = {};
  const valueDisplays: Record<string, HTMLSpanElement> = {};

  // --- Build drawer DOM ---

  const drawer = document.createElement('div');
  drawer.id = 'vibe-tuner';
  Object.assign(drawer.style, {
    position: 'fixed',
    top: '0',
    right: '0',
    width: '360px',
    height: '100vh',
    zIndex: '99999',
    background: '#1a1a1a',
    color: '#ccc',
    fontFamily: 'monospace',
    fontSize: '11px',
    overflowY: 'auto',
    overflowX: 'hidden',
    borderLeft: '2px solid #444',
    boxShadow: '-4px 0 12px rgba(0,0,0,0.5)',
    boxSizing: 'border-box',
  });

  // --- Header row ---

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid #333',
    position: 'sticky',
    top: '0',
    background: '#1a1a1a',
    zIndex: '1',
  });

  const title = document.createElement('span');
  title.textContent = 'Vibe Tuner';
  Object.assign(title.style, { fontSize: '14px', fontWeight: 'bold', color: '#fff' });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00d7';
  Object.assign(closeBtn.style, {
    background: 'none',
    border: 'none',
    color: '#888',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: '1',
  });
  closeBtn.addEventListener('click', () => drawer.remove());

  header.append(title, closeBtn);
  drawer.append(header);

  // --- Scene selector ---

  const sceneRow = document.createElement('div');
  Object.assign(sceneRow.style, { padding: '8px 12px', borderBottom: '1px solid #333' });

  const sceneLabel = document.createElement('label');
  sceneLabel.textContent = 'Scene: ';
  sceneLabel.style.color = '#aaa';

  const sceneSelect = document.createElement('select');
  Object.assign(sceneSelect.style, {
    background: '#333',
    color: '#fff',
    border: '1px solid #555',
    borderRadius: '3px',
    fontFamily: 'monospace',
    fontSize: '11px',
    padding: '2px 4px',
    marginLeft: '6px',
  });

  for (let i = 0; i < SCENES.length; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = SCENES[i]!.name;
    sceneSelect.append(opt);
  }
  sceneSelect.value = String(store.data.scene);

  sceneSelect.addEventListener('change', () => {
    const idx = Number(sceneSelect.value);
    store.updateScene(idx);
    // Sync sliders to new scene vibe
    const sceneDef = SCENES[idx % SCENES.length];
    applyVibeToState(state, sceneDef?.vibe ?? {});
    syncAllSliders();
    rebuild();
  });

  sceneRow.append(sceneLabel, sceneSelect);
  drawer.append(sceneRow);

  // --- Sections with sliders ---

  /** Build a single slider row and append to container. */
  function createSliderRow(container: HTMLElement, def: SliderDef): void {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '2px 12px',
    });

    const label = document.createElement('span');
    label.textContent = def.label;
    Object.assign(label.style, {
      width: '100px',
      flexShrink: '0',
      textOverflow: 'ellipsis',
      overflow: 'hidden',
    });

    const prec = stepPrecision(def.step);
    const valSpan = document.createElement('span');
    valSpan.textContent = readState(state, def.key).toFixed(prec);
    Object.assign(valSpan.style, {
      width: '52px',
      flexShrink: '0',
      textAlign: 'right',
      color: '#fff',
    });
    valueDisplays[def.key] = valSpan;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(readState(state, def.key));
    Object.assign(input.style, {
      flex: '1',
      minWidth: '0',
      accentColor: sliderColor(def.key),
    });
    sliderInputs[def.key] = input;

    input.addEventListener('input', () => {
      state[def.key] = Number(input.value);
      valSpan.textContent = Number(input.value).toFixed(prec);
      rebuild();
    });

    row.append(label, valSpan, input);
    container.append(row);
  }

  // Gain curve canvas and readout references (placed after gain curve section)
  let canvas: HTMLCanvasElement;
  let readout: HTMLDivElement;

  for (const section of SECTIONS) {
    const heading = document.createElement('div');
    heading.textContent = section.title;
    Object.assign(heading.style, {
      padding: '8px 12px 4px',
      color: '#999',
      fontSize: '12px',
      fontWeight: 'bold',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      borderTop: '1px solid #333',
    });
    drawer.append(heading);

    for (const def of section.sliders) {
      createSliderRow(drawer, def);
    }

    // After Gain Curve section, insert canvas and readout
    if (section.title === 'Gain Curve') {
      canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 140;
      Object.assign(canvas.style, {
        display: 'block',
        margin: '8px auto',
        background: '#000',
        border: '1px solid #333',
        borderRadius: '3px',
      });
      drawer.append(canvas);

      readout = document.createElement('div');
      Object.assign(readout.style, {
        padding: '4px 12px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
      });
      drawer.append(readout);
    }
  }

  // --- Bottom buttons ---

  const btnRow = document.createElement('div');
  Object.assign(btnRow.style, {
    display: 'flex',
    gap: '8px',
    padding: '12px',
    borderTop: '1px solid #333',
    position: 'sticky',
    bottom: '0',
    background: '#1a1a1a',
  });

  const btnStyle = {
    flex: '1',
    padding: '6px 8px',
    background: '#333',
    color: '#ccc',
    border: '1px solid #555',
    borderRadius: '3px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '11px',
  };

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  Object.assign(copyBtn.style, btnStyle);
  copyBtn.addEventListener('click', () => {
    const literal = buildVibeOptionsLiteral(state);
    navigator.clipboard.writeText(literal).then(
      () => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
      },
      () => {
        copyBtn.textContent = 'Failed';
        setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
      },
    );
  });

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset';
  Object.assign(resetBtn.style, btnStyle);
  resetBtn.addEventListener('click', () => {
    for (const section of SECTIONS) {
      for (const def of section.sliders) {
        state[def.key] = defaultForKey(def.key);
      }
    }
    syncAllSliders();
    rebuild();
  });

  btnRow.append(copyBtn, resetBtn);
  drawer.append(btnRow);

  document.body.append(drawer);

  // --- Helpers ---

  function sliderColor(key: string): string {
    if (key === 'exp:sine') return WAVEFORM_COLORS.sine;
    if (key === 'exp:pulse') return WAVEFORM_COLORS.pulse;
    if (key === 'exp:blend') return WAVEFORM_COLORS.blend;
    return '#888';
  }

  function syncAllSliders(): void {
    for (const section of SECTIONS) {
      for (const def of section.sliders) {
        const inp = sliderInputs[def.key];
        const disp = valueDisplays[def.key];
        if (inp && disp) {
          const val = readState(state, def.key);
          inp.value = String(val);
          disp.textContent = val.toFixed(stepPrecision(def.step));
        }
      }
    }
  }

  function rebuild(): void {
    const opts = stateToVibeOptions(state);
    const newVibe = new Vibe(opts);
    setVibe(newVibe);

    if (audio.isPlaying) {
      audio.update(store.data);
    }

    drawCurves(newVibe);
    updateReadout(newVibe);
  }

  function drawCurves(v: Vibe): void {
    const ctx = canvas.getContext('2d')!;
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    for (let i = 0.25; i < 1; i += 0.25) {
      ctx.beginPath();
      ctx.moveTo(i * w, 0);
      ctx.lineTo(i * w, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (1 - i) * h);
      ctx.lineTo(w, (1 - i) * h);
      ctx.stroke();
    }

    // Convergence line at size=0.5
    ctx.strokeStyle = '#444';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0.5 * w, 0);
    ctx.lineTo(0.5 * w, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw voiceGain curves
    const waveforms: WaveformType[] = ['sine', 'pulse', 'blend'];
    for (const wf of waveforms) {
      ctx.strokeStyle = WAVEFORM_COLORS[wf];
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let px = 0; px <= w; px++) {
        const size = px / w;
        const gain = v.voiceGain(wf, size);
        const y = h - (gain / v.GAIN_MAX) * h;
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }

    // Axis labels
    ctx.font = '10px monospace';
    ctx.fillStyle = '#666';
    ctx.fillText('size 0', 2, h - 2);
    ctx.fillText('1', w - 10, h - 2);
    ctx.fillText(v.GAIN_MAX.toFixed(1), 2, 12);
    ctx.fillText('0.5', 0.5 * w - 8, h - 2);

    // Legend
    let lx = w - 80;
    for (const wf of waveforms) {
      ctx.fillStyle = WAVEFORM_COLORS[wf];
      ctx.fillText(wf, lx, 12);
      lx += 28;
    }
  }

  function updateReadout(v: Vibe): void {
    const waveforms: WaveformType[] = ['sine', 'pulse', 'blend'];
    const sizes = [0.3, 0.5, 0.7, 0.95];

    while (readout.firstChild) readout.removeChild(readout.firstChild);

    const hdr = document.createElement('span');
    hdr.textContent = 'voiceGain @ size:';
    readout.append(hdr);

    for (const size of sizes) {
      const row = document.createElement('span');
      row.append(`${size}: `);
      for (const wf of waveforms) {
        const val = document.createElement('span');
        val.style.color = WAVEFORM_COLORS[wf];
        val.textContent = v.voiceGain(wf, size).toFixed(3);
        row.append(val, ' ');
      }
      readout.append(row);
    }
  }

  // Initial draw
  rebuild();
}

/** Build a Partial<VibeOptions> TypeScript literal with only non-default params. */
function buildVibeOptionsLiteral(state: Record<string, number>): string {
  const diffs: string[] = [];
  const expDiffs: string[] = [];
  const octDiffs: string[] = [];

  for (const section of SECTIONS) {
    for (const def of section.sliders) {
      const val = state[def.key]!;
      const def_val = defaultForKey(def.key);
      // Use a small epsilon for float comparison
      if (Math.abs(val - def_val) < 1e-9) continue;

      const formatted = formatNum(val, def.step);

      if (def.key.startsWith('exp:')) {
        expDiffs.push(`    ${def.key.slice(4)}: ${formatted}`);
      } else if (def.key.startsWith('oct:')) {
        octDiffs.push(`    '${def.key.slice(4)}': ${formatted}`);
      } else {
        diffs.push(`  ${def.key}: ${formatted}`);
      }
    }
  }

  if (expDiffs.length > 0) {
    diffs.push(`  exponents: {\n${expDiffs.join(',\n')},\n  }`);
  }
  if (octDiffs.length > 0) {
    diffs.push(`  octaveGainCoeffs: {\n${octDiffs.join(',\n')},\n  }`);
  }

  if (diffs.length === 0) return '{}';
  return `{\n${diffs.join(',\n')},\n}`;
}

/** Format a number with appropriate precision based on its step. */
function formatNum(val: number, step: number): string {
  const prec = stepPrecision(step);
  return val.toFixed(prec);
}
