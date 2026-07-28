import { defineConfig } from '@playwright/test';

/**
 * Console E2E. Unlike desktop (Electron), this drives the Next.js app in a real browser against a
 * running server — so the suite verifies what an operator actually sees, not what a unit test says
 * the logic returns.
 *
 * Single worker on purpose: the specs share one authenticated session and one Postgres, and the
 * repo has already been bitten by timing assertions failing under parallel CPU load
 * (G-TEST-LOAD-SENSITIVITY). A slower, honest suite beats a fast flaky one.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // Retries in CI only: locally a flake a developer introduces must be visible immediately rather
  // than papered over by a retry.
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.OFFGRID_E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    // A desktop-first operator console — verify at the width operators actually use.
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
