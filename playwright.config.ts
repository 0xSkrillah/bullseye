import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against the offline configuration: recorded real source data (HISTORICAL),
 * the fixture synthesiser and the fixture payment rail. No keys, no network, no funds.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  webServer: [
    { command: "npm run start:offline", url: "http://localhost:4402/api/health", reuseExistingServer: false, timeout: 60_000 },
    { command: "npm run dev:web", url: "http://localhost:5173", reuseExistingServer: false, timeout: 60_000 },
  ],
});
