# FM Architecture Rework — Design

**Issue:** [#349 — fm blend is unpleasantly harsh and hard to use](https://got.colonpipe.org/zetlen/spatch/issues/349)
**Supersedes:** `2026-04-16-fm-taming-design.md` (depth reduction + lowpass only)
**Date:** 2026-04-18
**Status:** Draft

## Problem

The FM synthesis blend modes produce an unpleasantly harsh sound, and the four
modes (`screen`, `multiply`, `exclusion`, `difference`) only differ in
intensity — they're a gradient of weirdness rather than distinct characters.

Root causes:

1. **Modulation is unidirectional.** Voice j modulates voice i but not the
   reverse. The relationship is asymmetric — which voice is "on top" matters
   more than the musical interval between them.
2. **The raw oscillator is the modulator.** Pulse, blend, and astroid voices
   carry rich harmonic spectra. Each harmonic acts as an independent modulator,
   producing overlapping sideband stacks that don't resolve into recognizable
   harmonic structure.
3. **All modes are the same synthesis technique.** They differ only in
   modulation depth, curve, and feedback — not in kind.

## Goal

Rework the FM blend system so:

- All modulation is **symmetrical** — both voices in a pair modulate each
  other equally.
- Each non-screen mode is a **qualitatively different synthesis technique**,
  not just a different amount of the same effect.
- The dominant harshness source (raw-oscillator modulation) is eliminated
  for most modes via a **sine shadow oscillator**.

## Mode Character Map

| Mode | Visual meaning | Synthesis technique | Audio character |
|------|---------------|-------------------|-----------------|
| `screen` | Additive lightening | No modulation | Clean mixed voices (unchanged) |
| `multiply` | Darkening blend | **Sine cross-FM** — each voice's sine shadow modulates the other's pitch | Warm, resonant, "synth pad" |
| `exclusion` | Inversion/negation | **Ring modulation** — each voice's output multiplied by the other's sine shadow | Metallic, bell-like, hollow |
| `difference` | Absolute difference | **Raw cross-FM** — unfiltered oscillators modulate each other directly (with lowpass) | Chaotic, textural, unpredictable |

All three non-screen modes are **bidirectional** — two connections per
overlapping pair, symmetric in depth/mix.

## Architecture

### Sine shadow oscillator

Each voice gains a shadow — an `OscillatorNode(type: 'sine')` that tracks the
voice's pitch but is never connected to the audio output. It exists solely as
a clean modulation source.

**Lifecycle:**

- Created in `buildVoice()` (`voice-builder.ts`) alongside shared nodes.
- Started and stopped with the voice (wrapped around the player's
  `start()`/`stop()` methods).
- Frequency updated in a wrapper around `updateParams()`:
  `shadow.frequency.setValueAtTime(yToFrequency(voice.y), now)`.
- Exposed via a new `getShadowNode(): OscillatorNode` method on `AudioVoice`.

**Implementation strategy:** the shadow is created in `buildVoice()` and the
player-returned `AudioVoice` is wrapped. Individual player files
(`sine/player.ts`, `pulse/player.ts`, etc.) do not change.

```typescript
// In buildVoice(), after the player builds its graph:
const shadow = new OscillatorNode(ctx, { type: 'sine', frequency: freq });
const audioVoice = get(voice.waveform).player.buildAudioGraph(ctx, voice, shared);

const origStart = audioVoice.start;
audioVoice.start = (time: number) => { origStart(time); shadow.start(time); };

const origStop = audioVoice.stop;
audioVoice.stop = (time: number) => { origStop(time); safeStop(shadow); };

const origUpdate = audioVoice.updateParams;
audioVoice.updateParams = (v: Voice, now: number) => {
  origUpdate(v, now);
  shadow.frequency.setValueAtTime(yToFrequency(v.y), now);
};

audioVoice.getShadowNode = () => shadow;
```

**Cost:** one extra `OscillatorNode` per voice. At max ~8 voices, negligible.
Runs even when blend is `screen` (simpler lifecycle, zero CPU when
disconnected).

**Bijection:** the shadow tracks the voice's y-position via `yToFrequency()`,
same as the main oscillator. Moving a voice changes the shadow's frequency,
which changes the FM/ring-mod character. The bijection holds.

### Multiply — Sine cross-FM

Both voices' sine shadows modulate each other's carrier frequency params.
Two connections per overlapping pair.

```
A.shadow → depthGainAB → B.getCarrierFrequencyParams()
B.shadow → depthGainBA → A.getCarrierFrequencyParams()
```

Depth controlled by overlap × maxIndex, same `computeFMDepth()` function.

Starting parameters:
- `maxIndex: 0.5` (conservative — cross-mod doubles the effect vs.
  unidirectional)
- `depthCurve: 'sqrt'` (gentler onset)
- `MAX_FM_DEVIATION: 600` (unchanged safety cap)

### Exclusion — Ring modulation

Signal multiplication, not frequency modulation. Different insertion point —
processes the voice's **output signal**, not its frequency parameter.

For each voice in an overlapping pair, the engine re-routes the voice's
output through ring mod nodes:

```
A.outputNode ─── disconnect from masterGain
A.outputNode → dryGain(1-d) ──────────────────→ masterGain
A.outputNode → wetGain(0) ── [B.shadow→gain] ─→ masterGain

(symmetric for B, using A.shadow)
```

Where `d` = overlap (0–1).

- `dryGain.gain = 1 - overlap` — voice plays clean at zero overlap.
- `wetGain` base gain = 0 with the partner's sine shadow connected to its
  gain AudioParam. The shadow swings −1 to +1, producing true ring mod
  (carrier suppressed, only sum/difference frequencies).
- Shadow amplitude scaled by overlap: a gain node between the shadow and
  `wetGain.gain` with `gain = overlap`. At overlap=0, no ring mod. At
  overlap=1, full ring mod.

When overlap drops to zero, tear down the ring mod nodes and reconnect
`outputNode → masterGain` directly.

The crossfade (dry × (1−overlap) + wet × overlap) ensures a smooth
transition — no pops when overlap crosses zero.

### Difference — Raw cross-FM

Same topology as multiply but uses `getModulatorNode()` (raw oscillator
with all harmonics) instead of `getShadowNode()`:

```
A.rawOscillator → lowpass → depthGainAB → B.getCarrierFrequencyParams()
B.rawOscillator → lowpass → depthGainBA → A.getCarrierFrequencyParams()
```

The modulator lowpass (`FM_MODULATOR_LPF_HZ = 1800`, `Q = Math.SQRT1_2`)
stays on this mode only — tames the harmonics enough to be usable while
preserving the chaotic character.

Starting parameters:
- `maxIndex: 0.8` (higher than multiply — this is the "wild" option)
- `depthCurve: 'linear'` (aggressive, matching the mode's intent)
- No self-feedback. Cross-modulation is already bidirectional, which
  creates its own feedback dynamics (A→B→A→...). Adding explicit
  self-feedback on top risks instability for little audible benefit.

## Engine changes

### CrossConnection discriminated union

The `FMConnection` interface is replaced by a discriminated union. Each mode
creates a different node topology:

```typescript
interface FMPair {
  depthGain: GainNode;
}
interface FMPairFiltered {
  lowpass: BiquadFilterNode;
  depthGain: GainNode;
}
interface RingPair {
  dryGain: GainNode;
  wetGain: GainNode;
  shadowAmp: GainNode;
}

type CrossConnection =
  | { type: 'fm'; aToB: FMPair; bToA: FMPair }
  | { type: 'ring'; aRing: RingPair; bRing: RingPair }
  | { type: 'rawfm'; aToB: FMPairFiltered; bToA: FMPairFiltered };
```

### _syncCrossConnections (renamed from _syncFMConnections)

Dispatches on blend mode to create/update/teardown the right topology:

- `screen` → skip (no connections, unchanged).
- `multiply` → create/update `CrossConnection { type: 'fm' }`.
- `exclusion` → create/update `CrossConnection { type: 'ring' }`.
- `difference` → create/update `CrossConnection { type: 'rawfm' }`.

A blend-mode change tears down all connections and rebuilds (already the
case).

### Ring mod output routing

Ring mod requires intercepting the voice→master connection:

1. `safeDisconnect(voice.outputNode)` from `masterGain`.
2. Route through dry/wet nodes.
3. On teardown: disconnect dry/wet nodes, reconnect
   `voice.outputNode → masterGain`.

The engine needs a reference to `masterGain`. It already has one (passed
to `buildVoice()`). Store it on the engine instance for ring-mod routing.

## Parameters (effects.ts)

The `FMParams` interface is replaced by per-mode config:

```typescript
export interface FMConfig {
  maxIndex: number;
  depthCurve: 'linear' | 'sqrt';
}

export interface RingConfig {
  // Ring mod depth is controlled purely by overlap (0–1).
  // No extra scaling needed for now.
}

export interface RawFMConfig {
  maxIndex: number;
  depthCurve: 'linear' | 'sqrt';
}

export type BlendConfig =
  | { type: 'none' }
  | { type: 'fm'; config: FMConfig }
  | { type: 'ring'; config: RingConfig }
  | { type: 'rawfm'; config: RawFMConfig };

export const BLEND_CONFIG: Record<BlendMode, BlendConfig> = {
  screen:     { type: 'none' },
  multiply:   { type: 'fm', config: { maxIndex: 0.5, depthCurve: 'sqrt' } },
  exclusion:  { type: 'ring', config: {} },
  difference: { type: 'rawfm', config: { maxIndex: 0.8, depthCurve: 'linear' } },
};
```

`computeFMDepth()` remains unchanged — used by both `fm` and `rawfm` modes.

`FM_MODULATOR_LPF_HZ`, `FM_MODULATOR_LPF_Q`, `MAX_FM_DEVIATION` stay.

## What stays from the current branch

- `FM_MODULATOR_LPF_HZ` / `FM_MODULATOR_LPF_Q` constants → used by
  `difference` mode's lowpass.
- `MAX_FM_DEVIATION = 600` → safety cap for FM modes.
- `computeFMDepth()` / `computeOverlap()` / `computeTotalOverlap()` →
  unchanged.
- The TDD approach and test structure.

What gets replaced:
- `FM_PARAMS` / `FMParams` interface → `BLEND_CONFIG` / `BlendConfig` union.
- `FMConnection` → `CrossConnection` discriminated union.
- `_syncFMConnections` → `_syncCrossConnections` with mode dispatch.
- `_createFMConnection` → per-mode creation functions.

## Data flow / serialization

No change. Blend mode is still one of four enum values, serialized as 2 bits.
The bijection holds — same visual state produces the same audio.

## Testing

### Unit

- Tests for `computeFMDepth` with the new `fm` and `rawfm` maxIndex values.
- Tests for `BLEND_CONFIG` structure: screen is `none`, multiply is `fm`,
  exclusion is `ring`, difference is `rawfm`.
- Tests for `computeOverlap` — unchanged, existing coverage sufficient.

### Integration / audio snapshots

All FM-related baselines will shift. The ring mod test will be new (no
existing `exclusion` snapshot exercises the ring mod path). Regenerate all
blend-mode snapshots with `bun run test:e2e -- --update-snapshots`.

### Frequency profile

Run `scripts/audio-profile.js` on `main` vs. the PR branch. Expect some
spectral shift (especially in FM baselines), but random-spatch averages
should stay within ~5 dB per band since most random spatches have no
overlapping voices.

### Manual smoke test

- Construct overlapping pairs of each waveform combination.
- Cycle through all four modes. Confirm:
  - `screen`: clean, no modulation.
  - `multiply`: warm FM coloring, audibly different from screen.
  - `exclusion`: metallic/hollow ring mod character.
  - `difference`: chaotic, textural, the "weird" option.
- Stress: full overlap, various waveform pairs, various pitch intervals.

## Scope and non-goals

- No ratio snapping (modulator quantized to integer multiples of carrier).
  Deferred — the sine shadow already eliminates the primary harshness source.
- No per-mode filter cutoffs. One fixed lowpass on `difference` mode only.
- No new UI or user-facing controls. The blend mode button and panel are
  unchanged.
- No envelope on the ring mod crossfade or FM depth.
- No changes to overlap detection or the `computeOverlap` algorithm.
- No serialization changes.

## Rollback

Revert the branch. No state migration concerns — blend mode values and
serialization are unchanged.

## Risk

- **Ring mod routing is novel for this codebase.** It intercepts the
  voice→master connection, which no other code path does. Careful teardown
  is essential — failing to reconnect `outputNode → masterGain` would
  silence a voice.
- **Cross-modulation feedback.** Bidirectional FM (multiply, difference)
  creates A→B→A feedback loops. At the planned indices (0.5, 0.8) with
  sine/lowpassed modulators this should be stable, but needs manual
  listening at extreme cases (full overlap, high pitch).
- **Audio snapshot churn.** All FM-related baselines change. New ring mod
  baselines need creating. This is expected, not a regression signal.
- **Parameter tuning.** Starting numbers (multiply 0.5, difference 0.8) are
  estimates. Expect one or two tuning passes during implementation.
