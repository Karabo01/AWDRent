import { defineConfig, devices } from "@playwright/test";

const baseDomain = process.env.APP_BASE_DOMAIN ?? "localhost";
const port = process.env.E2E_PORT ?? "3000";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    // Each test navigates to its own subdomain; this is the console default
    baseURL: `http://admin.${baseDomain}:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
