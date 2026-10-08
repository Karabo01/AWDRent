import { foreignKey, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { documents } from "./documents";
import { leases } from "./leases";
import { payments } from "./ledger";

// Receipts for rent received (spec; Rental Housing Act). Issued by the
// worker for each approved payment, numbered per agency, stored as a PDF
// lease document. Never deleted: if the payment is reversed, the receipt is
// marked cancelled.

export const receipts = pgTable(
  "receipts",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    paymentId: uuid().notNull(),
    leaseId: uuid().notNull(),
    // e.g. KL-R000123
    receiptNumber: text().notNull(),
    amountCents: integer().notNull(),
    documentId: uuid().notNull(),
    issuedAt: tstz().notNull().defaultNow(),
    cancelledAt: tstz(),
    cancelReason: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("receipts_agency_payment_key").on(t.agencyId, t.paymentId),
    uniqueIndex("receipts_agency_number_key").on(t.agencyId, t.receiptNumber),
    index("receipts_agency_lease_idx").on(t.agencyId, t.leaseId),
    foreignKey({ name: "receipts_payment_fk", columns: [t.agencyId, t.paymentId], foreignColumns: [payments.agencyId, payments.id] }),
    foreignKey({ name: "receipts_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
    foreignKey({ name: "receipts_document_fk", columns: [t.agencyId, t.documentId], foreignColumns: [documents.agencyId, documents.id] }),
  ],
);

/** Per-agency counter for receipt numbers (like eft_sequences). */
export const receiptSequences = pgTable("receipt_sequences", {
  agencyId: agencyColumn()
    .primaryKey()
    .references(() => agencies.id),
  lastValue: integer().notNull().default(0),
  ...timestamps,
});
