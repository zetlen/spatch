# Sigil Synth — Design Plan

## Concept

**Sigil Synth** is a single-page web instrument that lets you compose a visual "sigil"
(a symbolic glyph built from geometric shapes) and then hear it as a synthesized chord.
Every visual property maps to an audio parameter — position, size, color, shape type,
rotation, pattern overlay, and even the canvas corner radii all affect the sound.

The result is a drawable, shareable, embeddable audiovisual instrument with an 80s
synthwave aesthetic.

## Architecture

Zero dependencies beyond one vendored library (lz-string for URL compression).
No build step. Pure vanilla HTML/CSS/JS with ES modules.

```
index.html              Main app shell
embed.html              Standalone embed viewer
css/style.css           Synthwave-themed styles
js/
  app.js                Entry point, event wiring, render loop
  state.js              Data model, undo/redo, CRUD
  canvas.js             Canvas 2D rendering pipeline
  shapes.js             Hit testing, selection handles, resize/rotate math
  colors.js             Color conversions (HSL, Lab, RGB) and picker rendering
  patterns.js           Visual pattern tile generators and procedural overlays
  effects.js            Audio effects mapped to visual patterns
  audio.js              Web Audio engine (oscillators, filters, spatial)
  envelope.js           ADSR ↔ canvas corner radius mapping
  toolbar.js            Toolbar UI, tool/pattern/color picker binding
  decorations.js        Squiggle drawing, curlicue placement, text decoration
  vocoder.js            Formant-based vocoder for text decorations
  embed.js              Embed snippet generator and modal
  serialize.js          URL persistence with LZ-string compression
  layers.js             Layer EQ shelving helper
  worklets/
    bitcrusher.js       AudioWorkletProcessor for bit-depth reduction
lib/
  lz-string.min.js      Vendored LZ-String compression library
```

## Visual → Audio Mapping

| Visual Property        | Audio Parameter              |
|------------------------|------------------------------|
| Shape type             | Oscillator waveform          |
| Y position             | Pitch (pentatonic scale)     |
| X position             | Stereo pan                   |
| Size                   | Gain (volume)                |
| Rotation               | Detune (0–50 cents)          |
| Fill hue               | Filter type (LP/BP/HP/notch) |
| Fill saturation        | Filter Q (resonance)         |
| Fill lightness         | Filter cutoff frequency      |
| Fill mode (solid)      | Direct HSL → filter          |
| Fill mode (radial/Lab) | Lab L*/a*/b* → filter params |
| Fill mode (linear)     | Overdrive/waveshaper amount  |
| Pattern overlay        | Audio effect (see below)     |
| Layer order            | EQ shelving (low ↔ high)     |
| Canvas corners (ADSR)  | Envelope shape               |

### Pattern → Effect Mapping

| Pattern   | Effect     | Description                          |
|-----------|------------|--------------------------------------|
| Stripes   | Chorus     | Modulated delay + dry/wet mix        |
| Checker   | Tremolo    | LFO amplitude modulation             |
| Noise     | Flanger    | Short delay with feedback + LFO      |
| Gradient  | Phaser     | Allpass filter chain with LFO        |
| Rough     | Bitcrusher | AudioWorklet (fallback: WaveShaper)  |

### ADSR Corner Mapping

The canvas itself has rounded corners that encode the ADSR envelope:

- **Bottom-left** corner radius → Attack time (0.01–2.0s)
- **Top-left** corner radius → Decay time (0.01–2.0s)
- **Top-right** corner radius → Sustain level (0.0–1.0)
- **Bottom-right** corner radius → Release time (0.01–3.0s)

Corners are draggable; the canvas border-radius updates live.

## Interaction Model

### Tools

- **Select (V)**: Click shapes to select, drag to move, handles to resize/rotate
- **Triangle / Square / Circle**: Click canvas to place a new shape
- **Squiggle**: Freehand drawing (decorative, neon-glow stroke)
- **Curlicue**: Click to place a logarithmic spiral
- **Text (T)**: Type in input field, click canvas to place

### Playing

- **PLAY button**: Press-and-hold to sound. Mousedown triggers attack+decay→sustain;
  mouseup triggers release. The button itself is the gate.
- **Arpeggio mode**: Shift+drag across canvas triggers individual shapes as the
  pointer crosses their X position, each with a mini-envelope.

### Color System

Three fill modes, each with a dedicated picker tab:

1. **Solid**: HSL via hue ring + saturation/lightness square
2. **Radial gradient**: CIE Lab color space (a*/b* plane + L* slider), two stops
3. **Linear gradient**: Two HSL stops + angle dial

### Sharing

- **Share**: Serializes full state → LZ-string → URL hash. Copy link to clipboard.
- **Embed**: Generates an `<iframe>` snippet pointing to `embed.html#<compressed-state>`.
  The embed page renders the sigil read-only with its own play button.

## State Management

- `SigilState` class holds shapes, decorations, and envelope
- Full JSON snapshot undo/redo (50-level stack)
- Manipulations (drag/resize/rotate) snapshot before the gesture, push on mouseup
- Change listeners trigger render + debounced auto-save to URL

## Rendering Pipeline

1. Clear canvas, fill background
2. Draw subtle 16×16 guide grid
3. Draw ADSR corner arcs with glow + draggable handle dots
4. For each shape (back to front):
   - Translate + rotate to shape center
   - Clip to shape path
   - Fill with solid color or gradient
   - Apply pattern overlay (tile-based or procedural)
   - Draw multi-layer neon outline glow (enhanced when playing)
5. Draw decorations (smoothed squiggles, curlicues, text with glow)
6. Draw selection handles on selected shape (dashed box, corner/midpoint squares, rotation handle)

## Audio Pipeline

Per voice (one per shape):
```
Oscillator → Gain → BiquadFilter → [Effect] → [Overdrive] → LayerEQ → StereoPanner → MasterGain
```

Master chain:
```
MasterGain → EnvelopeGain (ADSR) → DynamicsCompressor → Destination
```

## Design Decisions

- **No build step**: Keeps it maximally portable and hackable. ES modules provide
  structure without bundling.
- **Pentatonic scale**: Constrains pitch to always sound consonant regardless of
  shape placement.
- **Lab color space for radial fills**: Gives perceptually uniform color gradients
  and maps naturally to filter parameters.
- **Press-and-hold play**: Makes the ADSR envelope physically intuitive — you control
  the gate with your finger/mouse.
- **Canvas corner radius = ADSR**: A visual metaphor that makes the envelope shape
  literally visible as the canvas shape.
- **LZ-string URL serialization**: Enables sharing without a backend. Compact
  single-char keys minimize URL length.
