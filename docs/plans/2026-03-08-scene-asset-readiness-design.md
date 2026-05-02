# Scene Asset Readiness & Preloading

**Date:** 2026-03-08
**Status:** Approved

## Problem

The IR file loads lazily on first `play()` — reverb is missing for the first
moments of playback. Stage background images can also flash-load visibly on
scene change. Both degrade the experience.

## Goals

1. Never start playback without a fully decoded reverb IR.
2. Never show an unloaded background image during a scene transition.
3. Preload the next scene's assets so transitions feel instant.
4. Apply to both the main app and the embed page.

## Constraint: IR Decoding Needs AudioContext

`decodeAudioData` requires an `AudioContext`, which doesn't exist until the
first user gesture. The network fetch is the slow part; decoding is fast. So
IR loading splits into two phases: fetch raw bytes (immediate) → decode when
AudioContext exists.

## Design

### New module: `js/scenes/loader.ts`

```ts
// Prefetch both assets for a scene (no AudioContext needed).
// Fetches IR bytes + preloads image via Image(). Caches both.
prefetchScene(scene: Scene): Promise<void>

// Decode a prefetched IR into an AudioBuffer.
// Fast if bytes are already cached from prefetchScene().
loadSceneIR(ctx: AudioContext, scene: Scene): Promise<AudioBuffer>

// Fire-and-forget prefetch for scene at (index + 1) % SCENES.length.
preloadNextScene(currentIndex: number): void
```

### Changes to `ir-loader.ts`

Split into two layers:

- `fetchIR(filename): Promise<ArrayBuffer>` — network fetch with byte cache.
  No AudioContext needed. Deduplicates in-flight requests.
- `decodeIR(ctx, filename): Promise<AudioBuffer>` — decodes from byte cache,
  caches the decoded buffer.
- `loadIR(ctx, filename)` becomes composition of both.

### Changes to `js/scenes/index.ts`

`applyScene` becomes async:

- Returns `Promise<void>` resolving when image + IR bytes are both fetched.
- Manages a two-layer crossfade: old background fades out, new fades in.
- After transition settles, calls `preloadNextScene(currentIndex)`.

Two background layers (child divs or pseudo-elements) replace the single
`--stage-bg` CSS property, since `background-image` doesn't CSS-transition.

### Changes to `app.ts`

- **Init:** kick off `prefetchScene(currentScene)` immediately, store promise.
- **Splash dismiss:** `splashUp` awaits scene readiness before
  `playback.start()`.
- **Scene change effect:** awaits `applyScene`, then `setVibe`.

### Changes to `engine.ts`

- `_buildReverb` accepts an optional pre-decoded `AudioBuffer`.
- When provided, sets `convolver.buffer` synchronously — reverb is present
  from the first audio frame.
- Falls back to async `loadIR` when no buffer provided (debug tuner path).

### Changes to `embed-entry.ts`

- Await `prefetchScene` before adding `ready` class and enabling play button.

### CSS: Two-Layer Background Crossfade

Current approach: `--stage-bg` custom property on `#app`.

New approach: two stacked divs inside `#stage` (or `#app`), each holding a
background image. On scene change the incoming layer starts at `opacity: 0`
and transitions to `1` while the outgoing transitions to `0`. After the
transition ends, the layers swap roles and the old one is cleared.

### What Stays the Same

- Scene definitions (`Scene` type, per-scene `index.ts` files) unchanged.
- Vite static imports provide hashed URLs at build time.
- Serialization unchanged — scene index is still 1 B64 char.
- Audio unlock strategy (iOS Safari) unchanged — `warmUp()` is still
  synchronous from a qualifying gesture. The readiness gate is upstream
  of the gesture handler.

## Scenarios

### 1. Initial Load (Main App)

```
page load → prefetchScene(current) starts immediately
         → splash screen covers the wait
user dismisses splash → await prefetchScene promise
                      → warmUp() (creates AudioContext)
                      → decodeIR (fast, bytes cached)
                      → play() with reverb from frame 1
```

### 2. Scene Change

```
user clicks stage → applyScene(new) returns Promise
                  → fetch IR bytes + preload image
                  → crossfade transition begins when both ready
                  → setVibe(new) + hot-swap reverb if playing
                  → preloadNextScene(new index)
```

### 3. Embed Page

```
page load → prefetchScene(scene from URL)
          → show loading / keep play button disabled
          → when ready: add 'ready' class, enable play
          → first play has reverb from frame 1
```
