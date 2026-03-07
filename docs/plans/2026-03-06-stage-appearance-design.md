# Stage Appearance Improvements — Design

Issue: #172

## 1. Remove Scanlines Overlay

The `#stage::before` and `#stage::after` pseudo-elements currently render a
scanline pattern and gradient tint over scene backgrounds, animated by
`--audio-level`. These will be removed entirely. If scanline effects are wanted
later, they should be baked into the background images at build time (e.g. via
ImageMagick), not layered at runtime.

**Deletions:**
- CSS: `#stage::before`, `#stage::after`, `#stage.stage-florid::before`,
  `#stage.stage-florid::after` rules, `--audio-level` variable
- JS: `setAudioLevel()` export from `stage.ts` and its call site in `app.ts`

## 2. Minimal Stage as First in Cycle

The current binary toggle (white vs florid) is replaced with a simple linear
cycle through all background images. The first image in the cycle is a new
"minimal" stage: a tileable texture mimicking the Apple Snow White / Platinum
plastic finish (warm grey, fine speckled matte texture), matching the toolbar
aesthetic.

**Changes:**
- Add a tileable Snow White texture JPG to `img/scene/` (sorted first
  alphabetically, e.g. `00-minimal.jpg`)
- Remove the `florid` boolean from `StageState` — state is just `imageIndex`
- Remove the `stage-florid` CSS class and all rules gated on it
- Stage always shows a background image; `#app` always gets `background-image`
  from the current scene
- `#stage` background becomes transparent always (the image shows through
  from `#app`)
- Each button click advances `imageIndex` by 1 and wraps
- No button title/label updates — the button is just a cycle trigger

## 3. Splash Fade Tied to Audio

The toolbar fade-in currently starts immediately on splash dismiss (0.5s
fixed). Instead, the fade should wait until playback fully stops (ADSR release
+ reverb tail), making the splash a dramatic reveal.

**Sequence:**
1. User presses and releases on splash
2. Audio warmup + playback starts (unchanged)
3. Toolbars remain hidden while audio plays
4. After `releaseAndIdle()` completes and audio stops, begin toolbar fade-in
5. Fade duration remains ~0.5s–1s

**Implementation:** `splashReveal()` delays adding `is-editing` to body until
after the `doRelease()` promise resolves and playback has ended. The
`MIN_SUSTAIN_MS` delay still applies before release begins.

## 4. Toolbar Drop Shadows

Both toolbars get a subtle, always-present `box-shadow`:
- `#toolbar-top`: shadow cast downward (e.g. `0 2px 4px rgba(0,0,0,0.12)`)
- `#toolbar-bottom`: shadow cast upward (e.g. `0 -2px 4px rgba(0,0,0,0.12)`)

This reinforces the toolbars floating above the stage in all modes.

## 5. Background Image Cropping

Out of scope for this branch. Images will be manually cropped so that
`background-size: cover; background-position: center` works well across
viewports.

## Non-Goals

- Toolbar theme overhaul (filed separately as #194)
- Build-time scanline/effect processing on images
- Splash color band debugging (expected to resolve as side effect of removing
  scanlines and simplifying stage modes)
