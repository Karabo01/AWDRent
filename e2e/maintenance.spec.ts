import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, signInToPortal, STATE, unique } from "./support";

// Maintenance (Phase 3 step 3): the tenant reports in the portal, staff
// assign a contractor and move it on.

test.describe("maintenance", () => {
  test("a tenant reports a problem with a photo and sees it logged", async ({ page }) => {
    await signInToPortal(page, KGOSI.subdomain, "t1@example.test");
    await page.getByRole("link", { name: "Maintenance" }).click();
    const title = unique("Dripping tap");
    await page.getByLabel("What is wrong").fill(title);
    await page.getByLabel("Details").fill("The kitchen tap drips all night");
    await page.getByLabel(/Photos/).setInputFiles({ name: "tap.png", mimeType: "image/png", buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]) });
    await page.getByRole("button", { name: "Send to my agent" }).click();
    await expect(page.getByRole("status")).toContainText("Your agent has been told", { timeout: 30_000 });
    await expect(page.getByTestId("portal-maintenance").filter({ hasText: title })).toContainText("Logged");
  });

  test.describe("as staff", () => {
    test.use({ storageState: STATE.kgosiAdmin });

    test("staff add a contractor, log a request and assign it", async ({ page }) => {
      const contractor = unique("E2E Plumbing");
      await page.goto(hostUrl(KGOSI.subdomain, "/maintenance/contractors"));
      const add = page.locator("form").first();
      await add.getByLabel("Name").fill(contractor);
      await add.getByLabel("Email").fill("plumber@e2e.test");
      await add.getByRole("button", { name: "Add contractor" }).click();
      await expect(page.getByTestId("contractor").filter({ hasText: contractor })).toBeVisible({ timeout: 30_000 });

      const title = unique("Broken gate");
      await page.goto(hostUrl(KGOSI.subdomain, "/maintenance/new"));
      await page.getByLabel("Unit").selectOption({ index: 1 });
      await page.getByLabel("What is wrong").fill(title);
      await page.getByLabel("Details").fill("The gate motor does not open");
      await page.getByRole("button", { name: "Log request" }).click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });

      await page.getByLabel("Contractor").selectOption({ label: contractor });
      await page.getByLabel("Note", { exact: true }).fill("Contractor to call before visiting");
      await page.getByRole("button", { name: "Save update" }).click();
      await expect(page.getByTestId("maintenance-timeline")).toContainText(`Contractor: ${contractor}`);
      await expect(page.getByText("Contractor assigned").first()).toBeVisible();

      await page.goto(hostUrl(KGOSI.subdomain, "/maintenance"));
      await expect(page.getByTestId("maintenance-list")).toContainText(title);
    });
  });
});
