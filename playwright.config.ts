import { defineConfig } from '@playwright/test';

export default defineConfig({
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  testDir: 'tests/integration',
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'bun run dev',
    port: 5173,
    reuseExistingServer: true,
  },
});
