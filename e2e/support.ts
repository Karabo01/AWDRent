import { expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { DEMO, type DemoLogin } from "../packages/core/scripts/demo";

export { DEMO };

// End-to-end tests run against the seeded demo data (npm run db:seed) and a
// running app. Hosts are {agency}.{APP_BASE_DOMAIN}:{port}; *.localhost
// resolves to 127.0.0.1 in Chromium.

const domain = process.env.APP_BASE_DOMAIN ?? "localhost";
const port = process.env.E2E_PORT ?? "3000";

export const KGOSI = DEMO.agencies[0];
export const BAYVIEW = DEMO.agencies[1];

export function hostUrl(subdomain: string, path = "/"): string {
  return `http://${subdomain}.${domain}:${port}${path}`;
}
export const platformUrl = (path = "/") => hostUrl("admin", path);

export const STATE = {
  kgosiAdmin: "e2e/.auth/kgosi-admin.json",
  kgosiAgent: "e2e/.auth/kgosi-agent.json",
  kgosiAccounts: "e2e/.auth/kgosi-accounts.json",
  bayviewAdmin: "e2e/.auth/bayview-admin.json",
  platform: "e2e/.auth/platform.json",
};

export function totpCode(login: DemoLogin): string {
  return new OTPAuth.TOTP({ secret: new OTPAuth.Secret({ buffer: Buffer.from(login.totp) }) }).generate();
}

/** Signs in through the real login and two-factor screens. */
export async function signIn(page: Page, url: string, login: DemoLogin): Promise<void> {
  await page.goto(url);
  await page.getByLabel("Email").fill(login.email);
  await page.getByLabel("Password").fill(login.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/login\/two-factor/);
  await page.getByLabel("6-digit code").fill(totpCode(login));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

/** A name no other test run has used. */
export function unique(label: string): string {
  return `${label} ${Date.now().toString(36)}`;
}

/** Status of a same-origin request made by the page (Node cannot resolve *.localhost on every OS). */
export function statusOf(page: Page, path: string): Promise<number> {
  return page.evaluate(async (p) => (await fetch(p, { redirect: "manual" })).status, path);
}
