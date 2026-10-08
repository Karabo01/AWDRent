import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE } from "./support";

test.describe("documents", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("uploads a PDF into the virus check and refuses a disguised program", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/tenants"));
    await page.getByRole("link", { name: "Ayanda Khumalo" }).click();
    const panel = page.locator("#documents");

    await panel.locator("input[type=file]").setInputFiles({ name: "payslip.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ\x90\x00 program") });
    await panel.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText("Only PDF, JPG and PNG files can be uploaded.")).toBeVisible();

    await panel.locator("select[name=kind]").selectOption("payslip");
    await panel
      .locator("input[type=file]")
      .setInputFiles({ name: "payslip.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
    await panel.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText(/Uploaded\. It will be available once the virus check finishes/)).toBeVisible();
    // Until the worker has scanned it there is no download link
    await expect(page.getByTestId("documents-list").getByText("payslip.pdf").first()).toBeVisible();
  });
});
