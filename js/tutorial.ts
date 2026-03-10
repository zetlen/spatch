// tutorial.ts — Interactive tutorial overlay with punch-out highlights
//
// In-page overlay that dims the screen and punches out highlighted UI
// targets. Shares the main AudioEngine (injected via TutorialDeps).
// Saves and restores sigil state on show/hide so the user's work is preserved.
//
// Icon references for sprite scanner:
// #tabler-mood-puzzled #tabler-chevron-left #tabler-x

import { harmonize, randomize } from './harmony.ts';
import type { AudioEngine } from './audio/engine.ts';
import type { SelectionManager, SigilStore, UndoManager } from './state.ts';
import { normalizedCoord, type SigilData } from './types.ts';

const LS_KEY = 'spatch-tutorial-seen';

/** Chiclet is the most neutral-sounding scene. */
const CHICLET_SCENE = 0;

interface TutorialStep {
  /** CSS selector for the element to highlight (punch-out). */
  target: string;
  /** Text to display. */
  text: string;
  /** Optional: compute a custom punch-out rect instead of using the target's bounding box. */
  customRect?: () => DOMRect;
  /** Also punch out the canvas so shapes are visible through the overlay. */
  showCanvas?: boolean;
  /** Optional setup function to run before showing this step. */
  setup?: () => void;
  /** Optional teardown function to run when leaving this step. */
  teardown?: () => void;
}

interface TutorialDeps {
  audio: AudioEngine;
  store: SigilStore;
  undo: UndoManager;
  selection: SelectionManager;
  requestRender: () => void;
  showCredits: () => void;
}

export function initTutorial(deps: TutorialDeps): {
  show(): void;
  hide(): void;
  readonly isVisible: boolean;
  onShow: (() => void) | null;
} {
  const { audio, store, undo, selection, requestRender, showCredits } = deps;

  // Build overlay DOM
  const overlay = document.createElement('div');
  overlay.className = 'tutorial-overlay hidden';

  const dim = document.createElement('div');
  dim.className = 'tutorial-dim';

  const textEl = document.createElement('div');
  textEl.className = 'tutorial-text';

  // Left-side vertical nav stack: back + close
  const navStack = document.createElement('div');
  navStack.className = 'tutorial-nav-stack';

  const backBtn = document.createElement('button');
  backBtn.className = 'tutorial-nav';
  backBtn.title = 'Back';
  backBtn.innerHTML = `<svg width="20" height="20"><use href="#tabler-chevron-left" /></svg>`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tutorial-nav';
  closeBtn.title = 'Close tutorial';
  closeBtn.innerHTML = `<svg width="20" height="20"><use href="#tabler-x" /></svg>`;

  navStack.append(backBtn, closeBtn);

  const introEl = document.createElement('div');
  introEl.className = 'tutorial-intro hidden';

  overlay.append(dim, textEl, navStack, introEl);
  document.body.append(overlay);

  const handle: {
    show(): void;
    hide(): void;
    readonly isVisible: boolean;
    onShow: (() => void) | null;
  } = {
    show,
    hide,
    get isVisible() {
      return !overlay.classList.contains('hidden');
    },
    onShow: null,
  };

  // ---- Animation & timing helpers ----

  let pendingCancels: (() => void)[] = [];

  /** Cancel all pending animations and scheduled timeouts from step setups. */
  function cancelPending(): void {
    for (const fn of pendingCancels) fn();
    pendingCancels = [];
  }

  /** Schedule a timeout; auto-cancelled on step change. Returns the timeout ID. */
  function schedule(fn: () => void, ms: number): void {
    const id = setTimeout(fn, ms);
    pendingCancels.push(() => clearTimeout(id));
  }

  /**
   * Run an animation loop; auto-cancelled on step change.
   * `onFrame(t)` receives a 0–1 value cycling over `periodMs`.
   */
  function animateLoop(periodMs: number, onFrame: (t: number) => void): void {
    let cancelled = false;
    function frame(): void {
      if (cancelled) return;
      const t = (performance.now() % periodMs) / periodMs;
      onFrame(t);
      requestRender();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    pendingCancels.push(() => {
      cancelled = true;
    });
  }

  /** Start playback for `ms` milliseconds, then release. Auto-cancelled on step change. */
  function playFor(ms: number): void {
    audio.play(store.data, store.data.envelope);
    schedule(() => audio.release(store.data.envelope), ms);
  }

  /** Start playback and latch, or continue if already playing. */
  function playLatched(): void {
    if (!audio.isPlaying) {
      audio.play(store.data, store.data.envelope);
    }
  }

  // ---- State save/restore ----

  let savedState: SigilData | undefined;

  // ---- Demo shape helpers ----

  let demoTriId: string | undefined;
  let demoSqId: string | undefined;
  let demoCircId: string | undefined;
  let demoDupeId: string | undefined;

  function clearVoices(): void {
    const ids = store.data.voices.map((v) => v.id);
    for (const id of ids) store.removeVoice(id);
    demoTriId = demoSqId = demoCircId = demoDupeId = undefined;
    selection.clear();
  }

  // Default positions: C major first inversion (E4, G4, C5)
  // Y values computed from MIDI mapping: y = 1 - (midi - 43) / 36
  const DEMO_TRI_Y = 0.417; // E4
  const DEMO_SQ_Y = 0.333; // G4
  const DEMO_CIRC_Y = 0.194; // C5
  const DEMO_TRI_Y_HIGH = 0.083; // E5 (second inversion target)

  function addDemoTriangle(x = 0.3, y = DEMO_TRI_Y, size = 0.12, timbre = 0.4): void {
    const v = store.addVoice('blend', normalizedCoord(x), normalizedCoord(y));
    demoTriId = v.id;
    store.updateVoice(v.id, {
      size: normalizedCoord(size),
      timbre: normalizedCoord(timbre),
      fill: { mode: 'solid', h: 200, s: 70, l: 55 },
    });
  }

  function addDemoSquare(x = 0.5, y = DEMO_SQ_Y, size = 0.15, timbre = 0.25): void {
    const v = store.addVoice('pulse', normalizedCoord(x), normalizedCoord(y));
    demoSqId = v.id;
    store.updateVoice(v.id, {
      size: normalizedCoord(size),
      timbre: normalizedCoord(timbre),
      fill: { mode: 'solid', h: 340, s: 75, l: 50 },
    });
  }

  function addDemoCircle(x = 0.5, y = DEMO_CIRC_Y, size = 0.14): void {
    const v = store.addVoice('sine', normalizedCoord(x), normalizedCoord(y));
    demoCircId = v.id;
    store.updateVoice(v.id, {
      size: normalizedCoord(size),
      fill: { mode: 'solid', h: 50, s: 80, l: 60 },
    });
  }

  /** Set up all three demo shapes + switch to chiclet scene. */
  function setupDemoSpatch(): void {
    clearVoices();
    store.updateScene(CHICLET_SCENE);
    addDemoTriangle();
    addDemoSquare();
    addDemoCircle();
    selection.clear();
    requestRender();
  }

  /** Isolate a single large shape centered on canvas, removing the others. */
  function isolateShape(shape: 'triangle' | 'square' | 'circle'): void {
    clearVoices();
    if (shape === 'triangle') addDemoTriangle(0.5, 0.5, 0.25, 0.0);
    if (shape === 'square') addDemoSquare(0.5, 0.5, 0.25, 0.0);
    if (shape === 'circle') addDemoCircle(0.5, 0.5, 0.25);
    selection.clear();
    requestRender();
  }

  /** Return a small rect at one corner of #canvas-wrap for ADSR punch-outs. */
  function canvasCornerRect(corner: 'tl' | 'tr' | 'bl' | 'br'): DOMRect {
    const el = document.querySelector<HTMLElement>('#canvas-wrap')!;
    const r = el.getBoundingClientRect();
    const size = 64;
    const x = corner === 'tl' || corner === 'bl' ? r.left : r.right - size;
    const y = corner === 'tl' || corner === 'tr' ? r.top : r.bottom - size;
    return new DOMRect(x, y, size, size);
  }

  // ---- Easing ----

  /** Sine easing: smooth oscillation between 0 and 1. */
  function sine01(t: number): number {
    return 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
  }

  /** Linear interpolation. */
  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  // ---- Tutorial step definitions ----

  const steps: TutorialStep[] = [
    // 1. Static intro — three demo shapes visible, no audio, no animation
    {
      target: '#canvas-wrap',
      text: 'Your spatch. Every spatch is a unique picture and a unique sound. Sound on. Headphones ideal.',
      showCanvas: true,
      setup() {
        setupDemoSpatch();
      },
    },

    // 2. Animated intro — shapes move, audio plays
    {
      target: '#bottom-tools',
      text: 'Shapes are simple sounds. Pick one and drop it on your spatch.',
      showCanvas: true,
      setup() {
        setupDemoSpatch();
        playLatched();
        // Animate: triangle E4↔E5 (first↔second inversion), square full pan, circle big pulse
        animateLoop(3000, (t) => {
          const s = sine01(t);
          if (demoTriId) {
            store.updateVoice(demoTriId, {
              y: normalizedCoord(lerp(DEMO_TRI_Y, DEMO_TRI_Y_HIGH, s)),
            });
          }
          if (demoSqId) {
            store.updateVoice(demoSqId, { x: normalizedCoord(lerp(0.05, 0.95, s)) });
          }
          if (demoCircId) {
            store.updateVoice(demoCircId, { size: normalizedCoord(lerp(0.04, 0.3, s)) });
          }
        });
      },
    },

    // 2a. Triangle — isolate, continuous spin
    {
      target: '[data-tool="triangle"]',
      text: 'Spin a triangle to go between triangle and sawtooth wave.',
      showCanvas: true,
      setup() {
        isolateShape('triangle');
        playLatched();
        animateLoop(3000, (t) => {
          if (demoTriId) {
            store.updateVoice(demoTriId, { timbre: normalizedCoord(sine01(t) * 0.5) });
          }
        });
      },
      teardown() {
        audio.release(store.data.envelope);
      },
    },

    // 2b. Square — isolate, continuous spin
    {
      target: '[data-tool="square"]',
      text: 'Spin a square to phase a square wave.',
      showCanvas: true,
      setup() {
        isolateShape('square');
        playLatched();
        animateLoop(3000, (t) => {
          if (demoSqId) {
            store.updateVoice(demoSqId, { timbre: normalizedCoord(sine01(t) * 0.5) });
          }
        });
      },
      teardown() {
        audio.release(store.data.envelope);
      },
    },

    // 2c. Circle — isolate, play 2 seconds (no spin)
    {
      target: '[data-tool="circle"]',
      text: "Circles are sine waves. Can't spin 'em, they're circles.",
      showCanvas: true,
      setup() {
        isolateShape('circle');
        playFor(2000);
      },
      teardown() {
        audio.release(store.data.envelope);
      },
    },

    // 2d. Select button
    {
      target: '[data-tool="select"]',
      text: 'Back to select mode.',
    },

    // 3a–f. Colors are vowels — each color is its own step so users can linger
    {
      target: '#fill-swatch',
      text: 'Colors are vowels.',
      showCanvas: true,
      setup() {
        setupDemoSpatch();
        if (!demoTriId) return;
        selection.select(demoTriId);

        store.updateVoice(demoTriId, { fill: { mode: 'solid', h: 0, s: 80, l: 50 } });
        requestRender();
        playLatched();
      },
    },
    {
      target: '#fill-swatch',
      text: 'Colors are vowels.',
      showCanvas: true,
      setup() {
        if (!demoTriId) return;

        store.updateVoice(demoTriId, { fill: { mode: 'solid', h: 50, s: 80, l: 60 } });
        requestRender();
        playLatched();
      },
    },
    {
      target: '#fill-swatch',
      text: 'Colors are vowels.',
      showCanvas: true,
      setup() {
        if (!demoTriId) return;

        store.updateVoice(demoTriId, { fill: { mode: 'solid', h: 200, s: 70, l: 55 } });
        requestRender();
        playLatched();
      },
    },
    {
      target: '#fill-swatch',
      text: 'Colors are vowels.',
      showCanvas: true,
      setup() {
        if (!demoTriId) return;

        store.updateVoice(demoTriId, { fill: { mode: 'solid', h: 280, s: 60, l: 40 } });
        requestRender();
        playLatched();
      },
    },
    {
      target: '#fill-swatch',
      text: 'Colors are vowels.',
      showCanvas: true,
      setup() {
        if (!demoTriId) return;

        store.updateVoice(demoTriId, { fill: { mode: 'solid', h: 120, s: 90, l: 70 } });
        requestRender();
        playLatched();
      },
    },
    {
      target: '#fill-swatch',
      text: 'Gradients are diphthongs.',
      showCanvas: true,
      setup() {
        if (!demoTriId) return;

        store.updateVoice(demoTriId, {
          fill: { mode: 'linear', h: 0, s: 80, l: 50, h2: 200, s2: 70, l2: 55, gradAngle: 45 },
        });
        requestRender();
        playLatched();
      },
    },

    // 3b. Patterns — cycle through stripes, checker, noise
    {
      target: '#btn-pattern',
      text: 'Patterns are effects.',
      showCanvas: true,
      setup() {
        if (demoSqId) {
          selection.select(demoSqId);
          store.updateVoice(demoSqId, { effect: 'stripes' });
        }
        requestRender();
        playLatched();
      },
    },
    {
      target: '#btn-pattern',
      text: 'Patterns are effects.',
      showCanvas: true,
      setup() {
        if (demoSqId) {
          store.updateVoice(demoSqId, { effect: 'checker' });
        }
        requestRender();
        playLatched();
      },
    },
    {
      target: '#btn-pattern',
      text: 'Patterns are effects.',
      showCanvas: true,
      setup() {
        if (demoSqId) {
          store.updateVoice(demoSqId, { effect: 'noise' });
        }
        requestRender();
        playLatched();
      },
      teardown() {
        if (demoSqId) store.updateVoice(demoSqId, { effect: undefined });
        requestRender();
      },
    },

    // 3c. Blend modes — cluster shapes and cycle through combinations
    {
      target: '#btn-blend',
      text: 'Blend modes modulate where shapes overlap.',
      showCanvas: true,
      setup() {
        // Move shapes to overlap
        if (demoTriId) store.updateVoice(demoTriId, { x: normalizedCoord(0.45) });
        if (demoSqId) {
          selection.select(demoSqId);
          store.updateVoice(demoSqId, { x: normalizedCoord(0.52), blend: 'multiply' });
        }
        if (demoCircId)
          store.updateVoice(demoCircId, { x: normalizedCoord(0.48), blend: 'difference' });
        requestRender();
        playLatched();
      },
    },
    {
      target: '#btn-blend',
      text: 'Blend modes modulate where shapes overlap.',
      showCanvas: true,
      setup() {
        if (demoSqId) store.updateVoice(demoSqId, { blend: 'screen' });
        if (demoCircId) store.updateVoice(demoCircId, { blend: 'color-burn' });
        requestRender();
        playLatched();
      },
    },
    {
      target: '#btn-blend',
      text: 'Blend modes modulate where shapes overlap.',
      showCanvas: true,
      setup() {
        if (demoSqId) store.updateVoice(demoSqId, { blend: 'overlay' });
        if (demoCircId) store.updateVoice(demoCircId, { blend: 'exclusion' });
        requestRender();
        playLatched();
      },
      teardown() {
        // Restore positions and blends
        if (demoTriId) store.updateVoice(demoTriId, { x: normalizedCoord(0.3) });
        if (demoSqId) store.updateVoice(demoSqId, { x: normalizedCoord(0.5), blend: 'soft-light' });
        if (demoCircId)
          store.updateVoice(demoCircId, { x: normalizedCoord(0.5), blend: 'soft-light' });
        requestRender();
      },
    },

    // 3d. Border — white border on circle, double black border on triangle
    {
      target: '#btn-border',
      text: 'Borders add octaves.',
      showCanvas: true,
      setup() {
        if (demoCircId) {
          selection.select(demoCircId);
          store.updateVoice(demoCircId, {
            border: { color: 'white', double: false, thickness: normalizedCoord(0.3) },
          });
        }
        if (demoTriId) {
          store.updateVoice(demoTriId, {
            border: { color: 'black', double: true, thickness: normalizedCoord(0.3) },
          });
        }
        requestRender();
        playFor(2000);
      },
      teardown() {
        audio.release(store.data.envelope);
        if (demoCircId) store.updateVoice(demoCircId, { border: undefined });
        if (demoTriId) store.updateVoice(demoTriId, { border: undefined });
        requestRender();
      },
    },

    // 3e. Duplicate — duplicate the circle
    {
      target: '#btn-duplicate',
      text: 'Twinsies!',
      showCanvas: true,
      setup() {
        if (demoCircId) {
          selection.select(demoCircId);
          const dupe = store.duplicateVoice(demoCircId, 0.08, -0.08);
          if (dupe) demoDupeId = dupe.id;
        }
        requestRender();
      },
    },

    // 3f. Trash — delete the duplicate
    {
      target: '#btn-delete',
      text: 'Nonesies!',
      showCanvas: true,
      setup() {
        if (demoDupeId) {
          selection.select(demoDupeId);
          // Brief pause so the user sees it selected, then delete
          schedule(() => {
            if (demoDupeId) {
              store.removeVoice(demoDupeId);
              demoDupeId = undefined;
              selection.clear();
              requestRender();
            }
          }, 600);
        }
        requestRender();
      },
      teardown() {
        // Clean up duplicate if user skipped before the delete fired
        if (demoDupeId) {
          store.removeVoice(demoDupeId);
          demoDupeId = undefined;
        }
        selection.clear();
        requestRender();
      },
    },

    // 4a. Undo/redo — step 1: delete the square
    {
      target: '.actions-group',
      text: 'Whoopsies!',
      showCanvas: true,
      setup() {
        setupDemoSpatch();
        if (demoSqId) {
          undo.snapshot();
          store.removeVoice(demoSqId);
          requestRender();
        }
      },
    },
    // 4a-2. Undo — square reappears
    {
      target: '#btn-undo',
      text: 'Whoopsies!',
      showCanvas: true,
      setup() {
        undo.undo();
        demoSqId = store.data.voices.find((v) => v.waveform === 'pulse')?.id;
        requestRender();
      },
    },
    // 4a-3. Redo — square disappears again
    {
      target: '#btn-redo',
      text: 'Whoopsies!',
      showCanvas: true,
      setup() {
        undo.redo();
        requestRender();
      },
    },
    // 4a-4. Undo again — square restored for subsequent steps
    {
      target: '#btn-undo',
      text: 'Whoopsies!',
      showCanvas: true,
      setup() {
        undo.undo();
        demoSqId = store.data.voices.find((v) => v.waveform === 'pulse')?.id;
        requestRender();
      },
    },

    // 4b. Randomize — actually randomize
    {
      target: '#btn-randomize',
      text: 'Create a random spatch.',
      showCanvas: true,
      setup() {
        randomize(store, undo);
        // Restore chiclet scene (randomize picks a random scene)
        store.updateScene(CHICLET_SCENE);
        // Update our demo IDs to match the new voices
        const voices = store.data.voices;
        demoTriId = voices.find((v) => v.waveform === 'blend')?.id;
        demoSqId = voices.find((v) => v.waveform === 'pulse')?.id;
        demoCircId = voices.find((v) => v.waveform === 'sine')?.id;
        selection.clear();
        requestRender();
        playFor(2000);
      },
    },

    // 4c–e. Harmonize — each harmonization is its own step
    {
      target: '#btn-harmonize',
      text: 'Harmonize your shapes to a musical scale. Click for random, hold to pick one.',
      showCanvas: true,
      setup() {
        harmonize(store, undo);
        requestRender();
        playFor(2000);
      },
    },
    {
      target: '#btn-harmonize',
      text: 'Harmonize your shapes to a musical scale. Click for random, hold to pick one.',
      showCanvas: true,
      setup() {
        harmonize(store, undo);
        requestRender();
        playFor(2000);
      },
    },
    {
      target: '#btn-harmonize',
      text: 'Harmonize your shapes to a musical scale. Click for random, hold to pick one.',
      showCanvas: true,
      setup() {
        harmonize(store, undo);
        requestRender();
        playFor(2000);
      },
    },

    // 4d. Scene — cycle through three scenes with audio
    {
      target: '#btn-stage',
      text: "Change the scenery. It'll change the whole vibe!",
      showCanvas: true,
      setup() {
        setupDemoSpatch();
        playFor(2000);
        // Switch scenes at intervals
        schedule(() => {
          store.updateScene(3);
          requestRender();
          playFor(2000);
          schedule(() => {
            store.updateScene(7);
            requestRender();
            playFor(2000);
            // Return to chiclet
            schedule(() => {
              store.updateScene(CHICLET_SCENE);
              requestRender();
            }, 2500);
          }, 2500);
        }, 2500);
      },
      teardown() {
        audio.release(store.data.envelope);
      },
    },

    // 4e. Bomb — clear all voices (stops playback), then silence before ADSR
    {
      target: '#btn-new',
      text: 'Empty spatch.',
      showCanvas: true,
      setup() {
        // Start playing so the user hears it go silent
        playFor(3000);
        // Clear all voices after a beat
        schedule(() => {
          clearVoices();
          requestRender();
        }, 800);
      },
      teardown() {
        audio.release(store.data.envelope);
      },
    },

    // 4f. Splash
    { target: '#btn-splash', text: 'Preview what your friends will see when you share.' },

    // 5. ADSR corners — animate each corner visually via store.updateEnvelope().
    //    Audio is stopped because the bomb step cleared all voices and stopped playback.
    //    The signal effect in app.ts only calls audio.update() if audio.isPlaying,
    //    so these envelope mutations won't trigger audio.
    {
      target: '#canvas-wrap',
      text: 'Attack,',
      showCanvas: true,
      customRect: () => canvasCornerRect('bl'),
      setup() {
        // No voices on canvas — bomb cleared them. ADSR is purely visual
        // (canvas border-radius). No voices = no audio trigger.
        animateLoop(2000, (t) => {
          store.updateEnvelope({ attack: lerp(0.1, 2.0, sine01(t)) });
        });
      },
    },
    {
      target: '#canvas-wrap',
      text: 'Decay,',
      showCanvas: true,
      customRect: () => canvasCornerRect('tl'),
      setup() {
        animateLoop(2000, (t) => {
          store.updateEnvelope({ decay: lerp(0.2, 2.0, sine01(t)) });
        });
      },
    },
    {
      target: '#canvas-wrap',
      text: 'Sustain...',
      showCanvas: true,
      customRect: () => canvasCornerRect('tr'),
      setup() {
        animateLoop(2000, (t) => {
          store.updateEnvelope({ sustain: lerp(0.7, 1.0, sine01(t)) });
        });
      },
    },
    {
      target: '#canvas-wrap',
      text: 'Release.',
      showCanvas: true,
      customRect: () => canvasCornerRect('br'),
      setup() {
        animateLoop(2000, (t) => {
          store.updateEnvelope({ release: lerp(0.4, 3.0, sine01(t)) });
        });
      },
    },

    // 6. Play button
    {
      target: '#btn-play',
      text: 'Hold to play. Drag a little to start a loop. Drag a lot to lock a drone.',
    },

    // 7. Share button
    { target: '#btn-share', text: 'My spatch. Look at it!' },
  ];

  let currentStep = 0;

  // ---- Overlay management ----

  function show(): void {
    handle.onShow?.();
    savedState = store.data;
    overlay.classList.remove('hidden');

    const seen = localStorage.getItem(LS_KEY);
    if (seen) {
      startTutorial();
    } else {
      showIntroStep1();
    }
  }

  function hide(): void {
    if (overlay.classList.contains('hidden')) return;
    cleanupStep();
    audio.stop();
    restoreState();
    overlay.classList.add('hidden');
    introEl.classList.add('hidden');
  }

  function restoreState(): void {
    if (!savedState) return;
    store.loadState(savedState);
    savedState = undefined;
    selection.clear();
    requestRender();
  }

  /** Teardown current step: cancel animations, run step teardown. Does NOT stop audio. */
  function cleanupStep(): void {
    releaseTarget();
    cancelPending();
    const step = steps[currentStep];
    if (step?.teardown) step.teardown();
  }

  // ---- Intro sequence ----

  function showIntroStep1(): void {
    introEl.classList.remove('hidden');
    dim.style.clipPath = '';
    textEl.style.display = 'none';
    navStack.style.display = 'none';

    introEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'tutorial-intro-text';
    p.innerHTML = 'What, not <em>discoverable</em> enough for you?';
    const b = document.createElement('button');
    b.className = 'tutorial-intro-btn';
    b.textContent = 'No.';
    b.addEventListener('click', showIntroStep2);
    introEl.append(p, b);
  }

  function showIntroStep2(): void {
    introEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'tutorial-intro-text';
    p.innerHTML = 'Are you sure you want to spoil the <em>mystery?</em>';
    const b = document.createElement('button');
    b.className = 'tutorial-intro-btn';
    b.textContent = 'Yes.';
    b.addEventListener('click', () => {
      localStorage.setItem(LS_KEY, 'true');
      startTutorial();
    });
    introEl.append(p, b);
  }

  function startTutorial(): void {
    introEl.classList.add('hidden');
    textEl.style.display = '';
    navStack.style.display = '';
    currentStep = 0;
    showStep(0);
  }

  // ---- Step rendering ----

  /**
   * Build a clip-path using SVG path syntax with separate subpaths per hole.
   * Each M…Z subpath is independent — no bridging artifacts.
   */
  function punchOutClip(rects: DOMRect[], pad: number): string {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cr = 8; // corner radius for punch-out holes
    // Outer rect (clockwise)
    let d = `M0 0H${vw}V${vh}H0Z`;
    // Each punch-out hole as a rounded-rect subpath
    for (const rect of rects) {
      const x = rect.left - pad;
      const y = rect.top - pad;
      const w = rect.width + pad * 2;
      const h = rect.height + pad * 2;
      const r = Math.min(cr, w / 2, h / 2);
      d += ` M${x + r} ${y}`;
      d += `H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}`;
      d += `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`;
      d += `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}`;
      d += `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    }
    return `path(evenodd,"${d}")`;
  }

  function showStep(index: number): void {
    const step = steps[index]!;
    if (step.setup) step.setup();

    // Wait a frame so layout settles after setup
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(step.target);
      if (!el) {
        textEl.textContent = step.text;
        dim.style.clipPath = '';
        return;
      }

      const rect = step.customRect ? step.customRect() : el.getBoundingClientRect();
      const punchRects = [rect];

      // Also punch out the canvas when showCanvas is set and the target isn't the canvas
      if (step.showCanvas && step.target !== '#canvas-wrap') {
        const canvas = document.querySelector<HTMLElement>('#canvas-wrap');
        if (canvas) punchRects.push(canvas.getBoundingClientRect());
      }

      dim.style.clipPath = punchOutClip(punchRects, 6);

      // Position text near the target (not the canvas)
      positionText(rect);
      textEl.textContent = step.text;

      // Update back button state
      backBtn.disabled = index === 0;
    });
  }

  function positionText(targetRect: DOMRect): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const textW = 320;
    const textH = 80;
    const gap = 16;

    // Default: below the target, centered
    let left = targetRect.left + targetRect.width / 2 - textW / 2;
    let top = targetRect.bottom + gap;

    // If below would go off screen, try above
    if (top + textH > vh - 60) {
      top = targetRect.top - textH - gap;
    }

    // If above would go off screen, place to the side
    if (top < 60) {
      top = targetRect.top + targetRect.height / 2 - textH / 2;
      // Try right
      if (targetRect.right + gap + textW < vw) {
        left = targetRect.right + gap;
      } else {
        left = targetRect.left - textW - gap;
      }
    }

    // Clamp to viewport
    left = Math.max(12, Math.min(left, vw - textW - 12));
    top = Math.max(12, Math.min(top, vh - textH - 12));

    textEl.style.left = `${left}px`;
    textEl.style.top = `${top}px`;
  }

  // ---- Navigation ----

  function advance(): void {
    if (currentStep === steps.length - 1) {
      cleanupStep();
      audio.stop();
      restoreState();
      overlay.classList.add('hidden');
      introEl.classList.add('hidden');
      showCredits();
      return;
    }
    cleanupStep();
    currentStep++;
    showStep(currentStep);
  }

  function goBack(): void {
    if (currentStep > 0) {
      cleanupStep();
      currentStep--;
      showStep(currentStep);
    }
  }

  backBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    goBack();
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hide();
  });

  // Depress the current step's target button on pointerdown, release on pointerup
  let depressedEl: HTMLElement | null = null;

  function depressTarget(): void {
    releaseTarget();
    const step = steps[currentStep];
    if (!step) return;
    const el = document.querySelector<HTMLElement>(step.target);
    if (!el) return;
    el.classList.add('active');
    depressedEl = el;
  }

  function releaseTarget(): void {
    if (depressedEl) {
      depressedEl.classList.remove('active');
      depressedEl = null;
    }
  }

  overlay.addEventListener('pointerdown', (e) => {
    if (navStack.contains(e.target as Node)) return;
    if (!introEl.classList.contains('hidden')) return;
    depressTarget();
  });

  overlay.addEventListener('pointerup', (e) => {
    releaseTarget();
    if (navStack.contains(e.target as Node)) return;
    if (!introEl.classList.contains('hidden')) return;
    advance();
  });

  // Cancel depress if pointer leaves the overlay
  overlay.addEventListener('pointerleave', () => {
    releaseTarget();
  });

  // Escape to close
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
      hide();
    }
  });

  return handle;
}
