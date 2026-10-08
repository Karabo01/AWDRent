import { expect, test } from "@playwright/test";
import { BAYVIEW, hostUrl, KGOSI, signIn } from "./support";

test.describe("staff sign-in", () => {
  test("signs in with password and authenticator code, and signs out", async ({ page }) => {
    await signIn(page, hostUrl(BAYVIEW.subdomain, "/login"), BAYVIEW.logins.accounts);
    await expect(page.getByTestId("current-user")).toContainText("Accounts");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("refuses correct credentials on another agency's address", async ({ page }) => {
    await page.goto(hostUrl(BAYVIEW.subdomain, "/login"));
    await page.getByLabel("Email").fill(KGOSI.logins.agent.email);
    await page.getByLabel("Password").fill(KGOSI.logins.agent.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("sends visitors without a session to the sign-in page", async ({ page }) => {
    await page.goto(hostUrl(KGOSI.subdomain, "/owners"));
    await expect(page).toHaveURL(/\/login$/);
    // The agency logo when it has one, otherwise its name
    await expect(page.getByRole("img", { name: KGOSI.name }).or(page.getByText(KGOSI.name))).toBeVisible();
  });
});
