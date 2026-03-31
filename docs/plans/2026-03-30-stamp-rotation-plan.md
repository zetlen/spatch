# Stamp Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix stamp rotation on mobile, widen tilt range to ±15°, add quintic magnetic snap, and add stamps to the tutorial.

**Architecture:** Three files changed. `shapes.ts` gets the tilt constant change, quintic snap functions, and a drag-tilt override map. `interaction.ts` gets a stamp branch in pinch-rotate and quintic snap in handle resize. `tutorial.ts` gets an `addStamp` helper and a new step.

**Tech Stack:** TypeScript, Bun (test runner), no frameworks.

---

### Task 1: Widen tilt range and add snap functions in shapes.ts

**Files:**
- Modify: `js/shapes.ts:76-88`
- Test: `tests/unit/shapes.test.js`

- [ ] **Step 1: Write failing tests for the new tilt range and snap functions**

Add these tests to `tests/unit/shapes.test.js`:

```js
import { describe, expect, test } from 'bun:test';
import {
  clearDragTilt,
  getDragTilt,
  hardSnapTrigger,
  hitTestADSRCorner,
  setDragTilt,
  snapTriggerTilt,
  voiceRotation,
} from '../../js/shapes.ts';

// ... keep existing makeVoice, hitTestADSRCorner, and voiceRotation describes ...

describe('voiceRotation', () => {
  // ... keep existing sine/pulse/blend tests ...

  test('stamp trigger=0 returns -15', () => {
    const voice = makeVoice({ waveform: 'stamp', trigger: 0, stamp: 0 });
    expect(voiceRotation(voice)).toBe(-15);
  });

  test('stamp trigger=1 returns 0', () => {
    const voice = makeVoice({ waveform: 'stamp', trigger: 1, stamp: 0 });
    expect(voiceRotation(voice)).toBe(0);
  });

  test('stamp trigger=2 returns 15', () => {
    const voice = makeVoice({ waveform: 'stamp', trigger: 2, stamp: 0 });
    expect(voiceRotation(voice)).toBe(15);
  });

  test('drag tilt override takes precedence', () => {
    const voice = makeVoice({ waveform: 'stamp', trigger: 1, stamp: 0 });
    setDragTilt('test1', 8.5);
    expect(voiceRotation(voice)).toBe(8.5);
    clearDragTilt('test1');
    expect(voiceRotation(voice)).toBe(0);
  });
});

describe('snapTriggerTilt', () => {
  test('at stop center returns exact stop and correct trigger', () => {
    expect(snapTriggerTilt(-15)).toEqual({ tilt: -15, trigger: 0 });
    expect(snapTriggerTilt(0)).toEqual({ tilt: 0, trigger: 1 });
    expect(snapTriggerTilt(15)).toEqual({ tilt: 15, trigger: 2 });
  });

  test('small offset from center snaps close (quintic compression)', () => {
    // 2° offset from center: t = 2/7.5 ≈ 0.267, t^5 ≈ 0.00133
    // pulled ≈ 0.00133 * 7.5 ≈ 0.01 — nearly at center
    const result = snapTriggerTilt(2);
    expect(result.trigger).toBe(1);
    expect(Math.abs(result.tilt)).toBeLessThan(0.1);
  });

  test('large offset still returns correct trigger', () => {
    const result = snapTriggerTilt(6);
    expect(result.trigger).toBe(1);
    // 6° from center: t = 6/7.5 = 0.8, t^5 = 0.327
    // pulled = 0.327 * 7.5 ≈ 2.45 — compressed but not at center
    expect(result.tilt).toBeGreaterThan(0);
    expect(result.tilt).toBeLessThan(6);
  });

  test('beyond half-zone snaps to adjacent trigger', () => {
    // 8° is past the 7.5° boundary between trigger 1 and 2
    const result = snapTriggerTilt(8);
    expect(result.trigger).toBe(2);
  });

  test('values beyond ±15 clamp to outer triggers', () => {
    const far = snapTriggerTilt(25);
    expect(far.trigger).toBe(2);
    expect(far.tilt).toBeGreaterThan(15);
    expect(far.tilt).toBeLessThanOrEqual(22.5); // 15 + halfZone max

    const farNeg = snapTriggerTilt(-25);
    expect(farNeg.trigger).toBe(0);
    expect(farNeg.tilt).toBeLessThan(-15);
  });
});

describe('hardSnapTrigger', () => {
  test('snaps to nearest trigger', () => {
    expect(hardSnapTrigger(-20)).toBe(0);
    expect(hardSnapTrigger(-8)).toBe(0);
    expect(hardSnapTrigger(-7)).toBe(1);
    expect(hardSnapTrigger(0)).toBe(1);
    expect(hardSnapTrigger(7)).toBe(1);
    expect(hardSnapTrigger(8)).toBe(2);
    expect(hardSnapTrigger(20)).toBe(2);
  });
});

describe('drag tilt override', () => {
  test('get returns undefined when not set', () => {
    expect(getDragTilt('nonexistent')).toBeUndefined();
  });

  test('set and get round-trip', () => {
    setDragTilt('v1', 12.5);
    expect(getDragTilt('v1')).toBe(12.5);
    clearDragTilt('v1');
    expect(getDragTilt('v1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:unit -- --filter shapes`
Expected: New tests FAIL (functions not exported / tilt values wrong).

- [ ] **Step 3: Implement tilt range, snap functions, and drag tilt override**

In `js/shapes.ts`, replace the tilt constant and `voiceRotation`, and add the new exports. Change this block (lines 76–88):

```ts
/** Tilt angles for stamp trigger values: A=-5°, D=0°, R=+5°. */
const STAMP_TRIGGER_TILT = [-5, 0, 5] as const;

/** Get the visual rotation for a voice (derived from timbre, or trigger for stamps). */
export function voiceRotation(voice: Voice): number {
  if (voice.waveform === 'stamp') {
    const trigger = 'trigger' in voice ? (voice as { trigger: number }).trigger : 1;
    return STAMP_TRIGGER_TILT[trigger] ?? 0;
  }
  const entry = get(voice.waveform);
  const timbre = 'timbre' in voice ? (voice.timbre as number) : 0;
  return Math.min(1, Math.max(0, timbre)) * entry.rotationPeriod;
}
```

To:

```ts
/** Tilt angles for stamp trigger values: A=-15°, D=0°, R=+15°. */
export const STAMP_TRIGGER_TILT = [-15, 0, 15] as const;

const TILT_SPACING = 15; // degrees between adjacent stops
const TILT_HALF_ZONE = TILT_SPACING / 2; // 7.5°

// ---- Drag tilt override ----
//
// During rotation gestures, stamps need continuous visual tilt (for smooth
// quintic feedback) while the store holds a discrete trigger (for audio).
// This ephemeral map bridges the gap — set during drag, cleared on release.
// voiceRotation() checks it first so the renderer shows the live angle.

const dragTiltOverrides = new Map<string, number>();

export function setDragTilt(id: string, degrees: number): void {
  dragTiltOverrides.set(id, degrees);
}

export function getDragTilt(id: string): number | undefined {
  return dragTiltOverrides.get(id);
}

export function clearDragTilt(id: string): void {
  dragTiltOverrides.delete(id);
}

/** Get the visual rotation for a voice (derived from timbre, or trigger for stamps). */
export function voiceRotation(voice: Voice): number {
  if (voice.waveform === 'stamp') {
    const override = getDragTilt(voice.id);
    if (override !== undefined) {
      return override;
    }
    const trigger = 'trigger' in voice ? (voice as { trigger: number }).trigger : 1;
    return STAMP_TRIGGER_TILT[trigger] ?? 0;
  }
  const entry = get(voice.waveform);
  const timbre = 'timbre' in voice ? (voice.timbre as number) : 0;
  return Math.min(1, Math.max(0, timbre)) * entry.rotationPeriod;
}

/**
 * Quintic magnetic snap for stamp tilt. Returns continuous tilt (for visual)
 * and discrete trigger index (for audio). Same math as snapYToNote().
 */
export function snapTriggerTilt(rawDegrees: number): { tilt: number; trigger: 0 | 1 | 2 } {
  // Find nearest stop
  let bestIdx = 0;
  let bestDist = Math.abs(rawDegrees - STAMP_TRIGGER_TILT[0]);
  for (let i = 1; i < STAMP_TRIGGER_TILT.length; i++) {
    const d = Math.abs(rawDegrees - STAMP_TRIGGER_TILT[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  const stopCenter = STAMP_TRIGGER_TILT[bestIdx];
  const offset = rawDegrees - stopCenter;
  const t = Math.max(-1, Math.min(1, offset / TILT_HALF_ZONE));

  // Quintic pull: t^5 preserves sign, creates wider sticky center than cubic
  const t2 = t * t;
  const pulled = t2 * t2 * t;

  return {
    tilt: stopCenter + pulled * TILT_HALF_ZONE,
    trigger: bestIdx as 0 | 1 | 2,
  };
}

/** Hard-snap to nearest trigger (no quintic). Used on pointer release. */
export function hardSnapTrigger(rawDegrees: number): 0 | 1 | 2 {
  let bestIdx = 0;
  let bestDist = Math.abs(rawDegrees - STAMP_TRIGGER_TILT[0]);
  for (let i = 1; i < STAMP_TRIGGER_TILT.length; i++) {
    const d = Math.abs(rawDegrees - STAMP_TRIGGER_TILT[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx as 0 | 1 | 2;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:unit -- --filter shapes`
Expected: ALL tests PASS (existing + new).

- [ ] **Step 5: Run full typecheck**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add js/shapes.ts tests/unit/shapes.test.js
git commit -m "Add quintic snap and drag tilt override for stamp rotation (#318)"
```

---

### Task 2: Fix pinch-rotate for stamps and apply quintic to handle resize

**Files:**
- Modify: `js/canvas/interaction.ts:6-13` (imports)
- Modify: `js/canvas/interaction.ts:453-484` (pinch-rotate move)
- Modify: `js/canvas/interaction.ts:534-539` (handle resize stamp branch)
- Modify: `js/canvas/interaction.ts:559-603` (pointer release)

- [ ] **Step 1: Update imports**

In `js/canvas/interaction.ts`, change the imports from `shapes.ts` (line 8–13):

```ts
import {
  clampSize,
  dragToEnvelopeValue,
  hitTestADSRCorner,
  isInClippedCorner,
  voiceRotation,
} from '../shapes.ts';
```

To:

```ts
import {
  STAMP_TRIGGER_TILT,
  clampSize,
  clearDragTilt,
  dragToEnvelopeValue,
  getDragTilt,
  hardSnapTrigger,
  hitTestADSRCorner,
  isInClippedCorner,
  setDragTilt,
  snapTriggerTilt,
  voiceRotation,
} from '../shapes.ts';
```

- [ ] **Step 2: Add stamp branch to pinch-rotate move handler**

In `js/canvas/interaction.ts`, replace the pinch-rotate conditional block (lines 472–482):

```ts
      if (!hasTimbre(voice.waveform)) {
        this.store.updateVoice(this.interaction.shapeId, { size: newSize });
      } else {
        const angleDelta = angle - this.interaction.initAngle;
        const newRotation = (((this.interaction.initRotation + angleDelta) % 360) + 360) % 360;
        const timbre = rotationToTimbre(newRotation, voice.waveform);
        this.store.updateVoice(this.interaction.shapeId, {
          size: newSize,
          timbre: normalizedCoord(timbre),
        });
      }
```

With:

```ts
      if (voice.waveform === 'stamp') {
        const angleDelta = angle - this.interaction.initAngle;
        const rawTilt = this.interaction.initRotation + angleDelta;
        const { tilt, trigger } = snapTriggerTilt(rawTilt);
        setDragTilt(voice.id, tilt);
        this.store.updateVoice(this.interaction.shapeId, {
          size: newSize,
          trigger: trigger as 0 | 1 | 2,
        });
      } else if (!hasTimbre(voice.waveform)) {
        this.store.updateVoice(this.interaction.shapeId, { size: newSize });
      } else {
        const angleDelta = angle - this.interaction.initAngle;
        const newRotation = (((this.interaction.initRotation + angleDelta) % 360) + 360) % 360;
        const timbre = rotationToTimbre(newRotation, voice.waveform);
        this.store.updateVoice(this.interaction.shapeId, {
          size: newSize,
          timbre: normalizedCoord(timbre),
        });
      }
```

- [ ] **Step 3: Replace handle resize stamp branch with quintic snap**

In `js/canvas/interaction.ts`, replace the stamp branch in handle resize (lines 534–539):

```ts
      if (voice.waveform === 'stamp') {
        // Stamp: snap trigger based on accumulated angle from origin
        const baseTilt = [-5, 0, 5][this.interaction.origin.trigger] ?? 0;
        const newTilt = baseTilt + degDelta;
        const trigger = newTilt <= -2.5 ? 0 : newTilt >= 2.5 ? 2 : 1;
        updates.trigger = trigger as 0 | 1 | 2;
```

With:

```ts
      if (voice.waveform === 'stamp') {
        const baseTilt = STAMP_TRIGGER_TILT[this.interaction.origin.trigger] ?? 0;
        const rawTilt = baseTilt + degDelta;
        const { tilt, trigger } = snapTriggerTilt(rawTilt);
        setDragTilt(voice.id, tilt);
        updates.trigger = trigger as 0 | 1 | 2;
```

- [ ] **Step 4: Add drag tilt cleanup to pinch-rotate release**

In `js/canvas/interaction.ts`, replace the pinch-rotate release block (lines 562–568):

```ts
    if (this.interaction.mode === 'pinch-rotate') {
      if (e.pointerId === this.interaction.pointerA || e.pointerId === this.interaction.pointerB) {
        this.interaction = IDLE;
        this.pendingTouchDeselect = null;
        this.requestRender();
      }
      return;
    }
```

With:

```ts
    if (this.interaction.mode === 'pinch-rotate') {
      if (e.pointerId === this.interaction.pointerA || e.pointerId === this.interaction.pointerB) {
        const voice = this.store.getVoice(this.interaction.shapeId);
        if (voice?.waveform === 'stamp') {
          const rawTilt = getDragTilt(voice.id);
          clearDragTilt(voice.id);
          if (rawTilt !== undefined) {
            this.store.updateVoice(voice.id, { trigger: hardSnapTrigger(rawTilt) });
          }
        }
        this.interaction = IDLE;
        this.pendingTouchDeselect = null;
        this.requestRender();
      }
      return;
    }
```

- [ ] **Step 5: Add drag tilt cleanup to handle resize release**

In `js/canvas/interaction.ts`, after the drag release hard-snap block (after line 588), add stamp cleanup before the overlap recompute:

```ts
    // Hard-snap to nearest grid position on drag release
    if (this.interaction.mode === 'dragging') {
      const voice = this.selection.getSelectedVoice();
      if (voice) {
        this.store.updateVoice(voice.id, {
          y: hardSnapYToNote(voice.y),
        });
      }
    }

    // Clear stamp drag tilt on resize release
    if (this.interaction.mode === 'resizing') {
      const voice = this.selection.getSelectedVoice();
      if (voice?.waveform === 'stamp') {
        const rawTilt = getDragTilt(voice.id);
        clearDragTilt(voice.id);
        if (rawTilt !== undefined) {
          this.store.updateVoice(voice.id, { trigger: hardSnapTrigger(rawTilt) });
        }
      }
    }

    // Recompute shape overlap after drag/resize commit (rasterized, not per-frame)
```

- [ ] **Step 6: Run typecheck**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 7: Run all unit tests**

Run: `bun run test:unit`
Expected: ALL pass.

- [ ] **Step 8: Commit**

```bash
git add js/canvas/interaction.ts
git commit -m "Fix stamp pinch-rotate on mobile, add quintic tilt snap (#318)"
```

---

### Task 3: Add stamp tutorial step

**Files:**
- Modify: `js/tutorial.ts:86-91` (StepContext.addVoice type)
- Modify: `js/tutorial.ts:1127-1136` (addVoice implementation)
- Modify: `js/tutorial.ts:1138-1156` (context return object)
- Modify: `js/tutorial.ts:594` (insert new step after astroid)

- [ ] **Step 1: Add addStamp to StepContext interface**

In `js/tutorial.ts`, after the `addVoice` method in the `StepContext` interface (after line 91), add:

```ts
  /** Add a demo stamp voice and store its ID in `demo[key]`. */
  addStamp(key: string, x: number, y: number): string;
```

- [ ] **Step 2: Implement addStamp function**

In `js/tutorial.ts`, after the `addVoice` function implementation (after line 1136), add:

```ts
    function addStamp(key: string, x: number, y: number): string {
      const v = store.addVoice('stamp', normalizedCoord(x), normalizedCoord(y));
      demo[key] = v.id;
      return v.id;
    }
```

- [ ] **Step 3: Add addStamp to the context return object**

In `js/tutorial.ts`, in the return object (line 1138–1156), add `addStamp` after `addVoice`:

```ts
      addVoice,
      addStamp,
```

- [ ] **Step 4: Insert stamp tutorial step after astroid**

In `js/tutorial.ts`, after the astroid step's closing `},` (after line 594, the one ending the renderText astroid step), insert:

```ts
  // Stamp — place, cycle through trigger positions
  {
    punchOut: ['[data-tool="stamp"]', '#canvas-wrap'],
    text: 'Stamps play samples. Tilt to change when they fire.',
    play: [
      (ctx: StepContext) => {
        ctx.clearVoices();
        ctx.store.updateScene(CHICLET_SCENE);
        ctx.addStamp('st', 0.5, 0.5);
        ctx.store.updateVoice(ctx.demo.st!, { size: ctx.nc(0.2) });
        ctx.selection.clear();
        ctx.render();
        ctx.playFor(2000);
      },
      (ctx: StepContext) => {
        if (ctx.demo.st) {
          ctx.store.updateVoice(ctx.demo.st, { trigger: 0 });
        }
        ctx.render();
        ctx.playFor(2000);
      },
      (ctx: StepContext) => {
        if (ctx.demo.st) {
          ctx.store.updateVoice(ctx.demo.st, { trigger: 2 });
        }
        ctx.render();
        ctx.playFor(2000);
      },
    ],
  },
```

- [ ] **Step 5: Run typecheck**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 6: Run all unit tests**

Run: `bun run test:unit`
Expected: ALL pass.

- [ ] **Step 7: Commit**

```bash
git add js/tutorial.ts
git commit -m "Add stamp tutorial step with trigger tilt demo (#318)"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run full test suite**

Run: `bun run test:unit`
Expected: ALL pass.

- [ ] **Step 2: Run typecheck and lint**

Run: `bun run check && bun run lint`
Expected: No errors.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: Clean build.

- [ ] **Step 4: Manual smoke test (dev server)**

Run: `bun run dev`

Verify in browser:
1. Place a stamp voice — it should render normally
2. Select it, drag a resize handle in a circular motion — stamp tilts smoothly with quintic snap between three positions (-15°, 0°, +15°). On release, snaps to nearest.
3. On mobile/touch emulation: select a stamp, two-finger pinch-rotate — stamp resizes AND tilts (the bug fix). Release hard-snaps trigger.
4. Tutorial: click the help/tutorial button, advance to the stamp step — stamp appears, clicking advances through the three trigger positions with audio.
