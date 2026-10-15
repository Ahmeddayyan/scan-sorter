import { defineConfig } from '@playwright/test';

/**
 * Real-browser end-to-end suite (Microsoft Edge via the `msedge` channel - no browser download).
 *
 *   npm run e2e         production build served by `vite preview` (all tests) + the Vite dev
 *                       server (tests tagged @dev - asset paths / workers differ between the two)
 *   npm run e2e:ui      same, with the Playwright UI
 *
 * Fixtures come from `npm run fixtures` (run automatically by the global setup).
 * Every test blocks and fails on any request that is not to the app's own origin.
 */
const PREVIEW_PORT = 4173;
const DEV_PORT = 5173;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1366, height: 860 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'preview',
      use: { baseURL: `http://localhost:${PREVIEW_PORT}` },
    },
    {
      name: 'dev',
      use: { baseURL: `http://localhost:${DEV_PORT}` },
      grep: /@dev/,
    },
  ],
  webServer: [
    {
      command: `npm run build && npx vite preview --port ${PREVIEW_PORT} --strictPort`,
      url: `http://localhost:${PREVIEW_PORT}/`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npx vite --port ${DEV_PORT} --strictPort`,
      url: `http://localhost:${DEV_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
