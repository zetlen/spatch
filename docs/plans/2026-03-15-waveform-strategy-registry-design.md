# Waveform Strategy Registry

**Date:** 2026-03-15
**Issues:** #207, #210, #213

## Problem

Per-waveform dispatch is scattered across 19+ switch/case, if/else, and
hardcoded-list sites in 10 files. Adding a new waveform (e.g. trapezoid,
hypocycloid star) requires touching all of them. The same 3-variant enumeration
is repeated for rendering, audio graph construction, audio tuning,
serialization, state creation, geometry, and randomization.

## Design

Consolidate all per-waveform logic into a **strategy registry**. Each waveform
is a self-contained strategy object in its own file. Consumer files dispatch
through the registry instead of switching.

### File layout

```
js/waveforms/
  types.ts          WaveformStrategy interface, AudioVoice interface, AudioSharedNodes
  index.ts          Registry map, getStrategy(), ALL_STRATEGIES
  sine.ts           Sine (circle) strategy
  pulse.ts          Pulse (square) strategy
  blend.ts          Blend (triangle) strategy
```

Adding a new waveform: create `js/waveforms/<name>.ts`, add one import + one
map entry in `index.ts`.

### WaveformStrategy interface

```typescript
interface WaveformStrategy {
  // ---- Identity ----
  readonly waveform: WaveformType;
  readonly shapeName: string;           // 'circle', 'square', 'triangle'
  readonly svgTag: string;              // 'circle', 'rect', 'polygon'
  readonly hasTimbre: boolean;
  readonly rotationPeriod: number;      // degrees per full timbre sweep (0 = no rotation)
  readonly serializationIndex: number;  // 0, 1, 2... for bitfield packing
  readonly oscillatorType: OscillatorType;  // 'sine', 'square', 'sawtooth' — used for border octave osc
  readonly shapeAreaCoeff: number;     // geometric area coefficient: π for circle, 4 for square, 3√3/4 for triangle
  readonly formantMaxQ: number;        // max formant Q (4 for sine, 8 for harmonics-rich)

  // ---- Rendering ----
  svgAttrs(voice: Voice): Record<string, string>;
  createSvgElement(voice: Voice): SVGElement;
  updateSvgElement(el: SVGElement, voice: Voice): void;
  handlePositions(voice: Voice): [HandleType, number, number][];

  // ---- Audio ----
  buildAudioGraph(
    ctx: AudioContext,
    voice: Voice,
    shared: AudioSharedNodes,
  ): AudioVoice;

  // ---- State ----
  createVoice(base: VoiceBase): Voice;  // VoiceBase already includes id

  // ---- Serialization ----
  packExtra(voice: Voice): string;
  unpackExtra(str: string, idx: number): { fields: Record<string, unknown>; bytesRead: number };
}
```

### AudioVoice: uniform interface with bound methods

The current `AudioVoice` discriminated union (SineAudioVoice | SquareAudioVoice
| TriangleAudioVoice) is replaced with a single interface. Waveform-specific
oscillator nodes are internal to the strategy; the engine interacts only through
bound methods.

```typescript
interface AudioVoice {
  // Shared fields (unchanged from current AudioVoiceBase)
  shapeId: string;
  gain: GainNode;
  outputNode: StereoPannerNode;
  panner: StereoPannerNode;
  formantF1: BiquadFilterNode;
  formantF2: BiquadFilterNode;
  formantMixer: GainNode;
  brightness: BiquadFilterNode;
  warmthShaper: WaveShaperNode | undefined;
  octaveOsc: OscillatorNode | undefined;
  octaveGainNode: GainNode | undefined;
  effectDispose: (() => void) | undefined;
  currentEffect: string | undefined;
  currentBlend: BlendMode;
  currentBorder: string | undefined;
  currentFillKey: string | undefined;
  hasSweep: boolean;

  // Bound by strategy — no external dispatch needed
  start(time: number): void;
  stop(time: number): void;
  updateParams(voice: Voice, now: number): void;
  getModulatorNode(): OscillatorNode;
  getCarrierFrequencyParams(): AudioParam[];
}
```

The strategy's `buildAudioGraph` creates oscillators, connects them to
`shared.gain`, and returns an `AudioVoice` with these methods closed over the
internal nodes. The engine calls `audioVoice.updateParams(voice, now)` — zero
waveform switching.

**`warmthShaper` ownership:** The `AudioVoice` interface includes
`warmthShaper` as an optional field. The strategy creates it if needed (sine
uses it for analog warmth) and sets it on the returned `AudioVoice`. Other
strategies set it to `undefined`.

**`svgAttrs` for polygon shapes:** `svgAttrs` returns a plain
`Record<string, string>`. For polygon-based shapes (triangle), it returns
`{ points: '...' }`. `updateSvgElement` calls `setAttrs(el, svgAttrs(voice))`,
which works uniformly since `setAttrs` calls `setAttribute` in a loop.

### AudioSharedNodes

The common audio graph plumbing built by `voice-builder.ts` before delegating
to the strategy:

```typescript
interface AudioSharedNodes {
  ctx: AudioContext;
  gain: GainNode;
  formantF1: BiquadFilterNode;
  formantF2: BiquadFilterNode;
  formantMixer: GainNode;
  brightness: BiquadFilterNode;
  panner: StereoPannerNode;
  octaveOsc: OscillatorNode | undefined;
  octaveGainNode: GainNode | undefined;
  effectDispose: (() => void) | undefined;
  currentEffect: string | undefined;
  currentBlend: BlendMode;
  currentBorder: string | undefined;
  currentFillKey: string | undefined;
}
```

### Registry

```typescript
// js/waveforms/index.ts
import sine from './sine.ts';
import pulse from './pulse.ts';
import blend from './blend.ts';

const STRATEGIES = new Map<WaveformType, WaveformStrategy>([
  ['sine', sine],
  ['pulse', pulse],
  ['blend', blend],
]);

export function getStrategy(waveform: WaveformType): WaveformStrategy {
  return STRATEGIES.get(waveform)!;
}

export const ALL_STRATEGIES: WaveformStrategy[] =
  [...STRATEGIES.values()].sort((a, b) => a.serializationIndex - b.serializationIndex);
```

## Changes to existing files

### Deleted

- `waveformShape()` in `types.ts` — replaced by `strategy.shapeName`
- `AudioVoice` discriminated union + 3 sub-interfaces in `voice-builder.ts`
- `getModulatorNode()` and `getCarrierFrequencyParams()` free functions in
  `voice-builder.ts`

### Simplified (switches removed)

**`render.ts`** — 5 switches become strategy calls:

- `createShapeElement(voice)` → `getStrategy(voice.waveform).createSvgElement(voice)`
- `updateShapeElement(el, voice)` → `getStrategy(voice.waveform).updateSvgElement(el, voice)`
- `shapeTagName(voice)` → `getStrategy(voice.waveform).svgTag`
- `createShapeOutline(voice)` → reuses `getStrategy(voice.waveform).createSvgElement(voice)`
- `shapeHandlePositions(voice)` → `getStrategy(voice.waveform).handlePositions(voice)`

**`engine.ts`** — frequency/timbre switch (line 587) becomes:
`audioVoice.updateParams(voice, now)`

**`serialize.ts`** — waveform ternaries replaced by:
- Pack: `strategy.serializationIndex` for the bitfield, `strategy.packExtra(voice)` for timbre
- Unpack: look up strategy by index, call `strategy.unpackExtra(str, idx)`, then
  `strategy.createVoice(base)` to construct the correct Voice type

**`state.ts:createVoice()`** — switch becomes:
`getStrategy(waveform).createVoice(base)`

**`shapes.ts:voiceRotation()`** — becomes:
```typescript
export function voiceRotation(voice: Voice): number {
  if (!('timbre' in voice)) return 0;
  const period = getStrategy(voice.waveform).rotationPeriod;
  return Math.min(1, Math.max(0, voice.timbre)) * period;
}
```

**`render.ts` rotation handle** — `voice.waveform !== 'sine'` check (line 496)
becomes `getStrategy(voice.waveform).hasTimbre`.

**`vibe.ts:shapeAreaFraction()`** — switch on waveform for area formula becomes:
```typescript
shapeAreaFraction(waveform: WaveformType, size: number): number {
  const half = size / 2;
  return getStrategy(waveform).shapeAreaCoeff * half * half;
}
```
Note: `shapeAreaCoeff` is `π` for circle, `4` for square (since `size*size =
4 * half*half`), `3√3/4` for triangle. The `WAVEFORM_GAIN` initialization in
the `Vibe` constructor also uses `shapeAreaFraction` and is fixed transitively.

**`formants.ts:computeFormantQ()`** — `waveform === 'sine' ? 4 : 8` becomes:
`getStrategy(waveform).formantMaxQ`

**`mapping.ts:rotationToTimbre()`** — `WAVEFORM_PERIOD` lookup becomes:
`getStrategy(waveform).rotationPeriod`. The standalone `WAVEFORM_PERIOD` record
is deleted.

**`voice-builder.ts:buildVoice()` octave osc type** — the `oscTypeMap` record
(line 172) becomes `getStrategy(voice.waveform).oscillatorType`. This is read
by the shared plumbing (octave doubling) before delegating to the strategy, so
it's a property on the strategy, not internal to `buildAudioGraph`.

**`interaction.ts` rotation guards** — two `voice.waveform === 'sine'` checks
(pinch-rotate line 467, mouse-rotate line 535) become
`!getStrategy(voice.waveform).hasTimbre`.

**`interaction.ts` + `app.ts` `toolToWaveform` maps** — these map toolbar tool
names to waveform types. Derived from the registry:
```typescript
const toolToWaveform = new Map(
  ALL_STRATEGIES.map(s => [s.shapeName, s.waveform])
);
```

**`harmony.ts:WAVEFORMS` array** — hardcoded `['sine', 'pulse', 'blend']`
replaced by `ALL_STRATEGIES.map(s => s.waveform)`.

**`serialize.ts` unpack lookup** — during unpack, the waveform index from the
bitfield maps to a strategy via `ALL_STRATEGIES[wf]`. This works because
`ALL_STRATEGIES` is sorted by `serializationIndex` (see registry section).

**`vibe.ts:WAVEFORM_GAIN` and `GAIN_EXPONENT` records** — these are keyed by
`WaveformType` and hardcode entries for `sine`, `pulse`, `blend`.
`WAVEFORM_GAIN` is derived from `shapeAreaFraction` (transitively fixed by
`shapeAreaCoeff`). `GAIN_EXPONENT` is set from `VibeOptions.exponents` — a
per-scene tuning parameter. Both should be initialized by iterating
`ALL_STRATEGIES` instead of hardcoding keys:
```typescript
// GAIN_EXPONENT: fall back to a default when scene doesn't override
for (const s of ALL_STRATEGIES) {
  this.GAIN_EXPONENT[s.waveform] = opts?.exponents?.[s.waveform]
    ?? VIBE_DEFAULTS.exponents[s.waveform]
    ?? VIBE_DEFAULTS.exponents.default;
}
// WAVEFORM_GAIN: derived from areaToGain, already keyed by waveform
for (const s of ALL_STRATEGIES) {
  this.WAVEFORM_GAIN[s.waveform] = refVoiceGain / this.areaToGain(s.waveform, 0.5);
}
```
`VIBE_DEFAULTS.exponents` gains a `default` fallback for new waveforms that
scenes haven't tuned yet.

### Stays in place

**`voice-builder.ts`** keeps `buildVoice` as the shared entry point. It builds
the common graph (gain, formant filters, panner, effect chain, octave
doubling), packages it as `AudioSharedNodes`, then delegates to
`strategy.buildAudioGraph()`. Shared utilities stay: `safeStop`,
`safeDisconnect`, `fillToKey`, `createPWMWaveshaper`.

**`render.ts`** keeps all non-dispatch code: reconciliation, fill application,
pattern overlays, borders, selection UI rendering, layer management.
`circleAttrs`, `rectAttrs`, `trianglePoints` move into their respective
strategy files.

**`types.ts`** keeps the `Voice` discriminated union, `VoiceBase`, `WaveformType`,
branded types — all unchanged.

**`tutorial.ts`** stays in place. It has waveform-specific content (step text,
CSS selectors for toolbar tools, `isolateShape` checking `shape !== 'sine'`
for timbre). These are tutorial *content* — hand-authored steps that describe
specific shapes. They don't benefit from a registry lookup. When new waveforms
are added, the tutorial will need manual updates to its content regardless.

## What each strategy file contains

Each file exports a default `WaveformStrategy` object. Example structure for
`sine.ts`:

```typescript
// js/waveforms/sine.ts
import { svgEl, setAttrs } from '../dom.ts';
import { safeStop } from '../audio/voice-builder.ts';
import { yToFrequency } from '../audio/mapping.ts';
import { vibe } from '../audio/vibe.ts';
import type { AudioSharedNodes, AudioVoice, WaveformStrategy } from './types.ts';

function circleAttrs(voice) { ... }

const sine: WaveformStrategy = {
  waveform: 'sine',
  shapeName: 'circle',
  svgTag: 'circle',
  hasTimbre: false,
  rotationPeriod: 0,
  serializationIndex: 0,

  svgAttrs: circleAttrs,
  createSvgElement(voice) { ... },
  updateSvgElement(el, voice) { setAttrs(el, circleAttrs(voice)); },
  handlePositions(voice) { ... },

  buildAudioGraph(ctx, voice, shared) {
    // Create sine oscillator + warmth shaper
    // Connect to shared.gain
    // Return AudioVoice with bound methods
  },

  createVoice(base) {
    return { ...base, waveform: 'sine' };
  },

  packExtra(_voice) { return ''; },
  unpackExtra(_str, _idx) { return { fields: {}, bytesRead: 0 }; },
};

export default sine;
```

`pulse.ts` and `blend.ts` follow the same shape but with their own oscillator
topologies, SVG geometry, timbre handling, and serialization.

## Constraints

- The `Voice` discriminated union in `types.ts` is unchanged. Sine has no
  `timbre`; pulse and blend do. The strategy declares `hasTimbre` and
  `createVoice` handles the type-level difference.
- The bijection principle is unaffected — this is a pure refactor of dispatch
  mechanics, not data or mappings.
- Serialization format is unchanged — the bitfield layout, field order, and
  encoding are identical. Only the code that reads/writes those bits moves.
- No new dependencies.
