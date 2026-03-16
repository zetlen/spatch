# Waveform Strategy Registry Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate 19+ per-waveform dispatch sites across 10 files into a strategy registry, so adding a new waveform means creating one file and one registry entry.

**Architecture:** Each waveform (sine, pulse, blend) becomes a self-contained strategy object in `js/waveforms/<name>.ts`. A registry in `js/waveforms/index.ts` maps `WaveformType` to strategy. Consumer files replace switch/case blocks with registry lookups. The `AudioVoice` discriminated union is replaced by a uniform interface with bound methods.

**Tech Stack:** TypeScript, Bun (test runner), Vite (build), no frameworks.

**Spec:** `docs/plans/2026-03-15-waveform-strategy-registry-design.md`

---

## Chunk 1: Foundation — Types, Registry, Strategy Files

### Task 1: Create WaveformStrategy types

**Files:**
- Create: `js/waveforms/types.ts`
- Modify: `js/types.ts:150` (export `VoiceBase`)

- [ ] **Step 1: Export `VoiceBase` from types.ts**

In `js/types.ts:150`, change `interface VoiceBase` to `export interface VoiceBase`.
The strategy files and `waveforms/types.ts` need to import it.

- [ ] **Step 2: Create the types file with all interfaces**

```typescript
// js/waveforms/types.ts
import type { BlendMode, HandleType, Voice, VoiceBase, WaveformType } from '../types.ts';

/** Shared audio nodes built by voice-builder before delegating to strategy. */
export interface AudioSharedNodes {
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

/** Uniform audio voice interface with strategy-bound methods. */
export interface AudioVoice {
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
  start(time: number): void;
  stop(time: number): void;
  updateParams(voice: Voice, now: number): void;
  getModulatorNode(): OscillatorNode;
  getCarrierFrequencyParams(): AudioParam[];
}

/** Strategy interface: all per-waveform behavior in one object. */
export interface WaveformStrategy {
  readonly waveform: WaveformType;
  readonly shapeName: string;
  readonly svgTag: string;
  readonly hasTimbre: boolean;
  readonly rotationPeriod: number;
  readonly serializationIndex: number;
  readonly oscillatorType: OscillatorType;
  readonly shapeAreaCoeff: number;
  readonly formantMaxQ: number;

  svgAttrs(voice: Voice): Record<string, string>;
  createSvgElement(voice: Voice): SVGElement;
  updateSvgElement(el: SVGElement, voice: Voice): void;
  handlePositions(voice: Voice): [HandleType, number, number][];

  buildAudioGraph(
    ctx: AudioContext,
    voice: Voice,
    shared: AudioSharedNodes,
  ): AudioVoice;

  createVoice(base: VoiceBase): Voice;

  packExtra(voice: Voice): string;
  unpackExtra(str: string, idx: number): { fields: Record<string, unknown>; bytesRead: number };
}
```

- [ ] **Step 3: Run typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add js/waveforms/types.ts js/types.ts
git commit -m "Add WaveformStrategy, AudioVoice, AudioSharedNodes interfaces"
```

### Task 2: Create registry and three strategy files

**Files:**
- Create: `js/waveforms/index.ts`
- Create: `js/waveforms/sine.ts`
- Create: `js/waveforms/pulse.ts`
- Create: `js/waveforms/blend.ts`
- Create: `tests/unit/waveform-registry.test.js`

Each strategy file extracts its logic from the current source files. The code is
copied, not moved yet — consumer files still use their own switches. We'll
migrate consumers in later tasks and delete the dead code at the end.

- [ ] **Step 1: Export shared helpers needed by strategy files**

Before creating strategy files, export functions they'll need to import:

In `js/serialize.ts`: add `export` to `encodeInt` (line 118), `decodeInt`
(line 128), and `round3` (line 114).

In `js/audio/voice-builder.ts`: add `export` to `function createPWMWaveshaper`
(line 64).

- [ ] **Step 2: Write registry tests**

```javascript
// tests/unit/waveform-registry.test.js
import { describe, expect, test } from 'bun:test';
import { ALL_STRATEGIES, getStrategy } from '../../js/waveforms/index.ts';

describe('waveform registry', () => {
  test('getStrategy returns a strategy for each waveform type', () => {
    for (const wf of ['sine', 'pulse', 'blend']) {
      const s = getStrategy(wf);
      expect(s).toBeDefined();
      expect(s.waveform).toBe(wf);
    }
  });

  test('ALL_STRATEGIES is sorted by serializationIndex', () => {
    for (let i = 1; i < ALL_STRATEGIES.length; i++) {
      expect(ALL_STRATEGIES[i].serializationIndex).toBeGreaterThan(
        ALL_STRATEGIES[i - 1].serializationIndex,
      );
    }
  });

  test('each strategy has consistent identity properties', () => {
    const sine = getStrategy('sine');
    expect(sine.shapeName).toBe('circle');
    expect(sine.svgTag).toBe('circle');
    expect(sine.hasTimbre).toBe(false);
    expect(sine.rotationPeriod).toBe(0);
    expect(sine.oscillatorType).toBe('sine');
    expect(sine.shapeAreaCoeff).toBeCloseTo(Math.PI);
    expect(sine.formantMaxQ).toBe(4);

    const pulse = getStrategy('pulse');
    expect(pulse.shapeName).toBe('square');
    expect(pulse.svgTag).toBe('rect');
    expect(pulse.hasTimbre).toBe(true);
    expect(pulse.rotationPeriod).toBe(90);
    expect(pulse.oscillatorType).toBe('square');
    expect(pulse.shapeAreaCoeff).toBe(4);
    expect(pulse.formantMaxQ).toBe(8);

    const blend = getStrategy('blend');
    expect(blend.shapeName).toBe('triangle');
    expect(blend.svgTag).toBe('polygon');
    expect(blend.hasTimbre).toBe(true);
    expect(blend.rotationPeriod).toBe(120);
    expect(blend.oscillatorType).toBe('sawtooth');
    expect(blend.shapeAreaCoeff).toBeCloseTo((3 * Math.sqrt(3)) / 4);
    expect(blend.formantMaxQ).toBe(8);
  });

  test('serializationIndex values match current encoding', () => {
    expect(getStrategy('sine').serializationIndex).toBe(0);
    expect(getStrategy('pulse').serializationIndex).toBe(1);
    expect(getStrategy('blend').serializationIndex).toBe(2);
  });
});

describe('strategy createVoice', () => {
  const base = {
    id: 'test1',
    x: 0.5,
    y: 0.5,
    size: 0.25,
    fill: { mode: 'solid', h: 200, s: 80, l: 50 },
    effect: undefined,
    blend: 'screen',
    border: undefined,
  };

  test('sine createVoice returns voice without timbre', () => {
    const v = getStrategy('sine').createVoice(base);
    expect(v.waveform).toBe('sine');
    expect('timbre' in v).toBe(false);
  });

  test('pulse createVoice returns voice with timbre', () => {
    const v = getStrategy('pulse').createVoice(base);
    expect(v.waveform).toBe('pulse');
    expect('timbre' in v).toBe(true);
    expect(v.timbre).toBe(0);
  });

  test('blend createVoice returns voice with timbre', () => {
    const v = getStrategy('blend').createVoice(base);
    expect(v.waveform).toBe('blend');
    expect('timbre' in v).toBe(true);
    expect(v.timbre).toBe(0);
  });
});

describe('strategy packExtra / unpackExtra round-trip', () => {
  test('sine packs nothing, unpacks nothing', () => {
    const s = getStrategy('sine');
    const voice = { waveform: 'sine', x: 0.5, y: 0.5, size: 0.25,
      fill: { mode: 'solid', h: 0, s: 0, l: 0 }, effect: undefined,
      blend: 'screen', border: undefined, id: 'v1' };
    expect(s.packExtra(voice)).toBe('');
    const { fields, bytesRead } = s.unpackExtra('', 0);
    expect(bytesRead).toBe(0);
    expect(Object.keys(fields)).toHaveLength(0);
  });

  test('pulse packs and unpacks timbre', () => {
    const s = getStrategy('pulse');
    const voice = { waveform: 'pulse', timbre: 0.5, x: 0.5, y: 0.5,
      size: 0.25, fill: { mode: 'solid', h: 0, s: 0, l: 0 },
      effect: undefined, blend: 'screen', border: undefined, id: 'v1' };
    const packed = s.packExtra(voice);
    expect(packed.length).toBe(2);
    const { fields, bytesRead } = s.unpackExtra(packed, 0);
    expect(bytesRead).toBe(2);
    expect(fields.timbre).toBeCloseTo(0.5, 2);
  });

  test('blend packs and unpacks timbre', () => {
    const s = getStrategy('blend');
    const voice = { waveform: 'blend', timbre: 0.75, x: 0.5, y: 0.5,
      size: 0.25, fill: { mode: 'solid', h: 0, s: 0, l: 0 },
      effect: undefined, blend: 'screen', border: undefined, id: 'v1' };
    const packed = s.packExtra(voice);
    expect(packed.length).toBe(2);
    const { fields, bytesRead } = s.unpackExtra(packed, 0);
    expect(bytesRead).toBe(2);
    expect(fields.timbre).toBeCloseTo(0.75, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/waveform-registry.test.js`
Expected: FAIL (modules don't exist yet)

- [ ] **Step 3: Create `js/waveforms/sine.ts`**

Extract from current source files. Key sources:
- `render.ts:90-93` → `circleAttrs`
- `render.ts:117-136` → `createSvgElement` (circle branch)
- `render.ts:408-415` → `handlePositions` (circle branch)
- `voice-builder.ts:301-337` → `buildAudioGraph` (sine branch)
- `state.ts:51-52` → `createVoice` (sine branch)
- `serialize.ts:168-170` → `packExtra` (no timbre for sine)

```typescript
// js/waveforms/sine.ts
import { svgEl, setAttrs } from '../dom.ts';
import type { HandleType, Voice, VoiceBase } from '../types.ts';
import { normalizedCoord } from '../types.ts';
import { yToFrequency } from '../audio/mapping.ts';
import { vibe } from '../audio/vibe.ts';
import { safeStop } from '../audio/voice-builder.ts';
import type { AudioSharedNodes, AudioVoice, WaveformStrategy } from './types.ts';

function circleAttrs(voice: Voice): Record<string, string> {
  const r = voice.size / 2;
  return { cx: String(voice.x), cy: String(voice.y), r: String(r) };
}

const sine: WaveformStrategy = {
  waveform: 'sine',
  shapeName: 'circle',
  svgTag: 'circle',
  hasTimbre: false,
  rotationPeriod: 0,
  serializationIndex: 0,
  oscillatorType: 'sine',
  shapeAreaCoeff: Math.PI,
  formantMaxQ: 4,

  svgAttrs: circleAttrs,

  createSvgElement(voice: Voice): SVGElement {
    const el = svgEl('circle');
    setAttrs(el, circleAttrs(voice));
    return el;
  },

  updateSvgElement(el: SVGElement, voice: Voice): void {
    setAttrs(el, circleAttrs(voice));
  },

  handlePositions(voice: Voice): [HandleType, number, number][] {
    const r = voice.size / 2;
    return [
      ['e', voice.x + r, voice.y],
      ['n', voice.x, voice.y - r],
      ['w', voice.x - r, voice.y],
      ['s', voice.x, voice.y + r],
    ];
  },

  buildAudioGraph(
    ctx: AudioContext,
    voice: Voice,
    shared: AudioSharedNodes,
  ): AudioVoice {
    const freq = yToFrequency(voice.y);
    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: freq });

    const sineWarm = new WaveShaperNode(ctx);
    const warmSamples = 1024;
    const warmCurve = new Float32Array(warmSamples);
    for (let i = 0; i < warmSamples; i++) {
      const x = (i * 2) / warmSamples - 1;
      warmCurve[i] = Math.tanh(x * vibe.warmth);
    }
    sineWarm.curve = warmCurve;
    sineWarm.oversample = '2x';

    osc.connect(sineWarm);
    sineWarm.connect(shared.gain);

    return {
      ...shared,
      shapeId: voice.id,
      outputNode: shared.panner,
      warmthShaper: sineWarm,
      hasSweep: false,
      start(time: number) {
        osc.start(time);
        if (shared.octaveOsc) {
          try { shared.octaveOsc.start(time); } catch {}
        }
      },
      stop(_time: number) {
        safeStop(osc);
        if (shared.octaveOsc) safeStop(shared.octaveOsc);
      },
      updateParams(voice: Voice, now: number) {
        osc.frequency.setValueAtTime(yToFrequency(voice.y), now);
      },
      getModulatorNode() { return osc; },
      getCarrierFrequencyParams() {
        const params: AudioParam[] = [osc.frequency];
        if (shared.octaveOsc) params.push(shared.octaveOsc.frequency);
        return params;
      },
    };
  },

  createVoice(base: VoiceBase): Voice {
    return { ...base, waveform: 'sine' } as Voice;
  },

  packExtra(_voice: Voice): string { return ''; },

  unpackExtra(_str: string, _idx: number) {
    return { fields: {}, bytesRead: 0 };
  },
};

export default sine;
```

- [ ] **Step 4: Create `js/waveforms/pulse.ts`**

Extract from current source files. Key sources:
- `render.ts:95-103` → `rectAttrs`
- `render.ts:125-129` → `createSvgElement` (square branch)
- `render.ts:416-423` → `handlePositions` (square branch)
- `voice-builder.ts:220-256` → `buildAudioGraph` (pulse branch)
- `voice-builder.ts:64-73` → `createPWMWaveshaper` (shared helper, import it)
- `state.ts:54-55` → `createVoice` (pulse branch)
- `serialize.ts:168-170` → `packExtra` / `unpackExtra` (timbre encoding)

```typescript
// js/waveforms/pulse.ts
import { svgEl, setAttrs } from '../dom.ts';
import type { HandleType, Voice, VoiceBase } from '../types.ts';
import { normalizedCoord } from '../types.ts';
import { timbreToPWMOffset, yToFrequency } from '../audio/mapping.ts';
import { createPWMWaveshaper, safeStop } from '../audio/voice-builder.ts';
import { encodeInt, decodeInt, round3 } from '../serialize.ts';
import type { AudioSharedNodes, AudioVoice, WaveformStrategy } from './types.ts';

function rectAttrs(voice: Voice): Record<string, string> {
  const r = voice.size / 2;
  return {
    height: String(voice.size),
    width: String(voice.size),
    x: String(voice.x - r),
    y: String(voice.y - r),
  };
}

const pulse: WaveformStrategy = {
  waveform: 'pulse',
  shapeName: 'square',
  svgTag: 'rect',
  hasTimbre: true,
  rotationPeriod: 90,
  serializationIndex: 1,
  oscillatorType: 'square',
  shapeAreaCoeff: 4,
  formantMaxQ: 8,

  svgAttrs: rectAttrs,

  createSvgElement(voice: Voice): SVGElement {
    const el = svgEl('rect');
    setAttrs(el, rectAttrs(voice));
    return el;
  },

  updateSvgElement(el: SVGElement, voice: Voice): void {
    setAttrs(el, rectAttrs(voice));
  },

  handlePositions(voice: Voice): [HandleType, number, number][] {
    const r = voice.size / 2;
    return [
      ['nw', voice.x - r, voice.y - r],
      ['ne', voice.x + r, voice.y - r],
      ['se', voice.x + r, voice.y + r],
      ['sw', voice.x - r, voice.y + r],
    ];
  },

  buildAudioGraph(
    ctx: AudioContext,
    voice: Voice,
    shared: AudioSharedNodes,
  ): AudioVoice {
    const timbre = 'timbre' in voice ? voice.timbre : 0;
    const freq = yToFrequency(voice.y);
    const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: freq });
    const pwmOffset = new ConstantSourceNode(ctx, { offset: timbreToPWMOffset(timbre) });
    const ws = createPWMWaveshaper(ctx);

    osc.connect(ws);
    pwmOffset.connect(ws);
    ws.connect(shared.gain);
    pwmOffset.start();

    return {
      ...shared,
      shapeId: voice.id,
      outputNode: shared.panner,
      warmthShaper: undefined,
      hasSweep: false,
      start(time: number) {
        try { osc.start(time); } catch {}
        if (shared.octaveOsc) {
          try { shared.octaveOsc.start(time); } catch {}
        }
      },
      stop(_time: number) {
        safeStop(osc);
        safeStop(pwmOffset);
        if (shared.octaveOsc) safeStop(shared.octaveOsc);
      },
      updateParams(voice: Voice, now: number) {
        const timbre = 'timbre' in voice ? voice.timbre : 0;
        osc.frequency.setValueAtTime(yToFrequency(voice.y), now);
        pwmOffset.offset.setValueAtTime(timbreToPWMOffset(timbre), now);
      },
      getModulatorNode() { return osc; },
      getCarrierFrequencyParams() {
        const params: AudioParam[] = [osc.frequency];
        if (shared.octaveOsc) params.push(shared.octaveOsc.frequency);
        return params;
      },
    };
  },

  createVoice(base: VoiceBase): Voice {
    return { ...base, waveform: 'pulse', timbre: normalizedCoord(0) } as Voice;
  },

  packExtra(voice: Voice): string {
    if (!('timbre' in voice)) return '';
    return encodeInt(round3(voice.timbre) * 1000, 2);
  },

  unpackExtra(str: string, idx: number) {
    const timbre = decodeInt(str, idx, 2) / 1000;
    return { fields: { timbre: normalizedCoord(timbre) }, bytesRead: 2 };
  },
};

export default pulse;
```

- [ ] **Step 5: Create `js/waveforms/blend.ts`**

Extract from current source files. Key sources:
- `render.ts:105-115` → `trianglePoints`
- `render.ts:130-134` → `createSvgElement` (triangle branch)
- `render.ts:424-434` → `handlePositions` (triangle branch)
- `voice-builder.ts:258-299` → `buildAudioGraph` (blend branch)
- `state.ts:57-58` → `createVoice` (blend branch)

```typescript
// js/waveforms/blend.ts
import { svgEl, setAttrs } from '../dom.ts';
import type { HandleType, Voice, VoiceBase } from '../types.ts';
import { normalizedCoord } from '../types.ts';
import { yToFrequency } from '../audio/mapping.ts';
import { safeStop } from '../audio/voice-builder.ts';
import { encodeInt, decodeInt, round3 } from '../serialize.ts';
import type { AudioSharedNodes, AudioVoice, WaveformStrategy } from './types.ts';

function trianglePoints(voice: Voice): string {
  const r = voice.size / 2;
  const pts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
    const px = voice.x + Math.cos(angle) * r;
    const py = voice.y + Math.sin(angle) * r;
    pts.push(`${px},${py}`);
  }
  return pts.join(' ');
}

function triangleAttrs(voice: Voice): Record<string, string> {
  return { points: trianglePoints(voice) };
}

const blend: WaveformStrategy = {
  waveform: 'blend',
  shapeName: 'triangle',
  svgTag: 'polygon',
  hasTimbre: true,
  rotationPeriod: 120,
  serializationIndex: 2,
  oscillatorType: 'sawtooth',
  shapeAreaCoeff: (3 * Math.sqrt(3)) / 4,
  formantMaxQ: 8,

  svgAttrs: triangleAttrs,

  createSvgElement(voice: Voice): SVGElement {
    const el = svgEl('polygon');
    el.setAttribute('points', trianglePoints(voice));
    return el;
  },

  updateSvgElement(el: SVGElement, voice: Voice): void {
    setAttrs(el, triangleAttrs(voice));
  },

  handlePositions(voice: Voice): [HandleType, number, number][] {
    const r = voice.size / 2;
    const positions: [HandleType, number, number][] = [];
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
      const px = voice.x + Math.cos(angle) * r;
      const py = voice.y + Math.sin(angle) * r;
      const handle: HandleType = i === 0 ? 'n' : i === 1 ? 'se' : 'sw';
      positions.push([handle, px, py]);
    }
    return positions;
  },

  buildAudioGraph(
    ctx: AudioContext,
    voice: Voice,
    shared: AudioSharedNodes,
  ): AudioVoice {
    const timbre = 'timbre' in voice ? voice.timbre : 0;
    const freq = yToFrequency(voice.y);
    const oscSaw = new OscillatorNode(ctx, { type: 'sawtooth', frequency: freq });
    const oscTri = new OscillatorNode(ctx, { type: 'triangle', frequency: freq });
    const gainSaw = new GainNode(ctx);
    const gainTri = new GainNode(ctx);

    const mix = 1 - Math.abs(timbre - 0.5) * 2;
    gainTri.gain.value = Math.sin((mix * Math.PI) / 2);
    gainSaw.gain.value = Math.cos((mix * Math.PI) / 2);

    oscSaw.connect(gainSaw);
    oscTri.connect(gainTri);
    gainSaw.connect(shared.gain);
    gainTri.connect(shared.gain);

    return {
      ...shared,
      shapeId: voice.id,
      outputNode: shared.panner,
      warmthShaper: undefined,
      hasSweep: false,
      start(time: number) {
        oscSaw.start(time);
        oscTri.start(time);
        if (shared.octaveOsc) {
          try { shared.octaveOsc.start(time); } catch {}
        }
      },
      stop(_time: number) {
        safeStop(oscSaw);
        safeStop(oscTri);
        if (shared.octaveOsc) safeStop(shared.octaveOsc);
      },
      updateParams(voice: Voice, now: number) {
        const timbre = 'timbre' in voice ? voice.timbre : 0;
        const freq = yToFrequency(voice.y);
        oscSaw.frequency.setValueAtTime(freq, now);
        oscTri.frequency.setValueAtTime(freq, now);
        const mix = 1 - Math.abs(timbre - 0.5) * 2;
        gainTri.gain.setValueAtTime(Math.sin((mix * Math.PI) / 2), now);
        gainSaw.gain.setValueAtTime(Math.cos((mix * Math.PI) / 2), now);
      },
      getModulatorNode() { return oscSaw; },
      getCarrierFrequencyParams() {
        const params: AudioParam[] = [oscSaw.frequency, oscTri.frequency];
        if (shared.octaveOsc) params.push(shared.octaveOsc.frequency);
        return params;
      },
    };
  },

  createVoice(base: VoiceBase): Voice {
    return { ...base, waveform: 'blend', timbre: normalizedCoord(0) } as Voice;
  },

  packExtra(voice: Voice): string {
    if (!('timbre' in voice)) return '';
    return encodeInt(round3(voice.timbre) * 1000, 2);
  },

  unpackExtra(str: string, idx: number) {
    const timbre = decodeInt(str, idx, 2) / 1000;
    return { fields: { timbre: normalizedCoord(timbre) }, bytesRead: 2 };
  },
};

export default blend;
```

- [ ] **Step 6: Create `js/waveforms/index.ts`**

```typescript
// js/waveforms/index.ts
import type { WaveformType } from '../types.ts';
import type { WaveformStrategy } from './types.ts';
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

export type { AudioSharedNodes, AudioVoice, WaveformStrategy } from './types.ts';
```

- [ ] **Step 8: Run typecheck and tests**

Run: `bun run check && bun test tests/unit/waveform-registry.test.js`
Expected: typecheck PASS, registry tests PASS

- [ ] **Step 9: Run full test suite**

Run: `bun run test:unit`
Expected: all existing tests still pass (no consumers changed yet)

- [ ] **Step 10: Commit**

```bash
git add js/waveforms/ tests/unit/waveform-registry.test.js js/audio/voice-builder.ts js/serialize.ts
git commit -m "Implement waveform strategy registry with sine, pulse, blend strategies"
```

---

## Chunk 2: Migrate Consumer Files

### Task 3: Migrate state.ts and shapes.ts

**Files:**
- Modify: `js/state.ts:39-61` (createVoice)
- Modify: `js/shapes.ts:78-85` (voiceRotation)

These are the simplest migrations — one switch each, no DOM or audio.

- [ ] **Step 1: Migrate `createVoice` in state.ts**

Replace the switch block (lines 39-61) with:

```typescript
import { getStrategy } from './waveforms/index.ts';

function createVoice(waveform: WaveformType, x: NormalizedCoord, y: NormalizedCoord): Voice {
  const base: VoiceBase = {
    blend: DEFAULT_BLEND,
    border: undefined as Voice['border'],
    effect: undefined as Voice['effect'],
    fill: createRandomFill(),
    id: genId('v'),
    size: normalizedCoord(0.25),
    x,
    y,
  };
  return getStrategy(waveform).createVoice(base);
}
```

- [ ] **Step 2: Migrate `voiceRotation` in shapes.ts**

Replace the if/else block (lines 78-85) with:

```typescript
import { getStrategy } from './waveforms/index.ts';

export function voiceRotation(voice: Voice): number {
  if (!('timbre' in voice)) return 0;
  const period = getStrategy(voice.waveform).rotationPeriod;
  return Math.min(1, Math.max(0, voice.timbre)) * period;
}
```

- [ ] **Step 3: Run affected tests**

Run: `bun test tests/unit/state.test.js tests/unit/shapes.test.js`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `bun run test:unit`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add js/state.ts js/shapes.ts
git commit -m "Migrate state.ts and shapes.ts to waveform strategy registry"
```

### Task 4: Migrate render.ts

**Files:**
- Modify: `js/canvas/render.ts:1-10,90-169,383-436,496`

Replace 5 switch blocks and the rotation handle check. The helper functions
`circleAttrs`, `rectAttrs`, `trianglePoints` are now dead code (moved to
strategy files) — delete them.

- [ ] **Step 1: Replace imports and delete shape geometry helpers**

Add import: `import { getStrategy } from '../waveforms/index.ts';`

Delete functions: `circleAttrs` (lines 90-93), `rectAttrs` (lines 95-103),
`trianglePoints` (lines 105-115).

Remove `waveformShape` from the types import.

- [ ] **Step 2: Replace `createShapeElement` (lines 117-136)**

```typescript
function createShapeElement(voice: Voice): SVGElement {
  return getStrategy(voice.waveform).createSvgElement(voice);
}
```

- [ ] **Step 3: Replace `updateShapeElement` (lines 138-154)**

```typescript
function updateShapeElement(el: SVGElement, voice: Voice): void {
  getStrategy(voice.waveform).updateSvgElement(el, voice);
}
```

- [ ] **Step 4: Replace `shapeTagName` (lines 156-169)**

```typescript
function shapeTagName(voice: Voice): string {
  return getStrategy(voice.waveform).svgTag;
}
```

- [ ] **Step 5: Replace `createShapeOutline` (lines 383-402)**

```typescript
function createShapeOutline(voice: Voice): SVGElement {
  return getStrategy(voice.waveform).createSvgElement(voice);
}
```

- [ ] **Step 6: Replace `shapeHandlePositions` (lines 404-436)**

```typescript
function shapeHandlePositions(voice: Voice): [HandleType, number, number][] {
  return getStrategy(voice.waveform).handlePositions(voice);
}
```

- [ ] **Step 7: Replace rotation handle check (line 496)**

Change `if (voice.waveform !== 'sine')` to
`if (getStrategy(voice.waveform).hasTimbre)`.

- [ ] **Step 8: Run tests**

Run: `bun run check && bun run test:unit`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add js/canvas/render.ts
git commit -m "Migrate render.ts to waveform strategy registry"
```

### Task 5: Migrate serialize.ts

**Files:**
- Modify: `js/serialize.ts:141-170,236-307`

Replace waveform ternaries in `packVoice` and `unpackB64` with strategy calls.
Export B64 helpers (`encodeInt`, `decodeInt`, `round3`) so strategy files can
import them instead of duplicating.

B64 helpers (`encodeInt`, `decodeInt`, `round3`) were already exported in
Task 2 Step 1. Strategy files import them directly — no duplication.

- [ ] **Step 1: Migrate `packVoice` waveform encoding (lines 141-170)**

Replace lines 144-145 and 168-170:

```typescript
import { getStrategy, ALL_STRATEGIES } from './waveforms/index.ts';

function packVoice(v: Voice): string {
  let out = '';
  let flags = 0;
  const strategy = getStrategy(v.waveform);
  const wf = strategy.serializationIndex;
  flags |= (wf & 0x3) << 10;
  // ... rest of flags unchanged ...

  out += encodeInt(flags, 2);
  out += encodeInt(round3(v.x) * 1000, 2);
  out += encodeInt(round3(v.y) * 1000, 2);
  out += encodeInt(round3(v.size) * 1000, 2);

  out += strategy.packExtra(v);

  // border and fill encoding unchanged...
```

- [ ] **Step 2: Migrate `unpackB64` waveform decoding (lines 236-307)**

Replace waveform index lookup and voice construction:

```typescript
  const wf = (flags >> 10) & 0x3;
  const strategy = ALL_STRATEGIES[wf];
  // ... x, y, size decoding unchanged ...

  // Note: in the current serialization format, `hasTimbre` is equivalent to
  // `serializationIndex > 0`. If a future waveform has serializationIndex > 0
  // but no timbre, the serialization format will need a revision. This is
  // acceptable since CLAUDE.md says "no backwards compatibility until v1."
  let extraFields = {};
  if (strategy.hasTimbre) {
    const result = strategy.unpackExtra(str, idx);
    extraFields = result.fields;
    idx += result.bytesRead;
  }

  // ... border, fill decoding unchanged ...

  const base = { id: genId('v'), x, y, size, fill, effect, blend, border };
  voices.push({ ...strategy.createVoice(base), ...extraFields } as Voice);
```

- [ ] **Step 3: Run serialization tests**

Run: `bun test tests/unit/serialize.test.js`
Expected: PASS — serialization format is unchanged

- [ ] **Step 4: Run full test suite**

Run: `bun run check && bun run test:unit`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add js/serialize.ts
git commit -m "Migrate serialize.ts to waveform strategy registry"
```

### Task 6: Migrate voice-builder.ts and engine.ts

**Files:**
- Modify: `js/audio/voice-builder.ts:1-371`
- Modify: `js/audio/engine.ts:570-605`

This is the largest migration. Replace the `buildVoice` waveform branches with
strategy delegation, replace the AudioVoice discriminated union with the new
uniform interface, and remove the free `getModulatorNode` /
`getCarrierFrequencyParams` functions.

- [ ] **Step 1: Refactor `buildVoice` in voice-builder.ts**

Keep the shared plumbing (lines 116-218), replace lines 220-337 with strategy
delegation. Delete the `AudioVoice` discriminated union types (lines 14-59)
and re-export from waveforms. Delete `getModulatorNode` (lines 342-351) and
`getCarrierFrequencyParams` (lines 354-371).

The refactored `buildVoice`:

```typescript
import { getStrategy } from '../waveforms/index.ts';
import type { AudioVoice, AudioSharedNodes } from '../waveforms/types.ts';

// Re-export for consumers
export type { AudioVoice } from '../waveforms/types.ts';

export function buildVoice(
  ctx: AudioContext,
  voice: Voice,
  masterGain: GainNode,
  createPatternEffect: (ctx: AudioContext, effect: PatternType) => AudioEffect | undefined,
): AudioVoice {
  const gain = new GainNode(ctx, { gain: vibe.voiceGain(voice.waveform, voice.size) });
  const freq = yToFrequency(voice.y);

  // Dual formant filter bank + brightness shelf
  const formantF1 = new BiquadFilterNode(ctx, { type: 'bandpass' });
  const formantF2 = new BiquadFilterNode(ctx, { type: 'bandpass' });
  const formantMixer = new GainNode(ctx, { gain: vibe.formantMix });
  const brightness = new BiquadFilterNode(ctx, { type: 'lowpass', Q: vibe.brightnessQ });
  applyFormantFilter(formantF1, formantF2, brightness, voice.fill, voice.waveform);

  const panner = new StereoPannerNode(ctx, { pan: vibe.xToPan(voice.x) });

  // Wire: gain -> F1 -> mixer -> brightness -> [effect] -> panner -> master
  gain.connect(formantF1);
  gain.connect(formantF2);
  formantF1.connect(formantMixer);
  formantF2.connect(formantMixer);
  formantMixer.connect(brightness);

  let lastNode: AudioNode = brightness;
  let effectDispose;
  if (voice.effect) {
    const effect = createPatternEffect(ctx, voice.effect);
    if (effect) {
      lastNode.connect(effect.input);
      lastNode = effect.output;
      effectDispose = effect.dispose;
    }
  }
  lastNode.connect(panner);
  panner.connect(masterGain);

  // Octave doubling
  let octaveOsc: OscillatorNode | undefined;
  let octaveGainNode: GainNode | undefined;
  if (voice.border) {
    const strategy = getStrategy(voice.waveform);
    const octaveShift = voice.border.double ? 2 : 1;
    const direction = voice.border.color === 'white' ? 1 : -1;
    const octaveFreq = freq * 2 ** (direction * octaveShift);
    octaveOsc = new OscillatorNode(ctx, {
      type: strategy.oscillatorType,
      frequency: octaveFreq,
    });
    octaveGainNode = new GainNode(ctx, {
      gain: vibe.borderOctaveGain(
        voice.waveform, voice.size,
        voice.border.thickness, voice.border.color, voice.border.double,
      ),
    });
    octaveOsc.connect(octaveGainNode);
    octaveGainNode.connect(formantMixer);
  }

  const borderKey = voice.border
    ? `${voice.border.color}:${voice.border.double ? 1 : 0}`
    : undefined;

  const shared: AudioSharedNodes = {
    ctx,
    gain,
    formantF1, formantF2, formantMixer, brightness,
    panner,
    octaveOsc, octaveGainNode,
    effectDispose,
    currentEffect: voice.effect,
    currentBlend: voice.blend,
    currentBorder: borderKey,
    currentFillKey: fillToKey(voice.fill),
  };

  return getStrategy(voice.waveform).buildAudioGraph(ctx, voice, shared);
}
```

- [ ] **Step 2: Update engine.ts to use bound methods**

In `_updateVoices()` (around line 587), replace the waveform switch with:

```typescript
audioVoice.updateParams(voice, now);
```

Delete the entire `switch (audioVoice.waveform)` block (lines 587-605).

Update any imports: replace `AudioVoice` import source from
`'./voice-builder.ts'` to `'../waveforms/types.ts'` (or from the re-export).

Replace free-function calls with bound method calls at these specific sites:

- Line 823: `getModulatorNode(modulatorAudio)` → `modulatorAudio.getModulatorNode()`
- Line 858: `getModulatorNode(modulatorAudio)` → `modulatorAudio.getModulatorNode()`
- Line 859: `getCarrierFrequencyParams(carrierAudio)` → `carrierAudio.getCarrierFrequencyParams()`

Remove imports of `getModulatorNode` and `getCarrierFrequencyParams` from the
import block (lines 20-21).

- [ ] **Step 3: Run tests**

Run: `bun run check && bun run test:unit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add js/audio/voice-builder.ts js/audio/engine.ts
git commit -m "Migrate voice-builder.ts and engine.ts to waveform strategy registry"
```

### Task 7: Migrate audio support files

**Files:**
- Modify: `js/audio/vibe.ts:139-143,185-204`
- Modify: `js/audio/formants.ts:93-95`
- Modify: `js/audio/mapping.ts:108-133`

- [ ] **Step 1: Migrate `vibe.ts`**

Replace `shapeAreaFraction` switch (lines 194-204):

```typescript
import { getStrategy } from '../waveforms/index.ts';

shapeAreaFraction(waveform: WaveformType, size: number): number {
  const half = size / 2;
  return getStrategy(waveform).shapeAreaCoeff * half * half;
}
```

Replace `GAIN_EXPONENT` initialization (lines 139-143):

```typescript
import { ALL_STRATEGIES } from '../waveforms/index.ts';

// In constructor:
this.GAIN_EXPONENT = {} as Record<WaveformType, number>;
for (const s of ALL_STRATEGIES) {
  this.GAIN_EXPONENT[s.waveform] = opts?.exponents?.[s.waveform]
    ?? VIBE_DEFAULTS.exponents[s.waveform]
    ?? VIBE_DEFAULTS.exponents.sine;  // fallback for new waveforms
}
```

Replace `WAVEFORM_GAIN` initialization (lines 185-190):

```typescript
const refVoiceGain = this.refMult * this.areaToGain('sine', 0.5);
this.WAVEFORM_GAIN = {} as Record<WaveformType, number>;
this.WAVEFORM_GAIN['sine'] = this.refMult;
for (const s of ALL_STRATEGIES) {
  if (s.waveform !== 'sine') {
    this.WAVEFORM_GAIN[s.waveform] = refVoiceGain / this.areaToGain(s.waveform, 0.5);
  }
}
```

- [ ] **Step 2: Migrate `formants.ts`**

Replace line 94:

```typescript
import { getStrategy } from '../waveforms/index.ts';

export function computeFormantQ(saturation: number, waveform: WaveformType = 'pulse'): number {
  const maxQ = getStrategy(waveform).formantMaxQ;
  return (1 + (saturation / 100) * maxQ) * vibe.formantQ;
}
```

- [ ] **Step 3: Migrate `mapping.ts`**

Delete `WAVEFORM_PERIOD` record (lines 108-112). Replace `rotationToTimbre`,
changing the parameter type from `string` to `WaveformType`:

```typescript
import { getStrategy } from '../waveforms/index.ts';

export function rotationToTimbre(rotation: number, waveform: WaveformType): number {
  const period = getStrategy(waveform).rotationPeriod;
  if (!period) return 0;
  const phase = ((rotation % period) + period) % period;
  return phase / period;
}
```

- [ ] **Step 4: Run tests**

Run: `bun run check && bun test tests/unit/vibe.test.js tests/unit/audio-mapping.test.js`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `bun run test:unit`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add js/audio/vibe.ts js/audio/formants.ts js/audio/mapping.ts
git commit -m "Migrate vibe.ts, formants.ts, mapping.ts to waveform strategy registry"
```

### Task 8: Migrate interaction.ts, app.ts, harmony.ts

**Files:**
- Modify: `js/canvas/interaction.ts:97-101,467,535`
- Modify: `js/app.ts:239-244`
- Modify: `js/harmony.ts:166`

- [ ] **Step 1: Migrate `toolToWaveform` in interaction.ts (lines 97-101)**

```typescript
import { ALL_STRATEGIES, getStrategy } from '../waveforms/index.ts';

const toolToWaveform = new Map(
  ALL_STRATEGIES.map(s => [s.shapeName, s.waveform] as const)
);
```

Update usages to use `.get()` instead of bracket access.

- [ ] **Step 2: Migrate rotation guards in interaction.ts**

Line 467: `if (voice.waveform === 'sine')` →
`if (!getStrategy(voice.waveform).hasTimbre)`

Line 535: `if (voice.waveform === 'sine')` →
`if (!getStrategy(voice.waveform).hasTimbre)`

- [ ] **Step 3: Migrate `toolToWaveform` in app.ts (lines 239-244)**

The current `toolToWaveform` is defined inside the `addVoiceFromTool` callback
(line 239). Hoist it to module scope and derive from the registry:

```typescript
import { ALL_STRATEGIES } from './waveforms/index.ts';

const toolToWaveform = new Map(
  ALL_STRATEGIES.map(s => [s.shapeName, s.waveform] as const)
);
```

Update the usage at line 244 to `.get(tool)`.

- [ ] **Step 4: Migrate `WAVEFORMS` in harmony.ts (line 166)**

```typescript
import { ALL_STRATEGIES } from './waveforms/index.ts';

const WAVEFORMS = ALL_STRATEGIES.map(s => s.waveform);
```

- [ ] **Step 5: Run full test suite and typecheck**

Run: `bun run check && bun run test:unit`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add js/canvas/interaction.ts js/app.ts js/harmony.ts
git commit -m "Migrate interaction.ts, app.ts, harmony.ts to waveform strategy registry"
```

---

## Chunk 3: Cleanup and Verification

### Task 9: Delete dead code

**Files:**
- Modify: `js/types.ts:204-221` (delete `waveformShape`)
- Modify: `js/audio/voice-builder.ts` (delete old AudioVoice types, old free functions)
- Modify: `js/canvas/render.ts` (remove stale `waveformShape` import)

- [ ] **Step 1: Delete `waveformShape()` from types.ts (lines 204-221)**

Remove the function and its JSDoc. Verify no remaining imports of
`waveformShape` anywhere:

Run: `grep -r "waveformShape" js/`
Expected: no results

- [ ] **Step 2: Delete old AudioVoice types from voice-builder.ts**

The discriminated union types (`SineAudioVoice`, `SquareAudioVoice`,
`TriangleAudioVoice`, `AudioVoice`, `AudioVoiceBase`) should already be gone
from Task 6. Verify:

Run: `grep -n "SineAudioVoice\|SquareAudioVoice\|TriangleAudioVoice\|AudioVoiceBase" js/audio/voice-builder.ts`
Expected: no results

- [ ] **Step 3: Verify no remaining waveform switches in consumer files**

Run: `grep -n "waveformShape\|voice\.waveform === \|switch.*waveform\|WAVEFORM_PERIOD" js/audio/voice-builder.ts js/canvas/render.ts js/audio/engine.ts js/serialize.ts js/state.ts js/shapes.ts js/audio/vibe.ts js/audio/formants.ts js/audio/mapping.ts js/canvas/interaction.ts js/app.ts js/harmony.ts`

Expected: no switch/case or if/else on waveform in these files (except
`getStrategy(voice.waveform)` calls). The only remaining `voice.waveform`
references should be property access for `getStrategy()`.

- [ ] **Step 4: Run full test suite**

Run: `bun run check && bun run test:unit`
Expected: all PASS

- [ ] **Step 5: Run integration tests**

Run: `bun run test:e2e`
Expected: all PASS

- [ ] **Step 6: Build**

Run: `bun run build`
Expected: successful production build

- [ ] **Step 7: Commit**

```bash
git add js/types.ts js/audio/voice-builder.ts js/canvas/render.ts
git commit -m "Delete dead waveform dispatch code"
```

### Task 10: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update Project Structure section**

Add `js/waveforms/` to the file tree:

```
  js/
    waveforms/
      types.ts         WaveformStrategy, AudioVoice, AudioSharedNodes interfaces
      index.ts         Registry: getStrategy(), ALL_STRATEGIES
      sine.ts          Sine waveform strategy (circle, sine osc)
      pulse.ts         Pulse waveform strategy (square, PWM osc)
      blend.ts         Blend waveform strategy (triangle, saw/tri crossfade)
```

- [ ] **Step 2: Update "When Making Changes" section**

Replace the "To add a new waveform/shape" recipe with:

```
- To add a new waveform/shape: create `js/waveforms/<name>.ts` implementing
  `WaveformStrategy` (see existing files for the pattern). Add one import +
  one map entry in `js/waveforms/index.ts`. The strategy must provide SVG
  rendering, audio graph construction, serialization, state factory, and
  handle positions. Add a variant to the Voice union in `types.ts`. The new
  variant MUST map every field to both a visual and audio interpretation.
  Update `index.html` to add a toolbar button.
```

- [ ] **Step 3: Update Code Conventions section**

Add a note about the strategy registry pattern. Remove or update any
references to `waveformShape()`. Update the `AudioVoice` description:
the discriminated union with `SineAudioVoice | SquareAudioVoice |
TriangleAudioVoice` is replaced by a uniform `AudioVoice` interface with
bound methods.

- [ ] **Step 4: Update Project Structure description for voice-builder.ts**

Change description from "Voice audio graph construction (oscillators, effects,
borders)" to "Voice audio graph shared plumbing (formants, effects, borders);
delegates oscillator construction to waveform strategies".

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "Update CLAUDE.md for waveform strategy registry"
```

### Task 11: Final verification

- [ ] **Step 1: Run full CI-equivalent check**

```bash
bun run check && bun run lint && bun run test:unit && bun run test:e2e && bun run build
```

Expected: all PASS

- [ ] **Step 2: Review diff for orphaned comments or dead code**

Run: `git diff main --stat` to see all changed files.
Scan for comments referencing old patterns (`waveformShape`, `oscTypeMap`,
`AudioVoiceBase`, `SineAudioVoice`, etc.).

- [ ] **Step 3: Verify the "one file to add a waveform" goal**

Mentally trace what you'd need to do to add a "trapezoid" waveform:
1. Create `js/waveforms/trapezoid.ts` — strategy file
2. Add to `js/waveforms/index.ts` — one import + one map entry
3. Add `TrapezoidVoice` to Voice union in `types.ts`
4. Add toolbar button in `index.html`
5. Update tutorial if desired

No other files should need waveform-specific changes. If any do, the refactor
missed something — go back and fix it.
