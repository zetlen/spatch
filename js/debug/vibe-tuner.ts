// Vibe tuner debug panel. Shipped in prod, activated via ?debug URL param.
//
// I'm sorry about this file. It's a hack throwaway panel for tuning audio
// parameters. It generates all its DOM via innerHTML templates and binds
// listeners after the fact. Don't clean it up — just add what you need and
// move on. It will be rewritten before v1.

/* oxlint-disable */

import { effect } from '@preact/signals-core';
import { createIconButton } from '../toolbar/dom-helpers.ts';
import { Vibe, VIBE_DEFAULTS, setVibe } from '../audio/vibe.ts';
import { SCENES } from '../scenes';
import type { VibeOptions } from '../audio/vibe.ts';
import type { AudioEngine } from '../audio/engine.ts';
import type { SigilStore } from '../state.ts';
import type { SigilData, WaveformType } from '../types.ts';
import { all } from '../voices/registry.ts';

interface TunerDeps {
  audio: AudioEngine;
  store: SigilStore;
}

const WAVEFORM_COLORS: Record<WaveformType, string> = {
  sine: '#4488ff',
  pulse: '#ff4444',
  blend: '#44cc44',
  astroid: '#ffaa22',
  stamp: '#22cc88',
};

interface SliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

type TabName = 'mastering' | 'voices';

const TAB_DEFS: { id: TabName; label: string }[] = [
  { id: 'mastering', label: 'Mastering' },
  { id: 'voices', label: 'Voices' },
];

interface SliderSection {
  title: string;
  tab: TabName;
  sliders: SliderDef[];
}

const SECTIONS: SliderSection[] = [
  {
    title: 'Gain Curve',
    tab: 'voices',
    sliders: [
      { key: 'norm', label: 'norm', min: 0.05, max: 1.0, step: 0.01 },
      { key: 'refMult', label: 'refMult', min: 0.3, max: 2.5, step: 0.05 },
      { key: 'exp:sine', label: 'exp:sine', min: 0.3, max: 3.0, step: 0.1 },
      { key: 'exp:pulse', label: 'exp:pulse', min: 0.3, max: 3.0, step: 0.1 },
      { key: 'exp:blend', label: 'exp:blend', min: 0.3, max: 3.0, step: 0.1 },
    ],
  },
  {
    title: 'Reverb',
    tab: 'mastering',
    sliders: [
      { key: 'reverbMix', label: 'reverbMix', min: 0.0, max: 1.0, step: 0.01 },
      { key: 'reverbPreDelay', label: 'reverbPreDelay', min: 0.0, max: 0.5, step: 0.01 },
    ],
  },
  {
    title: 'Compression',
    tab: 'mastering',
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
    tab: 'mastering',
    sliders: [
      { key: 'eqLowFreq', label: 'lo freq', min: 50, max: 500, step: 10 },
      { key: 'eqLowGain', label: 'lo gain', min: -12, max: 12, step: 0.5 },
      { key: 'eqMidFreq', label: 'mid freq', min: 200, max: 5000, step: 50 },
      { key: 'eqMidGain', label: 'mid gain', min: -12, max: 12, step: 0.5 },
      { key: 'eqMidQ', label: 'mid Q', min: 0.1, max: 10, step: 0.1 },
      { key: 'eqHighFreq', label: 'hi freq', min: 1000, max: 16000, step: 100 },
      { key: 'eqHighGain', label: 'hi gain', min: -12, max: 12, step: 0.5 },
    ],
  },
  {
    title: 'Synthesis',
    tab: 'voices',
    sliders: [
      { key: 'warmth', label: 'warmth', min: 0.5, max: 5.0, step: 0.1 },
      { key: 'formantMix', label: 'formantMix', min: 0.0, max: 1.0, step: 0.01 },
      { key: 'formantQ', label: 'formantQ', min: 0.1, max: 3.0, step: 0.1 },
      { key: 'brightnessQ', label: 'brightnessQ', min: 0.1, max: 3.0, step: 0.1 },
      { key: 'stereoWidth', label: 'stereoWidth', min: 0.0, max: 2.0, step: 0.05 },
    ],
  },
  {
    title: 'Master Effects',
    tab: 'voices',
    sliders: [
      { key: 'saturation', label: 'saturation', min: 0, max: 10, step: 0.1 },
      { key: 'excite', label: 'excite', min: 0.0, max: 1.0, step: 0.01 },
      { key: 'combMix', label: 'combMix', min: 0.0, max: 1.0, step: 0.01 },
      { key: 'combFreq', label: 'combFreq', min: 0.001, max: 0.05, step: 0.001 },
    ],
  },
  {
    title: 'Octave Gain',
    tab: 'voices',
    sliders: [
      { key: 'oct:up-1', label: 'up-1', min: 0, max: 3, step: 0.05 },
      { key: 'oct:up-2', label: 'up-2', min: 0, max: 3, step: 0.05 },
      { key: 'oct:down-1', label: 'down-1', min: 0, max: 3, step: 0.05 },
      { key: 'oct:down-2', label: 'down-2', min: 0, max: 3, step: 0.05 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function stepPrecision(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

function readState(state: Record<string, number>, key: string): number {
  return state[key]!;
}

function defaultForKey(key: string): number {
  if (key.startsWith('exp:')) {
    const wf = key.slice(4) as WaveformType;
    return all().find((e) => e.waveform === wf)?.player.gainExponent ?? 1;
  }
  if (key.startsWith('oct:')) return VIBE_DEFAULTS.octaveGainCoeffs[key.slice(4)]!;
  return (VIBE_DEFAULTS as unknown as Record<string, number>)[key]!;
}

function stateToVibeOptions(state: Record<string, number>, ir: string | undefined): VibeOptions {
  return {
    ir,
    norm: state['norm'],
    refMult: state['refMult'],
    exponents: { sine: state['exp:sine'], pulse: state['exp:pulse'], blend: state['exp:blend'] },
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
    saturation: state['saturation'],
    excite: state['excite'],
    combMix: state['combMix'],
    combFreq: state['combFreq'],
    octaveGainCoeffs: {
      'up-1': state['oct:up-1'],
      'up-2': state['oct:up-2'],
      'down-1': state['oct:down-1'],
      'down-2': state['oct:down-2'],
    },
  };
}

function createDefaultState(): Record<string, number> {
  const s: Record<string, number> = {};
  for (const section of SECTIONS) {
    for (const def of section.sliders) s[def.key] = defaultForKey(def.key);
  }
  return s;
}

function applyVibeToState(state: Record<string, number>, opts: Partial<VibeOptions>): void {
  const full = { ...VIBE_DEFAULTS, ...opts };
  const defaultExponents = Object.fromEntries(
    all().map((e) => [e.waveform, e.player.gainExponent]),
  );
  const exponents = { ...defaultExponents, ...opts.exponents } as Record<WaveformType, number>;
  const octave = { ...VIBE_DEFAULTS.octaveGainCoeffs, ...opts.octaveGainCoeffs };
  for (const section of SECTIONS) {
    for (const def of section.sliders) {
      if (def.key.startsWith('exp:')) state[def.key] = exponents[def.key.slice(4) as WaveformType];
      else if (def.key.startsWith('oct:')) state[def.key] = octave[def.key.slice(4)]!;
      else state[def.key] = (full as unknown as Record<string, number>)[def.key]!;
    }
  }
}

function formatState(data: SigilData): string {
  const lines: string[] = [];
  lines.push(`scene: ${data.scene}`);
  const e = data.envelope;
  lines.push(
    `envelope: A:${e.attack.toFixed(2)} D:${e.decay.toFixed(2)} S:${e.sustain.toFixed(2)} R:${e.release.toFixed(2)}`,
  );
  lines.push(`\nvoices (${data.voices.length}):`);
  for (const v of data.voices) {
    const timbre = 'timbre' in v ? ` timbre:${v.timbre.toFixed(2)}` : '';
    let fill: string;
    if (v.fill.mode === 'solid') fill = `solid h:${v.fill.h} s:${v.fill.s} l:${v.fill.l}`;
    else
      fill = `linear h:${v.fill.h}\u2192${v.fill.h2} s:${v.fill.s}\u2192${v.fill.s2} l:${v.fill.l}\u2192${v.fill.l2}`;
    const border = v.border
      ? `${v.border.color}${v.border.double ? '\u00d72' : ''} t:${v.border.thickness.toFixed(2)}`
      : '\u2014';
    lines.push(`  ${v.id} [${v.waveform}]`);
    lines.push(`    pos:(${v.x.toFixed(2)}, ${v.y.toFixed(2)}) sz:${v.size.toFixed(2)}`);
    lines.push(`    fill:${fill}`);
    lines.push(`    fx:${v.effect ?? '\u2014'}${timbre}`);
    lines.push(`    border:${border}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'spatch:vibe-edit:';

function saveSceneEdits(sceneName: string, flatState: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + sceneName, JSON.stringify(flatState));
  } catch {}
}

function loadSceneEdits(sceneName: string): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + sceneName);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return null;
  }
}

function clearSceneEdits(sceneName: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + sceneName);
  } catch {}
}

function isEdited(flatState: Record<string, number>, sceneVibe: Partial<VibeOptions>): boolean {
  const reference: Record<string, number> = {};
  const full = { ...VIBE_DEFAULTS, ...sceneVibe };
  const defaultExponents = Object.fromEntries(
    all().map((e) => [e.waveform, e.player.gainExponent]),
  );
  const exponents = { ...defaultExponents, ...sceneVibe.exponents } as Record<WaveformType, number>;
  const octave = { ...VIBE_DEFAULTS.octaveGainCoeffs, ...sceneVibe.octaveGainCoeffs };
  for (const section of SECTIONS) {
    for (const def of section.sliders) {
      if (def.key.startsWith('exp:'))
        reference[def.key] = exponents[def.key.slice(4) as WaveformType];
      else if (def.key.startsWith('oct:')) reference[def.key] = octave[def.key.slice(4)]!;
      else reference[def.key] = (full as unknown as Record<string, number>)[def.key]!;
    }
  }
  for (const key of Object.keys(reference)) {
    if (Math.abs((flatState[key] ?? 0) - (reference[key] ?? 0)) > 1e-9) return true;
  }
  return false;
}

function buildVibeJSON(flatState: Record<string, number>): string {
  const obj: Record<string, unknown> = {};
  const expObj: Record<string, number> = {};
  const octObj: Record<string, number> = {};
  for (const section of SECTIONS) {
    for (const def of section.sliders) {
      const val = flatState[def.key]!;
      const defVal = defaultForKey(def.key);
      if (Math.abs(val - defVal) < 1e-9) continue;
      if (def.key.startsWith('exp:')) expObj[def.key.slice(4)] = val;
      else if (def.key.startsWith('oct:')) octObj[def.key.slice(4)] = val;
      else obj[def.key] = val;
    }
  }
  if (Object.keys(expObj).length > 0) obj['exponents'] = expObj;
  if (Object.keys(octObj).length > 0) obj['octaveGainCoeffs'] = octObj;
  return JSON.stringify(obj, null, 2);
}

// ---------------------------------------------------------------------------
// HTML templates
// ---------------------------------------------------------------------------

const PANEL_CSS = `
.vt-panel {
  flex: 0 0 420px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  color: #ccc;
  font-family: monospace;
  font-size: 11px;
  overflow-x: hidden;
  border-left: 2px solid #444;
  box-sizing: border-box;
}
.vt-header {
  display: flex;
  align-items: center;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}
.vt-tab-btn {
  flex: 1;
  padding: 10px 8px;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  color: #666;
  font-family: monospace;
  font-size: 12px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 1px;
  cursor: pointer;
}
.vt-tab-btn.active {
  border-bottom-color: #fff;
  color: #fff;
  background: #252525;
}
.vt-close {
  background: none;
  border: none;
  color: #888;
  font-size: 20px;
  cursor: pointer;
  padding: 0 8px;
  line-height: 1;
  flex-shrink: 0;
}
.vt-scene-row {
  padding: 8px 12px;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}
.vt-scene-row label { color: #aaa; }
.vt-scene-row select {
  background: #333;
  color: #fff;
  border: 1px solid #555;
  border-radius: 3px;
  font-family: monospace;
  font-size: 11px;
  padding: 2px 4px;
  margin-left: 6px;
}
.vt-dirty {
  color: #f80;
  font-size: 14px;
  margin-left: 6px;
}
.vt-scroll { flex: 1; overflow-y: auto; min-height: 0; }
.vt-pane { display: none; }
.vt-pane.active { display: block; }
.vt-section-heading {
  padding: 8px 12px 4px;
  color: #999;
  font-size: 12px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-top: 1px solid #333;
}
.vt-slider-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 12px;
}
.vt-slider-label {
  width: 100px;
  flex-shrink: 0;
  text-overflow: ellipsis;
  overflow: hidden;
}
.vt-slider-val {
  width: 52px;
  flex-shrink: 0;
  text-align: right;
  color: #fff;
}
.vt-slider-input {
  flex: 1;
  min-width: 0;
}
.vt-canvas {
  display: block;
  margin: 8px auto;
  background: #000;
  border: 1px solid #333;
  border-radius: 3px;
}
.vt-readout {
  padding: 4px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.vt-bottom {
  flex-shrink: 0;
  max-height: 50%;
  overflow-y: auto;
  border-top: 2px solid #444;
  display: flex;
  flex-direction: column;
}
.vt-engine-pre {
  padding: 0 12px 4px;
  font-family: monospace;
  font-size: 10px;
  color: #bbb;
  white-space: pre;
  line-height: 1.4;
  margin: 0;
}
.vt-level-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 8px;
}
.vt-level-row .vt-label { color: #888; }
.vt-level-bar {
  flex: 1;
  height: 8px;
  background: #333;
  border-radius: 2px;
  overflow: hidden;
}
.vt-level-fill {
  height: 100%;
  width: 0%;
  background: #4a4;
  border-radius: 2px;
}
.vt-level-val { color: #fff; width: 40px; text-align: right; }
.vt-state-details { border-top: 1px solid #333; }
.vt-state-summary {
  padding: 8px 12px;
  color: #999;
  font-size: 12px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
  user-select: none;
}
.vt-state-pre {
  padding: 0 12px 8px;
  font-family: monospace;
  font-size: 10px;
  color: #bbb;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.4;
  margin: 0;
}
.vt-btn-row {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid #333;
}
.vt-btn {
  flex: 1;
  padding: 6px 8px;
  background: #333;
  color: #ccc;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
  font-family: monospace;
  font-size: 11px;
}
@media (max-width: 600px) {
  .vt-panel {
    position: fixed;
    inset: 0;
    height: 100dvh;
    border-left: none;
    z-index: 9999;
  }
  .vt-close {
    font-size: 28px;
    padding: 0 12px;
  }
  .vt-canvas {
    max-width: calc(100% - 24px);
  }
  .vt-bottom {
    max-height: 30%;
  }
  .vt-slider-label {
    width: 72px;
  }
}
@keyframes vt-wiggle {
  0%   { transform: scale(1) rotate(0); }
  6%   { transform: scale(1.3) rotate(-12deg); }
  12%  { transform: scale(1.3) rotate(10deg); }
  18%  { transform: scale(1.3) rotate(-10deg); }
  24%  { transform: scale(1.3) rotate(9deg); }
  30%  { transform: scale(1.28) rotate(-8deg); }
  36%  { transform: scale(1.25) rotate(7deg); }
  42%  { transform: scale(1.22) rotate(-6deg); }
  48%  { transform: scale(1.18) rotate(5deg); }
  54%  { transform: scale(1.15) rotate(-4deg); }
  60%  { transform: scale(1.1) rotate(3deg); }
  70%  { transform: scale(1.05) rotate(-2deg); }
  80%  { transform: scale(1.02) rotate(1deg); }
  100% { transform: scale(1) rotate(0); }
}
`;

function sliderAccentColor(key: string): string {
  if (key === 'exp:sine') return WAVEFORM_COLORS.sine;
  if (key === 'exp:pulse') return WAVEFORM_COLORS.pulse;
  if (key === 'exp:blend') return WAVEFORM_COLORS.blend;
  return '#888';
}

function renderSlider(def: SliderDef, value: number): string {
  const prec = stepPrecision(def.step);
  return `<div class="vt-slider-row">
    <span class="vt-slider-label">${def.label}</span>
    <span class="vt-slider-val" data-vt-val="${def.key}">${value.toFixed(prec)}</span>
    <input class="vt-slider-input" type="range"
      data-vt-key="${def.key}"
      min="${def.min}" max="${def.max}" step="${def.step}" value="${value}"
      style="accent-color:${sliderAccentColor(def.key)}">
  </div>`;
}

function renderSection(
  section: SliderSection,
  state: Record<string, number>,
  extra?: string,
): string {
  const sliders = section.sliders.map((d) => renderSlider(d, readState(state, d.key))).join('');
  return `<div class="vt-section-heading">${section.title}</div>${sliders}${extra ?? ''}`;
}

function renderSceneOptions(currentScene: number): string {
  return SCENES.map((s, i) => {
    const hasEdits = loadSceneEdits(s.name) !== null;
    const label = hasEdits ? `${s.name} *` : s.name;
    const selected = i === currentScene ? ' selected' : '';
    return `<option value="${i}"${selected}>${label}</option>`;
  }).join('');
}

function buildPanelHTML(
  state: Record<string, number>,
  currentScene: number,
  dirtyVisible: boolean,
): string {
  const masteringSections = SECTIONS.filter((s) => s.tab === 'mastering');
  const voicesSections = SECTIONS.filter((s) => s.tab === 'voices');

  const gainCurveExtra = `
    <canvas class="vt-canvas" width="380" height="140"></canvas>
    <div class="vt-readout" data-vt-readout></div>`;

  const masteringHTML = masteringSections.map((s) => renderSection(s, state)).join('');
  const voicesHTML = voicesSections
    .map((s) => renderSection(s, state, s.title === 'Gain Curve' ? gainCurveExtra : undefined))
    .join('');

  return `<style>${PANEL_CSS}</style>
<div class="vt-header">
  ${TAB_DEFS.map((t) => `<button class="vt-tab-btn${t.id === 'mastering' ? ' active' : ''}" data-vt-tab="${t.id}">${t.label}</button>`).join('')}
  <button class="vt-close">\u00d7</button>
</div>
<div class="vt-scene-row">
  <label>Scene: <select data-vt-scene>${renderSceneOptions(currentScene)}</select></label>
  <span class="vt-dirty" style="visibility:${dirtyVisible ? 'visible' : 'hidden'}">\u25cf</span>
</div>
<div class="vt-scroll">
  <div class="vt-pane active" data-vt-pane="mastering">${masteringHTML}</div>
  <div class="vt-pane" data-vt-pane="voices">${voicesHTML}</div>
</div>
<div class="vt-bottom">
  <div class="vt-section-heading">Engine</div>
  <pre class="vt-engine-pre" data-vt-engine></pre>
  <div class="vt-level-row">
    <span class="vt-label">level</span>
    <div class="vt-level-bar"><div class="vt-level-fill" data-vt-level-fill></div></div>
    <span class="vt-level-val" data-vt-level-val>0.000</span>
  </div>
  <details class="vt-state-details">
    <summary class="vt-state-summary">State</summary>
    <pre class="vt-state-pre" data-vt-state></pre>
  </details>
  <div class="vt-btn-row">
    <button class="vt-btn" data-vt-copy>Copy JSON</button>
    <button class="vt-btn" data-vt-reset>Reset</button>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function init(deps: TunerDeps): void {
  const { audio, store } = deps;

  const state = createDefaultState();
  const currentScene = SCENES[store.data.scene % SCENES.length];
  if (currentScene) applyVibeToState(state, currentScene.vibe);
  let currentSceneName = currentScene?.name ?? '';
  const savedEdits = loadSceneEdits(currentSceneName);
  if (savedEdits) Object.assign(state, savedEdits);
  let currentIR: string | undefined = currentScene?.vibe.ir;

  let rafId = 0;
  const app = document.getElementById('app')!;

  // --- Build panel DOM ---

  const panel = document.createElement('div');
  panel.id = 'vibe-tuner';
  panel.className = 'vt-panel';

  const dirty = isEdited(state, currentScene?.vibe ?? {});
  // All template data is hardcoded constants (SECTIONS, SCENES, state) — no user input.
  // eslint-disable-next-line no-unsanitized/property
  panel.innerHTML = buildPanelHTML(state, store.data.scene, dirty);

  // --- Query elements ---

  const q = <T extends Element>(sel: string) => panel.querySelector<T>(sel)!;
  const qa = <T extends Element>(sel: string) => panel.querySelectorAll<T>(sel);

  const tabBtns = qa<HTMLButtonElement>('.vt-tab-btn');
  const tabPanes = qa<HTMLDivElement>('.vt-pane');
  const closeBtn = q<HTMLButtonElement>('.vt-close');
  const sceneSelect = q<HTMLSelectElement>('[data-vt-scene]');
  const dirtyDot = q<HTMLSpanElement>('.vt-dirty');
  const canvas = q<HTMLCanvasElement>('.vt-canvas');
  const readout = q<HTMLDivElement>('[data-vt-readout]');
  const enginePre = q<HTMLPreElement>('[data-vt-engine]');
  const levelFill = q<HTMLDivElement>('[data-vt-level-fill]');
  const levelVal = q<HTMLSpanElement>('[data-vt-level-val]');
  const statePre = q<HTMLPreElement>('[data-vt-state]');
  const copyJsonBtn = q<HTMLButtonElement>('[data-vt-copy]');
  const resetBtn = q<HTMLButtonElement>('[data-vt-reset]');

  // Build maps of slider inputs and value displays by key
  const sliderInputs: Record<string, HTMLInputElement> = {};
  const valueDisplays: Record<string, HTMLSpanElement> = {};
  for (const input of qa<HTMLInputElement>('.vt-slider-input')) {
    const key = input.dataset['vtKey']!;
    sliderInputs[key] = input;
  }
  for (const span of qa<HTMLSpanElement>('.vt-slider-val')) {
    const key = span.dataset['vtVal']!;
    valueDisplays[key] = span;
  }

  // --- Tab switching ---

  function switchTab(active: TabName): void {
    for (const btn of tabBtns) {
      btn.classList.toggle('active', btn.dataset['vtTab'] === active);
    }
    for (const pane of tabPanes) {
      pane.classList.toggle('active', pane.dataset['vtPane'] === active);
    }
  }

  for (const btn of tabBtns) {
    btn.addEventListener('click', () => switchTab(btn.dataset['vtTab'] as TabName));
  }

  // --- Close button ---

  closeBtn.addEventListener('click', () => hide());

  // --- Dirty state helpers ---

  function updateDirtyState(): void {
    const sceneDef = SCENES[store.data.scene % SCENES.length];
    const isDirty = isEdited(state, sceneDef?.vibe ?? {});
    dirtyDot.style.visibility = isDirty ? 'visible' : 'hidden';
    const opt = sceneSelect.options[sceneSelect.selectedIndex];
    if (opt && sceneDef) opt.textContent = isDirty ? `${sceneDef.name} *` : sceneDef.name;
  }

  // --- Slider input handlers ---

  for (const input of qa<HTMLInputElement>('.vt-slider-input')) {
    const key = input.dataset['vtKey']!;
    const def = SECTIONS.flatMap((s) => s.sliders).find((d) => d.key === key)!;
    const prec = stepPrecision(def.step);
    input.addEventListener('input', () => {
      state[key] = Number(input.value);
      valueDisplays[key]!.textContent = Number(input.value).toFixed(prec);
      rebuild();
      saveSceneEdits(currentSceneName, state);
      updateDirtyState();
    });
  }

  // --- Scene selector ---

  function loadScene(idx: number): void {
    const sceneDef = SCENES[idx % SCENES.length];
    currentSceneName = sceneDef?.name ?? '';
    applyVibeToState(state, sceneDef?.vibe ?? {});
    currentIR = sceneDef?.vibe.ir;
    const saved = loadSceneEdits(currentSceneName);
    if (saved) Object.assign(state, saved);
    syncAllSliders();
    rebuild();
    updateDirtyState();
  }

  sceneSelect.addEventListener('change', () => {
    const idx = Number(sceneSelect.value);
    store.updateScene(idx);
    loadScene(idx);
  });

  // --- Buttons ---

  copyJsonBtn.addEventListener('click', () => {
    const json = buildVibeJSON(state);
    navigator.clipboard.writeText(json).then(
      () => {
        copyJsonBtn.textContent = 'Copied!';
        setTimeout(() => (copyJsonBtn.textContent = 'Copy JSON'), 1500);
      },
      () => {
        copyJsonBtn.textContent = 'Failed';
        setTimeout(() => (copyJsonBtn.textContent = 'Copy JSON'), 1500);
      },
    );
  });

  resetBtn.addEventListener('click', () => {
    const sceneDef = SCENES[store.data.scene % SCENES.length];
    applyVibeToState(state, sceneDef?.vibe ?? {});
    clearSceneEdits(currentSceneName);
    syncAllSliders();
    rebuild();
    updateDirtyState();
  });

  // --- Helpers ---

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
    const opts = stateToVibeOptions(state, currentIR);
    const newVibe = new Vibe(opts);
    setVibe(newVibe);
    drawCurves(newVibe);
    updateReadout(newVibe);
  }

  function drawCurves(v: Vibe): void {
    const ctx = canvas.getContext('2d')!;
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);

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

    ctx.strokeStyle = '#444';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0.5 * w, 0);
    ctx.lineTo(0.5 * w, h);
    ctx.stroke();
    ctx.setLineDash([]);

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

    ctx.font = '10px monospace';
    ctx.fillStyle = '#666';
    ctx.fillText('size 0', 2, h - 2);
    ctx.fillText('1', w - 10, h - 2);
    ctx.fillText(v.GAIN_MAX.toFixed(1), 2, 12);
    ctx.fillText('0.5', 0.5 * w - 8, h - 2);

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
    let html = '<span>voiceGain @ size:</span>';
    for (const size of sizes) {
      html += `<span>${size}: `;
      for (const wf of waveforms) {
        html += `<span style="color:${WAVEFORM_COLORS[wf]}">${v.voiceGain(wf, size).toFixed(3)}</span> `;
      }
      html += '</span>';
    }
    readout.innerHTML = html;
  }

  // --- Toolbar toggle button ---
  // Icon reference for sprite scanner: #tabler-adjustments-cog

  const tunerBtn = createIconButton({
    className: 'stage-btn',
    symbol: 'tabler-adjustments-cog',
    title: 'Vibe tuner',
  });
  tunerBtn.style.top = '60px';
  tunerBtn.style.right = '8px';
  tunerBtn.style.opacity = '0.7';
  tunerBtn.style.pointerEvents = 'auto';
  const splashBtn = document.getElementById('btn-splash')!;
  splashBtn.parentElement!.insertBefore(tunerBtn, splashBtn.nextSibling);

  document.body.append(panel);
  panel.style.display = 'none';

  // Entrance wiggle — the <style> with keyframes is now in the DOM via panel
  tunerBtn.style.animation = 'vt-wiggle 2s ease-out';
  tunerBtn.addEventListener('animationend', () => (tunerBtn.style.animation = ''), { once: true });

  function show(): void {
    document.body.style.display = 'flex';
    app.style.flex = '1';
    app.style.minWidth = '0';
    panel.style.display = '';
    tunerBtn.classList.add('active');
    rafId = requestAnimationFrame(updateEngine);
  }

  function hide(): void {
    cancelAnimationFrame(rafId);
    panel.style.display = 'none';
    document.body.style.display = '';
    app.style.flex = '';
    app.style.minWidth = '';
    tunerBtn.classList.remove('active');
  }

  tunerBtn.addEventListener('click', () => {
    if (panel.style.display === 'none') show();
    else hide();
  });

  // --- Initial draw ---

  rebuild();

  // --- Reactive state inspector + scene sync ---

  {
    let prevScene = store.data.scene;
    effect(() => {
      const data = store.data;
      statePre.textContent = formatState(data);
      const sceneIdx = data.scene;
      sceneSelect.value = String(sceneIdx);
      if (sceneIdx !== prevScene) {
        prevScene = sceneIdx;
        loadScene(sceneIdx);
      }
    });
  }

  // --- Engine state + level meter (rAF loop) ---

  function updateEngine(): void {
    enginePre.textContent = `status: ${audio.isPlaying ? 'playing' : 'stopped'}\nvoices: ${audio.activeVoices.length}`;
    const level = audio.getLevel();
    const pct = Math.min(100, level * 200);
    levelFill.style.width = `${pct}%`;
    levelFill.style.background = pct > 80 ? '#c44' : pct > 50 ? '#ca4' : '#4a4';
    levelVal.textContent = level.toFixed(3);
    rafId = requestAnimationFrame(updateEngine);
  }
}
