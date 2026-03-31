# Stamp Rotation — Design

Issue: #318 — Stamps can't be rotated on mobile

## Problem

Four related issues with stamp rotation:

1. **Bug**: Pinch-to-rotate on mobile skips stamps entirely. The `pinch-rotate`
   handler checks `hasTimbre(waveform)` — stamps have `rotationPeriod: 0`, so
   they fall into the size-only branch. The single-pointer handle code has a
   stamp-specific path (line 534–539) but the pinch handler does not.

2. **Tilt range too subtle**: Stamps tilt ±5° for the three trigger stops — nearly
   invisible. Needs to be wider to read as intentional.

3. **No quintic easing**: The handle code hard-snaps between three positions with
   fixed thresholds. The issue asks for quintic magnetic snap like pitch (Y-axis)
   uses — smooth continuous tilt during drag with sticky centers, hard snap on
   release.

4. **Tutorial gap**: The tutorial doesn't mention stamps. The `addVoice()` helper
   excludes `'stamp'` from its waveform union.

## Changes

### 1. Widen tilt range — `js/shapes.ts`

Change `STAMP_TRIGGER_TILT` from `[-5, 0, 5]` to `[-15, 0, 15]`.

Everything downstream reads `voiceRotation()` which reads this constant:
renderer (`render.ts`), interaction thresholds, gradient rotation, pattern
overlay counter-rotation. No other files need tilt-range changes.

### 2. Quintic snap function — `js/shapes.ts`

Add `snapTriggerTilt(rawDegrees: number): { tilt: number; trigger: 0 | 1 | 2 }`.

Three stops at -15°, 0°, +15°. Spacing = 15°, half-zone = 7.5°. Within each
zone, quintic (t⁵) compresses offset toward zero — same math as `snapYToNote()`:

```
offset = raw - nearestStop
t = clamp(offset / halfZone, -1, 1)
pulled = t² · t² · t          // t⁵, preserves sign
tilt = nearestStop + pulled · halfZone
trigger = index of nearestStop
```

Returns both:
- `tilt`: continuous degrees for visual during drag
- `trigger`: discrete 0 | 1 | 2 for audio and release snap

Also add `hardSnapTrigger(rawDegrees: number): 0 | 1 | 2` for release —
snaps to nearest of the three stops with no quintic.

#### Drag tilt override

During drag, the store holds discrete `trigger` (for audio) but the visual
needs continuous tilt. Add an ephemeral override map in `shapes.ts`:

```ts
const dragTiltOverrides = new Map<string, number>();
export function setDragTilt(id: string, degrees: number): void;
export function getDragTilt(id: string): number | undefined;
export function clearDragTilt(id: string): void;
```

`voiceRotation()` checks `dragTiltOverrides` first, falls back to the existing
trigger/timbre logic. The map is never serialized — it's emptied on pointer
release. This keeps the store and Voice types clean.

### 3. Fix pinch-rotate + apply quintic — `js/canvas/interaction.ts`

#### Pinch-rotate move (line 472)

Add a stamp branch before the `hasTimbre` check:

```
if (voice.waveform === 'stamp') {
  angleDelta = angle - initAngle
  rawTilt = initTilt + angleDelta (degrees)
  { tilt, trigger } = snapTriggerTilt(rawTilt)
  setDragTilt(voice.id, tilt)
  store.updateVoice(id, { trigger, size: newSize })
}
```

The initTilt comes from `voiceRotation(voice)` already stored in
`initRotation` at line 332.

#### Handle resize (line 534)

Replace the current hard-snap code:

```ts
// Before (hard snap, no visual feedback):
const baseTilt = [-5, 0, 5][origin.trigger] ?? 0;
const newTilt = baseTilt + degDelta;
const trigger = newTilt <= -2.5 ? 0 : newTilt >= 2.5 ? 2 : 1;

// After (quintic snap + continuous visual):
const baseTilt = STAMP_TRIGGER_TILT[origin.trigger] ?? 0;
const rawTilt = baseTilt + degDelta;
const { tilt, trigger } = snapTriggerTilt(rawTilt);
setDragTilt(voice.id, tilt);
updates.trigger = trigger;
```

#### Pinch-rotate release (line 562)

Add stamp cleanup before setting IDLE:

```ts
if (voice?.waveform === 'stamp') {
  const rawTilt = getDragTilt(voice.id);
  clearDragTilt(voice.id);
  if (rawTilt !== undefined) {
    store.updateVoice(voice.id, { trigger: hardSnapTrigger(rawTilt) });
  }
}
```

Read the drag tilt override before clearing it, so `hardSnapTrigger()` sees the
continuous angle the user ended at. Export `getDragTilt()` alongside the setter.

#### Handle resize release

The `resizing` mode ends at line 591–602. Add `clearDragTilt()` for stamps
in the same path where overlap is recomputed.

### 4. Tutorial stamp step — `js/tutorial.ts`

#### New helper

Add `addStamp(key: string, x: number, y: number): string` to `StepContext`.
Separate from `addVoice()` to keep the waveform union clean. Uses the default
stample index (0) and default trigger (1 = decay).

#### New step

Insert after the astroid step (currently step index 5, after the "Jump" easter
egg). Punches out stamp toolbar button + canvas.

```ts
{
  punchOut: ['[data-tool="stamp"]', '#canvas-wrap'],
  text: 'Stamps play samples. Tilt to change when they fire.',
  play: [
    // 1. Place a stamp, play at default trigger (decay)
    (ctx) => {
      ctx.clearVoices();
      ctx.store.updateScene(CHICLET_SCENE);
      ctx.addStamp('st', 0.5, 0.5);
      ctx.store.updateVoice(ctx.demo.st!, { size: ctx.nc(0.2) });
      ctx.selection.clear();
      ctx.render();
      ctx.playFor(2000);
    },
    // 2. Tilt to trigger=0 (attack), play
    (ctx) => {
      if (ctx.demo.st) {
        ctx.store.updateVoice(ctx.demo.st, { trigger: 0 });
      }
      ctx.render();
      ctx.playFor(2000);
    },
    // 3. Tilt to trigger=2 (release), play
    (ctx) => {
      if (ctx.demo.st) {
        ctx.store.updateVoice(ctx.demo.st, { trigger: 2 });
      }
      ctx.render();
      ctx.playFor(2000);
    },
  ],
}
```

Each click advances through the three trigger positions so the user hears
and sees the difference.

## Files changed

| File | Change |
|------|--------|
| `js/shapes.ts` | Widen `STAMP_TRIGGER_TILT`, add `snapTriggerTilt()`, `hardSnapTrigger()`, drag tilt override map |
| `js/canvas/interaction.ts` | Stamp branch in pinch-rotate, quintic in handle resize, drag tilt cleanup on release |
| `js/tutorial.ts` | `addStamp()` helper, new stamp tutorial step |

## Not changed

- `js/types.ts` — Voice types unchanged, trigger stays `0 | 1 | 2`
- `js/voices/stamp/` — No changes to UI, player, or lifecycle
- `js/canvas/render.ts` — Already calls `voiceRotation()`, gets drag tilt for free
- `js/serialize.ts` — Trigger serialization unchanged (3-bit)
- `js/audio/` — Audio mapping unchanged
