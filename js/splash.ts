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
  private readonly landscapeMql: MediaQueryList;
  private readonly handleLandscapeChange: (e: MediaQueryListEvent | MediaQueryList) => void;
  private landscapeBlock: HTMLElement | undefined;

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
    this.landscapeMql = matchMedia('(orientation: landscape) and (max-height: 500px)');
    this.handleLandscapeChange = (e: MediaQueryListEvent | MediaQueryList) => {
      this.onLandscapeChange(e.matches);
    };
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

  /** Start monitoring for cramped landscape orientation. */
  bindLandscapeLock(): void {
    this.landscapeBlock = document.getElementById('landscape-block') ?? undefined;
    this.landscapeMql.addEventListener('change', this.handleLandscapeChange as EventListener);
    // Check initial state
    this.handleLandscapeChange(this.landscapeMql);
  }

  /** Remove all splash event listeners. */
  dispose(): void {
    this.removeSplashListeners();
    this.landscapeMql.removeEventListener('change', this.handleLandscapeChange as EventListener);
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
    // Don't dismiss splash in cramped landscape
    if (this.landscapeMql.matches) return;
    this.splashPointerDown = false;
    this.removeSplashListeners();

    // iOS Safari only unlocks audio from touchend/click — NOT pointerup.
    // Warm up + start playback here so AudioContext init happens in a
    // gesture that Safari accepts.
    this.audio.warmUp();
    const playReady = this.playback.start();

    const elapsed = Date.now() - this.splashDownTime;
    const remaining = Math.max(0, MIN_SUSTAIN_MS - elapsed);

    // Audio sustains for remainder, then toolbars fade in after release.
    this.splashReveal(remaining, playReady);
  }

  private onLandscapeChange(isCrampedLandscape: boolean): void {
    if (isCrampedLandscape) {
      // Landscape lock: hide toolbars entirely (not just opacity) so tile fills viewport
      this._isActive = true;
      document.body.classList.add('landscape-locked');
      document.body.classList.remove('is-editing');
      if (this.landscapeBlock) {
        this.landscapeBlock.classList.remove('hidden');
        this.landscapeBlock.setAttribute('aria-hidden', 'false');
      }
    } else {
      document.body.classList.remove('landscape-locked');
      if (this.landscapeBlock) {
        this.landscapeBlock.classList.add('hidden');
        this.landscapeBlock.setAttribute('aria-hidden', 'true');
      }
      // If user already dismissed splash before rotating, restore editing
      if (localStorage.getItem(this.splashKey)) {
        this._isActive = false;
        document.body.classList.add('is-editing');
      }
      // Otherwise, keep splash active — normal dismiss flow applies
    }
  }

  private splashReveal(delayAudioRelease: number, playReady: Promise<void>): void {
    const FADE_DURATION = 0.5;
    const topBar = qel('#toolbar-top');
    const botBar = qel('#toolbar-bottom');

    // Mark URL as seen immediately (even though UI isn't visible yet)
    this._isActive = false;
    localStorage.setItem(this.splashKey, '1');

    const doRelease = async () => {
      try {
        await playReady;
      } catch {}
      if (!this.audio.isPlaying) {
        this.playback.forceStop();
        this.revealToolbars(topBar, botBar, FADE_DURATION);
        return;
      }
      const releaseMs = this.playback.releaseAndIdle();
      // Start fade partway through the release so it overlaps with the audible tail
      const fadeDelay = releaseMs * 0.3;
      const fadeDuration = Math.max(FADE_DURATION, (releaseMs - fadeDelay) / 1000);
      setTimeout(() => {
        this.revealToolbars(topBar, botBar, fadeDuration);
      }, fadeDelay);
    };

    if (delayAudioRelease > 0) {
      setTimeout(doRelease, delayAudioRelease);
    } else {
      doRelease();
    }

    this.removeSplashListeners();
  }

  private revealToolbars(topBar: HTMLElement, botBar: HTMLElement, duration: number): void {
    topBar.style.transitionDuration = `${duration}s`;
    botBar.style.transitionDuration = `${duration}s`;
    document.body.classList.add('is-editing');

    topBar.addEventListener(
      'transitionend',
      () => {
        topBar.style.transitionDuration = '';
        botBar.style.transitionDuration = '';
      },
      { once: true },
    );
  }

  private removeSplashListeners(): void {
    this.stage.removeEventListener('pointerdown', this.handleDown);
    this.stage.removeEventListener('touchend', this.handleUp);
    this.stage.removeEventListener('click', this.handleUp);
  }
}
