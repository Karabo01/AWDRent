import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgEnum, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { leases } from "./leases";

// The rent ledger. A lease's balance is always charges (not voided) minus
// approved payments; it is never stored (spec). Charges are never edited:
// mistakes are voided (D42). Which charges a payment covers is computed
// oldest-first, not stored (D34, D43).

export const chargeType = pgEnum("charge_type", [
  "rent",
  "opening_balance",
  "late_fee",
  "utility",
  "damage",
  "admin_fee",
  "other",
]);

export const charges = pgTable(
  "charges",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    leaseId: uuid().notNull(),
    type: chargeType().notNull(),
    // First day of the month the rent is for; null for other charges
    period: date(),
    dueDate: date().notNull(),
    amountCents: integer().notNull(),
    description: text().notNull(),
    voidedAt: tstz(),
    voidReason: text(),
    voidedBy: uuid(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    index("charges_agency_lease_due_idx").on(t.agencyId, t.leaseId, t.dueDate),
    // Rent is raised once per lease per month, however often the job runs
    uniqueIndex("charges_agency_lease_rent_period_key")
      .on(t.agencyId, t.leaseId, t.period)
      .where(sql`${t.type} = 'rent' and ${t.voidedAt} is null`),
    foreignKey({ name: "charges_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
    check("charges_amount_range", sql`${t.amountCents} > 0 and ${t.amountCents} <= 1000000000`),
    check("charges_rent_has_period", sql`(${t.type} = 'rent') = (${t.period} is not null)`),
    check("charges_void_reason", sql`(${t.voidedAt} is null) = (${t.voidReason} is null)`),
  ],
);

// "deposit": arrears paid from the tenant's deposit at the end of a lease
export const paymentSource = pgEnum("payment_source", ["bank_import", "pop", "manual", "opening_balance", "deposit"]);
// "reversed": an approved payment taken back (bounced, wrongly matched, voided deposit deduction)
export const paymentStatus = pgEnum("payment_status", ["pending", "approved", "rejected", "reversed"]);

/**
 * Money received for a lease. Only approved payments count toward the
 * balance, and a payment is approved only when matched to a trust-account
 * bank line (spec, D33). The exceptions are "opening_balance" (D45) and
 * "deposit" (arrears paid from the deposit). An approved payment can only be
 * reversed, with a reason; it is never edited.
 */
export const payments = pgTable(
  "payments",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    leaseId: uuid().notNull(),
    amountCents: integer().notNull(),
    paidOn: date().notNull(),
    source: paymentSource().notNull(),
    status: paymentStatus().notNull().default("pending"),
    // Set in Phase 2 step 3 (bank statement import)
    bankLineId: uuid(),
    reference: text(),
    notes: text(),
    approvedBy: uuid(),
    approvedAt: tstz(),
    reversedAt: tstz(),
    reversalReason: text(),
    reversedBy: uuid(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    index("payments_agency_lease_paid_idx").on(t.agencyId, t.leaseId, t.paidOn),
    unique("payments_agency_id_id_key").on(t.agencyId, t.id),
    foreignKey({ name: "payments_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
    check("payments_amount_range", sql`${t.amountCents} > 0 and ${t.amountCents} <= 1000000000`),
    check("payments_approved_fields", sql`(${t.status}::text in ('approved', 'reversed')) = (${t.approvedAt} is not null)`),
    check("payments_reversed_fields", sql`(${t.status}::text = 'reversed') = (${t.reversedAt} is not null and ${t.reversalReason} is not null)`),
  ],
);
