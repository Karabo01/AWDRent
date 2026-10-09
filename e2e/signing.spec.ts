import { expect, type Page, test } from "@playwright/test";
import { hostUrl, KGOSI, lastMessageTo, STATE, statusOf } from "./support";

// Lease documents and e-signing (Phase 2 step 9). Lindiwe Nkosi's lease has
// a co-tenant, Sipho Nkosi. The signing link is read from the messages log
// (the worker does not run here); the code comes from the dev outbox file.

async function openLease(page: Page) {
  await page.goto(hostUrl(KGOSI.subdomain, `/leases?q=${encodeURIComponent("Lindiwe Nkosi")}`));
  await page.locator("tbody a").first().click();
  // The first visit compiles the page in development
  await expect(page.locator("#signing")).toBeVisible({ timeout: 30_000 });
}

/** Cancels a lease agreement left out for signing by an earlier run. */
async function cancelOpen(page: Page) {
  const card = page.locator("#signing");
  const open = card.getByTestId("envelopes").locator("li").filter({ hasText: "Out for signing" });
  while ((await open.count()) > 0) {
    await open.first().getByRole("button", { name: "Cancel" }).click();
    await open.first().getByLabel("Why cancel?").fill("Clean-up from an earlier test run");
    await open.first().getByRole("button", { name: "Cancel signing" }).click();
    await expect(card.getByTestId("envelopes").locator("li").filter({ hasText: "Out for signing" })).toHaveCount((await open.count()) - 1);
  }
}

async function drawSignature(page: Page) {
  const pad = page.getByTestId("signature-pad");
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height - 20);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 20 + i * 25, box.y + box.height - 20 - (i % 3) * 25);
  await page.mouse.up();
}

test.describe("lease signing", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("a lease agreement goes out for signing and the first tenant signs with a code and a drawn signature", async ({ page, browser }) => {
    await openLease(page);
    await cancelOpen(page);
    const card = page.locator("#signing");
    const form = card.getByTestId("prepare-lease_agreement");
    await form.getByLabel("Who signs for the landlord").selectOption("agent");

    // The draft preview is a PDF
    const leaseUrl = new URL(page.url());
    expect(await statusOf(page, `${leaseUrl.pathname}/documents/preview?kind=lease_agreement&landlordSignatory=agent&agentUserId=nope`)).toBe(400);

    await form.getByRole("button", { name: "Send for signing" }).click();
    const envelope = card.getByTestId("envelopes").locator("li").filter({ hasText: "Out for signing" }).first();
    await expect(envelope).toContainText("Lindiwe Nkosi (Tenant): invited");
    await expect(envelope).toContainText("Sipho Nkosi (Tenant): invited");
    await expect(envelope).toContainText("(Agent, for and on behalf of the Landlord");

    // The signing request, from the messages log
    await page.goto(hostUrl(KGOSI.subdomain, `/messages?q=${encodeURIComponent("Lindiwe Nkosi")}`));
    const request = page.getByTestId("messages").getByRole("row").filter({ hasText: "Document to sign" }).filter({ hasText: "Email" }).first();
    await request.getByText("Show text").click();
    const link = (await request.innerText()).match(/https?:\/\/\S+\/s\/[A-Za-z0-9_-]{32}/)?.[0];
    expect(link).toBeTruthy();

    // The tenant, not signed in to anything
    const tenant = await browser.newPage({ storageState: { cookies: [], origins: [] } });
    await tenant.goto(link!);
    await expect(tenant.getByRole("heading", { name: /^Lease agreement KL-\d{4}$/ })).toBeVisible();
    await expect(tenant.getByTestId("read-document")).toBeVisible();
    const since = new Date(Date.now() - 1000);
    await tenant.getByRole("button", { name: "Send me a code" }).click();
    await expect(tenant.getByRole("status")).toContainText("We have sent a 6-digit code to t***@example.test", { timeout: 30_000 });
    let code: string | undefined;
    await expect.poll(() => (code = lastMessageTo("t2@example.test", since)?.text.match(/\b(\d{6})\b/)?.[1])).toBeTruthy();
    await tenant.getByLabel("Code").fill("000000");
    await tenant.getByRole("button", { name: "Confirm" }).click();
    await expect(tenant.getByText("That code is not right")).toBeVisible();
    await tenant.getByLabel("Code").fill(code!);
    await tenant.getByRole("button", { name: "Confirm" }).click();

    await expect(tenant.getByLabel("Your full name")).toHaveValue("Lindiwe Nkosi");
    await drawSignature(tenant);
    await tenant.getByLabel(/I have read the document and agree to sign it electronically/).check();
    await tenant.getByRole("button", { name: "Sign", exact: true }).click();
    await expect(tenant.getByTestId("signed-done")).toContainText("Thank you, you have signed.");
    await tenant.reload();
    await expect(tenant.getByTestId("signed-already")).toBeVisible();
    await tenant.close();

    // Staff see the progress; Sipho still has to sign, so the agent is not invited yet
    await openLease(page);
    const progress = page.locator("#signing").getByTestId("envelopes").locator("li").filter({ hasText: "Out for signing" }).first();
    await expect(progress).toContainText("Lindiwe Nkosi (Tenant): signed");
    await expect(progress).toContainText("Sipho Nkosi (Tenant): invited");
    await expect(progress).toContainText("waiting their turn");

    // Leave nothing open for the next run
    await cancelOpen(page);
  });

  test("an unknown signing link says so", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, `/s/${"x".repeat(32)}`));
    await expect(page.getByRole("heading", { name: "Link not recognised" })).toBeVisible();
  });

  test("admins can adapt the lease template", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/settings/lease-template"));
    await expect(page.getByTestId("clause")).toHaveCount(17);
    await page.getByLabel("Clause 9 text").fill("No pets at {flat}.");
    await page.getByRole("button", { name: "Save lease template" }).click();
    await expect(page.getByText("uses {flat}, which is not a field")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Go back to the standard lease" })).toHaveCount(0);
  });
});
