import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${PORT}`;

// Fixed values for the app under test. The app runs against the test database with
// test emails, so E2E runs never touch development data or real accounts.
export const E2E_ENV = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
  BETTER_AUTH_URL: E2E_BASE_URL,
  BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0123456789",
  USER_EMAIL_DOR: "dor@e2e.test",
  USER_EMAIL_MAAYAN: "maayan@e2e.test",
  GOOGLE_CLIENT_ID: "e2e-client-id",
  GOOGLE_CLIENT_SECRET: "e2e-client-secret",
};

export default defineConfig({
  testDir: "tests/e2e",
  // Applies migrations to the test database (same setup as the integration tests).
  globalSetup: "tests/integration/global-setup.ts",
  // Tests share one database, so run them one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: E2E_BASE_URL,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    trace: "retain-on-failure",
  },
  projects: [
    // The installed Google Chrome (also preinstalled on GitHub's Ubuntu runners),
    // so no browser download is needed.
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], channel: "chrome" },
      grep: /@mobile/,
    },
  ],
  webServer: {
    // A production build: what Render runs, without dev-only overlays.
    command: `npm run build && npx next start -p ${PORT}`,
    url: `${E2E_BASE_URL}/login`,
    env: E2E_ENV,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
