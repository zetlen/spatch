# Solo Mode + Selection Cycling Design

**Issue**: [#135](https://got.colonpipe.org/zetlen/spatch/issues/135)
**Date**: 2026-03-10

## Overview

Two features that improve voice isolation and selection ergonomics:

1. **Solo mode** — a toggle that mutes all voices except the selected one during
   playback, for isolating what a single voice contributes.
2. **Selection cycling** — double-click (or force press) sends the topmost shape
   to the back and selects the shape behind it, solving the "covered shape is
   unselectable" problem.

## Solo Mode

### UI

- **Button**: `tabler-circle-letter-s` icon in a small circle to the right of
  the play button, inside the stage. Always visible.
- **Style**: Matches the play button's glass aesthetic (translucent background,
  drop-shadow). Active state uses latch-style glow
  (`drop-shadow(0 0 8px rgba(255,255,255,0.6))`).
- **Keyboard shortcut**: `S` key (same guard as other shortcuts — ignored when
  input is focused).

### Placement rationale

Controls inside the stage represent non-permanent UI state. The top toolbar is
for sigil-level mutations, the bottom toolbar is for individual voice properties,
and stage controls are ephemeral (play, solo). Solo fits this pattern: it is not
serialized, not undoable, and does not modify `SigilData`.

### State

- `soloActive: boolean` — ephemeral UI state at app/toolbar level.
- Not part of `SigilData`. Not serialized. Not undoable.

### Behavior

- Toggle on/off via click or `S` key.
- When on + voice selected: selected voice plays at normal gain, all others
  gain = 0.
- When on + no selection: all voices play at normal gain (solo with no target
  = no muting).
- Selection changes while solo is on: solo follows the new selection immediately.
- Solo persists across play/stop cycles.

### Audio

- `AudioEngine` gets a private `_soloVoiceId: string | undefined` field and a
  public `setSoloVoice(id: string | undefined)` method.
- In `_updateVoices()`, where per-voice gain is already set: if `_soloVoiceId`
  is defined and `voice.id !== _soloVoiceId`, set gain to 0. Otherwise use
  normal `vibe.voiceGain()`.
- On `play()`: same check applies to voices built at start.
- **FM connections stay active.** Muted voices still modulate the soloed voice's
  frequency. This lets you hear what the soloed voice sounds like *in context*
  — its output is isolated but its interactions are preserved.

### Visual feedback

- Non-soloed voice SVG groups get a `muted` CSS class.
- CSS: `opacity: 0.25; filter: saturate(0.3);` with transition for smooth
  toggle.
- `render()` receives `soloVoiceId: string | undefined` as a new parameter.
  When set, voice groups not matching the ID get the `muted` class; when
  cleared, all `muted` classes are removed.

### Data flow

```
Solo toggled on:
  soloActive = true
  needsRender = true                              (visual always applies)
  if playing: audio.setSoloVoice(selection.voiceId) (audio only if playing)

Selection changes while solo active:
  effect() detects selection change
  if soloActive: audio.setSoloVoice(selection.voiceId)
  needsRender = true (already happens)

Solo toggled off:
  soloActive = false
  audio.setSoloVoice(undefined)
  needsRender = true
```

### Edge case: soloed voice deleted

If the selected voice is deleted while solo is active, selection clears.
Solo + no selection = all voices play at normal gain. The `muted` class is
removed from all voice groups and `audio.setSoloVoice(undefined)` is called.
No special-case code needed — the existing selection-change effect handles it.

## Selection Cycling

### Problem

SVG DOM ordering means the topmost shape at any point receives all pointer
events. When a shape completely covers another, the covered shape is
unselectable. Voice ordering is not data (blend modes are commutative), but the
DOM still has an order.

### Solution

Double-click (or force press) sends the topmost shape to the back of the SVG
voice layer and selects whatever shape is now on top at that point.

### Triggers

- `dblclick` on `#sigil-canvas` — desktop double-click and mobile double-tap.
  The viewport meta tag is updated to include `user-scalable=no` so browsers
  don't intercept double-tap as zoom.
- `webkitmouseforcedown` on `#sigil-canvas` — macOS Force Touch trackpad press.

### Behavior

1. Find the topmost `[data-voice-id]` element at the event point.
2. Move that element's `<g>` to the beginning of the voice layer
   (`voiceLayer.prepend(group)`).
3. Use `document.elementFromPoint()` (singular) to find the voice element now
   on top at the same coordinates. Select it via `selection.select(newTopId)`.
4. If no other shape is at the point (only one shape was there), no-op — shape
   stays selected.

### Why DOM reorder

- Voice order is explicitly not data — DOM order has no semantic meaning.
- No cycle state to track — future clicks naturally hit the newly-exposed shape.
- Simple implementation: no geometry math, no multi-element iteration.

### Interaction with existing events

- First click: selects topmost shape (existing behavior, unchanged).
- Double-click: sends that shape to back, selects next.
- Drag: unaffected — drag starts on `pointerdown` + movement, double-click
  requires two clicks without movement.
- Triple-click+: each double-click cycles one position. Rapid clicking
  naturally cycles through all overlapping shapes.

## Files to modify

| File | Changes |
|------|---------|
| `index.html` | Add `#btn-solo` button after play button, add `user-scalable=no` to viewport meta |
| `css/style.css` | Solo button styles, `.muted` class for voice groups |
| `js/app.ts` | Wire solo toggle, pass `soloVoiceId` to render and audio |
| `js/audio/engine.ts` | `_soloVoiceId` field, `setSoloVoice()`, mute in `_updateVoices()` |
| `js/canvas/render.ts` | Accept `soloVoiceId` param, apply/remove `muted` class |
| `js/canvas/interaction.ts` | Add `dblclick` + `webkitmouseforcedown` listeners, DOM reorder logic, update `dispose()` |
| `js/keyboard.ts` | Add `S` key shortcut for solo toggle |
