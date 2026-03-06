// splash.ts — First-load splash screen controller
//
// Handles the splash overlay shown on first visit: press-and-hold to reveal
// the app while hearing the current sigil. iOS Safari audio unlock constraints
// are critical here — see CLAUDE.md for details.

import type { AudioEngine } from './audio/engine.ts';
import { qel } from './dom.ts';
import type { PlaybackController } from './playback.ts';

// Minimum time the audio plays before releasing after splash dismiss
const MIN_SUSTAIN_MS = 2000;

/**
 * First-load splash screen controller. Shows a press-and-hold overlay on first
 * visit; dismissing it unlocks iOS Safari audio and reveals the app with a fade.
 */
export class SplashController {
  private readonly stage: HTMLElement;
  private readonly audio: AudioEngine;
  private readonly playback: PlaybackController;
  private readonly splashKey: string;
  private _isActive: boolean;
  private splashDownTime = 0;
  private splashPointerDown = false;

  // Bound handlers for cleanup
  private readonly handleDown: (e: PointerEvent) => void;
  private readonly handleUp: () => void;

  constructor(deps: { stage: HTMLElement; audio: AudioEngine; playback: PlaybackController }) {
    this.stage = deps.stage;
    this.audio = deps.audio;
    this.playback = deps.playback;

    this.splashKey = `spatch-seen:${location.pathname}${location.hash}`;
    this._isActive = !localStorage.getItem(this.splashKey);

    if (!this._isActive) {
      document.body.classList.add('is-editing');
    }

    // Pre-bind handlers so we can remove them later
    this.handleDown = (e: PointerEvent) => this.splashDown(e);
    this.handleUp = () => this.splashUp();
  }

  /** Whether the splash screen is currently displayed. */
  get isActive(): boolean {
    return this._isActive;
  }

  /** Reset the "seen" flag so the splash shows again on next load. */
  resetSeen(): void {
    localStorage.removeItem(this.splashKey);
  }

  /** Attach pointerdown/touchend/click listeners for splash interaction. */
  bindEvents(): void {
    if (!this._isActive) return;

    this.stage.addEventListener('pointerdown', this.handleDown);
    // iOS Safari: touchend is the qualifying gesture for audio unlock.
    // Desktop fallback: click fires after pointerup on non-touch devices.
    // Do NOT use pointerup — it fires before touchend on iOS, racing the
    // audio unlock and leaving the AudioContext suspended.
    this.stage.addEventListener('touchend', this.handleUp);
    this.stage.addEventListener('click', this.handleUp);
  }

  /** Remove all splash event listeners. */
  dispose(): void {
    this.removeSplashListeners();
  }

  // ---- Private ----

  private splashDown(_e: PointerEvent): void {
    if (this.splashPointerDown) return; // Ignore multi-touch
    this.splashPointerDown = true;
    this.splashDownTime = Date.now();
    // Do NOT preventDefault() — iOS Safari cancels click/touchend if we do,
    // and those are the only events that can unlock audio.
  }

  private splashUp(): void {
    if (!this.splashPointerDown) return;
    this.splashPointerDown = false;
    this.removeSplashListeners();

    // iOS Safari only unlocks audio from touchend/click — NOT pointerup.
    // Warm up + start playback here so AudioContext init happens in a
    // gesture that Safari accepts.
    this.audio.warmUp();
    const playReady = this.playback.start();

    const elapsed = Date.now() - this.splashDownTime;
    const remaining = Math.max(0, MIN_SUSTAIN_MS - elapsed);

    // Always reveal UI immediately; audio sustains for remainder if needed.
    // Pass the playback promise so release waits for play() to finish.
    this.splashReveal(remaining, playReady);
  }

  private splashReveal(delayAudioRelease: number, playReady: Promise<void>): void {
    const FADE_DURATION = 0.5;
    const topBar = qel('#toolbar-top');
    const botBar = qel('#toolbar-bottom');

    // Fast fixed fade — starts immediately, eases out
    topBar.style.transitionDuration = `${FADE_DURATION}s`;
    botBar.style.transitionDuration = `${FADE_DURATION}s`;

    // Add editing class — triggers CSS opacity transition right away
    document.body.classList.add('is-editing');
    this._isActive = false;

    // Mark URL as seen
    localStorage.setItem(this.splashKey, '1');

    // Release audio: wait for play() to finish first, otherwise release()
    // fires while isPlaying is still false and becomes a no-op.
    const doRelease = async () => {
      try {
        await playReady;
      } catch {}
      // If play() somehow didn't complete, force stop as fallback
      if (!this.audio.isPlaying) {
        this.playback.forceStop();
        return;
      }
      this.playback.releaseAndIdle();
    };

    if (delayAudioRelease > 0) {
      setTimeout(doRelease, delayAudioRelease);
    } else {
      doRelease();
    }

    // Clean up inline transition-duration after transition ends
    topBar.addEventListener(
      'transitionend',
      () => {
        topBar.style.transitionDuration = '';
        botBar.style.transitionDuration = '';
      },
      { once: true },
    );

    this.removeSplashListeners();
  }

  private removeSplashListeners(): void {
    this.stage.removeEventListener('pointerdown', this.handleDown);
    this.stage.removeEventListener('touchend', this.handleUp);
    this.stage.removeEventListener('click', this.handleUp);
  }
}
