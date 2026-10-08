import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE, unique } from "./support";

test.describe("banking", () => {
  test.use({ storageState: STATE.kgosiAccounts });

  test("sets up a bank format, imports a statement, auto-matches and allocates by hand", async ({ page }) => {
    // The EFT reference of a seeded live lease
    await page.goto(hostUrl(KGOSI.subdomain, `/leases?q=${encodeURIComponent("Lindiwe Nkosi")}`));
    const reference = (await page.locator("tbody a").first().innerText()).trim();

    const format = unique("E2E bank");
    await page.goto(hostUrl(KGOSI.subdomain, "/banking/profiles"));
    const add = page.locator("form").last();
    await add.getByLabel("Name").fill(format);
    await add.getByLabel("Date order").selectOption("YMD");
    await add.getByRole("button", { name: "Save bank format" }).click();
    await expect(page).toHaveURL(/\/banking$/);

    const run = unique("run");
    const today = new Date().toISOString().slice(0, 10);
    const csv = [
      "Date,Amount,Reference,Description",
      `${today},100.00,${reference.replace("-", " ")},${run} rent`,
      `${today},55.00,CASH DEPOSIT,${run} unknown`,
      `${today},-20.00,BANK FEE,${run} fee`,
    ].join("\n");
    await page.getByLabel("Bank format").selectOption({ label: format });
    await page.locator("input[name=file]").setInputFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Import statement" }).click();
    await expect(page.getByTestId("import-summary")).toContainText("2 new, 1 matched to leases automatically");
    await expect(page.getByTestId("import-summary")).toContainText("1 money-out line skipped");

    const row = page.getByTestId("unmatched-lines").getByRole("row").filter({ hasText: "CASH DEPOSIT" }).filter({ hasText: "55" }).last();
    await row.getByRole("button", { name: "Allocate" }).click();
    await row.getByLabel("Lease").selectOption({ index: 1 });
    await row.getByRole("button", { name: "Allocate" }).click();
    await expect(page.getByTestId("matched-lines")).toContainText("CASH DEPOSIT");

    // Undo puts it back in the queue and reverses the payment
    const matched = page.getByTestId("matched-lines").getByRole("row").filter({ hasText: "CASH DEPOSIT" }).first();
    await matched.getByRole("button", { name: "Undo" }).click();
    await matched.getByLabel("Reason").fill("E2E undo");
    await matched.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("unmatched-lines")).toContainText("CASH DEPOSIT");
  });
});

test.describe("banking as agent", () => {
  test.use({ storageState: STATE.kgosiAgent });

  test("agents cannot reach banking", async ({ page }) => {
    const res = await page.goto(hostUrl(KGOSI.subdomain, "/banking"));
    expect(res?.status()).toBe(404);
  });
});
