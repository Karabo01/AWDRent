// Demo agencies and logins created by the seed, shared with the Playwright
// tests. FOR LOCAL DEVELOPMENT AND CI ONLY: these passwords and TOTP secrets
// are public in this repository. The seed refuses to run against a real domain.
//
// TOTP codes: the key is the UTF-8 bytes of `totp`
// (otpauth: new OTPAuth.Secret({ buffer: Buffer.from(totp) })).

export interface DemoLogin {
  name: string;
  email: string;
  password: string;
  totp: string;
}

export const DEMO_PASSWORD = "demo password 2026";

export const DEMO = {
  platform: { name: "Karabo (AWDTECH)", email: "platform@awdtech.test", password: DEMO_PASSWORD, totp: "PLATFORMDEMOSECRETPLATFORMDEMO01" },
  agencies: [
    {
      name: "Kgosi Lettings",
      subdomain: "kgosi",
      eftPrefix: "KL",
      brandColour: "#0f766e",
      logins: {
        admin: { name: "Lerato Kgosi", email: "admin@kgosi.test", password: DEMO_PASSWORD, totp: "KGOSIADMINDEMOSECRETKGOSIADMIN01" },
        agent: { name: "Neo Dube", email: "agent@kgosi.test", password: DEMO_PASSWORD, totp: "KGOSIAGENTDEMOSECRETKGOSIAGENT01" },
        accounts: { name: "Zanele Mthembu", email: "accounts@kgosi.test", password: DEMO_PASSWORD, totp: "KGOSIACCTSDEMOSECRETKGOSIACCTS01" },
      },
    },
    {
      name: "Bayview Rentals",
      subdomain: "bayview",
      eftPrefix: "BV",
      brandColour: "#7c3aed",
      logins: {
        admin: { name: "Pieter van Wyk", email: "admin@bayview.test", password: DEMO_PASSWORD, totp: "BAYVIEWADMINDEMOSECRETBAYVIEW001" },
        agent: { name: "Fatima Adams", email: "agent@bayview.test", password: DEMO_PASSWORD, totp: "BAYVIEWAGENTDEMOSECRETBAYVIEW001" },
        accounts: { name: "Johan Botha", email: "accounts@bayview.test", password: DEMO_PASSWORD, totp: "BAYVIEWACCTSDEMOSECRETBAYVIEW001" },
      },
    },
  ],
} as const;
