import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE, statusOf } from "./support";

// Reports and exports (Phase 3 step 6).

test.describe("reports", () => {
  test.use({ storageState: STATE.kgosiAccounts });

  test("accounts see the agency's figures and download a CSV", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/reports"));
    await expect(page.getByTestId("collections")).toContainText("due this month", { timeout: 30_000 });
    await expect(page.getByTestId("occupancy")).toContainText("%");
    const today = new Date().toISOString().slice(0, 10);
    expect(await statusOf(page, `/reports/export/transactions?from=2026-01-01&to=${today}`)).toBe(200);
    expect(await statusOf(page, `/reports/export/transactions?from=${today}&to=2026-01-01`)).toBe(400);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-arrears").getByRole("button", { name: "Download CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^Arrears ageing at \d{4}-\d{2}-\d{2}\.csv$/);
  });
});

test.describe("reports as agent", () => {
  test.use({ storageState: STATE.kgosiAgent });

  test("agents see their portfolio but cannot export", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/reports"));
    await expect(page.getByText("For the properties in your portfolio.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Exports for your accounting package")).toHaveCount(0);
    expect(await statusOf(page, "/reports/export/transactions?from=2026-01-01&to=2026-02-01")).toBe(404);
  });
});
