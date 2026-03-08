# Button Ergonomics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve play button size/icons, enlarge floating zone icons, block landscape on small screens, and remove share functionality.

**Architecture:** Four independent UI changes touching HTML, CSS, JS playback/splash/app/keyboard, and share module deletion. No audio or state changes.

**Tech Stack:** TypeScript, CSS, SVG, Vite (tabler icon sprite)

---

### Task 1: Remove share functionality (#217)

**Files:**
- Delete: `js/share.ts`
- Modify: `index.html:23-27` (remove share button)
- Modify: `index.html:73-80` (remove share menu)
- Modify: `js/app.ts:10,217-218,229,252-254` (remove share imports/wiring)
- Modify: `js/keyboard.ts:29,31,100` (remove shareMenu param and Escape handler)

**Step 1: Remove share button and share menu from HTML**

In `index.html`, delete the share button group (lines 23-27):
```html
          <div class="toolbar-group play-group">
            <button id="btn-share" class="action-btn" title="Share">
              <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-user-share" /></svg>
            </button>
          </div>
```

Delete the share menu expansion row (lines 73-80):
```html
        <div id="share-menu" class="toolbar-row toolbar-expansion hidden">
          <button class="action-btn" data-action="share" title="Copy link">
            <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-link" /></svg>
          </button>
          <button class="action-btn" data-action="embed" title="Copy embed code">
            <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-code" /></svg>
          </button>
        </div>
```

Also remove the now-orphaned separator after the (deleted) play-group. The
separator at line 29 (`<div class="separator"></div>`) immediately followed the
share button group. With that group gone, it sits between the title-group and
actions-group — still meaningful, so **keep it**.

**Step 2: Remove share wiring from app.ts**

In `js/app.ts`:
- Delete line 10: `import { bindShareMenu } from './share.ts';`
- Delete lines 215-218 (share menu DOM queries):
  ```ts
  // ---- Share menu (hoisted for keyboard handler) ----

  const shareBtn = qel('#btn-share');
  const shareMenu = qel('#share-menu');
  ```
- Remove `shareMenu` from `bindKeyboardShortcuts` call (line 229)
- Delete lines 252-254:
  ```ts
  // ---- Share menu ----

  bindShareMenu({ shareBtn, shareMenu, store });
  ```

**Step 3: Remove shareMenu from keyboard.ts**

In `js/keyboard.ts`:
- Remove `shareMenu: HTMLElement;` from the deps type (line 29)
- Remove `shareMenu` from the destructure (line 31)
- Remove `shareMenu.classList.add('hidden');` from the Escape handler (line 100)

**Step 4: Delete share.ts**

```bash
rm js/share.ts
```

**Step 5: Verify build**

```bash
bun run check && bun run build
```
Expected: No type errors, clean build. No references to share remain.

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: remove share button and menu (#217)"
```

---

### Task 2: Enlarge play button and rework icons (#221)

**Files:**
- Modify: `css/style.css:223` (play button size variable)
- Modify: `css/style.css:405-410` (play icon size)
- Modify: `css/style.css:412-428` (mode badge → centered)
- Modify: `index.html:89-92` (replace play icon with inline path)
- Modify: `js/playback.ts:299-312,344-361,489` (filled icons, inline play icon, centered badge)

**Step 1: Increase play button size**

In `css/style.css`, change the `--play-btn-size` custom property on `#stage`
(line 223):

```css
/* Old: */
--play-btn-size: clamp(62px, 13vmin, 84px);
/* New: */
--play-btn-size: clamp(86px, 18vmin, 118px);
```

**Step 2: Replace play icon in HTML with inline rounded triangle**

In `index.html`, replace the play icon SVG (lines 90-92):

```html
<!-- Old: -->
<svg class="play-icon" viewBox="0 0 24 24">
  <use href="tabler-sprite.svg#tabler-player-play" />
</svg>
```

Replace with an inline rounded-corner play triangle:
```html
<svg class="play-icon" viewBox="0 0 24 24">
  <path d="M6 4.75a1.25 1.25 0 0 1 1.87-1.08l12.5 7.25a1.25 1.25 0 0 1 0 2.16l-12.5 7.25A1.25 1.25 0 0 1 6 19.25V4.75z" fill="currentColor" />
</svg>
```

**Step 3: Update setPlayIcon to use filled stop and inline play**

In `js/playback.ts`, replace the `setPlayIcon` method (lines 357-362):

```ts
// Old:
private setPlayIcon(playing: boolean): void {
  const symbol = playing ? 'tabler-player-stop' : 'tabler-player-play';
  const svg = svgEl('svg', { viewBox: '0 0 24 24' }, svgEl('use', { href: `#${symbol}` }));
  svg.classList.add('play-icon');
  this.playBtn.querySelector('.play-icon')!.replaceWith(svg);
}
```

New implementation — stop uses filled icon, play uses inline path:
```ts
// Icon ref for sprite scanner: #tabler-player-stop-filled
private setPlayIcon(playing: boolean): void {
  const svg = svgEl('svg', { viewBox: '0 0 24 24' });
  if (playing) {
    svg.appendChild(svgEl('use', { href: '#tabler-player-stop-filled' }));
  } else {
    const path = svgEl('path', {
      d: 'M6 4.75a1.25 1.25 0 0 1 1.87-1.08l12.5 7.25a1.25 1.25 0 0 1 0 2.16l-12.5 7.25A1.25 1.25 0 0 1 6 19.25V4.75z',
      fill: 'currentColor',
    });
    svg.appendChild(path);
  }
  svg.classList.add('play-icon');
  this.playBtn.querySelector('.play-icon')!.replaceWith(svg);
}
```

Update the comment on line 356 to remove old icon refs:
```ts
// Old: // Icon references for sprite scanner: #tabler-player-stop #tabler-player-play
// New: (moved into method body)
```

**Step 4: Restyle mode badge as centered cutout**

In `css/style.css`, replace the mode badge rules (lines 412-428):

```css
/* Old: */
/* Mode badge (lock/repeat icon shown overlapping stop icon, bottom-right) */
.play-mode-badge {
  position: absolute;
  bottom: 2%;
  right: 2%;
  z-index: 2;
  width: 28%;
  height: 28%;
  color: #fff;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.8));
  pointer-events: none;
}

.play-mode-badge svg {
  width: 100%;
  height: 100%;
}
```

New — centered over the stop icon, dark color for contrast:
```css
/* Mode badge (lock/repeat icon centered over stop icon as contrasting cutout) */
.play-mode-badge {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
  pointer-events: none;
}

.play-mode-badge svg {
  width: 28%;
  height: 28%;
}
```

**Step 5: Use filled lock icon in mode badge**

In `js/playback.ts`, update `updatePlayIndicators` (lines 338-354) to use
filled lock icon:

```ts
// Old line 344:
const svg = svgEl('svg', { viewBox: '0 0 24 24' }, svgEl('use', { href: '#tabler-lock' }));
// New:
const svg = svgEl('svg', { viewBox: '0 0 24 24' }, svgEl('use', { href: '#tabler-lock-filled' }));
```

The repeat icon stays outline (no filled version exists in tabler).

Update the icon ref comment at line 299:
```ts
// Old: // Icon refs for sprite scanner: #tabler-repeat #tabler-lock
// New: // Icon refs for sprite scanner: #tabler-repeat #tabler-lock-filled
```

**Step 6: Verify build**

```bash
bun run check && bun run build
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: enlarge play button, use filled icons, center mode badge (#221)"
```

---

### Task 3: Enlarge floating zone icons (#200)

**Files:**
- Modify: `js/playback.ts:418-424` (zone icon size = 2x button)
- Modify: `js/playback.ts:299-312` (use filled icons in zone)
- Modify: `css/style.css:481-499` (optional: adjust SVG % if needed)

**Step 1: Double the floating zone icon size**

In `js/playback.ts`, in `showRadialOverlay()`, change the icon size from
`r.width` (1x button) to `r.width * 2` (2x button). Line 419:

```ts
// Old:
const iconSize = r.width;
// New:
const iconSize = r.width * 2;
```

**Step 2: Use filled icons in the zone icon**

In `createZoneElements()` (line 308), change the initial icon ref:
```ts
// Old:
svgEl('use', { href: '#tabler-repeat' }),
// New:
svgEl('use', { href: '#tabler-repeat' }),  // repeat has no filled variant
```
(No change for repeat — it stays outline.)

In `updateOverlayHighlight()` (line 489), change the latch icon to filled:
```ts
// Old:
const href = zone === 'latch' ? '#tabler-lock' : '#tabler-repeat';
// New:
const href = zone === 'latch' ? '#tabler-lock-filled' : '#tabler-repeat';
```

**Step 3: Verify build and test visually**

```bash
bun run check && bun run build
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: double floating zone icon size, use filled lock (#200)"
```

---

### Task 4: Block landscape on small screens (#218)

**Files:**
- Modify: `js/splash.ts` (add landscape lock logic)
- Modify: `css/style.css` (add landscape message styles)
- Modify: `index.html` (add rotate message element)

**Step 1: Add a landscape message element to HTML**

In `index.html`, add a rotate-to-portrait message inside `#stage`, after the
credits overlay (after line 134):

```html
<div id="landscape-block" class="landscape-block hidden" aria-hidden="true">
  <p class="landscape-message">Rotate to portrait to edit</p>
</div>
```

**Step 2: Style the landscape message**

In `css/style.css`, add styles after the credits section (after line 363):

```css
/* ---- Landscape block overlay ---- */

.landscape-block {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.landscape-message {
  color: rgba(255, 255, 255, 0.6);
  font-size: 22px;
  letter-spacing: 0.04em;
  text-align: center;
}
```

**Step 3: Add landscape lock to SplashController**

In `js/splash.ts`, add a `MediaQueryList` listener that forces splash mode
when the screen is landscape and too short.

Add after the constructor (after line 46):

```ts
// Landscape lock: force splash on small landscape screens
private readonly landscapeMql: MediaQueryList;
private readonly handleLandscapeChange: (e: MediaQueryListEvent | MediaQueryList) => void;
private landscapeBlock: HTMLElement | undefined;
```

In the constructor body, after `this.handleUp = ...` (after line 45), add:

```ts
this.landscapeMql = matchMedia('(orientation: landscape) and (max-height: 500px)');
this.handleLandscapeChange = (e: MediaQueryListEvent | MediaQueryList) => {
  const matches = 'matches' in e ? e.matches : (e as MediaQueryList).matches;
  this.onLandscapeChange(matches);
};
```

Add a new public method `bindLandscapeLock()`:

```ts
/** Start monitoring for cramped landscape orientation. */
bindLandscapeLock(): void {
  this.landscapeBlock = document.getElementById('landscape-block') ?? undefined;
  this.landscapeMql.addEventListener('change', this.handleLandscapeChange as EventListener);
  // Check initial state
  this.handleLandscapeChange(this.landscapeMql);
}
```

Add a private method `onLandscapeChange`:

```ts
private onLandscapeChange(isCrampedLandscape: boolean): void {
  if (isCrampedLandscape) {
    // Force into splash mode
    this._isActive = true;
    document.body.classList.remove('is-editing');
    if (this.landscapeBlock) {
      this.landscapeBlock.classList.remove('hidden');
      this.landscapeBlock.setAttribute('aria-hidden', 'false');
    }
  } else {
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
```

Update `dispose()` to clean up:
```ts
dispose(): void {
  this.removeSplashListeners();
  this.landscapeMql.removeEventListener('change', this.handleLandscapeChange as EventListener);
}
```

**Step 4: Wire up landscape lock in app.ts**

In `js/app.ts`, after `splash.bindEvents()` (line 236), add:

```ts
splash.bindLandscapeLock();
```

**Step 5: Ensure splash dismiss is blocked in cramped landscape**

In `js/splash.ts`, guard `splashUp()` so it doesn't dismiss while in cramped
landscape. At the top of `splashUp()`:

```ts
private splashUp(): void {
  if (!this.splashPointerDown) return;
  // Don't dismiss splash in cramped landscape
  if (this.landscapeMql.matches) return;
  // ... rest of method
}
```

**Step 6: Verify build and test**

```bash
bun run check && bun run build
```

Test by resizing browser to a short-and-wide viewport (e.g., 800×400).

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: block editing in cramped landscape orientation (#218)"
```

---

### Task 5: Run full test suite and final verification

**Step 1: Run all checks**

```bash
bun run check && bun run lint && bun run test:unit
```

**Step 2: Run integration tests**

```bash
bun run test:e2e
```

**Step 3: Fix any failures**

Address any test failures from the changes above.

**Step 4: Final commit if needed**

Only if test fixes required changes.
