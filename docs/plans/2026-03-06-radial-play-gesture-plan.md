# Radial Play Gesture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the play button fan-out menu with a radial gesture system on a repositioned, restyled play button.

**Architecture:** Move `#btn-play` from the top toolbar into `#stage`, centered below the canvas. Replace the vertical fan menu with a fullscreen radial overlay showing three concentric zones (momentary/loop/latch). Gesture handling changes from linear Y-axis tracking to radial distance from button center. Loop progress indicator changes from left-to-right gradient to a circular SVG ring.

**Tech Stack:** TypeScript, CSS, SVG (for progress ring), Playwright (integration tests)

---

### Task 1: Remove old play button HTML + CSS, add new button to stage

**Files:**
- Modify: `index.html:21-42` (remove play-fan-wrap from toolbar, add play button to stage)
- Modify: `css/style.css:183-207` (remove old `.play-btn` overrides, `.play-mode-indicator`)
- Modify: `css/style.css:360-419` (remove entire play fan menu section)
- Modify: `css/style.css:567-574` (remove `.play-btn` responsive overrides)

**Step 1: Update index.html**

Remove the entire `.play-fan-wrap` div (lines 22-42) from the `.play-group` toolbar group. The share button stays. Add the new play button inside `#stage`, after `#canvas-wrap`:

```html
<!-- In the play-group, keep only the share button: -->
<div class="toolbar-group play-group">
  <button id="btn-share" class="action-btn" title="Share">
    <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-share" /></svg>
  </button>
</div>

<!-- In #stage, after #canvas-wrap: -->
<button id="btn-play" class="stage-play-btn" title="Play">
  <svg class="play-icon" width="20" height="20">
    <use href="tabler-sprite.svg#tabler-player-play-filled" />
  </svg>
  <svg class="play-ring" viewBox="0 0 44 44" width="44" height="44">
    <circle class="play-ring-track" cx="22" cy="22" r="19" />
    <circle class="play-ring-fill" cx="22" cy="22" r="19" />
  </svg>
</button>
<div id="radial-overlay" class="radial-overlay hidden" aria-hidden="true"></div>
```

The play button now contains:
- The play/stop icon (same as before, toggled by JS)
- An SVG ring with two circles: a subtle track and a fill that animates via `stroke-dashoffset` for loop progress

The `#radial-overlay` is a fullscreen div that will be styled with CSS radial gradients for the zones.

**Step 2: Add new CSS for `.stage-play-btn`**

Replace old `.play-btn` overrides and fan menu CSS with:

```css
/* ---- Stage play button ---- */

.stage-play-btn {
  position: absolute;
  /* Position below canvas-wrap, centered */
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: none;
  color: #fff;
  cursor: pointer;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.6));
  opacity: 0.8;
  transition: opacity 0.2s;
  touch-action: none;
}

.stage-play-btn:hover {
  opacity: 1;
}

.stage-play-btn .play-icon {
  position: relative;
  z-index: 1;
}

/* Loop progress ring */
.play-ring {
  position: absolute;
  inset: -2px;
  width: 44px;
  height: 44px;
  pointer-events: none;
  transform: rotate(-90deg); /* start from top */
}

.play-ring-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.15);
  stroke-width: 2;
}

.play-ring-fill {
  fill: none;
  stroke: #fff;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-dasharray: 119.38; /* 2 * PI * 19 */
  stroke-dashoffset: 119.38; /* fully hidden */
  transition: none;
}

/* Latch glow */
.stage-play-btn.latched {
  filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.6))
          drop-shadow(0 0 2px rgba(0, 0, 0, 0.6));
}

/* ---- Radial overlay ---- */

.radial-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease-out;
  /* Gradient set dynamically by JS (centered on button) */
}

.radial-overlay.active {
  opacity: 1;
}
```

Also remove `.play-btn` from the combined button selector on line 132 (`.tool-btn, .action-btn, .play-btn`). The new button is styled independently.

**Step 3: Remove old CSS**

Delete the following CSS blocks:
- `.play-btn { width: 64px; gap: 4px; }` (line 183-186)
- `.play-btn.playing { ... }` (line 188-191)
- `.play-btn.looping { ... }` (line 193-200)
- `.play-mode-indicator { ... }` (line 202-207)
- Entire `/* ---- Play fan menu ---- */` section (lines 360-419)
- `.play-btn` entries in responsive media queries (lines 568, 572-574)
- Remove `.play-btn` from the combined selector at line 132

**Step 4: Verify build**

Run: `bun run build`
Expected: Build succeeds (HTML/CSS only changes — JS will break because DOM queries fail, that's Task 2)

**Step 5: Commit**

```
git add index.html css/style.css
git commit -m "refactor: relocate play button to stage, replace fan menu with radial overlay

Move play button from top toolbar into stage area, styled as a
transparent overlay like the stage switcher. Add SVG progress ring
for loop mode. Add radial overlay div for gesture zones.

Remove old fan menu HTML, CSS, and mode indicator badges.

Refs #114"
```

---

### Task 2: Rewrite PlaybackController for radial gesture

**Files:**
- Modify: `js/playback.ts` (full rewrite of gesture handling + DOM queries)

**Step 1: Update constructor DOM queries**

Remove queries for: `playFan`, `fanLock`, `fanLoop`, `playModeLock`, `playModeLoop`.
Add queries for: `radialOverlay`, `playRingFill` (the SVG circle for progress).

```typescript
// DOM elements
private playBtn: HTMLElement;
private radialOverlay: HTMLElement;
private ringFill: SVGCircleElement;

// Constants
private static readonly RING_CIRCUMFERENCE = 2 * Math.PI * 19; // r=19 on the SVG circle
private static readonly MOMENTARY_RADIUS = 80; // px — inner disc
private static readonly LATCH_MARGIN = 0.3; // outer 30% of max distance = latch zone
```

Constructor:
```typescript
this.playBtn = qel('#btn-play');
this.radialOverlay = qel('#radial-overlay');
this.ringFill = qel<SVGCircleElement>('.play-ring-fill', this.playBtn);
```

**Step 2: Replace `renderTick` for circular progress**

Instead of setting `--loop-progress` CSS variable, set `stroke-dashoffset` on the ring fill circle:

```typescript
renderTick(): void {
  if (this.playState === 'looping' && this.loopCycleDuration > 0) {
    const elapsed = performance.now() - this.loopCycleStart;
    const progress = Math.min(1, elapsed / this.loopCycleDuration);
    const offset = PlaybackController.RING_CIRCUMFERENCE * (1 - progress);
    this.ringFill.style.strokeDashoffset = `${offset}`;
  }
}
```

**Step 3: Update `start()` / `stop()` for new classes**

In `start()`: replace `this.playBtn.classList.add('playing')` — keep it, it's fine semantically but we no longer need the old `.playing` CSS (the button is transparent; playing state is shown by icon swap + ring/glow).

In `stop()`: remove `this.playBtn.classList.remove('looping')` and `--loop-progress`. Add ring reset:
```typescript
this.ringFill.style.strokeDashoffset = `${PlaybackController.RING_CIRCUMFERENCE}`;
this.playBtn.classList.remove('playing', 'latched');
```

**Step 4: Replace `updatePlayIndicators` with new indicator logic**

```typescript
private updatePlayIndicators(): void {
  this.playBtn.classList.toggle('latched', this.playState === 'latched');
  // Ring visibility handled by renderTick (looping) or reset (stop)
}
```

**Step 5: Replace gesture handling in `bindEvents`**

The radial gesture replaces the linear fan gesture. Key changes:

- On `pointerdown`: start audio, capture pointer, record button center position, show radial overlay immediately
- On `pointermove`: compute distance from button center (not just Y-axis), determine zone (momentary/loop/latch), highlight active zone on overlay
- On `pointerup`: commit to the zone the pointer is in, hide overlay
- On `lostpointercapture`: same cleanup as before

**Radial overlay rendering:** On `pointerdown`, compute button center in viewport coordinates. Set the overlay's CSS `background` to a `radial-gradient` centered at that point with zone colors:

```typescript
private showRadialOverlay(): void {
  const r = this.playBtn.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  this.overlayCenterX = cx;
  this.overlayCenterY = cy;

  // Compute max distance from button center to any screen corner
  const maxDist = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(window.innerWidth - cx, cy),
    Math.hypot(cx, window.innerHeight - cy),
    Math.hypot(window.innerWidth - cx, window.innerHeight - cy),
  );
  this.overlayMaxDist = maxDist;

  const innerR = PlaybackController.MOMENTARY_RADIUS;
  const latchStart = maxDist * (1 - PlaybackController.LATCH_MARGIN);

  this.overlayInnerRadius = innerR;
  this.overlayLatchStart = latchStart;

  this.radialOverlay.style.background = `radial-gradient(
    circle at ${cx}px ${cy}px,
    rgba(255, 255, 255, 0.06) 0px,
    rgba(255, 255, 255, 0.06) ${innerR}px,
    rgba(180, 220, 255, 0.10) ${innerR}px,
    rgba(180, 220, 255, 0.10) ${latchStart}px,
    rgba(255, 200, 160, 0.12) ${latchStart}px,
    rgba(255, 200, 160, 0.12) ${maxDist}px
  )`;
  this.radialOverlay.classList.remove('hidden');
  // Use rAF to trigger the opacity transition
  requestAnimationFrame(() => {
    this.radialOverlay.classList.add('active');
  });
}

private hideRadialOverlay(): void {
  this.radialOverlay.classList.remove('active');
  // After transition, add hidden to remove from layout
  this.radialOverlay.addEventListener('transitionend', () => {
    if (!this.radialOverlay.classList.contains('active')) {
      this.radialOverlay.classList.add('hidden');
    }
  }, { once: true });
}
```

**Zone computation** replaces `fanZone`:

```typescript
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
  // Loop zone — map distance to loop duration (log scale)
  const loopRange = this.overlayLatchStart - this.overlayInnerRadius;
  const t = Math.min(1, Math.max(0, (dist - this.overlayInnerRadius) / loopRange));
  const ms = Math.round((LOOP_MS_MIN + t * (LOOP_MS_MAX - LOOP_MS_MIN)) / 50) * 50;
  return { zone: 'loop', ms };
}
```

**Active zone highlighting:** On `pointermove`, update the overlay gradient to brighten the active zone. This is done by adjusting the alpha values in the gradient — the active zone gets a higher alpha (e.g., `0.18` instead of `0.10`).

**Step 6: Update `scheduleLoopRestart`**

Replace `.looping` class usage with ring reset:
```typescript
this.ringFill.style.strokeDashoffset = `${PlaybackController.RING_CIRCUMFERENCE}`;
// loopCycleStart reset happens in the existing code
```

**Step 7: Remove all fan-related private methods**

Delete: `openFan`, `closeFan`, `fanZone`. Remove `lastFanInfo` field. Remove `gestureTimerId` and `FAN_DELAY_MS` — the radial overlay appears immediately on pointerdown (no delay needed since it doesn't obscure the button).

**Step 8: Verify typecheck**

Run: `bun run check`
Expected: No type errors

**Step 9: Commit**

```
git add js/playback.ts
git commit -m "feat: implement radial gesture system for play button

Replace vertical fan menu gesture with radial distance-based zones:
- Inner disc (momentary): release to stop
- Middle ring (loop): scales duration with drag distance
- Outer ring (latch): sustain indefinitely

Loop progress shown as circular SVG ring around the button.
Latch shown as a glow effect on the button.

Refs #114"
```

---

### Task 3: Update app.ts wiring and splash.ts

**Files:**
- Modify: `js/app.ts` (minor — play button is no longer in toolbar, but PlaybackController still queries by ID)
- Modify: `js/splash.ts` (verify no references to old play elements)

**Step 1: Check app.ts**

The `PlaybackController` is instantiated and `bindEvents()` is called — this should still work since the button ID `#btn-play` is the same. The `renderTick()` call in the render loop is unchanged.

Verify that `playback.bindEvents()` is called AFTER the DOM is ready (it already is — line 200).

The splash controller references `#toolbar-top` and `#toolbar-bottom` for reveal transitions. The play button is now in `#stage`, which is always visible. The splash needs to also reveal the play button after splash dismiss. Add the play button to the reveal:

```typescript
// In splash.ts splashReveal, also fade in the play button
// Actually, the play button should be visible during splash (it's on the stage)
// The stage is always visible; only toolbars are hidden. So no change needed.
```

Actually, looking at the CSS, the play button inherits `opacity: 0.8` from `.stage-play-btn` and is always visible (it's on the stage, not the toolbar). But during splash, the stage IS the interaction target. The play button shouldn't interfere — splash uses `pointerdown` on the stage, and the play button is a child of `#stage`, so events will bubble up. However, we need to make sure the play button doesn't start its own gesture during splash. The `isSplashActive` check needs to be added to the play button's pointerdown handler.

**Step 2: Add splash guard to play button**

In `PlaybackController`, add an `isSplashActive` callback to the constructor deps and check it at the top of the `pointerdown` handler:

```typescript
constructor(deps: {
  audio: AudioEngine;
  getState: () => SigilData;
  requestRender: () => void;
  isSplashActive: () => boolean;
}) {
  // ...
  this.isSplashActive = deps.isSplashActive;
}
```

In `bindEvents` pointerdown:
```typescript
if (this.isSplashActive()) return;
```

Update `app.ts` to pass `isSplashActive`:
```typescript
const playback = new PlaybackController({
  audio,
  getState: () => store.data,
  requestRender: () => { needsRender = true; },
  isSplashActive: () => splash.isActive,
});
```

Wait — `splash` is created after `playback` in app.ts. We need to reorder or use a lazy reference. Looking at app.ts line 85, `splash` is created after `playback` (line 75). But `isSplashActive` is a callback, not evaluated at construction time, so it can reference `splash` if `splash` is defined by the time `bindEvents` is called and the handler fires. Since `splash` is defined before `playback.bindEvents()` is called (line 200), and `isSplashActive` is only called during runtime events, this works fine — just need to declare `splash` before `playback` or use a `let` declaration.

Actually, looking more carefully, `splash` is already defined at line 85 with `const`, before `playback.bindEvents()` at line 200. The issue is that `PlaybackController` is created at line 75, before `splash` at line 85. But since `isSplashActive` is a closure that captures `splash` by reference (not by value), and `splash` will be initialized by the time any pointer event fires, this works. The closure captures the `splash` variable, which is hoisted as `const` and initialized at line 85 — well before any user interaction.

Actually no — `const splash` at line 85 means the variable exists but trying to access it before line 85 would throw (TDZ). But the callback is only called during runtime events, long after line 85 executes. So this is fine.

But we need to move `splash` initialization before `playback` construction. Or pass a getter. Let's keep it simple — just pass the callback:

```typescript
const playback = new PlaybackController({
  audio,
  getState: () => store.data,
  requestRender: () => { needsRender = true; },
  isSplashActive: () => splash.isActive,  // splash is in TDZ here but callback is never called during construction
});
```

This actually works fine in practice — the callback captures the binding, and `splash` will be initialized before any event fires. But to be safe and avoid TDZ concerns, we can just swap the declaration order or use `let`.

Simplest: just move the `splash` construction above `playback`:

```typescript
const splash = new SplashController({ stage, audio, playback: null as any });
const playback = new PlaybackController({ ... isSplashActive: () => splash.isActive });
```

No, that's ugly. The callback approach is fine — JavaScript closures capture bindings, and the function is never called during construction. Keep as-is.

**Step 3: Also hide play button during splash**

The play button is on the stage and visible even during splash. We should hide it until the splash is dismissed, just like the toolbars. Add CSS:

```css
.stage-play-btn {
  /* ... existing ... */
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}

body.is-editing .stage-play-btn {
  opacity: 0.8;
  pointer-events: auto;
}

.stage-play-btn:hover {
  opacity: 1;
}
```

This piggybacks on the existing `body.is-editing` class that splash adds on reveal.

**Step 4: Verify typecheck + build**

Run: `bun run check && bun run build`

**Step 5: Commit**

```
git add js/playback.ts js/app.ts css/style.css
git commit -m "fix: guard play button during splash, hide until reveal

Add isSplashActive check to play button pointerdown handler.
Hide play button during splash using body.is-editing gate.

Refs #114"
```

---

### Task 4: Update integration tests

**Files:**
- Modify: `tests/integration/play-modes.test.js`
- Modify: `tests/integration/playback.test.js`

**Step 1: Update play-modes.test.js**

The tests reference `#btn-play` (still valid), `.play-fan` (removed), and `.fan-*` classes (removed). Rewrite to use the radial gesture:

- "quick click plays and stops" — same logic, just button is now on stage
- "hold opens fan" → "hold shows radial overlay" — check for `.radial-overlay.active`
- "drag to lock latches" → "drag to outer edge latches" — drag far from button center
- "drag to loop starts loop" → "drag to middle zone starts loop" — drag moderate distance
- "space toggles latch" — unchanged

Key test changes:
- Button is no longer in toolbar — it's on the stage, so bounding box Y will be different
- Fan-related assertions become overlay assertions
- Drag targets change from vertical (below button) to radial (away from button center)

**Step 2: Update playback.test.js**

These tests mostly use Space bar and check `.playing` class on `#btn-play`. The icon check (`.play-icon use` href) is still valid. Minimal changes — just verify the button selector still works in its new location.

**Step 3: Run integration tests**

Run: `bun run test:e2e`
Expected: All tests pass

**Step 4: Commit**

```
git add tests/integration/play-modes.test.js tests/integration/playback.test.js
git commit -m "test: update integration tests for radial play gesture

Replace fan menu assertions with radial overlay assertions.
Update drag gestures from vertical to radial distance.

Refs #114"
```

---

### Task 5: Visual polish and manual testing

**Files:**
- Modify: `css/style.css` (tuning zone colors, ring appearance, responsive sizing)
- Possibly modify: `js/playback.ts` (radius tuning)

**Step 1: Test on mobile viewport sizes**

Run dev server: `bun run dev`
Open in browser at 375px width (iPhone) and verify:
- Play button is visible below the tile, not overlapping anything
- Radial overlay zones are visible and distinguishable
- Latch zone is reachable at screen edges
- Loop zone is the largest area

**Step 2: Tune radii and colors**

Adjust `MOMENTARY_RADIUS`, `LATCH_MARGIN`, and zone tint colors based on visual testing. The inner radius should be just large enough that a thumb-lift on the button itself doesn't accidentally enter the loop zone. The latch zone should be wide enough that fingers at screen edges comfortably land in it.

**Step 3: Test loop ring animation**

Verify the circular progress ring:
- Appears only during loop mode
- Completes one rotation per loop cycle
- Resets cleanly at cycle boundary
- Disappears on stop

**Step 4: Test latch glow**

Verify the latch glow:
- Appears when latched
- Disappears on stop
- Visible on both white and florid stages

**Step 5: Run full test suite**

Run: `bun run test`
Expected: All unit + integration tests pass

**Step 6: Run typecheck + lint + format**

Run: `bun run check && bun run lint && bun run fmt`

**Step 7: Commit**

```
git add -A
git commit -m "style: polish radial gesture zones and progress ring

Tune zone radii, tint colors, and ring appearance.

Refs #114"
```
