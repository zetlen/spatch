// Tutorial.ts — Interactive tutorial overlay with punch-out highlights
//
// Framework for step-based tutorials. Each step declares a target to
// Punch-out, text to display, and an optional `play(ctx)` function that
// Receives a StepContext with auto-cancelling helpers for scheduling,
// Animation, and audio. All timers, loops, and audio started via the
// Context are cancelled automatically when the step exits — no manual
// Teardown needed.
//
// Icon references for sprite scanner:
// #tabler-mood-puzzled #tabler-x

import { harmonize, randomize } from './harmony.ts';
import type { AudioEngine } from './audio/engine.ts';
import type { SelectionManager, SigilStore, UndoManager } from './state.ts';
import { normalizedCoord, type NormalizedCoord, type SigilData, type Voice } from './types.ts';
import { getScene } from './scenes/index.ts';

const LS_KEY = 'spatch-tutorial-seen';

// ---- Public types for step authoring ----

/**
 * Context passed to a step's `play()` function. Provides helpers for
 * scheduling, animation, audio, and state manipulation. Everything
 * started through this context is auto-cancelled when the step exits.
 */
export interface StepContext {
  /** Schedule `fn` after `ms` milliseconds. Auto-cancelled on step exit. */
  after(ms: number, fn: () => void): void;

  /**
   * Run an animation loop. `onFrame(t)` receives a 0–1 value cycling
   * over `periodMs`. Auto-cancelled on step exit. Triggers a render
   * each frame.
   */
  loop(periodMs: number, onFrame: (t: number) => void): void;

  /** Start audio playback for `ms` milliseconds, then release. */
  playFor(ms: number): void;

  /** Start latched playback, or continue if already playing. */
  playLatched(): void;

  /** Stop and release audio. */
  stop(): void;

  // ---- State manipulation ----

  /** The sigil store. */
  store: SigilStore;

  /** Selection manager. */
  selection: SelectionManager;

  /** Undo manager. */
  undo: UndoManager;

  /** Trigger a render. */
  render(): void;

  // ---- Easing helpers ----

  /** Sine easing: smooth oscillation between 0 and 1. */
  sine01(t: number): number;

  /** Linear interpolation. */
  lerp(a: number, b: number, t: number): number;

  /** Shorthand for `normalizedCoord()`. */
  nc(n: number): NormalizedCoord;

  // ---- Demo helpers ----

  /**
   * Mutable bag of voice IDs shared across steps. Use this to track
   * demo voices placed in one step and manipulated in later steps.
   * Cleared automatically when `clearVoices()` is called.
   */
  demo: Record<string, string | undefined>;

  /** Remove all voices, clear selection, and reset `demo` IDs. */
  clearVoices(): void;

  /** Add a demo voice and store its ID in `demo[key]`. */
  addVoice(
    key: string,
    waveform: 'sine' | 'pulse' | 'blend' | 'astroid',
    x: number,
    y: number,
  ): string;

  /** Add a demo stamp voice and store its ID in `demo[key]`. */
  addStamp(key: string, x: number, y: number): string;

  /** Randomize the spatch (delegates to harmony.ts). */
  randomize(): void;

  /** Harmonize pitches to a random scale (delegates to harmony.ts). */
  harmonize(): void;
}

export interface TutorialStep {
  /**
   * One or more CSS selectors to punch out. The framework resolves each
   * to a bounding rect and cuts holes in the dim overlay for all of them.
   * Text is positioned relative to the first selector's element.
   */
  punchOut: string | string[];

  /** Text to display. */
  text: string;

  /**
   * Position text relative to this rect instead of the first punchOut
   * element. Useful when the punch-out is large (e.g. canvas) but text
   * should appear near a sub-region (e.g. an ADSR corner).
   */
  textAnchor?: () => DOMRect;

  /** Which corner of the text label to anchor to the textAnchor point.
   *  Text is placed so this corner sits 2rem inward from the anchor. */
  textCorner?: 'tl' | 'tr' | 'bl' | 'br';

  /**
   * Demo function(s) for this step. If a single function, it runs once.
   * If an array, each click advances to the next function in order.
   * All receive a StepContext with auto-cancelling helpers.
   */
  play?: ((ctx: StepContext) => void) | ((ctx: StepContext) => void)[];

  /**
   * Custom text renderer. If provided, called instead of setting textContent.
   * Receives the text element (already emptied) and the step context.
   */
  renderText?: (el: HTMLElement, ctx: StepContext) => void;
}

export interface TutorialDeps {
  audio: AudioEngine;
  store: SigilStore;
  undo: UndoManager;
  selection: SelectionManager;
  requestRender: () => void;
  showCredits: () => void;
}

export interface TutorialHandle {
  show(): void;
  hide(): void;
  readonly isVisible: boolean;
  onShow: (() => void) | null;
}

/** Return a point rect at one corner of #canvas-wrap for ADSR text anchoring. */
function canvasCornerRect(corner: 'tl' | 'tr' | 'bl' | 'br'): DOMRect {
  const el = document.querySelector<HTMLElement>('#canvas-wrap')!;
  const r = el.getBoundingClientRect();
  const x = corner === 'tl' || corner === 'bl' ? r.left : r.right;
  const y = corner === 'tl' || corner === 'tr' ? r.top : r.bottom;
  return new DOMRect(x, y, 0, 0);
}

// ---- Demo constants ----

const CHICLET_SCENE = 0;
const SCBD_SCENE = 7;

// Default Y positions: C major first inversion (E4, G4, C5)
// Y = 1 - (midi - 43) / 36
const Y_E4 = 0.417;
const Y_G4 = 0.333;
const Y_C5 = 0.194;
const Y_E5 = 0.083;

/** Set up the standard three-voice demo spatch on chiclet scene. */
function setupDemoSpatch(ctx: StepContext): void {
  ctx.clearVoices();
  ctx.store.updateScene(CHICLET_SCENE);
  ctx.addVoice('tri', 'blend', 0.3, Y_E4);
  ctx.store.updateVoice(ctx.demo.tri!, {
    size: ctx.nc(0.12),
    timbre: ctx.nc(0.4),
    fill: { mode: 'solid', h: 200, s: 70, l: 55 },
  });
  ctx.addVoice('sq', 'pulse', 0.5, Y_G4);
  ctx.store.updateVoice(ctx.demo.sq!, {
    size: ctx.nc(0.15),
    timbre: ctx.nc(0.25),
    fill: { mode: 'solid', h: 340, s: 75, l: 50 },
  });
  ctx.addVoice('circ', 'sine', 0.5, Y_C5);
  ctx.store.updateVoice(ctx.demo.circ!, {
    size: ctx.nc(0.14),
    fill: { mode: 'solid', h: 50, s: 80, l: 60 },
  });
  ctx.selection.clear();
  ctx.render();
}

/** Isolate a single large shape centered on canvas. */
function isolateShape(ctx: StepContext, shape: 'sine' | 'pulse' | 'blend' | 'astroid'): void {
  ctx.clearVoices();
  ctx.store.updateScene(CHICLET_SCENE);
  const key =
    shape === 'blend' ? 'tri' : shape === 'pulse' ? 'sq' : shape === 'astroid' ? 'ast' : 'circ';
  ctx.addVoice(key, shape, 0.5, 0.5);
  ctx.store.updateVoice(ctx.demo[key]!, { size: ctx.nc(0.25) });
  if (shape !== 'sine') {
    ctx.store.updateVoice(ctx.demo[key]!, { timbre: ctx.nc(0) });
  }
  ctx.selection.clear();
  ctx.render();
}

/** Set up a single large square with a gradient fill. */
function setupGradientSquare(
  ctx: StepContext,
  fill: { h: number; s: number; l: number; h2: number; s2: number; l2: number; gradAngle: number },
): void {
  ctx.stop();
  ctx.clearVoices();
  ctx.store.updateScene(CHICLET_SCENE);
  ctx.addVoice('sq', 'pulse', 0.5, 0.5);
  ctx.store.updateVoice(ctx.demo.sq!, {
    size: ctx.nc(0.25),
    timbre: ctx.nc(0.083),
    fill: { mode: 'linear', ...fill },
  });
  ctx.selection.clear();
  ctx.render();
}

// ---- Note sequencer (tutorial-only) ----

const EIGHTH = 0.5;
const QUARTER = 1;
const DOTTED_QUARTER = 1.5;
const DOTTED_HALF = 3;
const WHOLE = 4;

// MIDI note names used by the Jump sequence
const D3 = 50,
  E3 = 52,
  A3 = 57,
  B3 = 59,
  Cs4 = 61,
  D4 = 62,
  E4 = 64,
  Fs4 = 66,
  Gs4 = 68,
  A4 = 69,
  B4 = 71,
  Cs5 = 73;

function midiToY(midi: number): number {
  return 1 - (midi - 43) / 36;
}

interface NoteSeq {
  chord(midi: number[], beats: number): NoteSeq;
  glide(midi: number[], beats: number): NoteSeq;
  rest(beats: number): NoteSeq;
  end(): void;
}

/** Per-voice config so NoteSeq can re-add voices after a rest. */
interface SeqVoiceConfig {
  waveform: 'sine' | 'pulse' | 'blend' | 'astroid';
  x: number;
  props?: Partial<Voice>;
}

/** Build a timed chord sequence over demo voices. */
function noteSeq(
  ctx: StepContext,
  bpm: number,
  configs: Record<string, SeqVoiceConfig>,
  guard: () => boolean,
  restoreSize = 0.16,
): NoteSeq {
  const beat = 60_000 / bpm;
  const voiceKeys = Object.keys(configs);
  let t = 0;
  let playing = false;

  function schedule(ms: number, fn: () => void): void {
    ctx.after(ms, () => {
      if (guard()) {
        fn();
      }
    });
  }

  /** Remove all seq voices from the store. */
  function mute(): void {
    for (const k of voiceKeys) {
      const id = ctx.demo[k];
      if (id) {
        ctx.store.removeVoice(id);
        ctx.demo[k] = undefined;
      }
    }
    ctx.render();
  }

  /** Ensure a voice exists in the store, re-adding it if it was removed. */
  function ensure(key: string, y: number): void {
    if (ctx.demo[key]) {
      ctx.store.updateVoice(ctx.demo[key]!, { y: ctx.nc(y), size: ctx.nc(restoreSize) });
    } else {
      const cfg = configs[key]!;
      ctx.addVoice(key, cfg.waveform, cfg.x, y);
      ctx.store.updateVoice(ctx.demo[key]!, { size: ctx.nc(restoreSize), ...cfg.props });
    }
  }

  const self: NoteSeq = {
    chord(midi, beats) {
      const at = t;
      const resume = !playing;
      schedule(at, () => {
        for (let i = 0; i < voiceKeys.length; i++) {
          if (midi[i] == null) {
            continue;
          }
          const y = midiToY(midi[i]!);
          if (resume) {
            ensure(voiceKeys[i]!, y);
          } else {
            const id = ctx.demo[voiceKeys[i]!];
            if (id) {
              ctx.store.updateVoice(id, { y: ctx.nc(y) });
            }
          }
        }
        ctx.render();
        if (resume) {
          ctx.playLatched();
        }
      });
      t += beat * beats;
      playing = true;
      return self;
    },
    glide(midi, beats) {
      const at = t;
      const dur = beat * beats;
      const resume = !playing;
      const targets = midi.map(midiToY);
      schedule(at, () => {
        if (resume) {
          for (let i = 0; i < voiceKeys.length; i++) {
            if (targets[i] != null) {
              ensure(voiceKeys[i]!, targets[i]!);
            }
          }
          ctx.playLatched();
        }
        const starts = voiceKeys.map((k) => {
          const id = ctx.demo[k];
          const v = id ? ctx.store.getVoice(id) : undefined;
          return v ? v.y : 0.5;
        });
        const t0 = performance.now();
        let done = false;
        function ramp(): void {
          if (!guard() || done) {
            return;
          }
          const p = Math.min((performance.now() - t0) / dur, 1);
          for (let i = 0; i < voiceKeys.length; i++) {
            const id = ctx.demo[voiceKeys[i]!];
            if (id && targets[i] != null) {
              ctx.store.updateVoice(id, {
                y: ctx.nc(ctx.lerp(starts[i]!, targets[i]!, p)),
              });
            }
          }
          ctx.render();
          if (p < 1) {
            requestAnimationFrame(ramp);
          } else {
            done = true;
          }
        }
        requestAnimationFrame(ramp);
      });
      t += dur;
      playing = true;
      return self;
    },
    rest(beats) {
      schedule(t, () => mute());
      t += beat * beats;
      playing = false;
      return self;
    },
    end() {
      schedule(t, () => mute());
    },
  };
  return self;
}

// ---- Jump easter egg ----

let jumpGen = 0;

/** Sequence the supersaw intro from Van Halen's "Jump". */
function playJumpSequence(ctx: StepContext): void {
  const gen = ++jumpGen;
  ctx.stop();
  ctx.clearVoices();
  ctx.store.updateScene(SCBD_SCENE);

  const overlay = document.querySelector<HTMLElement>('.tutorial-overlay');
  overlay?.classList.add('tutorial-locked');

  ctx.store.updateEnvelope({ attack: 0, decay: 0.286, sustain: 0.714, release: 0.429 });

  // Bass voice (blend/triangle) — bright red, chorused, double black border
  const bassProps: Partial<Voice> = {
    size: normalizedCoord(0.7),
    timbre: normalizedCoord(0.492),
    fill: { mode: 'solid', h: 0, s: 100, l: 55 },
    effect: 'stripes',
    border: { color: 'black', double: true, thickness: normalizedCoord(0.143) },
  } as Partial<Voice>;
  ctx.addVoice('jb', 'blend', 0.343, midiToY(A3));
  if (ctx.demo.jb) {
    ctx.store.updateVoice(ctx.demo.jb, bassProps);
  }

  // Melody voice config (3 light gray astroids — created on first chord, not upfront)
  const melodyProps: Partial<Voice> = {
    timbre: normalizedCoord(0.476),
    fill: { mode: 'solid', h: 0, s: 0, l: 79 },
  } as Partial<Voice>;

  ctx.selection.clear();
  ctx.render();

  const BPM = 130;
  const TOTAL_BEATS = 17;
  const guard = () => gen === jumpGen;

  // Bass line
  noteSeq(ctx, BPM, { jb: { waveform: 'blend', x: 0.343, props: bassProps } }, guard, 0.349)
    .chord([A3], WHOLE + WHOLE + WHOLE + EIGHTH)
    .chord([D3], QUARTER)
    .chord([E3], DOTTED_HALF)
    .end();

  // Melody line
  noteSeq(
    ctx,
    BPM,
    {
      j1: { waveform: 'astroid', x: 0.393, props: melodyProps },
      j2: { waveform: 'astroid', x: 0.344, props: melodyProps },
      j3: { waveform: 'astroid', x: 0.312, props: melodyProps },
    },
    guard,
    0.73,
  )
    .rest(QUARTER)
    .chord([E4, Gs4, B4], EIGHTH)
    .rest(QUARTER)
    .chord([E4, A4, Cs5], EIGHTH)
    .rest(QUARTER)
    .chord([D4, Fs4, A4], EIGHTH)
    .rest(QUARTER)
    .chord([D4, Fs4, A4], EIGHTH)
    .rest(EIGHTH)
    .chord([E4, Gs4, B4], EIGHTH)
    .rest(EIGHTH)
    .chord([E4, Gs4, B4], DOTTED_QUARTER)
    .chord([E4, A4, Cs5], EIGHTH)
    .rest(QUARTER)
    .chord([Cs4, E4, A4], EIGHTH)
    .rest(EIGHTH)
    .chord([A3, D4, Fs4], QUARTER)
    .chord([A3, Cs4, E4], QUARTER)
    .chord([A3, B3, E4], DOTTED_HALF)
    .end();

  // Master stop + unlock
  ctx.after((60_000 / BPM) * TOTAL_BEATS, () => {
    if (gen !== jumpGen) {
      return;
    }
    ctx.stop();
    overlay?.classList.remove('tutorial-locked');
  });
}

// ---- Step definitions ----

const steps: TutorialStep[] = [
  // 1. Static intro — three demo shapes visible
  {
    punchOut: '#canvas-wrap',
    text: 'Your spatch. Every spatch is a unique picture and a unique sound. Sound on. Headphones ideal.',
    play(ctx) {
      setupDemoSpatch(ctx);
    },
  },

  // 2. Animated intro — shapes move, audio plays
  {
    punchOut: ['#bottom-tools', '#canvas-wrap'],
    text: 'Shapes are simple sounds. Pick one and drop it on your spatch.',
    play(ctx) {
      setupDemoSpatch(ctx);
      ctx.playLatched();
      ctx.loop(3000, (t) => {
        const s = ctx.sine01(t);
        if (ctx.demo.tri) {
          ctx.store.updateVoice(ctx.demo.tri, { y: ctx.nc(ctx.lerp(Y_E4, Y_E5, s)) });
        }
        if (ctx.demo.sq) {
          ctx.store.updateVoice(ctx.demo.sq, { x: ctx.nc(ctx.lerp(0.05, 0.95, s)) });
        }
        if (ctx.demo.circ) {
          ctx.store.updateVoice(ctx.demo.circ, { size: ctx.nc(ctx.lerp(0.04, 0.3, s)) });
        }
      });
    },
  },

  // Triangle — isolate, continuous spin
  {
    punchOut: ['[data-tool="triangle"]', '#canvas-wrap'],
    text: 'Spin a triangle to go between triangle and sawtooth wave.',
    play(ctx) {
      isolateShape(ctx, 'blend');
      ctx.playLatched();
      ctx.loop(3000, (t) => {
        if (ctx.demo.tri) {
          ctx.store.updateVoice(ctx.demo.tri, { timbre: ctx.nc(ctx.sine01(t) * 0.5) });
        }
      });
    },
  },

  // Square — isolate, continuous spin
  {
    punchOut: ['[data-tool="square"]', '#canvas-wrap'],
    text: 'Spin a square to phase a square wave.',
    play(ctx) {
      isolateShape(ctx, 'pulse');
      ctx.playLatched();
      ctx.loop(3000, (t) => {
        if (ctx.demo.sq) {
          ctx.store.updateVoice(ctx.demo.sq, { timbre: ctx.nc(ctx.sine01(t) * 0.5) });
        }
      });
    },
  },

  // Circle — isolate, play 2 seconds
  {
    punchOut: ['[data-tool="circle"]', '#canvas-wrap'],
    text: "Circles are sine waves. Can't spin 'em, they're circles.",
    play(ctx) {
      isolateShape(ctx, 'sine');
      ctx.playFor(2000);
    },
  },

  // Astroid — isolate, continuous spin spreads the supersaw
  {
    punchOut: ['[data-tool="astroid"]', '#canvas-wrap'],
    text: 'Spin an astroid to spread a supersaw. Might as well jump!',
    play(ctx) {
      isolateShape(ctx, 'astroid');
      ctx.playLatched();
      ctx.loop(3000, (t) => {
        if (ctx.demo.ast) {
          ctx.store.updateVoice(ctx.demo.ast, { timbre: ctx.nc(ctx.sine01(t) * 0.5) });
        }
      });
    },
    renderText(el, ctx) {
      el.append('Spin an astroid to spread a supersaw. Might as well ');
      const link = document.createElement('span');
      link.textContent = 'jump!';
      link.className = 'tutorial-jump-link';
      link.dataset.tutorialInteractive = '';
      link.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        playJumpSequence(ctx);
      });
      el.append(link);
    },
  },

  // Stamp — place, cycle through trigger positions
  {
    punchOut: ['[data-tool="stamp"]', '#canvas-wrap'],
    text: 'Stamps play samples. Tilt to change when they fire.',
    play: [
      (ctx: StepContext) => {
        ctx.clearVoices();
        ctx.store.updateScene(CHICLET_SCENE);
        ctx.addStamp('st', 0.5, 0.5);
        ctx.store.updateVoice(ctx.demo.st!, { size: ctx.nc(0.2) });
        ctx.selection.clear();
        ctx.render();
        ctx.playFor(2000);
      },
      (ctx: StepContext) => {
        if (ctx.demo.st) {
          ctx.store.updateVoice(ctx.demo.st, { trigger: 0 });
        }
        ctx.render();
        ctx.playFor(2000);
      },
      (ctx: StepContext) => {
        if (ctx.demo.st) {
          ctx.store.updateVoice(ctx.demo.st, { trigger: 2 });
        }
        ctx.render();
        ctx.playFor(2000);
      },
    ],
  },

  // Colors are vowels — cycle through hues, all three shapes same color
  {
    punchOut: ['#fill-swatch', '#canvas-wrap'],
    text: 'Colors are vowels.',
    play: [
      { h: 0, s: 80, l: 50 },
      { h: 50, s: 80, l: 60 },
      { h: 200, s: 70, l: 55 },
      { h: 280, s: 60, l: 40 },
      { h: 120, s: 90, l: 70 },
    ].map((c, i) => (ctx: StepContext) => {
      if (i === 0) {
        setupDemoSpatch(ctx);
      }
      const fill = { mode: 'solid' as const, ...c };
      for (const k of ['tri', 'sq', 'circ']) {
        if (ctx.demo[k]) {
          ctx.store.updateVoice(ctx.demo[k]!, { fill });
        }
      }
      ctx.render();
      ctx.playLatched();
    }),
  },

  // Gradients are diphthongs
  {
    punchOut: ['#fill-swatch', '#canvas-wrap'],
    text: 'Gradients are diphthongs.',
    play: [
      [240, 75, 50, 0, 75, 50, 0],
      [180, 75, 45, 60, 80, 60, 0],
      [240, 75, 50, 0, 75, 50, 180],
      [180, 75, 45, 60, 80, 60, 180],
    ].map(([h, s, l, h2, s2, l2, angle]) => (ctx: StepContext) => {
      setupGradientSquare(ctx, {
        h: h!,
        s: s!,
        l: l!,
        h2: h2!,
        s2: s2!,
        l2: l2!,
        gradAngle: angle!,
      });
      ctx.playFor(2500);
    }),
  },

  // Patterns — cycle through effects
  {
    punchOut: ['#btn-pattern', '#canvas-wrap'],
    text: 'Patterns are effects.',
    play: (['stripes', 'buttons', 'waffles-revenge'] as const).map(
      (effect, i) => (ctx: StepContext) => {
        if (i === 0) {
          setupDemoSpatch(ctx);
          if (ctx.demo.sq) {
            ctx.selection.select(ctx.demo.sq);
          }
        }
        if (ctx.demo.sq) {
          ctx.store.updateVoice(ctx.demo.sq, { effect });
        }
        ctx.render();
        ctx.playLatched();
      },
    ),
  },

  // Blend modes — progressive overlap
  {
    punchOut: ['#btn-blend', '#canvas-wrap'],
    text: 'Blend modes modulate where shapes overlap.',
    play: [
      (ctx: StepContext) => {
        setupDemoSpatch(ctx);
        if (ctx.demo.tri) {
          ctx.store.updateVoice(ctx.demo.tri, {
            x: ctx.nc(0.35),
            y: ctx.nc(0.4),
            size: ctx.nc(0.18),
          });
        }
        if (ctx.demo.sq) {
          ctx.selection.select(ctx.demo.sq);
          ctx.store.updateVoice(ctx.demo.sq, { x: ctx.nc(0.5), y: ctx.nc(0.4), size: ctx.nc(0.2) });
        }
        if (ctx.demo.circ) {
          ctx.store.updateVoice(ctx.demo.circ, {
            x: ctx.nc(0.65),
            y: ctx.nc(0.4),
            size: ctx.nc(0.18),
          });
        }
        ctx.render();
        ctx.playLatched();
      },
      (ctx: StepContext) => {
        if (ctx.demo.tri) {
          ctx.store.updateVoice(ctx.demo.tri, { x: ctx.nc(0.45) });
        }
        if (ctx.demo.sq) {
          ctx.store.updateVoice(ctx.demo.sq, { x: ctx.nc(0.5) });
        }
        if (ctx.demo.circ) {
          ctx.store.updateVoice(ctx.demo.circ, { x: ctx.nc(0.55) });
        }
        ctx.store.recomputeOverlap();
        ctx.store.updateBlend('multiply');
        ctx.render();
        ctx.playLatched();
      },
      (ctx: StepContext) => {
        ctx.store.updateBlend('difference');
        ctx.render();
        ctx.playLatched();
      },
    ],
  },

  // Borders
  {
    punchOut: ['#btn-border', '#canvas-wrap'],
    text: 'Borders add octaves.',
    play(ctx) {
      setupDemoSpatch(ctx);
      if (ctx.demo.circ) {
        ctx.selection.select(ctx.demo.circ);
        ctx.store.updateVoice(ctx.demo.circ, {
          border: { color: 'white', double: false, thickness: ctx.nc(0.3) },
        });
      }
      if (ctx.demo.tri) {
        ctx.store.updateVoice(ctx.demo.tri, {
          border: { color: 'black', double: true, thickness: ctx.nc(0.3) },
        });
      }
      ctx.render();
      ctx.playFor(2000);
    },
  },

  // Duplicate
  {
    punchOut: ['#btn-duplicate', '#canvas-wrap'],
    text: 'Twinsies!',
    play(ctx) {
      if (ctx.demo.circ) {
        ctx.selection.select(ctx.demo.circ);
        const dupe = ctx.store.duplicateVoice(ctx.demo.circ, 0.08, -0.08);
        if (dupe) {
          ctx.demo.dupe = dupe.id;
        }
      }
      ctx.render();
    },
  },

  // Delete
  {
    punchOut: ['#btn-delete', '#canvas-wrap'],
    text: 'Nonesies!',
    play(ctx) {
      if (ctx.demo.dupe) {
        ctx.selection.select(ctx.demo.dupe);
        ctx.after(600, () => {
          if (ctx.demo.dupe) {
            ctx.store.removeVoice(ctx.demo.dupe);
            ctx.demo.dupe = undefined;
            ctx.selection.clear();
            ctx.render();
          }
        });
      }
      ctx.render();
    },
  },

  // Undo/redo sequence
  {
    punchOut: ['.actions-group', '#canvas-wrap'],
    text: 'Whoopsies!',
    play: [
      (ctx: StepContext) => {
        setupDemoSpatch(ctx);
        if (ctx.demo.sq) {
          ctx.undo.snapshot();
          ctx.store.removeVoice(ctx.demo.sq);
          ctx.render();
        }
      },
      (ctx: StepContext) => {
        ctx.undo.undo();
        ctx.demo.sq = ctx.store.data.voices.find((v) => v.waveform === 'pulse')?.id;
        ctx.render();
      },
      (ctx: StepContext) => {
        ctx.undo.redo();
        ctx.render();
      },
      (ctx: StepContext) => {
        ctx.undo.undo();
        ctx.demo.sq = ctx.store.data.voices.find((v) => v.waveform === 'pulse')?.id;
        ctx.render();
      },
    ],
  },

  // Bomb — clear all
  {
    punchOut: ['#btn-new', '#canvas-wrap'],
    text: 'Empty spatch.',
    play(ctx) {
      ctx.clearVoices();
      ctx.render();
    },
  },

  // Randomize
  {
    punchOut: ['#btn-randomize', '#canvas-wrap'],
    text: 'Create a random spatch.',
    play(ctx) {
      ctx.randomize();
      ctx.store.updateScene(CHICLET_SCENE);
      const voices = ctx.store.data.voices;
      ctx.demo.tri = voices.find((v) => v.waveform === 'blend')?.id;
      ctx.demo.sq = voices.find((v) => v.waveform === 'pulse')?.id;
      ctx.demo.circ = voices.find((v) => v.waveform === 'sine')?.id;
      ctx.selection.clear();
      ctx.render();
      ctx.playFor(2000);
    },
  },

  // Harmonize
  {
    punchOut: ['#btn-harmonize', '#canvas-wrap'],
    text: 'Harmonize your shapes to a musical scale. Click for random, hold to pick one.',
    play: Array.from({ length: 3 }, () => (ctx: StepContext) => {
      ctx.harmonize();
      ctx.render();
      ctx.playFor(2000);
    }),
  },

  // Scene switching
  {
    punchOut: ['#btn-stage', '#canvas-wrap'],
    text: "Change the scenery. It'll change the whole vibe!",
    play: [CHICLET_SCENE, 3, 7].map((scene, i) => (ctx: StepContext) => {
      if (i === 0) {
        setupDemoSpatch(ctx);
      }
      ctx.store.updateScene(scene);
      ctx.render();
      ctx.playFor(2000);
    }),
  },

  // ADSR corners — each: play short, play long, reset
  {
    punchOut: '#canvas-wrap',
    textAnchor: () => canvasCornerRect('bl'),
    textCorner: 'bl',
    text: 'Attack.',
    play: [
      (ctx: StepContext) => {
        setupDemoSpatch(ctx);
        ctx.store.updateEnvelope({ attack: 0.1 });
        ctx.render();
        ctx.playFor(2000);
      },
      (ctx: StepContext) => {
        ctx.store.updateEnvelope({ attack: 1.5 });
        ctx.render();
        ctx.playFor(2000);
      },
      (ctx: StepContext) => {
        ctx.store.updateEnvelope({ attack: 0.1 });
        ctx.render();
      },
    ],
  },
  {
    punchOut: '#canvas-wrap',
    textAnchor: () => canvasCornerRect('tl'),
    textCorner: 'tl',
    text: 'Decay.',
    play: [
      (ctx: StepContext) => {
        ctx.store.updateEnvelope({ decay: 0.2 });
        ctx.render();
        ctx.playFor(2000);
      },
      (ctx: StepContext) => {
        ctx.store.updateEnvelope({ decay: 1.5 });
        ctx.render();
        ctx.playFor(2000);
      },
      (ctx: StepContext) => {
        ctx.store.updateEnvelope({ decay: 0.2 });
        ctx.render();
      },
    ],
  },
  {
    punchOut: '#canvas-wrap',
    textAnchor: () => canvasCornerRect('tr'),
    textCorner: 'tr',
    text: 'Sustain.',
    play: [
      (ctx: StepContext) => {
        ctx.store.updateEnvelope({ sustain: 0.3 });
        ctx.render();
        ctx.playFor(2000);
      },
      (ctx: StepContext) => {
        ctx.store.updateEnvelope({ sustain: 1 });
        ctx.render();
        ctx.playFor(2000);
      },
      (ctx: StepContext) => {
        ctx.store.updateEnvelope({ sustain: 0.7 });
        ctx.render();
      },
    ],
  },
  {
    punchOut: '#canvas-wrap',
    textAnchor: () => canvasCornerRect('br'),
    textCorner: 'br',
    text: 'Release.',
    play: [
      (ctx: StepContext) => {
        ctx.store.updateEnvelope({ release: 0.3 });
        ctx.render();
        ctx.playFor(2000);
      },
      (ctx: StepContext) => {
        ctx.store.updateEnvelope({ release: 2.5 });
        ctx.render();
        ctx.playFor(2000);
      },
      (ctx: StepContext) => {
        ctx.store.updateEnvelope({ release: 0.4 });
        ctx.render();
      },
    ],
  },

  // Splash
  { punchOut: '#btn-splash', text: 'Preview what your friends will see when you share.' },

  // Play button
  {
    punchOut: '#btn-play',
    text: 'Hold to play. Drag a little to start a loop. Drag a lot to lock a drone.',
  },

  // Solo button
  {
    punchOut: ['#btn-solo', '#canvas-wrap'],
    text: 'Play only the selected shape.',
    play: [
      (ctx: StepContext) => {
        setupDemoSpatch(ctx);
        if (ctx.demo.tri) {
          ctx.selection.select(ctx.demo.tri);
        }
        ctx.render();
        const soloBtn = document.querySelector<HTMLElement>('#btn-solo');
        if (soloBtn && !soloBtn.classList.contains('solo-active')) {
          soloBtn.click();
        }
        ctx.playLatched();
      },
      (_ctx: StepContext) => {
        const soloBtn = document.querySelector<HTMLElement>('#btn-solo');
        if (soloBtn && soloBtn.classList.contains('solo-active')) {
          soloBtn.click();
        }
      },
    ],
  },

  // Share button
  { punchOut: '#btn-share', text: 'My spatch. Look at it!' },
];

// ---- Pure helpers (no captured state) ----

function getPlayFns(step: TutorialStep): ((ctx: StepContext) => void)[] {
  if (!step.play) {
    return [];
  }
  return Array.isArray(step.play) ? step.play : [step.play];
}

function punchOutClip(rects: DOMRect[], pad: number): string {
  const vw = globalThis.innerWidth;
  const vh = globalThis.innerHeight;
  const cr = 8;
  let d = `M0 0H${vw}V${vh}H0Z`;
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

function tutorialSelectors(step: TutorialStep): string[] {
  return Array.isArray(step.punchOut) ? step.punchOut : [step.punchOut];
}

// ---- Tutorial engine ----

export function initTutorial(deps: TutorialDeps): TutorialHandle {
  const { audio, store, undo, selection, requestRender, showCredits } = deps;

  // ---- Build overlay DOM ----

  const overlay = document.createElement('div');
  overlay.className = 'tutorial-overlay hidden';

  const dim = document.createElement('div');
  dim.className = 'tutorial-dim';

  const textEl = document.createElement('div');
  textEl.className = 'tutorial-text';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tutorial-close';
  closeBtn.title = 'Close tutorial';
  closeBtn.innerHTML = '<svg width="20" height="20"><use href="#tabler-x" /></svg>';

  const dotsEl = document.createElement('div');
  dotsEl.className = 'tutorial-dots';
  for (let i = 0; i < steps.length; i++) {
    const dot = document.createElement('button');
    dot.className = 'tutorial-dot';
    dot.dataset.step = String(i);
    dotsEl.append(dot);
  }

  const introEl = document.createElement('div');
  introEl.className = 'tutorial-intro hidden';

  overlay.append(dim, textEl, closeBtn, dotsEl, introEl);
  document.body.append(overlay);

  const handle: TutorialHandle = {
    show,
    hide,
    get isVisible() {
      return !overlay.classList.contains('hidden');
    },
    onShow: null,
  };

  // ---- StepContext factory ----

  /** Mutable bag of demo voice IDs, persists across steps. */
  const demo: Record<string, string | undefined> = {};

  let pendingCancels: (() => void)[] = [];

  function cancelPending(): void {
    for (const fn of pendingCancels) {
      fn();
    }
    pendingCancels = [];
  }

  function createStepContext(): StepContext {
    function after(ms: number, fn: () => void): void {
      const id = setTimeout(fn, ms);
      pendingCancels.push(() => clearTimeout(id));
    }

    function loop(periodMs: number, onFrame: (t: number) => void): void {
      let cancelled = false;
      function frame(): void {
        if (cancelled) {
          return;
        }
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

    function playFor(ms: number): void {
      audio.play(store.data, store.data.envelope, getScene(store.data.scene).reverb);
      after(ms, () => audio.release(store.data.envelope));
    }

    function playLatched(): void {
      if (!audio.isPlaying) {
        audio.play(store.data, store.data.envelope, getScene(store.data.scene).reverb);
      }
    }

    function stop(): void {
      audio.stop();
    }

    function clearVoices(): void {
      const ids = store.data.voices.map((v) => v.id);
      for (const id of ids) {
        store.removeVoice(id);
      }
      selection.clear();
      for (const k of Object.keys(demo)) {
        demo[k] = undefined;
      }
    }

    function addVoice(
      key: string,
      waveform: 'sine' | 'pulse' | 'blend' | 'astroid',
      x: number,
      y: number,
    ): string {
      const v = store.addVoice(waveform, normalizedCoord(x), normalizedCoord(y));
      demo[key] = v.id;
      return v.id;
    }

    function addStamp(key: string, x: number, y: number): string {
      const v = store.addVoice('stamp', normalizedCoord(x), normalizedCoord(y));
      demo[key] = v.id;
      return v.id;
    }

    return {
      after,
      loop,
      playFor,
      playLatched,
      stop,
      store,
      selection,
      undo,
      render: requestRender,
      sine01: (t) => 0.5 - 0.5 * Math.cos(t * Math.PI * 2),
      lerp: (a, b, t) => a + (b - a) * t,
      nc: normalizedCoord,
      demo,
      clearVoices,
      addVoice,
      addStamp,
      randomize: () => randomize(store, undo),
      harmonize: () => harmonize(store, undo),
    };
  }

  // ---- State save/restore ----

  let savedState: SigilData | undefined;

  function restoreState(): void {
    if (!savedState) {
      return;
    }
    store.loadState(savedState);
    savedState = undefined;
    selection.clear();
    requestRender();
  }

  window.addEventListener('beforeunload', () => {
    if (savedState) {
      store.loadState(savedState);
    }
  });

  // ---- Step lifecycle ----

  let currentStep = 0;
  let currentSubstep = 0;

  /** Get the play functions for a step as an array. */
  function cleanupStep(): void {
    releaseTarget();
    cancelPending();
  }

  function updateDots(): void {
    const dots = dotsEl.children;
    for (let i = 0; i < dots.length; i++) {
      dots[i]!.classList.toggle('active', i === currentStep);
      dots[i]!.classList.toggle('visited', i < currentStep);
    }
  }

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
    if (overlay.classList.contains('hidden')) {
      return;
    }
    cleanupStep();
    audio.stop();
    restoreState();
    overlay.classList.remove('tutorial-locked');
    overlay.classList.add('hidden');
    introEl.classList.add('hidden');
  }

  // ---- Intro sequence ----

  function showIntroStep1(): void {
    introEl.classList.remove('hidden');
    dim.style.clipPath = '';
    textEl.style.display = 'none';
    closeBtn.style.display = 'none';
    dotsEl.style.display = 'none';

    introEl.replaceChildren();
    const p = document.createElement('p');
    p.className = 'tutorial-intro-text';
    const plain = document.createTextNode('What, not ');
    const em = document.createElement('em');
    em.textContent = 'discoverable';
    const rest = document.createTextNode(' enough for you?');
    p.append(plain, em, rest);
    const b = document.createElement('button');
    b.className = 'tutorial-intro-btn';
    b.textContent = 'No.';
    b.addEventListener('click', showIntroStep2);
    introEl.append(p, b);
  }

  function showIntroStep2(): void {
    introEl.replaceChildren();
    const p = document.createElement('p');
    p.className = 'tutorial-intro-text';
    const plain = document.createTextNode('Are you sure you want to spoil the ');
    const em = document.createElement('em');
    em.textContent = 'mystery?';
    p.append(plain, em);
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
    closeBtn.style.display = '';
    dotsEl.style.display = '';
    currentStep = 0;
    currentSubstep = 0;
    showStep(0);
  }

  // ---- Step rendering ----

  function showStep(index: number): void {
    const step = steps[index]!;
    const ctx = createStepContext();

    // Run the current substep's play function
    const fns = getPlayFns(step);
    if (fns.length > 0 && currentSubstep < fns.length) {
      fns[currentSubstep]!(ctx);
    }

    requestAnimationFrame(() => {
      const sels = tutorialSelectors(step);
      const punchRects: DOMRect[] = [];
      for (const sel of sels) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
          punchRects.push(el.getBoundingClientRect());
        }
      }

      if (punchRects.length === 0) {
        textEl.textContent = step.text;
        dim.style.clipPath = '';
        return;
      }

      dim.style.clipPath = punchOutClip(punchRects, 6);
      const textRect = step.textAnchor?.() || punchRects[0]!;
      positionText(textRect, step.textCorner);
      if (step.renderText) {
        textEl.textContent = '';
        step.renderText(textEl, ctx);
      } else {
        textEl.textContent = step.text;
      }
      updateDots();
    });
  }

  function positionText(targetRect: DOMRect, corner?: 'tl' | 'tr' | 'bl' | 'br'): void {
    const gap = 32; // 2rem

    if (corner) {
      // Measure text by placing off-screen
      textEl.style.left = '-9999px';
      textEl.style.top = '0';
      const m = textEl.getBoundingClientRect();
      const ax = targetRect.left;
      const ay = targetRect.top;
      let left: number;
      let top: number;

      switch (corner) {
        case 'bl': {
          // Attack: text BL corner → 2rem up+right of anchor
          left = ax + gap;
          top = ay - m.height - gap;
          break;
        }
        case 'tl': {
          // Decay: text TL corner → 2rem down+right of anchor
          left = ax + gap;
          top = ay + gap;
          break;
        }
        case 'tr': {
          // Sustain: text TR corner → 2rem down+left of anchor
          left = ax - m.width - gap;
          top = ay + gap;
          break;
        }
        case 'br': {
          // Release: text BR corner → 2rem up+left of anchor
          left = ax - m.width - gap;
          top = ay - m.height - gap;
          break;
        }
      }

      textEl.style.left = `${left}px`;
      textEl.style.top = `${top}px`;
      return;
    }

    // Generic: center text below anchor, clamped to viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const textW = 320;
    const textH = 80;

    let left = targetRect.left + targetRect.width / 2 - textW / 2;
    let top = targetRect.bottom + 16;

    if (top + textH > vh - 60) {
      top = targetRect.top - textH - 16;
    }

    if (top < 60) {
      top = targetRect.top + targetRect.height / 2 - textH / 2;
      if (targetRect.right + 16 + textW < vw) {
        left = targetRect.right + 16;
      } else {
        left = targetRect.left - textW - 16;
      }
    }

    left = Math.max(12, Math.min(left, vw - textW - 12));
    top = Math.max(12, Math.min(top, vh - textH - 12));

    textEl.style.left = `${left}px`;
    textEl.style.top = `${top}px`;
  }

  // ---- Navigation ----

  function advance(): void {
    const step = steps[currentStep]!;
    const fns = getPlayFns(step);

    // If there are more substeps, advance within the same step
    if (currentSubstep < fns.length - 1) {
      cleanupStep();
      currentSubstep++;
      showStep(currentStep);
      return;
    }

    // Last step entirely — finish tutorial
    if (currentStep === steps.length - 1) {
      cleanupStep();
      audio.stop();
      restoreState();
      overlay.classList.add('hidden');
      introEl.classList.add('hidden');
      showCredits();
      return;
    }

    // Move to next step
    cleanupStep();
    currentStep++;
    currentSubstep = 0;
    showStep(currentStep);
  }

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (overlay.classList.contains('tutorial-locked')) {
      return;
    }
    hide();
  });

  dotsEl.addEventListener('click', (e) => {
    if (overlay.classList.contains('tutorial-locked')) {
      return;
    }
    const dot = (e.target as HTMLElement).closest<HTMLElement>('.tutorial-dot');
    if (!dot) {
      return;
    }
    e.stopPropagation();
    const target = Number(dot.dataset.step);
    if (Number.isNaN(target) || target === currentStep) {
      return;
    }
    cleanupStep();
    currentStep = target;
    currentSubstep = 0;
    showStep(currentStep);
  });

  // ---- Target button depress effect ----

  let depressedEl: HTMLElement | null = null;

  function depressTarget(): void {
    releaseTarget();
    const step = steps[currentStep];
    if (!step) {
      return;
    }
    const sel = tutorialSelectors(step)[0];
    if (!sel) {
      return;
    }
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) {
      return;
    }
    el.classList.add('active');
    depressedEl = el;
  }

  function releaseTarget(): void {
    if (depressedEl) {
      depressedEl.classList.remove('active');
      depressedEl = null;
    }
  }

  function isNavClick(e: Event): boolean {
    const t = e.target as Node;
    if (closeBtn.contains(t) || dotsEl.contains(t)) {
      return true;
    }
    const el = t instanceof Element ? t : t.parentElement;
    return Boolean(el?.closest('[data-tutorial-interactive]'));
  }

  overlay.addEventListener('pointerdown', (e) => {
    if (overlay.classList.contains('tutorial-locked')) {
      return;
    }
    if (isNavClick(e)) {
      return;
    }
    if (!introEl.classList.contains('hidden')) {
      return;
    }
    depressTarget();
  });

  overlay.addEventListener('pointerup', (e) => {
    releaseTarget();
    if (overlay.classList.contains('tutorial-locked')) {
      return;
    }
    if (isNavClick(e)) {
      return;
    }
    if (!introEl.classList.contains('hidden')) {
      return;
    }
    advance();
  });

  overlay.addEventListener('pointerleave', () => {
    releaseTarget();
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (
      e.key === 'Escape' &&
      !overlay.classList.contains('hidden') &&
      !overlay.classList.contains('tutorial-locked')
    ) {
      hide();
    }
  });

  // Repaint punch-out overlay on resize so clip paths track element positions.
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('resize', () => {
    if (overlay.classList.contains('hidden')) {
      return;
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => showStep(currentStep), 2000);
  });

  return handle;
}
