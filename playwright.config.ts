import { defineConfig, devices } from "@playwright/test";

// Real browser E2E tests (Phase 11) against the real local dev server and
// real local Supabase — the top carried-forward risk from Phases 07-10 was
// that Approve/Reject/cover-letter/application interactions were only ever
// verified via route/RPC tests, never an actual click. This closes that gap.
// LOCAL ONLY: tests/e2e/global-setup.ts refuses to seed against anything but
// a local Supabase URL.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
