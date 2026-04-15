// Splash.ts — Splash screen controller
//
// State machine with three modes: off (editor active), splash (overlay
// Intercepts pointer events, click plays + reveals), landscape (tap-to-play,
// Never reveals editor). A DOM overlay structurally blocks pointer events —
// No isSplashActive flag threading needed in other modules.
//
// "Seen" state is tracked per-URL in sessionStorage (single key, capped array).
// The homepage (/) never splashes. iOS Safari audio unlock constraints apply
// To the overlay's event handlers — see CLAUDE.md for details.

import type { AudioEngine } from './audio/engine.ts';
import { qel } from './dom.ts';
import type { PlaybackController } from './playback.ts';
import type { SigilStore } from './state.ts';
import { decodeStampSamples } from './voices/stamp/lifecycle.ts';

// ---- Seen storage ----

const SEEN_KEY = 'spatch-seen';
const SEEN_MAX = 100;

function getSeenList(): string[] {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isSeen(pathname: string): boolean {
  return getSeenList().includes(pathname);
}

function markSeen(pathname: string): void {
  const list = getSeenList();
  if (list.includes(pathname)) {
    return;
  }
  list.push(pathname);
  while (list.length > SEEN_MAX) {
    list.shift();
  }
  sessionStorage.setItem(SEEN_KEY, JSON.stringify(list));
}

// Exported for testing
export { getSeenList as _getSeenList, markSeen as _markSeen, isSeen as _isSeen };

// ---- Constants ----

const MIN_SUSTAIN_MS = 2000;

// ---- State type ----

type SplashState = 'off' | 'splash' | 'landscape';

// ---- Controller ----

/**
 * Splash screen controller. Uses a pointer-intercepting overlay to gate
 * interaction during splash/landscape modes. No other module needs splash
 * awareness — pointer blocking is structural (DOM layering).
 */
export class SplashController {
  private readonly audio: AudioEngine;
  private readonly store: SigilStore;
  private readonly playback: PlaybackController;
  private readonly overlay: HTMLElement;
  private readonly landscapeBlock: HTMLElement | undefined;
  private readonly landscapeMql: MediaQueryList;

  private state: SplashState;
  private preview = false;
  private splashDownTime = 0;
  private splashPointerDown = false;

  // Bound handlers
  private readonly handleDown: (e: PointerEvent) => void;
  private readonly handleUp: () => void;
  private readonly handleLandscapeChange: (e: MediaQueryListEvent | MediaQueryList) => void;

  constructor(deps: {
    store: SigilStore;
    audio: AudioEngine;
    playback: PlaybackController;
    overlay: HTMLElement;
  }) {
    this.store = deps.store;
    this.audio = deps.audio;
    this.playback = deps.playback;
    this.overlay = deps.overlay;
    this.landscapeBlock = document.getElementById('landscape-block') ?? undefined;

    // Determine initial state
    const pathname = location.pathname;
    const isHomepage = pathname === '/';
    if (isHomepage || isSeen(pathname)) {
      this.state = 'off';
    } else {
      this.state = 'splash';
    }

    this.applyState();

    this.handleDown = (e: PointerEvent) => this.onPointerDown(e);
    this.handleUp = () => this.onPointerUp();
    this.landscapeMql = matchMedia('(orientation: landscape) and (max-height: 500px)');
    this.handleLandscapeChange = (e: MediaQueryListEvent | MediaQueryList) => {
      this.onLandscapeChange(e.matches);
    };
  }

  /** Whether the splash overlay is currently blocking interaction. */
  get isActive(): boolean {
    return this.state !== 'off';
  }

  /** Bind overlay listeners and start landscape monitoring. */
  bindEvents(): void {
    this.overlay.addEventListener('pointerdown', this.handleDown);
    // IOS Safari: touchend/click are qualifying gestures for audio unlock.
    // Do NOT use pointerup — it fires before touchend on iOS.
    this.overlay.addEventListener('touchend', this.handleUp);
    this.overlay.addEventListener('click', this.handleUp);

    this.landscapeMql.addEventListener('change', this.handleLandscapeChange as EventListener);
    this.handleLandscapeChange(this.landscapeMql);
  }

  /** Enter splash mode for preview (no effect on seen state). */
  enterPreview(): void {
    this.preview = true;
    this.state = 'splash';
    this.applyState();
  }

  /** Clean up listeners. */
  dispose(): void {
    this.overlay.removeEventListener('pointerdown', this.handleDown);
    this.overlay.removeEventListener('touchend', this.handleUp);
    this.overlay.removeEventListener('click', this.handleUp);
    this.landscapeMql.removeEventListener('change', this.handleLandscapeChange as EventListener);
  }

  // ---- Private ----

  private applyState(): void {
    if (this.state === 'off') {
      this.overlay.style.display = 'none';
      document.body.classList.add('is-editing');
      document.body.classList.remove('landscape-locked');
      if (this.landscapeBlock) {
        this.landscapeBlock.classList.add('hidden');
        this.landscapeBlock.setAttribute('aria-hidden', 'true');
      }
    } else if (this.state === 'splash') {
      this.overlay.style.display = '';
      document.body.classList.remove('is-editing');
      document.body.classList.remove('landscape-locked');
      if (this.landscapeBlock) {
        this.landscapeBlock.classList.add('hidden');
        this.landscapeBlock.setAttribute('aria-hidden', 'true');
      }
    } else {
      // Landscape
      this.overlay.style.display = '';
      document.body.classList.remove('is-editing');
      document.body.classList.add('landscape-locked');
      if (this.landscapeBlock) {
        this.landscapeBlock.classList.remove('hidden');
        this.landscapeBlock.setAttribute('aria-hidden', 'false');
      }
    }
  }

  private onPointerDown(_e: PointerEvent): void {
    if (this.splashPointerDown) {
      return;
    } // Ignore multi-touch
    this.splashPointerDown = true;
    this.splashDownTime = Date.now();
    // Do NOT preventDefault() — iOS Safari cancels click/touchend if we do,
    // And those are the only events that can unlock audio.
  }

  private async onPointerUp(): Promise<void> {
    if (!this.splashPointerDown) {
      return;
    }
    this.splashPointerDown = false;

    // IOS Safari only unlocks audio from touchend/click — NOT pointerup.
    // warmUp() must run synchronously in the gesture handler to unlock
    // the AudioContext; awaits after this point are safe.
    this.audio.warmUp();

    // Decode stamp samples before playback — bytes were prefetched at page
    // load, so this is just the AudioBuffer decode step.
    if (this.audio.audioCtx) {
      await decodeStampSamples(this.audio.audioCtx).catch(() => {});
    }

    if (this.state === 'landscape') {
      this.playAndRelease();
      return;
    }

    // Splash state — play, then reveal
    const playReady = this.playback.start();
    const elapsed = Date.now() - this.splashDownTime;
    const remaining = Math.max(0, MIN_SUSTAIN_MS - elapsed);
    this.splashReveal(remaining, playReady);
  }

  private playAndRelease(): void {
    const ready = this.playback.start();
    const elapsed = Date.now() - this.splashDownTime;
    const remaining = Math.max(0, MIN_SUSTAIN_MS - elapsed);
    setTimeout(async () => {
      try {
        await ready;
      } catch {}
      if (this.audio.isPlaying) {
        this.playback.releaseAndIdle();
      }
    }, remaining);
  }

  private splashReveal(delayAudioRelease: number, playReady: Promise<void>): void {
    const FADE_DURATION = 0.5;
    const topBar = qel('#toolbar-top');
    const botBar = qel('#toolbar-bottom');

    // Mark as seen (unless this is a preview)
    if (!this.preview) {
      markSeen(location.pathname);
    }
    this.preview = false;

    const doRelease = async () => {
      try {
        await playReady;
      } catch {}
      if (!this.audio.isPlaying) {
        this.playback.forceStop();
        this.transitionToOff(topBar, botBar, FADE_DURATION);
        return;
      }
      const releaseMs = this.playback.releaseAndIdle();
      const fadeDelay = releaseMs * 0.3;
      const fadeDuration = Math.max(FADE_DURATION, (releaseMs - fadeDelay) / 1000);
      setTimeout(() => {
        this.transitionToOff(topBar, botBar, fadeDuration);
      }, fadeDelay);
    };

    if (delayAudioRelease > 0) {
      setTimeout(doRelease, delayAudioRelease);
    } else {
      doRelease();
    }
  }

  private transitionToOff(topBar: HTMLElement, botBar: HTMLElement, duration: number): void {
    topBar.style.transitionDuration = `${duration}s`;
    botBar.style.transitionDuration = `${duration}s`;

    this.state = 'off';
    this.applyState();

    topBar.addEventListener(
      'transitionend',
      () => {
        topBar.style.transitionDuration = '';
        botBar.style.transitionDuration = '';
      },
      { once: true },
    );
  }

  private onLandscapeChange(isCrampedLandscape: boolean): void {
    if (isCrampedLandscape) {
      this.state = 'landscape';
      this.applyState();
    } else {
      if (this.state === 'landscape') {
        const pathname = location.pathname;
        const isHomepage = pathname === '/';
        if (isHomepage || isSeen(pathname)) {
          this.state = 'off';
        } else {
          this.state = 'splash';
        }
        this.applyState();
      }
    }
  }
}
