# Credits Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a credits overlay accessible from a button in the stage corner, with backdrop blur and audio muffling.

**Architecture:** A `.stage-btn` in the bottom-right of `#stage` toggles a full-stage overlay with blurred backdrop. Credits text is centered over the stage. When audio is playing, a low-pass filter muffles the output while the overlay is visible.

**Tech Stack:** Vanilla TS/CSS, Web Audio BiquadFilterNode

---

### Task 1: Add muffle/unmuffle to AudioEngine

**Files:**
- Modify: `js/audio/engine.ts`

**Step 1: Add muffle state and filter fields to the constructor**

Add after `_irCache` in the constructor and field declarations:

```ts
_muffleFilter: BiquadFilterNode | undefined;
_muffled: boolean;
```

Initialize `_muffled = false` and `_muffleFilter = undefined` in the constructor.

**Step 2: Insert muffle filter into the audio chain in `play()`**

In `play()`, replace the line:

```ts
this._analyser.connect(ctx.destination);
```

with:

```ts
this._muffleFilter = ctx.createBiquadFilter();
this._muffleFilter.type = 'lowpass';
this._muffleFilter.frequency.value = this._muffled ? 600 : 20000;
this._muffleFilter.Q.value = 0.7;
this._analyser.connect(this._muffleFilter);
this._muffleFilter.connect(ctx.destination);
```

Also connect `_muffleFilter` to `_streamDest` instead of `_analyser`:

```ts
if (this._streamDest) {
  this._muffleFilter.connect(this._streamDest);
```

**Step 3: Add `muffle()` and `unmuffle()` methods**

Add after `getLevel()`:

```ts
muffle(): void {
  this._muffled = true;
  if (this._muffleFilter) {
    this._muffleFilter.frequency.linearRampToValueAtTime(
      600,
      (this.audioCtx?.currentTime ?? 0) + 0.15,
    );
  }
}

unmuffle(): void {
  this._muffled = false;
  if (this._muffleFilter) {
    this._muffleFilter.frequency.linearRampToValueAtTime(
      20000,
      (this.audioCtx?.currentTime ?? 0) + 0.15,
    );
  }
}
```

**Step 4: Clean up muffle filter in `_cleanup()`**

Add before `this.isPlaying = false;` in `_cleanup()`:

```ts
if (this._muffleFilter) {
  safeDisconnect(this._muffleFilter);
  this._muffleFilter = undefined;
}
```

**Step 5: Verify build**

Run: `bun run check`
Expected: PASS (no type errors)

**Step 6: Commit**

```bash
git add js/audio/engine.ts
git commit -m "feat(audio): add muffle/unmuffle low-pass filter methods (#183)"
```

---

### Task 2: Add credits button and overlay HTML

**Files:**
- Modify: `index.html`

**Step 1: Add credits button and overlay to `#stage`**

Add before the closing `</main>` tag (after `#radial-overlay`):

```html
<button id="btn-credits" class="stage-btn credits-btn" title="Credits">
  <svg width="16" height="16"><use href="tabler-sprite.svg#tabler-mushroom" /></svg>
</button>
<div id="credits-overlay" class="credits-overlay hidden" aria-hidden="true">
  <div class="credits-content">
    <p class="credits-tagline">Make your own spatch, why don't you</p>
    <ul class="credits-list">
      <li>Font: <a href="https://fonts.google.com/specimen/Imbue" target="_blank" rel="noopener">Imbue</a></li>
      <li>Icons: <a href="https://tabler.io/icons" target="_blank" rel="noopener">Tabler Icons</a></li>
      <li>Photography: <a href="https://liminalsorting.tumblr.com/" target="_blank" rel="noopener">liminalsorting</a></li>
    </ul>
  </div>
</div>
```

**Step 2: Verify build**

Run: `bun run build`
Expected: PASS (mushroom icon is found and included in sprite)

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add credits button and overlay HTML (#183)"
```

---

### Task 3: Style credits button and overlay

**Files:**
- Modify: `css/style.css`

**Step 1: Add credits button positioning**

Add after the `.stage-btn:hover` rule:

```css
.credits-btn {
  top: auto;
  right: 8px;
  bottom: 8px;
}
```

**Step 2: Add credits overlay styles**

Add after the credits button rule:

```css
/* ---- Credits overlay ---- */

.credits-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  cursor: pointer;
}

.credits-overlay.hidden {
  display: none !important;
}

.credits-content {
  text-align: center;
  color: #fff;
  font-size: 18px;
  line-height: 1.8;
  pointer-events: none;
}

.credits-tagline {
  font-size: 24px;
  margin-bottom: 16px;
  opacity: 0.9;
}

.credits-list {
  list-style: none;
  font-size: 16px;
  opacity: 0.75;
}

.credits-list a {
  color: #fff;
  text-decoration: underline;
  text-underline-offset: 2px;
  pointer-events: auto;
}

.credits-list a:hover {
  opacity: 0.8;
}
```

**Step 3: Commit**

```bash
git add css/style.css
git commit -m "feat: style credits overlay with blur backdrop (#183)"
```

---

### Task 4: Wire up credits module

**Files:**
- Create: `js/credits.ts`
- Modify: `js/app.ts`

**Step 1: Create `js/credits.ts`**

```ts
// credits.ts -- Credits overlay toggle + audio muffling

import type { AudioEngine } from './audio/engine.ts';
import { qel } from './dom.ts';

export function initCredits(audio: AudioEngine): void {
  const btn = qel('#btn-credits');
  const overlay = qel('#credits-overlay');

  function show(): void {
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    audio.muffle();
  }

  function hide(): void {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    audio.unmuffle();
  }

  btn.addEventListener('click', () => {
    if (overlay.classList.contains('hidden')) {
      show();
    } else {
      hide();
    }
  });

  overlay.addEventListener('click', (e: MouseEvent) => {
    // Don't dismiss when clicking links
    if ((e.target as HTMLElement).closest('a')) {
      return;
    }
    hide();
  });
}
```

**Step 2: Import and call `initCredits` in `js/app.ts`**

Add import at the top with the other imports:

```ts
import { initCredits } from './credits.ts';
```

Add after the `bindShareMenu` call (near end of file):

```ts
initCredits(audio);
```

**Step 3: Verify build**

Run: `bun run check && bun run build`
Expected: PASS

**Step 4: Manual test**

Run: `bun run dev`
- Click the mushroom button in the bottom-right corner of the stage
- Credits overlay appears with blur backdrop
- Click anywhere (not a link) to dismiss
- Play audio, open credits: audio should muffle
- Close credits: audio should unmuffle

**Step 5: Commit**

```bash
git add js/credits.ts js/app.ts
git commit -m "feat: wire up credits overlay with audio muffling (#183)"
```
