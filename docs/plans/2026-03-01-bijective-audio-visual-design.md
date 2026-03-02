# Bijective Audio-Visual Mapping

## The Principle

Every field in the canonical state must affect both canvas rendering and audio
synthesis. No visual-only state. No hidden audio parameters.

- Two states that look identical must sound identical.
- Two states that sound identical must look identical.
- Visual equivalences (rotation symmetry) are collapsed by making audio mappings
  periodic with the shape's geometric symmetry.

This is a strict invariant. Violations must be unrepresentable in the type
system, not merely discouraged by convention.

## Current Violations

### A. Visual-only state (looks different, sounds the same)

1. **Squiggle decorations** — drawn on canvas, zero audio mapping.
2. **Curlicue position (x, y)** — only curlicue count matters for audio (global
   detune at 15 cents per curlicue). Position and scale are visual-only.
3. **Curlicue scale** — visual-only.
4. **Decoration strokeColor/strokeWidth** — visual-only on squiggles and
   curlicues.
5. **Decoration targetShapeId** — stored but affects neither rendering nor audio.
   Dead field.
6. **Text fontSize and scale** — vocoder uses text content and x/y position but
   ignores visual size.
7. **Radial fill h2, l2** — audio only averages s/s2 for formant Q. Second
   color's hue and lightness are ignored. A radial fill from blue-to-red sounds
   identical to blue-to-green at the same saturation.
8. **Linear gradAngle audio symmetry** — the blend formula
   `abs(sin(gradAngle * PI / 360))` is symmetric, so gradAngle 90 and 270 sound
   identical while the gradient points in opposite visual directions.

### B. Same visual, different audio

9. **Square 90-degree rotational symmetry** — a square at 0, 90, 180, 270
   degrees looks identical. But `rotationToParam(rotation) = rotation / 360`
   maps linearly, producing four different PWM widths (0.0, 0.25, 0.5, 0.75)
   for visually identical orientations.
10. **Triangle 120-degree rotational symmetry** — a triangle at 0, 120, 240
    degrees looks identical. But rotation drives saw/tri blend linearly,
    producing three different timbres for visually identical orientations.

## Design: Single Parameter Space, Dual Rendering

Replace the current `Shape` type with a canonical voice parameter type. Both the
canvas renderer and the audio engine are pure functions of this type. No field
exists without both a visual and an audio interpretation.

### Elements Removed

- **Curlicue decorations** — position and scale were visual-only; only count
  contributed to audio. The global detune mechanic is removed.
- **Freehand/squiggle decorations** — entirely visual-only.
- **Decoration `targetShapeId`** — dead field, no effect on anything.
- **Text `strokeWidth`** — visual-only, removed. Text renders with a fixed
  stroke.
- **Separate `fontSize` and `scale` on text** — merged into one `size` field
  that maps to carrier volume.

### Voice Types

The discriminated union splits on waveform. Sine has no timbre parameter because
a circle has no distinguishable rotation and a pure sine has no adjustable
waveform parameter. Pulse and blend add a `timbre` field.

```
SineVoice { waveform: 'sine' }
  x: NormalizedCoord     visual: horizontal position    audio: stereo pan
  y: NormalizedCoord     visual: vertical position      audio: pitch (pentatonic)
  size: NormalizedCoord  visual: shape area              audio: gain
  fill: Fill             visual: color / gradient        audio: formant filter
  effect: Effect | null  visual: pattern overlay         audio: effect chain

PulseVoice { waveform: 'pulse' }
  ...all SineVoice fields, plus:
  timbre: NormalizedCoord
    visual: square rotation (half-sine, periodic at 90 degrees, 4 cycles/rev)
    audio: pulse width modulation depth

BlendVoice { waveform: 'blend' }
  ...all SineVoice fields, plus:
  timbre: NormalizedCoord
    visual: triangle rotation (half-sine, periodic at 120 degrees, 3 cycles/rev)
    audio: sawtooth / triangle waveform blend ratio
```

### Rotation Mapping

The timbre-to-rotation mapping uses a symmetric half-sine periodic with the
shape's vertex count:

```
param = sin(PI * (rotation % period) / period)
```

Where period = 360 / vertex_count (90 for square, 120 for triangle).

This curve:
- Repeats at each vertex, so visually identical orientations produce identical
  audio (e.g., square at 0 and 90 degrees both give param = 0).
- Is symmetric within each segment, so mirror-image orientations also produce
  identical audio (e.g., square at 10 and 80 degrees both give the same param).
- Covers the full parameter range 0 to 1 within each segment (peak at the
  midpoint: 45 degrees for square, 60 degrees for triangle).

Circles have no rotation and no timbre parameter.

### Text Decoration

Text decorations keep their vocoder synthesis but are stripped to fields with
both visual and audio roles:

```
TextDecoration
  text: string               visual: rendered glyphs     audio: vocoder formant content
  x: NormalizedCoord         visual: horizontal position audio: carrier pan
  y: NormalizedCoord         visual: vertical position   audio: carrier pitch
  size: NormalizedCoord      visual: text size            audio: carrier volume
  color: { h, s, l }        visual: text color           audio: carrier formant filter
```

The `color` field uses the same hue-to-formant mapping as shape fills: hue
drives vowel character (F1/F2), saturation drives resonance (Q), lightness
drives brightness shelf. This makes shapes and text consistent: color always
means formant.

### Fill / Formant Fixes

**Radial fill**: both colors are fully mapped to the formant filter. The current
code only averages saturation and ignores h2/l2. Fix: interpolate all three
components (hue, saturation, lightness) between the two colors to produce a
blended formant, so every component of the secondary color is audible.

**Linear fill gradAngle**: replace the symmetric blend formula
`abs(sin(gradAngle * PI / 360))` with a linear blend `gradAngle / 360`, so
every gradient angle produces a unique formant crossfade. No two visually
distinct gradient directions collapse to the same sound.

## Top-Level State After Changes

```
SigilData {
  envelope: Envelope          (ADSR, mapped to canvas corner radii — unchanged)
  voices: Voice[]             (replaces shapes[])
  texts: TextDecoration[]     (replaces decorations[])
}
```

Squiggles, curlicues, targetShapeId, and all orphan visual fields are gone.
Every remaining field participates in both rendering and synthesis.
