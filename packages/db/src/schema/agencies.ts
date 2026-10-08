import { sql } from "drizzle-orm";
import { check, integer, pgEnum, pgTable, text, time, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_columns";

export const agencyStatus = pgEnum("agency_status", ["active", "suspended"]);

/**
 * The tenant root. Not agency-scoped itself, but protected by RLS so the app
 * role can only see and update its own agency's row (see the rls migration).
 */
export const agencies = pgTable(
  "agencies",
  {
    id: pk(),
    name: text().notNull(),
    // {subdomain}.awdrent.co.za
    subdomain: text().notNull(),
    logoKey: text(),
    brandColour: text().notNull().default("#1f4e8c"),
    trustBankName: text(),
    // Encrypted; see packages/core/src/crypto.ts
    trustAccountNoEnc: text(),
    trustAccountNoLast4: text(),
    // Shown to tenants with the account number on the portal's payment page (D77)
    trustAccountHolder: text(),
    trustBranchCode: text(),
    // Prefix for EFT references: "KL" gives KL-0042
    eftPrefix: text().notNull(),
    smsSenderName: text(),
    // Shown on receipts, statements and letters (D60)
    legalName: text(),
    registrationNo: text(),
    // Property Practitioners Regulatory Authority Fidelity Fund Certificate
    ffcNumber: text(),
    vatNumber: text(),
    physicalAddress: text(),
    contactPhone: text(),
    contactEmail: text(),
    quietHoursStart: time().notNull().default("20:00"),
    quietHoursEnd: time().notNull().default("07:00"),
    plan: text().notNull().default("standard"),
    includedUnits: integer().notNull().default(0),
    includedSms: integer().notNull().default(0),
    status: agencyStatus().notNull().default("active"),
    suspendedReason: text(),
    ...timestamps,
    // Platform admin who created it
    createdBy: uuid(),
  },
  (t) => [
    uniqueIndex("agencies_subdomain_key").on(t.subdomain),
    check(
      "agencies_subdomain_format",
      sql`${t.subdomain} ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$' AND ${t.subdomain} NOT IN ('admin', 'www', 'api', 'files', 'mail', 'app')`,
    ),
    check("agencies_eft_prefix_format", sql`${t.eftPrefix} ~ '^[A-Z]{2,4}$'`),
    check("agencies_brand_colour_format", sql`${t.brandColour} ~ '^#[0-9a-fA-F]{6}$'`),
    check("agencies_trust_last4_format", sql`${t.trustAccountNoLast4} IS NULL OR ${t.trustAccountNoLast4} ~ '^[0-9]{1,4}$'`),
  ],
);
