# Chronicle

How spatch's architecture and feature set evolved, compressed from the design
documents and implementation plans that lived in `docs/plans/`. Each section
summarizes one body of work in roughly chronological order.

---

## March 1 — Bijective Audio-Visual Mapping

Established the core architectural invariant: every field in the canonical state
must affect both SVG rendering and audio synthesis. No visual-only state, no
hidden audio parameters.

Replaced the `Shape`/`Decoration` type hierarchy with a `Voice` discriminated
union (`SineVoice | PulseVoice | BlendVoice`). Removed squiggles, curlicues,
and all orphan visual fields (decoration position/scale, text fontSize/scale,
radial fill h2/l2 audio gaps). Fixed rotation→audio mapping to be periodic per
shape symmetry (half-sine curve: 90° for square, 120° for triangle), so
visually identical orientations produce identical audio. Fixed linear gradient
angle and radial fill formant mappings for full bijection compliance.

Renamed state accessors (`addShape` → `addVoice`, `shapes` → `voices`,
`decorations` → `texts`). Updated serialization to a v2 compact format.

## March 1 — Inset Shadows / Master Reverb

Added a global reverb mapped to an inset shadow on the canvas frame. Split the
canvas element into a frame div (background, border-radius, bevel, shadow) and
a transparent canvas (shapes only). Introduced `ConvolverNode` on the master
chain with algorithmically generated impulse responses (glow = short/bright,
dim = long/dark). Added reverb panel UI with depth slider and style toggle.

This was later superseded by the per-scene vibe system with real IR files, but
the canvas-frame split and the master reverb architecture survived.

## March 1 — Theme Revamp

Replaced the synthwave neon theme with a flat, neutral hybrid-bevel aesthetic.
Warm gray palette (`#e8e4e0` body, `#2a2a2a` canvas), beveled buttons (1px
border-color trick for raised/pressed states), no accent colors in the chrome.
Deleted all glow animations (`pulse-glow`, `canvas-glow`), the scanline
overlay, and neon box-shadows. Selection handles changed from cyan/purple to
white/black. The dark canvas became the sole source of color.

## March 2 — First-Load Splash

On first visit per URL, the editor hides behind `opacity: 0` toolbars (no
layout shift). The user clicks/holds the canvas to play, then toolbars fade in
during the audio release phase. Quick taps sustain for a minimum of 2 seconds.
Persistence via localStorage keyed to pathname + hash. Keyboard Space blocked
during splash. Existing integration tests updated with a skip-splash helper.

## March 2 — Toolbar Redesign

Replaced all Unicode icon characters and text labels with Tabler Icons via an
SVG sprite (~24 icons). Restructured into two bars: top bar (play, share,
reverb, undo/redo, new) and a context-sensitive bottom bar (shape tools when
nothing selected, voice properties when selected). Panels converted from
floating overlays to inline expansion within the bottom bar. Pattern and blend
mode selectors became dropdown menus with visual previews. Touch targets
increased to 44px minimum. Play fan reversed to drop downward. Text tool
removed.

A custom Vite plugin was later written to build the SVG sprite at compile time
by scanning source files for icon references, replacing the static sprite file.

## March 3 — Shrillness Fix

Made the audio output warmer and less harsh through five changes: lowered base
pitch from C3 to G2 (MIDI 48 → 43), replaced the ineffective brightness
highshelf with a lowpass filter driven by lightness (300 Hz–12 kHz exponential
curve), removed the aggressive auto EQ entirely (simplifying the master chain),
reduced formant max Q from 12 to 8, and added subtle harmonic presence to sine
voices via a `tanh(x * 1.5)` waveshaper.

## March 3 — Stage Themes

Added cosmetic themes to the stage area around the canvas. Three modes cycled
by a button: minimal (flat gray), subtle (pastel gradient), and florid
(background image from a curated library). Audio-reactive CSS effects driven by
`--audio-level` from the AnalyserNode. Seven background images shipped in a
`stage/` directory. Persistence via localStorage.

This was later superseded by the scene system, which unified stage backgrounds
with audio vibe presets and made the stage a serialized part of `SigilData`
rather than a cosmetic user preference.

## March 3 — SVG Migration

Replaced the `<canvas>` renderer with inline SVG (`viewBox="0 0 1 1"`). All
coordinates became normalized 0–1 directly, eliminating the `CANVAS_SIZE`
constant and all `* 800` / `/ 800` scaling. The renderer became a DOM
reconciler: create/update/remove SVG elements keyed by voice ID. Blend modes
switched from an offscreen canvas hack to CSS `mix-blend-mode` inside an
`isolation: isolate` container. Hit testing switched from algorithmic
(barycentric math, point-in-shape) to native SVG pointer events on
`data-voice-id` attributes. Removed the rough pattern and bitcrusher audio
worklet. Net code reduction ~200–300 lines.

## March 4 — Border Octave Oscillator Gain Fix

Fixed the border's octave-doubled oscillator so its gain tracks shape size
changes. Added `borderOctaveGain()` with direction-dependent psychoacoustic
loudness coefficients (octave up attenuated, octave down boosted). Split the
`borderKey` used for change detection so only topology changes (color, double)
trigger full voice rebuilds — thickness changes flow through smooth parameter
updates, eliminating audible glitches during slider drags.

## March 6 — Radial Play Gesture

Moved the play button from the top toolbar to the stage, centered below the
canvas frame. Replaced the linear fan-out menu with a fullscreen radial overlay
showing three concentric zones: inner disc (momentary), middle ring (loop with
duration scaling), outer ring (latch). Active mode indicators: circular SVG
progress ring for loop, subtle glow for latch. Preserved iOS Safari audio
unlock strategy.

## March 6 — Volume Slope Curves

Replaced the flat linear gain-vs-size curve with per-waveform power curves.
Created a `Mastering` class in `js/audio/mastering.ts` consolidating all
perceptual gain constants. Square waves (exponent ~1.6) and triangle waves
(~1.3) ramp slower than sine (1.0), so rich-harmonic waveforms don't dominate
at small sizes. All three converge at medium size (0.5). Moved `areaToGain`,
`waveformGain`, `shapeAreaFraction`, and `borderOctaveGain` from scattered
locations into the mastering module.

## March 6 — Credits Display

Added a credits overlay accessible from a mushroom button in the stage corner.
Backdrop blur covers the stage; clicking anywhere outside links dismisses it.
Audio muffles via a lowpass filter (`muffle()`/`unmuffle()` methods on
`AudioEngine`) while the overlay is visible.

## March 6 — Stage Appearance Improvements

Removed the scanline pseudo-element overlays and `--audio-level` CSS plumbing.
Simplified the stage toggle from a three-mode cycle (minimal/subtle/florid) to
a linear cycle through background images, with a minimal Snow White texture as
the first image. Tied the splash toolbar fade to audio stop (toolbars stay
hidden until playback fully ends). Added subtle drop shadows to both toolbars.

## March 8 — Scene Asset Readiness & Preloading

Split IR loading into two phases: `fetchIR()` (network fetch, no AudioContext
needed) and `decodeIR()` (fast decode from cached bytes). New scene loader
module (`js/scenes/loader.ts`) orchestrates image + IR prefetch. `applyScene()`
became async with a two-layer CSS crossfade for background transitions.
Preloads the next scene's assets after each transition. Splash dismiss and
embed play block on scene readiness, ensuring reverb is present from the first
audio frame.

## March 8 — Button Ergonomics

Enlarged the play button (~40% larger), replaced the tabler play icon with a
custom rounded-corner triangle path, and enlarged the radial zone icons to 2x
button size. Added landscape orientation lockout on small screens
(`max-height: 500px`) that forces splash mode with a "Rotate to portrait"
message. Removed share functionality (reimplemented later as part of embed
mode).

## March 8 — Embed Mode

Rewrote the embed viewer (`embed.html`) from scratch as a self-contained
press-to-play tile. Scene background fills edge to edge with a dark bevel
gradient overlay. No visible play button — the entire tile is the click target.
Press-and-hold with 2s minimum duration. Diagonal gleam animation on load, tile
scale-down on press. Added a share UI overlay in the main app with link/embed
snippet generation, size slider, and "show spatch link" checkbox.

## Late March — Total Refactor

Decomposed three monolith files (`app.ts` 1253 lines, `audio.ts` 1135 lines,
`toolbar.ts` 953 lines) into 29 focused modules. Adopted `@preact/signals-core`
for reactive state propagation, replacing the manual listener/notify pattern in
`SigilStore` and the scattered `syncToSelectedShape()` calls. Extracted the
toolbar into per-panel modules with shared DOM helpers. Audio split into
engine, voice-builder, mapping, mastering, and formants modules. A cleanup
pass merged back 6 over-separated files. Postmortem findings:

- The toolbar was the real monolith, not app.ts.
- `syncToSelectedShape()` was invisible coupling — replaced by reactive effects.
- Some complexity is irreducible: 160-line state machines are fine, forced
  decomposition makes them worse.
- The canvas reconciler resists splitting — it's genuinely one concern at 774
  lines.
- Lint thresholds should start from reality (800 lines, 160 per function), not
  aspiration.
- Pure function DI is wasted abstraction — import directly.
- Duplication hides in monoliths; extraction reveals patterns.
