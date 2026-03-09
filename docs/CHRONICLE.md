# Chronicle

How spatch's architecture and feature set evolved, compressed from the design
documents and implementation plans that lived in `docs/plans/`. Each section
summarizes one body of work in roughly chronological order: the problem it
solved, the design decisions, what changed at the file level, and what
survived versus what was later superseded.

---

## March 1 — Bijective Audio-Visual Mapping

### The Principle

Every field in the canonical state must affect both canvas rendering and audio
synthesis. No visual-only state. No hidden audio parameters.

- Two states that look identical must sound identical.
- Two states that sound identical must look identical.
- Visual equivalences (rotation symmetry) are collapsed by making audio
  mappings periodic with the shape's geometric symmetry.

Violations must be unrepresentable in the type system, not merely discouraged
by convention. This principle governs every subsequent feature addition.

### Violations Found

**Visual-only state (looks different, sounds the same):**

1. Squiggle decorations — drawn on canvas, zero audio mapping.
2. Curlicue position and scale — only count mattered for audio (global detune
   at 15 cents per curlicue).
3. Decoration strokeColor/strokeWidth — visual-only on squiggles and curlicues.
4. Decoration targetShapeId — stored but affected neither rendering nor audio.
5. Text fontSize and scale — vocoder used text content and position but ignored
   visual size.
6. Radial fill h2, l2 — audio only averaged saturation. Second color's hue and
   lightness were ignored.
7. Linear gradAngle — the blend formula `abs(sin(gradAngle * PI / 360))` was
   symmetric, so gradAngle 90 and 270 sounded identical while the gradient
   pointed in opposite directions.

**Same visual, different audio:**

8. Square 90-degree rotational symmetry — a square at 0, 90, 180, 270 degrees
   looks identical, but `rotationToParam(rotation) = rotation / 360` mapped
   linearly, producing four different PWM widths.
9. Triangle 120-degree rotational symmetry — same problem with saw/tri blend.

### Design: Voice Discriminated Union

Replaced `Shape`/`Decoration` types with a canonical voice parameter type.
The discriminated union splits on waveform:

```
SineVoice { waveform: 'sine' }
  x → horizontal position + stereo pan
  y → vertical position + pitch (pentatonic)
  size → shape area + gain
  fill → color/gradient + formant filter
  effect → pattern overlay + audio effect chain

PulseVoice { waveform: 'pulse' }
  ...all SineVoice fields, plus:
  timbre → square rotation (periodic at 90°) + pulse width modulation

BlendVoice { waveform: 'blend' }
  ...all SineVoice fields, plus:
  timbre → triangle rotation (periodic at 120°) + saw/tri blend
```

Sine has no timbre because a circle has no distinguishable rotation and a pure
sine has no adjustable waveform parameter.

### Rotation Mapping

The timbre-to-rotation mapping uses a symmetric half-sine periodic with the
shape's vertex count:

```
param = sin(PI * (rotation % period) / period)
```

Where period = 360 / vertex_count (90 for square, 120 for triangle). This
repeats at each vertex (visually identical orientations → identical audio), is
symmetric within each segment (mirror-image orientations → identical audio),
and covers the full 0–1 range within each segment.

### Fill / Formant Fixes

Radial fill: both colors fully mapped to the formant filter by interpolating
all three HSL components between the two colors.

Linear fill gradAngle: replaced the symmetric formula with linear
`gradAngle / 360`, so every gradient angle produces a unique formant crossfade.

### Elements Removed

- Curlicue decorations (position/scale visual-only, global detune removed)
- Freehand/squiggle decorations (entirely visual-only)
- Decoration targetShapeId (dead field)
- Text strokeWidth (visual-only)
- Separate fontSize and scale on text (merged into one size field)

### State API Changes

- `addShape` → `addVoice`, `removeShape` → `removeVoice`, etc.
- `data.shapes` → `data.voices`, `data.decorations` → `data.texts`
- `createShape(type, x, y)` → `createVoice(waveform, x, y)`
- Shape IDs changed prefix from `s` to `v`
- Serialization updated to v2 compact format (no backwards compatibility
  per project rules)

### Type-System Enforcement

The discriminated union makes violations structurally impossible. Sine voices
have no `timbre` field — code that tries to read `sineVoice.timbre` is a type
error. This is deliberate: a circle has no distinguishable rotation, so there
is no parameter to map. Rather than having a `timbre` field that's "ignored for
sine," the field doesn't exist. The compiler enforces the bijection.

Similarly, fills were collapsed from multiple types (solid, linear, radial) to
two (solid, linear). Radial fills were removed because both HSL channels of
the second color were audio-dead (only saturation averaged). Instead of fixing
the mapping, the type was eliminated — fewer representations, fewer chances
for visual-only state.

### Files Changed

- `types.ts` — Voice union, TextDecoration, removed Shape/Decoration
- `state.ts` — voice/text CRUD, removed squiggle/curlicue
- `audio.ts` — periodic rotationToTimbre, fixed formant mappings
- `canvas.ts` — render voices, removed squiggle/curlicue drawing
- `shapes.ts` — hit testing updated for voices
- `serialize.ts` — v2 format
- `toolbar.ts` — updated for voice API
- `app.ts` — wired through
- `interaction.ts` — removed drawing mode

---

## March 1 — Inset Shadows / Master Reverb

### Problem

No reverb in the audio engine. The canvas was a single element, making it
impossible to layer CSS effects behind the shapes.

### Design

Added a `reverb` field to `SigilData` (global, not per-voice):

```
reverb: {
  depth: NormalizedCoord;   // 0 = dry, 1 = full wet
  style: 'glow' | 'dim';   // small room vs arena
} | undefined;
```

### Canvas Frame Split

Split the canvas into two elements:

```
#canvas-wrap
  #canvas-frame (div) — background, border-radius, bevel, inset box-shadow
  #sigil-canvas — transparent background, shapes only
```

The frame div owns the dark background (`#2a2a2a`), ADSR corner radii, and
bevel border. The canvas became transparent and draws shapes on top. This
ensures the inset shadow appears behind shapes and follows ADSR corner radii
naturally via CSS.

### Audio: ConvolverNode

Parallel dry/wet routing on the master chain:

```
voices → masterGain ──┬── destination              (dry path)
                      └── convolver → wetGain ── destination  (wet path)
```

Impulse responses generated algorithmically: glow = 0.3s decay with bright
noise, dim = 2s decay with lowpass-filtered noise. Style change regenerates
the IR buffer. Depth change updates wet gain only.

The algorithmic IR approach was simple but limited — two reverb flavors aren't
enough to distinguish scenes. Later replaced by per-scene `.m4a` impulse
response files (recorded from real spaces or hardware reverbs), which gave each
scene a vastly more distinctive character.

### What Survived

The canvas-frame split is still the current architecture (`#canvas-wrap` div
for background/border/shadow, `#sigil-canvas` SVG for shapes). The
ConvolverNode master reverb routing topology is the same, but the convolver
buffer now comes from decoded `.m4a` files via `ir-loader.ts` rather than
algorithmically generated noise.

### UI

Toolbar button + collapsible panel (depth slider, glow/dim toggle, remove
button). Same pattern as the border panel.

---

## March 1 — Theme Revamp

### Problem

The synthwave neon theme was distracting. Glowing buttons, pulsing animations,
and cyan accents competed with the shapes for visual attention.

### Color Palette

| Token            | Value     | Usage                              |
| ---------------- | --------- | ---------------------------------- |
| `--bg-body`      | `#e8e4e0` | Body, canvas area surround         |
| `--bg-toolbar`   | `#d5d0cb` | Toolbars, button faces             |
| `--bg-panel`     | `#ddd8d3` | Floating panels                    |
| `--border`       | `#b8b3ad` | Flat borders, dividers             |
| `--bevel-hi`     | `#f0ece8` | Bevel highlight (top/left)         |
| `--bevel-lo`     | `#a8a39d` | Bevel shadow (bottom/right)        |
| `--text-primary` | `#2a2a2a` | Primary text                       |
| `--text-muted`   | `#7a7570` | Secondary labels                   |
| `--danger`       | `#cc3344` | Delete, destructive actions        |

### Bevel System

Buttons use a 1px border-color trick:
- Raised: `border-color: hi right lo left` (highlight top/left, shadow
  bottom/right)
- Pressed/active: borders swap (shadow top/left, highlight bottom/right)

No gradients, no box-shadows on interactive elements. All controls are 36px
(up from 32px), border-radius 2px.

### Removals

- `@keyframes pulse-glow` and `@keyframes canvas-glow`
- Scanline overlay (`#canvas-wrap::after`)
- All neon box-shadows and text gradients
- Selection handles changed from cyan/purple to white/black
- Canvas area radial gradient background → flat `--bg-body`

### What Survived

This palette and bevel system is still the current UI treatment. The only
addition since was toolbar drop shadows (March 6).

---

## March 2 — First-Load Splash

### Problem

New visitors see a complex editor UI with no context. They need to hear the
instrument before seeing the controls.

### Approach

CSS opacity + JS orchestration. `body.splash` sets toolbars to `opacity: 0;
pointer-events: none` while keeping them in document flow (no layout shift).
Transition duration set dynamically by JS to match `envelope.release`.

### Persistence

localStorage key: `"spatch-seen:<pathname><hash>"`. Set to `"1"` when splash
completes. On load, if key exists, skip splash. URL-specific so each shared
link gets its own splash.

### Interaction Flow

1. Pointer-down on canvas area: start playback, record timestamp
2. Pointer-up:
   - If held >= 2s: release + reveal immediately
   - If held < 2s: wait remainder, then release + reveal
3. Release + reveal: set `transition-duration` on toolbars to
   `max(0.3, envelope.release)`, call `audio.release()`, remove `body.splash`
   class, set localStorage key, clean up after transition ends

### Edge Cases

- Empty canvas: plays silence, 2s minimum still applies
- No audio context: first pointer-down resumes AudioContext as usual
- Keyboard Space blocked during splash
- Panels hidden by default (`.hidden` class), splash opacity rule is a
  safety net

### Integration Test Impact

All existing integration tests needed a `beforeEach` that sets the localStorage
key via `page.addInitScript`. A shared `helpers/skip-splash.js` file was
created for this.

---

## March 2 — Toolbar Redesign

### Problem

Unicode characters as icons were inconsistent across platforms. Text labels
took space. All actions required keyboard shortcuts — nothing was accessible
on mobile without a keyboard.

### Icon Strategy: SVG Sprite

A mini SVG sprite containing ~24 Tabler Icons, referenced via `<use href>`:

```html
<svg width="20" height="20">
  <use href="tabler-sprite.svg#tabler-arrow-back-up" />
</svg>
```

Shape buttons (triangle/square/circle) kept their hand-drawn inline SVGs.
The sprite was later replaced by a custom Vite plugin that scans source files
for icon references and builds the sprite at compile time.

### Top Bar Layout

```
[SPATCH] [▶ play] [↗ share] │ [◎ reverb] │ [↩ undo] [↪ redo] │ [+ new]
```

Play button uses filled icons (`player-play-filled` / `player-stop-filled`).
Fan gesture reversed to drop downward. Share opens existing dropdown below.
Reverb toggle opens popover below. Undo/redo show keyboard shortcuts in title
attributes. New button clears all voices with undo snapshot.

### Bottom Bar: Context-Sensitive

**No selection (shape tools):**

```
[↖ select] │ [△ triangle] [□ square] [○ circle]
```

**Shape selected (property controls):**

```
[■ swatch] [≡ pattern ▾] [⊕ blend ▾] [□ border] │ [🗑 delete]
```

Fast crossfade (100ms) when selection state changes. Fill swatch opens inline
expansion (bar grows upward). Pattern dropdown shows CSS-rendered preview
bands. Blend dropdown shows icon items. Border opens inline expansion.

### SVG Sprite: Build Pipeline

The initial implementation bundled a hand-assembled SVG sprite file. This was
fragile — adding an icon meant editing the sprite, verifying it included the
right `<symbol>` IDs, and hoping no one forgot.

A custom Vite plugin replaced this:

1. At build time, scan all `.html`, `.ts`, and `.css` source files for icon
   references matching `tabler-*` patterns.
2. Resolve each referenced icon from `node_modules/@tabler/icons/icons/*.svg`.
3. Build a single `<svg>` sprite containing only the used icons as `<symbol>`
   elements.
4. Inline the sprite into the HTML output (no separate network request).

If a referenced icon doesn't exist in the Tabler package, the build fails with
a clear error. This catches typos at compile time rather than showing a blank
icon at runtime.

The plugin lives at `scripts/vite-plugin-svg-sprite.ts` and is reusable across
any Vite project using Tabler icons.

### Removals

- All Unicode icon characters
- Text labels "PLAY"/"STOP"
- Native `<select>` for blend mode
- Text tool button and text input
- Text labels inside panels

### Touch Targets

All interactive elements minimum 44×44px. Bottom bar gets additional vertical
padding. Dropdown items at least 44px tall.

---

## March 3 — Shrillness Fix

### Problem

Three root causes of harsh audio:

1. **Pitch range too high.** BASE_MIDI 48 (C3) spans to C6. Square and
   sawtooth harmonics at the top are painful.
2. **Lightness→brightness mapping ineffective.** A highshelf at 2 kHz with
   ±7 dB does almost nothing to tame harmonics at 4–16 kHz.
3. **Auto EQ aggressive and counterproductive.** Peaking filters boosting
   sines by up to 18 dB create shrill resonances.

### Changes

**1. Lower base pitch: C3 → G2.** BASE_MIDI 48 → 43. Pentatonic range becomes
G2–G5 instead of C3–C6.

**2. Lowpass cutoff from lightness.** Replaced the highshelf BiquadFilterNode
with a lowpass filter. Exponential curve: lightness 0 → ~300 Hz (dark,
muffled), lightness 50 → ~2500 Hz (warm, natural), lightness 100 → ~12000 Hz
(bright, open). Q fixed at 0.707 (Butterworth, no resonance).

**3. Remove auto EQ.** Deleted `_autoEQ` array, `_applyAutoEQ` method,
`spectralNeed` function. Simplified master chain from
`masterGain → [EQ bands] → envelopeGain → compressor` to
`masterGain → envelopeGain → compressor`.

**4. Reduce formant max Q.** From 12 to 8 for rich waveforms (sine stays at
4). Q=8 still produces clear vowel character.

**5. Sine presence.** Bumped `waveformGain` from 1.4 → 1.6. Inserted a gentle
waveshaper (`Math.tanh(x * 1.5)`) after the sine oscillator, adding faint
2nd/3rd harmonics (~-20 dB below fundamental). Similar to analog oscillator
impurity.

### Psychoacoustic Rationale

The core problem is that frequency spectrum content determines perceived
loudness, not just amplitude. A sawtooth wave contains all integer harmonics
(1/n amplitude); at 1 kHz fundamental, its 8th harmonic (8 kHz) is in the
ear's most sensitive range. A sine at the same amplitude sounds quieter
because it only excites one critical band.

The lowpass-from-lightness mapping addresses this elegantly: dark fills → low
cutoff → rich waveforms lose their upper harmonics → perceived loudness drops
toward sine levels. Bright fills → high cutoff → all harmonics pass → full
brightness. The visual correlate is intuitive: dark shapes sound dark.

### Scope

All changes in `js/audio.ts`. No serialization, canvas, or type changes.

---

## March 3 — Stage Themes

### Problem

The stage area (between toolbars, outside canvas) was flat warm gray. It needed
personality.

### Modes

Three modes, cycled by a single button:

| Mode        | Description                                              |
| ----------- | -------------------------------------------------------- |
| **Minimal** | Flat warm gray, no decoration                            |
| **Subtle**  | Soft pastel gradient (pink → lavender → teal), faint     |
|             | horizontal scan lines                                    |
| **Florid**  | Background image from curated library, pastel gradient   |
|             | overlay, scan lines                                      |

Cycle: minimal → subtle → florid(image 1) → minimal → subtle →
florid(image 2) → ...

### CSS Architecture

```
#canvas-area            — base background
  ::before              — background image (florid) or gradient (subtle)
  ::after               — scan lines overlay + pastel gradient tint
  #canvas-wrap          — the instrument (above both layers)
```

Reactive behavior during playback via `--audio-level` CSS custom property
from the AnalyserNode:
- `filter: hue-rotate(calc(var(--audio-level) * 30deg))` on gradient overlay
- `transform: translateY(calc(var(--audio-level) * 4px))` on scan lines

### Image Library

Seven background images shipped in `stage/` directory (30–390 KB each).
Persistence via localStorage key `"stage-theme"` containing mode index and
image index.

### What Happened Next

Superseded by the scene system, which evolved incrementally across several
features without a single formal plan. The key insight was that background
images and audio character should be coupled — a reverberant cathedral image
should sound reverberant. Scenes unified:

- **Visual**: background image (full-bleed behind the canvas frame)
- **Audio**: vibe preset (reverb IR, EQ, compression, gain curves, warmth)
- **Serialization**: scene index as 1 B64 char in the URL hash

Each scene became a self-contained module (`js/scenes/<name>/`) with its own
background `.jpg`, optional impulse response `.m4a`, and `index.ts` exporting
a `Scene` object. The `SCENES` array registry replaced the localStorage-based
stage mode/image indices entirely.

The stage-mode concept (minimal/subtle/florid) was collapsed into a flat list
of scenes. The "minimal" scene used a tileable plastic texture instead of a
blank gray. Clicking the stage button cycles through scenes linearly.

The `Vibe` class (`audio/vibe.ts`) encapsulates all audio tuning that varies
per scene: ~25 optional parameters including reverb mix, 3-band EQ, compressor
settings, formant scaling, stereo width, and octave gain coefficients. Each
scene provides `vibe: Partial<VibeOptions>` with only the params it wants to
override; `VIBE_DEFAULTS` fills the rest. This gives each scene a distinct
sonic character without requiring every scene to specify every parameter.

The stage index became part of `SigilData` (via `store.updateScene()`), meaning
scene is serialized into shared URLs and embed codes. A shared link preserves
not just the shapes but the audio environment they were composed in.

---

## March 3 — SVG Migration

### Why

1. **Retina crispness.** Canvas fixed at 800×800 pixels, soft on 2x displays.
   SVG is resolution-independent.
2. **Code reduction.** ~150 lines of hit-testing math deleted (barycentric,
   isPointInVoice). Offscreen blend canvas hack deleted. Pattern tile cache
   deleted. Net reduction ~200–300 lines.
3. **CSS animations.** Selection glow, marching ants, play gleam become
   declarative CSS.
4. **Devtools debugging.** Every shape inspectable in the DOM.

### Coordinate System

`<svg viewBox="0 0 1 1">` — normalized 0–1 coordinates map directly. No more
`CANVAS_SIZE` constant or `* 800` / `/ 800` scaling anywhere.

### Rendering Model

The canvas renderer cleared and repainted every frame. The SVG renderer is a
DOM reconciler: create SVG elements when voices are added, remove when deleted,
update attributes on change. Elements keyed by voice ID.

### Layer Stack

```
#canvas-frame (div — background, border-radius, shadows, ADSR corners)
  └─ <svg viewBox="0 0 1 1">  (shapes, text, selection UI)
```

### Blend Modes

All voice elements inside `<g style="isolation: isolate">`. Each voice gets
`mix-blend-mode: <voice.blend>` via inline style. Replaced the offscreen
`_blendCanvas` / `_blendCtx` hack entirely.

### Hit Testing — Hybrid

- **Shape selection**: native SVG pointer events. Each voice `<g>` has
  `data-voice-id`. `pointerdown` checks
  `event.target.closest('[data-voice-id]')`. Eliminates `hitTestShapes`,
  `isPointInVoice`, and barycentric math.
- **Resize/rotate handles**: SVG elements with `data-handle` attributes.
  The handle *math* (`calcResize`, `calcRotation`) stays in `shapes.ts`.
- **ADSR corners**: stays algorithmic (corners are on the frame div).
- **Coordinate conversion**: `svg.getScreenCTM().inverse()` + `DOMPoint`
  replaces `canvasCoordsFromClient`.

### SVG Shape Elements

| Voice | SVG Element | Notes |
|-------|-------------|-------|
| sine  | `<circle cx={x} cy={y} r={size/2}>` | No rotation |
| pulse | `<rect>` centered at (x,y) | `transform="rotate(…)"` from timbre |
| blend | `<polygon>` equilateral triangle | `transform="rotate(…)"` from timbre |

### Fills

- Solid: `fill="hsl(h, s%, l%)"`
- Linear: `<linearGradient>` in `<defs>`, `fill="url(#grad-{voiceId})"`

### SVG Patterns

Each pattern is an SVG `<pattern>` element in `<defs>`:

| Pattern  | SVG Implementation                    |
| -------- | ------------------------------------- |
| stripes  | `<pattern>` with alternating rects    |
| checker  | `<pattern>` with 2×2 rect grid        |
| noise    | `<filter>` with feTurbulence          |
| gradient | `<linearGradient>` overlay at 35%     |

Patterns are applied via a two-layer clipped group: the voice shape is drawn
with its fill, then a second copy with the pattern `fill="url(#pat-{id})"` is
layered on top, both clipped to the shape outline. This produces the correct
visual of pattern-over-fill without compositing hacks.

### Selection UI

Moved from algorithmic canvas drawing to CSS-animated SVG elements:

- **Selection outline**: dashed stroke on the shape, animated via CSS
  `stroke-dashoffset` (marching ants effect, pure CSS `@keyframes`)
- **Resize handles**: small SVG circles at cardinal and corner points
  of the bounding box, `data-handle="n|s|e|w|ne|nw|se|sw"`
- **Rotation handle**: circle above the bounding box connected by a line,
  `data-handle="rotate"`
- **Play gleam**: CSS `@keyframes` sweep on the canvas frame (diagonal
  highlight gradient), declarative instead of JS-driven

All selection geometry recalculated in the reconciler when voice attributes
change. Handle positions account for rotation transforms.

### Removals

- Rough pattern (visual + audio bitcrusher worklet)
- `worklets/bitcrusher.js` deleted
- Offscreen blend canvas
- Canvas pattern tile cache
- `CANVAS_SIZE` constant
- Manual hit-test math (`isPointInVoice`, `hitTestShapes`, barycentric
  triangle containment check)

### File Impact

| File | Change |
|------|--------|
| `canvas.ts` | Rewrite — SVG DOM reconciler |
| `shapes.ts` | Shrink — deleted hit test math, kept resize/rotate/ADSR |
| `patterns.ts` | Rewrite — SVG `<pattern>` defs |
| `colors.ts` | Edit — SVG-compatible fill values |
| `app.ts` | Edit — SVG setup, getScreenCTM coords, data-voice-id detection |
| `effects.ts` | Edit — removed bitcrusher/rough case |
| `audio.ts` | Edit — removed worklet registration |
| `serialize.ts` | Edit — removed 'r' from effect map |
| `types.ts` | Edit — removed 'rough' from PatternType |
| `toolbar.ts` | Edit — removed rough button |
| `index.html` | Edit — `<canvas>` → `<svg>` |
| `embed.html` | Edit — same |
| `worklets/bitcrusher.js` | Deleted |

---

## March 4 — Border Octave Oscillator Gain Fix

### Problem

1. The octave-doubled oscillator's gain was set to `Math.sqrt(thickness)` at
   build time and never updated. Resizing a shape changed primary voice volume
   but left the border oscillator at its original level.

2. The `borderKey` for change detection included thickness. Any thickness
   slider movement triggered a full voice teardown+rebuild, causing audible
   glitches.

### Fix

**Perceptual gain function.** `borderOctaveGain()` computes gain from shape
size, thickness, and octave direction:

```
baseGain = areaToGain(waveform, size) * waveformGain(waveform)
coeff = direction-dependent loudness correction
result = baseGain * sqrt(thickness) * coeff
```

Direction coefficients (psychoacoustic equal-loudness compensation):
- 1 octave up (white): ×0.5 (attenuate — higher freqs sound louder)
- 2 octaves up (white, double): ×0.35
- 1 octave down (black): ×1.5 (boost — lower freqs need more energy)
- 2 octaves down (black, double): ×2.0

**Border key split.** Changed from `color:double:thickness` to `color:double`.
Only topology changes trigger rebuilds. Thickness changes flow through smooth
`setValueAtTime` parameter updates.

**Stored octave gain node.** Added `octaveGainNode: GainNode | undefined` to
the audio voice object, populated in `_buildVoice`, used in `updateVoices`.

Scope: only `js/audio.ts` changed.

---

## March 5 — Blend Mode Audio Mapping

### Problem

CSS `mix-blend-mode` was a visual-only property — shapes blended visually when
overlapping, but there was no audio consequence. This violated the bijection
principle.

### Design

Seven blend modes, each mapping to an audio effect chain:

| Blend Mode | Visual Effect | Audio Effect |
|------------|--------------|-------------|
| `soft-light` | Gentle contrast boost | Tape saturation (waveshaper) |
| `multiply` | Darkening overlap | Heavy saturation (aggressive waveshaper) |
| `screen` | Lightening overlap | Dynamic compression |
| `overlay` | Contrast enhancement | Harmonic exciter (high shelf + saturation) |
| `color-burn` | Deep shadows | Noise gate |
| `difference` | Color inversion | Comb filter (feedforward delay) |
| `exclusion` | Softer inversion | Swept flanger (modulated delay) |

### Wet/Dry from Geometry

The critical design decision: there is no stored wet/dry parameter. The blend
effect intensity is computed geometrically from shape overlap at render time.

`computeOverlap()` in `effects.ts` calculates how much of a voice's area
overlaps with all other voices. The overlap fraction (0 = isolated, 1 = fully
covered) drives the blend effect's `wetGain`. A shape sitting alone has no
blend effect (wet = 0). Drag it over another shape and the effect fades in
proportionally.

This preserves the bijection: the degree of visual blending exactly corresponds
to the degree of audio effect. You can see how much effect a shape has by how
much it overlaps. Moving shapes apart removes the effect both visually and
aurally.

### Signal Chain

```
voice oscillators → formant filter → pattern effect → blend effect → masterGain
                                                      ↑
                                              wetGain from overlap
```

Blend effects return `{ input, output, wetGain, dispose }`. The `wetGain` node
is updated by the render loop whenever voice positions change, using the
computed overlap fraction. This is the only audio parameter driven by the
reconciler rather than by state changes.

---

## March 6 — Radial Play Gesture

### Problem

The play button's fan-out menu was hidden by the user's finger on mobile. The
button was in the top toolbar, far from comfortable thumb reach.

### Button Relocation

Moved from top toolbar to the stage area, centered horizontally below the
canvas frame. Adopted the stage switcher's visual style: transparent
background, no border, white icon with `drop-shadow`.

### Radial Overlay Zones

On `pointerdown`, audio starts playing. A translucent overlay appears centered
on the button covering the full app, with three concentric filled zones:

- **Inner disc** (~80px radius): momentary zone. Release here stops playback.
- **Middle ring** (~80px to ~70% of screen edge): loop zone. Largest area.
  Loop duration scales logarithmically with drag distance (100ms–2000ms).
- **Outer ring** (remaining space): latch zone. Wide enough for thumb release
  at device edge.

Zones have similar translucency with slightly different tints. Active zone
highlights with brighter tint.

### Active State Indicators

- Any active mode: play icon swaps to stop icon
- Loop mode: circular SVG progress ring around button, filling clockwise
- Latch mode: subtle glow around button

### Removals

- `.play-fan-wrap`, `.play-fan`, `.fan-option` elements and CSS
- Mode indicator badges
- Left-to-right linear gradient loop animation

### Preserved

- iOS Safari audio unlock strategy (warmUp on pointerdown)
- Audio engine integration, playback state machine core logic
- Keyboard Space toggles latch mode (unchanged)

---

## March 6 — Volume Slope Curves

### Problem

The gain-vs-size curve was linear in area for all waveforms. Square and
triangle waves have richer harmonics that excite more auditory critical bands,
so they grew perceptually louder faster than sine.

### Design: Mastering Class

New file `js/audio/mastering.ts` with a `Mastering` class holding all
perceptual tuning constants as readonly properties. No Web Audio nodes — just
numbers.

```
class Mastering
  readonly GAIN_MIN = 0.05
  readonly GAIN_MAX = 0.8
  readonly WAVEFORM_GAIN: Record<WaveformType, number>
  readonly GAIN_EXPONENT: Record<WaveformType, number>
  readonly OCTAVE_GAIN_COEFF: Record<string, number>
  areaToGain(waveform, size): number
  waveformGain(waveform): number
  voiceGain(waveform, size): number
  borderOctaveGain(waveform, size, thickness, color, double): number
```

### Power Curve

Previous formula (linear in area):

```
gain = min(0.8, 0.05 + fraction)
```

New formula with per-waveform exponent:

```
normalized = fraction / maxAreaForWaveform
gain = min(GAIN_MAX, GAIN_MIN + (GAIN_MAX - GAIN_MIN) * normalized^exponent)
```

Exponents:
- sine: 1.0 (linear, preserves previous behavior)
- pulse (square): ~1.6 (slower ramp, tames rich harmonics)
- blend (sawtooth/tri): ~1.3 (moderate taming)

At size=0.5, `voiceGain()` produces roughly equal values for all three
waveforms. Below medium size, sine is louder (harmonics-rich waveforms are
tamed). Above medium size, pulse/blend ramp up faster to meet at the cap.

### What Moved Where

**To `mastering.ts`:** `areaToGain`, `waveformGain`, `shapeAreaFraction` from
`mapping.ts`; `borderOctaveGain`, `OCTAVE_GAIN_COEFF` from `formants.ts`.

**Stayed put:** `yToFrequency`, `snapYToNote`, `xToPan`, `rotationToTimbre`
in `mapping.ts`; `hueToFormants`, `lightnessToCutoff`, `applyFormantFilter`
in `formants.ts`.

### Bijection Note

Visual area still maps to gain for all waveforms. The response curve differs
per waveform as a perceptual compensation — two shapes that look identical
still sound identical. The mapping is deterministic and injective; it's just
not the same function for each waveform type.

---

## March 6 — Credits Display

### Design

A `.stage-btn` in the bottom-right of `#stage` toggles a full-stage overlay
with backdrop blur. Credits text centered over the stage.

### Audio Muffling

Added `muffle()` and `unmuffle()` methods to `AudioEngine`. A lowpass
`BiquadFilterNode` inserted at the end of the audio chain (after analyser,
before destination). `muffle()` ramps cutoff to 600 Hz over 150ms.
`unmuffle()` ramps back to 20 kHz. The filter is always present in the chain
during playback; its cutoff just stays at 20 kHz (inaudible) when unmuffled.

### Files

- `js/audio/engine.ts` — muffle filter in chain, muffle/unmuffle methods
- `index.html` — credits button and overlay markup
- `css/style.css` — overlay with `backdrop-filter: blur(12px)`,
  semi-transparent black background
- `js/credits.ts` — toggle logic, click-to-dismiss, audio muffling
- `js/app.ts` — import and initialize

---

## March 6 — Stage Appearance Improvements

### Changes

**1. Removed scanlines overlay.** Deleted `#stage::before`, `#stage::after`
pseudo-element rules, `--audio-level` CSS variable, `setAudioLevel()` from
`stage.ts`, and its call site in `app.ts`.

**2. Simplified stage cycle.** Replaced the three-mode toggle
(minimal/subtle/florid) with a simple linear cycle through all background
images. A new "minimal" stage — a tileable Snow White / Platinum plastic
texture — became the first image in the cycle. Removed `stage-florid` CSS
class and all rules gated on it. Stage always shows a background image;
`#app` always gets `background-image` from the current scene.

**3. Splash fade tied to audio.** The toolbar fade-in previously started
immediately on splash dismiss (0.5s fixed). Changed to wait until playback
fully stops (ADSR release + reverb tail), making the splash a dramatic
reveal.

Sequence:
1. User presses and releases on splash
2. Audio warmup + playback starts (unchanged)
3. Toolbars remain hidden while audio plays
4. After release and audio stop, begin toolbar fade-in
5. Fade duration ~0.5s–1s

**4. Toolbar drop shadows.** Both toolbars got subtle, always-present
`box-shadow`: top bar casts downward (`0 2px 4px rgba(0,0,0,0.12)`),
bottom bar casts upward.

---

## March 7 — Interaction State Machine

### Problem

Canvas interaction state was scattered across 8 boolean flags (`isDragging`,
`isResizing`, `isRotating`, `isPinchRotating`, `isAdjustingADSR`, etc.) and
several coordinate variables. It was possible to accidentally set `isDragging`
and `isResizing` simultaneously — an invalid combination that produced
unpredictable behavior.

### Design: Discriminated Union

Replaced all flags with a single `InteractionState` discriminated union:

```
type InteractionState =
  | { type: 'idle' }
  | { type: 'dragging'; voiceId: string; offsetX: number; offsetY: number }
  | { type: 'resizing'; voiceId: string; handle: HandleDir; origin: Point }
  | { type: 'rotating'; voiceId: string; startAngle: number }
  | { type: 'adsr'; corner: ADSRCorner; startRadius: number }
  | { type: 'pinch-rotate'; voiceId: string; startAngle: number; startDist: number }
```

Each state variant carries exactly the data needed for that interaction. The
`type` field is the discriminant. Pattern matching via `switch (state.type)`
ensures every handler explicitly considers its state.

### Invalid States Become Unrepresentable

With booleans, "dragging while resizing" was a valid memory configuration
(both `true`). With the union, the state is a single value — it's either
`dragging` or `resizing`, never both. The compiler enforces this.

### Transition Table

```
idle + pointerdown on voice     → dragging
idle + pointerdown on handle    → resizing | rotating
idle + pointerdown on corner    → adsr
dragging + pointermove          → update voice position
dragging + pointerup            → idle (snap to nearest note)
resizing + pointermove          → update voice size
resizing + pointerup            → idle
rotating + pointermove          → update voice timbre
rotating + pointerup            → idle
adsr + pointermove              → update envelope corner
adsr + pointerup                → idle
any + Escape                    → idle (cancel)
```

### File Impact

- `interaction.ts` — type definitions (pure data, no logic)
- `canvas/interaction.ts` — `CanvasInteractionController` class with all
  pointer handlers, consumes `InteractionState`
- `app.ts` — delegates pointer events to controller

---

## March 8 — Scene Asset Readiness & Preloading

### Problem

The IR file loaded lazily on first `play()` — reverb was missing for the first
moments of playback. Background images could flash-load visibly on scene
change.

### Constraint

`decodeAudioData` requires an `AudioContext`, which doesn't exist until the
first user gesture. The network fetch is the slow part; decoding is fast.

### IR Loader Split

`ir-loader.ts` split into two layers:

- `fetchIR(filename): Promise<ArrayBuffer>` — network fetch with byte cache.
  No AudioContext needed. Deduplicates in-flight requests.
- `decodeIR(ctx, filename): Promise<AudioBuffer>` — decodes from byte cache.
- `loadIR(ctx, filename)` — composition of both (backwards compatible for
  debug vibe tuner).

### Scene Loader Module

New `js/scenes/loader.ts`:

```
prefetchScene(scene) → Promise<void>
  Fetches IR bytes + preloads image via Image(). No AudioContext needed.

loadSceneIR(ctx, scene) → Promise<AudioBuffer>
  Decodes prefetched bytes. Fast if already cached.

preloadNextScene(currentIndex) → void
  Fire-and-forget prefetch for next scene.
```

### Two-Layer Background Crossfade

`background-image` doesn't CSS-transition. Solution: two stacked `<div>`s
inside `#stage`, each holding a background image. On scene change the incoming
layer starts at `opacity: 0` and transitions to `1` while the outgoing
transitions to `0`. After transition ends, layers swap roles and the old one
is cleared.

### applyScene() Became Async

Returns `Promise<void>` resolving when image + IR bytes are both fetched.
Crossfade transition begins only when both assets are ready. After transition
settles, calls `preloadNextScene(currentIndex)`.

### Flow: Initial Load

```
page load → prefetchScene(current) starts immediately
         → splash screen covers the wait
user dismisses splash → await prefetchScene promise
                      → warmUp() (creates AudioContext)
                      → decodeIR (fast, bytes cached)
                      → play() with reverb from frame 1
```

### Flow: Scene Change

```
user clicks stage → applyScene(new) returns Promise
                  → fetch IR bytes + preload image
                  → crossfade begins when both ready
                  → setVibe(new) + hot-swap reverb if playing
                  → preloadNextScene(new index)
```

### Flow: Embed Page

```
page load → prefetchScene(scene from URL)
          → play button disabled
          → when ready: add 'ready' class, enable play
          → first play has reverb from frame 1
```

### Engine Changes

`_buildReverb` accepts optional pre-decoded `AudioBuffer`. When provided, sets
`convolver.buffer` synchronously. Falls back to async `loadIR` when not
provided (debug tuner path).

---

## March 7 — Harmonize & Randomize

### Problem

Creating musically pleasing compositions required manual precision — dragging
each voice to a specific Y position that happened to land on a consonant pitch.
Most casual users would scatter shapes randomly, producing atonal clusters.

### Pitch System Background

Y position maps to pitch via `yToFrequency()` in `mapping.ts`. The range spans
G2 to G5 (three octaves), chromatic. During drag, voices magnetically snap to
the nearest semitone (visual feedback: the shape "sticks" to pitch lines).
On pointer release, the voice snaps to the nearest note with `snapYToNote()`.

### Harmonize

`harmonize()` in `harmony.ts` picks a random musical scale and snaps every
voice to the nearest note in that scale. Nine scales available:

| Scale | Intervals | Character |
|-------|-----------|-----------|
| Major pentatonic | 0,2,4,7,9 | Bright, universally consonant |
| Minor pentatonic | 0,3,5,7,10 | Bluesy, warm |
| Mixolydian | 0,2,4,5,7,9,10 | Major with flat 7, rock/folk |
| Lydian | 0,2,4,6,7,9,11 | Dreamy, raised 4th |
| Phrygian | 0,1,3,5,7,8,10 | Spanish/Middle Eastern |
| Dorian | 0,2,3,5,7,9,10 | Jazz minor, sophisticated |
| Natural minor | 0,2,3,5,7,8,10 | Dark, classical |
| Blues | 0,3,5,6,7,10 | Blues with chromatic passing tone |
| Mu | 0,2,4,5,7,9,11 | Steely Dan's favorite |

Each voice's Y position is adjusted to the nearest pitch that belongs to the
chosen scale. The scale's root is chosen randomly from the 12 chromatic pitches.
The operation wraps in an undo snapshot so it can be reversed.

### Randomize

`randomize()` creates a fresh composition:

1. Picks a random scene (calls `store.updateScene()`)
2. Generates a random ADSR envelope
3. Creates 3–7 voices with randomized properties:
   - Random waveform (sine/pulse/blend)
   - Random position, size, fill, effect, blend mode
   - Random border (or none)
   - For pulse/blend: random timbre
4. Calls `harmonize()` on the result

This ensures every random composition is at least tonally coherent.

### UI

Harmonize is triggered from a long-press on the harmonize button in the
toolbar. The harmonize panel (`toolbar/harmonize-panel.ts`) shows the scale
name briefly after harmonizing. The randomize button (dice icon) is a
separate toolbar button.

---

## March 8 — Button Ergonomics

Four independent UI fixes:

### Larger Floating Zone Icons (#200)

The radial zone icon (lock/repeat during play-button drag) was too small on
mobile, hidden under the thumb. Made `.radial-zone-icon` 2x the play button
size. SVG stays at 60%, so visible icon is ~1.2x button diameter. Used filled
tabler icons.

### Play Button Enlargement (#221)

Increased `--play-btn-size` by ~40%: from `clamp(62px, 13vmin, 84px)` to
`clamp(86px, 18vmin, 118px)`. Replaced tabler play icon with an inline
`<path>` — a rounded-corner equilateral triangle matching the stop square's
aesthetic. Mode icons (lock/repeat) moved from bottom-right badge to centered
within the button.

### Landscape Lockout (#218)

Wide mobile screens in landscape make the canvas unusably small. Uses
`matchMedia('(orientation: landscape) and (max-height: 500px)')`. When
matched: removes `is-editing` from body, stops playback, sets splash state
active, blocks splash dismiss until query no longer matches. Shows "Rotate
to portrait" message. Listens via `change` event on `MediaQueryList`.

### Remove Share Functionality (#217)

Deleted share button and share menu from HTML, deleted `share.ts`, removed
all imports and wiring. Clean removal — share was reimplemented later as part
of embed mode with a different UX.

---

## March 8 — Embed Mode

### Embed Viewer

Self-contained HTML page loaded via iframe. Receives sigil state from URL hash.
No editing — the only interaction is press-to-play.

**Visual:**
- Scene background fills entire embed edge to edge
- Dark bevel gradient tile overlays the full area, colors ~30% more
  transparent so scene bleeds through
- SVG shapes rendered with all fills, patterns, borders, blend modes
- ADSR corner radii applied to outer container
- Optional "spatch" text link at bottom center (controlled by `?nolink` param)
- No visible play button — the entire tile is the touch/click target
- Cursor: `pointer`

**Interaction:**
- Press/click anywhere to play, release to begin release phase
- Minimum 2 seconds: tap plays for 2s then releases; hold longer plays until
  release
- No latch, no loop, no toggle

**Animations:**
- Gleam: diagonal highlight sweep on load (CSS pseudo-element with linear
  gradient, fires once after assets ready)
- Press-down: tile scales to ~0.97 on pointer down, back to 1 on up

**Audio:** Same iOS Safari unlock strategy. Load scene IR, set vibe. Play on
pointer down, release on pointer up or after 2s minimum.

**Asset readiness:** The embed tile starts with a diagonal gleam animation
(CSS pseudo-element) but blocks interaction until both the scene background
image and IR audio bytes are fetched. A `ready` class gates the pointer
cursor and event handling. This prevents the jarring experience of pressing
a tile and hearing dry audio while the reverb loads.

**Build:** Separate Vite entry point (multi-entry via `vite.config.ts` `input`
object). The embed page gets its own JS bundle but shares core modules with the
main app via Vite's chunk splitting:

```
Shared chunks (automatically extracted by Vite):
  serialize.ts     — URL hash ↔ SigilData
  canvas/render.ts — SVG DOM reconciler
  audio/engine.ts  — AudioContext, master chain
  audio/vibe.ts    — Vibe class, scene tuning
  scenes/*         — all scene definitions + assets
  types.ts         — Voice, Fill, etc.

Embed-only:
  embed-entry.ts   — init, press-to-play, asset readiness
  embed.html       — minimal HTML shell

Main-app-only:
  app.ts           — full editor orchestration
  toolbar/*        — editing UI
  keyboard.ts      — shortcuts
  state/           — selection, undo
```

This means updating a shared module (e.g., adding a new scene or changing the
serialization format) automatically affects both the main app and embed viewer
without any manual synchronization.

### Share UI (Main App)

**Button:** Upper-left of stage. Same style as credits button but slightly
larger (~52px) and more opaque at rest. Only visible when `body.is-editing`.

**Panel:** Click opens blur overlay covering entire stage (same as credits).
Click outside to dismiss. Audio muffles while open.

**Layout — Link section:** Read-only code block showing full URL. Copy button.

**Layout — Embed section:**
- Size slider: continuous, 150px–600px, default ~300px. Always square.
- "Show spatch link" checkbox: default on. When off, adds `?nolink` to embed
  URL.
- Read-only code block with `<iframe>` snippet, updates live.
- Copy button.

Hash generated fresh from current `SigilStore` state when panel opens.

---

## Serialization Format Evolution

Not a single body of work — the serialization format changed with nearly every
feature addition. Key constraints:

1. **No keys.** Fields are positional. The URL hash is a dense bitfield, not
   JSON. This keeps URLs short enough for social sharing.
2. **No IDs.** Voice IDs are runtime-generated. Serialization preserves voice
   data in array order; IDs are regenerated on deserialize.
3. **No backwards compatibility.** Per project rules, old URLs break when the
   format changes. No version checks, no migration code, no legacy
   deserializers.
4. **HSL quantized.** Hue (0–360) stored as 0–255 (1 byte). Saturation and
   lightness (0–100) stored as 0–63 (6 bits). NormalizedCoord values stored
   as 0–255.

Format structure (current):

```
[1 char: scene index (0–63)]
[4 chars: ADSR envelope (attack, decay, sustain, release)]
[per voice:
  1 char: flags (waveform 2 bits, fill type 1 bit, has-effect 1 bit,
                 blend mode 3 bits, has-border 1 bit)
  2 chars: x, y (each 0–255)
  1 char: size (0–255)
  fill data: solid = 3 chars (H, S, L); linear = 7 chars (H1, S1, L1, H2, S2, L2, angle)
  1 char: effect type (if has-effect flag set)
  1 char: timbre (if pulse or blend waveform)
  border data: 1 char flags (color, double) + 1 char thickness (if has-border)
]
```

Each voice is variable-length depending on its flags. Total URL length for a
typical 5-voice composition: ~60–80 characters in the hash.

---

## Late March — Total Refactor

### Problem

Three files held 90% of the complexity:

| File | Lines | Concerns |
|------|-------|----------|
| `app.ts` | 1,253 | 14 distinct responsibilities, 17 mutable module-scope variables |
| `audio.ts` | 1,135 | Engine lifecycle, voice construction, pitch mapping, formant synthesis |
| `toolbar.ts` | 953 | 5 unrelated UI panels, color math, SVG icon construction |

### Result

Over 31 commits, decomposed into 36 focused modules totaling ~10,500 lines
across `js/`, with 321 tests across 16 test files. A subsequent cleanup pass
consolidated 6 over-separated files and eliminated ~280 lines, landing at 29
source files and ~5,250 lines with 298 tests.

### Architectural Changes

**Reactive state.** Replaced `SigilStore`'s manual listener/notify pattern
with `@preact/signals-core` (1.6KB). `effect()` subscriptions replaced all
`syncToSelectedShape()` call sites. The key win: any code that reads a signal
inside `effect()` automatically re-runs when it changes. No manual subscription
management, no forgotten update calls. The store exposes `.voices`, `.envelope`,
`.sceneIndex` as signals; UI and audio code subscribe via `effect()`.

**Audio decomposition.** The monolithic `audio.ts` split along natural seams:

| Module | Responsibility | Rate of change |
|--------|---------------|----------------|
| `engine.ts` | AudioContext lifecycle, master chain, play/stop | Rare |
| `voice-builder.ts` | Web Audio graph construction per voice | When voice types change |
| `mapping.ts` | Pure math: pitch, pan, timbre | Stable |
| `formants.ts` | Formant filter bank, vowel synthesis | When fill model changes |
| `vibe.ts` | Per-scene tuning constants | When scenes change |
| `ir-loader.ts` | Two-phase IR fetch/decode cache | Stable |

The split criterion was "rate of change": modules that change for different
reasons belong in different files. Engine lifecycle code (AudioContext resume,
destination routing, analyser) almost never changes. Voice construction changes
when we add waveform types or effect routing. Pitch mapping is pure math that
hasn't changed since the shrillness fix.

**Toolbar decomposition.** Split into per-panel modules: fill-panel,
pattern-panel, blend-panel, border-panel, harmonize-panel. Shared DOM
helpers extracted (`createIconButton()`, `svgEl()`). Each panel module owns
its DOM construction, event wiring, and state synchronization. The parent
`Toolbar` class delegates to panels and handles the context-sensitive
bottom bar swap (tools vs. properties).

**Canvas.** Stayed as one module (`canvas/render.ts`). The reconciler resists
splitting — create, update, gradient, and reconciliation loop all share element
references. An attempt to split into `create.ts`, `update.ts`, `gradients.ts`
produced modules that all needed the same `Map<string, SVGElement>` state,
defeating the purpose.

**Interaction.** Extracted from `app.ts` into `canvas/interaction.ts` as
`CanvasInteractionController`. This owns all pointer/touch event handling on
the canvas: drag, resize, rotate, ADSR corner adjustment. The interaction
state machine (`InteractionState` discriminated union in `interaction.ts`)
replaced 8 mutable boolean flags (`isDragging`, `isResizing`, `isRotating`,
`isPinchRotating`, etc.) with a single tagged state value.

**App.ts.** Shrank from 1,253 to 269 lines of legitimate orchestration: init,
wire up controllers, subscribe to state changes, manage render loop.

### Postmortem Findings

**1. The toolbar was the real monolith.** App.ts got attention because it was
the entry point. But toolbar.ts was doing five unrelated jobs: HSL↔RGB color
picking, SVG icon construction, border geometry, pattern selection, reverb
controls. App.ts was mostly wiring — once dependencies were extracted, it
shrank with nothing left to remove.

*Lesson:* Entry points look complex because they touch everything. The real
monoliths are the utility classes that *do* everything.

**2. `syncToSelectedShape()` was invisible coupling.** Called from six
locations across three files. Symptom of push-based state: "something changed,
so poke the toolbar." A single `effect()` in the toolbar constructor replaced
every call.

*Lesson:* If you find yourself adding "and also update X" to multiple
functions, you have a reactive state problem. The fix is subscription, not
fan-out.

**3. Some complexity is irreducible.** The attempt to enforce
`max-lines-per-function: 80` failed. `handlePointerDown` (155 lines,
complexity 29) is a state machine dispatch. `buildVoice` (195 lines)
constructs a Web Audio graph node by node. Splitting these into a dozen tiny
functions didn't reduce cognitive load — it scattered related logic across a
file to satisfy a counter.

*Lesson:* A 160-line state machine dispatch that you can read top-to-bottom
is better than eight 20-line functions you have to chase through.

**4. The audio module had natural seams. The canvas module didn't.** Audio
split cleanly into engine, voice-builder, mapping, formants — different rates
of change, different consumers. The canvas reconciler resisted. You can't
meaningfully separate "create the circle" from "update the circle" from "add
its gradient."

*Lesson:* The test for "should I split this?" is not "is it long?" but "do
different parts change at different times for different reasons?"

**5. The test gap was where you'd expect.** Pure functions had solid coverage.
Everything touching the DOM — canvas reconciler, toolbar panels, playback
controller — had zero tests. Writing DOM tests also uncovered a Bun +
happy-dom incompatibility (`SyntaxError` being `undefined` in happy-dom).

*Lesson:* "We'll add tests later" means "we'll never add tests." Build the
test scaffold first.

**6. The triple sec pattern was everywhere.** Icon button creation (5 lines,
15+ occurrences). SVG element construction (3 lines, 20+ occurrences).
Expansion panel open/close (8 lines, 5 occurrences). These became
`createIconButton()`, `svgEl()`, and the `ExpansionPanel` interface. The
duplication was invisible because it was spread across one 953-line file.

*Lesson:* Duplication hides in monoliths. You can't DRY what you can't see.
Apply the triple sec rule globally, not per-file.

**7. Selection state was a hidden dependency hub.** Selection isn't in the
store (correctly — it doesn't serialize and doesn't participate in undo). But
the old `onSelectionChange` callback was threaded through four constructors
and triggered six side effects. Making it signal-based revealed how many
consumers depended on it.

*Lesson:* State outside the store is still state. If it has more than two
consumers, it needs reactive infrastructure.

**8. Dependency injection of pure functions is wasted abstraction.**
`rotationToTimbre` and `snapYToNote` were passed through an interface, stored
as class fields, called as `this.rotationToTimbre(...)`. Four interface
declarations, four class fields, four constructor assignments — for stateless
math with no reason to substitute.

*Lesson:* Only inject things that need to vary. Pure functions are already
testable via direct import.

### How the Monoliths Formed

None of this was incompetence. The monoliths formed through reasonable local
decisions: a new feature needs toolbar UI → add a method to `Toolbar`. That
method needs color math → add a helper. The helper is only used here → no
reason to extract. Next feature copies the pattern. Now there are five copies,
all in one file, duplication invisible. The file hits 953 lines.

### Guardrails Installed

| Rule | Threshold | Purpose |
|------|-----------|---------|
| `max-lines` | 800 | Catches file bloat |
| `max-lines-per-function` | 160 | Flags functions doing too many things |
| `max-depth` | 8 | Prevents deep nesting |
| `complexity` | 30 | Catches tangled logic |
| `max-params` | 4 | Forces deps object pattern |

These are guardrails, not goals. A 160-line function doing one thing well is
fine. A 50-line function doing three things badly is not.

### Module Dependency Graph (Post-Refactor)

```
app.ts
  ├── state.ts (SigilStore, UndoManager)
  │     └── types.ts
  ├── state/selection.ts (SelectionManager, signals)
  ├── canvas/render.ts (SVG reconciler)
  │     ├── colors.ts
  │     ├── patterns.ts
  │     └── envelope.ts
  ├── canvas/interaction.ts (CanvasInteractionController)
  │     ├── interaction.ts (InteractionState types)
  │     └── shapes.ts (resize/rotate math)
  ├── audio/engine.ts (AudioEngine)
  │     ├── audio/voice-builder.ts
  │     │     ├── audio/mapping.ts
  │     │     ├── audio/formants.ts
  │     │     └── audio/vibe.ts
  │     └── audio/ir-loader.ts
  ├── toolbar/toolbar.ts
  │     ├── toolbar/fill-panel.ts
  │     ├── toolbar/pattern-panel.ts
  │     ├── toolbar/blend-panel.ts
  │     ├── toolbar/border-panel.ts
  │     ├── toolbar/harmonize-panel.ts
  │     └── toolbar/dom-helpers.ts
  ├── scenes/index.ts (SCENES registry)
  │     └── scenes/loader.ts
  ├── playback.ts (PlaybackController)
  ├── keyboard.ts
  ├── harmony.ts
  ├── serialize.ts
  └── splash.ts (SplashController)
```

Note: `types.ts` and `dom.ts` are imported broadly but omitted from most
branches for readability. `audio/vibe.ts` is imported both by `voice-builder.ts`
(reads current vibe for synthesis params) and by `app.ts` (calls `setVibe()`
when scene changes).

### What We'd Do Differently

1. **Verify committed state, not working tree.** Subagents created files and
   reported "tests pass" against the working tree but forgot to `git add` new
   files. Every commit step should include `git status` as a post-condition.

2. **Set lint thresholds from reality.** The plan specified 80 lines per
   function and 400 per file. Reality needed 160 and 800. Start from what the
   codebase looks like after the refactor, then tighten over time.

3. **Extract tests alongside modules.** All test writing was deferred to the
   end. The test environment setup (happy-dom, SVG mocking, the SyntaxError
   workaround) happened last, when it should have been scaffolded first.
