# Volume Slope Curves: Per-Waveform Gain Response

Issue: #166 — Square and triangle get loud too fast

## Problem

The gain-vs-size curve is linear in area for all waveforms. A flat
`waveformGain` multiplier normalizes loudness at one size, but doesn't change
the curve shape. Square and triangle waves have richer harmonics that excite
more auditory critical bands, so they grow perceptually louder faster as area
increases.

## Design

### Mastering class

New file `js/audio/mastering.ts` with a `Mastering` class holding all
perceptual tuning constants as readonly properties. No Web Audio nodes — just
numbers. Gain-related functions move here from `mapping.ts` and `formants.ts`.

```
js/audio/mastering.ts
  class Mastering
    readonly GAIN_MIN = 0.05
    readonly GAIN_MAX = 0.8
    readonly WAVEFORM_GAIN: Record<WaveformType, number>
    readonly GAIN_EXPONENT: Record<WaveformType, number>
    readonly OCTAVE_GAIN_COEFF: Record<string, number>
    areaToGain(waveform, size): number
    waveformGain(waveform): number
    voiceGain(waveform, size): number      // areaToGain * waveformGain
    borderOctaveGain(waveform, size, thickness, color, double): number

  export const mastering = new Mastering()
```

A singleton default instance. Callers import it instead of free functions. No
dependency injection needed now, but trivial to swap later (e.g., per-scene
mastering patches from #164).

### Power curve

Current formula (linear in area):

    gain = min(0.8, 0.05 + fraction)

New formula with per-waveform exponent:

    normalized = fraction / maxAreaForWaveform
    gain = min(GAIN_MAX, GAIN_MIN + (GAIN_MAX - GAIN_MIN) * normalized^exponent)

Area fractions are normalized to [0, 1] by dividing by the maximum possible
area for that waveform at size=1. This is necessary because raw area differs
per shape (square=1.0, circle=pi/4, triangle~0.65).

Exponents (initial values, tune by ear):
- sine: 1.0 (linear, preserves current behavior)
- pulse (square): ~1.6 (slower ramp, tames rich harmonics)
- blend (sawtooth/tri): ~1.3 (moderate taming)

### Convergence at medium size

At size=0.5, `voiceGain(waveform, 0.5)` produces roughly equal values for all
three waveforms. The `waveformGain` multipliers are computed from the exponents
to enforce this: if sine at mid-fraction produces gain G, then
`waveformGain[pulse] = G * sine_mult / (pulse_gain_at_mid)`.

Below medium size: sine is louder than pulse/blend (harmonics-rich waveforms
are tamed). Above medium size: pulse/blend ramp up faster to meet at the cap.

### What moves where

**To `mastering.ts` (new):**
- `areaToGain`, `waveformGain`, `shapeAreaFraction` from `mapping.ts`
- `borderOctaveGain`, `OCTAVE_GAIN_COEFF` from `formants.ts`

**Stays put:**
- `yToFrequency`, `snapYToNote`, `xToPan`, `rotationToTimbre` in `mapping.ts`
- `hueToFormants`, `lightnessToCutoff`, `applyFormantFilter` in `formants.ts`

**Call sites updated:**
- `voice-builder.ts` — import from `mastering` for gain
- `engine.ts` — import from `mastering` for gain in `_updateVoices`

### Test strategy

**Unit tests (`tests/unit/mastering.test.js`):**
- Monotonicity: gain increases with size for all waveforms
- Bounds: gain in [GAIN_MIN, GAIN_MAX]
- Cap: max-size shapes hit GAIN_MAX
- Convergence: at size=0.5, voiceGain within +/-10% across waveforms
- Curve shape: pulse < sine at small sizes, pulse > sine at large sizes
- Border octave gain: existing property tests, new import location
- Zero thickness -> zero border gain

**Integration tests (`tests/integration/playback.test.js`):**

Uses the existing `__audioTap` helper which monkey-patches AudioContext to
inject an AnalyserNode. Currently only used for `isPlaying()`. New tests use
`getAmplitude()` to compare real Web Audio output levels:

- Same-size shapes at medium size: amplitude within tolerance band (convergence)
- Same-size shapes at large size: sine amplitude >= pulse amplitude (pulse curve
  is flatter at the top)
- Verifies the relative ordering holds — not exact dB values

This is real audio measurement in the browser via AnalyserNode, not recorded
audio. Playwright can't capture audio streams, but the injected tap gives us
the same data.

### Bijection note

The bijection principle is preserved: visual area still maps to gain for all
waveforms. The response curve differs per waveform as a perceptual "cheat" —
two shapes that look identical still sound identical. The mapping is
deterministic and injective; it's just not the same function for each waveform.
