import { expect, type Page, test } from "@playwright/test";
import { BAYVIEW, hostUrl, KGOSI, platformUrl, STATE } from "./support";

/** The console row for an agency, found by its unique address. */
const agencyLink = (page: Page, subdomain: string) =>
  page.locator("tr", { has: page.getByRole("cell", { name: subdomain, exact: true }) }).getByRole("link");

test.describe("platform console", () => {
  test.use({ storageState: STATE.platform });

  test("lists agencies and creates a new one with its first admin", async ({ page }) => {
    await page.goto(platformUrl("/"));
    await expect(agencyLink(page, KGOSI.subdomain)).toHaveText(KGOSI.name);
    await expect(agencyLink(page, BAYVIEW.subdomain)).toHaveText(BAYVIEW.name);

    const sub = `e2e${Date.now().toString(36)}`;
    await page.getByRole("link", { name: "New agency" }).click();
    await page.getByLabel("Agency name").fill("E2E Lettings");
    await page.getByLabel("Address").fill(sub);
    await page.getByLabel("EFT reference prefix").fill("EE");
    await page.getByLabel("Full name").fill("E2E Admin");
    await page.getByLabel("Email").fill(`admin@${sub}.test`);
    await page.getByRole("button", { name: /Create agency/ }).click();
    await expect(page.getByText("Agency created.")).toBeVisible();
    await expect(page.getByText("Invite pending")).toBeVisible();
  });

  test("opens a read-only support session that the agency sees and logs", async ({ page }) => {
    await page.goto(platformUrl("/"));
    await agencyLink(page, BAYVIEW.subdomain).click();
    await page.getByLabel("Reason for access").fill("End-to-end test of support access");
    await page.getByRole("button", { name: "Start support session" }).click();
    const banner = page.getByRole("status").filter({ hasText: "AWDTECH support session" });
    await expect(banner).toContainText("read-only");
    await expect(page).toHaveURL(hostUrl(BAYVIEW.subdomain));

    // Writes are refused while read-only
    await page.goto(hostUrl(BAYVIEW.subdomain, "/settings"));
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText(/support session is read-only/)).toBeVisible();

    // The agency's audit log records what support looked at
    await page.goto(hostUrl(BAYVIEW.subdomain, "/audit"));
    await expect(page.locator("tbody")).toContainText("support.page_viewed");
    await expect(page.locator("tbody")).toContainText("AWDTECH support");
    await page.getByRole("button", { name: "Leave session" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("agency hosts do not serve the console, and the console does not serve agencies", async ({ page }) => {
    const res = await page.goto(hostUrl(KGOSI.subdomain, "/platform"));
    expect(res?.status()).toBe(404);
    const res2 = await page.goto(platformUrl("/agency/owners"));
    expect(res2?.status()).toBe(404);
  });
});
