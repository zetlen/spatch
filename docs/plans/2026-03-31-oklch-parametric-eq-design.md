# Switch Fill from HSL+Formants to OKLCH+Parametric EQ

Issue: #313 | Date: 2026-03-31

> **Superseded.** The peak+lowpass audio mapping described here was not
> implemented. After iterative testing (high shelf, low shelf, shimmer+saturation),
> the final implementation uses independent 2D formant mapping: hue→F1 (vowel
> height), chroma→F2 (vowel frontness), lightness→brightness lowpass. The OKLCH
> color model and serialization sections remain accurate.

## Summary

Replace the fill color model (HSL → OKLCH) and audio mapping (dual-formant
bank → peak filter + lowpass). Each OKLCH channel maps to one independently
audible audio parameter. The vowel-like dual-peak character is intentionally
dropped here; #310 (per-voice tone parameter) will reintroduce it through
corner shape visuals once this lands.

## Motivation

Two problems with the current system:

1. **HSL is perceptually non-uniform.** Equal steps in HSL hue do not produce
   equal perceived color changes, violating bijection fidelity — two visually
   similar fills can sound different, and two audibly similar fills can look
   different.

2. **Vowel formants are too subtle.** Hue drives F1/F2 formant frequencies,
   but the sonic difference between red and green is barely perceptible to most
   users. Color is the most immediately noticeable visual property and deserves
   an immediately audible audio mapping.

## Color Model: HSL → OKLCH

Internal representation changes from `{ h, s, l }` to `{ h, c, l }`:

| Field | Range | Meaning |
|-------|-------|---------|
| `h`   | 0–360 | OKLCH hue (perceptually uniform wheel) |
| `c`   | 0–0.4 | Chroma (perceptually uniform colorfulness, replaces saturation) |
| `l`   | 0–1   | Lightness (perceptually linear, replaces 0–100 range) |

CSS output switches from `hsl()` to `oklch()`, supported natively in all
target browsers.

### Native color picker

`<input type="color">` accepts `oklch()` values directly via its `.value`
property. Set `colorspace="limited-srgb"` on each input for Safari gamut
clamping. On `input` events, read the value back and parse the color string to
extract h/c/l components (the returned format varies by browser — parse both
oklch and hex/rgb formats for robustness). This eliminates the dedicated
hex↔HSL conversion utilities.

### Gamut clamping

A JS-side `clampChromaToSRGB(h, c, l)` function reduces chroma until the
color fits within the sRGB gamut. Used by `createRandomFill()` and the harmony
randomizer. This function can be removed once `colorspace="limited-srgb"` is
universally supported across browsers.

### Random fill generation

`createRandomFill()` picks random h (0–360), c (0.08–0.25), l (0.4–0.7),
then runs through `clampChromaToSRGB()`.

### SVG gradients

`ensureLinearGradient()` switches stop-color values from `hsl()` to `oklch()`.

### Deleted code

`hslToString`, `hslToHex`, `hexToHsl`, `hslToRgb` — all removed.

## Audio Mapping: Formant Bank → Peak + Lowpass

Replace 3 biquads + mixer gain node with 2 biquads:

| OKLCH channel | Filter  | Parameter   | Range |
|---------------|---------|-------------|-------|
| Hue (h)       | Peak    | `frequency` | 100 Hz – 12 kHz, logarithmic |
| Chroma (c)    | Peak    | `gain`      | 0 dB (grey) → +10–12 dB (vivid) |
| Lightness (l) | Lowpass | `frequency` | 300 Hz – 12 kHz, exponential |

### How colors sound (for a musician)

**Hue is like an EQ sweep.** Red hues boost the low end — warm, bassy, thumpy.
Green and cyan boost the midrange — vocal, honky, present. Blue and violet
boost the highs — bright, airy, shimmery. Spinning through the hue wheel is
like sweeping an EQ knob from bass to treble and back.

**Chroma is like turning up the EQ.** Grey = flat, neutral, like a DI signal.
Vivid = strong spectral coloring, the sound "leans into" the hue's frequency
range. Rich saturated colors sound characterful — never harsh, just more
*themselves*.

**Lightness is like a tone knob.** Dark = muffled (highs cut). Light = open
and airy. Mid-lightness = natural, unfiltered.

**Gradients are filter sweeps.** The sound starts with one spectral character
and slides to another over the decay phase, like an auto-wah or envelope
filter.

### Hue-to-frequency mapping

Logarithmic: `freq = 100 * (12000 / 100) ^ (h / 360)`. Equal hue steps
produce equal perceived pitch steps. Hue 0° ≈ 100 Hz, hue 180° ≈ 1100 Hz,
hue 360° ≈ 12 kHz.

### Chroma-to-gain mapping

Linear: `gain = chroma * maxGain / maxChroma`, where maxGain ≈ 12 dB and
maxChroma ≈ 0.4. May need a sqrt or power curve to compress the top end —
linear is the starting point, tuned by ear.

### Peak Q

Fixed per waveform via the player delegate's `peakQ` field (renamed from
`formantMaxQ`). Moderate values (2–4 range):

- Sine: ~2 (broader boost — one partial, needs width to be audible)
- Pulse/Blend: ~3
- Astroid: ~3–4 (tighter — 6 saws already fill the spectrum)
- Stamp: ~3

This keeps vivid colors sounding rich and warm rather than ringy and harsh.
The most visually appealing colors are also the most sonically characterful.

### Lightness-to-cutoff mapping

Same exponential curve as today, rescaled from 0–100 to 0–1 input:
`cutoff = 300 * (12000 / 300) ^ l`. L=0 (black) ≈ 300 Hz, L=1 (white) ≈
12 kHz.

### Signal chain

Old: `gain → F1 → mixer ← F2 → brightness → [effect] → panner → master`

New: `gain → peak → lowpass → [effect] → panner → master`

### Gradient sweeps

`scheduleFormantSweep` becomes `scheduleFilterSweep`, interpolating 3 params
(peak freq, peak gain, lowpass cutoff) instead of 5 (F1 freq, F2 freq, F1 Q,
F2 Q, brightness cutoff). Sweep table (`SWEEP_TABLE`), `buildSweepCurve`,
and `isSweepReversed` are unchanged.

## Serialization

No version bump. Schema stays at v2. The CP1/CP2 bit layout is identical:

| Register | Bits | Old meaning | New meaning |
|----------|------|-------------|-------------|
| CP1      | H(9) + S(7) + L(8) = 24b = 4 chars | HSL color | OKLCH color |
| CP2      | angle(3) + H(9) + S(7) + L(8) = 27b = 5 chars | HSL gradient + angle | OKLCH gradient + angle |

Quantization:
- Hue: `round(h)` → 9 bits, 512 steps, ~0.7° resolution
- Chroma: `round(c * 320)` → 7 bits, 128 steps, ~0.003 resolution
- Lightness: `round(l * 255)` → 8 bits, 256 steps, ~0.004 resolution

All well below perceptual JND. Solid width stays 12, gradient width stays 17.
Old v2 URLs will load with color drift (HSL values reinterpreted as OKLCH) —
acceptable pre-v1.

## Type Changes

### FillBase / FillDraft

`s: number` → `c: number` (chroma, 0–0.4). `l` range changes from 0–100 to
0–1. `FillDraft`: `s` → `c`, `s2` → `c2`. Default values update accordingly.

### VoicePlayer

`formantMaxQ: number` → `peakQ: number`. Semantics change from "maximum Q
scaled by saturation" to "fixed Q for the peak filter."

### AudioSharedNodes / AudioVoice

Remove `formantF1`, `formantF2`, `formantMixer`. Add `peak: BiquadFilterNode`.
Rename `brightness` → `lowpass`.

No new types. No new fields on Voice.

## File-by-File Changes

| File | Change |
|------|--------|
| `types.ts` | `FillBase.s` → `.c`, `l` range 0–1, `FillDraft` same, update defaults in `fillToFillDraft` |
| `colors.ts` | Delete `hslToString`, `hslToHex`, `hexToHsl`, `hslToRgb`. Add `oklchToString(h, c, l)`. Update `createRandomFill()` to OKLCH ranges + `clampChromaToSRGB()`. Update `getSolidFillColor`, `getSwatchColor`, `ensureLinearGradient` to use oklch. |
| `formants.ts` → `filters.ts` | Gut and replace. New exports: `hueToFrequency(h)`, `chromaToGain(c, maxGain)`, `lightnessToCutoff(l)`, `applyFilterParams(peak, lowpass, fill, waveform)`, `scheduleFilterSweep(...)`. Delete `hueToFormants`, `computeFormantQ`, `applyFormantFilter`, `scheduleFormantSweep`, `FORMANT_ANCHORS`. Keep `SWEEP_TABLE`, `buildSweepCurve`, `sweepParamsForAngle`, `isSweepReversed`. |
| `voice-builder.ts` | Replace 3 biquads + mixer with peak + lowpass. Update signal chain wiring. Update `AudioSharedNodes` construction. `fillToKey` renames s→c. Delete `FORMANT_MIX` constant. |
| `voices/types.ts` | `AudioSharedNodes`: remove `formantF1`, `formantF2`, `formantMixer`, add `peak`. Rename `brightness` → `lowpass`. Same on `AudioVoice`. `VoicePlayer`: `formantMaxQ` → `peakQ`. |
| `engine.ts` | All ~15 formant scheduling call sites simplified to peak.frequency, peak.gain.value, lowpass.frequency. Import from `filters.ts`. |
| `fill-panel.ts` | Color inputs use oklch values directly. Add `colorspace="limited-srgb"`. Remove hex conversion imports. Update labels (e.g. "Vowel" → contextual label or removed). |
| `serializers/oscillator.ts` | `packColor`/`unpackColor` reinterpret s field as chroma (`round(c * 320)`, unpack `/ 320`), l field as 0–1 lightness (`round(l * 255)`, unpack `/ 255`). Same for gradient variant. No width changes. |
| `serializers/sample.ts` | No changes (delegates to oscillator). |
| `harmony.ts` | `createRandomLinearFill()` uses OKLCH ranges + `clampChromaToSRGB()`. |
| `canvas/render.ts` | Fill-to-CSS calls go through `oklchToString`. |
| `css/style.css` | Any hardcoded hsl fill values → oklch equivalents. |

## Testing

- Unit tests for `hueToFrequency` (log mapping boundary values: 0°→100 Hz,
  180°→~1100 Hz, 360°→12 kHz)
- Unit tests for `clampChromaToSRGB` (in-gamut passthrough, out-of-gamut
  reduction, commented as removable)
- Unit tests for `chromaToGain` (0 at c=0, maxGain at c=0.4)
- Unit tests for `lightnessToCutoff` (same as existing, rescaled input 0–1)
- Serialization round-trip tests updated with OKLCH values
- Existing e2e tests updated for any hardcoded fill values

## Future: Tone Parameter (#310)

The dual-peak vowel character removed here will return via #310's per-voice
tone parameter. Tone (rounded/sharp/pinched corners on polygon voices) will
conditionally add a second peak filter node at a hue-derived offset frequency.
`neutral` keeps the single-filter model from this design; `warm` and `bright`
add formant-like dual peaks with wide and narrow spacing respectively. This
design is intentionally single-filter to keep the default clean and leave room
for #310 to layer on top.
