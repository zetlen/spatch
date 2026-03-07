// playback.ts — Play state machine, radial gesture, loop scheduling

import type { AudioEngine } from './audio/engine.ts';
import type { SigilData } from './types.ts';
import { qel, svgEl } from './dom.ts';

// ---- Radial gesture constants ----

const LOOP_MS_MIN = 100;
const LOOP_MS_MAX = 2000;
const OVERLAY_DELAY_MS = 1000;

// ---- Types ----

/** Playback state: idle (not playing), latched (sustaining), or looping (auto-repeating). */
export type PlayMode = 'idle' | 'latched' | 'looping';

// ---- PlaybackController ----

/**
 * Play state machine and radial gesture handler. Manages play/stop/latch/loop
 * modes via a radial overlay (drag distance from button center selects mode),
 * and loop scheduling with envelope-aware restart timing.
 */
export class PlaybackController {
  private audio: AudioEngine;
  private getState: () => SigilData;
  private requestRender: () => void;
  private isSplashActive: () => boolean;

  // DOM elements
  private playBtn: HTMLElement;
  private radialOverlay: HTMLElement;
  private ringFill: SVGCircleElement;
  private modeBadge: HTMLElement;

  // Zone elements (created once in constructor)
  private pointerZoneIcon: HTMLElement | undefined;
  private zoneBorderCircle: SVGCircleElement | undefined;
  private pointerRadiusCircle: SVGCircleElement | undefined;

  // ring r=31 in SVG viewBox units, circumference = 2*PI*31
  private static readonly RING_CIRCUMFERENCE = 2 * Math.PI * 31;
  private static readonly LATCH_MARGIN = 0.3;

  // Play state
  private playState: PlayMode = 'idle';
  private gesturePointerId: number | undefined;
  private gestureActive = false;
  private overlayTimerId: ReturnType<typeof setTimeout> | undefined;
  private lastZoneInfo: { zone: string; ms?: number } | undefined;
  private loopHoldMs = 500;
  private loopTimeoutId: ReturnType<typeof setTimeout> | undefined;
  private loopCycleStart = 0;
  private loopCycleDuration = 0;
  private releaseGlowTimeoutId: ReturnType<typeof setTimeout> | undefined;
  private playGeneration = 0;

  // Overlay geometry (computed on pointerdown)
  private overlayCenterX = 0;
  private overlayCenterY = 0;
  private overlayInnerRadius = 0;
  private overlayLatchStart = 0;
  private overlayMaxDist = 0;

  constructor(deps: {
    audio: AudioEngine;
    getState: () => SigilData;
    requestRender: () => void;
    isSplashActive: () => boolean;
  }) {
    this.audio = deps.audio;
    this.getState = deps.getState;
    this.requestRender = deps.requestRender;
    this.isSplashActive = deps.isSplashActive;

    this.playBtn = qel('#btn-play');
    this.radialOverlay = qel('#radial-overlay');
    this.ringFill = qel<SVGCircleElement>('.play-ring-fill', this.playBtn);
    this.modeBadge = qel('.play-mode-badge', this.playBtn);

    this.createZoneElements();
  }

  /** Current play mode (idle, latched, or looping). */
  get mode(): PlayMode {
    return this.playState;
  }

  /** True when audio is actively playing (latched or looping). */
  get isPlaying(): boolean {
    return this.playState !== 'idle';
  }

  /** Called from render loop to update loop progress ring. */
  renderTick(): void {
    if (this.playState === 'looping' && this.loopCycleDuration > 0) {
      const elapsed = performance.now() - this.loopCycleStart;
      const progress = Math.min(1, elapsed / this.loopCycleDuration);
      const offset = PlaybackController.RING_CIRCUMFERENCE * (1 - progress);
      this.ringFill.style.strokeDashoffset = `${offset}`;
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
    this.ringFill.style.strokeDashoffset = `${PlaybackController.RING_CIRCUMFERENCE}`;
    this.playBtn.classList.remove('playing', 'latched', 'looping');
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
    this.updatePlayIndicators();
  }

  /**
   * Release with envelope (for splash reveal where we want the tail).
   * Schedules a glow timeout like stop() but doesn't cancel loops.
   */
  releaseAndIdle(): number {
    const state = this.getState();
    this.audio.release(state.envelope);
    this.playBtn.classList.remove('playing');
    this.setPlayIcon(false);
    this.playState = 'idle';
    this.updatePlayIndicators();
    const releaseMs = state.envelope.release * 1000 + 100;
    this.releaseGlowTimeoutId = setTimeout(() => {
      this.releaseGlowTimeoutId = undefined;
      this.requestRender();
    }, releaseMs);
    return releaseMs;
  }

  // ---- Bind play button events ----

  /** Wire up play button pointer events for radial gesture. */
  bindEvents(): void {
    this.playBtn.addEventListener('pointerdown', (e: PointerEvent) => {
      // Don't interfere with splash — let event bubble to splash handler
      if (this.isSplashActive()) return;
      e.preventDefault();

      this.audio.warmUp();

      // If already playing (latched or looping), stop
      if (this.playState !== 'idle') {
        this.stop();
        return;
      }

      if (this.getState().voices.length === 0) return;

      this.gesturePointerId = e.pointerId;
      this.lastZoneInfo = undefined;
      this.gestureActive = false;
      this.playBtn.setPointerCapture(e.pointerId);

      // Start audio immediately (momentary)
      this.start();

      // Delay before showing radial overlay — taps don't show it
      this.overlayTimerId = setTimeout(() => {
        this.overlayTimerId = undefined;
        if (this.gesturePointerId != undefined) {
          this.gestureActive = true;
          this.showRadialOverlay();
        }
      }, OVERLAY_DELAY_MS);
    });

    this.playBtn.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.gesturePointerId || !this.gestureActive) return;

      const info = this.radialZone(e.clientX, e.clientY);
      this.lastZoneInfo = info;
      this.updateOverlayHighlight(info.zone, e.clientX, e.clientY);
    });

    this.playBtn.addEventListener('pointerup', (e: PointerEvent) => {
      if (e.pointerId !== this.gesturePointerId) return;

      if (this.overlayTimerId != undefined) {
        clearTimeout(this.overlayTimerId);
        this.overlayTimerId = undefined;
      }

      if (!this.gestureActive) {
        // Quick tap — momentary stop
        this.stop();
        this.gesturePointerId = undefined;
        return;
      }

      const info = this.lastZoneInfo || this.radialZone(e.clientX, e.clientY);

      if (info.zone === 'latch') {
        this.playState = 'latched';
        this.updatePlayIndicators();
        // Defensive: restart audio if it stopped during the gesture
        if (!this.audio.isPlaying) {
          this.start();
        }
      } else if (info.zone === 'loop') {
        this.loopHoldMs = info.ms!;
        this.playState = 'looping';
        this.updatePlayIndicators();
        this.scheduleLoopRestart();
      } else {
        // Momentary — stop
        this.stop();
      }

      this.hideRadialOverlay();
      this.gestureActive = false;
      this.gesturePointerId = undefined;
    });

    this.playBtn.addEventListener('lostpointercapture', (e: PointerEvent) => {
      if (this.gesturePointerId == undefined) return;
      if (e.pointerId !== this.gesturePointerId) return;

      if (this.overlayTimerId != undefined) {
        clearTimeout(this.overlayTimerId);
        this.overlayTimerId = undefined;
      }

      if (this.audio.isPlaying && this.playState === 'idle') {
        this.stop();
      }
      this.hideRadialOverlay();
      this.gestureActive = false;
      this.gesturePointerId = undefined;
    });
  }

  /** Clear all pending timers. */
  dispose(): void {
    if (this.loopTimeoutId != undefined) clearTimeout(this.loopTimeoutId);
    if (this.releaseGlowTimeoutId != undefined) clearTimeout(this.releaseGlowTimeoutId);
    if (this.overlayTimerId != undefined) clearTimeout(this.overlayTimerId);
  }

  // ---- Private helpers ----

  // Icon refs for sprite scanner: #tabler-repeat #tabler-lock
  private createZoneElements(): void {
    // Floating zone icon — follows pointer, switches between loop/latch icons
    const zoneIcon = document.createElement('div');
    zoneIcon.className = 'radial-zone-icon';
    zoneIcon.style.opacity = '0';
    const zoneSvg = svgEl(
      'svg',
      { viewBox: '0 0 24 24' },
      svgEl('use', { href: '#tabler-repeat' }),
    );
    zoneIcon.appendChild(zoneSvg);
    this.radialOverlay.appendChild(zoneIcon);
    this.pointerZoneIcon = zoneIcon;

    // Dashed border circle between loop and latch zones
    const borderSvg = svgEl('svg', {});
    borderSvg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none';
    const circle = svgEl('circle', {});
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'rgba(255, 255, 255, 0.3)');
    circle.setAttribute('stroke-width', '1.5');
    circle.setAttribute('stroke-dasharray', '8 6');
    borderSvg.appendChild(circle);
    this.zoneBorderCircle = circle;

    // Pointer radius indicator (tracks distance during loop zone drag)
    const radiusCircle = svgEl('circle', {});
    radiusCircle.setAttribute('fill', 'none');
    radiusCircle.setAttribute('stroke', 'rgba(180, 220, 255, 0.7)');
    radiusCircle.setAttribute('stroke-width', '2.5');
    radiusCircle.setAttribute('stroke-dasharray', '6 4');
    radiusCircle.style.opacity = '0';
    borderSvg.appendChild(radiusCircle);
    this.pointerRadiusCircle = radiusCircle;

    this.radialOverlay.appendChild(borderSvg);
  }

  private updatePlayIndicators(): void {
    this.playBtn.classList.toggle('latched', this.playState === 'latched');
    this.playBtn.classList.toggle('looping', this.playState === 'looping');

    // Mode badge: show lock/repeat icon inside the stop button
    if (this.playState === 'latched') {
      const svg = svgEl('svg', { viewBox: '0 0 24 24' }, svgEl('use', { href: '#tabler-lock' }));
      this.modeBadge.replaceChildren(svg);
      this.modeBadge.classList.remove('hidden');
    } else if (this.playState === 'looping') {
      const svg = svgEl('svg', { viewBox: '0 0 24 24' }, svgEl('use', { href: '#tabler-repeat' }));
      this.modeBadge.replaceChildren(svg);
      this.modeBadge.classList.remove('hidden');
    } else {
      this.modeBadge.classList.add('hidden');
    }
  }

  // Icon references for sprite scanner: #tabler-player-stop #tabler-player-play
  private setPlayIcon(playing: boolean): void {
    const symbol = playing ? 'tabler-player-stop' : 'tabler-player-play';
    const svg = svgEl('svg', { viewBox: '0 0 24 24' }, svgEl('use', { href: `#${symbol}` }));
    svg.classList.add('play-icon');
    this.playBtn.querySelector('.play-icon')!.replaceWith(svg);
  }

  private scheduleLoopRestart(): void {
    const env = this.getState().envelope;
    const releaseMs = env.release * 1000;

    this.loopCycleDuration = this.loopHoldMs + releaseMs + 50;
    this.loopCycleStart = performance.now();

    this.loopTimeoutId = setTimeout(() => {
      this.audio.release(this.getState().envelope);
      this.loopTimeoutId = setTimeout(() => {
        if (this.playState === 'looping') {
          this.loopCycleStart = performance.now();
          this.ringFill.style.strokeDashoffset = `${PlaybackController.RING_CIRCUMFERENCE}`;
          this.start();
          this.scheduleLoopRestart();
        }
      }, releaseMs + 50);
    }, this.loopHoldMs);
  }

  private radialZone(clientX: number, clientY: number): { zone: string; ms?: number } {
    const dx = clientX - this.overlayCenterX;
    const dy = clientY - this.overlayCenterY;
    const dist = Math.hypot(dx, dy);

    if (dist < this.overlayInnerRadius) {
      return { zone: 'momentary' };
    }
    if (dist >= this.overlayLatchStart) {
      return { zone: 'latch' };
    }
    const loopRange = this.overlayLatchStart - this.overlayInnerRadius;
    const t = Math.min(1, Math.max(0, (dist - this.overlayInnerRadius) / loopRange));
    const ms = Math.round((LOOP_MS_MIN + t * (LOOP_MS_MAX - LOOP_MS_MIN)) / 50) * 50;
    return { zone: 'loop', ms };
  }

  private showRadialOverlay(): void {
    const r = this.playBtn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    this.overlayCenterX = cx;
    this.overlayCenterY = cy;

    // Cap at vmin/2 so the overlay circle fits within the viewport
    const vmin = Math.min(window.innerWidth, window.innerHeight);
    const maxDist = vmin / 2;
    this.overlayMaxDist = maxDist;

    const innerR = r.width / 2;
    const latchStart = maxDist * (1 - PlaybackController.LATCH_MARGIN);
    this.overlayInnerRadius = innerR;
    this.overlayLatchStart = latchStart;

    // Initialize floating zone icon (hidden until loop/latch zone entered)
    const iconSize = r.width;
    if (this.pointerZoneIcon) {
      this.pointerZoneIcon.style.width = `${iconSize}px`;
      this.pointerZoneIcon.style.height = `${iconSize}px`;
      this.pointerZoneIcon.style.opacity = '0';
    }

    // Dashed border circle at zone boundary
    if (this.zoneBorderCircle) {
      this.zoneBorderCircle.setAttribute('cx', `${cx}`);
      this.zoneBorderCircle.setAttribute('cy', `${cy}`);
      this.zoneBorderCircle.setAttribute('r', `${latchStart}`);
    }

    // Reset pointer radius indicator
    if (this.pointerRadiusCircle) {
      this.pointerRadiusCircle.setAttribute('cx', `${cx}`);
      this.pointerRadiusCircle.setAttribute('cy', `${cy}`);
      this.pointerRadiusCircle.style.opacity = '0';
    }

    this.setOverlayGradient('momentary');
    this.radialOverlay.classList.remove('hidden');
    requestAnimationFrame(() => {
      this.radialOverlay.classList.add('active');
    });
  }

  private hideRadialOverlay(): void {
    this.radialOverlay.classList.remove('active');
    if (this.pointerZoneIcon) this.pointerZoneIcon.style.opacity = '0';
    this.radialOverlay.addEventListener(
      'transitionend',
      () => {
        if (!this.radialOverlay.classList.contains('active')) {
          this.radialOverlay.classList.add('hidden');
        }
      },
      { once: true },
    );
  }

  private setOverlayGradient(activeZone: string): void {
    const cx = this.overlayCenterX;
    const cy = this.overlayCenterY;
    const innerR = this.overlayInnerRadius;
    const latchStart = this.overlayLatchStart;

    const momentaryAlpha = activeZone === 'momentary' ? 0.14 : 0.06;
    const loopAlpha = activeZone === 'loop' ? 0.18 : 0.1;

    this.radialOverlay.style.background = `radial-gradient(
      circle at ${cx}px ${cy}px,
      rgba(255, 255, 255, ${momentaryAlpha}) 0px,
      rgba(255, 255, 255, ${momentaryAlpha}) ${innerR}px,
      rgba(180, 220, 255, ${loopAlpha}) ${innerR}px,
      rgba(180, 220, 255, ${loopAlpha}) ${latchStart}px,
      transparent ${latchStart}px
    )`;
  }

  private updateOverlayHighlight(zone: string, clientX: number, clientY: number): void {
    this.setOverlayGradient(zone);

    const dist = Math.hypot(clientX - this.overlayCenterX, clientY - this.overlayCenterY);

    // Floating zone icon follows pointer — shows loop icon in loop zone, latch icon past boundary
    if (this.pointerZoneIcon) {
      if (zone === 'loop' || zone === 'latch') {
        // Swap icon based on zone
        const href = zone === 'latch' ? '#tabler-lock' : '#tabler-repeat';
        const use = this.pointerZoneIcon.querySelector('use');
        if (use && use.getAttribute('href') !== href) {
          use.setAttribute('href', href);
        }

        const half = this.pointerZoneIcon.offsetWidth / 2;
        const angle = Math.atan2(clientY - this.overlayCenterY, clientX - this.overlayCenterX);
        const ix = this.overlayCenterX + Math.cos(angle) * dist - half;
        const iy = this.overlayCenterY + Math.sin(angle) * dist - half;
        this.pointerZoneIcon.style.left = `${ix}px`;
        this.pointerZoneIcon.style.top = `${iy}px`;
        this.pointerZoneIcon.style.opacity = '1';
        this.pointerZoneIcon.classList.toggle('active', true);
      } else {
        this.pointerZoneIcon.style.opacity = '0';
        this.pointerZoneIcon.classList.toggle('active', false);
      }
    }

    // Show pointer radius indicator in loop zone
    if (this.pointerRadiusCircle) {
      if (zone === 'loop') {
        this.pointerRadiusCircle.setAttribute('r', `${dist}`);
        this.pointerRadiusCircle.style.opacity = '1';
      } else {
        this.pointerRadiusCircle.style.opacity = '0';
      }
    }
  }
}
