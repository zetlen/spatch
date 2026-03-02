# First-Load Splash Design

**Issue:** #56 — First load splash
**Date:** 2026-03-02

## Summary

On first visit to a URL, hide the editor UI and show only the sigil on its
canvas frame. The user clicks/holds the canvas to play the sigil, then the
editor fades in during the audio release phase.

## Requirements

- First visit per URL shows splash; subsequent visits skip it (localStorage)
- Hold-to-play: pointer-down starts playback, pointer-up triggers release
- Quick tap (< 2s hold) sustains for a minimum of 2 seconds before releasing
- Editor fades in during the release phase, duration matches `envelope.release`
- Toolbars are fully laid out but transparent during splash — no layout shift
- Canvas frame keeps its full styling (ADSR corners, bevel, reverb shadow)
- Works with empty canvas (silence is fine)
- Embed page is unaffected

## Approach: CSS Opacity + JS Orchestration

### CSS

`body.splash` sets toolbars to `opacity: 0; pointer-events: none` while
keeping them in document flow. Transition property is `opacity` with
`transition-duration` set dynamically by JS at reveal time.

```css
body.splash #toolbar-top,
body.splash #toolbar-bottom,
body.splash .panel {
  opacity: 0;
  pointer-events: none;
}

body.splash #toolbar-top,
body.splash #toolbar-bottom {
  transition-property: opacity;
  transition-timing-function: ease-out;
  /* transition-duration set by JS to match envelope.release */
}
```

### Persistence

localStorage key: `"spatch-seen:<pathname><hash>"`. Set to `"1"` when
splash completes. On load, if key exists, skip splash.

### Interaction Flow

1. **Pointer-down on canvas area:** Start playback, record timestamp
2. **Pointer-up on canvas area:**
   - If held < 2s: wait remaining time, then release + reveal
   - If held >= 2s: release + reveal immediately
3. **Release + reveal:**
   - Set `transition-duration` on toolbars to `max(0.3, envelope.release)` seconds
   - Call `audio.release(envelope)`
   - Remove `body.splash` — toolbars fade in over release duration
   - Set localStorage key
   - After transition ends: clean up inline styles, restore pointer-events

### Edge Cases

- **Empty canvas:** Plays silence, 2s minimum still applies, reveal proceeds
- **No audio context:** First pointer-down resumes AudioContext as usual
- **Quick tap:** 2s minimum sustain before release begins
- **Panels:** Hidden by default (`.hidden` class), splash opacity rule is
  a safety net — they won't appear during splash regardless

## Files Modified

- `css/style.css` — `body.splash` rules
- `js/app.ts` — Splash logic: localStorage check, class toggle, canvas-area
  pointer listeners, timed release + reveal, cleanup

## Files NOT Modified

- `audio.ts`, `canvas.ts`, `index.html`, `serialize.ts`, `embed.html`
