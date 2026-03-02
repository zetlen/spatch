# Sigil Precursor Format

A sigil is described by a single `SigilData` object. Every field in this object
drives both a visual property on the canvas and an audio property in the
synthesizer. There are no visual-only fields and no hidden audio parameters.

## Top-Level Structure

```
SigilData
├── envelope: Envelope
├── voices: Voice[]
└── texts: TextDecoration[]
```

### Envelope

Global amplitude envelope applied to the entire mix. Visually encoded as the
canvas corner radii.

| Field     | Type    | Range       | Visual                  | Audio                       |
|-----------|---------|-------------|-------------------------|-----------------------------|
| `attack`  | number  | 0.01–2.0 s  | bottom-left radius      | attack ramp time            |
| `decay`   | number  | 0.01–2.0 s  | top-left radius         | decay ramp time             |
| `sustain` | number  | 0–1         | top-right radius        | sustain gain level          |
| `release` | number  | 0.01–3.0 s  | bottom-right radius     | release ramp time           |

## Voice

Each voice is one geometric shape and one oscillator. The `waveform`
discriminant determines both the visual shape and the oscillator topology.

| Waveform | Shape    | Oscillator                                      |
|----------|----------|-------------------------------------------------|
| `sine`   | circle   | single sine oscillator                          |
| `pulse`  | square   | sawtooth → PWM waveshaper (pulse-width via DC)  |
| `blend`  | triangle | sawtooth + triangle crossfade                   |

### Common Fields (VoiceBase)

| Field    | Type                | Visual                           | Audio                                                          |
|----------|---------------------|----------------------------------|----------------------------------------------------------------|
| `id`     | string              | —                                | —                                                              |
| `x`      | NormalizedCoord 0–1 | horizontal position              | stereo pan (−1 to +1)                                          |
| `y`      | NormalizedCoord 0–1 | vertical position                | pitch (pentatonic scale C3–C6, snap-to-note with micro-detune) |
| `size`   | NormalizedCoord 0–1 | bounding diameter                | gain (area-weighted, shape-dependent)                          |
| `fill`   | Fill                | color / gradient                 | formant filter bank + brightness shelf (see Fill below)        |
| `effect` | PatternType \| null | visual pattern overlay           | audio effect chain (see Effect below)                          |

### Timbre (pulse and blend only)

Sine voices have radial symmetry — rotation has no visible effect, so they
carry no `timbre` field. Pulse and blend voices break symmetry, so they
expose a `timbre` field.

| Field    | Type                | Visual                     | Audio                                         |
|----------|---------------------|----------------------------|-----------------------------------------------|
| `timbre` | NormalizedCoord 0–1 | rotation angle within period | pulse: duty cycle (PWM). blend: saw↔tri mix. |

The rotation ↔ timbre mapping is a linear sawtooth within each waveform's
visual symmetry period:

- **pulse (square):** period = 90°. `rotation = timbre × 90`.
- **blend (triangle):** period = 120°. `rotation = timbre × 120`.

Every angle within the period maps to a unique timbre value.

### Fill

Discriminated union on `mode`. All modes provide a primary HSL color; gradient
modes add a secondary color.

| Mode       | Extra fields              | Visual                     | Audio                                             |
|------------|---------------------------|----------------------------|----------------------------------------------------|
| `solid`    | —                         | flat color                 | hue → F1/F2 formants, saturation → Q, lightness → brightness shelf |
| `radial`   | `h2, s2, l2`              | radial gradient            | averaged formants of both colors                   |
| `linear`   | `h2, s2, l2, gradAngle`   | angled linear gradient     | gradAngle blends between primary/secondary formants |

Formant mapping anchors (hue → vowel space):

| Hue  | Vowel | F1 (Hz) | F2 (Hz) |
|------|-------|---------|---------|
| 0°   | /a/   | 730     | 1090    |
| 60°  | /e/   | 530     | 1840    |
| 120° | /i/   | 270     | 2290    |
| 180° | /u/   | 300     | 870     |
| 240° | /o/   | 570     | 840     |
| 300° | /a:/  | 680     | 1100    |

Saturation sets bandpass Q (1–13). Lightness sets a highshelf gain (−7 to +7 dB).

### Effect (PatternType)

| Pattern      | Visual overlay        | Audio effect               |
|--------------|-----------------------|----------------------------|
| `stripes`    | horizontal stripes    | chorus (LFO-modulated delay) |
| `checker`    | checkerboard          | tremolo (LFO-modulated gain) |
| `noise`      | noise dots            | flanger (short LFO delay)    |
| `gradient`   | color gradient wash   | phaser (allpass chain)       |
| `rough`      | rough/gritty texture  | bitcrusher (worklet or waveshaper fallback) |
| `null`       | no overlay            | dry signal                   |

### Per-Voice Gain Normalization

Each waveform has a fixed loudness-compensation factor applied to its gain:

| Waveform | Factor | Rationale                                |
|----------|--------|------------------------------------------|
| `sine`   | 1.4    | single partial, needs boost to match     |
| `blend`  | 0.85   | sawtooth RMS ~1.15× sine                 |
| `pulse`  | 0.7    | square RMS ~1.41× sine, rich harmonics   |

Gain formula: `min(0.8, 0.05 + shapeArea) × waveformGain`.

Shape area is geometric (π r² for circle, s² for square, (3√3/4) r² for
triangle), so differently-shaped voices at the same `size` produce different
loudness — matching visual area to perceived volume.

### Layer EQ

Voices are stacked front-to-back. Each voice gets a shelving EQ based on its
layer index: back voices get a low-shelf boost, front voices a high-shelf
boost. This gives spectral separation to overlapping voices at similar pitches.

### Auto EQ

A pool of peaking filters (one per voice, up to 8) boosts each voice at its
fundamental frequency. Boost amount scales with shape area and spectral need
(sine gets 4–18 dB, pulse gets 1–5 dB).

## TextDecoration

Text placed on the canvas. Rendered visually as styled text; synthesized as a
vocoder (bandpass filter bank excited by a sawtooth carrier).

| Field   | Type                | Visual              | Audio                          |
|---------|---------------------|----------------------|-------------------------------|
| `id`    | string              | —                    | —                             |
| `text`  | string              | displayed text       | phoneme sequence for vocoder  |
| `x`     | NormalizedCoord 0–1 | horizontal position  | stereo pan                    |
| `y`     | NormalizedCoord 0–1 | vertical position    | carrier frequency (same scale as voices) |
| `size`  | NormalizedCoord 0–1 | font size            | vocoder output gain           |

All text renders as black. There is no color field — every field on
TextDecoration is bijective.

## Serialization

The precursor format is serialized for URL sharing as:

```
SigilData → positional JSON arrays → LZ-string → URI-encoded hash fragment
```

No version field, no keys, no IDs. IDs are regenerated on deserialization.

Wire format (positional arrays):

```
[envelope, voices, texts]

envelope = [attack, decay, sustain, release]

voice (sine)        = ["s", x, y, size, fill, effect]
voice (pulse/blend) = ["p"|"b", x, y, size, fill, effect, timbre]

fill (solid)   = ["s", h, s, l]
fill (radial)  = ["r", h, s, l, h2, s2, l2]
fill (linear)  = ["l", gradAngle, h, s, l, h2, s2, l2]

effect = "s"|"c"|"n"|"g"|"r" | 0

text = [text, x, y, size]
```
