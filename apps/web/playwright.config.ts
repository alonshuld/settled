import { defineConfig } from '@playwright/test';

// Smoke test against a locally running stack (pnpm db:up + API on :3001). Free: no external services.
// CHROMIUM_PATH points at a system Chromium when Playwright's own browser download isn't available.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {},
  },
  webServer: { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: true },
});
