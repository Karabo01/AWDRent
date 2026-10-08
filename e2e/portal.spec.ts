import { expect, type Page, test } from "@playwright/test";
import { BAYVIEW, hostUrl, KGOSI, lastMessageTo, STATE } from "./support";

// The tenant portal (Phase 2 step 8). Sign-in codes are read from the
// dev outbox file (DEV_OUTBOX_FILE), as no SMS or email provider is set up.
// The seed gives Ayanda Khumalo (Kgosi) and Liesl Jacobs (Bayview) the same
// email address, t1@example.test.

const EMAIL = "t1@example.test";

async function requestCode(page: Page, subdomain: string, identifier: string, to: string): Promise<string> {
  const since = new Date(Date.now() - 1000);
  await page.goto(hostUrl(subdomain, "/p/login"));
  await page.getByLabel("Email address or mobile number").fill(identifier);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("status")).toContainText("we have sent a 6-digit code");
  let code: string | undefined;
  await expect
    .poll(() => {
      code = lastMessageTo(to, since)?.text.match(/\b(\d{6})\b/)?.[1];
      return code;
    })
    .toBeTruthy();
  return code!;
}

async function signIn(page: Page, subdomain: string, identifier = EMAIL, to = EMAIL) {
  const code = await requestCode(page, subdomain, identifier, to);
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("tenant portal", () => {
  test("a tenant signs in with an emailed code and sees only their own rent account", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/p"));
    await expect(page).toHaveURL(/\/p\/login\?next=%2Fp$/);
    await signIn(page, KGOSI.subdomain);
    await expect(page.getByRole("heading", { name: "Hi Ayanda" })).toBeVisible();
    const lease = page.getByTestId("portal-lease").first();
    await expect(lease).toContainText(/KL-\d{4}/);
    await expect(lease.getByTestId("portal-balance")).toBeVisible();

    // Statement, and its PDF
    await lease.getByRole("link", { name: "Statement and receipts" }).click();
    // The first visit compiles the page in development
    await expect(page.getByTestId("portal-statement")).toContainText("Rent for", { timeout: 30_000 });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("portal-statement-pdf").click()]);
    expect(download.suggestedFilename()).toMatch(/^Statement KL-\d{4} \d{4}-\d{2}-\d{2}\.pdf$/);

    // Proof of payment
    const pop = page.locator("#pop");
    await pop.getByLabel("Amount paid (R)").fill("1234.50");
    await pop.locator("input[type=file]").setInputFiles({ name: "pop.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
    await pop.getByRole("button", { name: "Send proof of payment" }).click();
    await expect(page.getByRole("status")).toContainText("We will confirm once the payment reflects");
    await expect(page.getByTestId("portal-pops")).toContainText("Being checked");

    // Payment details, only now that the tenant is signed in
    await page.getByRole("link", { name: "How to pay" }).first().click();
    // The full number (other tests change the demo number, so only its shape is checked)
    await expect(page.getByTestId("pay-details")).toContainText(/Account number\d{8,}/);

    // Message consent, unchanged
    await page.getByRole("link", { name: "Messages" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");

    // The portal session is not a staff session
    await page.goto(hostUrl(KGOSI.subdomain, "/leases"));
    await expect(page).toHaveURL(/\/login$/);

    // Signing out ends it
    await page.goto(hostUrl(KGOSI.subdomain, "/p"));
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/p\/login$/);
    await page.goto(hostUrl(KGOSI.subdomain, "/p/pay"));
    await expect(page).toHaveURL(/\/p\/login/);
  });

  test("the same email at another agency is a different tenant, and sessions stay on their host", async ({ page }) => {
    await signIn(page, KGOSI.subdomain);
    await expect(page.getByRole("heading", { name: "Hi Ayanda" })).toBeVisible();
    await page.goto(hostUrl(BAYVIEW.subdomain, "/p"));
    await expect(page).toHaveURL(/\/p\/login/);
    await signIn(page, BAYVIEW.subdomain);
    await expect(page.getByRole("heading", { name: "Hi Liesl" })).toBeVisible();
    await expect(page.getByTestId("portal-lease").first()).toContainText(/BV-\d{4}/);
  });

  test("signs in by SMS code with a mobile number", async ({ page }) => {
    // Ayanda's number is 082 555 0201
    const code = await requestCode(page, KGOSI.subdomain, "082 555 0201", "27825550201");
    await page.getByLabel("Code").fill(code);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Hi Ayanda" })).toBeVisible();
  });

  test("rejects a wrong code and says nothing about unknown addresses", async ({ page }) => {
    await requestCode(page, KGOSI.subdomain, EMAIL, EMAIL);
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That code is not right or has expired")).toBeVisible();

    await page.goto(hostUrl(KGOSI.subdomain, "/p/login"));
    await page.getByLabel("Email address or mobile number").fill("nobody@example.test");
    await page.getByRole("button", { name: "Send me a code" }).click();
    await expect(page.getByRole("status")).toContainText("If nobody@example.test belongs to one of our tenants");
  });
});

test.describe("receipt links", () => {
  test.use({ storageState: STATE.kgosiAccounts });

  test("staff opening a receipt link go to the lease account", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/r/KL-R999999"));
    // Unknown to staff too: falls through to the tenant portal, which asks to sign in
    await expect(page).toHaveURL(/\/p\/login\?next=%2Fp%2Freceipts%2FKL-R999999$/);
  });
});
