import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE, statusOf } from "./support";

// Owner statements (Phase 3 step 1). Approving a month is permanent, so on a
// second run against the same database the month is found already approved.

test.describe("owner statements", () => {
  test.use({ storageState: STATE.kgosiAccounts });

  test("accounts prepare last month's statements, preview one, and approve them", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/statements"));
    await page.getByRole("button", { name: "Prepare statements" }).click();
    const already = page.getByText(/is already approved/);
    await expect(page.getByTestId("owner-statements").or(already).or(page.getByText("No owner has rent"))).toBeVisible({ timeout: 30_000 });

    if (await already.isVisible()) {
      await page.getByTestId("statement-runs").locator("tbody a").first().click();
      await expect(page.getByText("Approved", { exact: true })).toBeVisible();
      return;
    }

    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    const rows = page.getByTestId("owner-statements").locator("tbody tr");
    if ((await rows.count()) > 0) {
      const preview = await rows.first().getByRole("link", { name: "Preview" }).getAttribute("href");
      expect(await statusOf(page, preview!)).toBe(200);
    }
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Approve and email to owners" }).click();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible({ timeout: 30_000 });
    if ((await rows.count()) > 0) await expect(rows.first().getByRole("link", { name: "PDF" })).toBeVisible();
  });
});

test.describe("owner statements as agent", () => {
  test.use({ storageState: STATE.kgosiAgent });

  test("agents cannot open statements", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/"));
    expect(await statusOf(page, "/statements")).toBe(404);
  });
});
