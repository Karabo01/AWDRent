import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE, statusOf } from "./support";

// Messages are queued here; delivering them is the worker's job (tested in
// packages/core/test/messages.test.ts with fake providers).

test.describe("messages", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("logs the POP confirmation and lets the tenant opt out of SMS from the link", async ({ page }) => {
    const cents = 10_000 + Math.floor(Math.random() * 89_999);
    const shown = (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2 }).replace(/\s/g, " ");

    // Ayanda Khumalo has opted in to email and SMS
    await page.goto(hostUrl(KGOSI.subdomain, `/leases?status=active&q=${encodeURIComponent("Ayanda Khumalo")}`));
    await page.locator("tbody a").first().click();
    const pops = page.locator("#pops");
    await pops.getByLabel("Amount paid (R)").fill((cents / 100).toFixed(2));
    await pops.locator("input[type=file]").setInputFiles({ name: "pop.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
    await pops.getByRole("button", { name: "Upload proof of payment" }).click();
    await expect(page.getByText("Sent to accounts for checking against the bank statement.")).toBeVisible();

    await page.getByRole("link", { name: "Messages", exact: true }).first().click();
    const log = page.getByTestId("messages");
    const rows = log.getByRole("row").filter({ hasText: "Proof of payment received" }).filter({ hasText: "Ayanda Khumalo" });
    const sms = rows.filter({ hasText: "SMS" }).first();
    await sms.getByText("Show text").click();
    await expect(sms).toContainText(`proof of payment of R${shown}`);
    await expect(rows.filter({ hasText: "Email" }).first()).toContainText("Waiting");

    const optOutLink = (await sms.innerText()).match(/Opt out: (\S+\/o\/[A-Za-z0-9]+)/)?.[1];
    expect(optOutLink).toBeTruthy();
    const optOutPath = new URL(optOutLink!.startsWith("http") ? optOutLink! : `https://${optOutLink}`).pathname;

    // Signed out, as the tenant would be
    await page.context().clearCookies();
    await page.goto(hostUrl(KGOSI.subdomain, optOutPath));
    await expect(page.getByText("Stop messages", { exact: true })).toBeVisible();
    await expect(page.getByLabel("SMS")).toBeChecked();
    await page.getByRole("button", { name: "Stop these messages" }).click();
    await expect(page.getByRole("status")).toContainText("You will no longer receive SMS messages");
    expect(await statusOf(page, "/o/NOSUCHCODE")).toBe(200);
    await page.goto(hostUrl(KGOSI.subdomain, "/o/NOSUCHCODE"));
    await expect(page.getByText("Link not recognised", { exact: true })).toBeVisible();
  });

  test("restores the demo tenant's SMS consent", async ({ page }) => {
    // Keeps the previous test repeatable against the same database
    await page.goto(hostUrl(KGOSI.subdomain, `/tenants?q=${encodeURIComponent("Ayanda Khumalo")}`));
    await page.locator("tbody a").first().click();
    const sms = page.getByLabel("SMS messages");
    if (!(await sms.isChecked())) {
      await sms.check();
      await page.getByRole("button", { name: "Save tenant" }).click();
      await expect(page.getByText("Saved")).toBeVisible();
    }
  });

  test("lets admins reword a message and go back to the standard wording", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/settings/messages"));
    const card = page.getByTestId("wording-pop_received");
    const smsForm = card.locator("form").filter({ has: page.getByRole("button", { name: "Save SMS wording" }) });
    await smsForm.getByLabel("SMS text").fill("Thanks {name}, got your POP for R{amount} at {flat}.");
    await smsForm.getByRole("button", { name: "Save SMS wording" }).click();
    await expect(smsForm.getByRole("alert")).toContainText("Unknown variable: {flat}");

    await smsForm.getByLabel("SMS text").fill("Thanks {name}, we have your proof of payment of R{amount}.");
    await smsForm.getByRole("button", { name: "Save SMS wording" }).click();
    await expect(card.getByText("Your wording")).toBeVisible();
    await card.getByRole("button", { name: "Use the standard wording" }).click();
    await expect(card.getByText("Your wording")).toHaveCount(0);
  });
});

test.describe("reminders", () => {
  test.use({ storageState: STATE.kgosiAgent });

  test("an agent pauses a lease's overdue messages for a payment arrangement and resumes them", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, `/leases?q=${encodeURIComponent("Lindiwe Nkosi")}`));
    await page.locator("tbody a").first().click();
    const card = page.locator("#reminders");
    // Leave it as found if an earlier run stopped half-way
    if (await card.getByRole("button", { name: "Resume overdue messages" }).isVisible()) {
      await card.getByRole("button", { name: "Resume overdue messages" }).click();
    }
    await card.getByLabel("Reason").fill("Paying the arrears in two parts");
    await card.getByRole("button", { name: "Pause overdue messages" }).click();
    await expect(card.getByTestId("reminders-paused")).toContainText("Paying the arrears in two parts");
    await card.getByRole("button", { name: "Resume overdue messages" }).click();
    await expect(card.getByTestId("reminders-paused")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Pause overdue messages" })).toBeVisible();
  });
});
