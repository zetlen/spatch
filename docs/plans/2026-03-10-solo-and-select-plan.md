# Solo Mode + Selection Cycling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a solo toggle that mutes all voices except the selected one, and double-click cycling to select shapes hidden behind others.

**Architecture:** Solo state is a module-level boolean in `app.ts` that drives `AudioEngine.setSoloVoice()` for audio muting and a `soloVoiceId` param to `render()` for visual dimming. Selection cycling uses `dblclick`/`webkitmouseforcedown` events in `CanvasInteractionController` to reorder the SVG DOM and select the newly-exposed shape.

**Tech Stack:** TypeScript, Web Audio API, SVG DOM, CSS transitions

---

## Chunk 1: Audio Engine Solo Support

### Task 1: Add `setSoloVoice()` to AudioEngine

**Files:**
- Modify: `js/audio/engine.ts:40-66` (class fields), `js/audio/engine.ts:453` (gain line in `_updateVoices`)
- Test: `tests/unit/audio-engine.test.js`

- [ ] **Step 1: Write failing tests for solo muting**

Add a new `describe` block at the end of `tests/unit/audio-engine.test.js`:

```javascript
describe('AudioEngine — solo mode', () => {
  let engine;

  beforeEach(async () => {
    engine = new AudioEngine();
    engine.audioCtx = createStubAudioContext();
    engine.masterGain = new GainNode(engine.audioCtx);
  });

  async function startWith(voices) {
    const state = makeSigilState(voices);
    await engine.play(state, state.envelope);
    return state;
  }

  test('setSoloVoice mutes non-solo voices on next update', async () => {
    const voiceA = makeVoice('a', 'sine', { size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { size: 0.2 });
    const state = await startWith([voiceA, voiceB]);

    engine.setSoloVoice('a');
    engine.update(state);

    const avA = engine.activeVoices.find((v) => v.shapeId === 'a');
    const avB = engine.activeVoices.find((v) => v.shapeId === 'b');
    expect(avA.gain.gain.value).toBeGreaterThan(0);
    expect(avB.gain.gain.value).toBe(0);
  });

  test('setSoloVoice(undefined) unmutes all voices', async () => {
    const voiceA = makeVoice('a', 'sine', { size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { size: 0.2 });
    const state = await startWith([voiceA, voiceB]);

    engine.setSoloVoice('a');
    engine.update(state);
    engine.setSoloVoice(undefined);
    engine.update(state);

    const avA = engine.activeVoices.find((v) => v.shapeId === 'a');
    const avB = engine.activeVoices.find((v) => v.shapeId === 'b');
    expect(avA.gain.gain.value).toBeGreaterThan(0);
    expect(avB.gain.gain.value).toBeGreaterThan(0);
  });

  test('solo voice that does not exist unmutes all', async () => {
    const voiceA = makeVoice('a', 'sine', { size: 0.2 });
    const state = await startWith([voiceA]);

    engine.setSoloVoice('nonexistent');
    engine.update(state);

    const avA = engine.activeVoices.find((v) => v.shapeId === 'a');
    expect(avA.gain.gain.value).toBeGreaterThan(0);
  });

  test('FM connections stay active when voice is soloed', async () => {
    const voiceA = makeVoice('a', 'sine', { x: 0.5, y: 0.5, size: 0.2 });
    const voiceB = makeVoice('b', 'sine', {
      x: 0.5, y: 0.5, size: 0.2, blend: 'multiply',
    });
    const state = await startWith([voiceA, voiceB]);

    engine.setSoloVoice('a');
    engine.update(state);

    // FM connections should still exist despite voice B being muted
    expect(engine._fmConnections.size).toBeGreaterThan(0);
  });

  test('solo respects initial play — muted voices start at gain 0', async () => {
    const voiceA = makeVoice('a', 'sine', { size: 0.2 });
    const voiceB = makeVoice('b', 'sine', { size: 0.2 });

    engine.setSoloVoice('a');
    await startWith([voiceA, voiceB]);

    const avA = engine.activeVoices.find((v) => v.shapeId === 'a');
    const avB = engine.activeVoices.find((v) => v.shapeId === 'b');
    expect(avA.gain.gain.value).toBeGreaterThan(0);
    expect(avB.gain.gain.value).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:unit -- tests/unit/audio-engine.test.js`
Expected: FAIL — `engine.setSoloVoice is not a function`

- [ ] **Step 3: Implement `setSoloVoice` and solo gain logic**

In `js/audio/engine.ts`:

1. Add field after line 65 (`_pendingIRBuffer`):
```typescript
private _soloVoiceId: string | undefined;
```

2. Add method after `unmuffle()` (after line 589):
```typescript
setSoloVoice(id: string | undefined): void {
  this._soloVoiceId = id;
}
```

3. Modify gain line at line 453. Replace:
```typescript
audioVoice.gain.gain.setValueAtTime(vibe.voiceGain(voice.waveform, voice.size), now);
```
With:
```typescript
const isMuted = this._soloVoiceId !== undefined && voice.id !== this._soloVoiceId;
audioVoice.gain.gain.setValueAtTime(
  isMuted ? 0 : vibe.voiceGain(voice.waveform, voice.size),
  now,
);
```

4. In `play()`, after voice is built at line 213-214, apply solo mute. Replace:
```typescript
const audioVoice = this._buildVoice(ctx, voice);
audioVoice.start(now);
```
With:
```typescript
const audioVoice = this._buildVoice(ctx, voice);
if (this._soloVoiceId !== undefined && voice.id !== this._soloVoiceId) {
  audioVoice.gain.gain.setValueAtTime(0, now);
}
audioVoice.start(now);
```

5. In `_cleanup()`, clear solo state at line 827 (after `_appliedReverbPreDelay = 0`):
Do NOT clear `_soloVoiceId` here — solo persists across play/stop per design.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:unit -- tests/unit/audio-engine.test.js`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite + typecheck**

Run: `bun run check && bun run test:unit`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add js/audio/engine.ts tests/unit/audio-engine.test.js
git commit -m "Add setSoloVoice() to AudioEngine for per-voice muting (#135)"
```

---

## Chunk 2: Visual Muting in Renderer

### Task 2: Add `soloVoiceId` parameter to `render()` and apply `muted` CSS class

**Files:**
- Modify: `js/canvas/render.ts:565` (render signature), `js/canvas/render.ts:335-383` (reconcileVoices)
- Modify: `js/embed-entry.ts:68` (render call site)
- Modify: `css/style.css` (add `.muted` class)
- Test: `tests/unit/canvas-render.test.js`

- [ ] **Step 1: Write failing test for muted class**

Add a new `describe` block in `tests/unit/canvas-render.test.js`. Uses existing helpers:
`createSVG()`, `makeSineVoice(overrides)`, `makePulseVoice(overrides)`, `makeState(overrides)`.
Note: `makeState` takes an overrides object like `{ voices: [...] }`, not an array.

```javascript
describe('canvas render — solo muting', () => {
  beforeEach(() => {
    resetCache();
    for (const svg of document.querySelectorAll('svg')) {
      svg.remove();
    }
  });

  test('render applies muted class to non-solo voices', () => {
    const svg = createSVG();
    const state = makeState({
      voices: [
        makeSineVoice({ id: 'a' }),
        makePulseVoice({ id: 'b' }),
      ],
    });

    // Render with solo on voice 'a'
    render(svg, state, undefined, 'a');

    const groupA = svg.querySelector('g[data-voice-id="a"]');
    const groupB = svg.querySelector('g[data-voice-id="b"]');
    expect(groupA.classList.contains('muted')).toBe(false);
    expect(groupB.classList.contains('muted')).toBe(true);
  });

  test('render removes muted class when solo cleared', () => {
    const svg = createSVG();
    const state = makeState({
      voices: [
        makeSineVoice({ id: 'a' }),
        makePulseVoice({ id: 'b' }),
      ],
    });

    render(svg, state, undefined, 'a');
    render(svg, state, undefined, undefined);

    const groupA = svg.querySelector('g[data-voice-id="a"]');
    const groupB = svg.querySelector('g[data-voice-id="b"]');
    expect(groupA.classList.contains('muted')).toBe(false);
    expect(groupB.classList.contains('muted')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:unit -- tests/unit/canvas-render.test.js`
Expected: FAIL — render doesn't accept 4th argument / no muted class applied

- [ ] **Step 3: Add `soloVoiceId` parameter and muted class logic**

In `js/canvas/render.ts`:

1. Update `render()` signature at line 565:
```typescript
export function render(
  svg: SVGSVGElement,
  state: SigilData,
  selectedId: string | undefined,
  soloVoiceId?: string | undefined,
): void {
```

2. Pass `soloVoiceId` to `reconcileVoices` — update the call at line 575:
```typescript
reconcileVoices(voiceLayer, state.voices, defs, soloVoiceId);
```

3. Update `reconcileVoices` signature at line 335:
```typescript
function reconcileVoices(
  voiceLayer: SVGGElement,
  voices: Voice[],
  defs: SVGDefsElement,
  soloVoiceId: string | undefined,
): void {
```

4. After `reconcileVoice(group, voice, defs)` at line 381, add muted class logic:
```typescript
    reconcileVoice(group, voice, defs);
    group.classList.toggle('muted', soloVoiceId !== undefined && voice.id !== soloVoiceId);
    prevGroup = group;
```

- [ ] **Step 4: Update embed-entry.ts call site**

In `js/embed-entry.ts` at line 68, the call `render(svgRoot, sigil, undefined)` remains valid since `soloVoiceId` is optional. No change needed.

- [ ] **Step 5: Add `.muted` CSS class**

In `css/style.css`, add after the `#sigil-canvas` rule (around line 270). The transition
must be on the base `g[data-voice-id]` selector so it animates in both directions
(adding AND removing the `muted` class):

```css
g[data-voice-id] {
  transition: opacity 0.15s, filter 0.15s;
}

g.muted {
  opacity: 0.25;
  filter: saturate(0.3);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test:unit -- tests/unit/canvas-render.test.js`
Expected: All PASS

- [ ] **Step 7: Run full test suite + typecheck**

Run: `bun run check && bun run test:unit`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add js/canvas/render.ts css/style.css tests/unit/canvas-render.test.js
git commit -m "Add visual muting for solo mode — dimmed non-solo voices (#135)"
```

---

## Chunk 3: Solo Button UI + Wiring

### Task 3: Add solo button HTML, CSS, and app wiring

**Files:**
- Modify: `index.html:76-88` (after play button)
- Modify: `index.html:5` (viewport meta tag)
- Modify: `css/style.css` (solo button styles)
- Modify: `js/app.ts` (solo state, button handler, render/audio wiring)
- Modify: `js/keyboard.ts:21-116` (add S shortcut)

- [ ] **Step 1: Add `user-scalable=no` to viewport meta**

In `index.html` line 5, replace:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```
With:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no" />
```

- [ ] **Step 2: Add solo button HTML**

In `index.html`, wrap the play button and new solo button in a flex row container.
Replace the bare `<button id="btn-play" ...>...</button>` (lines 76-88) with:
```html
        <div class="stage-controls">
          <button id="btn-play" class="stage-play-btn" title="Play">
            <svg class="play-icon" viewBox="0 0 24 24">
              <path
                d="M6 4.75a1.25 1.25 0 0 1 1.87-1.08l12.5 7.25a1.25 1.25 0 0 1 0 2.16l-12.5 7.25A1.25 1.25 0 0 1 6 19.25V4.75z"
                fill="currentColor"
              />
            </svg>
            <span class="play-mode-badge hidden"></span>
            <svg class="play-ring" viewBox="0 0 68 68">
              <circle class="play-ring-track" cx="34" cy="34" r="31" />
              <circle class="play-ring-fill" cx="34" cy="34" r="31" />
            </svg>
          </button>
          <button id="btn-solo" class="stage-solo-btn" title="Solo selected voice">
            <svg width="20" height="20"><use href="tabler-sprite.svg#tabler-circle-letter-s" /></svg>
          </button>
        </div>
```

This `div.stage-controls` is a flex row that keeps the solo button beside the
play button in both portrait (where the stage is a column) and landscape.

- [ ] **Step 3: Add solo button CSS**

In `css/style.css`, after the `.stage-play-btn.latched` rule (after line 640), add:

```css
/* ---- Stage controls row (play + solo) ---- */

.stage-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 2;
}

/* ---- Solo toggle button ---- */

.stage-solo-btn {
  width: calc(var(--play-btn-size) * 0.36);
  height: calc(var(--play-btn-size) * 0.36);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, transparent 60%);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.6));
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s, color 0.15s, filter 0.15s;
  touch-action: none;
}

.stage-solo-btn.solo-active {
  color: #fff;
  filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.6)) drop-shadow(0 0 3px rgba(0, 0, 0, 0.6));
}

body.is-editing .stage-solo-btn {
  opacity: 0.6;
  pointer-events: auto;
}

body.is-editing .stage-solo-btn:hover {
  opacity: 1;
}
```

Also update the landscape `@media` rule (around line 567-576). The play button's
absolute positioning now needs to apply to `.stage-controls` instead. Replace
the `.stage-play-btn` landscape rule with:

```css
  .stage-controls {
    position: absolute;
    left: 12px;
    bottom: 68px;
  }
```

And remove the existing `.stage-play-btn` position/left/bottom declarations from
that landscape block (they move to `.stage-controls`).

The `#canvas-wrap` width calc that references `--play-btn-size` may need
adjustment since the solo button adds width. The implementer should verify
visually and adjust if the canvas clips.

- [ ] **Step 4: Wire solo state in app.ts**

In `js/app.ts`:

1. Add solo state after the selection manager (after line 60):
```typescript
let soloActive = false;
const soloBtn = qel<HTMLButtonElement>('#btn-solo');
```

2. Add solo toggle function and button handler (after the `soloBtn` declaration):
```typescript
function toggleSolo(): void {
  soloActive = !soloActive;
  soloBtn.classList.toggle('solo-active', soloActive);
  if (soloActive) {
    audio.setSoloVoice(selection.voiceId);
  } else {
    audio.setSoloVoice(undefined);
  }
  needsRender = true;
}

soloBtn.addEventListener('click', toggleSolo);
```

3. Update the existing selection effect (lines 65-69) to also push solo state:
```typescript
effect(() => {
  toolbar.selectedId = selection.voiceId;
  toolbar.updateBottomBar();
  toolbar.syncToSelectedShape();
  if (soloActive) {
    audio.setSoloVoice(selection.voiceId);
  }
});
```

4. Update the render call at line 168 to pass `soloVoiceId`:
```typescript
const soloId = soloActive ? selection.voiceId : undefined;
render(svgCanvas, store.data, selection.voiceId, soloId);
```

5. Pass `toggleSolo` to keyboard shortcuts. Update the `bindKeyboardShortcuts` call (lines 238-248):
```typescript
bindKeyboardShortcuts({
  isSplashActive: () => splash.isActive,
  playback,
  requestRender: () => {
    needsRender = true;
  },
  selection,
  store,
  toolbar,
  toggleSolo,
  undo,
});
```

- [ ] **Step 5: Add S keyboard shortcut**

In `js/keyboard.ts`:

1. Add `toggleSolo` to the deps type (line 21-28):
```typescript
export function bindKeyboardShortcuts(deps: {
  store: SigilStore;
  undo: UndoManager;
  selection: SelectionManager;
  toolbar: KeyboardToolbar;
  playback: PlaybackController;
  requestRender: () => void;
  isSplashActive: () => boolean;
  toggleSolo: () => void;
}): void {
```

2. Destructure `toggleSolo` from deps at line 30:
```typescript
const { store, undo, selection, toolbar, playback, requestRender, isSplashActive, toggleSolo } = deps;
```

3. Add the S shortcut after the space bar handler (after line 114):
```typescript
    if (e.key === 's' && !mod) {
      toggleSolo();
    }
```

- [ ] **Step 6: Run typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `bun run test:unit`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add index.html css/style.css js/app.ts js/keyboard.ts
git commit -m "Add solo toggle button with keyboard shortcut S (#135)"
```

---

## Chunk 4: Selection Cycling via Double-Click

### Task 4: Stop reconciler from enforcing DOM order on existing voice groups

The SVG reconciler (`reconcileVoices` in `render.ts` lines 367-378) re-sorts
existing voice groups to match the data array order on every frame. This would
immediately undo any DOM reorder from double-click cycling. Since voice order is
explicitly not data (blend modes are commutative), the reconciler doesn't need to
enforce it.

**Files:**
- Modify: `js/canvas/render.ts:335-383` (reconcileVoices)
- Test: `tests/unit/canvas-render.test.js`

- [ ] **Step 1: Write test verifying DOM order is preserved after rerender**

Add to the canvas render tests:

```javascript
test('reconciler does not reorder existing voice groups', () => {
  const svg = createSVG();
  const state = makeState({
    voices: [
      makeSineVoice({ id: 'a' }),
      makePulseVoice({ id: 'b' }),
    ],
  });

  // Initial render — groups in data order: a, b
  render(svg, state, undefined);
  const voiceLayer = svg.querySelector('g[data-layer="voices"]');
  const groups = () =>
    [...voiceLayer.querySelectorAll('g[data-voice-id]')].map(
      (g) => g.dataset.voiceId,
    );
  expect(groups()).toEqual(['a', 'b']);

  // Manually reorder: move 'a' to back (simulating double-click cycle)
  const groupA = voiceLayer.querySelector('g[data-voice-id="a"]');
  voiceLayer.prepend(groupA);
  expect(groups()).toEqual(['a', 'b']); // a is now first (back of SVG)

  // Re-render — reconciler should NOT move groups back to data order
  render(svg, state, undefined);
  expect(groups()).toEqual(['a', 'b']); // order preserved
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:unit -- tests/unit/canvas-render.test.js`
Expected: FAIL — reconciler moves groups back to data order

- [ ] **Step 3: Remove DOM reordering of existing groups**

In `js/canvas/render.ts`, in `reconcileVoices` (lines 367-378), remove the
existing-group reordering logic. Replace lines 367-378:

```typescript
    } else {
      // Ensure correct order
      const expectedNext: ChildNode | null = prevGroup
        ? prevGroup.nextSibling
        : voiceLayer.firstChild;
      if (group !== expectedNext) {
        if (prevGroup?.nextSibling) {
          prevGroup.nextSibling.before(group);
        } else {
          voiceLayer.prepend(group);
        }
      }
    }
```

With just:

```typescript
    }
```

Also update the comment on line 352 from:
```typescript
  // Add or update groups for each voice (in order, so z-order matches array order)
```
To:
```typescript
  // Add or update groups for each voice (new groups inserted near siblings;
  // existing groups keep their current DOM position — voice order is not data)
```

The `prevGroup` tracking for new group insertion still works — new groups are
inserted relative to the previous voice's group (which is looked up by ID, not
assumed to be adjacent). Existing groups keep whatever DOM position they have.

- [ ] **Step 4: Run tests**

Run: `bun run test:unit -- tests/unit/canvas-render.test.js`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add js/canvas/render.ts tests/unit/canvas-render.test.js
git commit -m "Stop reconciler from enforcing voice DOM order (#135)"
```

---

### Task 5: Add double-click and force-press event handlers

**Files:**
- Modify: `js/canvas/interaction.ts:212-226` (bindEvents/dispose), add handler method

- [ ] **Step 1: Add the cycle handler method to `CanvasInteractionController`**

In `js/canvas/interaction.ts`:

1. Add a bound handler field after `boundAreaPointerDown` (line 192):
```typescript
  private boundCycleSelection: (e: MouseEvent) => void;
  private boundForcePressCycle: (e: Event) => void;
```

2. Initialize in constructor (after line 209):
```typescript
    this.boundCycleSelection = this.handleCycleSelection.bind(this);
    this.boundForcePressCycle = (e: Event) =>
      this.handleCycleSelection(e as MouseEvent);
```

3. Add the handler method before `handleAreaPointerDown` (before line 230):
```typescript
  private handleCycleSelection(e: MouseEvent): void {
    const voiceEl = (e.target as Element).closest?.('[data-voice-id]');
    if (!voiceEl) return;

    const voiceLayer = this.canvas.querySelector('g[data-layer="voices"]');
    if (!voiceLayer) return;

    const group = voiceEl.closest('g[data-voice-id]') as SVGGElement | null;
    if (!group) return;

    // Send topmost shape to back
    voiceLayer.prepend(group);

    // Find what's now on top at this point
    const newTop = document.elementFromPoint(e.clientX, e.clientY);
    const newVoiceEl = newTop?.closest?.('[data-voice-id]');
    const newId = newVoiceEl
      ? ((newVoiceEl as HTMLElement).dataset.voiceId ?? undefined)
      : undefined;

    if (newId && newId !== group.dataset.voiceId) {
      this.selection.select(newId);
    }
    // If same element or no element, the shape stays selected (no-op)

    this.requestRender();
  }
```

4. Bind in `bindEvents()` — add after line 217:
```typescript
    this.canvas.addEventListener('dblclick', this.boundCycleSelection);
    this.canvas.addEventListener('webkitmouseforcedown', this.boundForcePressCycle);
```

5. Unbind in `dispose()` — add after line 225:
```typescript
    this.canvas.removeEventListener('dblclick', this.boundCycleSelection);
    this.canvas.removeEventListener('webkitmouseforcedown', this.boundForcePressCycle);
```

- [ ] **Step 2: Run typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `bun run test:unit`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add js/canvas/interaction.ts
git commit -m "Add double-click and force-press selection cycling (#135)"
```

---

## Chunk 5: Manual Testing, Docs & Polish

### Task 6: Manual verification and final commit

- [ ] **Step 1: Start dev server**

Run: `bun run dev`

- [ ] **Step 2: Manual test checklist**

In the browser at `localhost:5173`:

1. Create 2-3 shapes
2. Click the S button — verify it glows (solo-active)
3. Select a shape — verify other shapes dim and only the selected voice plays
4. Change selection — verify solo follows
5. Deselect — verify all voices play
6. Press S key — verify solo toggles
7. Stop and restart playback — verify solo persists
8. Delete soloed voice — verify all voices unmute
9. Create overlapping shapes — double-click to cycle through them
10. Force-press (if on Mac with Force Touch trackpad) to cycle
11. Verify portrait and landscape layout of solo button beside play button

- [ ] **Step 3: Update CLAUDE.md**

Update these sections of `CLAUDE.md`:

1. In **Key Concepts** under play modes, add: "solo (mute all except selected)"
2. In **Key Concepts**, add a bullet for **Solo** describing the S button, `S`
   key, and ephemeral state behavior
3. In **Key Concepts** under the canvas frame section, note the double-click /
   force-press selection cycling for overlapping shapes
4. In **Project Structure**, add `stage-controls` wrapper note to the HTML
   structure description
5. In **Code Conventions**, note that voice DOM order is not enforced by the
   reconciler (it was already stated that ordering is not data, but now the
   reconciler explicitly respects this)

- [ ] **Step 4: Run full CI checks**

Run: `bun run check && bun run lint && bun run test`
Expected: All PASS

- [ ] **Step 5: Final commit**

```bash
git add CLAUDE.md
git commit -m "Update CLAUDE.md with solo mode and selection cycling docs (#135)"
```
