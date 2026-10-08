import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE, unique } from "./support";

test.describe("proofs of payment", () => {
  test.use({ storageState: STATE.kgosiAccounts });

  test("uploads a POP for a tenant, imports the statement and approves it against the bank line", async ({ page }) => {
    // A unique amount per run, so this POP and its bank line are easy to find again
    const cents = 10_000 + Math.floor(Math.random() * 89_999);
    const amount = (cents / 100).toFixed(2);
    const shown = (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2 });

    await page.goto(hostUrl(KGOSI.subdomain, `/leases?q=${encodeURIComponent("Lindiwe Nkosi")}`));
    await page.locator("tbody a").first().click();
    const pops = page.locator("#pops");
    await pops.getByLabel("Amount paid (R)").fill(amount);
    await pops.locator("input[type=file]").setInputFiles({ name: "pop.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
    await pops.getByRole("button", { name: "Upload proof of payment" }).click();
    await expect(page.getByText("Sent to accounts for checking against the bank statement.")).toBeVisible();
    await expect(page.getByTestId("lease-pops")).toContainText("Waiting for bank");

    // The money arrives on the trust account under a reference the system cannot match
    const format = unique("E2E pop bank");
    await page.goto(hostUrl(KGOSI.subdomain, "/banking/profiles"));
    const add = page.locator("form").last();
    await add.getByLabel("Name").fill(format);
    await add.getByLabel("Date order").selectOption("YMD");
    await add.getByRole("button", { name: "Save bank format" }).click();
    await page.getByLabel("Bank format").selectOption({ label: format });
    const today = new Date().toISOString().slice(0, 10);
    const csv = `Date,Amount,Reference,Description\n${today},${amount},MS NKOSI,${unique("pop")}`;
    await page.locator("input[name=file]").setInputFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Import statement" }).click();
    await expect(page.getByTestId("import-summary")).toContainText("1 new");

    await page.getByRole("link", { name: "Proofs of payment" }).click();
    const card = page.getByTestId("pending-pop").filter({ hasText: shown }).first();
    await expect(card).toContainText("same amount");
    await card.getByRole("button", { name: "Approve with this line" }).first().click();
    await expect(page.getByText("Recently reviewed")).toBeVisible();
    await expect(page.getByTestId("pending-pop").filter({ hasText: shown })).toHaveCount(0);
  });
});
