# Path-Based Routing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move spatch URLs from hash-based (`/#base64data`) to path-based (`/p/base64data`) with browser history support, nginx SPA fallback, and Vite dev server rewriting.

**Architecture:** `serialize.ts` becomes the URL routing layer — reading/writing paths instead of hashes, with a dirty flag for push-vs-replace history behavior. A `popstate` listener in `app.ts` handles back/forward. nginx and Vite dev server both get SPA fallback rules. Integration tests update from hash assertions to path assertions.

**Tech Stack:** TypeScript, Vite (configureServer middleware), nginx, Playwright

**Spec:** `docs/superpowers/specs/2026-03-13-path-based-routing-design.md`

---

## Chunk 1: Core Routing (serialize.ts + nginx + Vite dev server)

### Task 1: Update `serialize.ts` — path-based `loadFromURL` and `saveToURL`

**Files:**
- Modify: `js/serialize.ts:57-70` (saveToURL, loadFromURL)
- Test: `tests/unit/serialize.test.js` (existing, add new tests)

- [ ] **Step 1: Write failing unit tests for path-based URL helpers**

Add to `tests/unit/serialize.test.js`. First, update the import at the top of the file:

```js
import { deserializeState, pathToState, serializeState, stateToPath } from '../../js/serialize.ts';
```

Then add the new describe block:

```js
describe('URL path helpers', () => {
  test('stateToPath produces /p/ path', () => {
    const state = makeState({
      voices: [makeVoice()],
    });
    const encoded = serializeState(state);
    const path = stateToPath(state);
    expect(path).toBe(`/p/${encoded}`);
  });

  test('stateToPath produces / for empty voices', () => {
    const state = makeState();
    expect(stateToPath(state)).toBe('/');
  });

  test('pathToState parses /p/<data>', () => {
    const state = makeState({ voices: [makeVoice()] });
    const encoded = serializeState(state);
    const parsed = pathToState(`/p/${encoded}`);
    expect(parsed).not.toBeUndefined();
    expect(parsed.voices).toHaveLength(1);
    expect(parsed.voices[0].x).toBeCloseTo(0.5);
  });

  test('pathToState returns undefined for /', () => {
    expect(pathToState('/')).toBeUndefined();
  });

  test('pathToState returns undefined for non-/p/ paths', () => {
    expect(pathToState('/vibecheck')).toBeUndefined();
    expect(pathToState('/embed/foo')).toBeUndefined();
  });

  test('pathToState returns undefined for invalid data', () => {
    expect(pathToState('/p/!!invalid!!')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:unit -- tests/unit/serialize.test.js`
Expected: FAIL — `stateToPath` and `pathToState` are not defined

- [ ] **Step 3: Implement `stateToPath` and `pathToState`**

In `js/serialize.ts`, add two new exported functions:

```ts
/** Convert sigil state to a URL path. Returns '/' if no voices. */
export function stateToPath(state: SigilData): string {
  if (state.voices.length === 0) return '/';
  return '/p/' + serializeState(state);
}

/** Parse a URL pathname into sigil state. Returns undefined if path is not a /p/ route or data is invalid. */
export function pathToState(pathname: string): SigilData | undefined {
  if (!pathname.startsWith('/p/')) return undefined;
  const data = pathname.slice(3);
  return deserializeState(data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:unit -- tests/unit/serialize.test.js`
Expected: All PASS

- [ ] **Step 5: Update `loadFromURL` to read from path with hash migration**

Replace the existing `loadFromURL` function:

```ts
/** Read and deserialize state from the current URL path, or undefined if empty/invalid.
 *  Migrates old hash-based URLs to path form via replaceState. */
export function loadFromURL(): SigilData | undefined {
  // Hash migration: old URLs stored state in the hash fragment
  const hash = globalThis.location.hash.slice(1);
  if (hash) {
    const state = deserializeState(hash);
    if (state) {
      const path = stateToPath(state);
      history.replaceState(null, '', path);
      return state;
    }
  }
  return pathToState(globalThis.location.pathname);
}
```

- [ ] **Step 6: Update `saveToURL` with dirty flag and push/replace logic**

Replace the existing `saveToURL` function and add the dirty flag:

```ts
/** Whether the URL has been modified since the last navigation event. */
let dirty = false;

/** Reset the dirty flag (called on popstate). */
export function resetDirty(): void {
  dirty = false;
}

/** Serialize state and write it to the URL path via pushState or replaceState. */
export function saveToURL(state: SigilData): void {
  const path = stateToPath(state);
  if (path === globalThis.location.pathname) return;
  if (dirty) {
    history.replaceState(null, '', path);
  } else {
    history.pushState(null, '', path);
    dirty = true;
  }
}
```

- [ ] **Step 7: Run unit tests**

Run: `bun run test:unit -- tests/unit/serialize.test.js`
Expected: All PASS

- [ ] **Step 8: Run typecheck**

Run: `bun run check`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add js/serialize.ts tests/unit/serialize.test.js
git commit -m "feat: path-based URL routing in serialize.ts with hash migration"
```

### Task 2: Add nginx SPA fallback config

**Files:**
- Create: `nginx.conf`

- [ ] **Step 1: Create `nginx.conf`**

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # Embed viewer: /embed/ and /embed/<data> → embed.html
    location ~ ^/embed/ {
        try_files /embed.html =404;
    }

    # Everything else: /p/<data>, /, etc. → index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add nginx.conf
git commit -m "feat: add nginx SPA fallback config"
```

### Task 3: Update deploy workflow to copy nginx config

**Files:**
- Modify: `.gitea/workflows/deploy.yml:47-48`

- [ ] **Step 1: Update the "Build and deploy" step**

Change the run block from:

```yaml
run: |
  bun run build
  docker cp dist/. spatch:/usr/share/nginx/html/
```

to:

```yaml
run: |
  bun run build
  docker cp dist/. spatch:/usr/share/nginx/html/
  docker cp nginx.conf spatch:/etc/nginx/conf.d/default.conf
  docker exec spatch nginx -s reload
```

- [ ] **Step 2: Commit**

```bash
git add .gitea/workflows/deploy.yml
git commit -m "feat: deploy nginx config and reload on deploy"
```

### Task 4: Add Vite dev server SPA fallback middleware

**Files:**
- Modify: `vite.config.ts:79-82` (server config)

- [ ] **Step 1: Add a SPA fallback plugin to vite.config.ts**

Add a new plugin function before the `defineConfig` call:

```ts
function spaFallbackPlugin(): Plugin {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      // Runs after Vite's built-in middleware (return callback)
      return () => {
        server.middlewares.use((req, _res, next) => {
          // Skip files with extensions (actual assets)
          if (req.url && /\.\w+(\?|$)/.test(req.url)) {
            return next();
          }
          // /embed/<anything> → /embed.html
          if (req.url?.startsWith('/embed/')) {
            req.url = '/embed.html';
          }
          // /p/<anything> or other paths → /index.html
          else if (req.url !== '/' && req.url !== '/index.html' && req.url !== '/embed.html') {
            req.url = '/index.html';
          }
          next();
        });
      };
    },
  };
}
```

Then add `spaFallbackPlugin()` to the `plugins` array.

- [ ] **Step 2: Start dev server and verify manually**

Run: `bun run dev` and open `http://localhost:5173/p/test` in a browser.
Expected: The main app loads (index.html) without a 404.

Run: Open `http://localhost:5173/embed/test` in a browser.
Expected: The embed page loads (embed.html) without a 404.

- [ ] **Step 3: Run typecheck**

Run: `bun run check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts
git commit -m "feat: add Vite dev server SPA fallback for path-based routing"
```

## Chunk 2: App Integration (app.ts, share.ts, embed-entry.ts)

### Task 5: Update `app.ts` — popstate listener and navigation guard

**Files:**
- Modify: `js/app.ts:270-284` (debouncedSave), `js/app.ts:9` (imports), `js/app.ts:72-79` (loadFromURL)

- [ ] **Step 1: Add `resetDirty` to serialize.ts imports**

In `js/app.ts` line 9, change:

```ts
import { loadFromURL, saveToURL } from './serialize.ts';
```

to:

```ts
import { loadFromURL, pathToState, resetDirty, saveToURL } from './serialize.ts';
```

- [ ] **Step 2: Add navigation guard flag and update `debouncedSave`**

Replace the auto-save section (lines 270-284) with:

```ts
// ---- Auto-save to URL (debounced) ----

let navigating = false;
let saveTimeout: ReturnType<typeof setTimeout> | undefined;
function debouncedSave(): void {
  if (navigating) return;
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    if (store.data.voices.length > 0) {
      saveToURL(store.data);
    } else if (location.pathname !== '/') {
      history.replaceState(null, '', '/');
    }
  }, 1000);
}
```

- [ ] **Step 3: Add `popstate` event listener**

After the `debouncedSave` function, add:

```ts
// ---- History navigation (back/forward) ----

window.addEventListener('popstate', () => {
  // Cancel any pending debounced save
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = undefined;
  }

  const state = pathToState(location.pathname);
  navigating = true;
  if (state) {
    store.loadState(state);
  } else {
    // Navigated back to empty canvas — load current state with voices cleared
    store.loadState({ ...store.data, voices: [] });
  }
  navigating = false;
  resetDirty();
  selection.clear();
  needsRender = true;
});
```

- [ ] **Step 4: Run typecheck**

Run: `bun run check`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add js/app.ts
git commit -m "feat: add popstate handler and navigation guard for path-based routing"
```

### Task 6: Update `share.ts` — path-based link generation

**Files:**
- Modify: `js/share.ts:10-16` (appBaseUrl, embedBaseUrl), `js/share.ts:41-45` (updateSnippets)

- [ ] **Step 1: Update URL construction**

Change `appBaseUrl()` (line 10-12):

```ts
function appBaseUrl(): string {
  return `${globalThis.location.origin}/p/`;
}
```

Change `embedBaseUrl()` (line 14-16):

```ts
function embedBaseUrl(): string {
  return `${globalThis.location.origin}/embed/`;
}
```

Change `updateSnippets()` link construction (lines 41-45):

```ts
function updateSnippets(): void {
  const size = sizeSlider.value;
  sizeValue.textContent = size;

  const linkUrl = `${appBaseUrl()}${currentHash}`;
  linkCode.textContent = linkUrl;

  const embedUrl = `${embedBaseUrl()}${currentHash}`;
  embedCode.textContent = `<iframe src="${embedUrl}" width="${size}" height="${size}" style="border:none"></iframe>`;
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add js/share.ts
git commit -m "feat: path-based share links"
```

### Task 7: Update `embed-entry.ts` — read from pathname with hash migration

**Files:**
- Modify: `js/embed-entry.ts:15-25`

- [ ] **Step 1: Replace hash reading with pathname reading + hash migration**

Replace lines 15-25:

```ts
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
```

with:

```ts
function loadEmbedState(): SigilData | undefined {
  // Hash migration: old embed URLs stored state in the hash
  const hash = globalThis.location.hash.slice(1);
  if (hash) {
    const state = deserializeState(hash);
    if (state) {
      const path = '/embed/' + serializeState(state);
      history.replaceState(null, '', path);
      return state;
    }
    // Hash present but invalid
    return undefined;
  }
  // Read from pathname: /embed/<data>
  const pathname = globalThis.location.pathname;
  if (pathname.startsWith('/embed/') && pathname.length > 7) {
    return deserializeState(pathname.slice(7));
  }
  return undefined;
}

const state = loadEmbedState();
if (!state) {
  const hasData = globalThis.location.hash.length > 1 ||
    (globalThis.location.pathname.startsWith('/embed/') && globalThis.location.pathname.length > 7);
  showError(hasData ? 'Invalid sigil data.' : 'No sigil data found.');
} else {
  boot(state);
}
```

Also add `serializeState` to the import from `./serialize.ts` (line 6):

```ts
import { deserializeState, serializeState } from './serialize.ts';
```

- [ ] **Step 2: Run typecheck**

Run: `bun run check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add js/embed-entry.ts
git commit -m "feat: embed reads from pathname with hash migration"
```

## Chunk 3: Test Updates

### Task 8: Update integration tests — serialization

**Files:**
- Modify: `tests/integration/serialization.test.js`

- [ ] **Step 1: Update hash-based assertions to path-based**

Replace the entire file content. Key changes:
- `location.hash` checks become `location.pathname` checks
- Wait for `pathname.startsWith('/p/')` instead of `hash.length > 1`
- Navigation uses `/p/<data>` instead of `/#<data>`

```js
import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Serialization round-trip', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
  });

  test('placing shapes updates URL path', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    // Initially at root
    const initialPath = await page.evaluate(() => globalThis.location.pathname);
    expect(initialPath).toBe('/');

    // Place a shape
    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Wait for debounced save (1s + buffer)
    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/p/'), undefined, {
      timeout: 3000,
    });
    const pathname = await page.evaluate(() => globalThis.location.pathname);
    expect(pathname).toMatch(/^\/p\/.+/);
  });

  test('navigating to a URL with path restores shapes', async ({ page }) => {
    // Step 1: Place shapes and capture the path
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="triangle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });

    // Deselect so tool buttons become visible again
    await page.keyboard.press('Escape');

    await page.click('[data-tool="square"]');
    await canvas.click({ position: { x: box.width * 0.7, y: box.height * 0.7 } });

    // Wait for URL to update
    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/p/'), undefined, {
      timeout: 3000,
    });
    const pathname = await page.evaluate(() => globalThis.location.pathname);

    // Step 2: Navigate to a new page with the same path
    await page.goto(pathname);
    await page.waitForSelector('#sigil-canvas');

    // Wait for render cycle
    await page.waitForTimeout(500);

    // Verify the state was loaded by checking the path persists
    const restoredPath = await page.evaluate(() => globalThis.location.pathname);
    expect(restoredPath).toBe(pathname);
  });

  test('canvas renders consistently before and after round-trip', async ({ page }) => {
    // Step 1: Create a sigil and screenshot
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Deselect so selection UI doesn't affect comparison
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const screenshot1 = await canvas.screenshot();

    // Step 2: Get path and reload
    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/p/'), undefined, {
      timeout: 3000,
    });
    const pathname = await page.evaluate(() => globalThis.location.pathname);

    await page.goto(pathname);
    await page.waitForSelector('#sigil-canvas');
    await page.waitForTimeout(500);

    const screenshot2 = await canvas.screenshot();

    // Screenshots should be similar
    expect(screenshot1.length).toBeGreaterThan(100);
    expect(screenshot2.length).toBeGreaterThan(100);
    const ratio = screenshot1.length / screenshot2.length;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });

  test('old hash URLs are migrated to path URLs', async ({ page }) => {
    // Create a sigil, capture path data, then navigate via old hash URL
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/p/'), undefined, {
      timeout: 3000,
    });
    const pathname = await page.evaluate(() => globalThis.location.pathname);
    const data = pathname.slice(3); // strip /p/

    // Navigate using old hash-based URL format
    await page.goto('/#' + data);
    await page.waitForSelector('#sigil-canvas');
    await page.waitForTimeout(500);

    // Should have been migrated to path form
    const migratedPath = await page.evaluate(() => globalThis.location.pathname);
    expect(migratedPath).toBe(pathname);
    const migratedHash = await page.evaluate(() => globalThis.location.hash);
    expect(migratedHash).toBe('');
  });
});
```

- [ ] **Step 2: Run integration tests (serialization only)**

Run: `bun run test:e2e -- tests/integration/serialization.test.js`
Expected: All PASS (after dev server is running)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/serialization.test.js
git commit -m "test: update serialization tests for path-based URLs"
```

### Task 9: Update integration tests — share overlay

**Files:**
- Modify: `tests/integration/share.test.js`

- [ ] **Step 1: Update share test assertions**

Key changes: wait for `pathname.startsWith('/p/')` instead of `hash.length > 1`, and assert link contains `/p/` and embed contains `/embed/` instead of `/#` and `embed.html`.

In the first test (`share button opens overlay with link and embed code`), change:

```js
// Wait for URL hash to be set
await page.waitForFunction(() => globalThis.location.hash.length > 1, undefined, {
  timeout: 3000,
});
```

to:

```js
// Wait for URL path to be set
await page.waitForFunction(() => globalThis.location.pathname.startsWith('/p/'), undefined, {
  timeout: 3000,
});
```

Change the link assertion:

```js
expect(linkText).toContain('/#');
```

to:

```js
expect(linkText).toContain('/p/');
```

Change the embed assertion:

```js
expect(embedText).toContain('embed.html');
```

to:

```js
expect(embedText).toContain('/embed/');
```

Apply the same `waitForFunction` change in the `size slider updates embed snippet` and `clicking overlay background dismisses it` tests — replace every `location.hash.length > 1` wait with `location.pathname.startsWith('/p/')`.

- [ ] **Step 2: Run integration tests (share only)**

Run: `bun run test:e2e -- tests/integration/share.test.js`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/share.test.js
git commit -m "test: update share tests for path-based URLs"
```

### Task 10: Update integration tests — embed viewer

**Files:**
- Modify: `tests/integration/embed.test.js`

- [ ] **Step 1: Update embed test URLs and assertions**

Key changes:
- Navigate to `/embed/` path instead of `/embed.html#`
- Error test navigates to `/embed/` (no data) instead of `/embed.html`
- Wait for `pathname.startsWith('/p/')` instead of `hash.length > 1`

Replace the file:

```js
import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Embed viewer', () => {
  test('shows error without data', async ({ page }) => {
    await page.goto('/embed/');
    const msg = page.locator('.error-msg');
    await expect(msg).toBeVisible();
    await expect(msg).toHaveText('No sigil data found.');
  });

  test('renders sigil from valid path', async ({ page }) => {
    // Create a sigil in the main app and capture the data
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    // Wait for path
    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/p/'), undefined, {
      timeout: 3000,
    });
    const data = await page.evaluate(() => globalThis.location.pathname.slice(3));

    // Navigate to embed with captured data
    await page.goto(`/embed/${data}`);
    const svg = page.locator('svg#c');
    await expect(svg).toBeVisible();

    // Should have at least one rendered shape
    const shapes = svg.locator('[data-voice-id]');
    await expect(shapes).toHaveCount(1);
  });

  test('embed becomes visible after scene loads', async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/p/'), undefined, {
      timeout: 3000,
    });
    const data = await page.evaluate(() => globalThis.location.pathname.slice(3));

    await page.goto(`/embed/${data}`);
    const embed = page.locator('#embed');
    await expect(embed).toHaveClass(/ready/, { timeout: 5000 });
  });

  test('old hash embed URLs are migrated to path URLs', async ({ page }) => {
    await page.addInitScript({ path: path.join(import.meta.dirname, 'helpers/skip-splash.js') });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');

    await page.click('[data-tool="circle"]');
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await page.waitForFunction(() => globalThis.location.pathname.startsWith('/p/'), undefined, {
      timeout: 3000,
    });
    const data = await page.evaluate(() => globalThis.location.pathname.slice(3));

    // Navigate using old hash-based embed URL
    await page.goto(`/embed.html#${data}`);
    await page.waitForTimeout(500);

    // Should have migrated to path form
    const pathname = await page.evaluate(() => globalThis.location.pathname);
    expect(pathname).toBe(`/embed/${data}`);
  });
});
```

- [ ] **Step 2: Run integration tests (embed only)**

Run: `bun run test:e2e -- tests/integration/embed.test.js`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/embed.test.js
git commit -m "test: update embed tests for path-based URLs"
```

### Task 11: Update integration tests — splash screen

**Files:**
- Modify: `tests/integration/splash.test.js`
- Modify: `tests/integration/helpers/skip-splash.js`

- [ ] **Step 1: Update `skip-splash.js` helper**

The helper currently sets `spatch-seen:${location.pathname}${location.hash}`.
With path-based URLs, the hash will be empty. The helper still works correctly
since it reads `location.pathname` (which will be `/` or `/p/<data>`). No
changes needed to the helper itself — it adapts automatically.

However, the splash tests hard-code specific keys. Update `tests/integration/splash.test.js`:

In the `is-editing class is present on repeat visit` test, change the `addInitScript`:

```js
await page.addInitScript(() => {
  localStorage.setItem('spatch-seen:/', '1');
});
```

This stays the same — visiting `/` still produces key `spatch-seen:/`.

In the `splash is URL-specific` test, change:

```js
await page.addInitScript(() => {
  localStorage.setItem('spatch-seen:/', '1');
});
await page.goto('/#somehash');
```

to:

```js
await page.addInitScript(() => {
  localStorage.setItem('spatch-seen:/', '1');
});
await page.goto('/p/somehash');
```

In the `localStorage is set after splash completes` test, the assertion:

```js
const key = await page.evaluate(() => localStorage.getItem('spatch-seen:/'));
```

stays the same — visiting `/` produces key `spatch-seen:/`.

- [ ] **Step 2: Run integration tests (splash only)**

Run: `bun run test:e2e -- tests/integration/splash.test.js`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/splash.test.js
git commit -m "test: update splash tests for path-based URLs"
```

### Task 12: Run full test suite and typecheck

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `bun run check`
Expected: No errors

- [ ] **Step 2: Run linter**

Run: `bun run lint`
Expected: No errors

- [ ] **Step 3: Run unit tests**

Run: `bun run test:unit`
Expected: All PASS

- [ ] **Step 4: Run integration tests**

Run: `bun run test:e2e`
Expected: All PASS

- [ ] **Step 5: Fix any failures**

If any tests fail, diagnose and fix. Re-run the full suite after each fix.

## Chunk 4: Documentation

### Task 13: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update serialization and URL references in CLAUDE.md**

Find all references to hash-based URLs and update them:

1. In the `serialize.ts` entry in the project structure, update the description
   from "Bespoke Base64 URL serialization" to mention path-based routing.

2. In the **Serialization** section under "No backwards compatibility until v1",
   no change needed — the policy still applies.

3. In the **Transforms** section, update the Serializer description: change
   "data ↔ string" to "data ↔ URL path".

4. In the **Key Concepts** > **Serialization** mention, clarify the URL format
   is now path-based (`/p/<base64data>`).

5. Add a mention of the nginx config in the project structure.

6. Add `nginx.conf` to the project structure listing.

7. Update the deploy mechanism description to mention nginx config copy + reload.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for path-based routing"
```
