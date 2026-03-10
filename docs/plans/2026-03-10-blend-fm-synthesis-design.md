# Blend FM Synthesis Design

**Issue:** #233 — Blend modes should do real FM synthesis

## Problem

Blend mode audio effects (saturation, compression, comb filtering, etc.) are
signal processing applied to a voice's own output. None involve actual frequency
modulation. Since visual blend modes are about how shapes *interact* when they
overlap, FM synthesis — one voice literally modulating another's frequency — is
a better audio analogy.

## Design: Cross-Voice FM

When shapes overlap, the **top voice** (later in array/DOM order) modulates the
**bottom voice's** oscillator frequency. This mirrors CSS blend semantics: the
top element is the "source" that composites onto the "backdrop."

### Signal flow

```
Top voice's oscillator ──→ depthGain ──→ Bottom voice's oscillator.frequency
                              ↑
                    gain = overlap × maxIndex × modulatorFreq
```

Both voices still produce their own sound. The top voice's oscillator fans out
to its own signal chain AND to the FM depth gain connecting to the bottom
voice's frequency param.

### 9 waveform combinations

The modulator waveform determines harmonic spectrum. Different waveform pairs
produce naturally distinct timbres:

- Sine mod → clean sidebands
- Pulse (raw sawtooth) mod → buzzy, harmonically rich modulation
- Blend (sawtooth) mod → intermediate character

The carrier waveform determines what gets modulated. Combined with the
modulator character, this yields 9 distinct timbral families.

### Blend mode → FM parameters

The **top voice's blend mode** determines how it modulates voices below it:

| Blend Mode  | Max Index | Depth Curve | Feedback | LFO  | Character               |
|-------------|-----------|-------------|----------|------|-------------------------|
| soft-light  | 0.3       | linear      | 0        | —    | Gentle shimmer          |
| multiply    | 1.5       | exponential | 0        | —    | Stays clean, then thick |
| screen      | 1.0       | linear      | 0        | —    | Bright, bell-like       |
| overlay     | 2.0       | linear      | 0.4      | —    | Self-mod metallic       |
| color-burn  | 3.0       | linear      | 0        | —    | Harsh, noise at max     |
| difference  | 1.5       | linear      | 0        | —    | Standard FM             |
| exclusion   | 1.0       | linear      | 0        | 0.3  | Pulsing, evolving       |

- **Depth curve**: `linear` = `overlap × maxIndex`, `exponential` = `overlap² × maxIndex`
- **Feedback**: Self-modulation of the modulator's own frequency (overlay only).
  Feedback gain scales with overlap, so no effect when not overlapping.
- **LFO**: Oscillates the depth gain at the given rate (exclusion only).
  Creates rhythmic FM pulsing.

### Frequency ratio is emergent

Unlike traditional FM synths with fixed operator ratios, the ratio here is
determined by the two voices' pitches (Y positions). Users explore FM ratios
by moving shapes vertically. To prevent extreme high-ratio FM from becoming
harsh noise, depth is capped: `min(computedDepth, 2000)`.

### Architecture changes

1. **effects.ts**: Remove `createBlendEffect`, all `wire*` blend functions,
   `BlendEffect` interface. Add `FM_PARAMS` table and `computeOverlap` (kept).
   Pattern effects unchanged.

2. **voice-builder.ts**: Remove blend effect from signal chain. Signal path
   becomes `brightness → [pattern effect] → panner → master`. Add utility
   functions `getModulatorNode(voice)` and `getCarrierFrequencyParams(voice)`
   to expose oscillator references for FM routing.

3. **engine.ts**: Replace `_updateBlendOverlaps` with FM connection management.
   `_fmConnections` array tracks active connections (depthGain nodes, optional
   LFOs). Connections rebuilt when voices are added/removed/blend-changed.
   `_updateFMDepths` called per frame to adjust depth based on current overlap.

4. **No changes**: types.ts (BlendMode union stays), serialize.ts (same 3-bit
   encoding), blend-panel.ts (same 7 buttons + icons).

### Bijection preserved

- Visual: CSS `mix-blend-mode` on shape groups (unchanged)
- Audio: FM synthesis driven by overlap (replaces signal processing effects)
- Same fields, same state, different audio interpretation
