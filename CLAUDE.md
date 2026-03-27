# CLAUDE.md — spatch

## Repository Origin

The canonical repo is on Gitea at `got.colonpipe.org`. Use the Gitea MCP tools
(`mcp__gitea__*`) for all repo interactions: PRs, issues, releases, etc. Do NOT
use `gh` CLI or GitHub MCP tools.

A GitHub remote may exist as a read-only mirror. PRs opened there are imported
into Gitea for review and merge.

## Branch Rebase Rule

Working branches must be fully rebased on `origin/main`. Check at session
start and before every push:

```bash
git fetch origin main && git log HEAD..origin/main --oneline
```

If this produces any output, stop and rebase before doing other work:
`git rebase origin/main` — then verify build and tests still pass.

If the branch is behind `origin/main`, confirm with the user before proceeding.
The lefthook `pre-push` hook also blocks pushes of stale branches.

## What This Is

spatch is a browser instrument. You compose visual sigils from geometric shapes
and hear them as synthesized chords. Every visual property maps to an audio parameter.

## Project Structure

```
package.json         Package manifest (Bun)
bun.lock             Lockfile
vite.config.ts       Vite build/dev (plugins, MPA input)
playwright.config.ts Playwright config (Chromium + WebKit, no Firefox)
nginx.conf           nginx: SPA fallback, security headers, cache headers
tsconfig.json        TypeScript config
bunfig.toml          Bun config
.oxfmtrc.json        oxfmt config
oxlint.config.mjs    oxlint config
vite.d.ts            Vite asset import declarations
.mise.toml           mise tool versions (Bun, Node)
README.md            Developer instructions
LICENSE              GPLv3
public/
  favicon.ico        App favicon (ICO)
  favicon.svg        App favicon (SVG)
index.html           Main app entry point
embed.html           Standalone embed viewer (reads state from URL pathname)
css/style.css        All styles (CSS custom properties, flat hybrid-bevel theme)
scripts/
  vite-plugin-svg-sprite.ts  Vite plugin: icon refs → SVG sprite → inline HTML
js/
  dom.ts             qel() typed querySelector; selection handle factories
  types.ts           Branded primitives, Voice/Fill unions, Envelope
  state.ts           SigilStore, UndoManager, SelectionManager
  app.ts             Entry point: init, event wiring, render loop
  embed-entry.ts     Entry point for embed.html
  keyboard.ts        Global keyboard shortcuts
  playback.ts        PlaybackController: play/stop/latch/loop/solo
  splash.ts          SplashController: splash screen state machine
  canvas/
    render.ts        SVG DOM reconciler (voices, selection UI)
    interaction.ts   Pointer/touch input, InteractionState state machine
  audio/
    engine.ts        AudioEngine: Web Audio lifecycle, voice management
    sample-loader.ts Two-layer cache: fetchSample (bytes) + decodeSample (AudioBuffer)
    mapping.ts       Audio mapping (pitch, pan, gain, timbre, formants)
    node-utils.ts    Pure audio utilities (no vibe/waveform imports)
    voice-builder.ts Voice audio graph plumbing (formants, effects, borders)
    vibe.ts          Vibe class: gain curves, reverb, EQ, compression, synthesis
    formants.ts      Formant filter bank for fill-driven vowel synthesis
  voices/
    types.ts         Delegate interfaces (VoiceUI, VoicePlayer, VoiceSerializer),
                     AudioVoice, AudioSharedNodes
    registry.ts      Voice type registry: get(), getById(), all(), createVoice()
    b64.ts           Base64 encode/decode utilities
    serializers/
      oscillator.ts  Shared register serializer (sine, pulse, blend, astroid)
      sample.ts      Shared register serializer (stamp, future sample voices)
    sine/            Circle → sine oscillator (ui.ts, player.ts, index.ts)
    pulse/           Square → PWM oscillator (ui.ts, player.ts, index.ts)
    blend/           Triangle → saw/tri crossfade (ui.ts, player.ts, index.ts)
    astroid/         Astroid → 6-osc supersaw (ui.ts, player.ts, index.ts)
    stamp/           Stample → sample playback (ui.ts, player.ts, lifecycle.ts, index.ts)
  stamples/
    stample-types.ts Stample interface
    index.ts         STAMPLES registry, getStample(), resolve()
    <name>/          One per stample: index.ts, stamp.svg, sample.mp3
  scenes/
    scene-types.ts   Scene interface
    index.ts         SCENES registry, getScene(), applyScene(), initStageLayers()
    loader.ts        prefetchScene(), loadSceneIR(), preloadNextScene()
    <name>/          One per scene: index.ts, *.jpg, *.m4a (optional)
  toolbar/
    expansion-panel.ts  Panel lifecycle, PanelManager, bindLongPress
    toolbar.ts       Tool buttons, panel registration
    blend-panel.ts   Blend mode picker
    border-panel.ts  Border settings
    fill-panel.ts    Fill color/gradient picker
    pattern-panel.ts Pattern effect picker
    harmonize-panel.ts  Scale picker
    stage-panel.ts   Scene picker
    stample-panel.ts Stample picker
    dom-helpers.ts   createIconButton, svgEl helpers
  debug/
    vibe-tuner.ts    Hidden vibe tuner side drawer (behind URL param)
  harmony.ts         Randomize + harmonize (9 scales)
  shapes.ts          Resize/rotate math, ADSR corner conversion
  colors.ts          Color conversions (HSL↔RGB↔Hex), SVG gradient helpers
  patterns.ts        SVG pattern definitions (stripes, checker, noise, gradient)
  effects.ts         Audio effects, FM_PARAMS table, overlap computation
  serialize.ts       URL routing + Base64 serialization (/s/<data>)
  share.ts           Share overlay: link, embed snippet, live preview
  credits.ts         Credits overlay + audio muffling
  tutorial.ts        Interactive tutorial overlay
dist/                Build output (gitignored)
docs/                Design docs, diagrams
docs/plans/          Implementation plans (YYYY-MM-DD-{topic}-{design|plan}.md)
tests/
  unit/*.test.js              Unit tests (bun test, plain JS)
  integration/*.test.js       Playwright tests (Chromium + WebKit)
  integration/helpers/
    skip-splash.js            sessionStorage splash bypass
    audio-capture.js          OfflineAudioContext shim for deterministic audio
    audio-tap.js              Real-time audio amplitude tap
    seed-random.js            Deterministic Math.random
```

## How to Run

```bash
bun install          # install deps (MUST run before build/dev)
bun run build        # production build to dist/
bun run dev          # Vite dev server with HMR (port 5173)
bun run preview      # serve production build locally
bun run test         # unit + integration tests
bun run test:unit    # unit tests only (bun test)
bun run test:e2e     # integration tests only (Playwright, needs dev server)
bun run check        # typecheck (tsc --noEmit)
bun run lint         # lint (oxlint)
bun run fmt          # format (oxfmt)
```

`bun install` must be run before any scripts or changes — installed dependencies
are required for all scripts and commit hooks.

Pre-commit hooks (lefthook): auto-formats with oxfmt, fixes lint, runs tsc.

## CI/CD

- Gitea at `got.colonpipe.org`. Token: `$GITEA_ACCESS_TOKEN`.
- Runner: `mise-playwright` Docker image (mise, Playwright, browser deps,
  Courier New). Source: `../frontend-ci-image`.
- CI: `.gitea/workflows/ci.yml` on PRs — typecheck, lint, format, unit tests,
  e2e (Chromium + WebKit), build.
- Versioning: CalVer (`YYYY.MM.MICRO`), auto-bumped on deploy.
- Deploy: `.gitea/workflows/deploy.yml` on push to `main` or
  `workflow_dispatch`. Docker-copies `dist/` into nginx container, reloads.
  Runs typecheck + lint + unit tests but not e2e. Site: `https://spatch.music`.
- **Merge style: squash only.** The `main` branch is protected and only
  allows squash merges. Use `merge_style: "squash"` when merging via Gitea API.
- Bot user `tiene`: admin collaborator, whitelisted for direct push to
  protected `main`. Token in `PUSH_TOKEN` secret. Version bumps use `[skip ci]`.
- Gotcha: changing workflow triggers won't fire on the merge that introduces
  the change — Gitea evaluates from the target branch *before* merge lands.

## Architecture

### The Bijection Principle

**STRICT INVARIANT.** Every field in SigilData must affect both SVG rendering
and audio synthesis. No visual-only state. No hidden audio parameters.

- Two states that look identical MUST sound identical.
- Two states that sound identical MUST look identical.
- Visual equivalences (rotation symmetry) are collapsed by making audio mappings
  periodic with the shape's geometric symmetry.
- Violations must be **unrepresentable in the type system**, not merely
  discouraged by convention.

See `docs/plans/2026-03-01-bijective-audio-visual-design.md` for full rationale.

### State & Transforms

`SigilStore` is the single source of truth. Three domains — **Envelope**,
**Scene/Vibe**, **Voices** — each projected in three directions:

- **Interface** (two-way ↔): state ↔ DOM
- **Serializer** (two-way ↔): state ↔ URL (`/s/<base64data>`)
- **Audio** (one-way →): state → audio graph parameters

Interface and Serializer are bijective — every field must round-trip without
loss. Audio is one-way; there is no `audioToState()`.

The voice registry (`js/voices/registry.ts`) maps each waveform type to
three delegates — **UI** (SVG + interaction), **Player** (audio graph),
**Serializer** (register-based wire format). See
`docs/plans/2026-03-23-voice-delegates-design.md` for the full design.

**Ephemeral view state** (`PlaybackController`, `SelectionManager`,
`SplashController`) drives audio and DOM but is never serialized, no undo.

**Continuous gestures** call both the store and audio delegate as siblings in
the same handler — not via subscription. Audio param scheduling requires
`ctx.currentTime` at call site; render is RAF-based, reading state once/frame.

**Render loop**: `needsRender` flag + `requestAnimationFrame`. Set
`needsRender = true` or call `store._notify()` to trigger a redraw.

### Voice Fields

Voices are discriminated on `waveform`: sine (circle), pulse (square), blend
(triangle), astroid (astroid curve), stamp (stample silhouette). Every field
maps to both visual and audio:

| Field | Visual | Audio |
|-------|--------|-------|
| `x` | horizontal position | stereo pan |
| `y` | vertical position | pitch (chromatic, G2–G5, magnetic snap drag, hard snap release) |
| `size` | shape area | gain |
| `fill` | color/gradient | formant filter (hue→vowel, sat→Q, light→brightness) |
| `effect` | pattern overlay | effect chain (chorus, tremolo, flanger, phaser) |
| `timbre` | rotation (pulse/blend/astroid) | waveform param (periodic: 90° square/astroid, 120° triangle) |
| `stamp` | silhouette SVG (stamp only) | sample selection (pitch via playback rate) |
| `trigger` | tilt angle (stamp only: -5°/0°/+5°) | envelope trigger phase (A=0, D=1, R=2) |
| `blend` | CSS `mix-blend-mode` | cross-voice FM synthesis (see below) |
| `border` | inset stroke(s) (not stamps) | octave-doubled sine (white=up, black=down, single=1oct, double=2oct) |

Field-level details (blend, border, fill, ADSR, play modes) are documented
in code comments (`types.ts`, `effects.ts`, `voice-builder.ts`, `shapes.ts`,
`playback.ts`).

**Serialization policy**: v2 register-based format. Perceptually quantized
(6-bit spatial, 3-bit envelope, 3-bit border). Version byte enables future
evolution. v1 URLs are not migrated. **No backwards compatibility until v1.**

## Code Conventions

- TypeScript + ES modules. No framework. Bun handles TS at build/test time.
- Coordinates: normalized 0–1, branded `NormalizedCoord`. Use `normalizedCoord()`,
  `degrees()`, `cents()` from `types.ts` at boundaries — no raw `as` casts.
- Shape IDs: counter + random suffix (e.g., `s1a3f`).
- Per-waveform behavior: `js/voices/<name>/` folders with UI, Player, and
  index.ts delegates. Dispatched via `registry.get(wf)`. `AudioVoice` is
  uniform — callers never test waveform names.
- `InteractionState`: discriminated union for canvas state machine.
- Voice DOM order not enforced by reconciler — allows selection cycling to
  persist across renders.
- **Triple Sec Rule**: >3 lines, >3 times → extract to shared helper.
- Use `tmp/` at project root for scratch files (gitignored). No temp files elsewhere.

## iOS Safari Audio Unlock

iOS Safari qualifying gestures for `AudioContext`: `touchend`, `click`,
`doubleclick`, `keydown`. NOT `pointerdown`/`pointerup`/`mousedown`.
Privileges revoked after any `await`. See `audio/engine.ts:_init()` and
`splash.ts` for full implementation and event wiring rules.

## Checklists

### Pre-Commit

1. **Comments match code.** Update or remove stale comments near changed code.
2. **Documentation is current.** Update CLAUDE.md if behavior described here changed.

### Pre-PR

1. **No orphaned comments.** Remove comments referencing reverted/intermediate
   approaches (`// previously`, `// old approach`, `// workaround for`).
2. **No dead code.** Every removed/renamed symbol must have all call sites and
   tests updated or deleted in the same PR. Grep for deleted names.
3. **No dead or tautological tests.** Tests for removed functionality must be
   removed/rewritten — not left to pass vacuously.
4. **CLAUDE.md is accurate.** Re-read every section; fix stale descriptions.

## Recipes

### Add a new waveform/shape

1. Create `js/voices/<name>/` with three files:
   - `ui.ts`: SVG rendering (`createSvgElement`, `updateSvgElement`,
     `selectionHandles`) implementing `VoiceUI`.
   - `player.ts`: Audio graph (`buildAudioGraph`) implementing `VoicePlayer`.
     Set `oscillatorType`, `shapeAreaCoeff`, `formantMaxQ`, `gainExponent`.
   - `index.ts`: Registry entry wiring UI + Player + serializer.
     Use `oscillatorSerializer` for oscillator voices, `sampleSerializer` for
     sample-based voices. Set `createVoice` factory with waveform-specific
     field defaults.
2. Add import + `register()` call in `js/voices/registry.ts`.
3. Add Voice variant in `types.ts`.
4. Add toolbar button in `index.html`.
5. Every field MUST have both visual and audio mappings.

### Add a new scene

Create `js/scenes/<name>/` with background `.jpg`, optional IR `.m4a`, and:

```ts
import type { Scene } from '../scene-types';
import stageBackground from './background.jpg';
import ir from './impulse.m4a';

const scene: Scene = {
  name: 'scene-name',
  icon: 'tabler-icon-name',
  stageBackground,
  imageCredit: 'source',
  creditUrl: 'https://...',  // optional
  vibe: { ir, reverbMix: 0.7 },
};
export default scene;
```

Import in `js/scenes/index.ts`, append to `SCENES`. Tune vibe with hidden
URL param tuner. Vite resolves `.jpg`/`.m4a` to asset URLs at build time.

### Add a new stample

Create `js/stamples/<name>/` with `stamp.svg`, `sample.mp3`, and:

```ts
import type { Stample } from '../stample-types';
import svgRaw from './stamp.svg?raw';
import sampleUrl from './sample.mp3';

const stample: Stample = {
  name: 'stample-name',
  svgRaw,
  sampleUrl,
  referencePitch: 1200,
  shapeAreaCoeff: 1.2,
  gainExponent: 1.0,
  formantMaxQ: 4,
  hull: 'M 630,576 C 621,839 ... Z',  // SVG path (M/L/C/Z); numbers are alternating x,y
};
export default stample;
```

Import in `js/stamples/index.ts`, append to `STAMPLES` via `resolve()`.

### Add a new pattern/effect

Update `patterns.ts` (visual) + `effects.ts` (audio) + button in `index.html`.

### Add a new blend mode

Add to `BLEND_MODES` in `types.ts` + `FM_PARAMS` in `effects.ts` + button in
`toolbar/blend-panel.ts` + serialization tests. Must be commutative. Set
maxIndex to 0 for no FM.

### Modify border behavior

Update `Border` in `types.ts`, `canvas/render.ts` (visual),
`audio/voice-builder.ts` (octave oscillator), `serialize.ts` (pack/unpack),
`toolbar/border-panel.ts` (UI).

### Add a new fill mode

Add Fill variant in `types.ts`, update `fillToFillDraft`/`fillDraftToFill`,
`colors.ts`, `toolbar/fill-panel.ts`, `audio/mapping.ts` formant mapping,
`serialize.ts`. Every fill field must affect the formant filter.

### Modify scene/vibe behavior

Update `Scene` in `scenes/scene-types.ts`, `VibeOptions`/`Vibe` in
`audio/vibe.ts`, `audio/engine.ts` (master chain), `audio/voice-builder.ts`
(per-voice params), `debug/vibe-tuner.ts` (debug UI), `serialize.ts` (scene
index = 1 B64 char).

### embed.html

Imports same modules but only uses render, engine, serialize, scenes,
sample-loader, shapes. Reads state from `/embed/<data>`. Script `src` must be
absolute path (`/js/embed-entry.ts`) — served via SPA fallback.
