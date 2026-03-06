# Total Refactor Postmortem

**NO GREAT DEED IS COMMEMORATED HERE.**

This document records what the March 2026 refactor revealed about the spatch
codebase — not to celebrate the work, but to warn future maintainers about the
forces that created the problem and will try to create it again.

---

## What Happened

Three files held 90% of the complexity:

| File | Lines | Concerns |
|------|-------|----------|
| `app.ts` | 1,253 | 14 distinct responsibilities, 17 mutable module-scope variables |
| `audio.ts` | 1,135 | Engine lifecycle, voice construction, pitch mapping, formant synthesis |
| `toolbar.ts` | 953 | 5 unrelated UI panels, color math, SVG icon construction |

Over 31 commits, these were decomposed into 36 focused modules totaling ~10,500
lines across `js/`, with 321 tests across 16 test files. A subsequent cleanup
pass consolidated 6 over-separated files and eliminated ~280 lines of code,
landing at 29 source files and ~5,250 lines of code with the same 298 tests.

The numbers don't matter. What matters is what we found inside.

---

## The Findings

### 1. The toolbar was the real monolith.

App.ts got the attention because it was the entry point. But toolbar.ts was doing
five unrelated jobs in one class: HSL↔RGB color picking, SVG icon construction,
border geometry, pattern selection, reverb controls. It took five panel
extractions plus shared DOM helpers to untangle.

App.ts, by contrast, was mostly wiring. Once its dependencies were extracted, it
shrank to 269 lines of legitimate orchestration with nothing left to remove.

**Lesson:** Entry points look complex because they touch everything. The real
monoliths are the utility classes that *do* everything. Watch the classes that
keep growing methods.

### 2. `syncToSelectedShape()` was invisible coupling.

This one method was called from six locations across three files. It was the
symptom of push-based state: "something changed, so poke the toolbar." A single
`effect()` in the toolbar constructor replaced every call.

The scattered invocations were load-bearing glue that no one would think to
audit. They only became visible when you tried to remove them.

**Lesson:** If you find yourself adding "and also update X" to the end of
multiple functions, you don't have a notification problem. You have a reactive
state problem. The fix is subscription, not fan-out.

### 3. Some complexity is irreducible.

The attempt to enforce `max-lines-per-function: 80` exposed this sharply.
`handlePointerDown` (155 lines, complexity 29) is a state machine dispatch.
`buildVoice` (195 lines) constructs a Web Audio graph node by node. Splitting
these into a dozen tiny functions doesn't reduce cognitive load — it rearranges
it, scattering related logic across a file to satisfy a counter.

The subagent dutifully broke these into helpers that were each called exactly
once, making the code harder to follow. We reverted the changes and doubled the
lint thresholds to serve as guardrails against regression, not mandates to
over-decompose.

**Lesson:** Lint rules can't distinguish "this function is too long because it
does too many things" from "this function is long because the thing it does is
genuinely complex." The former needs extraction. The latter needs a good comment
and a generous threshold. A 160-line state machine dispatch that you can read
top-to-bottom is better than eight 20-line functions you have to chase through.

**Addendum (cleanup pass):** The same force applies at the file level. The
refactor created four modules under 50 lines with single consumers:
`interaction.ts` (47 lines of types used only by `canvas/interaction.ts`),
`envelope.ts` (52 lines of geometry that shared constants with `shapes.ts`),
`state/selection.ts` (45 lines in its own subdirectory), `voice-types.ts`
(113 lines of types internal to voice-builder). These were merged back into
their natural neighbors — no file exceeded 530 lines. "Is this a different
concept?" is not the test for a file boundary. "Does this have different
consumers that change for different reasons?" is.

### 4. The audio module had natural seams. The canvas module didn't.

Audio split cleanly into engine (lifecycle), voice-builder (construction),
mapping (pure math), formants (filter banks). Each piece has a different rate
of change and a different set of consumers.

The canvas reconciler resisted. You can't meaningfully separate "create the
circle" from "update the circle" from "add its gradient" — they share element
references, ordering constraints, and a reconciliation loop. The 774-line file
is genuinely one concern.

**Lesson:** Not every large file is a monolith. A monolith is a file with
*unrelated* concerns that change for *different reasons*. A reconciler that's
large because reconciliation is large is just... a reconciler. The test for
"should I split this?" is not "is it long?" but "do different parts change at
different times for different reasons?"

### 5. The test gap was exactly where you'd expect.

Pure functions (mapping, serialize, state, envelope, colors) had solid coverage.
Everything that touches the DOM — canvas reconciler, toolbar panels, playback
controller — had zero tests. Writing canvas reconciler tests also uncovered a
Bun + happy-dom incompatibility (`SyntaxError` being `undefined` in happy-dom's
`Window` object, crashing every `querySelector` on SVG elements). That bug would
have bitten anyone who tried to add DOM tests later.

**Lesson:** "We'll add tests later" means "we'll never add tests." The hard part
isn't writing the test — it's setting up the test environment. If DOM testing
infrastructure doesn't exist, no one will create it just to test their one
change. Build the scaffold first.

### 6. The triple sec pattern was everywhere, just unrecognized.

Icon button creation (5 lines, 15+ occurrences). SVG element construction
(3 lines, 20+ occurrences). Expansion panel open/close (8 lines, 5 occurrences).
These became `createIconButton()`, `svgEl()`, and the `ExpansionPanel` interface.

The duplication was invisible because it was spread across one 953-line file.
You couldn't see the pattern without splitting the file first.

**Lesson:** Duplication hides in monoliths. You can't DRY what you can't see.
Extraction reveals patterns; patterns enable extraction. This is a virtuous
cycle, but only if you start it.

**Addendum (cleanup pass):** Duplication also hides in sprawl. After the
refactor, the SVG namespace string `'http://www.w3.org/2000/svg'` was defined
as a constant in 3 files and inlined in 4 more. `document.createElementNS` +
`setAttribute` appeared ~25 times across 7 files. No single file had enough
repetition to trigger alarm — the triple sec rule only fired when applied
*across* the codebase, not within files. A shared `svgEl()` in `dom.ts`
replaced all of it. Apply the rule globally, not locally.

### 7. Selection state was a hidden dependency hub.

Selection isn't in the store (correctly — it doesn't serialize and doesn't
participate in undo). But the old `onSelectionChange` callback was threaded
through four constructors and triggered six different side effects: toolbar
sync, canvas rendering, keyboard delete context, interaction drag origin,
bottom bar visibility, and undo snapshot timing.

Making selection signal-based revealed how many consumers depended on it.
A `select()` call wasn't just "highlight this shape" — it was the start of
a cascade through half the app.

**Lesson:** State that lives outside the store is still state. If it has more
than two consumers, it needs the same reactive infrastructure as store state.
"It's just a variable" is a lie you tell yourself until you find it threaded
through four constructors.

### 8. Dependency injection of pure functions is wasted abstraction.

`rotationToTimbre` and `snapYToNote` were passed through the
`InteractionDeps` interface, stored as class fields, and called as
`this.rotationToTimbre(...)`. This added 4 interface declarations, 4 class
fields, and 4 constructor assignments — for stateless math functions with no
side effects, no state, and no reason to ever be substituted.

DI exists to swap behavior: mock a database, stub a network call, inject a
test clock. Pure functions have no behavior to swap. They're already
independently testable via direct import. Injecting them adds interface
surface area that makes the dependency graph harder to read without making
anything easier to test.

**Lesson:** Only inject things that need to vary. If a function is pure and
its module has no side effects, import it directly. The `deps` bag is for
things with lifecycle, state, or identity — not for `Math.sin`.

---

## How the Monoliths Formed

None of this was incompetence. The monoliths formed through reasonable local
decisions:

1. A new feature needs toolbar UI → add a method to `Toolbar`.
2. That method needs color math → add a helper to the same file.
3. The helper is only used here → no reason to extract it yet.
4. Next feature needs similar UI → copy the pattern, tweak it.
5. Now there are five copies, but they're all in one file, so the duplication
   is invisible.
6. The file hits 953 lines. Everyone feels the pain but no one can justify
   "just refactoring" because the feature backlog is long.

This is the default trajectory of every codebase. The only defense is active
maintenance: extract when you see the pattern, not when the pain forces you.

---

## The Guardrails

The refactor installed these defenses against recurrence:

| Rule | Threshold | Purpose |
|------|-----------|---------|
| `max-lines` | 800 | Catches file bloat before it reaches monolith scale |
| `max-lines-per-function` | 160 | Flags functions that probably do too many things |
| `max-depth` | 8 | Prevents deeply nested conditionals |
| `complexity` | 30 | Catches genuinely tangled logic |
| `max-params` | 4 | Forces the `deps: { ... }` pattern |
| JSDoc rules | on | Enforces well-formed docs (not requiring them — yet) |
| CI summary | on | Prints file sizes in every PR |

These are guardrails, not goals. A 160-line function that does one thing well
is fine. A 50-line function that does three things badly is not. The numbers
catch the obvious regressions; code review catches the subtle ones.

---

## What We'd Do Differently

1. **Verify committed state, not working tree.** Subagents created files and
   reported "tests pass" against the working tree — but forgot to `git add` new
   files. The committed state was broken for days before anyone noticed. Every
   commit step should include `git status` as a post-condition.

2. **Set lint thresholds from reality, not aspiration.** The plan specified 80
   lines per function and 400 lines per file. Reality needed 160 and 800. Start
   from what the codebase actually looks like after the refactor, then tighten
   over time. Aspirational thresholds just teach people to ignore the linter.
   Worse, they create pressure to split files that shouldn't be split — the
   four over-separated modules merged back in the cleanup pass were partly a
   consequence of chasing a 400-line file limit.

3. **Extract tests alongside modules.** We deferred all test writing to Phase 7.
   This meant the test environment setup (happy-dom, SVG mocking, the
   SyntaxError workaround) happened at the end, when it should have been
   scaffolded at the start.

---

*This file is a signpost for future maintainers. If you're reading it because
a file is getting too large, you already know what to do. If you're reading it
because someone told you "don't worry, we'll refactor later" — this is what
"later" looks like. It's 31 commits, two weeks, and a postmortem document.*
