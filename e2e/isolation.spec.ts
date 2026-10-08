import { expect, test } from "@playwright/test";
import { BAYVIEW, hostUrl, KGOSI, STATE, statusOf } from "./support";

// Cross-agency attempts through the browser, as the pen test will try them:
// another agency's ids in URLs, the other agency's host, and its files.

let bayviewLeasePath = "";
let bayviewOwnerPath = "";
let bayviewTenantPath = "";

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE.bayviewAdmin });
  const page = await context.newPage();
  await page.goto(hostUrl(BAYVIEW.subdomain, "/leases"));
  bayviewLeasePath = (await page.locator("tbody a").first().getAttribute("href"))!;
  await page.goto(hostUrl(BAYVIEW.subdomain, "/owners"));
  bayviewOwnerPath = (await page.locator("tbody a").first().getAttribute("href"))!;
  await page.goto(hostUrl(BAYVIEW.subdomain, "/tenants"));
  bayviewTenantPath = (await page.locator("tbody a").first().getAttribute("href"))!;
  await context.close();
});

test.describe("one agency cannot reach another", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("another agency's record ids answer 404", async ({ page }) => {
    for (const path of [bayviewLeasePath, bayviewOwnerPath, bayviewTenantPath]) {
      const res = await page.goto(hostUrl(KGOSI.subdomain, path));
      expect(res?.status(), path).toBe(404);
    }
  });

  test("the session does not work on the other agency's host", async ({ page }) => {
    await page.goto(hostUrl(BAYVIEW.subdomain, bayviewLeasePath));
    await expect(page).toHaveURL(/\/login$/);
  });

  test("document downloads and uploads for another agency's records are refused", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain));
    const tenantId = bayviewTenantPath.split("/").pop()!;
    const upload = await page.evaluate(async (id) => {
      const form = new FormData();
      form.set("subjectType", "tenant");
      form.set("subjectId", id);
      form.set("kind", "other");
      form.set("returnTo", "/");
      form.set("file", new File(["%PDF-1.4\n"], "x.pdf", { type: "application/pdf" }));
      return (await fetch("/documents/upload", { method: "POST", body: form, redirect: "manual" })).status;
    }, tenantId);
    expect(upload).toBe(404);
    expect(await statusOf(page, `/documents/${tenantId}/download`)).toBe(404);
  });
});

test.describe("an agent cannot reach outside their portfolio", () => {
  test.use({ storageState: STATE.kgosiAgent });

  test("an unassigned property answers 404", async ({ browser, page }) => {
    const admin = await browser.newContext({ storageState: STATE.kgosiAdmin });
    const adminPage = await admin.newPage();
    await adminPage.goto(hostUrl(KGOSI.subdomain, "/properties?q=Oak"));
    const oakPath = (await adminPage.getByRole("link", { name: "12 Oak Street", exact: true }).getAttribute("href"))!;
    await admin.close();
    const res = await page.goto(hostUrl(KGOSI.subdomain, oakPath));
    expect(res?.status()).toBe(404);
  });
});
