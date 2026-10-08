import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { bankLines } from "./banking";
import { leases } from "./leases";
import { payments } from "./ledger";

// Deposits, held apart from rent (spec; Rental Housing Act). Each lease has a
// small ledger of entries; the amount held is always computed:
//   received + interest − deductions − refunds.
// Entries are never edited; a mistake is voided with a reason (like charges, D42).

export const depositEntryType = pgEnum("deposit_entry_type", ["received", "interest", "deduction", "refund"]);

export const depositEntries = pgTable(
  "deposit_entries",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    leaseId: uuid().notNull(),
    type: depositEntryType().notNull(),
    amountCents: integer().notNull(),
    entryDate: date().notNull(),
    description: text().notNull(),
    // Bank or investment-account reference for received, interest and refund entries
    reference: text(),
    // A deduction for unpaid rent posts this payment to the rent ledger
    rentPaymentId: uuid(),
    // For "received": the trust-account statement line it came from
    bankLineId: uuid(),
    voidedAt: tstz(),
    voidReason: text(),
    voidedBy: uuid(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    index("deposit_entries_agency_lease_idx").on(t.agencyId, t.leaseId, t.entryDate),
    foreignKey({ name: "deposit_entries_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
    foreignKey({
      name: "deposit_entries_rent_payment_fk",
      columns: [t.agencyId, t.rentPaymentId],
      foreignColumns: [payments.agencyId, payments.id],
    }),
    uniqueIndex("deposit_entries_agency_bank_line_live_key").on(t.agencyId, t.bankLineId).where(sql`${t.voidedAt} is null`),
    foreignKey({ name: "deposit_entries_bank_line_fk", columns: [t.agencyId, t.bankLineId], foreignColumns: [bankLines.agencyId, bankLines.id] }),
    check("deposit_entries_amount_range", sql`${t.amountCents} > 0 and ${t.amountCents} <= 1000000000`),
    check("deposit_entries_void_reason", sql`(${t.voidedAt} is null) = (${t.voidReason} is null)`),
    check("deposit_entries_rent_payment_only_for_deductions", sql`${t.rentPaymentId} is null or ${t.type} = 'deduction'`),
  ],
);
