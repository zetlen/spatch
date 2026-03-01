# spatch — Runtime Architecture

## Core Idea

spatch is a visual instrument where geometric shapes are synthesized chords. Every
visual property of a shape maps bidirectionally to an audio parameter. The canvas
*is* the interface — there is no separation between the score and the instrument.

All state lives in the URL. No backend, no database, no accounts.

---

## Data Model

All application state lives in a single plain object managed by `SigilStore`
(`js/state.ts`). `UndoManager` wraps the store to provide undo/redo.
Selection state (`selectedId`, `selectedDecoId`) is app-level, not in the store.

```
{
  envelope: { attack, decay, sustain, release },
  shapes:     [ Shape, ... ],
  decorations: [ Decoration, ... ]
}
```

### Shapes

A shape is the fundamental unit. Each shape maps to one audio voice.

```
{
  id:       "s1a3f"                    // counter + random suffix
  type:     "circle" | "triangle" | "square"
  x:        NormalizedCoord            // 0–1, branded type
  y:        NormalizedCoord
  size:     NormalizedCoord            // bounding radius × 2, normalized
  rotation: Degrees                    // 0–360, branded type
  fill:     SolidFill | RadialFill | LinearFill   // discriminated union on `mode`
  pattern:  null | "stripes" | "checker" | "noise" | "gradient" | "rough"
}
```

Fill is a discriminated union:
- `SolidFill`: `{ mode: 'solid', h, s, l }`
- `RadialFill`: `{ mode: 'radial', h, s, l, h2, s2, l2 }`
- `LinearFill`: `{ mode: 'linear', h, s, l, h2, s2, l2, gradAngle }`

The toolbar uses a flat `FillDraft` bag internally so switching modes preserves
previous values. Conversion between `Fill` and `FillDraft` uses `fillToFillDraft()`
/ `fillDraftToFill()` in `types.ts`.

### Decorations

Decorations are a discriminated union (`Decoration` in `types.ts`) on the `type` field:

- **Squiggle**: freehand polyline stored as an array of `[NormalizedCoord, NormalizedCoord]` points
- **Curlicue**: a logarithmic spiral placed at a single `(x, y)` point, with `scale`
- **Text**: a string placed at `(x, y)`, rendered in Orbitron font, with `scale` and `fontSize`

### Envelope

```
{ attack: 0.01–2.0, decay: 0.01–2.0, sustain: 0.0–1.0, release: 0.01–3.0 }
```

The envelope is global — it applies to all voices at once. Values are in seconds
(attack, decay, release) or level fraction (sustain), used directly by Web Audio
scheduling.

### Coordinate System

All positions and sizes are normalized to `[0, 1]`. The canvas renders at 800×800
internal resolution but state is resolution-independent. This is what makes
serialization and the embed viewer work at any display size.

---

## The Visual ↔ Audio Mapping

This is the heart of spatch. Every visual property has a corresponding audio
parameter:

| Visual Property       | Audio Parameter       | Mapping                                                      |
|-----------------------|-----------------------|--------------------------------------------------------------|
| Shape type            | Oscillator waveform   | circle → sine, triangle → saw/tri blend, square → PWM       |
| Y position            | Pitch                 | Pentatonic scale, 3 octaves from C3. Top = high, bottom = low |
| X position            | Stereo pan            | Linear. Left edge = full left, right edge = full right       |
| Size                  | Volume                | Area-proportional. Larger shapes are louder                  |
| Rotation              | Timbre                | Square: PWM duty cycle. Triangle: saw↔tri crossfade. Circle: none |
| Fill hue (solid)      | Filter type           | 0–89° lowpass, 90–179° bandpass, 180–269° highpass, 270–360° notch |
| Fill saturation       | Filter Q/resonance    | Low saturation = gentle, high = resonant                     |
| Fill lightness        | Filter cutoff         | Exponential: ~200 Hz at 0, ~8 kHz at 100                    |
| Fill (radial/Lab)     | Filter (Lab-mapped)   | L → cutoff, a → Q, b → type                                 |
| Fill (linear)         | Filter + overdrive    | h1 → frequency, s1 → Q, l1 → drive amount                  |
| Pattern               | Audio effect          | stripes → chorus, checker → tremolo, noise → flanger, gradient → phaser, rough → bitcrusher |
| Layer order (z-index) | EQ shelving           | Back shapes get bass boost, front shapes get treble boost    |
| Canvas corner radii   | ADSR envelope         | Bottom-left = attack, top-left = decay, top-right = sustain, bottom-right = release |
| Curlicue count        | Global detune         | +15 cents per curlicue on the canvas                         |
| Text decorations      | Vocoder voice         | Formant synthesis at the text's Y-mapped pitch               |

### Waveform Details

**Circle → Sine**: Clean, no harmonics. Rotation has no effect (sine is symmetric).

**Triangle → Sawtooth/triangle blend**: Two oscillators mixed by rotation. At 0°:
pure sawtooth. At 180°: pure triangle. Intermediate angles crossfade between them
using a `sin/cos` equal-power curve.

**Square → Pulse-width modulation**: A sawtooth feeds a hard-clipping waveshaper.
A DC offset (from a `ConstantSourceNode`) shifts the clip point, controlling the
pulse width. Rotation sweeps the duty cycle from narrow pulse (0°) through 50%
square (180°) to inverted narrow pulse (360°).

Waveforms have gain normalization to compensate for differing perceived loudness:
square ×0.7, sawtooth ×0.85, sine ×1.4 (boosted since it's a single partial).

---

## Audio Engine

The audio signal chain, built per-voice:

```
Oscillator(s) → Gain → BiquadFilter → [Effect] → [Overdrive] → LayerEQ → Panner
                                                                              ↓
                                                          all voices merge here
                                                                              ↓
                                                    MasterGain (0.7) → EnvelopeGain → Compressor → destination
```

### Lazy Initialization

`AudioEngine._init()` is called on first play. This is required because browsers
suspend `AudioContext` until a user gesture. Init also registers the bitcrusher
`AudioWorkletProcessor`.

### ADSR Scheduling

On `play()`, the envelope gain is automated:
```
gain = 0 at t=0
gain = 1.0 at t=attack                (linear ramp)
gain = sustain at t=attack+decay       (linear ramp, holds here)
```

On `release()`:
```
gain = current value at t=now          (cancel prior automation)
gain = 0 at t=now+release              (linear ramp)
```

Cleanup (disconnecting nodes, stopping oscillators) is scheduled via `setTimeout`
after the release completes, guarded by a session ID to prevent stale cleanup.

### Live Voice Updates

During playback, `state.onChange` calls `audio.updateVoices()`, which:
1. Removes voices for deleted shapes (stops oscillators, disposes effects)
2. Adds voices for new shapes
3. Updates existing voices' frequency, gain, pan, and filter via `setValueAtTime`

This enables real-time editing while audio is playing.

### Effects

All effects return `{ input, output, dispose }` for uniform signal chain wiring:

- **Chorus** (stripes): 25ms delay, LFO at 1.5 Hz, 2ms depth
- **Tremolo** (checker): amplitude LFO at 6 Hz, depth 0.5
- **Flanger** (noise): 5ms delay, LFO at 0.25 Hz, 60% feedback
- **Phaser** (gradient): 4 cascaded allpass filters, LFO at 0.5 Hz
- **Bitcrusher** (rough): AudioWorklet, 6-bit depth, 0.3 frequency reduction

### Vocoder

Text decorations are played through a formant synthesizer (`js/vocoder.js`). A bank
of 16 bandpass filters (100 Hz–8 kHz, logarithmic) shapes a sawtooth carrier. For
each character, formant frequencies are looked up and the filter bank gains are
scheduled over 150ms per character using Gaussian proximity weighting.

### Play Modes

All three modes are accessed via the play button's drag-up fan gesture:

- **Normal**: quick press-and-release. Audio plays during press, stops on release.
- **Latch**: drag up to the lock zone, release. Audio sustains until the button is
  pressed again.
- **Loop**: drag further up to the loop zone. Distance controls loop hold time
  (100ms–2000ms). Audio repeats: play → hold → release → restart.

### Arpeggio

Shift+drag across the canvas in select mode. As the cursor crosses each shape's
X position (within 20px), that shape triggers a short independent voice with a
mini-envelope (20ms attack, fade over 500ms).

---

## Rendering Pipeline

The canvas renders at 800×800, CSS-scaled to fit the viewport. `render()` is called
every frame when `needsRender` is true or audio is playing (for glow animation).

### Draw order (back to front)

1. **Background** — solid `#1a1a2e`
2. **Chromatic guide lines** — 37 horizontal dashed lines spanning 3 octaves (36
   semitones). Octave boundaries are brighter. These help the user see where pitch
   zones are.
3. **Shapes** — in array order (index 0 = back). For each:
   - Translate/rotate context to shape center
   - Build path (arc, rect, or equilateral triangle polygon)
   - Clip to shape, fill with `getFillStyle()`, overlay pattern, restore clip
   - Draw neon glow outline (multi-layer strokes). Playing shapes get cyan glow
     with shadow blur; idle shapes get a softer white glow.
4. **Decorations** — squiggles (quadratic Bézier smoothing), curlicues (logarithmic
   spiral), text (Orbitron font), all with shadow glow.
5. **Selection handles** — dashed cyan bounding box, 8 resize handles, rotation
   handle (purple circle above top edge, skipped for circles).
6. **Live squiggle preview** — drawn directly by `app.ts` during active drawing,
   using raw `lineTo` segments (not the smooth Bézier version).

---

## Interaction Model

### Coordinate Transform

All mouse/touch events are transformed from viewport pixels to both 800×800 canvas
pixels (`px`, `py`) and normalized 0–1 coordinates (`nx`, `ny`). Pixel coords are
used for hit testing; normalized coords are stored in state.

### Interaction State Machine

Interaction state is a discriminated union (`InteractionState` in `js/interaction.ts`).
Each mode carries its own data — no separate variables for drag origin, active handle, etc.

```
idle → dragging | resizing | rotating | adsr | drawing | arpeggio
       | deco-dragging | deco-resizing | pinch-rotate → idle
```

**Mousedown priority** (first match wins):
1. Shift+drag in select mode with shapes → arpeggio
2. Decoration tool active → delegate to DecorationTool
3. Shape tool active → create shape, switch to select
4. ADSR corner hit (canvas corner, 64px radius) → envelope drag
5. Handle hit on selected shape → resize or rotate
6. Shape body hit → select + drag
7. Handle hit on selected decoration → deco-resize
8. Decoration body hit → select + deco-drag
9. Empty space → deselect

**Undo is captured at mousedown**: `undo.snapshot()` is called before any manipulation
begins. `updateShape()` / `updateDecoration()` is called without undo on every
mousemove for smooth feedback. On mouseup, the interaction resets to idle — the
snapshot was already captured.

### Touch Support

Single-touch events are translated to synthetic mouse events. Two-finger pinch
gestures resize and rotate the selected shape simultaneously (`pinch-rotate` mode).

---

## Envelope as Canvas Shape

The ADSR envelope is encoded as the CSS `border-radius` of the canvas element.
Rounded corners = longer times or higher sustain level. The mapping:

```
corner radius = (value / max_value) × (canvasSize × 0.15)
```

Users drag from the canvas corners to adjust. The drag distance from the corner
maps back to the envelope value through the inverse formula.

---

## State Lifecycle

### Mutation

All state changes go through `SigilStore` methods (`addShape`, `updateShape`,
`updateFill`, `updateEnvelope`, etc.). Each mutation calls `_notify()`, which
fires all registered `onChange` callbacks.

### Observer Chain

`store.onChange` drives three systems:
1. **Render scheduling** — sets `needsRender = true` for the next animation frame
2. **Audio voice updates** — calls `audio.updateVoices()` if currently playing
3. **URL auto-save** — debounced (1 second) `saveToURL()` updates the hash

### Undo/Redo

`UndoManager` wraps a `SigilStore`. `snapshot()` captures the current state via
`JSON.stringify` / `JSON.parse` deep clone. `undo()` and `redo()` swap the store's
data. Max 50 undo entries. Redo stack is cleared on any new snapshot. Callers
decide when to snapshot — typically at mousedown before a manipulation begins.

### Serialization

```
store.data → compactify (single-char keys, v:1) → JSON.stringify → LZ-string compress → URL hash
```

The compact format includes a version field (`v: 1`). Deserialization handles both
the current versioned format and the legacy unversioned format. Shape IDs are
regenerated on load. The URL is updated via `history.replaceState` (no navigation,
no browser history entry).

### Embed Viewer

`embed.html` imports the same modules but runs read-only: deserialize from URL hash,
render once, play on button press. No editing, no render loop, no selection, no
undo/redo.

---

## Key Design Decisions

**Normalized coordinates everywhere.** State is resolution-independent. The same
serialized URL works at any canvas size.

**Observer-driven architecture.** A single `_notify()` call cascades to rendering,
audio, and persistence. No explicit orchestration needed.

**Snapshot-at-start undo for continuous operations.** `undo.snapshot()` is called
at mousedown before manipulation begins. Mousemove updates state freely; mouseup
just resets the interaction mode.

**Stateless effect interface.** `{ input, output, dispose }` lets the audio engine
compose arbitrary signal chains without coupling to effect internals.

**Discriminated unions throughout.** Fill, Decoration, Voice, and InteractionState
are all typed discriminated unions. TypeScript narrows access to variant-specific
fields. The toolbar uses a flat `FillDraft` internally so switching fill modes
preserves previous values.

**Canvas corners as envelope.** The ADSR is literally the shape of the canvas. This
reinforces the principle that everything visible is everything audible.
