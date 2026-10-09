import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { documents } from "./documents";
import { leases } from "./leases";
import { owners } from "./records";

// Owner statements (spec 5; D91–D96). Accounts run them for a calendar month
// after it ends: a draft is worked out, checked, then approved, which
// freezes it, files a PDF with the owner and emails it. Only rent goes to the
// owner; the agency keeps its commission (the first month's rent of each new
// lease, or a percentage of rent collected, per owner) and any other charges
// tenants pay. Each month pays the rent collected since the last approved
// statement, so late payments and reversals flow into the next one.

export const statementRunStatus = pgEnum("statement_run_status", ["draft", "approved"]);

export const statementRuns = pgTable(
  "statement_runs",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    // First day of the month the run covers
    period: date().notNull(),
    status: statementRunStatus().notNull().default("draft"),
    approvedAt: tstz(),
    approvedBy: uuid(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    uniqueIndex("statement_runs_agency_id_id_key").on(t.agencyId, t.id),
    uniqueIndex("statement_runs_agency_period_key").on(t.agencyId, t.period),
    check("statement_runs_period_first", sql`extract(day from ${t.period}) = 1`),
    check("statement_runs_approved", sql`(${t.status} = 'approved') = (${t.approvedAt} is not null)`),
  ],
);

export const ownerStatements = pgTable(
  "owner_statements",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    runId: uuid().notNull(),
    ownerId: uuid().notNull(),
    period: date().notNull(),
    // A shortfall carried from the last approved statement (zero or negative)
    openingCents: integer().notNull(),
    rentCents: integer().notNull(),
    commissionCents: integer().notNull(),
    // VAT on the commission: added for percentage owners, included in the first-month fee
    vatCents: integer().notNull(),
    // opening + rent - commission (- VAT for percentage owners); a shortfall if negative
    payableCents: integer().notNull(),
    documentId: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("owner_statements_agency_id_id_key").on(t.agencyId, t.id),
    uniqueIndex("owner_statements_agency_run_owner_key").on(t.agencyId, t.runId, t.ownerId),
    index("owner_statements_agency_owner_idx").on(t.agencyId, t.ownerId, t.period),
    foreignKey({ name: "owner_statements_run_fk", columns: [t.agencyId, t.runId], foreignColumns: [statementRuns.agencyId, statementRuns.id] }).onDelete("cascade"),
    foreignKey({ name: "owner_statements_owner_fk", columns: [t.agencyId, t.ownerId], foreignColumns: [owners.agencyId, owners.id] }),
    foreignKey({ name: "owner_statements_document_fk", columns: [t.agencyId, t.documentId], foreignColumns: [documents.agencyId, documents.id] }),
  ],
);

export const ownerStatementLines = pgTable(
  "owner_statement_lines",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    statementId: uuid().notNull(),
    leaseId: uuid().notNull(),
    // "Flat 4, Sunset Court · KL-0042 · Ayanda Khumalo"
    label: text().notNull(),
    // Rent collected since the last approved statement (negative after a reversal)
    rentCents: integer().notNull(),
    // Commission: letting fee taken this month, or percentage of the rent
    commissionCents: integer().notNull(),
    vatCents: integer().notNull(),
    // "letting_fee" (VAT included) or "percent" (VAT added), so the first month's fee is only ever taken once
    basis: text().notNull(),
    // How the commission was worked out, for the statement
    commissionNote: text(),
    ...timestamps,
  },
  (t) => [
    index("owner_statement_lines_agency_statement_idx").on(t.agencyId, t.statementId),
    index("owner_statement_lines_agency_lease_idx").on(t.agencyId, t.leaseId),
    foreignKey({
      name: "owner_statement_lines_statement_fk",
      columns: [t.agencyId, t.statementId],
      foreignColumns: [ownerStatements.agencyId, ownerStatements.id],
    }).onDelete("cascade"),
    foreignKey({ name: "owner_statement_lines_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
    check("owner_statement_lines_basis", sql`${t.basis} in ('letting_fee', 'percent')`),
  ],
);
