import { expect, test } from "@playwright/test";
import { hostUrl, KGOSI, STATE, unique } from "./support";

test.describe("properties and units", () => {
  test.use({ storageState: STATE.kgosiAdmin });

  test("creates a property with units and assigns an agent", async ({ page }) => {
    const name = unique("E2E Court");
    await page.goto(hostUrl(KGOSI.subdomain, "/properties/new"));
    await page.getByLabel("Owner").selectOption({ label: "Thabo Mokoena" });
    await page.getByLabel("Property name").fill(name);
    await page.getByLabel("Type").selectOption("apartment_block");
    await page.getByLabel("Street address").fill("1 Test Street");
    await page.getByLabel("City / town").fill("Johannesburg");
    await page.getByRole("button", { name: "Create property" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();

    const addUnit = page.locator("form", { has: page.getByRole("button", { name: "Add unit" }) });
    await addUnit.getByLabel("Unit").fill("Flat A");
    await addUnit.getByRole("button", { name: "Add unit" }).click();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(1);
    await addUnit.getByLabel("Unit").fill("Flat A");
    await addUnit.getByRole("button", { name: "Add unit" }).click();
    await expect(page.getByText("This property already has a unit with that label")).toBeVisible();

    await page.getByLabel(KGOSI.logins.agent.name).check();
    await page.getByRole("button", { name: "Save agents" }).click();
    await expect(page.locator("form", { has: page.getByRole("button", { name: "Save agents" }) }).getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByText(`Agents: ${KGOSI.logins.agent.name}`)).toBeVisible();
  });
});

test.describe("properties as agent", () => {
  test.use({ storageState: STATE.kgosiAgent });

  test("lists only the agent's portfolio", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/properties"));
    await expect(page.getByRole("link", { name: "Kaya Court" })).toBeVisible();
    await expect(page.getByRole("link", { name: "12 Oak Street", exact: true })).toHaveCount(0);
  });
});
