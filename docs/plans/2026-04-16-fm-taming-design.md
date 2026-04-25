# FM Taming — Design

**Issue:** [#349 — fm blend is unpleasantly harsh and hard to use](https://got.colonpipe.org/zetlen/spatch/issues/349)
**Date:** 2026-04-16
**Status:** Approved

## Problem

The FM synthesis blend modes (`screen`, `multiply`, `exclusion`, `difference`)
produce an unpleasantly harsh sound that makes the feature hard to use. Users
easily create extreme dissonance without meaning to, and the usable range of
overlap and pitch combinations is narrow.

Root causes:

1. **Modulation index is too high.** Per `effects.ts`, `maxIndex` peaks at 1.8
   (difference) with a 2000 Hz deviation cap — well above the "gentle FM"
   range and deep into the regime where sidebands pile up into noise.
2. **Modulator spectrum is too rich.** Voices on pulse, blend, and astroid
   waveforms carry substantial energy in upper harmonics. When those harmonics
   drive a carrier's frequency, each one produces its own sideband pair, and
   inharmonic sideband stacks are the dominant source of perceived harshness.

## Goal

Make FM blend modes audibly subtler and more musically usable while keeping
all four modes (`screen`, `multiply`, `exclusion`, `difference`) distinguishable.

Non-goal (this round): ratio-snap the modulator to integer multiples of the
carrier to force harmonic spectra. That's a larger change and is deferred.

## Approach

Two-part fix, both in the audio layer, no state or serialization change:

1. **Reduce modulation depth** across the board (new `FM_PARAMS` values,
   lower global deviation cap).
2. **Lowpass-filter the modulator signal** before it drives the carrier
   frequency, culling the harsh high-order harmonics at their source.

## Changes

### `js/effects.ts` — parameters

```diff
 export const FM_PARAMS: Record<BlendMode, FMParams> = {
   screen:     { maxIndex: 0,   depthCurve: 'linear',  feedback: 0    },
-  multiply:   { maxIndex: 0.8, depthCurve: 'sqrt',    feedback: 0    },
-  exclusion:  { maxIndex: 1.2, depthCurve: 'linear',  feedback: 0    },
-  difference: { maxIndex: 1.8, depthCurve: 'linear',  feedback: 0.2  },
+  multiply:   { maxIndex: 0.25, depthCurve: 'sqrt',   feedback: 0    },
+  exclusion:  { maxIndex: 0.45, depthCurve: 'linear', feedback: 0    },
+  difference: { maxIndex: 0.70, depthCurve: 'linear', feedback: 0.08 },
 };

-const MAX_FM_DEVIATION = 2000;
+const MAX_FM_DEVIATION = 600;

+/** Modulator lowpass cutoff, Hz. Passes the full melodic range (≤784 Hz)
+ *  and attenuates 3rd+ harmonics of non-sine modulators, which are the
+ *  dominant source of FM harshness. */
+export const FM_MODULATOR_LPF_HZ = 1800;
+export const FM_MODULATOR_LPF_Q = 0.7071; // Butterworth, flat passband
```

Inter-mode ratios roughly preserved (~1 : 1.8 : 2.8) so the four blends remain
ordered from "subtle" to "wildest," just shifted down. Numbers are a starting
point; final values will be tuned by ear during implementation.

### `js/audio/engine.ts` — modulator lowpass

Add a `BiquadFilterNode` between the modulator output and the depth gain in
each FM connection.

```diff
 interface FMConnection {
+  modLowpass: BiquadFilterNode;
   depthGain: GainNode;
   feedbackGain?: GainNode;
 }
```

```diff
 private _createFMConnection(...): FMConnection {
   const params = FM_PARAMS[blend];
+  const modLowpass = new BiquadFilterNode(ctx, {
+    type: 'lowpass',
+    frequency: FM_MODULATOR_LPF_HZ,
+    Q: FM_MODULATOR_LPF_Q,
+  });
   const depthGain = new GainNode(ctx, { gain: 0 });
   const modulatorNode = modulatorAudio.getModulatorNode();
   const carrierParams = carrierAudio.getCarrierFrequencyParams();

-  modulatorNode.connect(depthGain);
+  modulatorNode.connect(modLowpass);
+  modLowpass.connect(depthGain);
   for (const freqParam of carrierParams) {
     depthGain.connect(freqParam);
   }

   // Self-modulation feedback — kept on the raw modulator signal.
   // Filtering the feedback path would alter the feedback dynamic, not
   // the harshness of the emitted sound.
   let feedbackGain: GainNode | undefined;
   if (params.feedback > 0) {
     feedbackGain = new GainNode(ctx, { gain: 0 });
     modulatorNode.connect(feedbackGain);
     feedbackGain.connect(modulatorNode.frequency);
   }

-  return { depthGain, feedbackGain };
+  return { modLowpass, depthGain, feedbackGain };
 }

 private _disposeFMConnection(conn: FMConnection): void {
   conn.depthGain.gain.value = 0;
   safeDisconnect(conn.depthGain);
+  safeDisconnect(conn.modLowpass);
   if (conn.feedbackGain) {
     conn.feedbackGain.gain.value = 0;
     safeDisconnect(conn.feedbackGain);
   }
 }
```

### Rationale — fixed cutoff, not tracking

- Melodic range is G2–G5 (~98–784 Hz fundamental). Fixed 1800 Hz passes every
  modulator fundamental with headroom.
- The harsh harmonics (3rd+ of pulse/astroid at typical pitches) sit above
  1.5 kHz and get progressively attenuated.
- Tracking the modulator fundamental adds per-voice control-rate plumbing for
  little audible benefit at this scale — correct YAGNI call for the first
  round.

### Rationale — feedback left un-filtered

Feedback modulates the modulator's own pitch at audio rate. Filtering it
changes the feedback's phase/amplitude dynamic, not the spectral harshness of
the carrier. We address harshness at the carrier-modulation path only.

## Data flow

No change to state, serialization, store, URL, or UI. Pure audio-graph edit.
Blend mode remains serialized as-is. The bijection invariant is preserved —
same visual state produces the same (tamer) audio state.

## Testing

### Unit

- If a unit test for `computeFMDepth` does not yet exist, add one asserting
  monotonicity in overlap, the new `MAX_FM_DEVIATION` cap, and the per-mode
  `maxIndex` ceiling. Cheap guard against accidental future regressions.

### Integration / audio snapshot

These baselines will shift and need regeneration (`bun run test:e2e --
--update-snapshots`):

- `fm-multiply-overlap-{chromium,webkit}.png`
- `fm-multiply-no-overlap-{chromium,webkit}.png` (may or may not shift)
- `fm-difference-overlap-{chromium,webkit}.png`
- `fm-move-into-overlap-{chromium,webkit}.png`
- `blend-mode-switching-{chromium,webkit}.png`
- `screen-no-fm-overlap-{chromium,webkit}.png` (should NOT shift — sanity check)

### Frequency profile

Per CLAUDE.md's audio regression rule, run `scripts/audio-profile.js` on
`main` vs. the PR branch. Expect upper-band energy reduction (intentional);
lower bands should be roughly unchanged. Any shift in the non-FM case
(single voice) would indicate a bug.

### Manual

- Place two overlapping voices of each waveform pairing.
- Cycle through all four blend modes (`screen`, `multiply`, `exclusion`,
  `difference`).
- Confirm each mode is audibly distinct, and the overall effect is subtler
  than on `main`.
- Check extreme cases (full overlap, high-pitched modulator, size=max)
  don't produce harshness comparable to `main`.

## Scope and non-goals

- No ratio snapping between modulator and carrier.
- No per-blend-mode filter cutoffs.
- No envelope on the modulator lowpass.
- No change to which pairs FM (top-over-bottom ordering, overlap rule).
- No new UI or user-facing control. This is an internal tuning.

## Rollback

Pure audio graph change. Revert the two files to restore prior behavior.
No state migration concerns.

## Risk

- Audio snapshots WILL change — expected, not a regression signal.
- Numbers in `FM_PARAMS` are a starting point; expect one or two tuning
  passes during implementation. If the result feels "too tame," raise
  `maxIndex` proportionally before widening the lowpass cutoff.
- `MAX_FM_DEVIATION = 600` is tight; if any realistic voice pair clips
  into the cap in a way that creates an audible plateau, raise the cap
  before raising `maxIndex`.
