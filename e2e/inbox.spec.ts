import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE, unique } from "./support";

// The POP inbox (Phase 2 step 10). There is no mailbox in the test run, so
// emails are handed to receiveEmail() directly, as the worker does after
// reading them over IMAP. Needs the same .env as the app under test.

process.loadEnvFile(".env");

function rawEmail(subject: string, text: string) {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n").toString("base64");
  const boundary = `e2e${Date.now()}`;
  return Buffer.from(
    [
      `Message-ID: <${Date.now()}-${Math.random()}@e2e.test>`,
      `Date: ${new Date().toUTCString()}`,
      "From: A Stranger <stranger@e2e.test>",
      "To: pop@kgosi-lettings.test",
      `Delivered-To: pop+${KGOSI.subdomain}@${(process.env.POP_INBOX_ADDRESS ?? "pop@awdrent.co.za").split("@")[1]}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      text,
      `--${boundary}`,
      'Content-Type: application/pdf; name="proof.pdf"',
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="proof.pdf"',
      "",
      pdf,
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  );
}

test.describe("POP inbox", () => {
  test.use({ storageState: STATE.kgosiAccounts });

  test("accounts turn an emailed proof of payment into a POP, or dismiss an email", async ({ page }) => {
    const { receiveEmail } = await import("../packages/core/src/inbox");
    const toConvert = unique("Payment for my flat");
    const toDismiss = unique("Newsletter");
    expect((await receiveEmail(rawEmail(toConvert, "Please see attached, thank you"))).outcome).toBe("inbox");
    expect((await receiveEmail(rawEmail(toDismiss, "Our latest offers"))).outcome).toBe("inbox");

    await page.goto(hostUrl(KGOSI.subdomain, "/payments"));
    await expect(page.getByTestId("inbox-link")).toContainText("to do");
    await page.getByTestId("inbox-link").click();

    const card = page.getByTestId("inbox-email").filter({ hasText: toConvert });
    await expect(card).toContainText("From A Stranger <stranger@e2e.test>");
    await expect(card).toContainText("proof.pdf");
    await card.getByLabel("Payment reference").fill("KL-9999");
    await card.getByLabel("Amount paid (R)").fill("321.09");
    await card.getByRole("button", { name: "Create proof of payment" }).click();
    await expect(card).toContainText("No lease has the payment reference KL-9999.");
    await card.getByLabel("Payment reference").fill("KL-0002");
    await card.getByRole("button", { name: "Create proof of payment" }).click();
    await expect(page.getByTestId("inbox-email").filter({ hasText: toConvert })).toHaveCount(0);

    const other = page.getByTestId("inbox-email").filter({ hasText: toDismiss });
    await other.getByRole("button", { name: /Dismiss/ }).click();
    await other.getByLabel("Why dismiss?").fill("Not a proof of payment");
    await other.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("inbox-email").filter({ hasText: toDismiss })).toHaveCount(0);

    // The new POP is in the review queue, waiting for the bank line
    await page.goto(hostUrl(KGOSI.subdomain, "/payments"));
    await expect(page.getByTestId("pending-pop").filter({ hasText: /321,09/ }).first()).toContainText("via email");
  });
});

test.describe("POP inbox settings", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("shows the forwarding address", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/settings"));
    await expect(page.getByTestId("pop-forward-address")).toHaveText(new RegExp(`^pop\\+${KGOSI.subdomain}@`));
  });
});
