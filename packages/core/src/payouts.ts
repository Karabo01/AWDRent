import { schema, withAgency } from "@awdrent/db";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { audit } from "./audit";
import { decrypt, encrypt, last4 } from "./crypto";
import { csvRands, toCsv } from "./csv";
import { type Actor, authorise, NotFoundError } from "./portfolio";

// Owner payouts (spec 5; D97–D99). Accounts make a batch from a month's
// approved statements; an admin downloads it as a CSV for the bank's bulk
// payment import (it holds full account numbers, D6); accounts mark it paid
// once the bank has processed it. A batch not yet paid can be cancelled.

export class PayoutError extends Error {}

const OWNER_BANK_FIELD = "owners.bank_account_no";
const ITEM_FIELD = "payout_items.account_no";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** The reference on the owner's bank statement, short enough for every bank: "KL RENT OCT26". */
export const payoutReference = (prefix: string, period: string) => `${prefix} RENT ${MONTHS[Number(period.slice(5, 7)) - 1]}${period.slice(2, 4)}`;

export interface Skipped {
  ownerName: string;
  reason: string;
}

/** A batch for every statement of the month that is owed money and not yet in a batch. */
export async function createBatch(actor: Actor, runId: string): Promise<{ batchId: string; items: number; skipped: Skipped[] }> {
  authorise(actor, "statements.manage");
  const agencyId = actor.ctx.agencyId;
  return withAgency(actor.ctx, async (tx) => {
    const [run] = await tx.select().from(schema.statementRuns).where(eq(schema.statementRuns.id, runId)).for("update");
    if (!run) throw new NotFoundError("Statement run");
    if (run.status !== "approved") throw new PayoutError("Approve the statements before paying owners.");
    const [agency] = await tx.select({ prefix: schema.agencies.eftPrefix }).from(schema.agencies);
    const due = await tx
      .select({ statement: schema.ownerStatements, owner: schema.owners })
      .from(schema.ownerStatements)
      .innerJoin(schema.owners, eq(schema.owners.id, schema.ownerStatements.ownerId))
      .leftJoin(schema.payoutItems, eq(schema.payoutItems.statementId, schema.ownerStatements.id))
      .where(and(eq(schema.ownerStatements.runId, run.id), gt(schema.ownerStatements.payableCents, 0), isNull(schema.payoutItems.id)))
      .orderBy(asc(schema.owners.name));
    const skipped: Skipped[] = [];
    const items = [];
    for (const { statement, owner } of due) {
      if (!owner.bankAccountNoEnc || !owner.bankName || !owner.bankBranchCode || !owner.bankAccountHolder) {
        skipped.push({ ownerName: owner.name, reason: "No bank details" });
        continue;
      }
      const accountNo = decrypt(owner.bankAccountNoEnc, { agencyId, field: OWNER_BANK_FIELD });
      items.push({
        statementId: statement.id,
        ownerId: owner.id,
        amountCents: statement.payableCents,
        bankName: owner.bankName,
        branchCode: owner.bankBranchCode,
        accountHolder: owner.bankAccountHolder,
        accountNoEnc: encrypt(accountNo, { agencyId, field: ITEM_FIELD }),
        accountNoLast4: last4(accountNo),
        reference: payoutReference(agency!.prefix, run.period),
      });
    }
    if (items.length === 0) {
      throw new PayoutError(skipped.length ? `Nothing to pay: ${skipped.map((s) => `${s.ownerName} (${s.reason.toLowerCase()})`).join(", ")}.` : "Every owner owed money this month is already in a batch.");
    }
    const total = items.reduce((s, i) => s + i.amountCents, 0);
    const [batch] = await tx.insert(schema.payoutBatches).values({ runId: run.id, totalCents: total }).returning();
    await tx.insert(schema.payoutItems).values(items.map((i) => ({ ...i, batchId: batch!.id })));
    await audit(tx, { action: "payout.batch_created", entity: "payout_batch", entityId: batch!.id, after: { period: run.period, items: items.length, totalCents: total, skipped: skipped.length } });
    return { batchId: batch!.id, items: items.length, skipped };
  });
}

export async function listBatches(actor: Actor, runId: string) {
  authorise(actor, "statements.manage");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const batches = await tx.select().from(schema.payoutBatches).where(eq(schema.payoutBatches.runId, runId)).orderBy(desc(schema.payoutBatches.createdAt));
    const items = batches.length
      ? await tx
          .select({
            id: schema.payoutItems.id,
            batchId: schema.payoutItems.batchId,
            statementId: schema.payoutItems.statementId,
            ownerName: schema.owners.name,
            amountCents: schema.payoutItems.amountCents,
            bankName: schema.payoutItems.bankName,
            accountNoLast4: schema.payoutItems.accountNoLast4,
          })
          .from(schema.payoutItems)
          .innerJoin(schema.owners, eq(schema.owners.id, schema.payoutItems.ownerId))
          .where(inArray(schema.payoutItems.batchId, batches.map((b) => b.id)))
          .orderBy(asc(schema.owners.name))
      : [];
    return batches.map((b) => ({ ...b, items: items.filter((i) => i.batchId === b.id) }));
  });
}

/** The bank bulk-payment file (general layout, D98). Admins only: it holds full account numbers (D6). Audited. */
export async function payoutCsv(actor: Actor, batchId: string): Promise<{ csv: string; filename: string }> {
  authorise(actor, "statements.manage");
  authorise(actor, "owner.bank.view");
  return withAgency(actor.ctx, async (tx) => {
    const [batch] = await tx
      .select({ batch: schema.payoutBatches, period: schema.statementRuns.period })
      .from(schema.payoutBatches)
      .innerJoin(schema.statementRuns, eq(schema.statementRuns.id, schema.payoutBatches.runId))
      .where(eq(schema.payoutBatches.id, batchId));
    if (!batch) throw new NotFoundError("Payout batch");
    const [agency] = await tx.select({ prefix: schema.agencies.eftPrefix, name: schema.agencies.name }).from(schema.agencies);
    const items = await tx
      .select({ item: schema.payoutItems, ownerName: schema.owners.name })
      .from(schema.payoutItems)
      .innerJoin(schema.owners, eq(schema.owners.id, schema.payoutItems.ownerId))
      .where(eq(schema.payoutItems.batchId, batchId))
      .orderBy(asc(schema.owners.name));
    const csv = toCsv(
      ["Beneficiary name", "Bank", "Branch code", "Account number", "Amount", "Beneficiary reference", "Own reference"],
      items.map(({ item }) => [
        item.accountHolder,
        item.bankName,
        item.branchCode,
        decrypt(item.accountNoEnc, { agencyId: actor.ctx.agencyId, field: ITEM_FIELD }),
        csvRands(item.amountCents),
        item.reference,
        `${agency!.prefix} OWNER ${item.reference.split(" ").at(-1)}`,
      ]),
    );
    await audit(tx, { action: "payout.csv_downloaded", entity: "payout_batch", entityId: batchId, after: { items: items.length, totalCents: batch.batch.totalCents } });
    return { csv, filename: `Owner payouts ${agency!.prefix} ${batch.period.slice(0, 7)}.csv` };
  });
}

export async function markBatchPaid(actor: Actor, batchId: string): Promise<void> {
  authorise(actor, "statements.manage");
  await withAgency(actor.ctx, async (tx) => {
    const [batch] = await tx.select().from(schema.payoutBatches).where(eq(schema.payoutBatches.id, batchId)).for("update");
    if (!batch) throw new NotFoundError("Payout batch");
    if (batch.status === "paid") throw new PayoutError("This batch is already marked paid.");
    await tx.update(schema.payoutBatches).set({ status: "paid", paidAt: sql`now()`, paidBy: actor.userId }).where(eq(schema.payoutBatches.id, batchId));
    await audit(tx, { action: "payout.batch_paid", entity: "payout_batch", entityId: batchId, after: { totalCents: batch.totalCents } });
  });
}

/** Cancels a batch not yet paid; its statements can then go into a new batch. */
export async function cancelBatch(actor: Actor, batchId: string): Promise<void> {
  authorise(actor, "statements.manage");
  await withAgency(actor.ctx, async (tx) => {
    const [batch] = await tx.select().from(schema.payoutBatches).where(eq(schema.payoutBatches.id, batchId)).for("update");
    if (!batch) throw new NotFoundError("Payout batch");
    if (batch.status === "paid") throw new PayoutError("A paid batch cannot be cancelled.");
    await tx.delete(schema.payoutBatches).where(eq(schema.payoutBatches.id, batchId));
    await audit(tx, { action: "payout.batch_cancelled", entity: "payout_batch", entityId: batchId, before: { totalCents: batch.totalCents } });
  });
}
