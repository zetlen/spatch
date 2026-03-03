# iOS Safari Audio Fix — Conversation Summary

Issue: [#120 — Sound doesn't work reliably in iOS Safari](https://got.colonpipe.org/zetlen/spatch/issues/120)

## Problem

Audio doesn't play reliably on iOS or macOS Safari. On splash load it never
plays. After the splash, the Play button often requires 3–4 taps before sound
works. A Reddit comment suggested routing through `MediaStreamDestination` →
`<audio>` element.

## What Was Tried (in order)

### 1. MediaStreamDestination → `<audio>` element

**Files changed:** `js/audio.ts`, `tests/unit/audio-engine.test.js`

Added `_streamDest` (MediaStreamAudioDestinationNode) and `_audioEl`
(HTMLAudioElement) to `AudioEngine`. In `_init()`, created both and connected
the audio graph's analyser to `_streamDest` instead of `ctx.destination`.

**Result:** Tests passed, but audio routing went exclusively through the stream
destination. Safari showed the audio indicator in the status bar but produced no
audible output. `MediaStreamAudioDestinationNode` → `<audio>` `srcObject` does
NOT produce speaker output on Safari — it only signals to the OS that media is
active.

### 2. Dual output routing

**Fix:** Connected analyser to BOTH `ctx.destination` (actual sound) and
`_streamDest` (keep-alive signal).

**Result:** Audio came back on desktop browsers. Still didn't work on iOS Safari.

### 3. Synchronous `_init()` and `warmUp()`

**Insight:** `_init()` was `async` and called with `await`. Even though it had
no internal awaits, the `await` keyword pushes the continuation into a
microtask. iOS Safari revokes user-gesture privileges after any microtask
boundary.

**Fix:** Made `_init()` fully synchronous (returns `void`, not `Promise<void>`).
Made `warmUp()` synchronous too. Added the classic "silent buffer" unlock trick
(play a 1-sample silent buffer through `ctx.destination` immediately in
`_init()`). Called `ctx.resume()` synchronously (fire-and-forget, no await).

**Result:** Still didn't work on iOS Safari for splash mode.

### 4. Changed gesture events from `pointerdown` to `touchend`/`click`

**Key discovery:** iOS Safari only unlocks audio from **`touchend`, `click`,
`doubleclick`, `keydown`**. `pointerdown` and `mousedown` are NOT qualifying
gestures. Source: [WebKit blog — New Video Policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/)

**Fix:**
- Global warmup listener changed from `pointerdown` to `touchend`/`click`/`keydown`
- Splash `startPlayback()` moved from `splashDown` (pointerdown) to `splashUp` (touchend/pointerup)
- Removed `e.preventDefault()` from splash `pointerdown` handler (it was canceling subsequent `click`/`touchend` events)
- Added `touchend` listener alongside `pointerup` for splash, since `touchend` fires before `pointerup` on iOS

**Result:** Audio started playing on iOS Safari! But it never stopped — the
sound would persist indefinitely after the splash tap, making a very soft
sustained tone.

### 5. Fixed splash release race condition

**Insight:** `startPlayback()` is async (calls `audio.play()` which had
`await ctx.resume()`). `splashReveal()` schedules `doRelease()` after ~2
seconds. But `doRelease()` called `audio.release()` without waiting for
`play()` to finish. If `play()` was still awaiting `ctx.resume()`,
`audio.isPlaying` was false, so `release()` was a no-op. The oscillators
then started and ran forever.

**Fix:** Captured the `startPlayback()` promise and passed it to
`splashReveal()`. Made `doRelease()` async — it awaits `playReady` before
calling `audio.release()`. Added fallback: if `playReady` rejects or
`isPlaying` is false, force-calls `audio.stop()`.

**Result:** Still not working on iOS Safari. The release may still not fire,
possibly because `play()` itself hangs or the AudioContext state machine
behaves differently on iOS.

### 6. Removed `await ctx.resume()` from `play()`

**Insight:** `play()` still had `await ctx.resume()` which was the only
remaining `await` in the hot path. Since `warmUp()` already calls `resume()`
synchronously from the gesture handler, the await in `play()` is redundant.
On iOS Safari, calling `resume()` a second time while the first is in-flight
might return a promise that never resolves.

**Fix:** Changed `await ctx.resume()` to fire-and-forget `ctx.resume()` in
`play()`.

**Result:** Still not working on iOS Safari. At this point the splash plays
audio (confirmed earlier) but the release/stop mechanism still fails.

## Current State of the Code

All changes are in the working tree (uncommitted). The code compiles, lints,
and passes all 218 unit tests. The changes touch:

- **`js/audio.ts`** — `_init()` is synchronous, adds silent buffer unlock +
  `MediaStreamDestination` + `<audio>` element in DOM. `warmUp()` is public and
  synchronous. `play()` has no awaits. Dual routing to `ctx.destination` +
  `_streamDest`.
- **`js/app.ts`** — Global warmup on `touchend`/`click`/`keydown`. Splash
  playback moved to `splashUp`. Splash release awaits playback promise. Play
  button eagerly warms up on `pointerdown`.
- **`js/embed-entry.ts`** — Same global warmup pattern.
- **`tests/unit/audio-engine.test.js`** — No test changes needed (fallback
  routing to `ctx.destination` when `_streamDest` is null).

## Remaining Theories

1. **The `<audio>` element `play()` call may itself need to be in a `touchend`
   handler, not just the AudioContext creation.** Currently `_audioEl.play()` is
   called inside `_init()` which is called from `warmUp()` which IS in a
   `touchend` handler — so this should work, but worth verifying.

2. **The splash release logic may still have a timing issue.** Even though
   `doRelease` awaits `playReady`, the `play()` method is now effectively
   synchronous (no awaits), so the promise should resolve immediately. But
   maybe iOS Safari defers something internally.

3. **iOS Safari may suspend the AudioContext between `warmUp()` and the
   oscillators actually producing output.** The keep-alive `<audio>` element
   is supposed to prevent this, but it may not work as expected.

4. **The `isPlaying` flag may not be set when `doRelease` checks it.** Worth
   adding console logging to trace the exact sequence on iOS.

5. **Try a completely different approach:** Instead of press-and-hold for the
   splash, use a simple click-to-play model. Create the AudioContext, build the
   entire audio graph, and start oscillators all synchronously within a single
   `click` event handler — no async, no promises, no race conditions.

## Useful References

- [WebKit — New Video Policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/) — qualifying gesture events
- [StartAudioContext library](https://github.com/tambien/StartAudioContext) — Tone.js's approach (uses touchend, plays silent buffer)
- [Matt Montag — Unlock Web Audio in Safari](https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos) — resume() on user gesture
- [WebAudio spec issue #2293](https://github.com/WebAudio/web-audio-api/issues/2293) — MediaStreamDestination → audio element not guaranteed to produce output
- [WebAudio spec issue #1722](https://github.com/WebAudio/web-audio-api/issues/1722) — iOS Safari non-functioning MediaStreamDestination (since iOS 11)
- [Reddit comment](https://www.reddit.com/r/webdev/comments/1ldjqa1/comment/mymw7v3/) — original suggestion (for background playback, not initial unlock)
