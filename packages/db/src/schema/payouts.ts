import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { owners } from "./records";
import { ownerStatements, statementRuns } from "./statements";

// Owner payouts (spec 5; D97–D99). A batch pays the approved statements of a
// month that are owed money and not yet in a batch. Each item keeps the bank
// details it was made with (account number encrypted), so the CSV the agency
// loaded can be produced again unchanged.

export const payoutBatchStatus = pgEnum("payout_batch_status", ["created", "paid"]);

export const payoutBatches = pgTable(
  "payout_batches",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    runId: uuid().notNull(),
    status: payoutBatchStatus().notNull().default("created"),
    totalCents: integer().notNull(),
    paidAt: tstz(),
    paidBy: uuid(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    uniqueIndex("payout_batches_agency_id_id_key").on(t.agencyId, t.id),
    index("payout_batches_agency_run_idx").on(t.agencyId, t.runId),
    foreignKey({ name: "payout_batches_run_fk", columns: [t.agencyId, t.runId], foreignColumns: [statementRuns.agencyId, statementRuns.id] }),
    check("payout_batches_paid", sql`(${t.status} = 'paid') = (${t.paidAt} is not null)`),
  ],
);

export const payoutItems = pgTable(
  "payout_items",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    batchId: uuid().notNull(),
    statementId: uuid().notNull(),
    ownerId: uuid().notNull(),
    amountCents: integer().notNull(),
    bankName: text().notNull(),
    branchCode: text().notNull(),
    accountHolder: text().notNull(),
    // Encrypted; see packages/core/src/crypto.ts
    accountNoEnc: text().notNull(),
    accountNoLast4: text().notNull(),
    // The reference on the owner's bank statement
    reference: text().notNull(),
    ...timestamps,
  },
  (t) => [
    // A statement is paid once
    uniqueIndex("payout_items_agency_statement_key").on(t.agencyId, t.statementId),
    index("payout_items_agency_batch_idx").on(t.agencyId, t.batchId),
    foreignKey({ name: "payout_items_batch_fk", columns: [t.agencyId, t.batchId], foreignColumns: [payoutBatches.agencyId, payoutBatches.id] }).onDelete("cascade"),
    foreignKey({ name: "payout_items_statement_fk", columns: [t.agencyId, t.statementId], foreignColumns: [ownerStatements.agencyId, ownerStatements.id] }),
    foreignKey({ name: "payout_items_owner_fk", columns: [t.agencyId, t.ownerId], foreignColumns: [owners.agencyId, owners.id] }),
    check("payout_items_amount_positive", sql`${t.amountCents} > 0`),
  ],
);
