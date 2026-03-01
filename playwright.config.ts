import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/integration',
  webServer: {
    command: '/Users/zetlen/.local/share/mise/installs/bun/1.3.10/bin/bun run dev',
    port: 3000,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:3000',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
