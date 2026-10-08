import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgEnum, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { leases } from "./leases";

// Trust-account bank statements (spec; D33, D36). A payment only counts once
// it is matched to a line here (spec). Each agency saves how its bank's CSV
// is laid out; only money in (credits) is imported.

export const dateFormat = pgEnum("bank_date_format", ["YMD", "DMY", "MDY"]);

export const bankImportProfiles = pgTable(
  "bank_import_profiles",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    name: text().notNull(),
    // Column headings exactly as they appear in the bank's file
    dateColumn: text().notNull(),
    // Either one signed amount column, or separate credit / debit columns
    amountColumn: text(),
    creditColumn: text(),
    debitColumn: text(),
    referenceColumn: text().notNull(),
    descriptionColumn: text(),
    dateFormat: dateFormat().notNull().default("YMD"),
    // Rows above the heading row (some banks print an account summary first)
    skipRows: integer().notNull().default(0),
    archivedAt: tstz(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    unique("bank_import_profiles_agency_id_id_key").on(t.agencyId, t.id),
    check("bank_import_profiles_amount_columns", sql`(${t.amountColumn} is not null) <> (${t.creditColumn} is not null)`),
    check("bank_import_profiles_skip_rows", sql`${t.skipRows} between 0 and 50`),
  ],
);

export const bankImports = pgTable(
  "bank_imports",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    profileId: uuid().notNull(),
    fileName: text().notNull(),
    fileSha256: text().notNull(),
    periodFrom: date(),
    periodTo: date(),
    creditLines: integer().notNull(),
    newLines: integer().notNull(),
    autoMatched: integer().notNull(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    unique("bank_imports_agency_id_id_key").on(t.agencyId, t.id),
    index("bank_imports_agency_created_idx").on(t.agencyId, t.createdAt),
    foreignKey({
      name: "bank_imports_profile_fk",
      columns: [t.agencyId, t.profileId],
      foreignColumns: [bankImportProfiles.agencyId, bankImportProfiles.id],
    }),
  ],
);

export const bankLineStatus = pgEnum("bank_line_status", ["unmatched", "matched", "ignored"]);

export const bankLines = pgTable(
  "bank_lines",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    importId: uuid().notNull(),
    lineDate: date().notNull(),
    amountCents: integer().notNull(),
    reference: text().notNull(),
    description: text(),
    // Same statement line seen again in a later or overlapping file → skipped
    fingerprint: text().notNull(),
    status: bankLineStatus().notNull().default("unmatched"),
    matchedLeaseId: uuid(),
    autoMatched: boolean().notNull().default(false),
    ignoredReason: text(),
    resolvedBy: uuid(),
    resolvedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique("bank_lines_agency_id_id_key").on(t.agencyId, t.id),
    uniqueIndex("bank_lines_agency_fingerprint_key").on(t.agencyId, t.fingerprint),
    index("bank_lines_agency_status_idx").on(t.agencyId, t.status, t.lineDate),
    foreignKey({ name: "bank_lines_import_fk", columns: [t.agencyId, t.importId], foreignColumns: [bankImports.agencyId, bankImports.id] }),
    foreignKey({ name: "bank_lines_lease_fk", columns: [t.agencyId, t.matchedLeaseId], foreignColumns: [leases.agencyId, leases.id] }),
    check("bank_lines_amount_positive", sql`${t.amountCents} > 0 and ${t.amountCents} <= 1000000000`),
    check("bank_lines_matched_has_lease", sql`(${t.status} = 'matched') = (${t.matchedLeaseId} is not null)`),
    check("bank_lines_ignored_has_reason", sql`(${t.status} = 'ignored') = (${t.ignoredReason} is not null)`),
  ],
);
