// App.ts — Entry point, event wiring, render loop

import { effect } from '@preact/signals-core';
import { SigilStore, UndoManager } from './state.ts';
import { render } from './canvas/render.ts';
import { Toolbar } from './toolbar/toolbar.ts';
import { AudioEngine } from './audio/engine.ts';
import { updateCanvasBorderRadius } from './shapes.ts';
import { loadFromURL, saveToURL } from './serialize.ts';
import { bindShareMenu } from './share.ts';
import { initStage, setAudioLevel } from './stage.ts';
import { qel } from './dom.ts';
import { SelectionManager } from './state.ts';
import { PlaybackController } from './playback.ts';
import { CanvasInteractionController } from './canvas/interaction.ts';
import { bindKeyboardShortcuts } from './keyboard.ts';
import { SplashController } from './splash.ts';
import { initCredits } from './credits.ts';

// ---- Init ----

const svgCanvas = qel<SVGSVGElement>('#sigil-canvas');
const tile = qel('#tile');

const store = new SigilStore();
const undo = new UndoManager(store);
const toolbar = new Toolbar(store, undo);
const audio = new AudioEngine();

// Pre-warm AudioContext on first user gesture. iOS Safari only allows audio
// From touchend, click, doubleclick, or keydown — NOT pointerdown/mousedown.
{
  const warmUpEvents = ['touchend', 'click', 'keydown'] as const;
  function onFirstGesture(): void {
    audio.warmUp();
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

// Toolbar auto-syncs when selection changes (signals drive the effect).
// Sets selectedId, toggles bottom bar visibility, and syncs panel state
// to the newly selected voice (fill swatch, pattern, border, etc.).
effect(() => {
  toolbar.selectedId = selection.voiceId;
  toolbar.updateBottomBar();
  toolbar.syncToSelectedShape();
});

// ---- Check for saved state in URL ----

const loaded = loadFromURL();
if (loaded) {
  store.loadState(loaded);
}

let needsRender = true;

initStage();

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
  isSplashActive: (): boolean => splash.isActive,
});

// ---- Splash screen ----

const splash = new SplashController({ stage, audio, playback });

// ---- Render loop ----

// Signal effect: automatically subscribes to store.data changes.
// Replaces the old store.onChange() listener — the signal detects immutable
// reference changes and runs this effect synchronously on each mutation.
{
  let first = true;
  effect(() => {
    const data = store.data; // subscribe to the signal
    updateCanvasBorderRadius(tile, data.envelope);
    if (first) {
      first = false;
      return; // skip the initial run (matches old onChange behavior)
    }
    needsRender = true;
    debouncedSave();
    if (audio.isPlaying) {
      audio.update(data);
    }
  });
}

function renderLoop(): void {
  if (needsRender || audio.isPlaying) {
    render(svgCanvas, store.data, selection.voiceId);
    setAudioLevel(audio.getLevel());

    needsRender = false;
  }

  playback.renderTick();

  requestAnimationFrame(renderLoop);
}
renderLoop();

// Reveal canvas after first render + ADSR corners are applied (no FOUC)
canvasWrap.classList.add('ready');

// ---- Canvas interaction controller ----

const canvasInteraction = new CanvasInteractionController({
  addVoiceFromTool: (tool: string, x, y) => {
    const toolToWaveform: Record<string, 'sine' | 'pulse' | 'blend'> = {
      circle: 'sine',
      square: 'pulse',
      triangle: 'blend',
    };
    const waveform = toolToWaveform[tool];
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
  isSplashActive: () => splash.isActive,
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

// ---- Share menu (hoisted for keyboard handler) ----

const shareBtn = qel('#btn-share');
const shareMenu = qel('#share-menu');

// ---- Keyboard shortcuts ----

bindKeyboardShortcuts({
  isSplashActive: () => splash.isActive,
  playback,
  requestRender: () => {
    needsRender = true;
  },
  selection,
  shareMenu,
  store,
  toolbar,
  undo,
});

playback.bindEvents();
splash.bindEvents();

// ---- Auto-save to URL (debounced) ----

let saveTimeout: ReturnType<typeof setTimeout> | undefined;
function debouncedSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    if (store.data.voices.length > 0) {
      saveToURL(store.data);
    }
  }, 1000);
}

// ---- Share menu ----

bindShareMenu({ shareBtn, shareMenu, store });

// ---- Credits overlay ----

initCredits(audio);

// ---- Pause audio when tab is hidden ----

document.addEventListener('visibilitychange', () => {
  if (!audio.audioCtx) return;
  if (document.hidden) {
    audio.audioCtx.suspend();
  } else {
    audio.audioCtx.resume();
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

// ---- Splash preview button ----

qel('#btn-splash').addEventListener('click', () => {
  splash.resetSeen();
  location.reload();
});

// ---- Debug: Vibe tuner (dev only, elided in production) ----

if (__VIBE_DEBUG__) {
  if (new URLSearchParams(location.search).get('debug') === 'vibe') {
    import('./debug/vibe-tuner.ts').then((m) =>
      m.init({
        audio,
        store,
      }),
    );
  }
}
