# Inset Shadows for Master Reverb

The canvas frame gains an inset shadow that maps to master reverb. The shadow
lives on the canvas frame (not per-shape), so reverb is a global effect on
the master output.

## Data Model

New optional field on `SigilData` (alongside `envelope`):

```ts
reverb: {
  depth: NormalizedCoord;   // 0 = dry, 1 = full wet
  style: 'glow' | 'dim';   // small room vs arena
} | undefined;
```

`null` = no reverb, no shadow.

## Visual Rendering

Structural change: split the canvas element into a frame div + transparent canvas.

```
#canvas-wrap
  #canvas-frame (div) — background, border-radius, bevel border, inset box-shadow
  #sigil-canvas (canvas) — transparent background, shapes only
```

The frame div owns the dark background (#2a2a2a), ADSR corner radii, and bevel
border. The canvas becomes transparent and only draws shapes on top.

Inset shadow is CSS `box-shadow: inset` on `#canvas-frame`:

- **Glow** (small room): `inset 0 0 <blur>px rgba(255,255,255, <alpha>)`
- **Dim** (arena): `inset 0 0 <blur>px rgba(0,0,0, <alpha>)`

`depth` controls both blur radius and alpha. No offset (symmetric). Shadow
follows ADSR corner radii naturally via CSS.

## Audio — Master Reverb

ConvolverNode on the master chain with parallel dry/wet routing:

```
voices → masterGain → destination              (dry)
                    → convolver → wetGain → destination  (wet)
```

`depth` controls wet gain. Impulse response generated algorithmically:

- **Glow**: short decay (~0.3s), bright noise
- **Dim**: long decay (~2s), lowpass-filtered noise

Style change regenerates the IR buffer. Depth change updates wet gain only.

## Serialization

Top-level state array gets a new trailing element:

```
[voices[], texts[], envelope, reverb]
```

`reverb` = `0` (null) or `["G"|"D", depth]`.

## UI

Toolbar button + collapsible panel (same pattern as border):

- Depth slider (0–1)
- Glow/Dim toggle buttons (G / D)
- Remove button

Button gets `.has-reverb` class when active.

## Files Affected

- `types.ts` — add `Reverb` interface and `reverb` field to `SigilData`
- `index.html` — add `#canvas-frame` div, add reverb panel HTML, add toolbar button
- `css/style.css` — move background/border from canvas to frame, add reverb panel styles
- `canvas.ts` — clear to transparent instead of CANVAS_BG fill
- `envelope.ts` — target frame div for border-radius
- `audio.ts` — master reverb chain (ConvolverNode, wet/dry routing, IR generation)
- `serialize.ts` — pack/unpack reverb at end of state array
- `toolbar.ts` — bind reverb panel, sync to state
- `app.ts` — wire reverb updates to audio engine
- `embed-entry.ts` — apply reverb shadow on embed page

## Modules NOT Affected

- `effects.ts` — reverb is master-level, not a per-voice effect
- `VoiceBase` — no changes to voice types
- `shapes.ts` — no hit testing changes
