# Embed Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the embed viewer from scratch and add a share UI to the main app, completing the last v1 blocker (#118).

**Architecture:** Two independent deliverables — (1) a minimal press-to-play embed viewer (`embed.html` + `js/embed-entry.ts`) and (2) a share overlay in the main app (`js/share.ts` + HTML/CSS additions). Both share the existing serialization, rendering, and audio modules. The embed uses pointer events for press-and-hold playback with a 2s minimum duration.

**Tech Stack:** TypeScript, Vite (multi-entry already configured), Web Audio API, SVG rendering, CSS animations.

**Design doc:** `docs/plans/2026-03-08-embed-mode-design.md`

---

### Task 1: Rewrite embed.html

**Files:**
- Rewrite: `embed.html`

**Step 1: Replace embed.html contents**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>spatch</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html, body {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #222;
      }
      #embed {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        cursor: pointer;
        visibility: hidden;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        transition: transform 0.12s ease-out;
      }
      #embed.ready {
        visibility: visible;
      }
      #embed.pressing {
        transform: scale(0.97);
      }
      #scene-bg {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
      }
      #tile {
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, rgba(64,64,64,0.7) 0%, rgba(34,34,34,0.7) 100%);
        box-shadow:
          inset 4px 4px 12px rgba(255,255,255,0.12),
          inset -4px -4px 12px rgba(0,0,0,0.28);
      }
      svg#c {
        position: absolute;
        inset: 10px;
        display: block;
        width: calc(100% - 20px);
        height: calc(100% - 20px);
        background: transparent;
        overflow: hidden;
      }
      #spatch-link {
        position: absolute;
        bottom: 6px;
        left: 0;
        right: 0;
        text-align: center;
        z-index: 2;
      }
      #spatch-link a {
        color: rgba(255,255,255,0.5);
        text-decoration: none;
        font-family: 'Imbue', serif;
        font-size: 13px;
        letter-spacing: 0.06em;
      }
      #spatch-link a:hover {
        color: rgba(255,255,255,0.8);
      }
      /* Gleam animation */
      #embed::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 3;
        pointer-events: none;
        background: linear-gradient(
          115deg,
          transparent 0%,
          transparent 40%,
          rgba(255,255,255,0.15) 50%,
          transparent 60%,
          transparent 100%
        );
        transform: translateX(-120%);
        opacity: 0;
      }
      #embed.gleam::after {
        animation: gleam 0.8s ease-in-out forwards;
      }
      @keyframes gleam {
        0% { transform: translateX(-120%); opacity: 1; }
        100% { transform: translateX(120%); opacity: 1; }
      }
      .error-msg {
        color: #999;
        text-align: center;
        padding: 2em;
        font-family: sans-serif;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <div id="embed">
      <div id="scene-bg"></div>
      <div id="tile"></div>
      <svg id="c" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet"></svg>
      <div id="spatch-link">
        <a href="https://spatch.music/" target="_blank" rel="noopener">spatch</a>
      </div>
    </div>
    <script type="module" src="js/embed-entry.ts"></script>
  </body>
</html>
```

Key decisions:
- Scene background is a div (`#scene-bg`) behind the tile, filling edge to edge.
- Tile gradient colors are 30% more transparent (`rgba` with 0.7 alpha instead of solid).
- Inner box-shadow also reduced (~30% less opaque).
- `#spatch-link` is visible by default; hidden via `?nolink` in JS.
- Gleam animation on `::after` pseudo-element, triggered by adding `.gleam` class.
- Press-down effect via `.pressing` class with `transform: scale(0.97)`.
- ADSR corner radii applied to `#embed` and `#tile` via JS (same as main app).

**Step 2: Verify the HTML renders correctly**

Run: `bun run dev` and visit `http://localhost:5173/embed.html` — should show a dark tile (no sigil data yet, error message will show).

**Step 3: Commit**

```
git add embed.html
git commit -m "feat(embed): rewrite embed.html from scratch"
```

---

### Task 2: Rewrite embed-entry.ts

**Files:**
- Rewrite: `js/embed-entry.ts`

**Step 1: Write the new embed entry point**

```typescript
// Embed-entry.ts — Minimal press-to-play embed viewer

import { render } from './canvas/render.ts';
import { AudioEngine } from './audio/engine.ts';
import { deserializeState } from './serialize.ts';
import { updateCanvasBorderRadius } from './shapes.ts';
import { qel } from './dom.ts';
import { Vibe, setVibe } from './audio/vibe.ts';
import { getScene } from './scenes';
import { prefetchScene, loadSceneIR } from './scenes/loader';

const MIN_PLAY_MS = 2000;

const hash = globalThis.location.hash.slice(1);
if (!hash) {
  showError('No sigil data found.');
} else {
  const state = deserializeState(hash);
  if (!state) {
    showError('Invalid sigil data.');
  } else {
    boot(state);
  }
}

function showError(msg: string): void {
  const p = document.createElement('p');
  p.className = 'error-msg';
  p.textContent = msg;
  document.body.replaceChildren(p);
}

function boot(sigil: ReturnType<typeof deserializeState> & object): void {
  // Hide spatch link if ?nolink is set
  if (new URLSearchParams(globalThis.location.search).has('nolink')) {
    const linkEl = document.getElementById('spatch-link');
    if (linkEl) linkEl.style.display = 'none';
  }

  // Set the spatch link href to the full app with same hash
  {
    const linkAnchor = document.querySelector('#spatch-link a') as HTMLAnchorElement | null;
    if (linkAnchor) {
      linkAnchor.href = `https://spatch.music/#${globalThis.location.hash.slice(1)}`;
    }
  }

  // Scene + vibe
  const sceneDef = getScene(sigil.scene);
  setVibe(new Vibe(sceneDef?.vibe));
  const sceneReady = prefetchScene(sceneDef);

  // DOM
  const embed = qel('#embed');
  const sceneBg = qel('#scene-bg');
  const tile = qel('#tile');
  const svgRoot = qel<SVGSVGElement>('#c');

  // Audio
  const audio = new AudioEngine();

  // Pre-warm AudioContext on first qualifying gesture
  {
    const warmUpEvents = ['touchend', 'click', 'keydown'] as const;
    function onFirstGesture(): void {
      audio.warmUp();
      for (const evt of warmUpEvents) {
        document.removeEventListener(evt, onFirstGesture);
      }
    }
    for (const evt of warmUpEvents) {
      document.addEventListener(evt, onFirstGesture);
    }
  }

  // ADSR corner radii (static — only set once)
  updateCanvasBorderRadius(embed, sigil.envelope);
  updateCanvasBorderRadius(tile, sigil.envelope);
  updateCanvasBorderRadius(svgRoot, sigil.envelope, 10);

  // Initial render (one-shot — state never changes in embed)
  render(svgRoot, sigil, undefined);

  // Reveal after scene assets loaded
  sceneReady.then(() => {
    sceneBg.style.backgroundImage = `url(${sceneDef.stageBackground})`;
    embed.classList.add('ready');

    // Gleam on load
    requestAnimationFrame(() => {
      embed.classList.add('gleam');
    });
  });

  // ---- Press-to-play interaction ----

  let playing = false;
  let playStartTime = 0;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;

  async function startPlay(): Promise<void> {
    if (playing) return;
    if (sigil.voices.length === 0) return;

    playing = true;
    playStartTime = Date.now();
    embed.classList.add('pressing');

    audio.warmUp();
    await sceneReady;
    const irBuffer = audio.audioCtx
      ? await loadSceneIR(audio.audioCtx, sceneDef)
      : undefined;
    await audio.play(sigil, sigil.envelope, { irBuffer });
  }

  function stopPlay(): void {
    if (!playing) return;

    const elapsed = Date.now() - playStartTime;
    const remaining = MIN_PLAY_MS - elapsed;

    if (remaining > 0) {
      // Hold for minimum duration, then release
      releaseTimer = setTimeout(() => {
        doRelease();
      }, remaining);
    } else {
      doRelease();
    }
  }

  function doRelease(): void {
    embed.classList.remove('pressing');
    audio.release(sigil.envelope);
    playing = false;
    releaseTimer = undefined;
  }

  // Pointer events for press-and-hold
  embed.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    startPlay();
  });

  embed.addEventListener('pointerup', () => {
    stopPlay();
  });

  embed.addEventListener('pointerleave', () => {
    stopPlay();
  });

  embed.addEventListener('pointercancel', () => {
    stopPlay();
  });

  // Prevent context menu on long-press (mobile)
  embed.addEventListener('contextmenu', (e: Event) => {
    e.preventDefault();
  });

  // Touch events: prevent scroll while pressing on embed
  embed.addEventListener('touchstart', (e: TouchEvent) => {
    e.preventDefault();
  }, { passive: false });
}
```

Key decisions:
- `showError()` uses `document.createElement()` + `textContent` (no raw HTML injection).
- `boot()` receives validated state, handles all setup.
- Single `render()` call — no animation loop. State is static.
- `pointerdown` → `startPlay()`, `pointerup`/`pointerleave`/`pointercancel` → `stopPlay()`.
- Minimum 2s: if released before 2s, a `setTimeout` delays the `doRelease()`.
- `.pressing` class added/removed for the scale-down effect.
- Gleam fires once via `.gleam` class after reveal.
- `?nolink` param hides the spatch link.
- `touchstart` preventDefault stops scroll while pressing.
- `contextmenu` preventDefault stops long-press menus on mobile.

**Step 2: Typecheck**

Run: `bun run check`
Expected: PASS (no type errors)

**Step 3: Verify manually**

Run: `bun run dev`, navigate to `http://localhost:5173/embed.html#<valid-hash>`.
- Scene background should show through the semi-transparent tile.
- Gleam should sweep on load.
- Press-and-hold should play audio and scale down.
- Release should stop (after 2s minimum).

**Step 4: Commit**

```
git add js/embed-entry.ts
git commit -m "feat(embed): rewrite embed-entry.ts with press-to-play"
```

---

### Task 3: Write embed integration test

**Files:**
- Create: `tests/integration/embed.test.js`

**Step 1: Write the test**

```javascript
import { expect, test } from '@playwright/test';

test.describe('Embed viewer', () => {
  test('shows error without hash', async ({ page }) => {
    await page.goto('/embed.html');
    const msg = page.locator('.error-msg');
    await expect(msg).toBeVisible();
    await expect(msg).toHaveText('No sigil data found.');
  });

  test('renders sigil from valid hash', async ({ page }) => {
    // Create a sigil in the main app and capture the hash
    await page.addInitScript(() => {
      globalThis.localStorage.setItem('spatch-splash-seen', '1');
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Wait for hash
    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });
    const hash = await page.evaluate(() => globalThis.location.hash);

    // Navigate to embed with captured hash
    await page.goto(`/embed.html${hash}`);
    const svg = page.locator('svg#c');
    await expect(svg).toBeVisible();

    // Should have at least one rendered shape
    const shapes = svg.locator('[data-voice-id]');
    await expect(shapes).toHaveCount(1);
  });

  test('embed becomes visible after scene loads', async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem('spatch-splash-seen', '1');
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });
    const hash = await page.evaluate(() => globalThis.location.hash);

    await page.goto(`/embed.html${hash}`);
    const embed = page.locator('#embed');
    await expect(embed).toHaveClass(/ready/, { timeout: 5000 });
  });

  test('hides spatch link when ?nolink is set', async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem('spatch-splash-seen', '1');
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });
    const hash = await page.evaluate(() => globalThis.location.hash);

    await page.goto(`/embed.html?nolink${hash}`);
    const link = page.locator('#spatch-link');
    await expect(link).toBeHidden();
  });
});
```

**Step 2: Run the test**

Run: `bun run test:e2e -- tests/integration/embed.test.js`
Expected: All tests pass. If the dev server isn't running, start it first with `bun run dev`.

**Step 3: Commit**

```
git add tests/integration/embed.test.js
git commit -m "test(embed): integration tests for embed viewer"
```

---

### Task 4: Add share button and overlay HTML to index.html

**Files:**
- Modify: `index.html:89-91` (after credits button, before credits overlay)
- Modify: `index.html:118` (after credits overlay, before landscape block)

**Step 1: Add share button after credits button**

After line 91 (the closing `</button>` of `btn-credits`), add:
```html
        <button id="btn-share" class="share-btn" title="Share">
          <svg width="22" height="22"><use href="tabler-sprite.svg#tabler-share-2" /></svg>
        </button>
```

**Step 2: Add share overlay after credits overlay**

After the credits overlay closing `</div>` (line 118), add:
```html
        <div id="share-overlay" class="share-overlay hidden" aria-hidden="true">
          <div class="share-content">
            <div class="share-section">
              <label class="share-label">Link</label>
              <div class="share-copy-row">
                <code id="share-link" class="share-code"></code>
                <button id="btn-copy-link" class="share-copy-btn" title="Copy link">
                  <svg width="16" height="16"><use href="tabler-sprite.svg#tabler-copy" /></svg>
                </button>
              </div>
            </div>
            <div class="share-section">
              <label class="share-label">Embed</label>
              <div class="share-control-row">
                <span class="share-control-label">Size</span>
                <input type="range" id="share-size" min="150" max="600" value="300" />
                <span id="share-size-value" class="share-control-value">300</span>
              </div>
              <div class="share-control-row">
                <label class="share-checkbox-label">
                  <input type="checkbox" id="share-show-link" checked />
                  Show spatch link
                </label>
              </div>
              <div class="share-copy-row">
                <code id="share-embed-code" class="share-code share-code-multi"></code>
                <button id="btn-copy-embed" class="share-copy-btn" title="Copy embed code">
                  <svg width="16" height="16"><use href="tabler-sprite.svg#tabler-copy" /></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
```

**Step 3: Verify HTML is well-formed**

Run: `bun run check`
Expected: PASS

**Step 4: Commit**

```
git add index.html
git commit -m "feat(share): add share button and overlay HTML"
```

---

### Task 5: Add share UI styles to style.css

**Files:**
- Modify: `css/style.css` (add after credits styles, around line 361)

**Step 1: Add share button and overlay CSS**

Add after the `.credits-list a:hover` rule (line 358–360):

```css
/* ---- Share button ---- */

.share-btn {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: none;
  color: #fff;
  cursor: pointer;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.6));
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}

body.is-editing .share-btn {
  opacity: 0.5;
  pointer-events: auto;
}

body.is-editing .share-btn:hover {
  opacity: 0.8;
}

/* ---- Share overlay ---- */

.share-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  cursor: pointer;
}

.share-overlay.hidden {
  display: none !important;
}

.share-content {
  position: absolute;
  bottom: 0;
  right: 0;
  left: 0;
  padding: 24px;
  color: #fff;
  font-family: 'Imbue', serif;
  pointer-events: auto;
  cursor: default;
}

.share-section {
  margin-bottom: 20px;
}

.share-section:last-child {
  margin-bottom: 0;
}

.share-label {
  display: block;
  font-size: 18px;
  letter-spacing: 0.04em;
  opacity: 0.75;
  margin-bottom: 8px;
}

.share-copy-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.share-code {
  flex: 1;
  display: block;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.8);
  font-family: monospace;
  font-size: 11px;
  line-height: 1.4;
  word-break: break-all;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.share-code-multi {
  white-space: pre-wrap;
  word-break: break-all;
}

.share-copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  min-height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
}

.share-copy-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.share-control-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
}

.share-control-label {
  min-width: 32px;
}

.share-control-row input[type="range"] {
  flex: 1;
  accent-color: #fff;
}

.share-control-value {
  min-width: 28px;
  text-align: right;
  font-family: monospace;
  font-size: 12px;
}

.share-checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
}

.share-checkbox-label input[type="checkbox"] {
  accent-color: #fff;
}
```

**Step 2: Verify styles compile**

Run: `bun run build`
Expected: PASS

**Step 3: Commit**

```
git add css/style.css
git commit -m "feat(share): add share overlay styles"
```

---

### Task 6: Create js/share.ts

**Files:**
- Create: `js/share.ts`

**Step 1: Write the share module**

```typescript
// share.ts — Share overlay: link + embed snippet generation
//
// Icon references for sprite scanner: #tabler-share-2 #tabler-copy

import type { AudioEngine } from './audio/engine.ts';
import { qel } from './dom.ts';
import { serializeState } from './serialize.ts';
import type { SigilStore } from './state.ts';

const EMBED_BASE_URL = 'https://spatch.music/embed.html';
const APP_BASE_URL = 'https://spatch.music/';

export function initShare(audio: AudioEngine, store: SigilStore): void {
  const btn = qel('#btn-share');
  const overlay = qel('#share-overlay');
  const linkCode = qel('#share-link');
  const embedCode = qel('#share-embed-code');
  const sizeSlider = qel<HTMLInputElement>('#share-size');
  const sizeValue = qel('#share-size-value');
  const showLinkCheckbox = qel<HTMLInputElement>('#share-show-link');
  const copyLinkBtn = qel('#btn-copy-link');
  const copyEmbedBtn = qel('#btn-copy-embed');

  let currentHash = '';

  function updateSnippets(): void {
    const size = sizeSlider.value;
    sizeValue.textContent = size;

    const linkUrl = `${APP_BASE_URL}#${currentHash}`;
    linkCode.textContent = linkUrl;

    const nolink = showLinkCheckbox.checked ? '' : '?nolink';
    const embedUrl = `${EMBED_BASE_URL}${nolink}#${currentHash}`;
    embedCode.textContent =
      `<iframe src="${embedUrl}" width="${size}" height="${size}" style="border:none"></iframe>`;
  }

  function show(): void {
    // Generate fresh hash from current state
    if (store.data.voices.length === 0) return;
    currentHash = serializeState(store.data);

    updateSnippets();
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
    if ((e.target as HTMLElement).closest('.share-content')) return;
    hide();
  });

  sizeSlider.addEventListener('input', updateSnippets);
  showLinkCheckbox.addEventListener('change', updateSnippets);

  copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(linkCode.textContent || '');
  });

  copyEmbedBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(embedCode.textContent || '');
  });
}
```

Key decisions:
- `initShare()` takes both `audio` (for muffle) and `store` (for serialization).
- Hash is generated fresh on every `show()` from current store state.
- `updateSnippets()` re-renders both link and embed code when slider/checkbox change.
- All content set via `textContent` — no raw HTML injection.
- Share button does nothing if canvas is empty (no voices).
- Pattern mirrors `initCredits()`: toggle overlay, muffle/unmuffle audio.

**Step 2: Typecheck**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```
git add js/share.ts
git commit -m "feat(share): create share module with link + embed snippet generation"
```

---

### Task 7: Wire share into app.ts

**Files:**
- Modify: `js/app.ts:19` (add import)
- Modify: `js/app.ts:257` (add initShare call)

**Step 1: Add import**

After `import { initCredits } from './credits.ts';` (line 19), add:
```typescript
import { initShare } from './share.ts';
```

**Step 2: Add init call**

After `initCredits(audio, store);` (line 257), add:
```typescript
initShare(audio, store);
```

**Step 3: Typecheck**

Run: `bun run check`
Expected: PASS

**Step 4: Commit**

```
git add js/app.ts
git commit -m "feat(share): wire share overlay into main app"
```

---

### Task 8: Write share integration test

**Files:**
- Create: `tests/integration/share.test.js`

**Step 1: Write the test**

```javascript
import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Share overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
  });

  test('share button opens overlay with link and embed code', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // Place a shape so there's something to share
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Wait for URL hash to be set
    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });

    // Click share button
    await page.click('#btn-share');

    // Overlay should be visible
    const overlay = page.locator('#share-overlay');
    await expect(overlay).toBeVisible();

    // Link code should contain spatch.music
    const linkCode = page.locator('#share-link');
    const linkText = await linkCode.textContent();
    expect(linkText).toContain('spatch.music');

    // Embed code should contain iframe
    const embedCode = page.locator('#share-embed-code');
    const embedText = await embedCode.textContent();
    expect(embedText).toContain('<iframe');
    expect(embedText).toContain('embed.html');
  });

  test('size slider updates embed snippet', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });

    await page.click('#btn-share');

    // Change size slider
    await page.fill('#share-size', '450');
    await page.dispatchEvent('#share-size', 'input');

    const embedText = await page.locator('#share-embed-code').textContent();
    expect(embedText).toContain('width="450"');
    expect(embedText).toContain('height="450"');
  });

  test('nolink checkbox updates embed snippet', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });

    await page.click('#btn-share');

    // Uncheck "Show spatch link"
    await page.uncheck('#share-show-link');

    const embedText = await page.locator('#share-embed-code').textContent();
    expect(embedText).toContain('?nolink');
  });

  test('clicking overlay background dismisses it', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
      timeout: 3000,
    });

    await page.click('#btn-share');
    const overlay = page.locator('#share-overlay');
    await expect(overlay).toBeVisible();

    // Click overlay background (top-left corner, outside content)
    await overlay.click({ position: { x: 10, y: 10 } });
    await expect(overlay).toBeHidden();
  });
});
```

**Step 2: Run the tests**

Run: `bun run test:e2e -- tests/integration/share.test.js`
Expected: All tests pass.

**Step 3: Commit**

```
git add tests/integration/share.test.js
git commit -m "test(share): integration tests for share overlay"
```

---

### Task 9: Build verification and final polish

**Files:**
- No new files — verification only.

**Step 1: Full typecheck**

Run: `bun run check`
Expected: PASS

**Step 2: Full lint**

Run: `bun run lint`
Expected: PASS (or only pre-existing warnings)

**Step 3: Full test suite**

Run: `bun run test`
Expected: All unit + integration tests pass.

**Step 4: Production build**

Run: `bun run build`
Expected: PASS. Both `dist/index.html` and `dist/embed.html` present.

**Step 5: Manual smoke test**

1. `bun run preview`
2. Open main app, create a sigil, click share button → overlay appears
3. Copy link → paste in new tab → sigil loads correctly
4. Copy embed code → paste into a test HTML file → iframe renders the embed
5. In the embed: press and hold → audio plays, tile scales down → release → audio stops
6. Verify gleam animation on embed load
7. Verify `?nolink` hides the spatch link
8. Verify minimum 2s play on quick tap

**Step 6: Commit any final fixes, then done**

```
git add -A
git commit -m "feat(embed): complete embed rewrite and share UI (#118)"
```
