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

## License

[GPLv3](LICENSE)
