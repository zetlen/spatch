# Diphthong Gradients — Design

**Issue:** #234
**Date:** 2026-03-09

## Problem

Gradient fills currently produce a static formant blend — the gradient angle
interpolates between color1 and color2's vowel frequencies and that's the
sound you get. But gradients visually represent a transition between two
colors, which should map to a temporal transition between two vowel sounds
(a diphthong), not a static average.

## Design

### Audio behavior

When a voice has a `LinearFill`, the formant filter sweeps from color1's
vowel to color2's vowel over the **decay phase** of the ADSR envelope:

- **At note-on (attack start):** formant is set to color1's parameters
  (F1, F2 from hue1; Q from sat1; brightness cutoff from lightness1).
- **Over the decay phase:** formant ramps to color2's parameters.
- **At sustain:** formant holds at color2's parameters.

Solid fills are unchanged — static formant, no sweep.

### Gradient angle → sweep character

The gradient angle is always a multiple of 45° (8 discrete positions,
stored as `(Math.round(angle / 45) & 7) * 45`). Each maps to a sweep
duration fraction and easing exponent via a simple lookup table:

| Angle | Direction | Duration (× decay) | Easing |
|-------|-----------|---------------------|--------|
| 0°    | LR        | 1.0                 | linear |
| 45°   | TL→BR     | 0.8                 | ease-in |
| 90°   | TB        | 0.6                 | linear |
| 135°  | TR→BL     | 0.8                 | ease-out |
| 180°  | RL        | 0.4                 | linear |
| 225°  | BR→TL     | 0.8                 | ease-in |
| 270°  | BT        | 0.6                 | linear |
| 315°  | BL→TR     | 0.8                 | ease-out |

Easing is implemented as a power curve: `t^exponent` where t ∈ [0,1].
Linear = exponent 1, ease-in > 1, ease-out < 1. The lookup returns
`{ durationFrac, exponent }` and a `Float32Array` curve is pre-computed
from the exponent for `setValueCurveAtTime()`.

### Visual behavior

**No visual animation.** The SVG gradient stays static. The gradient already
visually represents both vowel endpoints. The temporal dimension is encoded
in the ADSR corner radii (decay duration). This satisfies the bijection
principle: every visual property maps to an audio parameter, and the
gradient's two colors map to the diphthong's two vowels.

### Implementation approach: schedule ramps at play time

Use Web Audio's native `setValueCurveAtTime()` to schedule formant sweeps
when voices are built. Zero per-frame cost.

**Files modified:**

1. **`js/audio/formants.ts`** — Extracted `computeFormantQ()`. New
   `sweepParamsForAngle()`, `buildSweepCurve()`, `isSweepReversed()`,
   `scheduleFormantSweep()`. Sweep table maps 8 angle positions to
   duration fraction and easing exponent.

2. **`js/audio/voice-builder.ts`** — Added `hasSweep`, `currentFillKey`
   to `AudioVoiceBase`. Exported `fillToKey()` for fill change detection.

3. **`js/audio/engine.ts`** — `play()` schedules sweeps after building
   voices. `_updateVoices` retrigs sweep on fill change (cancel + reschedule)
   and schedules sweeps for new mid-playback linear-fill voices.

4. **`js/harmony.ts`** — `randomize()` generates gradient fills with 35%
   probability per voice.

**Files NOT modified:** types.ts, serialize.ts, canvas/render.ts.

### Mid-playback edits

When a linear-fill voice's colors or angle change during playback, cancel
the existing formant automation and retrigger the sweep from scratch: set
formant to new color1, schedule a fresh sweep using the full decay duration
from the stored envelope. No voice rebuild — just `cancelScheduledValues`
+ reschedule. This covers latch mode where the user tweaks gradients while
sound is sustaining.

### Anchor bit reversal

The gradient angle's bit 2 (the anchor toggle) flips the sweep direction.
When `(Math.round(gradAngle / 45) & 4) !== 0` (angles 180°–315°), the
sweep runs from color2 → color1 instead of color1 → color2. This is
checked by `isSweepReversed()` in `formants.ts` and used by both
`scheduleFormantSweep()` and the three engine.ts call sites that set
initial formant values before a sweep.

### Randomization

`randomize()` in `harmony.ts` now has a 35% chance of generating a
gradient fill (LinearFill with two random colors and a random angle) for
each voice, enabling diphthong sweeps in random compositions.

### Edge cases

- **Very short decay (<50ms):** Sweep completes almost instantly — sounds
  like a quick chirp. Acceptable, matches the visual of tight ADSR corners.
- **Solid fill on rebuild:** No sweep scheduled, just static formant. No-op.
- **Loop/latch mode:** Each loop iteration re-triggers play(), rebuilding
  voices and rescheduling sweeps from the top. Natural behavior.
- **New voice added mid-playback:** Linear-fill voices added during active
  playback get their sweep scheduled immediately using the stored envelope's
  decay duration.
