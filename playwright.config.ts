import { defineConfig } from '@playwright/test';

const channel = process.env['PLAYWRIGHT_CHANNEL']
  ?? (process.platform === 'win32' ? 'msedge' : undefined);

/**
 * Browser smoke tests. On Windows this uses the installed Edge build; on other
 * platforms run `pnpm exec playwright install chromium` first, or set
 * PLAYWRIGHT_CHANNEL.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: channel as 'msedge' | 'chrome' | undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
