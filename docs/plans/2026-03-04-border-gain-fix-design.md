# Border Octave Oscillator Gain Fix — Design

Issue: #151

## Problem

1. The octave-doubled oscillator's gain is set to `Math.sqrt(thickness)` at
   build time and never updated. It doesn't track shape size, so resizing a
   shape changes the primary voice volume but leaves the border oscillator at
   its original level.

2. The `borderKey` used for change detection in `updateVoices` includes
   thickness. Any thickness slider movement triggers a full voice
   teardown+rebuild, causing audible glitches during the drag.

## Fix

### 1. Perceptual gain function

Add `borderOctaveGain()` that computes gain from shape size, thickness, and
octave direction:

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

### 2. Store octave gain node

Add `octaveGainNode: GainNode | null` to `AudioVoiceBase`. Populated in
`_buildVoice`, used in `updateVoices` for smooth parameter updates.

### 3. Split border key

Change `borderKey` from `color:double:thickness` to `color:double`. Only
topology changes (color, double) trigger a full rebuild. Thickness becomes a
smooth parameter update.

### 4. Smooth octave gain updates

In the `updateVoices` parameter update block, after updating primary gain,
also update octave gain via `setValueAtTime` using `borderOctaveGain()`.
This covers both size changes and thickness changes without rebuilding.

## Scope

Only `js/audio.ts` changes. No type, canvas, serialization, or toolbar
changes needed.
