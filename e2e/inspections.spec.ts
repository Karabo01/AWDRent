import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE } from "./support";

// Inspections (Phase 3 step 7): an ingoing inspection, room by room with a
// photo, completed into a report filed with the lease.

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

test.describe("inspections", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("records an ingoing inspection and files the report with the lease", async ({ page }) => {
    // A fresh draft lease each run: one ingoing inspection per lease
    await page.goto(hostUrl(KGOSI.subdomain, "/leases/new"));
    await page.getByLabel("Unit").selectOption({ index: 1 });
    await page.getByLabel("Main tenant").selectOption({ index: 1 });
    await page.getByLabel("Start date").fill("2027-02-01");
    await page.getByLabel("Monthly rent (R)").fill("5000");
    await page.getByRole("button", { name: "Create draft lease" }).click();
    await expect(page.getByTestId("eft-reference")).toBeVisible({ timeout: 30_000 });

    const card = page.locator("#inspections");
    await card.getByLabel("Inspection").selectOption("ingoing");
    await card.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("heading", { name: "Ingoing inspection" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("inspection-room").first()).toBeVisible();

    await page.getByLabel("Room", { exact: true }).fill("Garden");
    await page.getByLabel("Item", { exact: true }).fill("Irrigation");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByLabel("Garden: Irrigation condition")).toBeVisible();

    const photos = page.locator("#documents");
    await photos.getByLabel("Item").selectOption({ label: "Kitchen: Stove and oven" });
    await photos.getByLabel(/Photo \(JPG/).setInputFiles({ name: "stove.png", mimeType: "image/png", buffer: PNG });
    await photos.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("status")).toContainText("Uploaded", { timeout: 30_000 });

    // Completing with items unrated is refused
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Save and complete" }).click();
    await expect(page.getByText(/Rate every item first/)).toBeVisible({ timeout: 30_000 });

    for (const select of await page.locator('select[name^="condition:"]').all()) await select.selectOption("good");
    await page.getByLabel("Kitchen: Stove and oven condition").selectOption("fair");
    await page.getByLabel("Kitchen: Stove and oven notes").fill("Back plate scratched");
    await page.getByLabel("Present").fill("Tenant and agent");
    await page.getByRole("button", { name: "Save and complete" }).click();
    await expect(page.getByRole("link", { name: "Download the report" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Back plate scratched")).toBeVisible();

    await page.getByRole("link", { name: "Back to the lease" }).click();
    await expect(page.locator("#inspections")).toContainText("Completed");
    await expect(page.getByTestId("documents-list")).toContainText("Ingoing inspection report");
  });
});
