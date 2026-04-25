# FM Taming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tame the FM blend modes (`multiply`, `exclusion`, `difference`) — make them audibly subtler and more musically usable while keeping all four blend modes (including `screen`) distinguishable.

**Architecture:** Two-part audio-graph change, no state or serialization touched: (1) lower the `FM_PARAMS` modulation indices and global deviation cap in `js/effects.ts`; (2) insert a fixed-cutoff lowpass `BiquadFilterNode` between the modulator signal and the carrier-frequency path in each FM connection in `js/audio/engine.ts`. Feedback path stays un-filtered.

**Tech Stack:** TypeScript, Web Audio API (`BiquadFilterNode`, `GainNode`, `AudioContext`), Bun (unit tests), Playwright (audio snapshots via `OfflineAudioContext`).

**Spec:** `docs/plans/2026-04-16-fm-taming-design.md`

**Branch:** `fm-taming-349` (already created, spec already committed).

---

## File Map

- **Modify:** `js/effects.ts`
  - Update `FM_PARAMS` values (multiply, exclusion, difference).
  - Lower `MAX_FM_DEVIATION`.
  - Export new `FM_MODULATOR_LPF_HZ` and `FM_MODULATOR_LPF_Q` constants.
- **Modify:** `js/audio/engine.ts`
  - Add `modLowpass: BiquadFilterNode` to `FMConnection` interface.
  - Insert `BiquadFilterNode` between modulator and depth gain in `_createFMConnection`.
  - Disconnect the lowpass in `_disposeFMConnection`.
  - Import the two new constants from `../effects.ts`.
- **Modify:** `tests/unit/effects.test.js`
  - Add `describe('computeFMDepth', …)` block with numeric assertions.
- **Regenerate (no hand edits):** `tests/integration/audio-snapshot.test.js-snapshots/*fm*.png`, `*blend-mode-switching*.png`.

No new files.

---

## Task 1: Add `computeFMDepth` unit tests (TDD, fails on `main`)

**Files:**
- Modify: `tests/unit/effects.test.js` (append new describe block at end)

**Rationale:** We have zero numeric regression coverage on `computeFMDepth`. Write the tests in terms of the NEW target values so Task 2's parameter change flips them from red to green. This is genuine TDD: the test drives the value change.

- [ ] **Step 1: Append the new describe block**

Edit `tests/unit/effects.test.js`. Change the import to also pull in `computeFMDepth` and `FM_PARAMS`:

```javascript
import { describe, expect, test } from 'bun:test';
import {
  computeFMDepth,
  computeOverlap,
  computeTotalOverlap,
  FM_PARAMS,
} from '../../js/effects.ts';
```

Append this `describe` block at the end of the file:

```javascript
describe('FM_PARAMS', () => {
  test('screen has zero modulation index', () => {
    expect(FM_PARAMS.screen.maxIndex).toBe(0);
  });

  test('modes are ordered multiply < exclusion < difference by intensity', () => {
    expect(FM_PARAMS.multiply.maxIndex).toBeLessThan(FM_PARAMS.exclusion.maxIndex);
    expect(FM_PARAMS.exclusion.maxIndex).toBeLessThan(FM_PARAMS.difference.maxIndex);
  });

  test('all non-screen modes stay below tamed ceiling', () => {
    // After taming, the loudest mode should be well below the old 1.8.
    expect(FM_PARAMS.multiply.maxIndex).toBeLessThanOrEqual(0.35);
    expect(FM_PARAMS.exclusion.maxIndex).toBeLessThanOrEqual(0.6);
    expect(FM_PARAMS.difference.maxIndex).toBeLessThanOrEqual(0.9);
  });

  test('difference feedback is reduced but still present', () => {
    expect(FM_PARAMS.difference.feedback).toBeGreaterThan(0);
    expect(FM_PARAMS.difference.feedback).toBeLessThanOrEqual(0.1);
  });
});

describe('computeFMDepth', () => {
  test('returns 0 when overlap is 0', () => {
    expect(computeFMDepth(0, FM_PARAMS.multiply, 440)).toBe(0);
    expect(computeFMDepth(0, FM_PARAMS.difference, 440)).toBe(0);
  });

  test('is monotonic non-decreasing in overlap', () => {
    const steps = [0, 0.1, 0.25, 0.5, 0.75, 1];
    for (const mode of ['multiply', 'exclusion', 'difference']) {
      const depths = steps.map((o) => computeFMDepth(o, FM_PARAMS[mode], 440));
      for (let i = 1; i < depths.length; i++) {
        expect(depths[i]).toBeGreaterThanOrEqual(depths[i - 1]);
      }
    }
  });

  test('respects the global deviation cap', () => {
    // Cap should hold even for high modulator frequency and full overlap.
    const highFreq = 784; // ~G5, top of melodic range
    const d = computeFMDepth(1, FM_PARAMS.difference, highFreq);
    expect(d).toBeLessThanOrEqual(600);
  });

  test('at full overlap, difference > exclusion > multiply', () => {
    const m = computeFMDepth(1, FM_PARAMS.multiply, 200);
    const e = computeFMDepth(1, FM_PARAMS.exclusion, 200);
    const d = computeFMDepth(1, FM_PARAMS.difference, 200);
    expect(e).toBeGreaterThan(m);
    expect(d).toBeGreaterThan(e);
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail on current `main` values**

Run: `bun test tests/unit/effects.test.js`

Expected: the "FM_PARAMS" ceiling and feedback tests FAIL (current values are 0.8 / 1.2 / 1.8 and feedback 0.2). The deviation-cap test also FAILS (current cap is 2000 Hz). The monotonicity and ordering tests PASS on both old and new values — those are structural invariants we don't want to break.

This is the red phase. Do not proceed to green until you've confirmed the expected failures.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/effects.test.js
git commit -m "test: add FM_PARAMS and computeFMDepth numeric guards (#349)"
```

---

## Task 2: Update `FM_PARAMS` and `MAX_FM_DEVIATION` (test turns green)

**Files:**
- Modify: `js/effects.ts:25-33`

- [ ] **Step 1: Update parameters and cap**

In `js/effects.ts`, replace the `FM_PARAMS` object and the `MAX_FM_DEVIATION` constant:

```typescript
/** FM parameters indexed by blend mode. */
export const FM_PARAMS: Record<BlendMode, FMParams> = {
  screen: { maxIndex: 0, depthCurve: 'linear', feedback: 0 },
  multiply: { maxIndex: 0.25, depthCurve: 'sqrt', feedback: 0 },
  exclusion: { maxIndex: 0.45, depthCurve: 'linear', feedback: 0 },
  difference: { maxIndex: 0.7, depthCurve: 'linear', feedback: 0.08 },
};

/** Max frequency deviation in Hz to prevent extreme high-ratio FM from sounding harsh. */
const MAX_FM_DEVIATION = 600;
```

Note: keep the existing doc comments above each declaration; do not delete them.

- [ ] **Step 2: Run unit tests to confirm green**

Run: `bun test tests/unit/effects.test.js`

Expected: all tests in `effects.test.js` PASS, including the FM_PARAMS and computeFMDepth describe blocks.

- [ ] **Step 3: Run the full unit suite as a sanity check**

Run: `bun run test:unit`

Expected: all unit tests pass. (`audio-engine.test.js` and `blend-visual.test.js` don't depend on these numeric values and should be unaffected.)

- [ ] **Step 4: Commit**

```bash
git add js/effects.ts
git commit -m "fix: tame FM blend modulation depth (#349)

Lower maxIndex across the three non-screen modes (multiply 0.8→0.25,
exclusion 1.2→0.45, difference 1.8→0.7) and cut the global deviation
cap from 2000 Hz to 600 Hz. Difference feedback 0.2→0.08.

First of a two-part fix; the second part filters harsh modulator
harmonics at the source (see next commit)."
```

---

## Task 3: Export lowpass constants from `js/effects.ts`

**Files:**
- Modify: `js/effects.ts` (after `MAX_FM_DEVIATION` declaration)

- [ ] **Step 1: Append the two constants**

Add directly below the `MAX_FM_DEVIATION` line:

```typescript
/**
 * Modulator lowpass cutoff, Hz.
 * Passes the full melodic range (≤~784 Hz fundamentals) and attenuates
 * 3rd+ harmonics of non-sine modulators, which are the dominant source
 * of FM harshness.
 */
export const FM_MODULATOR_LPF_HZ = 1800;

/** Butterworth Q — flat passband, no resonance peak. */
export const FM_MODULATOR_LPF_Q = 0.7071;
```

- [ ] **Step 2: Typecheck**

Run: `bun run check`

Expected: no errors.

- [ ] **Step 3: Do NOT commit yet**

Leave this staged but un-committed. Task 4 depends on these constants and we want a single coherent commit for the lowpass feature.

---

## Task 4: Insert modulator lowpass in FM connections

**Files:**
- Modify: `js/audio/engine.ts:9` (import)
- Modify: `js/audio/engine.ts:31-34` (`FMConnection` interface)
- Modify: `js/audio/engine.ts:462-470` (`_disposeFMConnection`)
- Modify: `js/audio/engine.ts:563-589` (`_createFMConnection`)

- [ ] **Step 1: Update the import**

Change line 9 of `js/audio/engine.ts` from:

```typescript
import { computeOverlap, FM_PARAMS, computeFMDepth } from '../effects.ts';
```

to:

```typescript
import {
  computeFMDepth,
  computeOverlap,
  FM_MODULATOR_LPF_HZ,
  FM_MODULATOR_LPF_Q,
  FM_PARAMS,
} from '../effects.ts';
```

- [ ] **Step 2: Add `modLowpass` to `FMConnection`**

Change the `FMConnection` interface (around line 30–34) from:

```typescript
/** A cross-voice FM connection: top voice modulates bottom voice's frequency. */
interface FMConnection {
  depthGain: GainNode;
  feedbackGain: GainNode | undefined;
}
```

to:

```typescript
/** A cross-voice FM connection: top voice modulates bottom voice's frequency. */
interface FMConnection {
  modLowpass: BiquadFilterNode;
  depthGain: GainNode;
  feedbackGain: GainNode | undefined;
}
```

- [ ] **Step 3: Disconnect the lowpass on teardown**

In `_disposeFMConnection` (around line 462–470), add one `safeDisconnect` call:

```typescript
/** Tear down a single FM connection, silencing it first to avoid clicks. */
private _disposeFMConnection(conn: FMConnection): void {
  conn.depthGain.gain.value = 0;
  safeDisconnect(conn.depthGain);
  safeDisconnect(conn.modLowpass);
  if (conn.feedbackGain) {
    conn.feedbackGain.gain.value = 0;
    safeDisconnect(conn.feedbackGain);
  }
}
```

- [ ] **Step 4: Build the lowpass into the FM graph**

Replace the body of `_createFMConnection` (around line 563–589) with:

```typescript
/** Create a single FM connection: modulator oscillator → lowpass → depth → carrier frequency. */
private _createFMConnection(
  ctx: AudioContext,
  blend: BlendMode,
  modulatorAudio: AudioVoice,
  carrierAudio: AudioVoice,
): FMConnection {
  const params = FM_PARAMS[blend];
  const modLowpass = new BiquadFilterNode(ctx, {
    type: 'lowpass',
    frequency: FM_MODULATOR_LPF_HZ,
    Q: FM_MODULATOR_LPF_Q,
  });
  const depthGain = new GainNode(ctx, { gain: 0 });
  const modulatorNode = modulatorAudio.getModulatorNode();
  const carrierParams = carrierAudio.getCarrierFrequencyParams();

  modulatorNode.connect(modLowpass);
  modLowpass.connect(depthGain);
  for (const freqParam of carrierParams) {
    depthGain.connect(freqParam);
  }

  // Self-modulation feedback — kept on the raw modulator signal.
  // Filtering the feedback path would alter feedback dynamics, not the
  // harshness of the emitted sound.
  let feedbackGain: GainNode | undefined;
  if (params.feedback > 0) {
    feedbackGain = new GainNode(ctx, { gain: 0 });
    modulatorNode.connect(feedbackGain);
    feedbackGain.connect(modulatorNode.frequency);
  }

  return { modLowpass, depthGain, feedbackGain };
}
```

- [ ] **Step 5: Typecheck + unit tests**

Run: `bun run check && bun run test:unit`

Expected: both pass. `audio-engine.test.js` verifies FM graph construction structurally; it should still pass because `FMConnection` is internal and the public surface of the engine is unchanged.

- [ ] **Step 6: Commit parameters + lowpass together**

This commit includes both Task 3's still-staged constants and Task 4's engine changes.

```bash
git add js/effects.ts js/audio/engine.ts
git commit -m "fix: lowpass the FM modulator signal (#349)

Insert a fixed 1800 Hz / Q=0.7071 biquad lowpass between the
modulator output and the depth gain in each FM connection. The
cutoff sits above the entire melodic range so every modulator's
fundamental passes cleanly, while progressively attenuating the
3rd+ harmonics of pulse and astroid modulators — the dominant
source of FM harshness.

Feedback path is kept on the raw modulator signal."
```

---

## Task 5: Smoke-test by ear in the dev server

**Files:** none (manual verification)

- [ ] **Step 1: Start the dev server**

Run: `bun run dev`

Open `http://localhost:5173` in Chrome.

- [ ] **Step 2: Construct a minimal FM test sigil**

- Click the randomize tool until you get two overlapping voices of differing waveforms — ideally one pulse/astroid on top of one sine/blend.
- Drag them so they clearly overlap (~50% overlap).
- Press play/latch so the sound sustains.

- [ ] **Step 3: Cycle through blend modes**

Long-press the blend-mode button in the toolbar and switch between `screen`, `multiply`, `exclusion`, `difference`. Listen for:

- `screen`: no FM (reference — should sound like clean mixed voices).
- `multiply`: just-audible FM coloring, closer to `screen` than before.
- `exclusion`: noticeably more modulation than `multiply`, not harsh.
- `difference`: the wildest but still musical, no nails-on-chalkboard.

- [ ] **Step 4: Stress-test with an extreme layout**

- Drag a large pulse-waveform voice to fully enclose a small sine voice (overlap → 1).
- Set difference blend.
- Play.

Expected: rich, slightly bell-like FM but NOT the harsh roar the current `main` produces in this configuration.

- [ ] **Step 5: Decide whether to tune**

If the result feels right, proceed to Task 6.

If it feels **too tame**, raise proportionally: e.g., `multiply → 0.3`, `exclusion → 0.55`, `difference → 0.85`. Do NOT raise `MAX_FM_DEVIATION` unless you hear a plateau (a distinct point where increasing overlap stops increasing brightness).

If it feels **still harsh** at low overlap, lower `FM_MODULATOR_LPF_HZ` to 1400 before touching depth again — harshness at low overlap is a spectrum problem, not a depth problem.

Any tuning changes go in a follow-up amendment to the relevant commit — do NOT bury them in the "update snapshots" commit. If you make tuning changes, re-run Tasks 2 and 4 step 5 (tests) to confirm the ceilings in `effects.test.js` still hold.

- [ ] **Step 6: Stop the dev server**

`Ctrl+C` in the dev server terminal.

---

## Task 6: Regenerate audio snapshot baselines

**Files:**
- Regenerate: `tests/integration/audio-snapshot.test.js-snapshots/fm-*.png` (both `-chromium` and `-webkit` variants)
- Regenerate: `tests/integration/audio-snapshot.test.js-snapshots/blend-mode-switching-*.png`
- Verify unchanged: `tests/integration/audio-snapshot.test.js-snapshots/screen-no-fm-overlap-*.png` (should NOT change — FM path is bypassed when `maxIndex <= 0`)

- [ ] **Step 1: Update snapshots**

Run: `bun run test:e2e -- --update-snapshots`

This regenerates every snapshot. That's fine — only the FM-affected ones should actually change bytes; the rest will be rewritten identically.

- [ ] **Step 2: Review the diff**

Run: `git status` and `git diff --stat tests/integration/audio-snapshot.test.js-snapshots/`

Expected changes (both `-chromium` and `-webkit`):
- `fm-multiply-overlap.png` — changed
- `fm-difference-overlap.png` — changed
- `fm-move-into-overlap.png` — changed
- `blend-mode-switching.png` — changed
- Possibly `fm-multiply-no-overlap.png` — unchanged (no FM at zero overlap; the filter is created per-connection and connections only exist when overlap > 0)

Expected NOT to change:
- `screen-no-fm-overlap.png` — unchanged (screen mode early-exits before any FM node construction)
- All non-blend snapshots (`sine-voice`, `triangle-voice`, `astroid-*`, `high-pitch`, `low-pitch`, envelope tests, etc.)

If a non-FM baseline changed, STOP and investigate — it means the change bled into the single-voice signal path, which would be a bug.

- [ ] **Step 3: Verify the e2e suite is green**

Run: `bun run test:e2e`

Expected: all tests pass against the new baselines.

- [ ] **Step 4: Commit the baselines**

```bash
git add tests/integration/audio-snapshot.test.js-snapshots/
git commit -m "test: rebaseline FM audio snapshots (#349)

Expected diff from the FM taming: lower-energy spectra in multiply,
exclusion, difference, and blend-mode-switching tests. Non-FM
baselines (screen, single-voice waveforms) unchanged."
```

---

## Task 7: Frequency profile regression check

**Files:** none (runs the existing `scripts/audio-profile.js`, writes to gitignored `tmp/`)

This is required by CLAUDE.md's audio regression rule whenever cross-cutting audio behavior changes.

- [ ] **Step 1: Profile the PR branch**

```bash
bun run dev &
DEV_PID=$!
sleep 3   # give Vite time to boot
node scripts/audio-profile.js fm-taming-pr
kill $DEV_PID
```

The script takes ~1 min; it drives the randomize button 30 times and profiles the average spectrum.

- [ ] **Step 2: Profile `main` for comparison**

```bash
git stash push --include-untracked -m "fm-taming wip"
git checkout main
bun run dev &
DEV_PID=$!
sleep 3
node scripts/audio-profile.js fm-taming-main
kill $DEV_PID
git checkout fm-taming-349
git stash pop
```

- [ ] **Step 3: Diff the band summaries**

Run: `diff tmp/audio-profiling-fm-taming-main/band-summary.txt tmp/audio-profiling-fm-taming-pr/band-summary.txt`

Expected: the random-spatch distribution is dominated by non-FM voice pairings (overlapping pairs are uncommon in random output), so band levels should be close to main — well within the 5 dB per-band tolerance. The PR's himid/treble bands may sit 1–3 dB lower due to reduced FM sideband energy in the rare overlapping randoms.

If any band shifts by more than 5 dB, STOP and investigate. A big shift on random-spatch averages implies the change is leaking into the non-FM path.

- [ ] **Step 4: No commit**

The profile output lives in `tmp/` which is gitignored. Results are for your review only.

---

## Task 8: Pre-push CI check and push

**Files:** none

Per CLAUDE.md's mandatory pre-push checklist.

- [ ] **Step 1: Verify rebase status**

Run: `git fetch origin main && git log HEAD..origin/main --oneline`

Expected: no output. If there's output, rebase: `git rebase origin/main`, then re-run Tasks 2, 4, and 6's test steps.

- [ ] **Step 2: Run the full check suite**

```bash
bun run fmt
bun run lint
bun run check
bun run test:unit
bun run test:e2e
```

Expected: every step exits 0. If anything fails, fix it before proceeding.

- [ ] **Step 3: Push the branch**

Run: `git push -u origin fm-taming-349`

Expected: lefthook pre-push hook passes; push succeeds.

---

## Task 9: Open pull request

**Files:** none

- [ ] **Step 1: Open the PR against Gitea**

Use the Gitea MCP (`mcp__gitea__pull_request_write`). Do NOT use `gh` CLI — repo is on Gitea.

- Owner: `zetlen`
- Repo: `spatch`
- Base: `main`
- Head: `fm-taming-349`
- Title: `fix: tame FM blend harshness`
- Body:

```markdown
Closes #349.

Two-part fix for harsh FM blend modes:

1. **Lower modulation depth.** `FM_PARAMS.maxIndex` drops across all three
   non-screen modes (multiply 0.8→0.25, exclusion 1.2→0.45, difference
   1.8→0.7). `MAX_FM_DEVIATION` cap drops from 2000 Hz to 600 Hz.
   Difference feedback drops from 0.2 to 0.08.

2. **Lowpass the modulator signal.** A fixed 1800 Hz / Q=0.7071 biquad
   sits between the modulator oscillator and the carrier's frequency
   AudioParam in each FM connection. The cutoff passes every modulator
   fundamental (melodic range ≤~784 Hz) while culling the 3rd+ harmonics
   of pulse and astroid modulators — the dominant harshness source.

Feedback path is intentionally kept on the raw modulator signal;
filtering there changes feedback dynamics, not output harshness.

All four blend modes remain audibly distinct and ordered from subtle
to wildest. Inter-mode ratios roughly preserved.

Spec: `docs/plans/2026-04-16-fm-taming-design.md`
Plan: `docs/plans/2026-04-16-fm-taming-plan.md`

## Test plan

- [x] `bun run test:unit` — new `FM_PARAMS` and `computeFMDepth`
      numeric guards pass
- [x] `bun run test:e2e` — rebaselined FM and blend-mode-switching
      snapshots; non-FM snapshots unchanged
- [x] Frequency profile comparison (`scripts/audio-profile.js`): no
      band shifts >5 dB vs. `main` on random spatches
- [x] Manual smoke test: two overlapping voices, all four blend modes,
      each audibly distinct and not harsh
- [x] Edge case: large pulse fully enclosing small sine, difference
      blend — rich but not harsh
```

- [ ] **Step 2: Verify the PR is using squash merge**

In the Gitea PR metadata, confirm `merge_style` is `squash` (or that the repo enforces squash-only on `main`, which is the case here per CLAUDE.md).

---

## Self-Review Notes

**Spec coverage:**
- Parameter changes (§2 of spec) → Task 2.
- Modulator lowpass (§2 of spec) → Tasks 3 + 4.
- Feedback path unchanged (§2 of spec) → verified in Task 4 code.
- Unit tests for `computeFMDepth` (spec testing §) → Task 1.
- Snapshot rebaselining (spec testing §) → Task 6.
- Frequency profile (spec testing §) → Task 7.
- Manual cross-product check (spec testing §) → Task 5.

**Type consistency:** `modLowpass: BiquadFilterNode` used consistently in Task 4 steps 2, 3, and 4. Constants `FM_MODULATOR_LPF_HZ` and `FM_MODULATOR_LPF_Q` named identically in Task 3 and Task 4.

**Placeholder scan:** No TBDs; all code shown in full; all commands spelled out. The Task 5 tuning branch is a genuine judgment call with specific fallback numbers, not a "tune later" placeholder.
