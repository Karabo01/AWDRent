import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE } from "./support";

// The seeded leases bill from the current month, so each live lease starts
// with one month's rent on its account.

async function openLease(page: import("@playwright/test").Page, tenant: string) {
  await page.goto(hostUrl(KGOSI.subdomain, `/leases?q=${encodeURIComponent(tenant)}`));
  await page.locator("tbody a").first().click();
  await expect(page.getByTestId("statement")).toBeVisible();
}

test.describe("lease account", () => {
  test.use({ storageState: STATE.kgosiAccounts });

  test("shows rent on the statement, adds a charge and voids it", async ({ page }) => {
    await openLease(page, "Lindiwe Nkosi");
    await expect(page.getByTestId("statement")).toContainText("Rent for");
    const before = await page.getByTestId("lease-balance").innerText();

    const account = page.locator("#account");
    await account.getByText("Add a charge").click();
    await account.getByLabel("Amount (R)").fill("123.45");
    await account.getByLabel("Description").fill("E2E water reading");
    await account.getByRole("button", { name: "Add charge" }).click();
    await expect(page.getByTestId("statement")).toContainText("E2E water reading");
    await expect(page.getByTestId("lease-balance")).not.toHaveText(before);

    const row = page.getByTestId("statement").getByRole("row").filter({ hasText: "E2E water reading" }).last();
    await row.getByRole("button", { name: "Void" }).click();
    await row.getByLabel("Reason for voiding").fill("Wrong meter reading");
    await row.getByRole("button", { name: "Void charge" }).click();
    await expect(page.getByTestId("statement")).toContainText("Voided: Wrong meter reading");
    await expect(page.getByTestId("lease-balance")).toHaveText(before);

    // Statement as a branded PDF
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("statement-pdf").click()]);
    expect(download.suggestedFilename()).toMatch(/^Statement KL-\d{4} \d{4}-\d{2}-\d{2}\.pdf$/);
  });
});

test.describe("lease account as agent", () => {
  test.use({ storageState: STATE.kgosiAgent });

  test("agents see their portfolio's accounts but cannot void", async ({ page }) => {
    await openLease(page, "Lindiwe Nkosi");
    await expect(page.getByRole("button", { name: "Void" })).toHaveCount(0);
    await expect(page.getByText("Add a charge")).toBeVisible();
  });
});
