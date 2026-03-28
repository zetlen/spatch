# Global Blend Mode Design

## Problem

Per-voice blend mode violates the bijection principle. Two voices with different
blend modes but no overlap look identical yet have different serialized state.
The FM synthesis concept (cross-voice frequency modulation when shapes overlap)
is sound, but tying it to a per-voice field creates non-bijective states.

## Solution

Replace per-voice `blend: BlendMode` with a **global sigil-level** blend mode.
The blend mode is a property of the entire sigil, serialized in the URL header.
When any shapes overlap, the global blend mode determines both the CSS
`mix-blend-mode` applied to overlapping voice groups and the FM synthesis
character for all overlapping pairs.

### Overlap tracking and auto-reset

After every voice position or size mutation, recompute whether any pair of
voices overlaps. When overlap disappears, auto-reset `blend` to `screen` in
the store (and URL). This ensures a non-screen blend mode never exists without
overlap to manifest it, preserving bijection.

When no overlap exists, the blend mode toolbar control is disabled. When
overlap reappears, the control re-enables at the default `screen`. There is no
need to recall the previously set blend mode.

## Blend Modes

Four modes, fitting in 2 bits. Ordered from clean to intense — visual and
audio intensity escalate together.

| Index | CSS mode      | maxIndex | Curve       | Feedback | Character     |
|-------|---------------|----------|-------------|----------|---------------|
| 0     | `screen`      | 0        | —           | 0        | clean, no FM  |
| 1     | `multiply`    | 0.6      | exponential | 0        | gentle darken |
| 2     | `exclusion`   | 1.2      | linear      | 0        | medium invert |
| 3     | `difference`  | 1.8      | linear      | 0.2      | intense ring  |

All four are commutative CSS blend modes — swap the DOM order of two
overlapping shapes and the overlap pixel is identical.

`screen` remains the default (no FM, no visual blend effect beyond normal
compositing). `multiply` is visually subtle (darkens overlaps); `exclusion`
is a softer inversion than `difference`; `difference` is the most dramatic.

## Type Changes

### Remove from VoiceBase

```ts
// BEFORE
export interface VoiceBase {
  id: string;
  x: NormalizedCoord;
  y: NormalizedCoord;
  size: NormalizedCoord;
  fill: Fill;
  effect: PatternType | undefined;
  blend: BlendMode;           // ← remove
  border: Border | undefined;
}
```

### Add to SigilData

```ts
export interface SigilData {
  envelope: Envelope;
  voices: Voice[];
  scene: number;
  blend: BlendMode;  // ← add (global)
}
```

### Update BLEND_MODES

```ts
export const BLEND_MODES = ['screen', 'multiply', 'exclusion', 'difference'] as const;
```

Replaces `['screen', 'multiply', 'difference']`. The `exclusion` mode is new.

## Serialization

### Header repacking

The existing scene char is 6 bits (1 B64 char) but only uses ~4 bits (12
scenes, index 0–11). Pack global blend into the top 2 bits:

```
Scene char: [blend(2b) | scene(4b)]
```

**Backwards compatibility**: Existing v2 URLs have scene indices 0–11, so the
top 2 bits are always 0. Decoding `(char >> 4) & 0x3` yields 0 = `screen`,
which is the correct default. No schema version bump required.

Pack: `encodeInt((blendIndex << 4) | scene, 1)`
Unpack: `blend = BLEND_MODES[(val >> 4) & 0x3]`, `scene = val & 0xf`

### Per-voice SP5 changes

SP5 currently packs `effect(5b) + blend(3b) + spare(4b)`. Remove the blend
field. New layout: `effect(5b) + spare(7b)`. The freed bits are available for
future fields (e.g. tone parameter from issue backlog).

The 2-char SP5 width is preserved (no change to register widths). Pack/unpack
changes only touch the blend bits — effect stays at the same bit position.

## Overlap Tracking

### Where it happens

Overlap is already computed in two places:

1. **render.ts** `reconcileVoices()` — builds an `overlapping` set each frame
2. **engine.ts** `_syncFMConnections()` — computes pairwise overlap for FM

Add a third computation in the **store** (or a thin wrapper) that runs after
any voice position/size mutation and exposes a `hasOverlap` boolean:

```ts
// In SigilStore or a new OverlapManager
private _recomputeOverlap(): void {
  const voices = this._data.value.voices;
  for (let i = 0; i < voices.length; i++) {
    for (let j = i + 1; j < voices.length; j++) {
      if (computeOverlap(
        voices[i].x, voices[i].y, voices[i].size,
        voices[j].x, voices[j].y, voices[j].size
      ) > 0) {
        this._hasOverlap.value = true;
        return;
      }
    }
  }
  // No overlap — auto-reset blend to screen
  if (this._data.value.blend !== 'screen') {
    this._data.value = { ...this._data.value, blend: 'screen' };
  }
  this._hasOverlap.value = false;
}
```

This runs inside `updateVoice` (when x/y/size change), `addVoice`,
`removeVoice`, `pasteVoice`, and `loadState`. It's O(n^2) in voice count but
n <= ~20 in practice so it's trivially fast.

### Signal for UI

`hasOverlap` is a `Signal<boolean>` on `SigilStore`. The toolbar subscribes
to it to enable/disable the blend mode control.

## Audio Engine Changes

### FM connection source

`_syncFMConnections` currently reads `modulatorData.blend` (per-voice) to
look up `FM_PARAMS`. Change to read the global blend from the sigil state:

```ts
const params = FM_PARAMS[sigilState.blend];
if (params.maxIndex <= 0) return; // screen — skip all FM
```

This is a simplification: when blend is `screen`, skip the entire FM loop.
When blend is non-screen, all overlapping pairs use the same FM params.

### Blend change detection

Currently `engine.ts` tears down and rebuilds a voice when
`voice.blend !== audioVoice.currentBlend`. Replace this with a global blend
change check: when the sigil-level blend changes, rebuild all FM connections
(tear down existing, create new with updated params). No per-voice rebuild
needed — the oscillator graph doesn't change, only the FM routing.

Remove `currentBlend` from `AudioSharedNodes` and `AudioVoice`.

### FM_PARAMS update

```ts
export const FM_PARAMS: Record<BlendMode, FMParams> = {
  screen:     { maxIndex: 0,   depthCurve: 'linear',      feedback: 0,   lfoRate: 0 },
  multiply:   { maxIndex: 0.6, depthCurve: 'exponential',  feedback: 0,   lfoRate: 0 },
  exclusion:  { maxIndex: 1.2, depthCurve: 'linear',      feedback: 0,   lfoRate: 0 },
  difference: { maxIndex: 1.8, depthCurve: 'linear',      feedback: 0.2, lfoRate: 0 },
};
```

## Render Changes

`reconcileVoice` currently applies:
```ts
group.style.mixBlendMode = hasOverlap ? voice.blend : DEFAULT_BLEND;
```

Change to read the global blend from state:
```ts
group.style.mixBlendMode = hasOverlap ? state.blend : 'screen';
```

The `render()` function already receives the full `SigilData`. The overlap
set computation in `reconcileVoices` stays unchanged — it determines which
individual voice groups get the blend mode applied.

## Toolbar Changes

### Remove from fill panel

Remove the two blend buttons (`blend:multiply`, `blend:difference`) and their
separator from the fill panel's `items()` array. Remove the `blend:*` key
handling from `isActive()` and `onClick()`.

### New global blend control

Add a blend mode button to the global toolbar area (near harmonize/stage
buttons). This button:

- Shows the current blend mode icon (or a default icon when screen)
- Is disabled (dimmed) when `hasOverlap` is false
- Opens a small panel or cycles through modes on click
- Updates `store.updateBlend(mode)` which triggers URL save + audio sync

The button needs an `id` for the tutorial punchOut (`#btn-blend` — currently
referenced in tutorial.ts but missing from HTML).

Icon suggestions: use existing tabler icons. `tabler-layers-intersect` or
similar for the blend button; individual mode icons inside the panel.

## Store Changes

### New methods

```ts
updateBlend(blend: BlendMode): void {
  this._data.value = { ...this._data.value, blend };
}
```

### createDefaultState update

```ts
export function createDefaultState(): SigilData {
  return {
    envelope: { attack: 0.1, decay: 0.2, release: 0.4, sustain: 0.7 },
    scene: 0,
    blend: 'screen',
    voices: [],
  };
}
```

## Harmony/Randomizer Changes

`randomize()` in harmony.ts currently sets a random per-voice blend mode.
Remove the per-voice `blend` from the random voice updates. Optionally set a
random global blend when randomizing:

```ts
// Random global blend (only if voices will overlap)
store.updateBlend(BLEND_MODES[Math.floor(Math.random() * BLEND_MODES.length)]!);
```

Since randomize places 5 voices in the 0.1–0.9 range with sizes 0.1–0.45,
overlap is likely but not guaranteed. The overlap tracker will auto-reset to
screen if no overlap exists after randomization.

## Tutorial Changes

The blend tutorial step (around line 348) currently:
1. Sets up demo voices spread apart
2. Moves them together with per-voice `blend: 'multiply'`
3. Switches all to `blend: 'difference'`

Update to use the global blend:
1. Set up demo voices spread apart (same)
2. Move them together, then `store.updateBlend('multiply')`
3. Switch to `store.updateBlend('exclusion')` then `store.updateBlend('difference')`

The punchOut `#btn-blend` will now point to the real global blend button.

## Test Changes

### Delete

- `tests/unit/blend-visual.test.js` — tests per-voice blend distinctness;
  the new global blend has different semantics (single mode applied globally).
- `tests/integration/blend-combinations.test.js` — tests cross-mode pairs
  which no longer exist (all voices share one mode).

### New tests

- **Unit: global blend serialization** — round-trip each blend mode through
  pack/unpack. Verify old URLs (blend bits = 0) decode as `screen`.
- **Unit: overlap auto-reset** — verify that removing overlap resets blend to
  `screen` in the store.
- **Unit: FM params** — verify `FM_PARAMS` entries for all 4 modes; test
  `computeFMDepth` with the new params.
- **Unit: blend visual distinctness** — same concept as the old test but with
  4 global modes instead of per-voice pairs. Each mode produces a distinct
  overlap color.
- **Integration: global blend e2e** — create overlapping shapes, cycle through
  blend modes, verify visual and audio changes.

### Update

- `tests/unit/serialize.test.js` / `serialize-v2.test.js` — update voice
  fixtures to remove per-voice blend; add global blend header tests.
- `tests/unit/state.test.js` — test `updateBlend()`, overlap tracking.
- `tests/unit/canvas-render.test.js` — if it tests blend application.
- `tests/unit/audio-engine.test.js` — FM connection tests use global blend.
- Any test creating Voice objects — remove `blend` field.

## Files Changed

| File | Change |
|------|--------|
| `js/types.ts` | Remove `blend` from `VoiceBase`; add `blend` to `SigilData`; update `BLEND_MODES` (add `exclusion`) |
| `js/effects.ts` | Update `FM_PARAMS` (4 modes, new values); remove `DEFAULT_BLEND` export |
| `js/state.ts` | Add `blend: 'screen'` to default state; add `updateBlend()`; add overlap tracking (`_recomputeOverlap`, `hasOverlap` signal); call recompute in mutation methods |
| `js/serialize.ts` | Repack scene char as `blend(2b)\|scene(4b)`; update pack/unpack |
| `js/voices/serializers/oscillator.ts` | Remove blend from SP5 pack/unpack |
| `js/voices/serializers/sample.ts` | Inherits oscillator changes |
| `js/voices/types.ts` | Remove `currentBlend` from `AudioSharedNodes` and `AudioVoice` |
| `js/audio/voice-builder.ts` | Remove `currentBlend` from shared nodes |
| `js/audio/engine.ts` | Read global blend for FM params; remove per-voice blend change detection; rebuild FM on global blend change |
| `js/canvas/render.ts` | Read global blend from state instead of per-voice; remove `DEFAULT_BLEND` import |
| `js/toolbar/fill-panel.ts` | Remove blend buttons and key handlers |
| `js/toolbar/toolbar.ts` | Add global blend button/panel |
| `js/harmony.ts` | Remove per-voice blend from randomizer; optionally set global blend |
| `js/tutorial.ts` | Update blend step to use global blend; fix punchOut target |
| `index.html` | Add `#btn-blend` button to global toolbar area |
| `tests/unit/blend-visual.test.js` | Rewrite for global 4-mode distinctness |
| `tests/integration/blend-combinations.test.js` | Delete (cross-mode pairs no longer exist) |
| Tests (various) | Remove per-voice blend from Voice fixtures; add global blend tests |
