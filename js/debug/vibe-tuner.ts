// Vibe tuner debug panel. Shipped in prod, activated via ?debug URL param.
//
// Reverb-only controls — reverbMix and reverbPreDelay per scene.
// All other mastering parameters are now fixed constants in Master.ts.

/* oxlint-disable */

import { effect } from '@preact/signals-core';
import { createIconButton } from '../toolbar/dom-helpers.ts';
import type { ReverbConfig } from '../audio/master-types.ts';
import { SCENES } from '../scenes';
import type { AudioEngine } from '../audio/engine.ts';
import type { SigilStore } from '../state.ts';
import type { SigilData } from '../types.ts';

interface TunerDeps {
  audio: AudioEngine;
  store: SigilStore;
}

interface SliderDef {
  key: keyof ReverbConfig;
  label: string;
  min: number;
  max: number;
  step: number;
}

const REVERB_SLIDERS: SliderDef[] = [
  { key: 'reverbMix', label: 'reverbMix', min: 0.0, max: 1.0, step: 0.01 },
  { key: 'reverbPreDelay', label: 'reverbPreDelay', min: 0.0, max: 0.5, step: 0.01 },
];

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function stepPrecision(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
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
    if (v.fill.mode === 'solid') fill = `solid h:${v.fill.h} c:${v.fill.c} l:${v.fill.l}`;
    else
      fill = `linear h:${v.fill.h}\u2192${v.fill.h2} c:${v.fill.c}\u2192${v.fill.c2} l:${v.fill.l}\u2192${v.fill.l2}`;
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

const STORAGE_PREFIX = 'spatch:reverb-edit:';

interface ReverbEdits {
  reverbMix?: number;
  reverbPreDelay?: number;
}

function saveReverbEdits(sceneName: string, edits: ReverbEdits): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + sceneName, JSON.stringify(edits));
  } catch {}
}

function loadReverbEdits(sceneName: string): ReverbEdits | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + sceneName);
    if (!raw) return null;
    return JSON.parse(raw) as ReverbEdits;
  } catch {
    return null;
  }
}

function clearReverbEdits(sceneName: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + sceneName);
  } catch {}
}

function isEdited(edits: ReverbEdits, sceneReverb: ReverbConfig): boolean {
  if (edits.reverbMix !== undefined && Math.abs(edits.reverbMix - sceneReverb.reverbMix) > 1e-9)
    return true;
  const scenePreDelay = sceneReverb.reverbPreDelay ?? 0;
  if (edits.reverbPreDelay !== undefined && Math.abs(edits.reverbPreDelay - scenePreDelay) > 1e-9)
    return true;
  return false;
}

function buildReverbJSON(edits: ReverbEdits): string {
  return JSON.stringify(edits, null, 2);
}

// ---------------------------------------------------------------------------
// HTML templates
// ---------------------------------------------------------------------------

const PANEL_CSS = `
.vt-panel {
  flex: 0 0 320px;
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
  padding: 10px 12px;
}
.vt-title {
  flex: 1;
  font-size: 12px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #fff;
}
.vt-close {
  background: none;
  border: none;
  color: #888;
  font-size: 20px;
  cursor: pointer;
  padding: 0 0 0 8px;
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

function renderSlider(def: SliderDef, value: number): string {
  const prec = stepPrecision(def.step);
  return `<div class="vt-slider-row">
    <span class="vt-slider-label">${def.label}</span>
    <span class="vt-slider-val" data-vt-val="${def.key}">${value.toFixed(prec)}</span>
    <input class="vt-slider-input" type="range"
      data-vt-key="${def.key}"
      min="${def.min}" max="${def.max}" step="${def.step}" value="${value}"
      style="accent-color:#888">
  </div>`;
}

function renderSceneOptions(currentScene: number): string {
  return SCENES.map((s, i) => {
    const hasEdits = loadReverbEdits(s.name) !== null;
    const label = hasEdits ? `${s.name} *` : s.name;
    const selected = i === currentScene ? ' selected' : '';
    return `<option value="${i}"${selected}>${label}</option>`;
  }).join('');
}

function buildPanelHTML(
  edits: ReverbEdits,
  sceneReverb: ReverbConfig,
  currentScene: number,
  dirtyVisible: boolean,
): string {
  const reverbMix = edits.reverbMix ?? sceneReverb.reverbMix;
  const reverbPreDelay = edits.reverbPreDelay ?? sceneReverb.reverbPreDelay ?? 0;
  const values: Record<string, number> = { reverbMix, reverbPreDelay };
  const slidersHTML = REVERB_SLIDERS.map((d) => renderSlider(d, values[d.key]!)).join('');

  return `<style>${PANEL_CSS}</style>
<div class="vt-header">
  <span class="vt-title">Reverb Tuner</span>
  <button class="vt-close">\u00d7</button>
</div>
<div class="vt-scene-row">
  <label>Scene: <select data-vt-scene>${renderSceneOptions(currentScene)}</select></label>
  <span class="vt-dirty" style="visibility:${dirtyVisible ? 'visible' : 'hidden'}">\u25cf</span>
</div>
<div class="vt-scroll">
  <div class="vt-section-heading">Reverb</div>
  ${slidersHTML}
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

  const currentSceneDef = SCENES[store.data.scene % SCENES.length];
  let currentSceneName = currentSceneDef?.name ?? '';
  let sceneReverb: ReverbConfig = currentSceneDef?.reverb ?? { ir: '', reverbMix: 0 };
  let edits: ReverbEdits = loadReverbEdits(currentSceneName) ?? {};

  let rafId = 0;
  const app = document.getElementById('app')!;

  // --- Build panel DOM ---

  const panel = document.createElement('div');
  panel.id = 'vibe-tuner';
  panel.className = 'vt-panel';

  const dirty = isEdited(edits, sceneReverb);
  // All template data is hardcoded constants (SCENES, edits) — no user input.
  // eslint-disable-next-line no-unsanitized/property
  panel.innerHTML = buildPanelHTML(edits, sceneReverb, store.data.scene, dirty);

  // --- Query elements ---

  const q = <T extends Element>(sel: string) => panel.querySelector<T>(sel)!;
  const qa = <T extends Element>(sel: string) => panel.querySelectorAll<T>(sel);

  const closeBtn = q<HTMLButtonElement>('.vt-close');
  const sceneSelect = q<HTMLSelectElement>('[data-vt-scene]');
  const dirtyDot = q<HTMLSpanElement>('.vt-dirty');
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

  // --- Close button ---

  closeBtn.addEventListener('click', () => hide());

  // --- Dirty state helpers ---

  function updateDirtyState(): void {
    const isDirty = isEdited(edits, sceneReverb);
    dirtyDot.style.visibility = isDirty ? 'visible' : 'hidden';
    const opt = sceneSelect.options[sceneSelect.selectedIndex];
    if (opt) opt.textContent = isDirty ? `${currentSceneName} *` : currentSceneName;
  }

  // --- Apply reverb to engine ---

  function applyReverb(): void {
    if (!audio.audioCtx) return;
    const reverb: ReverbConfig = {
      ir: sceneReverb.ir,
      reverbMix: edits.reverbMix ?? sceneReverb.reverbMix,
      reverbPreDelay: edits.reverbPreDelay ?? sceneReverb.reverbPreDelay ?? 0,
    };
    audio.master.syncReverb(audio.audioCtx, reverb);
  }

  // --- Slider input handlers ---

  for (const input of qa<HTMLInputElement>('.vt-slider-input')) {
    const key = input.dataset['vtKey'] as keyof ReverbConfig;
    const def = REVERB_SLIDERS.find((d) => d.key === key)!;
    const prec = stepPrecision(def.step);
    input.addEventListener('input', () => {
      (edits as Record<string, number>)[key] = Number(input.value);
      valueDisplays[key]!.textContent = Number(input.value).toFixed(prec);
      applyReverb();
      saveReverbEdits(currentSceneName, edits);
      updateDirtyState();
    });
  }

  // --- Scene selector ---

  function syncSliders(): void {
    const reverbMix = edits.reverbMix ?? sceneReverb.reverbMix;
    const reverbPreDelay = edits.reverbPreDelay ?? sceneReverb.reverbPreDelay ?? 0;
    const values: Record<string, number> = { reverbMix, reverbPreDelay };
    for (const def of REVERB_SLIDERS) {
      const inp = sliderInputs[def.key];
      const disp = valueDisplays[def.key];
      if (inp && disp) {
        const val = values[def.key]!;
        inp.value = String(val);
        disp.textContent = val.toFixed(stepPrecision(def.step));
      }
    }
  }

  function loadScene(idx: number): void {
    const sceneDef = SCENES[idx % SCENES.length];
    currentSceneName = sceneDef?.name ?? '';
    sceneReverb = sceneDef?.reverb ?? { ir: '', reverbMix: 0 };
    edits = loadReverbEdits(currentSceneName) ?? {};
    syncSliders();
    applyReverb();
    updateDirtyState();
  }

  sceneSelect.addEventListener('change', () => {
    const idx = Number(sceneSelect.value);
    store.updateScene(idx);
    loadScene(idx);
  });

  // --- Buttons ---

  copyJsonBtn.addEventListener('click', () => {
    const json = buildReverbJSON(edits);
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
    clearReverbEdits(currentSceneName);
    edits = {};
    syncSliders();
    applyReverb();
    updateDirtyState();
  });

  // --- Toolbar toggle button ---
  // Icon reference for sprite scanner: #tabler-adjustments-cog

  const tunerBtn = createIconButton({
    className: 'stage-btn',
    symbol: 'tabler-adjustments-cog',
    title: 'Reverb tuner',
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
    const level = audio.master.getLevel();
    const pct = Math.min(100, level * 200);
    levelFill.style.width = `${pct}%`;
    levelFill.style.background = pct > 80 ? '#c44' : pct > 50 ? '#ca4' : '#4a4';
    levelVal.textContent = level.toFixed(3);
    rafId = requestAnimationFrame(updateEngine);
  }
}
