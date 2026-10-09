import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE, unique } from "./support";

// Tenant onboarding (Phase 3 step 5). The applicant's link is read from the
// messages log. Files wait for their virus scan (no scanner here), so the
// agent rejects one rather than accepting; approval is covered by the core tests.

const PDF = { name: "doc.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") };

test.describe("tenant onboarding", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("an agent invites an applicant, who consents, fills in their details, uploads and submits; a file is sent back", async ({ page, browser }) => {
    const name = unique("Applicant");
    await page.goto(hostUrl(KGOSI.subdomain, "/applications/new"));
    await page.getByLabel("Unit").selectOption({ index: 1 });
    await page.getByLabel("Applicant's name").fill(name);
    await page.getByLabel("Email").fill("applicant@e2e.test");
    await page.getByLabel("Monthly rent (R)").fill("9500");
    await page.getByRole("button", { name: "Send the application link" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 30_000 });
    const applicationUrl = page.url();

    await page.goto(hostUrl(KGOSI.subdomain, `/messages?q=${encodeURIComponent(name)}`));
    const invite = page.getByTestId("messages").getByRole("row").filter({ hasText: "Application invite" }).first();
    await invite.getByText("Show text").click();
    const link = (await invite.innerText()).match(/https?:\/\/\S+\/a\/[A-Za-z0-9_-]{32}/)?.[0];
    expect(link).toBeTruthy();

    const applicant = await browser.newPage({ storageState: { cookies: [], origins: [] } });
    await applicant.goto(link!);
    await applicant.getByRole("button", { name: "I agree: start my application" }).click();
    await applicant.getByLabel("ID or passport number").fill("9001015009086");
    await applicant.getByLabel("Mobile number").fill("0825550199");
    await applicant.getByRole("button", { name: "Save my details" }).click();
    await expect(applicant.getByText("Saved (ends 9086)")).toBeVisible({ timeout: 30_000 });
    const items = applicant.getByTestId("applicant-items").locator("li");
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      if (!(await item.innerText()).includes("Needed")) continue;
      await item.locator("input[type=file]").setInputFiles(PDF);
      await item.getByRole("button", { name: "Upload" }).click();
      await expect(items.nth(i)).toContainText("received", { timeout: 30_000 });
    }
    await applicant.getByRole("button", { name: "Submit my application" }).click();
    await expect(applicant.getByTestId("application-submitted")).toBeVisible({ timeout: 30_000 });

    // The agent sends one file back
    await page.goto(applicationUrl);
    const first = page.getByTestId("application-items").locator("li").first();
    await first.getByRole("button", { name: "Reject" }).click();
    await first.getByLabel("What is wrong").fill("the photo is blurred");
    await first.getByRole("button", { name: "Ask for a new file" }).click();
    await expect(first).toContainText("Rejected (the photo is blurred)");

    await applicant.reload();
    await expect(applicant.getByTestId("applicant-items").locator("li").first()).toContainText("please send a new one (the photo is blurred)");
    await applicant.close();
  });
});
