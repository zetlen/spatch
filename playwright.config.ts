import { defineConfig } from '@playwright/test';

// TEST_PORT is set by the test:e2e script via pick-port. It finds a random
// free TCP port once in the parent shell so all Playwright workers share it.
const TEST_PORT = Number(process.env.TEST_PORT);
if (!TEST_PORT) {
  throw new Error('TEST_PORT env var is required. Run tests via: bun run test:e2e');
}

export default defineConfig({
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  testDir: 'tests/integration',
  // Audio snapshot tests require a local environment with matching OfflineAudioContext
  // output. Skip them in CI where the container produces different results.
  ...(process.env.CI ? { testIgnore: /audio-snapshot/ } : {}),
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: `bun run dev -- --port ${TEST_PORT}`,
    port: TEST_PORT,
    reuseExistingServer: false,
  },
});
