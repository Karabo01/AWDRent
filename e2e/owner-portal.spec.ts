import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, lastMessageTo, STATE } from "./support";

// The owner portal (Phase 3 step 4). The demo owner Thabo Mokoena has the
// email owner1@example.test.

test.describe("owner portal", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("staff switch an owner's portal on; the owner signs in and sees their properties", async ({ page, browser }) => {
    await page.goto(hostUrl(KGOSI.subdomain, `/owners?q=${encodeURIComponent("Thabo Mokoena")}`));
    await page.locator("tbody a").first().click();
    const card = page.locator("#owner-portal");
    await expect(card).toBeVisible({ timeout: 30_000 });
    const on = card.getByRole("button", { name: "Switch the owner portal on" });
    if (await on.isVisible()) await on.click();
    await expect(page.getByTestId("owner-portal-status")).toContainText("On.");

    const owner = await browser.newPage({ storageState: { cookies: [], origins: [] } });
    await owner.goto(hostUrl(KGOSI.subdomain, "/op"));
    await expect(owner).toHaveURL(/\/op\/login/, { timeout: 30_000 });
    const since = new Date(Date.now() - 1000);
    await owner.getByLabel("Email address or mobile number").fill("owner1@example.test");
    await owner.getByRole("button", { name: "Send me a code" }).click();
    await expect(owner.getByRole("status")).toContainText("one of our owners", { timeout: 30_000 });
    let code: string | undefined;
    await expect.poll(() => (code = lastMessageTo("owner1@example.test", since)?.text.match(/\b(\d{6})\b/)?.[1])).toBeTruthy();
    await owner.getByLabel("Code").fill(code!);
    await owner.getByRole("button", { name: "Sign in" }).click();
    await expect(owner.getByRole("heading", { name: "My properties" })).toBeVisible({ timeout: 30_000 });
    await expect(owner.getByTestId("owner-property").first()).toBeVisible();
    await owner.getByRole("link", { name: "Statements" }).click();
    await expect(owner.getByRole("heading", { name: "Statements" })).toBeVisible({ timeout: 30_000 });
    // An owner login does not open the tenant portal
    await owner.goto(hostUrl(KGOSI.subdomain, "/p"));
    await expect(owner).toHaveURL(/\/p\/login/);
    await owner.close();
  });
});
