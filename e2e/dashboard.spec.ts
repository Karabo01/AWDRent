import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE } from "./support";

test.describe("dashboard", () => {
  test.describe("admin", () => {
    test.use({ storageState: STATE.kgosiAdmin });
    test("shows the whole agency", async ({ page }) => {
      await page.goto(hostUrl(KGOSI.subdomain));
      await expect(page.getByRole("heading", { name: /Welcome, Lerato/ })).toBeVisible();
      await expect(page.getByTestId("leases-live")).not.toHaveText("0");
      for (const item of ["Owners", "Properties", "Tenants", "Leases", "Import", "Staff", "Settings", "Audit log"]) {
        await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: item })).toBeVisible();
      }
    });
  });

  test.describe("agent", () => {
    test.use({ storageState: STATE.kgosiAgent });
    test("shows only the agent's portfolio and hides admin screens", async ({ page }) => {
      await page.goto(hostUrl(KGOSI.subdomain));
      await expect(page.getByText("Your portfolio at a glance.")).toBeVisible();
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link", { name: "Leases" })).toBeVisible();
      for (const item of ["Import", "Staff", "Settings", "Audit log"]) await expect(nav.getByRole("link", { name: item })).toHaveCount(0);
      // Admin screens answer 404, not just a hidden link
      const res = await page.goto(hostUrl(KGOSI.subdomain, "/settings"));
      expect(res?.status()).toBe(404);
    });
  });
});
