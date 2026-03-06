// playback.ts — Play state machine, fan gesture, loop scheduling

import type { AudioEngine } from './audio/engine.ts';
import type { SigilData } from './types.ts';
import { qel, svgEl } from './dom.ts';

// ---- Play fan gesture constants ----

const LOCK_MIN = 35;
const LOCK_MAX = 70;
const LOOP_MIN = 70;
const LOOP_RANGE = 130;
const LOOP_MS_MIN = 100;
const LOOP_MS_MAX = 2000;
const FAN_DELAY_MS = 250;

// ---- Types ----

/** Playback state: idle (not playing), latched (sustaining), or looping (auto-repeating). */
export type PlayMode = 'idle' | 'latched' | 'looping';

// ---- PlaybackController ----

/**
 * Play state machine and fan gesture handler. Manages play/stop/latch/loop
 * modes, the play button fan menu (drag down for latch or loop), and loop
 * scheduling with envelope-aware restart timing.
 */
export class PlaybackController {
  private audio: AudioEngine;
  private getState: () => SigilData;
  private requestRender: () => void;

  // DOM elements (queried once in constructor)
  private playBtn: HTMLElement;
  private playFan: HTMLElement;
  private fanLock: HTMLElement;
  private fanLoop: HTMLElement;
  private playModeLock: HTMLElement;
  private playModeLoop: HTMLElement;

  // Play state
  private playState: PlayMode = 'idle';
  private gestureActive = false;
  private gestureTimerId: ReturnType<typeof setTimeout> | undefined;
  private gesturePointerId: number | undefined;
  private lastFanInfo: { zone: string; ms?: number; pull?: number } | undefined;
  private loopHoldMs = 500;
  private loopTimeoutId: ReturnType<typeof setTimeout> | undefined;
  private loopCycleStart = 0;
  private loopCycleDuration = 0;
  private releaseGlowTimeoutId: ReturnType<typeof setTimeout> | undefined;
  private playGeneration = 0;

  constructor(deps: { audio: AudioEngine; getState: () => SigilData; requestRender: () => void }) {
    this.audio = deps.audio;
    this.getState = deps.getState;
    this.requestRender = deps.requestRender;

    // DOM queries — these elements have known IDs in index.html
    this.playBtn = qel('#btn-play');
    this.playFan = qel('#play-fan');
    this.fanLock = qel('.fan-lock', this.playFan);
    this.fanLoop = qel('.fan-loop', this.playFan);
    this.playModeLock = qel('#play-mode-lock');
    this.playModeLoop = qel('#play-mode-loop');
  }

  /** Current play mode (idle, latched, or looping). */
  get mode(): PlayMode {
    return this.playState;
  }

  /** True when audio is actively playing (latched or looping). */
  get isPlaying(): boolean {
    return this.playState !== 'idle';
  }

  /** Called from render loop to update loop progress indicator. */
  renderTick(): void {
    if (this.playState === 'looping' && this.loopCycleDuration > 0) {
      const elapsed = performance.now() - this.loopCycleStart;
      const progress = Math.min(1, elapsed / this.loopCycleDuration);
      this.playBtn.style.setProperty('--loop-progress', `${(progress * 100).toFixed(1)}%`);
    }
  }

  /** Set mode to latched (stays playing until explicitly stopped). */
  latch(): void {
    this.playState = 'latched';
    this.updatePlayIndicators();
  }

  // ---- Play/stop ----

  /** Start playback with the current sigil state and envelope. */
  async start(): Promise<void> {
    if (this.releaseGlowTimeoutId != undefined) {
      clearTimeout(this.releaseGlowTimeoutId);
      this.releaseGlowTimeoutId = undefined;
    }
    const gen = this.playGeneration;
    const state = this.getState();
    await this.audio.play(state, state.envelope);
    if (gen !== this.playGeneration) {
      // Cancelled during async init — stop audio that just started
      this.audio.stop();
      return;
    }
    this.playBtn.classList.add('playing');
    this.setPlayIcon(true);
    this.requestRender();
  }

  /** Stop playback with envelope release, cancel any active loop. */
  stop(): void {
    this.playGeneration++;
    if (this.loopTimeoutId != undefined) {
      clearTimeout(this.loopTimeoutId);
      this.loopTimeoutId = undefined;
    }
    const state = this.getState();
    this.audio.release(state.envelope);
    this.playBtn.classList.remove('playing', 'looping');
    this.playBtn.style.setProperty('--loop-progress', '0%');
    this.setPlayIcon(false);
    this.playState = 'idle';
    this.updatePlayIndicators();
    const releaseMs = state.envelope.release * 1000 + 100;
    this.releaseGlowTimeoutId = setTimeout(() => {
      this.releaseGlowTimeoutId = undefined;
      this.requestRender();
    }, releaseMs);
  }

  /**
   * Force-stop without envelope release. Used during splash reveal
   * when play() didn't complete or audio isn't actually playing.
   */
  forceStop(): void {
    this.audio.stop();
    this.playBtn.classList.remove('playing');
    this.setPlayIcon(false);
    this.playState = 'idle';
  }

  /**
   * Release with envelope (for splash reveal where we want the tail).
   * Schedules a glow timeout like stop() but doesn't cancel loops.
   */
  releaseAndIdle(): void {
    const state = this.getState();
    this.audio.release(state.envelope);
    this.playBtn.classList.remove('playing');
    this.setPlayIcon(false);
    this.playState = 'idle';
    const releaseMs = state.envelope.release * 1000 + 100;
    this.releaseGlowTimeoutId = setTimeout(() => {
      this.releaseGlowTimeoutId = undefined;
      this.requestRender();
    }, releaseMs);
  }

  // ---- Bind play button events ----

  /** Wire up play button pointer events for tap-to-play and drag-to-latch/loop gestures. */
  bindEvents(): void {
    this.playBtn.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      // Eagerly warm up AudioContext — even though pointerdown isn't a qualifying
      // gesture on iOS Safari, creating the context now means it's ready when
      // touchend/click fires and actually unlocks it.
      this.audio.warmUp();

      // If already playing (latched or looping), stop
      if (this.playState !== 'idle') {
        this.stop();
        return;
      }

      if (this.getState().voices.length === 0) {
        return;
      }

      this.gesturePointerId = e.pointerId;
      this.lastFanInfo = undefined;
      this.playBtn.setPointerCapture(e.pointerId);

      // Set up gesture tracking synchronously -- before audio init
      this.gestureTimerId = setTimeout(() => {
        this.gestureTimerId = undefined;
        if (this.gesturePointerId != undefined) {
          this.openFan();
        }
      }, FAN_DELAY_MS);

      // Track early drag to open fan immediately
      const earlyMove = (me: PointerEvent) => {
        if (me.pointerId !== this.gesturePointerId) {
          return;
        }
        const r = this.playBtn.getBoundingClientRect();
        const dy = me.clientY - (r.top + r.height / 2); // Positive = below button
        if (dy > 10 && this.gestureTimerId != undefined) {
          clearTimeout(this.gestureTimerId);
          this.gestureTimerId = undefined;
          this.openFan();
          this.playBtn.removeEventListener('pointermove', earlyMove);
        }
      };
      this.playBtn.addEventListener('pointermove', earlyMove);

      // Clean up early-move listener once gesture ends
      const cleanup = () => {
        this.playBtn.removeEventListener('pointermove', earlyMove);
        this.playBtn.removeEventListener('pointerup', cleanup);
        this.playBtn.removeEventListener('lostpointercapture', cleanup);
      };
      this.playBtn.addEventListener('pointerup', cleanup, { once: true });
      this.playBtn.addEventListener('lostpointercapture', cleanup, { once: true });

      // Start audio (non-blocking -- gesture is already wired)
      this.start();
    });

    this.playBtn.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.gestureActive || e.pointerId !== this.gesturePointerId) {
        return;
      }

      const info = this.fanZone(e.clientY);
      this.lastFanInfo = info;

      this.fanLock.classList.toggle('hot', info.zone === 'lock');

      if (info.zone === 'loop') {
        this.fanLoop.classList.add('hot', 'dragging');
        this.fanLoop.style.transform = `translateY(${info.pull}px)`;
      } else {
        this.fanLoop.classList.remove('hot', 'dragging');
        this.fanLoop.style.transform = '';
      }
    });

    this.playBtn.addEventListener('pointerup', (e: PointerEvent) => {
      if (e.pointerId !== this.gesturePointerId) {
        return;
      }

      if (this.gestureTimerId != undefined) {
        clearTimeout(this.gestureTimerId);
        this.gestureTimerId = undefined;
      }

      if (!this.gestureActive) {
        // Quick click -- normal release
        this.stop();
        this.closeFan();
        this.gesturePointerId = undefined;
        return;
      }

      // Use the last tracked zone from pointermove -- avoids drift during finger lift.
      // Fall back to computing from the pointerup position if no move was recorded.
      const info = this.lastFanInfo || this.fanZone(e.clientY);

      if (info.zone === 'lock') {
        this.playState = 'latched';
        this.updatePlayIndicators();
      } else if (info.zone === 'loop') {
        this.loopHoldMs = info.ms!;
        this.playState = 'looping';
        this.updatePlayIndicators();
        this.scheduleLoopRestart();
      } else {
        // Released back on button
        this.stop();
      }

      this.closeFan();
      this.gesturePointerId = undefined;
    });

    this.playBtn.addEventListener('lostpointercapture', (e: PointerEvent) => {
      // Pointerup already handled this gesture
      if (this.gesturePointerId == undefined) {
        return;
      }
      if (e.pointerId !== this.gesturePointerId) {
        return;
      }

      if (this.gestureTimerId != undefined) {
        clearTimeout(this.gestureTimerId);
        this.gestureTimerId = undefined;
      }

      if (this.audio.isPlaying && this.playState === 'idle') {
        this.stop();
      }
      this.closeFan();
      this.gesturePointerId = undefined;
    });
  }

  /** Clear all pending timers (loop, glow, gesture). */
  dispose(): void {
    if (this.loopTimeoutId != undefined) {
      clearTimeout(this.loopTimeoutId);
    }
    if (this.releaseGlowTimeoutId != undefined) {
      clearTimeout(this.releaseGlowTimeoutId);
    }
    if (this.gestureTimerId != undefined) {
      clearTimeout(this.gestureTimerId);
    }
  }

  // ---- Private helpers ----

  private updatePlayIndicators(): void {
    this.playModeLock.classList.toggle('hidden', this.playState !== 'latched');
    this.playModeLoop.classList.toggle('hidden', this.playState !== 'looping');
  }

  // Icon reference for sprite scanner: #tabler-player-stop-filled
  private setPlayIcon(playing: boolean): void {
    const symbol = playing ? 'tabler-player-stop-filled' : 'tabler-player-play-filled';
    const svg = svgEl('svg', { width: 20, height: 20 }, svgEl('use', { href: `#${symbol}` }));
    svg.classList.add('play-icon');
    this.playBtn.querySelector('.play-icon')!.replaceWith(svg);
  }

  private scheduleLoopRestart(): void {
    const env = this.getState().envelope;
    const releaseMs = env.release * 1000;

    this.loopCycleDuration = this.loopHoldMs + releaseMs + 50;
    this.loopCycleStart = performance.now();
    this.playBtn.classList.add('looping');

    this.loopTimeoutId = setTimeout(() => {
      this.audio.release(this.getState().envelope);
      this.loopTimeoutId = setTimeout(() => {
        if (this.playState === 'looping') {
          this.loopCycleStart = performance.now();
          this.start();
          this.scheduleLoopRestart();
        }
      }, releaseMs + 50);
    }, this.loopHoldMs);
  }

  private fanZone(clientY: number): { zone: string; ms?: number; pull?: number } {
    const r = this.playBtn.getBoundingClientRect();
    const dy = clientY - (r.top + r.height / 2); // Positive = below button
    if (dy < LOCK_MIN) {
      return { zone: 'button' };
    }
    if (dy < LOCK_MAX) {
      return { zone: 'lock' };
    }
    const t = Math.min(1, Math.max(0, (dy - LOOP_MIN) / LOOP_RANGE));
    const ms = Math.round((LOOP_MS_MIN + t * (LOOP_MS_MAX - LOOP_MS_MIN)) / 50) * 50;
    return { ms, pull: Math.max(0, dy - LOOP_MIN), zone: 'loop' };
  }

  private openFan(): void {
    this.gestureActive = true;
    this.playFan.classList.add('open');
  }

  private closeFan(): void {
    this.gestureActive = false;
    this.lastFanInfo = undefined;
    this.playFan.classList.remove('open');
    this.fanLock.classList.remove('hot');
    this.fanLoop.classList.remove('hot', 'dragging');
    this.fanLoop.style.transform = '';
  }
}
