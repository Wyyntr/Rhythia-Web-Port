import { defineConfig } from '@playwright/test';

const channel = process.env['PLAYWRIGHT_CHANNEL']
  ?? (process.platform === 'win32' ? 'msedge' : undefined);

/** Runs the production build through `vite preview` to test the service worker. */
export default defineConfig({
  testDir: './e2e-pwa',
  timeout: 90_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/rhythia-web/',
    channel: channel as 'msedge' | 'chrome' | undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/rhythia-web/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
