import { env } from "@awdrent/config";
import { closeDb, schema, withPlatform } from "@awdrent/db";
import { createStaffLogin, ensurePlatformLogin } from "@awdrent/db/dev-logins";
import { eq } from "drizzle-orm";
import { updateAgencySettings } from "../src/agency-settings";
import { activateLease, createLease, giveNotice } from "../src/leases";
import { createOwner, updateOwnerBank } from "../src/owners";
import type { Actor } from "../src/portfolio";
import { createProperty, createUnit, setPropertyAgents } from "../src/properties";
import { createTenant, type TenantInput } from "../src/tenants";
import { DEMO } from "./demo";

// Demo data for local development and CI: two agencies with staff logins
// (2FA pre-enrolled), owners, properties, units, tenants and leases, so the
// isolation between agencies can be seen and tested. Created through the
// same services as the app, so encryption, audit and EFT references are real.
//
//   npm run db:seed            (skips agencies that already exist)

function assertNotProduction() {
  const domain = env().APP_BASE_DOMAIN;
  const local = domain === "localhost" || domain.endsWith(".localhost") || domain.endsWith(".test");
  if (!local && process.env.SEED_DEMO_I_UNDERSTAND !== "yes") {
    throw new Error(
      `Refusing to seed demo logins on ${domain}: their passwords are public. ` +
        "Set SEED_DEMO_I_UNDERSTAND=yes only for a throwaway staging server.",
    );
  }
}

const tenant = (fullName: string, extra: Partial<TenantInput> = {}): TenantInput => ({
  fullName,
  idKind: "sa_id",
  idNumber: "",
  email: null,
  phone: null,
  employer: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  consentGiven: true,
  emailOptIn: true,
  smsOptIn: false,
  whatsappOptIn: false,
  notes: null,
  ...extra,
});

const owner = (name: string, extra: Record<string, unknown> = {}) => ({
  kind: "individual" as const,
  name,
  idKind: "sa_id" as const,
  idOrRegNo: "",
  email: null,
  phone: null,
  postalAddress: null,
  commissionPercent: 1000,
  vatRegistered: false,
  vatNumber: null,
  notes: null,
  ...extra,
});

const property = (ownerId: string, name: string, addressLine1: string, suburb: string, city: string, type: "house" | "apartment_block" = "house") => ({
  ownerId,
  name,
  type,
  addressLine1,
  addressLine2: null,
  suburb,
  city,
  province: null,
  postalCode: null,
  notes: null,
});

const unit = (label: string, bedrooms: number) => ({ label, bedrooms, bathrooms: 1, status: "vacant" as const, notes: null });

const lease = (unitId: string, primaryTenantId: string, rent: number, start: string, end: string | null, coTenantIds: string[] = []) => ({
  unitId,
  primaryTenantId,
  coTenantIds,
  startDate: start,
  endDate: end,
  rent,
  dueDay: 1,
  deposit: rent * 2,
  escalationPercent: 800,
  escalationDate: end ? `${Number(end.slice(0, 4))}-${end.slice(5, 7)}-01` : null,
  noticeDays: 30,
  notes: null,
});

async function seedAgency(spec: (typeof DEMO.agencies)[number], index: number) {
  const existing = await withPlatform((tx) =>
    tx.select({ id: schema.agencies.id }).from(schema.agencies).where(eq(schema.agencies.subdomain, spec.subdomain)),
  );
  if (existing.length) {
    console.log(`[seed] ${spec.name} already exists; skipping`);
    return;
  }
  const [agency] = await withPlatform((tx) =>
    tx
      .insert(schema.agencies)
      .values({ name: spec.name, subdomain: spec.subdomain, eftPrefix: spec.eftPrefix, brandColour: spec.brandColour, includedUnits: 50, includedSms: 500 })
      .returning(),
  );
  const agencyId = agency!.id;
  const adminId = await createStaffLogin(agencyId, { ...spec.logins.admin, role: "admin", phone: "0825550100" });
  const agentId = await createStaffLogin(agencyId, { ...spec.logins.agent, role: "agent", phone: "0825550101" });
  await createStaffLogin(agencyId, { ...spec.logins.accounts, role: "accounts" });
  const admin: Actor = { ctx: { agencyId, userId: adminId }, role: "admin", userId: adminId };

  await updateAgencySettings(admin.ctx, {
    name: spec.name,
    brandColour: spec.brandColour,
    trustBankName: index === 0 ? "FNB" : "Standard Bank",
    trustAccountNo: index === 0 ? "62000000001" : "10000000002",
    quietHoursStart: "20:00",
    quietHoursEnd: "07:00",
  });

  const city = index === 0 ? "Johannesburg" : "Cape Town";
  const o1 = await createOwner(admin, owner(index === 0 ? "Thabo Mokoena" : "Annelie Smit", { idOrRegNo: index === 0 ? "8001015009087" : "7505120123083", email: "owner1@example.test" }));
  await updateOwnerBank(admin, o1, { bankName: "Capitec", bankBranchCode: "470010", bankAccountHolder: "Owner One", bankAccountNo: index === 0 ? "1234567890" : "2345678901" });
  const o2 = await createOwner(admin, {
    ...owner(index === 0 ? "Kaya Holdings (Pty) Ltd" : "Seapoint Investments Trust"),
    kind: index === 0 ? "company" : "trust",
    idKind: "other",
    idOrRegNo: index === 0 ? "2015/123456/07" : "IT1234/2010",
    commissionPercent: 850,
    vatRegistered: true,
    vatNumber: "4123456789",
  });

  const house = await createProperty(admin, property(o1, index === 0 ? "12 Oak Street" : "4 Beach Road", index === 0 ? "12 Oak Street" : "4 Beach Road", index === 0 ? "Melville" : "Muizenberg", city));
  const block = await createProperty(admin, property(o2, index === 0 ? "Kaya Court" : "Seapoint Mansions", index === 0 ? "3 Jan Smuts Avenue" : "88 Main Road", index === 0 ? "Parktown" : "Sea Point", city, "apartment_block"));
  await setPropertyAgents(admin, block, [agentId]);

  const houseUnit = await createUnit(admin, house, unit("Main house", 3));
  const flats = [];
  for (let i = 1; i <= 4; i++) flats.push(await createUnit(admin, block, unit(`Flat ${i}`, i % 2 ? 2 : 1)));

  const t1 = await createTenant(admin, tenant(index === 0 ? "Ayanda Khumalo" : "Liesl Jacobs", { idNumber: "9001015009086", email: "t1@example.test", phone: "0825550201", smsOptIn: true }));
  const t2 = await createTenant(admin, tenant(index === 0 ? "Lindiwe Nkosi" : "Craig Petersen", { email: "t2@example.test", phone: "0835550202" }));
  const t3 = await createTenant(admin, tenant(index === 0 ? "Sipho Nkosi" : "Megan Petersen", { email: "t3@example.test" }));
  const t4 = await createTenant(admin, tenant(index === 0 ? "Bongani Zulu" : "Yusuf Davids", { email: "t4@example.test", consentGiven: false }));

  const l1 = await createLease(admin, lease(houseUnit, t1, 1_250_000, "2025-11-01", "2026-10-31"));
  await activateLease(admin, l1.id);
  const l2 = await createLease(admin, lease(flats[0]!, t2, 750_000, "2025-03-01", null, [t3]));
  await activateLease(admin, l2.id);
  const l3 = await createLease(admin, lease(flats[1]!, t4, 680_000, "2026-02-01", "2027-01-31"));
  await activateLease(admin, l3.id);
  await giveNotice(admin, l3.id, { noticeDate: "2026-10-01", endDate: "2026-11-30", note: "Relocating for work" });
  await createLease(admin, lease(flats[2]!, t1, 720_000, "2026-12-01", "2027-11-30"));

  console.log(`[seed] ${spec.name}: ${spec.subdomain}.${env().APP_BASE_DOMAIN} (EFT ${l1.eftReference}, ${l2.eftReference}, ${l3.eftReference}, …)`);
}

async function main() {
  assertNotProduction();
  await ensurePlatformLogin(DEMO.platform);
  for (const [i, a] of DEMO.agencies.entries()) await seedAgency(a, i);
  console.log(`[seed] done. Demo logins use the password "${DEMO.platform.password}"; see README for TOTP setup.`);
}

main()
  .catch((err: unknown) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
