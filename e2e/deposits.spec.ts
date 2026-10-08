import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE } from "./support";

test.describe("deposits", () => {
  test.use({ storageState: STATE.kgosiAccounts });

  test("records a deposit received and voids it again", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, `/leases?q=${encodeURIComponent("Lindiwe Nkosi")}`));
    await page.locator("tbody a").first().click();
    const card = page.locator("#deposit");
    const before = await card.getByTestId("deposit-held").innerText();

    await card.getByText("Record deposit received").first().click();
    await card.getByLabel("Amount (R)").fill("100");
    await card.getByLabel("Bank reference").fill("E2E-DEP-1");
    await card.getByRole("button", { name: "Record deposit received" }).click();
    await expect(card.getByTestId("deposit-entries")).toContainText("E2E-DEP-1");
    await expect(card.getByTestId("deposit-held")).not.toHaveText(before);

    const row = card.getByTestId("deposit-entries").getByRole("row").filter({ hasText: "E2E-DEP-1" }).last();
    await row.getByRole("button", { name: "Void" }).click();
    await row.getByLabel("Reason for voiding").fill("Captured twice");
    await row.getByRole("button", { name: "Void entry" }).click();
    await expect(card.getByTestId("deposit-entries")).toContainText("Voided: Captured twice");
    await expect(card.getByTestId("deposit-held")).toHaveText(before);
  });
});

test.describe("deposits as agent", () => {
  test.use({ storageState: STATE.kgosiAgent });

  test("agents can see the deposit but not record entries", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, `/leases?q=${encodeURIComponent("Lindiwe Nkosi")}`));
    await page.locator("tbody a").first().click();
    await expect(page.locator("#deposit").getByTestId("deposit-held")).toBeVisible();
    await expect(page.locator("#deposit").getByText("Record deposit received")).toHaveCount(0);
  });
});
