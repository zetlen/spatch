# Voice Delegates and Register-Based Serialization

**Date:** 2026-03-23

## Summary

A voice is three projections of the same identity: how it looks and interacts
(UI), how it sounds (Player), and how it persists (Serializer). The current
`WaveformStrategy` fuses all three into a single 15+ method interface. This
design decomposes it into three delegate interfaces wired together by a
declarative registry — and replaces the ad-hoc serialization format with a
register-based model inspired by MIDI.

## Motivation

### The god-object problem

`WaveformStrategy` does too much. It owns SVG rendering, selection handle
geometry, gesture eligibility, audio graph construction, audio tuning
constants, state factory methods, timbre accessors, and wire format packing.
Adding a new voice type means implementing all of these in one file, even
though the concerns are independent.

### The serialization brittleness problem

The v1 serializer hard-codes per-voice-type layouts: a 3-char flags bitfield
with fill mode, border mode, effect, blend, and waveform index; then
variable-length fields (x/y/size, optional timbre, optional border thickness,
4-or-9-char fill). Adding a new field (e.g. stample trigger position, envelope
trigger point) requires the serializer to learn a new conditional layout. Each
waveform's `packExtra`/`unpackExtra` is nearly identical (3 of 5 current
strategies are copy-pasted) but there's no shared structure to build on.

### The parameter proliferation problem

New voice types bring new parameters. Stamples already have a `stamp` field
that other waveforms lack. They will likely gain `trigger` (envelope trigger
position), and future waveforms may add other 2-bit or 4-bit properties. Each
new parameter creates tension: does it get squeezed into the existing flags
bitfield? Does it extend the variable-length region? Every choice is a
format-breaking change.

MIDI solved this 40 years ago: numbered parameters with no inherent meaning.
CC#74 is "brightness" by convention, but the protocol doesn't care. The synth
patch maps controllers to parameters. The transport just moves numbered values.

## Design

### Authoritative state

The `Voice` record in `SigilStore` is the single source of truth. It is a
plain data object — the discriminated union in `types.ts`. All three delegates
are projections of it, not owners of it:

- **UI** reads `Voice` each frame to produce SVG. It holds no voice state.
- **Player** builds an `AudioVoice` from a `Voice`. The `AudioVoice` holds
  live audio nodes but is not authoritative — when parameters change, the
  engine calls `audioVoice.updateParams(voice, now)` with the current `Voice`
  from the store. The `AudioVoice` never writes back.
- **Serializer** is a pure bidirectional codec: `Voice ↔ registers`. No state.

```
User gesture → SigilStore (mutate Voice) → render loop → UI reads Voice → SVG
                                         → engine → AudioVoice.updateParams(Voice)
                                         → serializer → URL
```

The store is the single writer. Delegates are readers. `AudioVoice.lastX/Y/Size`
are optimization caches for change detection, not authoritative state.

### Three delegates

A voice type is defined by three delegate objects:

**UI** — SVG rendering, selection handles, hit areas, gesture eligibility.
Owns all visual constants: `svgTag`, `shapeName`, `rotationPeriod`. The
interaction layer queries the UI delegate to determine whether rotation
gestures are valid, what handle positions to show, etc.

**Player** — Audio graph construction and parameter updates. Owns all audio
constants: `oscillatorType`, `shapeAreaCoeff`, `formantMaxQ`, `gainExponent`.
Constructed with these as initialization args, not as interface properties to
implement.

**Serializer** — Bidirectional mapping between domain `Voice` objects and a
register file. Owns the register layout. Most voice types share a serializer
class.

### The registry

The registry is a flat table. Each row is a voice type definition:

```
┌───────────┬────┬─────────────┬─────────────┬──────────────────────┐
│ waveform  │ id │ ui          │ player      │ serializer           │
├───────────┼────┼─────────────┼─────────────┼──────────────────────┤
│ 'sine'    │  0 │ circleUI    │ sinePlayer  │ oscillatorSerializer │
│ 'pulse'   │  1 │ squareUI    │ pwmPlayer   │ oscillatorSerializer │
│ 'blend'   │  2 │ triangleUI  │ blendPlayer │ oscillatorSerializer │
│ 'astroid' │  3 │ astroidUI   │ supersawPl. │ oscillatorSerializer │
│ 'stamp'   │  4 │ stampUI     │ samplePl.   │ sampleSerializer     │
└───────────┴────┴─────────────┴─────────────┴──────────────────────┘
```

`getStrategy(waveform)` call sites become `registry.get(waveform).ui`,
`.player`, or `.serializer` depending on which projection they need.

`createVoice`, `getTimbre`, and `withTimbre` are derived by the registry from
the serializer's field declarations — they are not per-voice-type methods.
`hasTimbre` is derived from `ui.rotationPeriod > 0`.

### Where constants live

**Rule:** If a constant is consumed by exactly one delegate, it is a
constructor arg to that delegate. If it bridges the bijection (consumed by both
UI and Player), it lives on the registry entry.

| Constant | Consumer(s) | Location |
|----------|-------------|----------|
| `shapeName` | UI only | UI constructor arg |
| `svgTag` | UI only | UI constructor arg |
| `rotationPeriod` | UI + audio mapping | Registry entry |
| `oscillatorType` | Player only (border osc) | Player constructor arg |
| `shapeAreaCoeff` | Player only (gain calc) | Player constructor arg |
| `formantMaxQ` | Player only (formants) | Player constructor arg |
| `gainExponent` | Player only (vibe) | Player constructor arg |
| `serializationIndex` | Serializer only | Registry `id` field |

`rotationPeriod` is the only bijection constant — it governs both visual
rotation and audio timbre mapping. It belongs on the registry entry because it
defines the shape's geometric symmetry, which both projections must respect.

### Delegate interfaces

```typescript
interface VoiceUI {
  readonly svgTag: string;
  readonly shapeName: string;
  readonly rotationPeriod: number;
  createSvgElement(voice: Voice): SVGElement;
  updateSvgElement(el: SVGElement, voice: Voice): void;
  createSelectionElement?(voice: Voice): SVGElement;
  selectionHandles(voice: Voice): SVGElement[];
}

interface VoicePlayer {
  /** Build the waveform-specific audio graph and return a live AudioVoice handle.
   *  The player is a factory — runtime mutation (start, stop, updateParams,
   *  getModulatorNode, etc.) happens through the returned AudioVoice, which
   *  closes over the internal oscillator/source nodes. */
  buildAudioGraph(ctx: AudioContext, voice: Voice, shared: AudioSharedNodes): AudioVoice;
}

interface VoiceSerializer {
  /** Number of B64 characters in this serializer's register file. */
  readonly width: number;
  /** Pack a Voice into a fixed-width register string. */
  pack(voice: Voice): string;
  /** Unpack a fixed-width register string into a Voice.
   *  Receives only this voice's register slice, not the full URL. */
  unpack(registers: string): Voice;
}
```

Player constants (`oscillatorType`, `shapeAreaCoeff`, etc.) are constructor
args, not interface members. The interface is minimal — `buildAudioGraph` is
the only method.

### Serializer sharing

Most waveforms share a serializer. Serializer classes define
register-to-field mappings:

```
OscillatorSerializer
  Handles: sine, pulse, blend, astroid
  Register layout: [common fields] + SP4 = timbre (0 for sine)

SampleSerializer
  Handles: stamp (and future sample-based voices)
  Register layout: [common fields] + SP4 = stamp index + trigger position
```

Each serializer class is written once. Adding a new oscillator-based waveform
requires zero serializer code — just a new UI and Player, plus a registry row
pointing at `oscillatorSerializer`.

## Register-based wire format (v2)

### Principles

1. **The serializer is a dumb transport.** It packs and unpacks register
   values. It does not know what "fill" or "border" means.

2. **The serializer delegate maps registers to domain fields.** `CP1` becomes
   `fill.h, fill.s, fill.l` inside the serializer class. `serialize.ts` never
   sees domain names.

3. **Known-width voices.** A 1-bit fill mode flag determines whether CP2 is
   present (gradient) or absent (solid). Within each mode the width is fixed.

4. **Version byte.** A 1-char version prefix enables future format evolution.
   v1 URLs are not migrated — old URLs fail gracefully.

5. **Perceptual quantization.** Register widths match the resolution humans
   can actually perceive or the grid the UI snaps to. Every bit in the URL
   must earn its place.

### Quantization

| Parameter | v1 bits | v2 bits | v2 steps | Rationale |
|-----------|---------|---------|----------|-----------|
| Y (pitch) | 12 | 6 | 37 used / 64 max | Chromatic scale: 37 semitones G2-G5. Hard-snaps on release. |
| X (pan) | 12 | 12 | 4096 | Continuous. Grid snap was reverted — it shifts voice center, changing rotation geometry and audio output. |
| Size (gain) | 12 | 6 | 64 | 64 steps ≈ 0.6 dB. Below loudness JND. |
| Timbre | 12 | 6 | 64 | 1.6% PWM/blend steps. May need testing. |
| Hue | 9 | 9 | 512 | 0.7° resolution. Unchanged. |
| Saturation | 7 | 7 | 128 | 0.8% resolution. Unchanged. |
| Lightness | 7 | 7 | 128 | 0.8% resolution. Unchanged from v1. |
| Grad angle | 3 | 3 | 8 | 45° steps. Unchanged. |
| Attack | 12 | 3 | 8 | ~286ms steps over 0-2.0s. 8 qualitative stops. |
| Decay | 12 | 3 | 8 | ~286ms steps over 0-2.0s. |
| Sustain | 12 | 3 | 8 | ~14% steps over 0-1.0. 8 levels from off to full. |
| Release | 12 | 3 | 8 | ~429ms steps over 0-3.0s. 8 stops: chop → pad. |
| Border thick | 12 | 3 | 8 | Barely visible stroke weight. |
| Border style | 3 | 3 | 5 used / 8 max | none/W/B/W-dbl/B-dbl. Unchanged. |
| Effect | 3 | 3 | 5 used / 8 max | none/stripes/checker/noise/plaid. Unchanged. |
| Blend | 3 | 3 | 3 used / 8 max | screen/multiply/difference. Unchanged. |

Y quantization implies grid snapping on the pitch axis (magnetic during drag,
hard on release — already the existing behavior). X remains continuous at
12-bit resolution — grid-snapping X shifts voice center positions, which
changes rotation geometry and produces audible differences in audio output.

### Register layout

Registers are named by role: **CP** (Color Parameter) for the fixed-semantic
fill colors, **MP** (Medium Parameter) for 12-bit fields, **SP** (Small
Parameter) for 6-bit generic slots. CP1 and CP2 are different widths — CP2
includes the gradient angle and is only present for gradient fills.

| Register | Bits | Chars | Convention |
|----------|------|-------|-----------|
| CP1 | 23 | 4 | Fill color 1: H(9) + S(7) + L(7), 1 spare bit |
| CP2 | 26 | 5 | Fill color 2 + gradient angle: angle(3) + H(9) + S(7) + L(7). **Gradient only.** 4 spare bits. |
| SP1 | 6 | 1 | Y — note index (0-36) |
| MP1 | 12 | 2 | X — pan position (0-4095, continuous) |
| SP3 | 6 | 1 | Size (0-63) |
| SP4 | 6 | 1 | Waveform-specific: timbre (oscillators) / stamp index + trigger (samples) |
| SP5 | 6 | 1 | Effect (3b) + blend mode (3b) |
| SP6 | 6 | 1 | Border: style (3b) + thickness (3b, 0 = no border) |

**Solid voice: 1 header + 4 CP1 + 1 SP1 + 2 MP1 + 4 SP = 12 B64 chars.**
**Gradient voice: 1 header + 4 CP1 + 5 CP2 + 1 SP1 + 2 MP1 + 4 SP = 17 B64 chars.**

The fill mode is signaled by a bit in the type header character:

```
Type header (6 bits): [typeId: 3b][fillMode: 1b][spare: 2b]
```

### Wire format

```
[Version: 1 char (6b)]
[Scene: 1 char (6b)]
[Envelope: 2 chars (A 3b + D 3b, S 3b + R 3b)]
[Voice 0: 1 char header + 10 or 15 chars registers]
[Voice 1: 1 char header + 10 or 15 chars registers]
...
```

Global header: **4 B64 chars** (vs v1's 9). Voice strings are sorted
lexicographically before concatenation for canonical URL ordering.

### Measured savings

Analysis of 156 real sigils from production access logs (547 voices: 432
solid, 115 gradient):

| Metric | Value |
|--------|-------|
| Avg v1 length | 65.9 chars |
| Avg v2 length | 46.3 chars |
| Avg saved per sigil | 19.6 chars |
| Median reduction | 31.0% |
| Min reduction | 21.6% |
| Max reduction | 42.3% |

Every sigil gets shorter. The distribution is tight — nearly all sigils land
in the 25-35% savings band:

```
20-25%:  2 sigils
25-30%: 63 sigils  ████████████████████
30-35%: 68 sigils  ██████████████████████
35-40%: 20 sigils  ██████
40-50%:  3 sigils  █
```

## Relationship to existing design docs

This design supersedes the serialization aspects of
`2026-03-15-waveform-strategy-registry-design.md`. The bijection principle
(`2026-03-01-bijective-audio-visual-design.md`) is preserved — the register
model changes persistence, not visual-audio mappings.

## Decisions

1. **Timbre: 6 bits.** 64 steps for PWM/blend. If slow rotation produces
   audible stepping, widen SP4 in a future format version. Test empirically.

2. **X stays 12-bit, continuous.** Grid-snapping X was reverted — it shifts
   voice center positions, which changes rotation angle geometry and produces
   audible differences in supersaw gain normalization after rotation gestures.

3. **`rotationPeriod` lives on the UI delegate.** Audio code reads it via
   `registry.get(wf).ui.rotationPeriod`. The visual gesture space defines
   the parameter; audio derives from it.
