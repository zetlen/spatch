**Verdict**

This is a strong, thoughtful prototype and a mediocre public release candidate. The core engineering is better than average for a small creative web app: strict TypeScript, clear domain modeling, very good internal docs, a coherent audio/visual mapping model, and a large unit test surface. But it is not hardened yet. The main gaps are onboarding behavior, end-to-end test trust, module size/coupling, and missing public-product scaffolding.

**What’s Strong**

The best part of the repo is the domain discipline. The bijection idea is unusually well-defined, the state model is coherent, the render/audio/serialization split is intelligible, and the project is documented like a serious system rather than a toy. Static quality is also good: `check`, `lint`, `fmt:check`, `build`, and 373 unit tests all passed locally.

**Key Findings**

- The browser test harness is not trustworthy right now. [playwright.config.ts](/Users/james/Documents/spatch/playwright.config.ts#L20) hardcodes `reuseExistingServer: true` on port `5173`. In my run, Playwright attached to a completely different app already running on that port, and `bun run test:e2e` failed `60/60` against the wrong target. Context7-confirmed official [Playwright webServer docs](https://playwright.dev/docs/test-webserver) say this setting reuses any existing server on that URL/port.
- The splash/onboarding flow is over-coupled to “empty canvas”. [js/splash.ts](/Users/james/Documents/spatch/js/splash.ts#L47) forces splash active whenever `voices.length === 0`, even if the route has already been seen. Combined with toolbar gating in [css/style.css](/Users/james/Documents/spatch/css/style.css#L935), the blank editor looks inert until the user clicks the stage and waits for reveal. That may be intentional, but it is high-friction and it invalidates helpers like [skip-splash.js](/Users/james/Documents/spatch/tests/integration/helpers/skip-splash.js#L1).
- Main-app asset failure handling is weaker than embed. The editor stores a rejecting `sceneReady` promise and awaits it before playback in [js/app.ts](/Users/james/Documents/spatch/js/app.ts#L121), while the embed viewer catches the same failure and still reveals UI in [js/embed-entry.ts](/Users/james/Documents/spatch/js/embed-entry.ts#L89). One broken scene JPG or IR can therefore degrade gracefully in embed and fail awkwardly in the main editor.
- The architecture is coherent but still too monolithic. The code works, but maintenance risk is concentrated in a few giant files: [js/audio/engine.ts](/Users/james/Documents/spatch/js/audio/engine.ts), [js/tutorial.ts](/Users/james/Documents/spatch/js/tutorial.ts), [js/debug/vibe-tuner.ts](/Users/james/Documents/spatch/js/debug/vibe-tuner.ts), [js/canvas/interaction.ts](/Users/james/Documents/spatch/js/canvas/interaction.ts), [js/playback.ts](/Users/james/Documents/spatch/js/playback.ts), and [js/app.ts](/Users/james/Documents/spatch/js/app.ts). That is survivable now, but it will slow every nontrivial change.
- Public-release scaffolding is incomplete. The repo root has no `README`, `LICENSE`, `CHANGELOG`, or `SECURITY` file. [playwright.config.ts](/Users/james/Documents/spatch/playwright.config.ts#L4) only exercises Chromium even though the code has explicit Safari/iOS handling. [nginx.conf](/Users/james/Documents/spatch/nginx.conf) only does SPA fallback; it does not add cache or security headers. Deploy mutates a live container in place rather than shipping an immutable artifact.
- Shared-link durability is not yet a public contract. [js/serialize.ts](/Users/james/Documents/spatch/js/serialize.ts) uses a custom unversioned codec. That is fine pre-1.0, but once this is public, link stability becomes product surface area, not just implementation detail.

**Immediate Work**

- Fix Playwright isolation first: dedicated test port, `reuseExistingServer: !process.env.CI`, and explicit server output capture.
- Decide whether blank `/` should still be splash-gated after first visit. My recommendation: once seen, land directly in editing mode and keep splash as an explicit preview action.
- Add main-editor error handling around scene/image/IR prefetch so playback and reveal fail soft.
- Add minimal public docs: README, browser support statement, license, privacy note if Umami is used.
- Add WebKit coverage and at least one deploy smoke test.

**Longer Roadmap**

- Split the large runtime modules by responsibility: audio graph lifecycle, FM sync, master FX, scene loading, playback gesture, splash flow, tutorial steps.
- Replace “remember to call `undo.snapshot()` before mutating” with an action/transaction layer so undo semantics are enforced rather than conventional.
- Version the URL serialization format before treating shared links as durable.
- Improve release hardening incrementally: cache headers, security headers, asset budgets, and better failure telemetry.
- Move deployment toward immutable artifacts with rollback, health checks, and post-deploy verification. That is medium effort, but it is the right long-term direction.

**What I Actually Ran**

`bun install`, `bun run check`, `bun run lint`, `bun run fmt:check`, `bun run build`, and `bun run test:unit` all passed. `bun run test:e2e` failed completely in this environment because the Playwright config reused an unrelated server on `localhost:5173`. I then tested the app directly with Playwright on an isolated port and confirmed splash reveal, shape placement, URL serialization, embed rendering, and playback button state all worked on the real app.