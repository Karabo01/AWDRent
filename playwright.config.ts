import { defineConfig, devices } from "@playwright/test";

// Needs a running app (npm run dev, or the production build in CI), a
// migrated and seeded database (npm run db:migrate && npm run db:seed) and
// S3 storage for the document test. Set AUTH_RATE_LIMIT_MAX=50 for the app
// under test: the run signs in more often than the production limit allows.

const baseDomain = process.env.APP_BASE_DOMAIN ?? "localhost";
const port = process.env.E2E_PORT ?? "3000";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://admin.${baseDomain}:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"], testIgnore: /auth\.setup\.ts/ },
  ],
});
