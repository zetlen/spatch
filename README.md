# spatch

A browser instrument. Compose visual sigils from geometric shapes and hear them
as synthesized chords. Every visual property maps to an audio parameter.

Live at [spatch.music](https://spatch.music).

## Development

Requires [Bun](https://bun.sh/) and [Playwright](https://playwright.dev/)
browsers.

```bash
bun install                  # install dependencies
bun run dev                  # dev server on localhost:5173
bun run build                # production build to dist/
```

## Testing

```bash
bun run test                 # unit + integration tests
bun run test:unit            # unit tests only (bun test)
bun run test:e2e             # integration tests (Playwright)
bun run check                # typecheck (tsc --noEmit)
bun run lint                 # lint (oxlint)
bun run fmt                  # format (oxfmt)
```

Integration tests run on **Chromium** and **WebKit**. Firefox is excluded
because it lacks `OfflineAudioContext.suspend()`, which the audio snapshot
tests need for deterministic waveform capture.

Install Playwright browsers if you haven't:

```bash
bunx playwright install --with-deps
```

## Deploy

spatch ships as a container image, `ghcr.io/zetlen/spatch`, built by
`Dockerfile` (bun build, then nginx with `nginx.conf` and `dist/` baked in).

```bash
mise run image               # build ghcr.io/zetlen/spatch:dev locally
mise run preview-image       # serve it on http://localhost:8080
mise run release             # owner-present: bump CalVer, push to GHCR, print the pin
```

`bin/release.sh` requires a clean, up-to-date `main` and a short-lived
`docker login ghcr.io`; the infrastructure repo pins the printed
`latest@digest`, and that pin-bump is the deploy.

## License

[GPLv3](LICENSE)
