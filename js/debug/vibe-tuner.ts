// Debug-only vibe tuner panel. Async-imported when ?debug=vibe is in URL.
// Elided entirely from production builds via __VIBE_DEBUG__ define.

import { Vibe, VIBE_DEFAULTS, setVibe } from '../audio/vibe.ts';
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
  value: () => number;
}

export function init(deps: TunerDeps): void {
  const { audio, store } = deps;

  const state = {
    norm: VIBE_DEFAULTS.norm,
    refMult: VIBE_DEFAULTS.refMult,
    sine: VIBE_DEFAULTS.exponents.sine,
    pulse: VIBE_DEFAULTS.exponents.pulse,
    blend: VIBE_DEFAULTS.exponents.blend,
  };

  // --- Build DOM ---

  const panel = document.createElement('div');
  panel.id = 'vibe-tuner';
  Object.assign(panel.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    zIndex: '99999',
    background: '#1a1a1a',
    color: '#ccc',
    fontFamily: 'monospace',
    fontSize: '11px',
    padding: '6px 10px',
    overflowX: 'auto',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    borderBottom: '2px solid #444',
    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
  });

  const sliders: SliderDef[] = [
    { key: 'norm', label: 'NORM', min: 0.05, max: 1.0, step: 0.01, value: () => state.norm },
    {
      key: 'refMult',
      label: 'refMult',
      min: 0.3,
      max: 2.5,
      step: 0.05,
      value: () => state.refMult,
    },
    { key: 'sine', label: 'exp:sine', min: 0.3, max: 3.0, step: 0.1, value: () => state.sine },
    { key: 'pulse', label: 'exp:pulse', min: 0.3, max: 3.0, step: 0.1, value: () => state.pulse },
    { key: 'blend', label: 'exp:blend', min: 0.3, max: 3.0, step: 0.1, value: () => state.blend },
  ];

  const valueDisplays: Record<string, HTMLSpanElement> = {};

  for (const def of sliders) {
    const group = document.createElement('div');
    Object.assign(group.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      flexShrink: '0',
    });

    const label = document.createElement('label');
    label.textContent = def.label;
    label.style.marginBottom = '2px';

    const valSpan = document.createElement('span');
    valSpan.textContent = def.value().toFixed(2);
    valSpan.style.color = '#fff';
    valSpan.style.marginBottom = '2px';
    valueDisplays[def.key] = valSpan;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(def.value());
    Object.assign(input.style, {
      width: '100px',
      accentColor:
        def.key === 'sine'
          ? WAVEFORM_COLORS.sine
          : def.key === 'pulse'
            ? WAVEFORM_COLORS.pulse
            : def.key === 'blend'
              ? WAVEFORM_COLORS.blend
              : '#888',
    });

    input.addEventListener('input', () => {
      (state as Record<string, number>)[def.key] = Number(input.value);
      valSpan.textContent = Number(input.value).toFixed(2);
      rebuild();
    });

    group.append(label, valSpan, input);
    panel.append(group);
  }

  // --- Curve canvas ---

  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 160;
  Object.assign(canvas.style, {
    flexShrink: '0',
    background: '#000',
    border: '1px solid #333',
    borderRadius: '3px',
  });
  panel.append(canvas);

  // --- Convergence readout ---

  const readout = document.createElement('div');
  Object.assign(readout.style, {
    flexShrink: '0',
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    minWidth: '120px',
  });
  panel.append(readout);

  // --- Reset button ---

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset';
  Object.assign(resetBtn.style, {
    flexShrink: '0',
    padding: '4px 8px',
    background: '#333',
    color: '#ccc',
    border: '1px solid #555',
    borderRadius: '3px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '11px',
    alignSelf: 'center',
  });
  resetBtn.addEventListener('click', () => {
    state.norm = VIBE_DEFAULTS.norm;
    state.refMult = VIBE_DEFAULTS.refMult;
    state.sine = VIBE_DEFAULTS.exponents.sine;
    state.pulse = VIBE_DEFAULTS.exponents.pulse;
    state.blend = VIBE_DEFAULTS.exponents.blend;

    const inputs = panel.querySelectorAll('input[type="range"]');
    for (let i = 0; i < sliders.length; i++) {
      const inp = inputs[i] as HTMLInputElement;
      const def = sliders[i]!;
      inp.value = String(def.value());
      valueDisplays[def.key]!.textContent = def.value().toFixed(2);
    }
    rebuild();
  });
  panel.append(resetBtn);

  document.body.prepend(panel);

  // --- Rebuild vibe and update audio ---

  function rebuild(): void {
    const newVibe = new Vibe({
      norm: state.norm,
      refMult: state.refMult,
      exponents: { sine: state.sine, pulse: state.pulse, blend: state.blend },
    });

    setVibe(newVibe);

    // Update playing audio if any
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

    // Clear and rebuild readout with safe DOM methods
    while (readout.firstChild) readout.removeChild(readout.firstChild);

    const header = document.createElement('span');
    header.textContent = 'voiceGain @ size:';
    readout.append(header);

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
