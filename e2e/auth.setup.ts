import { test as setup } from "@playwright/test";
import { BAYVIEW, DEMO, hostUrl, KGOSI, platformUrl, signIn, STATE } from "./support";

// Signs each role in once and saves the session for the other tests.

setup("kgosi admin", async ({ page }) => {
  await signIn(page, hostUrl(KGOSI.subdomain, "/login"), KGOSI.logins.admin);
  await page.context().storageState({ path: STATE.kgosiAdmin });
});

setup("kgosi agent", async ({ page }) => {
  await signIn(page, hostUrl(KGOSI.subdomain, "/login"), KGOSI.logins.agent);
  await page.context().storageState({ path: STATE.kgosiAgent });
});

setup("kgosi accounts", async ({ page }) => {
  await signIn(page, hostUrl(KGOSI.subdomain, "/login"), KGOSI.logins.accounts);
  await page.context().storageState({ path: STATE.kgosiAccounts });
});

setup("bayview admin", async ({ page }) => {
  await signIn(page, hostUrl(BAYVIEW.subdomain, "/login"), BAYVIEW.logins.admin);
  await page.context().storageState({ path: STATE.bayviewAdmin });
});

setup("platform admin", async ({ page }) => {
  await signIn(page, platformUrl("/login"), DEMO.platform);
  await page.context().storageState({ path: STATE.platform });
});
