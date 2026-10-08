import { schema, withAgency } from "@awdrent/db";
import { and, desc, eq, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import { allocateLineInTx, lockLine } from "./banking";
import { uploadDocument } from "./documents";
import { LedgerRuleError } from "./ledger";
import { leaseContact, primaryTenantId, send } from "./messages";
import { messageMoney } from "./messaging/render";
import { parseRandToCents } from "./money";
import { type Actor, assertLeaseInScope, authorise, leaseScope, NotFoundError } from "./portfolio";

// Proofs of payment (spec; D33). Approving a POP means linking it to the
// trust-account bank line that shows the money arrived: an unmatched line is
// allocated to the POP's lease then and there, a line already matched to that
// lease is simply linked. If the bank shows less than claimed, the POP is
// "partial". A POP never changes a balance on its own.

export const popClaimSchema = z.object({
  amount: z.string().transform((s, ctx) => {
    const cents = parseRandToCents(s);
    if (cents === null || cents === 0 || cents > 1_000_000_000) {
      ctx.addIssue({ code: "custom", message: "Enter the amount paid, in rand" });
      return z.NEVER;
    }
    return cents;
  }),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date paid"),
  reference: z
    .string()
    .trim()
    .max(80)
    .transform((s) => s || null),
});
export type PopClaim = z.infer<typeof popClaimSchema>;

/** Uploads the file (virus-scanned like any document) and queues the POP for review. */
export async function submitPop(
  actor: Actor,
  input: { leaseId: string; tenantId?: string | null; filename: string; bytes: Uint8Array; claim: PopClaim; via: "staff" | "portal" | "email" | "whatsapp" },
): Promise<{ popId: string; documentId: string }> {
  authorise(actor, "pop.submit");
  const documentId = await uploadDocument(
    actor,
    { subject: { type: "lease", id: input.leaseId }, kind: "proof_of_payment", filename: input.filename, bytes: input.bytes },
    "pop.submit",
  );
  return withAgency(actor.ctx, async (tx) => {
    await assertLeaseInScope(tx, actor, input.leaseId);
    const [pop] = await tx
      .insert(schema.proofsOfPayment)
      .values({
        leaseId: input.leaseId,
        tenantId: input.tenantId ?? null,
        documentId,
        claimedCents: input.claim.amount,
        claimedPaidOn: input.claim.paidOn,
        referenceGiven: input.claim.reference,
        submittedVia: input.via,
      })
      .returning();
    await audit(tx, { action: "pop.submitted", entity: "lease", entityId: input.leaseId, after: { popId: pop!.id, ...input.claim, via: input.via } });
    const tenantId = input.tenantId ?? (await primaryTenantId(tx, input.leaseId));
    if (tenantId) {
      await send(tx, {
        recipient: { kind: "tenant", tenantId },
        templateKey: "pop_received",
        leaseId: input.leaseId,
        variables: { amount: messageMoney(input.claim.amount) },
      });
    }
    return { popId: pop!.id, documentId };
  });
}

export async function listPops(actor: Actor, opts: { status?: "pending" | "approved" | "partial" | "rejected"; leaseId?: string } = {}) {
  authorise(actor, "ledger.view");
  return withAgency({ ...actor.ctx, readOnly: true }, (tx) =>
    tx
      .select({
        pop: schema.proofsOfPayment,
        eftReference: schema.leases.eftReference,
        documentStatus: schema.documents.status,
        filename: schema.documents.filename,
        tenantName: sql<string | null>`(select t.full_name from ${schema.leaseTenants} lt join ${schema.tenants} t on t.id = lt.tenant_id
          where lt.lease_id = "leases"."id" and lt.is_primary)`,
      })
      .from(schema.proofsOfPayment)
      .innerJoin(schema.leases, eq(schema.leases.id, schema.proofsOfPayment.leaseId))
      .innerJoin(schema.documents, eq(schema.documents.id, schema.proofsOfPayment.documentId))
      .where(
        and(
          leaseScope(actor),
          opts.status ? eq(schema.proofsOfPayment.status, opts.status) : undefined,
          opts.leaseId ? eq(schema.proofsOfPayment.leaseId, opts.leaseId) : undefined,
        ),
      )
      .orderBy(desc(schema.proofsOfPayment.createdAt))
      .limit(200),
  );
}

export interface CandidateLine {
  id: string;
  lineDate: string;
  amountCents: number;
  reference: string;
  status: "unmatched" | "matched";
  score: number;
  reasons: string[];
}

const daysBetween = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Bank lines that could prove this POP, best first: waiting lines, or lines
 * already matched to the same lease, not yet proving another POP. Scored by
 * amount, reference and date.
 */
export async function candidateLines(actor: Actor, popId: string): Promise<CandidateLine[]> {
  authorise(actor, "payments.approve");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const [pop] = await tx
      .select({ pop: schema.proofsOfPayment, eft: schema.leases.eftReference })
      .from(schema.proofsOfPayment)
      .innerJoin(schema.leases, eq(schema.leases.id, schema.proofsOfPayment.leaseId))
      .where(eq(schema.proofsOfPayment.id, popId));
    if (!pop) throw new NotFoundError("Proof of payment");
    const used = tx
      .select({ id: schema.proofsOfPayment.bankLineId })
      .from(schema.proofsOfPayment)
      .where(sql`${schema.proofsOfPayment.bankLineId} is not null`);
    const lines = await tx
      .select()
      .from(schema.bankLines)
      .where(
        and(
          or(eq(schema.bankLines.status, "unmatched"), and(eq(schema.bankLines.status, "matched"), eq(schema.bankLines.matchedLeaseId, pop.pop.leaseId))),
          notInArray(schema.bankLines.id, used),
          sql`${schema.bankLines.lineDate} between ${pop.pop.claimedPaidOn}::date - 45 and ${pop.pop.claimedPaidOn}::date + 45`,
        ),
      )
      .limit(500);
    const eftCompact = pop.eft.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    return lines
      .map((l) => {
        const reasons: string[] = [];
        let score = 0;
        if (l.amountCents === pop.pop.claimedCents) {
          score += 3;
          reasons.push("same amount");
        }
        if (`${l.reference} ${l.description ?? ""}`.replace(/[^A-Z0-9]/gi, "").toUpperCase().includes(eftCompact)) {
          score += 3;
          reasons.push("EFT reference");
        }
        if (l.status === "matched") {
          score += 2;
          reasons.push("already paid to this lease");
        }
        const days = daysBetween(l.lineDate, pop.pop.claimedPaidOn);
        if (days <= 3) {
          score += 2;
          reasons.push("same week");
        } else if (days <= 10) score += 1;
        return { id: l.id, lineDate: l.lineDate, amountCents: l.amountCents, reference: l.reference, status: l.status as "unmatched" | "matched", score, reasons };
      })
      .filter((c) => c.score >= 3)
      .sort((a, b) => b.score - a.score || daysBetween(a.lineDate, pop.pop.claimedPaidOn) - daysBetween(b.lineDate, pop.pop.claimedPaidOn))
      .slice(0, 10);
  });
}

/** Approves a POP by linking it to the bank line that shows the money (D33). */
export async function approvePop(actor: Actor, popId: string, bankLineId: string): Promise<"approved" | "partial"> {
  authorise(actor, "payments.approve");
  return withAgency(actor.ctx, async (tx) => {
    const [pop] = await tx.select().from(schema.proofsOfPayment).where(eq(schema.proofsOfPayment.id, popId)).for("update");
    if (!pop) throw new NotFoundError("Proof of payment");
    if (pop.status !== "pending") throw new LedgerRuleError("This proof of payment has already been reviewed.");
    const line = await lockLine(tx, bankLineId);
    if (line.status === "ignored") throw new LedgerRuleError("That bank line was ignored; undo that first.");
    if (line.status === "matched" && line.matchedLeaseId !== pop.leaseId) throw new LedgerRuleError("That bank line already paid another lease.");
    const [other] = await tx.select({ id: schema.proofsOfPayment.id }).from(schema.proofsOfPayment).where(eq(schema.proofsOfPayment.bankLineId, bankLineId));
    if (other) throw new LedgerRuleError("That bank line already proves another payment.");
    if (line.status === "unmatched") await allocateLineInTx(tx, actor, line, pop.leaseId, "rent");
    const status = line.amountCents >= pop.claimedCents ? "approved" : "partial";
    await tx
      .update(schema.proofsOfPayment)
      .set({ status, bankLineId, approvedCents: line.amountCents, reviewedAt: sql`now()`, reviewedBy: actor.userId })
      .where(eq(schema.proofsOfPayment.id, popId));
    await audit(tx, {
      action: `pop.${status}`,
      entity: "lease",
      entityId: pop.leaseId,
      after: { popId, bankLineId, claimedCents: pop.claimedCents, approvedCents: line.amountCents },
    });
    return status;
  });
}

export async function rejectPop(actor: Actor, popId: string, reason: string): Promise<void> {
  authorise(actor, "payments.approve");
  await withAgency(actor.ctx, async (tx) => {
    const [pop] = await tx.select().from(schema.proofsOfPayment).where(eq(schema.proofsOfPayment.id, popId)).for("update");
    if (!pop) throw new NotFoundError("Proof of payment");
    if (pop.status !== "pending") throw new LedgerRuleError("This proof of payment has already been reviewed.");
    await tx
      .update(schema.proofsOfPayment)
      .set({ status: "rejected", rejectReason: reason, reviewedAt: sql`now()`, reviewedBy: actor.userId })
      .where(eq(schema.proofsOfPayment.id, popId));
    await audit(tx, { action: "pop.rejected", entity: "lease", entityId: pop.leaseId, after: { popId, reason } });
    const tenantId = pop.tenantId ?? (await primaryTenantId(tx, pop.leaseId));
    if (tenantId) {
      await send(tx, {
        recipient: { kind: "tenant", tenantId },
        templateKey: "pop_rejected",
        leaseId: pop.leaseId,
        variables: { amount: messageMoney(pop.claimedCents), reason, ...(await leaseContact(tx, pop.leaseId)) },
      });
    }
  });
}

