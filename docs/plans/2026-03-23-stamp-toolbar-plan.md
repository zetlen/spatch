# Stamp Toolbar and Trigger Point Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add voice-aware toolbar panels (stample picker, trigger point selector) for stamp voices, with tilt-based visual trigger indication and `onRelease` audio hook.

**Architecture:** Extend `VoiceRegistryEntry` with a `panels` descriptor so the toolbar shows different panels per voice type. Add a `trigger` field to `StampVoice` that controls when the sample fires (Attack/Decay/Release) and is visualized as a subtle SVG tilt (-5°/0°/+5°). Add `onRelease` lifecycle hook to `AudioVoice` called from `engine.release()`.

**Tech Stack:** TypeScript, Preact Signals, Web Audio API, SVG, Bun test runner

**Spec:** `docs/plans/2026-03-23-stamp-toolbar-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `js/types.ts` | Modify | Add `trigger` field to `StampVoice` |
| `js/voices/types.ts` | Modify | Add `onRelease` to `AudioVoice`, `panels` to `VoiceRegistryEntry` |
| `js/voices/serializers/sample.ts` | Modify | Activate trigger bits in SP4 pack/unpack |
| `js/voices/stamp/index.ts` | Modify | Add `panels`, update `createVoice` defaults |
| `js/voices/stamp/ui.ts` | Modify | Apply tilt transform based on trigger |
| `js/voices/stamp/player.ts` | Modify | Route `source.start` to trigger-selected hook |
| `js/voices/sine/index.ts` | Modify | Add `panels` descriptor |
| `js/voices/pulse/index.ts` | Modify | Add `panels` descriptor |
| `js/voices/blend/index.ts` | Modify | Add `panels` descriptor |
| `js/voices/astroid/index.ts` | Modify | Add `panels` descriptor |
| `js/audio/engine.ts` | Modify | Call `onRelease` in `release()` |
| `js/toolbar/trigger-panel.ts` | Create | 3-button A/D/R trigger picker panel |
| `js/toolbar/toolbar.ts` | Modify | Voice-aware panel show/hide, register stample + trigger panels |
| `js/toolbar/stample-panel.ts` | Modify | Adapt deps for Toolbar registration |
| `js/app.ts` | Modify | Remove ad-hoc stample panel wiring |
| `index.html` | Modify | Add trigger panel area, icon refs |
| `tests/unit/serialize-v2.test.js` | Modify | Add trigger round-trip tests |
| `tests/unit/waveform-registry.test.js` | Modify | Add panels descriptor tests |

---

### Task 1: Add `trigger` to `StampVoice` type and `panels` + `onRelease` to voice interfaces

**Files:**
- Modify: `js/types.ts:184-188`
- Modify: `js/voices/types.ts:35-63` (`AudioVoice`), `js/voices/types.ts:102-115` (`VoiceRegistryEntry`)

- [ ] **Step 1: Add `trigger` to `StampVoice`**

In `js/types.ts`, change the `StampVoice` interface:

```ts
/** Stamp voice (sample-based). The `stamp` field indexes into the STAMPLES registry.
 *  `trigger` selects the envelope phase that fires the sample: 0=Attack, 1=Decay, 2=Release. */
export interface StampVoice extends VoiceBase {
  waveform: 'stamp';
  stamp: number;
  trigger: 0 | 1 | 2;
}
```

- [ ] **Step 2: Add `onRelease` to `AudioVoice`**

In `js/voices/types.ts`, add after the `onDecay` line (line 57):

```ts
  onRelease?(time: number): void;
```

- [ ] **Step 3: Add `panels` to `VoiceRegistryEntry`**

In `js/voices/types.ts`, add to the `VoiceRegistryEntry` interface before the closing brace (after line 114):

```ts
  /** Which optional toolbar panels this voice type uses. */
  readonly panels: {
    readonly border: boolean;
    readonly stample: boolean;
    readonly trigger: boolean;
  };
```

- [ ] **Step 4: Run typecheck to see expected failures**

Run: `bun run check`
Expected: FAIL — all 5 registry entries now missing `panels` property. This confirms the interface change is detected.

- [ ] **Step 5: Commit**

```bash
git add js/types.ts js/voices/types.ts
git commit -m "Add trigger to StampVoice, onRelease to AudioVoice, panels to VoiceRegistryEntry"
```

---

### Task 2: Add `panels` descriptor to all 5 registry entries

**Files:**
- Modify: `js/voices/sine/index.ts`
- Modify: `js/voices/pulse/index.ts`
- Modify: `js/voices/blend/index.ts`
- Modify: `js/voices/astroid/index.ts`
- Modify: `js/voices/stamp/index.ts`
- Test: `tests/unit/waveform-registry.test.js`

- [ ] **Step 1: Write failing test for panels descriptor**

Append to `tests/unit/waveform-registry.test.js`:

```js
describe('panels descriptor', () => {
  test('all entries have a panels object', () => {
    for (const entry of all()) {
      expect(entry.panels).toBeDefined();
      expect(typeof entry.panels.border).toBe('boolean');
      expect(typeof entry.panels.stample).toBe('boolean');
      expect(typeof entry.panels.trigger).toBe('boolean');
    }
  });

  test('oscillator voices have border but not stample/trigger', () => {
    for (const wf of ['sine', 'pulse', 'blend', 'astroid']) {
      const entry = get(wf);
      expect(entry.panels.border).toBe(true);
      expect(entry.panels.stample).toBe(false);
      expect(entry.panels.trigger).toBe(false);
    }
  });

  test('stamp voice has stample and trigger but not border', () => {
    const entry = get('stamp');
    expect(entry.panels.border).toBe(false);
    expect(entry.panels.stample).toBe(true);
    expect(entry.panels.trigger).toBe(true);
  });
});

describe('stamp createVoice defaults', () => {
  test('createVoice sets trigger to 1 (Decay)', () => {
    const base = {
      id: 'test', x: 0.5, y: 0.5, size: 0.25,
      fill: { mode: 'solid', h: 0, s: 50, l: 50 },
      effect: undefined, blend: 'screen', border: undefined,
    };
    const voice = createVoice('stamp', base);
    expect(voice.trigger).toBe(1);
  });

  test('createVoice forces border to undefined', () => {
    const base = {
      id: 'test', x: 0.5, y: 0.5, size: 0.25,
      fill: { mode: 'solid', h: 0, s: 50, l: 50 },
      effect: undefined, blend: 'screen',
      border: { color: 'white', double: false, thickness: 0.5 },
    };
    const voice = createVoice('stamp', base);
    expect(voice.border).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/waveform-registry.test.js`
Expected: FAIL — `panels` is undefined on all entries.

- [ ] **Step 3: Add `panels` to all 4 oscillator registry entries**

In each of `js/voices/sine/index.ts`, `js/voices/pulse/index.ts`, `js/voices/blend/index.ts`, `js/voices/astroid/index.ts`, add inside the `entry` object:

```ts
  panels: { border: true, stample: false, trigger: false },
```

- [ ] **Step 4: Add `panels` to stamp registry entry and fix `createVoice`**

In `js/voices/stamp/index.ts`, update:

```ts
const entry: VoiceRegistryEntry = {
  waveform: 'stamp',
  id: 4,
  rotationPeriod: 0,
  panels: { border: false, stample: true, trigger: true },
  ui,
  player,
  serializer: createSampleSerializer(),
  createVoice: (base: VoiceBase) =>
    ({ ...base, waveform: 'stamp', stamp: getDefaultStampleIndex(), trigger: 1, border: undefined }) as Voice,
};
```

Note: `trigger: 1` (Decay) is the default, `border: undefined` prevents inherited borders.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/waveform-registry.test.js`
Expected: PASS

- [ ] **Step 6: Run full typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add js/voices/sine/index.ts js/voices/pulse/index.ts js/voices/blend/index.ts js/voices/astroid/index.ts js/voices/stamp/index.ts tests/unit/waveform-registry.test.js
git commit -m "Add panels descriptor to all voice registry entries"
```

---

### Task 3: Activate trigger bits in the sample serializer

**Files:**
- Modify: `js/voices/serializers/sample.ts`
- Test: `tests/unit/serialize-v2.test.js`

- [ ] **Step 1: Write failing tests for trigger serialization**

Append to the `SampleSerializer` describe block in `tests/unit/serialize-v2.test.js`:

```js
  test('trigger 0-2 round-trips', () => {
    for (let t = 0; t < 3; t++) {
      const voice = makeVoice({ stamp: 1, trigger: t, waveform: 'stamp' });
      const unpacked = serializer.unpack(serializer.pack(voice), 'stamp');
      expect(unpacked.trigger).toBe(t);
    }
  });

  test('trigger defaults to 1 for value 3 (reserved)', () => {
    // Manually construct a packed string with trigger=3 in SP4
    const voice = makeVoice({ stamp: 1, trigger: 0, waveform: 'stamp' });
    const packed = serializer.pack(voice);
    // SP4 is at offset 8 for solid fills
    const sp4Raw = (1 << 3) | (3 << 1); // stamp=1, trigger=3 (reserved)
    const tampered = packed.slice(0, 8) + encodeInt(sp4Raw, 1) + packed.slice(9);
    const unpacked = serializer.unpack(tampered, 'stamp');
    expect(unpacked.trigger).toBe(1); // clamped to default
  });

  test('trigger + stamp index pack independently', () => {
    const voice = makeVoice({ stamp: 5, trigger: 2, waveform: 'stamp' });
    const unpacked = serializer.unpack(serializer.pack(voice), 'stamp');
    expect(unpacked.stamp).toBe(5);
    expect(unpacked.trigger).toBe(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/serialize-v2.test.js`
Expected: FAIL — `trigger` is undefined on unpacked voices.

- [ ] **Step 3: Update sample serializer to pack/unpack trigger**

In `js/voices/serializers/sample.ts`, update the `pack` method:

```ts
    pack(voice: Voice): string {
      const stampIndex = 'stamp' in voice ? (voice as { stamp: number }).stamp : 0;
      const trigger = 'trigger' in voice ? (voice as { trigger: number }).trigger : 1;
      const sp4 = ((stampIndex & 0x7) << 3) | ((trigger & 0x3) << 1);

      const packed = base.pack(voice);
      const sp4Offset = voice.fill.mode === 'linear' ? 13 : 8;
      return packed.slice(0, sp4Offset) + encodeInt(sp4, 1) + packed.slice(sp4Offset + 1);
    },
```

Update the `unpack` method:

```ts
    unpack(registers: string, waveform: WaveformType): Voice {
      const voice = base.unpack(registers, waveform);

      const isGradient = registers.length === this.gradientWidth;
      const sp4Offset = isGradient ? 13 : 8;
      const sp4 = decodeInt(registers, sp4Offset, 1);
      const stampIndex = (sp4 >> 3) & 0x7;
      const rawTrigger = (sp4 >> 1) & 0x3;
      const trigger = rawTrigger > 2 ? 1 : rawTrigger; // clamp reserved value 3 to default

      return { ...voice, stamp: stampIndex, trigger } as Voice;
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/serialize-v2.test.js`
Expected: PASS

- [ ] **Step 5: Run all unit tests**

Run: `bun run test:unit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add js/voices/serializers/sample.ts tests/unit/serialize-v2.test.js
git commit -m "Activate trigger bits in sample serializer SP4"
```

---

### Task 4: Apply tilt transform to stamp SVG

**Files:**
- Modify: `js/voices/stamp/ui.ts`

- [ ] **Step 1: Add tilt angle lookup**

Add after the `getStampIndex` function near the top of `js/voices/stamp/ui.ts`:

```ts
/** Tilt angles for trigger values: A=-5°, D=0°, R=+5°. */
const TRIGGER_TILT = [-5, 0, 5] as const;

function getTrigger(voice: Voice): number {
  return 'trigger' in voice ? (voice as { trigger: number }).trigger : 1;
}

function getTiltDeg(voice: Voice): number {
  const t = getTrigger(voice);
  return TRIGGER_TILT[t] ?? 0;
}
```

- [ ] **Step 2: Apply rotation in `createSvgElement`**

In the `createSvgElement` method, after `g.append(use, hit);` and before `return g;`, add:

```ts
    const tilt = getTiltDeg(voice);
    if (tilt !== 0) {
      const cx = voice.x as number;
      const cy = voice.y as number;
      g.setAttribute('transform', `rotate(${tilt} ${cx} ${cy})`);
    }
```

- [ ] **Step 3: Apply rotation in `updateSvgElement`**

In the `updateSvgElement` method, at the end add:

```ts
    const tilt = getTiltDeg(voice);
    if (tilt !== 0) {
      const cx = voice.x as number;
      const cy = voice.y as number;
      el.setAttribute('transform', `rotate(${tilt} ${cx} ${cy})`);
    } else {
      el.removeAttribute('transform');
    }
```

- [ ] **Step 4: Apply rotation in `createSelectionElement`**

In `createSelectionElement`, after setting `d`, add before `return el;`:

```ts
    const tilt = getTiltDeg(voice);
    if (tilt !== 0) {
      const cx = voice.x as number;
      const cy = voice.y as number;
      el.setAttribute('transform', `rotate(${tilt} ${cx} ${cy})`);
    }
```

- [ ] **Step 5: Run typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add js/voices/stamp/ui.ts
git commit -m "Apply tilt transform to stamp SVG based on trigger value"
```

---

### Task 5: Route sample start to trigger-selected hook in stamp player

**Files:**
- Modify: `js/voices/stamp/player.ts`

- [ ] **Step 1: Add trigger reader**

Add near the top of `js/voices/stamp/player.ts`, after `getStampIndex`:

```ts
function getTrigger(voice: Voice): number {
  return 'trigger' in voice ? (voice as { trigger: number }).trigger : 1;
}
```

- [ ] **Step 2: Update `buildAudioGraph` to route `source.start` by trigger**

Replace the current `start`, `onDecay`, and `stop` methods in the returned `AudioVoice`. The key change: `source.start()` moves from being hardcoded in `onDecay` to being routed by trigger value.

Replace the `start(time)` and `onDecay(time)` methods:

```ts
      start(time: number) {
        fmOsc.start(time);
        if (shared.octaveOsc) {
          try {
            shared.octaveOsc.start(time);
          } catch {}
        }
        // Trigger=0 (Attack): fire sample immediately
        if (getTrigger(voice) === 0) {
          source.start(time);
        }
      },
      onDecay(time: number) {
        // Trigger=1 (Decay): fire sample at peak envelope (original behavior)
        if (getTrigger(voice) === 1) {
          source.start(time);
        }
      },
      onRelease(time: number) {
        // Trigger=2 (Release): fire sample on note-off
        if (getTrigger(voice) === 2) {
          source.start(time);
        }
      },
```

- [ ] **Step 3: Run typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add js/voices/stamp/player.ts
git commit -m "Route stamp sample start to trigger-selected lifecycle hook"
```

---

### Task 6: Add `onRelease` call site in `engine.release()`

**Files:**
- Modify: `js/audio/engine.ts:282-313`

- [ ] **Step 1: Call `onRelease` on all active voices at release time**

In the `release()` method of `AudioEngine`, add after line 292 (`linearRampToValueAtTime` call) and before the silence polling block:

```ts
    // Fire onRelease hooks (e.g. release-triggered stamp samples)
    const releaseNow = ctx.currentTime;
    for (const av of this.activeVoices) {
      av.onRelease?.(releaseNow);
    }
```

- [ ] **Step 2: Run typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 3: Run all unit tests**

Run: `bun run test:unit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add js/audio/engine.ts
git commit -m "Call onRelease on active voices in engine.release()"
```

---

### Task 7: Create the trigger panel

**Files:**
- Create: `js/toolbar/trigger-panel.ts`

- [ ] **Step 1: Create trigger panel**

Create `js/toolbar/trigger-panel.ts`, modeled on `blend-panel.ts`:

```ts
// trigger-panel.ts — Trigger point expansion panel for stamp voices
// Icon references for sprite scanner: #tabler-sword #tabler-dental #tabler-prison

import {
  createExpansionPanel,
  getSelectedVoice,
  type ExpansionPanel,
  type PanelDeps,
} from './expansion-panel.ts';

const TRIGGER_ENTRIES = [
  { symbol: 'tabler-sword', title: 'Attack', key: '0' },
  { symbol: 'tabler-dental', title: 'Decay', key: '1' },
  { symbol: 'tabler-prison', title: 'Release', key: '2' },
] as const;

export function createTriggerPanel(deps: PanelDeps): ExpansionPanel {
  return createExpansionPanel({
    area: deps.area,
    entries: () =>
      TRIGGER_ENTRIES.map((e) => ({
        type: 'icon' as const,
        symbol: e.symbol,
        title: e.title,
        key: e.key,
      })),
    isActive(key) {
      const voice = getSelectedVoice(deps);
      if (!voice || voice.waveform !== 'stamp') return false;
      const trigger = 'trigger' in voice ? (voice as { trigger: number }).trigger : 1;
      return String(trigger) === key;
    },
    onClick(key) {
      const voice = getSelectedVoice(deps);
      if (!voice || voice.waveform !== 'stamp') return;
      deps.undo.snapshot();
      deps.store.updateVoice(voice.id, { trigger: parseInt(key) as 0 | 1 | 2 });
    },
  });
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add js/toolbar/trigger-panel.ts
git commit -m "Create trigger point panel for stamp voices"
```

---

### Task 8: Add trigger panel area and icon refs to `index.html`

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add trigger panel expansion area**

In `index.html`, after the `#stample-panel` div (line 294), add:

```html
        <div id="trigger-panel" class="toolbar-row toolbar-expansion hidden"></div>
```

- [ ] **Step 2: Run typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Add trigger panel expansion area to HTML"
```

---

### Task 9: Wire voice-aware panels into Toolbar

**Files:**
- Modify: `js/toolbar/toolbar.ts`
- Modify: `js/toolbar/stample-panel.ts`
- Modify: `js/app.ts`

This is the largest task. The Toolbar needs to:
1. Import and create the stample and trigger panels
2. Show/hide border, stample, and trigger panel buttons based on registry `panels` descriptor
3. Respect the `stampsEnabled` localStorage gate

- [ ] **Step 1: Update `stample-panel.ts` to accept `PanelDeps`**

The current `createStamplePanel` takes a custom deps shape. Refactor to accept `PanelDeps` (the standard shape used by all other panels) plus any extra fields. Change the signature in `js/toolbar/stample-panel.ts`:

```ts
import type { SigilStore, UndoManager } from '../state.ts';
import { STAMPLES } from '../stamples/index.ts';
import { setDefaultStampleIndex, getDefaultStampleIndex } from '../voices/stamp/lifecycle.ts';
import { createExpansionPanel, type ExpansionPanel, type PanelDeps } from './expansion-panel.ts';

export function createStamplePanel(deps: PanelDeps): ExpansionPanel {
  const { store, undo, getSelectedId } = deps;

  return createExpansionPanel({
    area: deps.area,
    entries: () =>
      STAMPLES.map((stample, i) => ({
        type: 'item' as const,
        key: String(i),
        create() {
          const btn = document.createElement('button');
          btn.className = 'action-btn';
          btn.title = stample.name;
          const img = document.createElement('img');
          img.src = stample.svgDataUri;
          img.width = 20;
          img.height = 20;
          img.style.display = 'block';
          btn.append(img);
          return btn;
        },
      })),
    isActive: (key) => getDefaultStampleIndex() === parseInt(key),
    onClick(key) {
      const index = parseInt(key);
      setDefaultStampleIndex(index);

      const id = getSelectedId();
      if (id) {
        const voice = store.getVoice(id);
        if (voice && voice.waveform === 'stamp') {
          undo.snapshot();
          store.updateVoice(id, { stamp: index });
        }
      }
    },
  });
}
```

Key change: removed `requestRender` and `onDismiss` params — `requestRender` is handled by the store signal, and `onDismiss` is handled by `PanelManager` automatically.

- [ ] **Step 2: Update Toolbar to import and register stample + trigger panels**

In `js/toolbar/toolbar.ts`, add imports:

```ts
import { createStamplePanel } from './stample-panel.ts';
import { createTriggerPanel } from './trigger-panel.ts';
import { get as getVoiceEntry } from '../voices/registry.ts';
```

- [ ] **Step 2 (cont.): Add trigger button to `index.html`**

In `index.html`, after the `#btn-border` button (line 277), add:

```html
            <button id="btn-trigger" class="action-btn hidden" title="Trigger point">
              <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-dental" /></svg>
            </button>
```

- [ ] **Step 3: Update Toolbar constructor to register all voice-aware panels**

In `js/toolbar/toolbar.ts`, add the stamp-specific panel setup in the constructor. The stample panel is triggered by `#btn-stamp`, the trigger panel by the new `#btn-trigger`:

```ts
    // Voice-aware panels: border (oscillators), stample + trigger (stamps)
    const stampsEnabled =
      typeof localStorage !== 'undefined' && localStorage.getItem('spatch:stamps') === '1';

    const stampleArea = document.querySelector<HTMLElement>('#stample-panel');
    const triggerArea = document.querySelector<HTMLElement>('#trigger-panel');
    const btnStamp = document.querySelector<HTMLElement>('#btn-stamp');
    const btnTrigger = document.querySelector<HTMLElement>('#btn-trigger');

    if (stampsEnabled && stampleArea && triggerArea) {
      const stamplePanel = createStamplePanel({ ...sharedDeps, area: stampleArea });
      const triggerPanel = createTriggerPanel({ ...sharedDeps, area: triggerArea });

      if (btnStamp) {
        this.panels.register('stample', stamplePanel, btnStamp, stampleArea);
        btnStamp.addEventListener('click', () => {
          this.panels.toggle('stample');
        });
      }
      if (btnTrigger) {
        this.panels.register('trigger', triggerPanel, btnTrigger, triggerArea);
        btnTrigger.addEventListener('click', (e) => {
          e.stopPropagation();
          this.panels.toggle('trigger', () => !!this.getSelected());
        });
      }
    }

    this._stampsEnabled = stampsEnabled;
```

Add `_stampsEnabled` as a private field:

```ts
  private _stampsEnabled: boolean;
```

- [ ] **Step 4: Add `_syncVoicePanels` method**

Add a method to `Toolbar` that toggles panel button visibility based on the selected voice's registry entry:

```ts
  /** Show/hide voice-type-specific panel buttons based on registry descriptor. */
  private _syncVoicePanels(): void {
    const voice = this.getSelected();
    const panels = voice ? getVoiceEntry(voice.waveform).panels : undefined;

    const btnBorder = document.querySelector<HTMLElement>('#btn-border');
    const btnTrigger = document.querySelector<HTMLElement>('#btn-trigger');

    if (btnBorder) {
      btnBorder.classList.toggle('hidden', panels !== undefined && !panels.border);
    }
    if (btnTrigger && this._stampsEnabled) {
      btnTrigger.classList.toggle('hidden', panels === undefined || !panels.trigger);
    }
  }
```

- [ ] **Step 5: Call `_syncVoicePanels` from `syncToSelectedShape` and `updateBottomBar`**

In `syncToSelectedShape()`, add at the end:

```ts
    this._syncVoicePanels();
```

In `updateBottomBar()`, add after `this.panels.close();` (in the else branch):

```ts
      // Reset voice-specific panel visibility
      this._syncVoicePanels();
```

- [ ] **Step 6: Remove stample panel wiring from `app.ts`**

In `js/app.ts`, remove the entire stample panel block (lines 168-191):

```ts
// Stamp button: click opens stample picker panel (no delay).
// Hidden unless stamps are enabled via localStorage flag.
{
  const btnStamp = qel('#btn-stamp');
  ...
}
```

Replace with just the stamp button visibility toggle:

```ts
// Hide stamp tool button unless stamps are enabled
if (!stampsEnabled) {
  qel('#btn-stamp').style.display = 'none';
}
```

Also remove the `createStamplePanel` import from `app.ts`. Keep the `bindLongPress` import — it is still used for the stage panel.

- [ ] **Step 7: Run typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 8: Run all tests**

Run: `bun run test:unit`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add js/toolbar/toolbar.ts js/toolbar/stample-panel.ts js/app.ts index.html
git commit -m "Wire voice-aware panels into Toolbar with registry descriptors"
```

---

### Task 10: Final integration test and cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 2: Run all unit tests**

Run: `bun run test:unit`
Expected: PASS

- [ ] **Step 3: Run lint and format**

Run: `bun run lint && bun run fmt`
Expected: PASS (with possible auto-fixes applied)

- [ ] **Step 4: Build**

Run: `bun run build`
Expected: PASS — production build succeeds.

- [ ] **Step 5: Run e2e tests (if dev server available)**

Run: `bun run test:e2e`
Expected: PASS — existing integration tests still pass.

- [ ] **Step 6: Verify CLAUDE.md accuracy**

Check that the `StampVoice` description in CLAUDE.md matches the new `trigger` field, and that the "Modify border behavior" recipe still makes sense given that stamps no longer use borders.

- [ ] **Step 7: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "Stamp toolbar: final cleanup and CLAUDE.md update"
```
