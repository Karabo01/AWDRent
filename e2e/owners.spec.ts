import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE, unique } from "./support";

test.describe("owners", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("creates an owner, validates the ID number and masks bank details", async ({ page }) => {
    const name = unique("E2E Owner");
    await page.goto(hostUrl(KGOSI.subdomain, "/owners/new"));
    await page.getByLabel("Full name or registered name").fill(name);
    await page.getByLabel("ID / registration number").fill("8001015009086");
    await page.getByRole("button", { name: "Create owner" }).click();
    await expect(page.getByText("That is not a valid South African ID number.")).toBeVisible();
    await page.getByLabel("ID / registration number").fill("8001015009087");
    await page.getByRole("button", { name: "Create owner" }).click();
    // The first visit compiles the page in development
    await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 30_000 });

    await page.getByText("Edit bank details").click();
    await page.getByLabel("Bank", { exact: true }).fill("Nedbank");
    await page.getByLabel("Branch code").fill("198765");
    await page.getByLabel("Account holder").fill(name);
    await page.getByLabel("Account number").fill("1122334455");
    await page.getByRole("button", { name: "Save bank details" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("bank-account")).toHaveText("•••• 4455");
    await page.getByRole("button", { name: "Show (logged)" }).click();
    await expect(page.getByTestId("bank-account")).toHaveText("1122334455");

    await page.goto(hostUrl(KGOSI.subdomain, `/owners?q=${encodeURIComponent(name)}`));
    await expect(page.getByRole("link", { name })).toBeVisible();
  });
});

test.describe("owners as accounts", () => {
  test.use({ storageState: STATE.kgosiAccounts });

  test("can read owners but not edit or see bank numbers", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/owners"));
    await expect(page.getByRole("link", { name: "New owner" })).toHaveCount(0);
    await page.getByRole("link", { name: "Thabo Mokoena" }).click();
    await expect(page.getByText("Only admins can view or change bank details.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show (logged)" })).toHaveCount(0);
    const res = await page.goto(hostUrl(KGOSI.subdomain, "/owners/new"));
    expect(res?.status()).toBe(404);
  });
});
