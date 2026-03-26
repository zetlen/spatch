# Stamp Toolbar and Trigger Point

**Date:** 2026-03-23
**Issue:** #297

## Summary

Stamps get a voice-aware toolbar that differs from oscillator voices: no border
panel, plus a stample picker and a trigger point selector. The trigger point
(Attack/Decay/Release) controls when the sample fires during the envelope and
is visually represented as a subtle tilt of the stamp SVG. The toolbar system
becomes data-driven via a panel descriptor on the voice registry entry.

## Design Decisions

### Trigger point

A 2-bit field on `StampVoice` (values 0–2, with 3 spare) selecting which
envelope phase fires the sample. The serializer already reserves these bits
in SP4.

| Value | Phase   | `source.start()` called in | Icon             |
|-------|---------|---------------------------|------------------|
| 0     | Attack  | `start(time)`             | `tabler-sword`   |
| 1     | Decay   | `onDecay(time)`           | `tabler-dental`  |
| 2     | Release | `onRelease(time)` (new)   | `tabler-prison`  |

Default: **1 (Decay)** — preserves current stamp behavior.

Sustain was considered and rejected: there is no natural call site in the
engine for "sustain onset" because ADSR is pre-scheduled via Web Audio
automation with no callback at the sustain level. Attack and Decay have
existing hooks; Release is a new hook triggered from `engine.release()`.

The trigger point affects only when the sample starts playing. It does not
change the envelope shaping for the voice.

### Visual: stamp tilt

The stamp's SVG group rotates by a small angle determined by the trigger value.
Decay (the default) is upright. Attack and Release tilt symmetrically:

| Trigger | Phase   | Tilt  |
|---------|---------|-------|
| 0       | Attack  | −5°   |
| 1       | Decay   |  0°   |
| 2       | Release | +5°   |

Applied as `transform="rotate(tilt, cx, cy)"` on the stamp `<g>` in
`stamp/ui.ts`. The hull path and hit area rotate with it. Selection handles
remain axis-aligned (computed from the rotated bounding box).

Bijection check:
- **Visual → audio:** tilt angle encodes trigger phase, no two tilts share a
  phase.
- **Symmetry:** stamp SVGs must be asymmetric enough to distinguish all three
  tilts. This is a constraint on stample design, not on the trigger system.

### Stamp voice type

```ts
export interface StampVoice extends VoiceBase {
  waveform: 'stamp';
  stamp: number;           // stample index
  trigger: 0 | 1 | 2;     // envelope trigger point (A=0, D=1, R=2)
}
```

`border` remains on `VoiceBase` (it is already `Border | undefined`). Stamp
`createVoice` must force `border: undefined` to prevent inherited borders
(e.g. from duplicating a bordered oscillator voice and changing waveform).
The serializer writes 0 for SP6, the UI never renders border strokes, and
the toolbar never shows the border panel.

The `stampsEnabled` localStorage gate (`spatch:stamps`) remains in effect.
The toolbar panel descriptor system respects this gate — stamp-specific panels
are not shown when stamps are disabled.

### Serialization

SP4 layout (unchanged from v2 format, trigger bits now active):

```
SP4 = (stampIndex & 0x7) << 3 | (trigger & 0x3) << 1 | spare
```

- Bits 5–3: stamp index (0–7)
- Bits 2–1: trigger (0–2, value 3 is spare/reserved)
- Bit 0: spare

On unpack, trigger value 3 clamps to 1 (Decay, the default).

SP6 (border) always written as 0 for stamps. No wire format change.

### Stample as editable parameter

The stample variant is a normal voice parameter, like fill or blend. Behavior:

- **On drop:** new stamp gets the last-used stample (via `defaultStampleIndex`).
  The stamp tool button shows the current default stample's silhouette.
- **During editing:** the stample picker appears as a toolbar panel when a stamp
  is selected. Changing the stample updates the selected voice and sets the new
  default for future drops.
- **The stample panel registration moves from `app.ts` into `Toolbar`.** It is
  already created via `createStamplePanel` and registered with `PanelManager`,
  but the wiring lives in `app.ts`. That registration moves into `Toolbar`'s
  constructor. The `requestRender` dependency maps to `store._notify()` and
  `onDismiss` maps to `this.panels.close()` within the Toolbar class.

### Voice-aware toolbar via registry panel descriptor

Each `VoiceRegistryEntry` declares which optional panels it uses:

```ts
export interface VoiceRegistryEntry {
  // ... existing fields ...
  panels: {
    border: boolean;
    stample: boolean;
    trigger: boolean;
  };
}
```

- **Shared panels (always shown):** fill, blend, pattern/effect.
- **Oscillator voices:** `{ border: true, stample: false, trigger: false }`
- **Stamp voice:** `{ border: false, stample: true, trigger: true }`

`Toolbar` reads the descriptor when the selected voice changes (or when the
waveform tool changes for "no selection" state). It shows/hides the border,
stample, and trigger panel buttons using the existing `.hidden` CSS class
pattern (same as `#bottom-tools` / `#bottom-props` toggling).
`syncToSelectedShape()` is updated to also sync stample and trigger panels.

The `stampsEnabled` localStorage gate is checked at runtime in the Toolbar,
not on the static registry descriptor. The Toolbar ANDs the descriptor's
`panels.stample` / `panels.trigger` with the `stampsEnabled` flag when
deciding visibility.

Panels outside this system (harmonize, stage) remain wired in `app.ts` and
are unaffected.

### Trigger panel UI

A small panel with 3 icon buttons, structurally identical to the blend panel.
Each button sets `trigger` on the selected voice and updates the SVG tilt.

Icon references for sprite scanner:
```
#tabler-sword #tabler-dental #tabler-prison
```

### AudioVoice lifecycle: `onRelease` hook

One new optional hook on `AudioVoice`:

```ts
export interface AudioVoice {
  start(time: number): void;
  stop(time: number): void;
  onDecay?(time: number): void;
  onRelease?(time: number): void;  // new
  // ... existing fields ...
}
```

`engine.release()` iterates `activeVoices` and calls `onRelease(now)` at the
start of the release phase (when the gain ramp to zero begins), before
scheduling cleanup. This is the note-off signal.

The stamp player routes `source.start(time)` based on `voice.trigger`:
- trigger=0 (A): `source.start()` inside `start()`
- trigger=1 (D): `source.start()` inside `onDecay()` (current behavior)
- trigger=2 (R): `source.start()` inside `onRelease()`

### Known acceptable gaps

- **Mid-playback voice add:** voices added during playback (via the canvas)
  call `start(now)` but not `onDecay` or `onRelease`. A stamp added
  mid-playback fires its sample immediately regardless of trigger setting.
  This matches existing behavior for `onDecay`.
- **Trigger changes during playback:** `AudioBufferSourceNode` can only be
  started once. Changing trigger on a playing stamp takes effect on the next
  play cycle, not mid-playback. The voice is not rebuilt for trigger changes.
- **`updateParams` before trigger fires:** for Release-triggered stamps, the
  source's `playbackRate` may be updated between build time and fire time if
  the user drags the voice. This is acceptable — the rate at fire time reflects
  the latest position.

## Scope

- No changes to oscillator voices (circle, square, triangle, astroid).
- No wire format version bump (bits were already reserved).
- No changes to fill, blend, pattern, or effect behavior.
- Existing stamps with trigger=0 in the URL will fire at Attack instead of the
  current Decay. Since v1 URLs are not migrated and we are pre-v1, this is
  acceptable. New stamps default to trigger=1 (Decay) to match current behavior.
- The stamps feature gate (`spatch:stamps` localStorage) is preserved.

## Files affected

### Modified
- `js/types.ts` — add `trigger` to `StampVoice`
- `js/voices/types.ts` — add `onRelease` to `AudioVoice`; add `panels` to
  `VoiceRegistryEntry`
- `js/voices/stamp/index.ts` — set `panels`, update `createVoice` default
  (trigger=1, border=undefined)
- `js/voices/stamp/ui.ts` — apply tilt transform based on `trigger`
- `js/voices/stamp/player.ts` — route `source.start` to trigger-selected hook
- `js/voices/serializers/sample.ts` — activate trigger bits in SP4 pack/unpack
- `js/voices/sine/index.ts` — add `panels: { border: true, ... }`
- `js/voices/pulse/index.ts` — same
- `js/voices/blend/index.ts` — same
- `js/voices/astroid/index.ts` — same
- `js/voices/registry.ts` — export `panels` type, no logic change
- `js/audio/engine.ts` — call `onRelease` in `release()`
- `js/toolbar/toolbar.ts` — read `panels` descriptor, show/hide panels;
  import and register stample + trigger panels
- `js/toolbar/stample-panel.ts` — adapt for Toolbar registration (thread
  dependencies from Toolbar constructor)
- `js/app.ts` — remove ad-hoc stample panel wiring
- `index.html` — add trigger panel button, add icon refs to sprite scanner

### New
- `js/toolbar/trigger-panel.ts` — 3-button A/D/R trigger picker panel
