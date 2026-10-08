import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE, unique } from "./support";

test.describe("tenants and leases", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("creates a tenant, then a lease with an EFT reference, and activates it", async ({ page }) => {
    // A fresh unit each run, so the lease never overlaps an earlier run's
    const unitLabel = unique("E2E Flat");
    await page.goto(hostUrl(KGOSI.subdomain, "/properties?q=Kaya"));
    await page.getByRole("link", { name: "Kaya Court", exact: true }).click();
    const addUnit = page.locator("form", { has: page.getByRole("button", { name: "Add unit" }) });
    await addUnit.getByLabel("Unit").fill(unitLabel);
    await addUnit.getByRole("button", { name: "Add unit" }).click();
    await expect(page.getByRole("textbox", { name: "Unit" }).first()).toBeVisible();
    await expect(page.locator(`input[value="${unitLabel}"]`)).toHaveCount(1);

    const tenantName = unique("E2E Tenant");
    await page.goto(hostUrl(KGOSI.subdomain, "/tenants/new"));
    await page.getByLabel("Full name").fill(tenantName);
    await page.getByLabel("ID / passport number").fill("9001015009086");
    await page.getByLabel("Email", { exact: true }).fill("e2e@example.test");
    await page.getByLabel("SMS messages").check();
    await page.getByRole("button", { name: "Create tenant" }).click();
    await expect(page.getByText("A phone number is needed for SMS")).toBeVisible();
    await page.getByLabel("Mobile number").fill("082 555 0199");
    await page.getByLabel(/consented/).check();
    await page.getByRole("button", { name: "Create tenant" }).click();
    await expect(page.getByRole("heading", { name: tenantName })).toBeVisible();
    await page.getByRole("button", { name: "Show (logged)" }).click();
    await expect(page.getByTestId("tenant-id")).toHaveText("9001015009086");

    await page.getByRole("link", { name: "New lease for this tenant" }).click();
    await page.getByLabel("Unit").selectOption({ label: `Kaya Court — ${unitLabel}` });
    await page.getByLabel("Start date").fill("2027-01-01");
    await page.getByLabel("End date").fill("2027-12-31");
    await page.getByLabel("Monthly rent (R)").fill("6 900");
    await page.getByLabel("Deposit (R)").fill("13800");
    await page.getByRole("button", { name: "Create draft lease" }).click();
    await expect(page.getByTestId("eft-reference")).toHaveText(/^KL-\d{4}$/);
    const reference = await page.getByTestId("eft-reference").innerText();

    await page.getByRole("button", { name: "Activate lease" }).click();
    await expect(page.getByRole("button", { name: "Apply escalation" }).or(page.getByText("Record notice to vacate"))).toBeVisible();

    await page.goto(hostUrl(KGOSI.subdomain, `/leases?q=${reference}`));
    await expect(page.locator("tbody")).toContainText(tenantName);
    await expect(page.locator("tbody")).toContainText("Active");
  });

  test("refuses a second live lease on an occupied unit for the same dates", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/leases/new"));
    await page.getByLabel("Unit").selectOption({ label: "12 Oak Street — Main house (occupied)" });
    await page.getByLabel("Main tenant").selectOption({ label: "Sipho Nkosi" });
    await page.getByLabel("Start date").fill("2026-01-01");
    await page.getByLabel("Monthly rent (R)").fill("5000");
    await page.getByRole("button", { name: "Create draft lease" }).click();
    await page.getByRole("button", { name: "Activate lease" }).click();
    await expect(page.getByText("This unit already has a live lease for some of those dates.")).toBeVisible();
  });
});
