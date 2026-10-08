import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE, unique } from "./support";

test.describe("agency admin screens", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("staff: invites a new agent", async ({ page }) => {
    const email = `${unique("agent").replace(/\s/g, "-").toLowerCase()}@kgosi.test`;
    await page.goto(hostUrl(KGOSI.subdomain, "/staff"));
    const invite = page.locator("form", { has: page.getByRole("button", { name: "Send invite", exact: true }) });
    await invite.getByLabel("Full name").fill("Invited Agent");
    await invite.getByLabel("Email").fill(email);
    await invite.getByRole("button", { name: "Send invite", exact: true }).click();
    await expect(page.getByText(`Invite sent to ${email}`)).toBeVisible();
    await expect(page.locator("tbody")).toContainText(email);
  });

  test("settings: saves the trust account and shows only its last digits", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/settings"));
    await page.getByLabel("Trust account number").fill("62009998877");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Current: •••• 8877")).toBeVisible();
  });

  test("import: checks the downloaded templates without saving anything", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/import"));
    const download = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "owners.csv" }).click()]);
    const path = await download[0].path();
    await page.getByLabel("Owners").setInputFiles(path);
    await page.getByRole("button", { name: "Check files" }).click();
    await expect(page.getByTestId("import-report")).toContainText("Ready to import 1 owners");
  });

  test("audit log: shows recent changes with who made them", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/audit"));
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    await expect(page.locator("tbody")).toContainText("agency.settings_updated");
    await expect(page.locator("tbody")).toContainText(KGOSI.logins.admin.name);
  });
});
