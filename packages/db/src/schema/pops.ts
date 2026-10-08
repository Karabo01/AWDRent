import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { bankLines } from "./banking";
import { documents } from "./documents";
import { leases, tenants } from "./leases";

// Proofs of payment (spec; D33). A POP never changes a balance by itself:
// it is approved by linking it to the trust-account bank line that shows
// the money arrived, and that line is what pays the rent.

export const popStatus = pgEnum("pop_status", ["pending", "approved", "partial", "rejected"]);
export const popChannel = pgEnum("pop_channel", ["staff", "portal", "email", "whatsapp"]);

export const proofsOfPayment = pgTable(
  "proofs_of_payment",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    leaseId: uuid().notNull(),
    tenantId: uuid(),
    documentId: uuid().notNull(),
    // What the tenant says they paid
    claimedCents: integer().notNull(),
    claimedPaidOn: date().notNull(),
    referenceGiven: text(),
    submittedVia: popChannel().notNull(),
    status: popStatus().notNull().default("pending"),
    // Set on approval: the line that proves it, and how much it showed
    bankLineId: uuid(),
    approvedCents: integer(),
    rejectReason: text(),
    reviewedBy: uuid(),
    reviewedAt: tstz(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    index("proofs_of_payment_agency_status_idx").on(t.agencyId, t.status, t.createdAt),
    index("proofs_of_payment_agency_lease_idx").on(t.agencyId, t.leaseId),
    // One bank line proves one POP
    uniqueIndex("proofs_of_payment_agency_bank_line_key").on(t.agencyId, t.bankLineId).where(sql`${t.bankLineId} is not null`),
    foreignKey({ name: "proofs_of_payment_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
    foreignKey({ name: "proofs_of_payment_tenant_fk", columns: [t.agencyId, t.tenantId], foreignColumns: [tenants.agencyId, tenants.id] }),
    foreignKey({ name: "proofs_of_payment_document_fk", columns: [t.agencyId, t.documentId], foreignColumns: [documents.agencyId, documents.id] }),
    foreignKey({ name: "proofs_of_payment_bank_line_fk", columns: [t.agencyId, t.bankLineId], foreignColumns: [bankLines.agencyId, bankLines.id] }),
    check("proofs_of_payment_claimed_range", sql`${t.claimedCents} > 0 and ${t.claimedCents} <= 1000000000`),
    check("proofs_of_payment_approved_has_line", sql`(${t.status} in ('approved', 'partial')) = (${t.bankLineId} is not null and ${t.approvedCents} is not null)`),
    check("proofs_of_payment_rejected_has_reason", sql`(${t.status} = 'rejected') = (${t.rejectReason} is not null)`),
  ],
);
