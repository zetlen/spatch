import { defineConfig } from '@playwright/test';

// TEST_PORT is set by the test:e2e script via pick-port. It finds a random
// free TCP port once in the parent shell so all Playwright workers share it.
const TEST_PORT = Number(process.env.TEST_PORT);
if (!TEST_PORT) {
  throw new Error('TEST_PORT env var is required. Run tests via: bun run test:e2e');
}

// Firefox is excluded: it lacks OfflineAudioContext.suspend(), which the audio
// snapshot tests rely on to pause rendering at precise times and perform
// mid-playback mutations (rotation, FM overlap changes). Without suspend(),
// audio snapshots cannot be generated deterministically. See:
// https://bugzilla.mozilla.org/show_bug.cgi?id=1081168

// PLAYWRIGHT_WORKERS overrides the worker count. Set it in CI (where LXC
// containers inherit /proc/cpuinfo from the host and os.cpus() lies) or
// locally to taste. Unset = Playwright default (half of os.cpus().length).
const workers = process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : undefined;

export default defineConfig({
  workers,
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: ['--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
  ],
  testDir: 'tests/integration',
  // Per-browser baselines (not per-OS) — Chromium and WebKit produce
  // different audio output so each needs its own snapshots.
  snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}',
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
  },
  webServer: {
    command: `bun run preview --port ${TEST_PORT}`,
    port: TEST_PORT,
    reuseExistingServer: false,
  },
  reporter: 'list',
});
