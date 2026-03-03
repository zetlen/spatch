# Shrillness Fix Design

**Issue:** #116 — Everything's too shrill
**Date:** 2026-03-03
**Scope:** Audio engine tuning only. No new visual parameters, no serialization
changes, no UI changes.

## Problem

The audio output is harsh and trebly. Three root causes:

1. **Pitch range too high.** BASE_MIDI 48 (C3) spans 3 octaves to C6. Square
   and sawtooth harmonics at the top of this range are painful.
2. **Lightness→brightness mapping is ineffective.** A highshelf at 2 kHz with
   ±7 dB does almost nothing to tame harmonics at 4–16 kHz. The intent was
   lowpass/highpass control; the implementation is a gentle studio EQ tweak.
3. **Auto EQ is aggressive and counterproductive.** Peaking filters boosting
   sines by up to 18 dB create shrill resonances, especially when aligned with
   formant peaks. The auto EQ was compensating for sine's weak perceived
   loudness, but it causes more problems than it solves.

## Changes

### 1. Lower base pitch: C3 → G2

Change `BASE_MIDI` from 48 to 43. The pentatonic range becomes G2–G5 instead of
C3–C6 — a perfect fourth lower. Top notes stay musical without ice-pick treble.

### 2. Replace highshelf with lowpass cutoff from lightness

Replace the `brightness` BiquadFilterNode type from `highshelf` to `lowpass`.
Lightness controls cutoff frequency on an exponential curve:

- Lightness 0 (black) → ~300 Hz (dark, muffled)
- Lightness 50 (mid) → ~2500 Hz (warm, natural)
- Lightness 100 (white) → ~12000 Hz (bright, open)

Q fixed at ~0.707 (Butterworth, no resonance). The filter stays in the same
signal chain position (after formant mixer, before effects). No wiring changes.

### 3. Remove auto EQ entirely

Delete the `_autoEQ` array, `_applyAutoEQ` method, `spectralNeed` function,
and all EQ band creation/wiring in `play()`. The EQ pool was a bandaid for
sine audibility; the waveshaper (change 5) handles this properly.

This simplifies the master chain from:
```
masterGain → [EQ bands] → envelopeGain → compressor → analyser → dest
```
to:
```
masterGain → envelopeGain → compressor → analyser → dest
```

### 4. Reduce formant max Q: 12 → 8

In `applyFormantFilter`, reduce `maxQ` for rich waveforms from 12 to 8. Sine
stays at 4. High-Q bandpass peaks at F2 frequencies (>2 kHz) are a major source
of harshness. Q=8 still produces clear vowel character — professional formant
synths use Q of 5–10.

### 5. Sine presence: gain bump + subtle waveshaper

- Bump `waveformGain` for sine from 1.4 → 1.6.
- Insert a gentle waveshaper after the sine oscillator (before gain node) using
  `Math.tanh(x * 1.5)`. This adds faint 2nd/3rd harmonics (~-20 dB below
  fundamental), similar to analog oscillator impurity. The sine sounds
  "present" in a mix without needing EQ boost.

The waveshaper is not an independently controllable parameter — it's an inherent
property of the sine voice type, like PWM aliasing is inherent to the pulse
voice. No bijection violation.

## Files Changed

- `js/audio.ts` — all five changes live here

## What Doesn't Change

- Hue → formant frequency mapping (unchanged)
- Saturation → formant Q (range reduced, mapping unchanged)
- Serialization format (no new fields)
- Visual rendering (no changes)
- Signal chain topology (simplified by removing EQ, otherwise same)
