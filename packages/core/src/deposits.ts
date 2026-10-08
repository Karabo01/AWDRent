import { schema, type Tx, withAgency } from "@awdrent/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import { LedgerRuleError } from "./ledger";
import { parseRandToCents } from "./money";
import { type Actor, assertLeaseInScope, authorise, NotFoundError } from "./portfolio";

// Deposits (spec; D40). Held apart from rent in their own entries:
//   held = received + interest − deductions − refunds
// Interest is entered as the investment account actually paid it (D40).
// Deductions happen when the tenancy ends; a deduction for unpaid rent
// also pays that rent on the rent ledger (a "deposit" payment).

type Entry = typeof schema.depositEntries.$inferSelect;

const rand = z.string().transform((s, ctx) => {
  const cents = parseRandToCents(s);
  if (cents === null || cents === 0 || cents > 1_000_000_000) {
    ctx.addIssue({ code: "custom", message: "Enter an amount in rand, more than R0" });
    return z.NEVER;
  }
  return cents;
});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const reference = z.string().trim().min(2, "Give the bank or statement reference").max(80);

export const depositMoneySchema = z.object({ amount: rand, date: isoDate, reference });
export const DEDUCTION_KINDS = ["rent_arrears", "damage", "cleaning", "other"] as const;
export const depositDeductionSchema = z.object({
  kind: z.enum(DEDUCTION_KINDS),
  amount: rand,
  date: isoDate,
  description: z.string().trim().min(3, "Say what the deduction is for").max(200),
});

const DEDUCTION_LABEL: Record<(typeof DEDUCTION_KINDS)[number], string> = {
  rent_arrears: "Unpaid rent",
  damage: "Damage",
  cleaning: "Cleaning",
  other: "Deduction",
};

export function depositTotals(entries: Pick<Entry, "type" | "amountCents" | "voidedAt">[]) {
  const sum = (type: Entry["type"]) => entries.filter((e) => e.type === type && !e.voidedAt).reduce((s, e) => s + e.amountCents, 0);
  const received = sum("received");
  const interest = sum("interest");
  const deductions = sum("deduction");
  const refunded = sum("refund");
  return { receivedCents: received, interestCents: interest, deductionsCents: deductions, refundedCents: refunded, heldCents: received + interest - deductions - refunded };
}

/** Locks the lease so deposit changes for it happen one at a time; returns it. */
async function lockLease(tx: Tx, actor: Actor, leaseId: string) {
  await assertLeaseInScope(tx, actor, leaseId);
  const [lease] = await tx.select().from(schema.leases).where(eq(schema.leases.id, leaseId)).for("update");
  if (!lease) throw new NotFoundError("Lease");
  const entries = await tx.select().from(schema.depositEntries).where(eq(schema.depositEntries.leaseId, leaseId));
  return { lease, totals: depositTotals(entries) };
}

export async function getDeposit(actor: Actor, leaseId: string) {
  authorise(actor, "ledger.view");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    await assertLeaseInScope(tx, actor, leaseId);
    const [lease] = await tx.select({ depositCents: schema.leases.depositCents, status: schema.leases.status }).from(schema.leases).where(eq(schema.leases.id, leaseId));
    const entries = await tx
      .select()
      .from(schema.depositEntries)
      .where(eq(schema.depositEntries.leaseId, leaseId))
      .orderBy(asc(schema.depositEntries.entryDate), asc(schema.depositEntries.createdAt));
    const totals = depositTotals(entries);
    return {
      requiredCents: lease!.depositCents,
      outstandingCents: Math.max(lease!.depositCents - totals.receivedCents, 0),
      leaseStatus: lease!.status,
      entries,
      ...totals,
    };
  });
}

async function insertEntry(tx: Tx, leaseId: string, values: Omit<typeof schema.depositEntries.$inferInsert, "leaseId">) {
  const [row] = await tx.insert(schema.depositEntries).values({ ...values, leaseId }).returning();
  await audit(tx, { action: `deposit.${values.type}`, entity: "lease", entityId: leaseId, after: { entryId: row!.id, ...values } });
  return row!.id;
}

/** The tenant paid (part of) the deposit into the trust account. */
export async function recordDepositReceived(actor: Actor, leaseId: string, input: z.infer<typeof depositMoneySchema>): Promise<string> {
  authorise(actor, "deposits.manage");
  return withAgency(actor.ctx, async (tx) => {
    const { lease } = await lockLease(tx, actor, leaseId);
    if (lease.status === "ended" || lease.status === "terminated") throw new LedgerRuleError("This lease is closed.");
    return insertEntry(tx, leaseId, { type: "received", amountCents: input.amount, entryDate: input.date, reference: input.reference, description: "Deposit received" });
  });
}

/** Interest the investment account paid on this deposit (D40). */
export async function recordDepositInterest(actor: Actor, leaseId: string, input: z.infer<typeof depositMoneySchema>): Promise<string> {
  authorise(actor, "deposits.manage");
  return withAgency(actor.ctx, async (tx) => {
    const { totals } = await lockLease(tx, actor, leaseId);
    if (totals.receivedCents === 0) throw new LedgerRuleError("Record the deposit received before its interest.");
    return insertEntry(tx, leaseId, { type: "interest", amountCents: input.amount, entryDate: input.date, reference: input.reference, description: "Interest earned" });
  });
}

/**
 * A deduction at the end of the tenancy. "Unpaid rent" also pays that rent
 * on the rent ledger, so the tenant's arrears clear by the same amount.
 */
export async function recordDepositDeduction(actor: Actor, leaseId: string, input: z.infer<typeof depositDeductionSchema>): Promise<string> {
  authorise(actor, "deposits.manage");
  return withAgency(actor.ctx, async (tx) => {
    const { lease, totals } = await lockLease(tx, actor, leaseId);
    if (lease.status === "draft" || lease.status === "active") {
      throw new LedgerRuleError("Deductions are made when the tenancy ends: record the notice or close the lease first.");
    }
    if (input.amount > totals.heldCents) throw new LedgerRuleError("That is more than the deposit held.");
    let rentPaymentId: string | null = null;
    if (input.kind === "rent_arrears") {
      const [{ balance } = { balance: "0" }] = await tx.execute<{ balance: string }>(sql`
        select (coalesce((select sum(amount_cents) from charges where lease_id = ${leaseId} and voided_at is null), 0)
              - coalesce((select sum(amount_cents) from payments where lease_id = ${leaseId} and status = 'approved'), 0))::bigint as balance`).then((r) => r.rows);
      if (input.amount > Number(balance)) throw new LedgerRuleError("That is more than the rent owed on this lease.");
      const [payment] = await tx
        .insert(schema.payments)
        .values({
          leaseId,
          amountCents: input.amount,
          paidOn: input.date,
          source: "deposit",
          status: "approved",
          approvedAt: sql`now()`,
          approvedBy: actor.userId,
          notes: `Paid from deposit: ${input.description}`,
        })
        .returning({ id: schema.payments.id });
      rentPaymentId = payment!.id;
    }
    return insertEntry(tx, leaseId, {
      type: "deduction",
      amountCents: input.amount,
      entryDate: input.date,
      description: `${DEDUCTION_LABEL[input.kind]}: ${input.description}`,
      rentPaymentId,
    });
  });
}

/** Pays the deposit back once the tenancy has closed. */
export async function recordDepositRefund(actor: Actor, leaseId: string, input: z.infer<typeof depositMoneySchema>): Promise<string> {
  authorise(actor, "deposits.manage");
  return withAgency(actor.ctx, async (tx) => {
    const { lease, totals } = await lockLease(tx, actor, leaseId);
    if (lease.status !== "ended" && lease.status !== "terminated") throw new LedgerRuleError("Refunds are made after the lease has ended.");
    if (input.amount > totals.heldCents) throw new LedgerRuleError("That is more than the deposit held.");
    return insertEntry(tx, leaseId, { type: "refund", amountCents: input.amount, entryDate: input.date, reference: input.reference, description: "Deposit refunded" });
  });
}

/**
 * Voids an entry. Voiding an unpaid-rent deduction also reverses the rent
 * payment it made. Refused if it would leave the held amount below zero.
 */
export async function voidDepositEntry(actor: Actor, entryId: string, reason: string): Promise<void> {
  authorise(actor, "deposits.manage");
  await withAgency(actor.ctx, async (tx) => {
    const [entry] = await tx.select().from(schema.depositEntries).where(eq(schema.depositEntries.id, entryId));
    if (!entry) throw new NotFoundError("Deposit entry");
    const { totals } = await lockLease(tx, actor, entry.leaseId);
    if (entry.voidedAt) throw new LedgerRuleError("This entry is already voided.");
    const adds = entry.type === "received" || entry.type === "interest";
    if (adds && totals.heldCents - entry.amountCents < 0) {
      throw new LedgerRuleError("Voiding this would leave less than nothing held. Void the later deductions or refund first.");
    }
    await tx
      .update(schema.depositEntries)
      .set({ voidedAt: sql`now()`, voidReason: reason, voidedBy: actor.userId })
      .where(eq(schema.depositEntries.id, entryId));
    if (entry.rentPaymentId) {
      await tx
        .update(schema.payments)
        .set({ status: "reversed", reversedAt: sql`now()`, reversalReason: `Deposit deduction voided: ${reason}`, reversedBy: actor.userId })
        .where(and(eq(schema.payments.id, entry.rentPaymentId), eq(schema.payments.status, "approved")));
    }
    await audit(tx, {
      action: "deposit.entry_voided",
      entity: "lease",
      entityId: entry.leaseId,
      before: { entryId, type: entry.type, amountCents: entry.amountCents },
      after: { reason },
    });
  });
}
