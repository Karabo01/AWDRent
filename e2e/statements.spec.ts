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

test.describe("owner payouts", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("an admin makes a payout batch from an approved month and downloads the bank file", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/statements"));
    const approved = page.getByTestId("statement-runs").locator("tbody tr").filter({ hasText: "Approved" }).first();
    test.skip((await approved.count()) === 0, "No approved month yet (the statements test approves one)");
    await approved.getByRole("link").click();
    const payouts = page.getByTestId("payouts");
    await expect(payouts).toBeVisible({ timeout: 30_000 });
    const make = payouts.getByRole("button", { name: "Make a payout batch" });
    if (await make.isVisible()) await make.click();
    // With no owner owed money (or no bank details) there is no batch to download
    const csv = payouts.getByTestId("payout-csv").first();
    if (await csv.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const href = (await csv.getAttribute("href"))!;
      expect(await statusOf(page, href)).toBe(200);
    }
  });
});
