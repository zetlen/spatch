# Scene Asset Readiness & Preloading — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Never start playback without a fully loaded reverb IR; never show an unloaded background during a scene transition; preload next scene's assets.

**Architecture:** Split IR loading into fetch (no AudioContext) + decode phases. New scene loader module orchestrates image + IR prefetch. `applyScene` becomes async with a two-layer crossfade. Engine accepts pre-decoded IR buffers. Splash and embed block on scene readiness before first play.

**Tech Stack:** TypeScript, Web Audio API, CSS transitions, Vite static imports.

---

### Task 1: Split `ir-loader.ts` into fetch + decode layers

**Files:**
- Modify: `js/audio/ir-loader.ts`
- Test: `tests/unit/ir-loader.test.js` (new)

**Step 1: Write failing tests**

Create `tests/unit/ir-loader.test.js`:

```js
import { afterEach, describe, expect, test } from 'bun:test';
import { fetchIR, decodeIR, loadIR, _clearCaches } from '../../js/audio/ir-loader.ts';

// Stub fetch globally
let fetchStub;
afterEach(() => {
  _clearCaches();
  globalThis.fetch = fetchStub;
});

function stubFetch(arrayBuffer) {
  fetchStub = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    });
}

function stubFetchFail() {
  fetchStub = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve({ ok: false, status: 404 });
}

describe('fetchIR', () => {
  test('fetches and caches ArrayBuffer', async () => {
    const buf = new ArrayBuffer(16);
    stubFetch(buf);

    const result = await fetchIR('test.m4a');
    expect(result).toBe(buf);

    // Second call returns cached value without fetch
    let fetchCalled = false;
    globalThis.fetch = () => { fetchCalled = true; return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); };
    const cached = await fetchIR('test.m4a');
    expect(cached).toBe(buf);
    expect(fetchCalled).toBe(false);
  });

  test('deduplicates concurrent requests', async () => {
    let callCount = 0;
    const buf = new ArrayBuffer(16);
    fetchStub = globalThis.fetch;
    globalThis.fetch = () => {
      callCount++;
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
    };

    const [a, b] = await Promise.all([fetchIR('dup.m4a'), fetchIR('dup.m4a')]);
    expect(a).toBe(b);
    expect(callCount).toBe(1);
  });

  test('rejects on HTTP error', async () => {
    stubFetchFail();
    await expect(fetchIR('missing.m4a')).rejects.toThrow('Failed to load IR');
  });
});

describe('decodeIR', () => {
  test('decodes prefetched bytes and caches AudioBuffer', async () => {
    const buf = new ArrayBuffer(16);
    stubFetch(buf);
    await fetchIR('decode-test.m4a');

    const decoded = { duration: 1, length: 44100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await decodeIR(ctx, 'decode-test.m4a');
    expect(result).toBe(decoded);

    // Second call returns cached decoded buffer
    const result2 = await decodeIR(ctx, 'decode-test.m4a');
    expect(result2).toBe(decoded);
  });

  test('fetches bytes automatically if not prefetched', async () => {
    const buf = new ArrayBuffer(16);
    stubFetch(buf);

    const decoded = { duration: 1, length: 44100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await decodeIR(ctx, 'auto-fetch.m4a');
    expect(result).toBe(decoded);
  });
});

describe('loadIR (backwards compat)', () => {
  test('fetches, decodes, and returns AudioBuffer', async () => {
    const buf = new ArrayBuffer(16);
    stubFetch(buf);

    const decoded = { duration: 1, length: 44100 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };

    const result = await loadIR(ctx, 'compat.m4a');
    expect(result).toBe(decoded);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/ir-loader.test.js`
Expected: FAIL — `fetchIR`, `decodeIR`, `_clearCaches` don't exist yet.

**Step 3: Implement the split**

Rewrite `js/audio/ir-loader.ts`:

```ts
// ir-loader.ts — Fetch and decode impulse response files for convolution reverb.
//
// Two-layer cache: fetchIR() caches raw ArrayBuffers (no AudioContext needed),
// decodeIR() caches decoded AudioBuffers. This split lets scenes prefetch IR
// bytes at page load before an AudioContext exists.

const byteCache = new Map<string, ArrayBuffer>();
const bytePending = new Map<string, Promise<ArrayBuffer>>();
const decodedCache = new Map<string, AudioBuffer>();
const decodedPending = new Map<string, Promise<AudioBuffer>>();

/** Fetch IR bytes (network + byte cache). No AudioContext needed. */
export function fetchIR(filename: string): Promise<ArrayBuffer> {
  const cached = byteCache.get(filename);
  if (cached) return Promise.resolve(cached);

  const inflight = bytePending.get(filename);
  if (inflight) return inflight;

  const promise = fetch(filename)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load IR: ${res.status} ${filename}`);
      return res.arrayBuffer();
    })
    .then((buf) => {
      byteCache.set(filename, buf);
      bytePending.delete(filename);
      return buf;
    });

  bytePending.set(filename, promise);
  return promise;
}

/** Decode a fetched IR into an AudioBuffer (decoded cache). Fetches if not prefetched. */
export function decodeIR(ctx: BaseAudioContext, filename: string): Promise<AudioBuffer> {
  const cached = decodedCache.get(filename);
  if (cached) return Promise.resolve(cached);

  const inflight = decodedPending.get(filename);
  if (inflight) return inflight;

  const promise = fetchIR(filename)
    .then((bytes) => ctx.decodeAudioData(bytes.slice(0)))
    .then((decoded) => {
      decodedCache.set(filename, decoded);
      decodedPending.delete(filename);
      return decoded;
    });

  decodedPending.set(filename, promise);
  return promise;
}

/** Fetch + decode in one call. Backwards compatible with original API. */
export function loadIR(ctx: BaseAudioContext, filename: string): Promise<AudioBuffer> {
  return decodeIR(ctx, filename);
}

/** Clear all caches (testing only). */
export function _clearCaches(): void {
  byteCache.clear();
  bytePending.clear();
  decodedCache.clear();
  decodedPending.clear();
}
```

Note: `decodeAudioData` consumes its ArrayBuffer argument, so we pass
`bytes.slice(0)` to avoid invalidating the byte cache entry.

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/ir-loader.test.js`
Expected: PASS

**Step 5: Run existing tests to verify no regressions**

Run: `bun run test:unit`
Expected: All pass. The existing `loadIR` API is preserved.

**Step 6: Commit**

```bash
git add js/audio/ir-loader.ts tests/unit/ir-loader.test.js
git commit -m "refactor: split ir-loader into fetch + decode layers"
```

---

### Task 2: Create `js/scenes/loader.ts` — scene prefetch module

**Files:**
- Create: `js/scenes/loader.ts`
- Test: `tests/unit/scene-loader.test.js` (new)

**Step 1: Write failing tests**

Create `tests/unit/scene-loader.test.js`:

```js
import { afterEach, describe, expect, test } from 'bun:test';
import { prefetchScene, loadSceneIR, preloadNextScene, _reset } from '../../js/scenes/loader.ts';
import { _clearCaches } from '../../js/audio/ir-loader.ts';

let origFetch;
afterEach(() => {
  _reset();
  _clearCaches();
  globalThis.fetch = origFetch;
});

function stubFetch() {
  origFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    });
}

const scene = {
  name: 'test',
  stageBackground: '/test-bg.jpg',
  imageCredit: '',
  vibe: { ir: '/test-ir.m4a', reverbMix: 0.5 },
};

const sceneNoIR = {
  name: 'dry',
  stageBackground: '/dry-bg.jpg',
  imageCredit: '',
  vibe: {},
};

describe('prefetchScene', () => {
  test('resolves when both image and IR are loaded', async () => {
    stubFetch();
    // Image constructor stub — just call onload synchronously
    const origImage = globalThis.Image;
    globalThis.Image = class {
      set src(_) { setTimeout(() => this.onload?.(), 0); }
    };

    await prefetchScene(scene);
    // No error = success

    globalThis.Image = origImage;
  });

  test('resolves for scene without IR', async () => {
    stubFetch();
    const origImage = globalThis.Image;
    globalThis.Image = class {
      set src(_) { setTimeout(() => this.onload?.(), 0); }
    };

    await prefetchScene(sceneNoIR);

    globalThis.Image = origImage;
  });

  test('caches so second call is instant', async () => {
    stubFetch();
    const origImage = globalThis.Image;
    let imageConstructCount = 0;
    globalThis.Image = class {
      constructor() { imageConstructCount++; }
      set src(_) { setTimeout(() => this.onload?.(), 0); }
    };

    await prefetchScene(scene);
    const count1 = imageConstructCount;

    await prefetchScene(scene);
    expect(imageConstructCount).toBe(count1); // no new Image created

    globalThis.Image = origImage;
  });
});

describe('loadSceneIR', () => {
  test('returns decoded AudioBuffer after prefetch', async () => {
    stubFetch();
    const origImage = globalThis.Image;
    globalThis.Image = class {
      set src(_) { setTimeout(() => this.onload?.(), 0); }
    };

    await prefetchScene(scene);

    const decoded = { duration: 1 };
    const ctx = { decodeAudioData: () => Promise.resolve(decoded) };
    const result = await loadSceneIR(ctx, scene);
    expect(result).toBe(decoded);

    globalThis.Image = origImage;
  });

  test('returns undefined for scene with no IR', async () => {
    const ctx = { decodeAudioData: () => Promise.resolve({}) };
    const result = await loadSceneIR(ctx, sceneNoIR);
    expect(result).toBeUndefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/scene-loader.test.js`
Expected: FAIL — module doesn't exist.

**Step 3: Implement**

Create `js/scenes/loader.ts`:

```ts
// loader.ts — Scene asset prefetching.
//
// Prefetches both the stage background image and the reverb IR file for a scene.
// Image is preloaded via Image(). IR bytes are fetched via fetchIR() (no AudioContext).
// Both can start at page load, before any user gesture.

import type { Scene } from './scene-types';
import { fetchIR, decodeIR } from '../audio/ir-loader';
import { SCENES, getScene } from './index';

const imageReady = new Set<string>();
const imagePending = new Map<string, Promise<void>>();

function preloadImage(url: string): Promise<void> {
  if (imageReady.has(url)) return Promise.resolve();

  const inflight = imagePending.get(url);
  if (inflight) return inflight;

  const promise = new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageReady.add(url);
      imagePending.delete(url);
      resolve();
    };
    img.onerror = () => {
      imagePending.delete(url);
      reject(new Error(`Failed to preload image: ${url}`));
    };
    img.src = url;
  });

  imagePending.set(url, promise);
  return promise;
}

/** Prefetch both assets for a scene (no AudioContext needed). */
export function prefetchScene(scene: Scene): Promise<void> {
  const promises: Promise<unknown>[] = [preloadImage(scene.stageBackground)];
  if (scene.vibe.ir) {
    promises.push(fetchIR(scene.vibe.ir));
  }
  return Promise.all(promises).then(() => {});
}

/** Decode the IR for a scene. Fast if bytes were prefetched. Returns undefined if no IR. */
export function loadSceneIR(
  ctx: BaseAudioContext,
  scene: Scene,
): Promise<AudioBuffer | undefined> {
  if (!scene.vibe.ir) return Promise.resolve(undefined);
  return decodeIR(ctx, scene.vibe.ir);
}

/** Fire-and-forget prefetch for the next scene. */
export function preloadNextScene(currentIndex: number): void {
  const nextIndex = (currentIndex + 1) % SCENES.length;
  const next = getScene(nextIndex);
  prefetchScene(next).catch(() => {});
}

/** Clear state (testing only). */
export function _reset(): void {
  imageReady.clear();
  imagePending.clear();
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/scene-loader.test.js`
Expected: PASS

**Step 5: Run all unit tests**

Run: `bun run test:unit`
Expected: All pass.

**Step 6: Commit**

```bash
git add js/scenes/loader.ts tests/unit/scene-loader.test.js
git commit -m "feat: scene loader for prefetching images and IR bytes"
```

---

### Task 3: Engine accepts pre-decoded IR buffer

**Files:**
- Modify: `js/audio/engine.ts:484-513` (`_buildReverb`)
- Modify: `js/audio/engine.ts:89` (`play` signature)
- Modify: `js/audio/engine.ts:538-543` (`_syncReverb`)

**Step 1: Write failing test**

Add to `tests/unit/audio-engine.test.js`, in the reverb section:

```js
test('play with preloaded IR buffer sets convolver buffer synchronously', async () => {
  const irBuffer = { duration: 1.5, length: 66150 }; // Stub AudioBuffer
  setVibe(new Vibe({ ir: 'preloaded.m4a', reverbMix: 0.6 }));
  const state = makeSigilState([makeVoice('a')]);
  await engine.play(state, state.envelope, { irBuffer });

  expect(engine._reverbConvolver).not.toBeUndefined();
  expect(engine._reverbConvolver.buffer).toBe(irBuffer);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/audio-engine.test.js -t "preloaded IR"`
Expected: FAIL — `play()` doesn't accept options.

**Step 3: Implement**

In `js/audio/engine.ts`:

1. Add an options type and update `play()` signature:

```ts
export interface PlayOptions {
  irBuffer?: AudioBuffer;
}
```

2. Pass `irBuffer` through `play` → `_buildReverb`:

In `play()` (around line 89):
```ts
async play(sigilState: SigilData, envelope: Envelope, opts?: PlayOptions): Promise<void> {
```

Store on instance so `_buildReverb` can use it:
```ts
this._pendingIRBuffer = opts?.irBuffer;
```

3. In `_buildReverb()`, use the pending buffer if available:

Replace the async loadIR block (lines 505-513):
```ts
// Use pre-decoded buffer if provided, otherwise load async
if (this._pendingIRBuffer) {
  this._reverbConvolver.buffer = this._pendingIRBuffer;
  this._pendingIRBuffer = undefined;
} else {
  const convolver = this._reverbConvolver;
  loadIR(ctx, vibe.ir)
    .then((buf) => {
      convolver.buffer = buf;
    })
    .catch(() => {});
}
```

4. Add the field declaration:
```ts
private _pendingIRBuffer: AudioBuffer | undefined;
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/audio-engine.test.js -t "preloaded IR"`
Expected: PASS

**Step 5: Run all unit tests**

Run: `bun run test:unit`
Expected: All pass. Existing tests don't pass `opts`, so they use the async fallback.

**Step 6: Commit**

```bash
git add js/audio/engine.ts tests/unit/audio-engine.test.js
git commit -m "feat: engine.play() accepts pre-decoded IR buffer"
```

---

### Task 4: CSS two-layer crossfade for stage background

**Files:**
- Modify: `css/style.css:44-51` (`#app`)
- Modify: `index.html:14` (add background layers inside `#app`)
- Modify: `js/scenes/index.ts` (rewrite `applyScene`)

**Step 1: Add DOM layers to `index.html`**

Inside `<div id="app">`, before `<header>`, add:

```html
<div class="stage-bg stage-bg-a" aria-hidden="true"></div>
<div class="stage-bg stage-bg-b" aria-hidden="true"></div>
```

**Step 2: Add CSS for the two layers**

In `css/style.css`, replace the `#app` `background-image` usage:

```css
#app {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.stage-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  transition: opacity 0.4s ease;
  z-index: 0;
  pointer-events: none;
}

.stage-bg.fade-out {
  opacity: 0;
}
```

Ensure `#toolbar-top`, `#stage`, `#toolbar-bottom` have `position: relative; z-index: 1;`
or equivalent so they sit above the bg layers. `#stage` already has `isolation: isolate`
and `position: relative`. Add `z-index: 1` to `#toolbar-top` and `#toolbar-bottom` if needed.

**Step 3: Rewrite `applyScene` in `js/scenes/index.ts`**

```ts
import type { Scene } from './scene-types';
import { prefetchScene, preloadNextScene } from './loader';

export type { Scene } from './scene-types';
// ... existing imports and SCENES array ...

let activeLayer: HTMLElement | undefined;
let inactiveLayer: HTMLElement | undefined;

export function initStageLayers(app: HTMLElement): void {
  const layers = app.querySelectorAll<HTMLElement>('.stage-bg');
  activeLayer = layers[0];
  inactiveLayer = layers[1];
}

export function applyScene(app: HTMLElement, index: number): Promise<void> {
  const scene = getScene(index);
  if (!activeLayer || !inactiveLayer) {
    // Fallback: direct set (before initStageLayers called)
    app.style.backgroundImage = `url(${scene.stageBackground})`;
    app.style.backgroundSize = 'cover';
    app.style.backgroundPosition = 'center';
    return prefetchScene(scene);
  }

  // Set new image on inactive layer, hidden
  inactiveLayer.style.backgroundImage = `url(${scene.stageBackground})`;
  inactiveLayer.classList.add('fade-out');

  return prefetchScene(scene).then(() => {
    // Crossfade: show inactive, hide active
    inactiveLayer!.classList.remove('fade-out');
    activeLayer!.classList.add('fade-out');

    // After transition, swap roles
    const done = activeLayer!;
    activeLayer = inactiveLayer;
    inactiveLayer = done;

    // Preload next scene's assets
    preloadNextScene(index);
  });
}
```

**Step 4: Run typecheck**

Run: `bun run check`
Expected: PASS

**Step 5: Run integration tests**

Run: `bun run test:e2e`
Expected: Stage theme tests still pass (background image still appears on `#app`
children, integration test checks `getComputedStyle(el).backgroundImage`).

Note: The integration test checks `#app`'s computed `backgroundImage`. With the
new two-layer approach, the bg is on child divs, not `#app` itself. The test
needs a small update — change `app.evaluate` to check the active `.stage-bg`
element instead. Update `tests/integration/stage-themes.test.js`:

```js
// Helper to get the active background image
async function getActiveBg(page) {
  return page.evaluate(() => {
    const layers = document.querySelectorAll('.stage-bg');
    for (const layer of layers) {
      if (!layer.classList.contains('fade-out') && getComputedStyle(layer).backgroundImage !== 'none') {
        return getComputedStyle(layer).backgroundImage;
      }
    }
    return 'none';
  });
}
```

Then update the three tests to use `getActiveBg(page)` instead of
`app.evaluate(...)`.

**Step 6: Commit**

```bash
git add css/style.css index.html js/scenes/index.ts tests/integration/stage-themes.test.js
git commit -m "feat: two-layer crossfade for stage background transitions"
```

---

### Task 5: Wire up `app.ts` — prefetch on init, await before play

**Files:**
- Modify: `js/app.ts`

**Step 1: Import new modules**

Add to imports:

```ts
import { prefetchScene, loadSceneIR } from './scenes/loader';
import { initStageLayers } from './scenes';
```

(Adjust the import from `./scenes` to also export `initStageLayers`.)

**Step 2: Init stage layers and prefetch**

After `const appEl = qel('#app');` (line 70):

```ts
initStageLayers(appEl);
```

Replace the current `applyScene` + `setVibe` block (lines 71-72):

```ts
const initialScene = getScene(store.data.scene);
const sceneReady = prefetchScene(initialScene);
applyScene(appEl, store.data.scene);
setVibe(new Vibe(initialScene.vibe));
```

`sceneReady` is a promise that resolves when the initial scene's image + IR
bytes are fetched.

**Step 3: Update scene change effect**

Replace the scene change `effect()` (lines 80-84):

```ts
effect(() => {
  const sceneIndex = store.data.scene;
  const sceneDef = getScene(sceneIndex);
  applyScene(appEl, sceneIndex);
  setVibe(new Vibe(sceneDef.vibe));
});
```

`applyScene` is now async and handles prefetch + crossfade internally.

**Step 4: Pass IR buffer to playback**

The `PlaybackController.start()` needs to await scene readiness and pass the
decoded IR to `audio.play()`. Update `PlaybackController` to accept an optional
`sceneReady` promise and use `loadSceneIR`.

In `js/app.ts`, update the PlaybackController construction to inject a function
that resolves the current scene's IR:

```ts
const playback: PlaybackController = new PlaybackController({
  audio,
  getState: () => store.data,
  requestRender: () => { needsRender = true; },
  isSplashActive: (): boolean => splash.isActive,
  getIRBuffer: async () => {
    await sceneReady;
    const ctx = audio.audioCtx;
    if (!ctx) return undefined;
    const scene = getScene(store.data.scene);
    return loadSceneIR(ctx, scene);
  },
});
```

**Step 5: Update `PlaybackController.start()` to use IR buffer**

In `js/playback.ts`, add `getIRBuffer` to the constructor deps:

```ts
private getIRBuffer: () => Promise<AudioBuffer | undefined>;
```

In `start()`:

```ts
async start(): Promise<void> {
  // ... existing release glow cleanup ...
  const gen = this.playGeneration;
  const state = this.getState();
  const irBuffer = await this.getIRBuffer();
  if (gen !== this.playGeneration) return; // cancelled during await
  await this.audio.play(state, state.envelope, { irBuffer: irBuffer ?? undefined });
  if (gen !== this.playGeneration) {
    this.audio.stop();
    return;
  }
  this.playBtn.classList.add('playing');
  this.setPlayIcon(true);
  this.requestRender();
}
```

**Step 6: Run typecheck and all tests**

Run: `bun run check && bun run test:unit`
Expected: PASS

**Step 7: Commit**

```bash
git add js/app.ts js/playback.ts
git commit -m "feat: prefetch scene assets on init, pass IR buffer to playback"
```

---

### Task 6: Splash blocks on scene readiness

**Files:**
- Modify: `js/splash.ts`

The splash `splashUp` calls `this.playback.start()` which now internally awaits
`getIRBuffer()`, which awaits `sceneReady`. So the splash already blocks on
scene readiness via the playback controller — no changes needed to `splash.ts`.

Verify by inspection that the flow is:
1. `splashUp()` → `this.audio.warmUp()` → `this.playback.start()`
2. `start()` → `await this.getIRBuffer()` (blocks until scene prefetched)
3. `start()` → `await this.audio.play(..., { irBuffer })` (IR set synchronously)

**Step 1: Verify with manual test**

Run: `bun run dev`
Open browser, clear localStorage (to show splash), verify:
- Splash appears
- Tap/click the splash
- Audio plays with reverb from the first moment

**Step 2: Commit (no changes, just verification)**

No code changes — splash blocks through the playback controller chain.

---

### Task 7: Embed page blocks on scene readiness

**Files:**
- Modify: `js/embed-entry.ts`

**Step 1: Update embed to await scene readiness**

Import the scene loader:
```ts
import { prefetchScene, loadSceneIR } from './scenes/loader';
```

At the top of the `else` block where `state` is valid, start prefetch
immediately:

```ts
const sceneDef = getScene(sigil.scene);
const sceneReady = prefetchScene(sceneDef);
```

Move the `qel('#wrap').classList.add('ready')` to after `sceneReady`:

```ts
sceneReady.then(() => {
  qel('#wrap').classList.add('ready');
});
```

Update the play button handler to await scene readiness and pass IR:

```ts
btn.addEventListener('click', async () => {
  if (audio.isPlaying) {
    audio.release(sigil.envelope);
    btn.classList.remove('playing');
    setEmbedPlayIcon(false);
  } else {
    if (sigil.voices.length === 0) return;
    await sceneReady;
    const ctx = audio.audioCtx;
    let irBuffer: AudioBuffer | undefined;
    if (ctx) {
      irBuffer = await loadSceneIR(ctx, sceneDef);
    }
    await audio.play(sigil, sigil.envelope, { irBuffer });
    btn.classList.add('playing');
    setEmbedPlayIcon(true);
  }
});
```

Note: `warmUp()` must still be called from the click gesture handler before the
`await`. The `audio.play()` call itself calls `_init()`, and the click is a
qualifying gesture, so this is fine. But to be safe, call `audio.warmUp()`
before the await:

```ts
btn.addEventListener('click', async () => {
  if (audio.isPlaying) {
    audio.release(sigil.envelope);
    btn.classList.remove('playing');
    setEmbedPlayIcon(false);
  } else {
    if (sigil.voices.length === 0) return;
    audio.warmUp(); // Must be synchronous from click gesture
    await sceneReady;
    const irBuffer = audio.audioCtx
      ? await loadSceneIR(audio.audioCtx, sceneDef)
      : undefined;
    await audio.play(sigil, sigil.envelope, { irBuffer });
    btn.classList.add('playing');
    setEmbedPlayIcon(true);
  }
});
```

**Step 2: Run typecheck**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add js/embed-entry.ts
git commit -m "feat: embed page blocks play on scene asset readiness"
```

---

### Task 8: Update `embed.html` background to use scene loader

**Files:**
- Modify: `js/embed-entry.ts`

The embed sets `document.body.style.backgroundImage` directly. This should also
wait for the image to be preloaded (which `prefetchScene` already does).

Move the background-image assignment after `await sceneReady`:

```ts
const sceneReady = prefetchScene(sceneDef);
// ... other setup ...
sceneReady.then(() => {
  document.body.style.backgroundImage = `url(${sceneDef.stageBackground})`;
  document.body.style.backgroundSize = 'cover';
  document.body.style.backgroundPosition = 'center';
  qel('#wrap').classList.add('ready');
});
```

This is a small amendment to Task 7 — can be folded into the same commit.

---

### Task 9: Full integration verification

**Step 1: Typecheck**

Run: `bun run check`
Expected: PASS

**Step 2: Unit tests**

Run: `bun run test:unit`
Expected: All pass.

**Step 3: Build**

Run: `bun run build`
Expected: PASS, no errors.

**Step 4: Integration tests**

Run: `bun run test:e2e`
Expected: All pass (with updated stage-themes selectors from Task 4).

**Step 5: Manual testing**

Run: `bun run dev`, verify:
1. Initial load: splash appears, tap dismisses, audio plays with reverb
2. Scene change: click stage button, crossfade transition, new scene loads
3. Rapid scene changes: multiple clicks don't break anything
4. Embed page: open `embed.html#...`, play button works with reverb

**Step 6: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: integration test selectors for two-layer stage bg"
```
