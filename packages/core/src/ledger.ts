import { schema, type Tx, withAgency } from "@awdrent/db";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import { raiseRentForLease, todayInSouthAfrica } from "./billing";
import { escalateInTx } from "./leases";
import { parseRandToCents } from "./money";
import { type Actor, assertLeaseInScope, authorise, leaseScope, NotFoundError } from "./portfolio";

// The rent ledger for one lease: charges (debits) and approved payments
// (credits). The balance is always computed (spec), and which charges are
// paid is worked out oldest-first each time (D34, D43).

export class LedgerRuleError extends Error {}

type Charge = typeof schema.charges.$inferSelect;
type Payment = typeof schema.payments.$inferSelect;

export const MANUAL_CHARGE_TYPES = ["utility", "damage", "admin_fee", "late_fee", "other"] as const;

export const chargeSchema = z.object({
  type: z.enum(MANUAL_CHARGE_TYPES),
  amount: z.string().transform((s, ctx) => {
    const cents = parseRandToCents(s);
    if (cents === null || cents === 0 || cents > 1_000_000_000) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in rand, more than R0" });
      return z.NEVER;
    }
    return cents;
  }),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  description: z.string().trim().min(3, "Say what the charge is for").max(200),
});
export type ChargeInput = z.infer<typeof chargeSchema>;

export const voidSchema = z.object({ reason: z.string().trim().min(5, "Give a reason for the auditor").max(300) });

// ─── pure rules ──────────────────────────────────────────────────────

export interface OutstandingCharge {
  id: string;
  dueDate: string;
  amountCents: number;
  paidCents: number;
  outstandingCents: number;
}

/**
 * Oldest-first allocation (D34): approved payments pay off charges in due
 * date order (then creation order). Returns each charge's paid and
 * outstanding amounts, and any credit left over.
 */
export function allocate(
  charges: Pick<Charge, "id" | "dueDate" | "amountCents" | "createdAt" | "voidedAt">[],
  paidTotalCents: number,
): { charges: OutstandingCharge[]; creditCents: number } {
  let remaining = paidTotalCents;
  const live = charges
    .filter((c) => !c.voidedAt)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.getTime() - b.createdAt.getTime());
  const out = live.map((c) => {
    const paid = Math.min(remaining, c.amountCents);
    remaining -= paid;
    return { id: c.id, dueDate: c.dueDate, amountCents: c.amountCents, paidCents: paid, outstandingCents: c.amountCents - paid };
  });
  return { charges: out, creditCents: remaining };
}

export interface StatementLine {
  date: string;
  kind: "charge" | "payment";
  id: string;
  description: string;
  debitCents: number;
  creditCents: number;
  /** Voided charges and pending/rejected payments are shown but do not count. */
  counts: boolean;
  note: string | null;
  balanceCents: number;
}

/** Statement lines in date order with a running balance (charges before payments on the same day). */
export function statement(charges: Charge[], payments: Payment[]): StatementLine[] {
  const rows = [
    ...charges.map((c) => ({
      date: c.dueDate,
      order: 0,
      created: c.createdAt.getTime(),
      kind: "charge" as const,
      id: c.id,
      description: c.description,
      debitCents: c.amountCents,
      creditCents: 0,
      counts: !c.voidedAt,
      note: c.voidedAt ? `Voided: ${c.voidReason}` : null,
    })),
    ...payments.map((p) => ({
      date: p.paidOn,
      order: 1,
      created: p.createdAt.getTime(),
      kind: "payment" as const,
      id: p.id,
      description: p.source === "opening_balance" ? "Opening balance (credit)" : `Payment${p.reference ? ` ${p.reference}` : ""}`,
      debitCents: 0,
      creditCents: p.amountCents,
      counts: p.status === "approved",
      note: p.status === "approved" ? null : p.status === "pending" ? "Awaiting bank confirmation" : "Rejected",
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.created - b.created);
  let balance = 0;
  return rows.map(({ order: _o, created: _c, ...r }) => {
    if (r.counts) balance += r.debitCents - r.creditCents;
    return { ...r, balanceCents: balance };
  });
}

// ─── reads ───────────────────────────────────────────────────────────

async function loadLedger(tx: Tx, leaseId: string) {
  const charges = await tx.select().from(schema.charges).where(eq(schema.charges.leaseId, leaseId)).orderBy(asc(schema.charges.dueDate));
  const payments = await tx.select().from(schema.payments).where(eq(schema.payments.leaseId, leaseId)).orderBy(asc(schema.payments.paidOn));
  return { charges, payments };
}

function summarise(charges: Charge[], payments: Payment[], today: string) {
  const charged = charges.filter((c) => !c.voidedAt).reduce((s, c) => s + c.amountCents, 0);
  const paid = payments.filter((p) => p.status === "approved").reduce((s, p) => s + p.amountCents, 0);
  const alloc = allocate(charges, paid);
  const overdue = alloc.charges.filter((c) => c.dueDate < today).reduce((s, c) => s + c.outstandingCents, 0);
  return { balanceCents: charged - paid, overdueCents: overdue, creditCents: alloc.creditCents, outstanding: alloc.charges.filter((c) => c.outstandingCents > 0) };
}

/** A lease's statement, balance and arrears, for staff who may see the lease. */
export async function getLedger(actor: Actor, leaseId: string, today = todayInSouthAfrica()) {
  authorise(actor, "ledger.view");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    await assertLeaseInScope(tx, actor, leaseId);
    const { charges, payments } = await loadLedger(tx, leaseId);
    return { lines: statement(charges, payments), ...summarise(charges, payments, today) };
  });
}

/** Balance for each of the given leases (lists), in cents. */
export async function balances(actor: Actor, leaseIds: string[]): Promise<Map<string, number>> {
  authorise(actor, "ledger.view");
  if (leaseIds.length === 0) return new Map();
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    // Correlated subqueries name the outer table explicitly (see owners.ts)
    const rows = await tx
      .select({
        leaseId: schema.leases.id,
        balance: sql<string>`(
          coalesce((select sum(c.amount_cents) from charges c where c.lease_id = "leases"."id" and c.voided_at is null), 0)
          - coalesce((select sum(p.amount_cents) from payments p where p.lease_id = "leases"."id" and p.status = 'approved'), 0)
        )::bigint`,
      })
      .from(schema.leases)
      .where(and(inArray(schema.leases.id, leaseIds), leaseScope(actor)));
    return new Map(rows.map((r) => [r.leaseId, Number(r.balance)]));
  });
}

// ─── changes ─────────────────────────────────────────────────────────

export async function addCharge(actor: Actor, leaseId: string, input: ChargeInput): Promise<string> {
  authorise(actor, "ledger.charge");
  return withAgency(actor.ctx, async (tx) => {
    await assertLeaseInScope(tx, actor, leaseId);
    const [lease] = await tx.select({ status: schema.leases.status }).from(schema.leases).where(eq(schema.leases.id, leaseId));
    if (lease?.status === "draft") throw new LedgerRuleError("Activate the lease before adding charges.");
    const [row] = await tx
      .insert(schema.charges)
      .values({ leaseId, type: input.type, dueDate: input.dueDate, amountCents: input.amount, description: input.description })
      .returning();
    await audit(tx, { action: "charge.added", entity: "lease", entityId: leaseId, after: { chargeId: row!.id, ...input } });
    return row!.id;
  });
}

/** Voids a charge (D42). It stays on the statement but no longer counts. */
export async function voidCharge(actor: Actor, chargeId: string, reason: string): Promise<void> {
  authorise(actor, "ledger.void");
  await withAgency(actor.ctx, async (tx) => {
    const [charge] = await tx.select().from(schema.charges).where(eq(schema.charges.id, chargeId)).for("update");
    if (!charge) throw new NotFoundError("Charge");
    await assertLeaseInScope(tx, actor, charge.leaseId);
    if (charge.voidedAt) throw new LedgerRuleError("This charge is already voided.");
    await tx
      .update(schema.charges)
      .set({ voidedAt: sql`now()`, voidReason: reason, voidedBy: actor.userId })
      .where(eq(schema.charges.id, chargeId));
    await audit(tx, {
      action: "charge.voided",
      entity: "lease",
      entityId: charge.leaseId,
      before: { chargeId, type: charge.type, amountCents: charge.amountCents, description: charge.description },
      after: { reason },
    });
  });
}

/**
 * Opening balance for an imported lease (D45): arrears become a charge,
 * credit becomes an approved "opening balance" payment.
 */
export async function recordOpeningBalance(tx: Tx, leaseId: string, cents: number, onDate: string): Promise<void> {
  if (cents > 0) {
    await tx.insert(schema.charges).values({
      leaseId,
      type: "opening_balance",
      dueDate: onDate,
      amountCents: cents,
      description: "Opening balance brought forward",
    });
  } else if (cents < 0) {
    await tx.insert(schema.payments).values({
      leaseId,
      amountCents: -cents,
      paidOn: onDate,
      source: "opening_balance",
      status: "approved",
      approvedAt: sql`now()`,
      notes: "Credit brought forward from the previous system",
    });
  }
}

function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The daily billing run for one agency (worker, D44, D46): apply escalations
 * that have fallen due, then raise any missing rent charges for live leases.
 * Safe to run more than once a day.
 */
export async function runDailyBilling(agencyId: string, today = todayInSouthAfrica()) {
  return withAgency({ agencyId }, async (tx) => {
    let escalated = 0;
    const due = await tx
      .select()
      .from(schema.leases)
      .where(
        and(
          inArray(schema.leases.status, ["active", "notice_given"]),
          lte(schema.leases.escalationDate, today),
          sql`${schema.leases.escalationBps} is not null`,
        ),
      )
      .for("update");
    for (let lease of due) {
      // Catching up after downtime: months before each escalation date are
      // raised at the old rent first, then the escalation applies.
      while (lease.escalationDate && lease.escalationDate <= today && lease.escalationBps !== null) {
        await raiseRentForLease(tx, lease, dayBefore(lease.escalationDate));
        lease = await escalateInTx(tx, lease);
        escalated++;
      }
    }
    const live = await tx.select().from(schema.leases).where(inArray(schema.leases.status, ["active", "notice_given"]));
    let raised = 0;
    for (const lease of live) raised += await raiseRentForLease(tx, lease, today);
    return { escalated, raised };
  });
}

