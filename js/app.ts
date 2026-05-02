// App.ts — Entry point, event wiring, render loop

import { effect } from '@preact/signals-core';
import { SigilStore, UndoManager, SelectionManager } from './state.ts';
import { render } from './canvas/render.ts';
import { Toolbar } from './toolbar/toolbar.ts';
import { AudioEngine } from './audio/engine.ts';
import { createSampleLoader, setSampleLoader } from './audio/sample-loader.ts';
import { updateCanvasBorderRadius } from './shapes.ts';
import { loadFromURL, pathToState, resetDirty, saveToURL } from './serialize.ts';
import { applyScene, getScene, initStageLayers, randomSceneIndex, SCENES } from './scenes';
import { prefetchScene, loadSceneIR } from './scenes/loader';
import {
  prefetchStampSamples,
  initStampSymbols,
  decodeStampSamples,
} from './voices/stamp/lifecycle.ts';
import { qel } from './dom.ts';
import { PlaybackController } from './playback.ts';
import { CanvasInteractionController } from './canvas/interaction.ts';
import { bindKeyboardShortcuts } from './keyboard.ts';
import { SplashController } from './splash.ts';
import { initCredits } from './credits.ts';
import { initShare } from './share.ts';
import { randomize, harmonize } from './harmony.ts';
import { createHarmonizePanel } from './toolbar/harmonize-panel.ts';
import { createStagePanel } from './toolbar/stage-panel.ts';
import { createBlendPanel } from './toolbar/blend-panel.ts';
import { bindLongPress } from './toolbar/expansion-panel.ts';
import { BLEND_MODES } from './types.ts';
import { all } from './voices/registry.ts';

// ---- Init ----

const svgCanvas = qel<SVGSVGElement>('#sigil-canvas');
const tile = qel('#tile');

const store = new SigilStore();
const undo = new UndoManager(store);
const toolbar = new Toolbar(store, undo);
setSampleLoader(createSampleLoader(fetch.bind(globalThis)));
const audio = new AudioEngine();

// Expose store and audio engine for integration tests (e.g. setting ADSR
// Envelope directly, scheduling parameter automation on active voices).
// Only available when __audioCapture is present (test helper injected).
if ('__audioCapture' in globalThis) {
  (globalThis as Record<string, unknown>).__testStore = store;
  (globalThis as Record<string, unknown>).__testAudio = audio;
}

const stampSamplesReady = prefetchStampSamples();
initStampSymbols(svgCanvas);

// Pre-warm AudioContext on first user gesture. iOS Safari only allows audio
// From touchend, click, doubleclick, or keydown — NOT pointerdown/mousedown.
{
  const warmUpEvents = ['touchend', 'click', 'keydown'] as const;
  function onFirstGesture(): void {
    audio.warmUp();
    if (audio.audioCtx) {
      decodeStampSamples(audio.audioCtx);
    }
    for (const evt of warmUpEvents) {
      document.removeEventListener(evt, onFirstGesture);
    }
  }
  for (const evt of warmUpEvents) {
    document.addEventListener(evt, onFirstGesture);
  }
}

// ---- Selection state (app-level, not in store) ----

const selection = new SelectionManager(store);

let needsRender = true;

// ---- Solo state ----

let soloActive = false;
const soloBtn = qel<HTMLButtonElement>('#btn-solo');

function toggleSolo(): void {
  soloActive = !soloActive;
  soloBtn.classList.toggle('solo-active', soloActive);
  if (soloActive) {
    audio.setSoloVoice(selection.voiceId);
  } else {
    audio.setSoloVoice(undefined);
  }
  if (audio.isPlaying) {
    audio.update(store.data, getScene(store.data.scene).reverb);
  }
  needsRender = true;
}

soloBtn.addEventListener('click', toggleSolo);

// Toolbar auto-syncs when selection changes (signals drive the effect).
// Sets selectedId, toggles bottom bar visibility, and syncs panel state
// To the newly selected voice (fill swatch, pattern, border, etc.).
// Also pushes solo voice when solo mode is active.
effect(() => {
  toolbar.selectedId = selection.voiceId;
  toolbar.updateBottomBar();
  toolbar.syncToSelectedShape();
  const showSolo = selection.voiceId !== undefined && store.data.voices.length > 1;
  soloBtn.classList.toggle('solo-visible', showSolo);
  if (!showSolo && soloActive) {
    soloActive = false;
    soloBtn.classList.remove('solo-active');
    audio.setSoloVoice(undefined);
  }
  if (soloActive) {
    audio.setSoloVoice(selection.voiceId);
    if (audio.isPlaying) {
      audio.update(store.data, getScene(store.data.scene).reverb);
    }
  }
});

// ---- Check for saved state in URL ----

const loaded = loadFromURL();
if (loaded) {
  store.loadState(loaded);
} else {
  store.updateScene(randomSceneIndex());
}

const appEl = qel('#app');
initStageLayers(appEl);

// Scene readiness promise — resolves when the current scene's image + IR bytes
// Are fetched. Reassigned on every scene change.
let sceneReady: Promise<void> = Promise.resolve();

// Stage button: short click advances scene, long press opens scene picker
{
  const btnStage = qel('#btn-stage');
  const stageArea = qel('#stage-panel');
  const stagePanel = createStagePanel({
    area: stageArea,
    store,
    undo,
    requestRender: () => {
      needsRender = true;
    },
    onDismiss: () => toolbar.panels.close(),
  });
  toolbar.panels.register('stage', stagePanel, btnStage, stageArea);
  bindLongPress(
    btnStage,
    () => {
      undo.snapshot();
      store.updateScene((store.data.scene + 1) % SCENES.length);
      needsRender = true;
    },
    () => toolbar.panels.toggle('stage'),
  );
}

// Blend button: short click cycles blend mode, long press opens blend picker
{
  const btnBlend = qel('#btn-blend');
  const blendArea = qel('#blend-panel');
  const blendPanel = createBlendPanel({
    area: blendArea,
    store,
    undo,
    onDismiss: () => toolbar.panels.close(),
  });
  toolbar.panels.register('blend', blendPanel, btnBlend, blendArea);
  bindLongPress(
    btnBlend,
    () => {
      if (!store.hasOverlap) {
        return;
      }
      undo.snapshot();
      const current = store.data.blend;
      const idx = BLEND_MODES.indexOf(current);
      const next = BLEND_MODES[(idx + 1) % BLEND_MODES.length]!;
      store.updateBlend(next);
      needsRender = true;
    },
    () => {
      if (!store.hasOverlap) {
        return;
      }
      toolbar.panels.toggle('blend');
    },
  );
}

// React to scene changes (and apply the initial scene on first run):
// Update background crossfade + prefetch.
// Guard: store.data is a single signal, so this effect fires on ANY state
// Change. Track previous scene index to skip when unchanged.
{
  let prevScene = -1;
  effect(() => {
    const sceneIndex = store.data.scene;
    if (sceneIndex === prevScene) {
      return;
    }
    prevScene = sceneIndex;
    const sceneDef = getScene(sceneIndex);
    applyScene(appEl, sceneIndex);
    sceneReady = prefetchScene(sceneDef);
  });
}

// ---- DOM queries ----

const stage = qel('#stage');
const canvasWrap = qel('#canvas-wrap');

// ---- Playback controller ----

const playback: PlaybackController = new PlaybackController({
  audio,
  getState: () => store.data,
  requestRender: () => {
    needsRender = true;
  },
  getIRBuffer: async () => {
    try {
      await sceneReady;
      const ctx = audio.audioCtx;
      if (!ctx) {
        return undefined;
      }
      return await loadSceneIR(ctx, getScene(store.data.scene));
    } catch {
      return undefined;
    }
  },
});

// ---- Splash screen ----

const splashOverlay = qel('#splash-overlay');
const splash = new SplashController({ store, audio, playback, overlay: splashOverlay });

// ---- Render loop ----

// Signal effect: automatically subscribes to store.data changes.
// Replaces the old store.onChange() listener — the signal detects immutable
// Reference changes and runs this effect synchronously on each mutation.
{
  let first = true;
  effect(() => {
    const data = store.data; // Subscribe to the signal
    updateCanvasBorderRadius(canvasWrap, data.envelope);
    updateCanvasBorderRadius(tile, data.envelope);
    updateCanvasBorderRadius(svgCanvas, data.envelope, 10);
    document.body.classList.toggle('has-voices', data.voices.length > 0);
    if (first) {
      first = false;
      return; // Skip the initial run (matches old onChange behavior)
    }
    needsRender = true;
    debouncedSave();
    if (audio.isPlaying) {
      audio.update(data, getScene(data.scene).reverb);
    }
  });
}

function renderLoop(): void {
  if (needsRender || audio.isPlaying) {
    const soloId = soloActive ? selection.voiceId : undefined;
    render(svgCanvas, store.data, store.overlappingIds, selection.voiceId, soloId);

    needsRender = false;
  }

  playback.renderTick();

  requestAnimationFrame(renderLoop);
}
renderLoop();

// Reveal canvas after first render + ADSR corners are applied (no FOUC)
canvasWrap.classList.add('ready');

// ---- Tool-to-waveform map (derived from waveform strategy registry) ----

const toolToWaveform = new Map(all().map((e) => [e.ui.shapeName, e.waveform] as const));

// ---- Canvas interaction controller ----

const canvasInteraction = new CanvasInteractionController({
  addVoiceFromTool: (tool: string, x, y) => {
    const waveform = toolToWaveform.get(tool);
    if (!waveform) {
      return;
    }
    undo.snapshot();
    const voice = store.addVoice(waveform, x, y);
    selection.select(voice.id);
    toolbar.currentTool = 'select';
    toolbar._updateToolActive();
    needsRender = true;
  },
  canvas: svgCanvas,
  stage,
  canvasWrap,
  requestRender: () => {
    needsRender = true;
  },
  selection,
  store,
  toolbar,
  undo,
});
canvasInteraction.bindEvents();

// ---- Tool change callback ----

toolbar.onToolChange = (tool: string) => {
  if (tool === 'deselect') {
    selection.clear();
    needsRender = true;
  }
};

toolbar.onDuplicate = () => {
  if (selection.voiceId) {
    undo.snapshot();
    const dup = store.duplicateVoice(selection.voiceId, 0.03, 0.03);
    if (dup) {
      selection.select(dup.id);
      needsRender = true;
    }
  }
};

// ---- Keyboard shortcuts ----

bindKeyboardShortcuts({
  playback,
  requestRender: () => {
    needsRender = true;
  },
  selection,
  store,
  toolbar,
  toggleSolo,
  undo,
});

playback.bindEvents();
stampSamplesReady.then(() => splash.bindEvents());

// ---- Auto-save to URL (debounced) ----

let navigating = false;
let saveTimeout: ReturnType<typeof setTimeout> | undefined;
function debouncedSave(): void {
  if (navigating) {
    return;
  }
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    if (store.data.voices.length > 0) {
      saveToURL(store.data);
    } else if (location.pathname !== '/') {
      history.replaceState(null, '', '/');
    }
  }, 1000);
}

// ---- History navigation (back/forward) ----

globalThis.addEventListener('popstate', () => {
  // Cancel any pending debounced save
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = undefined;
  }

  const state = pathToState(location.pathname);
  navigating = true;
  if (state) {
    store.loadState(state);
  } else {
    // Navigated back to empty canvas — load current state with voices cleared
    store.loadState({ ...store.data, voices: [] });
  }
  navigating = false;
  resetDirty();
  selection.clear();
  needsRender = true;
});

// ---- Tutorial (lazy-loaded, declared early for use in logo handler) ----

let tutorial:
  | { show(): void; hide(): void; readonly isVisible: boolean; onShow: (() => void) | null }
  | undefined;

// ---- Credits overlay ----

const credits = initCredits(audio, store);

// Logo mark: bounce then show credits (or dismiss if already open)
const logoMark = qel('.logo-mark');
const creditsOverlay = qel('#credits-overlay');
const shareOverlay = qel('#share-overlay');
logoMark.addEventListener('click', () => {
  // If credits is open, just dismiss it
  if (!creditsOverlay.classList.contains('hidden')) {
    credits.hide();
    return;
  }
  // If another overlay is open, do nothing
  if (!shareOverlay.classList.contains('hidden') || tutorial?.isVisible) {
    return;
  }
  // Bounce then show credits
  logoMark.classList.remove('bounce');
  void logoMark.offsetWidth;
  logoMark.classList.add('bounce');
  logoMark.addEventListener(
    'animationend',
    () => {
      logoMark.classList.remove('bounce');
      credits.show();
    },
    { once: true },
  );
});

// ---- Share overlay ----

const share = initShare(audio, store);

// ---- Tutorial overlay (lazy-loaded on first click) ----

async function loadTutorial() {
  const { initTutorial } = await import('./tutorial.ts');
  tutorial = initTutorial({
    audio,
    store,
    undo,
    selection,
    requestRender: () => {
      needsRender = true;
    },
    showCredits: () => credits.show(),
  });
  tutorial.onShow = () => {
    credits.hide();
    share.hide();
  };
  return tutorial;
}

const tutorialBtn = qel('#btn-tutorial');
tutorialBtn.addEventListener('click', async () => {
  if (tutorial?.isVisible) {
    tutorial.hide();
    return;
  }
  if (playback.isPlaying) {
    playback.stop();
  }
  const t = tutorial ?? (await loadTutorial());
  t.show();
});

// First-visit hint: bounce the tutorial button once after the toolbar
// becomes visible, matching the logo bounce animation. Uses the same
// localStorage key as the tutorial intro sequence.
if (!localStorage.getItem('spatch-tutorial-seen')) {
  const doBounce = () => {
    tutorialBtn.classList.add('bounce');
    tutorialBtn.addEventListener('animationend', () => tutorialBtn.classList.remove('bounce'), {
      once: true,
    });
  };

  if (document.body.classList.contains('is-editing')) {
    // Toolbar already visible (homepage or seen URL) — bounce after a beat
    // so it's noticeable rather than lost in the initial paint.
    setTimeout(doBounce, 600);
  } else {
    // Splash active — bounce when the toolbar fades in.
    const botBar = qel('#toolbar-bottom');
    botBar.addEventListener(
      'transitionend',
      (e) => {
        if (e.propertyName === 'opacity') {
          doBounce();
        }
      },
      { once: true },
    );
  }
}

// Cross-wire: each overlay dismisses the others when opening
credits.onShow = () => {
  share.hide();
  tutorial?.hide();
};
share.onShow = () => {
  credits.hide();
  tutorial?.hide();
};

// ---- Pause audio when tab is hidden ----

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    audio.suspend();
  } else {
    audio.resume();
  }
});

// ---- New button ----

qel('#btn-new').addEventListener('click', () => {
  if (store.data.voices.length === 0) {
    return;
  }
  undo.snapshot();
  for (const v of store.data.voices) {
    store.removeVoice(v.id);
  }
  selection.clear();
  needsRender = true;
});

// ---- Randomize & Harmonize ----

qel('#btn-randomize').addEventListener('click', () => {
  randomize(store, undo);
  selection.clear();
  needsRender = true;
});

{
  const btnHarmonize = qel('#btn-harmonize');
  const harmonizeArea = qel('#harmonize-panel');
  const harmonizePanel = createHarmonizePanel({
    area: harmonizeArea,
    store,
    undo,
    requestRender: () => {
      needsRender = true;
    },
    onDismiss: () => toolbar.panels.close(),
  });
  toolbar.panels.register('harmonize', harmonizePanel, btnHarmonize, harmonizeArea);
  bindLongPress(
    btnHarmonize,
    () => {
      harmonize(store, undo);
      needsRender = true;
    },
    () => toolbar.panels.toggle('harmonize'),
  );
}

// ---- Splash preview button ----

qel('#btn-splash').addEventListener('click', () => {
  if (playback.isPlaying) {
    playback.stop();
  }
  splash.enterPreview();
});
