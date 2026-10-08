import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { units } from "./records";

export const tenantIdKind = pgEnum("tenant_id_kind", ["sa_id", "passport"]);

export const tenants = pgTable(
  "tenants",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    fullName: text().notNull(),
    idKind: tenantIdKind().notNull().default("sa_id"),
    idNumberEnc: text(),
    idNumberLast4: text(),
    idNumberBlindIndex: text(),
    email: text(),
    phone: text(),
    employer: text(),
    emergencyContactName: text(),
    emergencyContactPhone: text(),
    // POPIA consent and channel opt-ins (each change is audited)
    consentAt: tstz(),
    emailOptIn: boolean().notNull().default(true),
    smsOptIn: boolean().notNull().default(false),
    whatsappOptIn: boolean().notNull().default(false),
    // Short code in opt-out links (D39, D68); set when first needed
    optOutCode: text(),
    notes: text(),
    archivedAt: tstz(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    unique("tenants_agency_id_id_key").on(t.agencyId, t.id),
    index("tenants_agency_name_idx").on(t.agencyId, t.fullName),
    index("tenants_agency_id_index_idx").on(t.agencyId, t.idNumberBlindIndex),
    uniqueIndex("tenants_agency_opt_out_code_key").on(t.agencyId, t.optOutCode),
  ],
);

export const leaseStatus = pgEnum("lease_status", ["draft", "active", "notice_given", "ended", "terminated"]);

/**
 * One rental agreement for a unit. Renewals, escalations and amendments
 * update this row and are recorded in lease_events, so the EFT reference and
 * (from Phase 2) the running balance carry across terms (decisions D3, D17).
 */
export const leases = pgTable(
  "leases",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    unitId: uuid().notNull(),
    // e.g. KL-0042; unique within the agency, never reused (D2)
    eftReference: text().notNull(),
    status: leaseStatus().notNull().default("draft"),
    startDate: date().notNull(),
    // First month rent is raised for (D44); defaults to the start month
    billingStartsOn: date(),
    // Null = month-to-month after the start date
    endDate: date(),
    rentCents: integer().notNull(),
    // Day of the month rent is due (1–31; short months use their last day)
    dueDay: integer().notNull().default(1),
    depositCents: integer().notNull().default(0),
    // Basis points (D11): 800 = 8%
    escalationBps: integer(),
    escalationDate: date(),
    noticeDays: integer().notNull().default(30),
    noticeGivenOn: date(),
    terminatedOn: date(),
    terminationReason: text(),
    notes: text(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    unique("leases_agency_id_id_key").on(t.agencyId, t.id),
    uniqueIndex("leases_agency_eft_reference_key").on(t.agencyId, t.eftReference),
    index("leases_agency_unit_idx").on(t.agencyId, t.unitId),
    index("leases_agency_status_idx").on(t.agencyId, t.status),
    foreignKey({ name: "leases_unit_fk", columns: [t.agencyId, t.unitId], foreignColumns: [units.agencyId, units.id] }),
    check("leases_rent_positive", sql`${t.rentCents} > 0`),
    check("leases_deposit_non_negative", sql`${t.depositCents} >= 0`),
    check("leases_due_day_range", sql`${t.dueDay} between 1 and 31`),
    check("leases_notice_days_range", sql`${t.noticeDays} between 0 and 365`),
    check("leases_escalation_range", sql`${t.escalationBps} is null or ${t.escalationBps} between 0 and 10000`),
    check("leases_dates_order", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    // Generated: PREFIX-0042. Imported references may differ (D4) but must be bank-safe.
    check("leases_eft_reference_format", sql`${t.eftReference} ~ '^[A-Z0-9][A-Z0-9-]{2,19}$'`),
  ],
);

export const leaseTenants = pgTable(
  "lease_tenants",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    leaseId: uuid().notNull(),
    tenantId: uuid().notNull(),
    isPrimary: boolean().notNull().default(false),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    uniqueIndex("lease_tenants_agency_lease_tenant_key").on(t.agencyId, t.leaseId, t.tenantId),
    // Exactly one primary tenant per lease (at most one enforced here; at least one in code)
    uniqueIndex("lease_tenants_agency_one_primary_key").on(t.agencyId, t.leaseId).where(sql`${t.isPrimary}`),
    index("lease_tenants_agency_tenant_idx").on(t.agencyId, t.tenantId),
    foreignKey({ name: "lease_tenants_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
    foreignKey({ name: "lease_tenants_tenant_fk", columns: [t.agencyId, t.tenantId], foreignColumns: [tenants.agencyId, tenants.id] }),
  ],
);

export const leaseEventType = pgEnum("lease_event_type", [
  "created",
  "activated",
  "amended",
  "renewed",
  "escalated",
  "notice_given",
  "terminated",
  "ended",
]);

/** History of each lease. Append-only, like the audit log. */
export const leaseEvents = pgTable(
  "lease_events",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    leaseId: uuid().notNull(),
    type: leaseEventType().notNull(),
    effectiveDate: date().notNull(),
    note: text(),
    before: jsonb(),
    after: jsonb(),
    createdAt: tstz().notNull().defaultNow(),
    createdBy: createdBy(),
  },
  (t) => [
    index("lease_events_agency_lease_idx").on(t.agencyId, t.leaseId, t.createdAt),
    foreignKey({ name: "lease_events_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
  ],
);

/** Per-agency counter for EFT references. */
export const eftSequences = pgTable("eft_sequences", {
  agencyId: agencyColumn()
    .primaryKey()
    .references(() => agencies.id),
  lastValue: integer().notNull().default(0),
  ...timestamps,
});
