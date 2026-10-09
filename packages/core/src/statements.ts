import { createHash } from "node:crypto";
import { schema, withAgency } from "@awdrent/db";
import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { audit } from "./audit";
import { addMonths, daysInMonth, todayInSouthAfrica } from "./billing";
import { send } from "./messages";
import { messageMoney } from "./messaging/render";
import { renderOwnerStatement } from "./pdf/owner-statement";
import { type Actor, authorise, NotFoundError } from "./portfolio";
import { loadBrand, pdfDate, pdfMoney } from "./receipts";
import { carriedForward, firstMonthRent, rentCollectedThrough, statementLine } from "./statement-calc";
import { deleteObject, putGenerated } from "./storage";

// Owner statements (spec 5; D91–D96). Accounts prepare a month once it has
// ended; the draft can be prepared again as often as needed (late bank
// imports, corrections). Approving freezes it, files each owner's PDF and
// emails it. Payouts (step 2) are made from approved statements.

export class StatementError extends Error {}

const monthName = new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });
export const periodLabel = (period: string) => monthName.format(new Date(`${period}T00:00:00Z`));
const periodEnd = (period: string) => `${period.slice(0, 8)}${String(daysInMonth(period)).padStart(2, "0")}`;

/** Works out (or works out again) the draft statements for a month that has ended. */
export async function prepareRun(actor: Actor, period: string, today = todayInSouthAfrica()): Promise<string> {
  authorise(actor, "statements.manage");
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(period)) throw new StatementError("Choose a month.");
  const end = periodEnd(period);
  if (end >= today) throw new StatementError(`${periodLabel(period)} has not ended yet.`);
  return withAgency(actor.ctx, async (tx) => {
    const [existing] = await tx.select().from(schema.statementRuns).where(eq(schema.statementRuns.period, period)).for("update");
    if (existing?.status === "approved") throw new StatementError(`${periodLabel(period)} is already approved.`);
    const [later] = await tx
      .select({ period: schema.statementRuns.period })
      .from(schema.statementRuns)
      .where(and(eq(schema.statementRuns.status, "approved"), sql`${schema.statementRuns.period} > ${period}`))
      .limit(1);
    if (later) throw new StatementError(`${periodLabel(later.period)} is already approved; a statement cannot be prepared for an earlier month.`);
    if (existing) await tx.delete(schema.statementRuns).where(eq(schema.statementRuns.id, existing.id));

    const [agency] = await tx.select().from(schema.agencies);
    const vatRegistered = !!agency!.vatNumber;
    const leases = await tx
      .select({ lease: schema.leases, owner: schema.owners, unit: schema.units.label, property: schema.properties.name })
      .from(schema.leases)
      .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .innerJoin(schema.owners, eq(schema.owners.id, schema.properties.ownerId))
      .where(and(ne(schema.leases.status, "draft"), sql`${schema.leases.startDate} <= ${end}`));
    const leaseIds = leases.map((l) => l.lease.id);
    const charges = leaseIds.length ? await tx.select().from(schema.charges).where(inArray(schema.charges.leaseId, leaseIds)) : [];
    const payments = leaseIds.length ? await tx.select().from(schema.payments).where(inArray(schema.payments.leaseId, leaseIds)) : [];
    const tenants = leaseIds.length
      ? await tx
          .select({ leaseId: schema.leaseTenants.leaseId, name: schema.tenants.fullName })
          .from(schema.leaseTenants)
          .innerJoin(schema.tenants, eq(schema.tenants.id, schema.leaseTenants.tenantId))
          .where(and(inArray(schema.leaseTenants.leaseId, leaseIds), eq(schema.leaseTenants.isPrimary, true)))
      : [];
    // What approved statements have already paid out, per lease
    const prior = await tx
      .select({
        leaseId: schema.ownerStatementLines.leaseId,
        rent: sql<string>`sum(${schema.ownerStatementLines.rentCents})`,
        fee: sql<string>`sum(case when ${schema.ownerStatementLines.basis} = 'letting_fee' then ${schema.ownerStatementLines.commissionCents} else 0 end)`,
      })
      .from(schema.ownerStatementLines)
      .innerJoin(schema.ownerStatements, eq(schema.ownerStatements.id, schema.ownerStatementLines.statementId))
      .innerJoin(schema.statementRuns, eq(schema.statementRuns.id, schema.ownerStatements.runId))
      .where(eq(schema.statementRuns.status, "approved"))
      .groupBy(schema.ownerStatementLines.leaseId);
    const paidOut = new Map(prior.map((p) => [p.leaseId, { rent: Number(p.rent), fee: Number(p.fee) }]));

    const byOwner = new Map<string, { owner: (typeof leases)[number]["owner"]; lines: (ReturnType<typeof statementLine> & { leaseId: string; label: string })[] }>();
    for (const { lease, owner, unit, property } of leases) {
      const lc = charges.filter((c) => c.leaseId === lease.id);
      const lp = payments.filter((p) => p.leaseId === lease.id);
      const before = paidOut.get(lease.id) ?? { rent: 0, fee: 0 };
      const line = statementLine({
        model: owner.commissionModel,
        commissionBps: owner.commissionBps,
        lettingFee: lease.lettingFee,
        vatRegistered,
        rentToDate: rentCollectedThrough(lc, lp, end),
        rentPaidOut: before.rent,
        feeTaken: before.fee,
        firstMonthRent: firstMonthRent(lc, lease.rentCents),
      });
      const liveInMonth = (lease.status === "active" || lease.status === "notice_given") && (!lease.endDate || lease.endDate >= period);
      if (line.rentCents === 0 && line.commissionCents === 0 && !liveInMonth) continue;
      const tenant = tenants.find((t) => t.leaseId === lease.id)?.name;
      const entry = byOwner.get(owner.id) ?? { owner, lines: [] };
      entry.lines.push({ ...line, leaseId: lease.id, label: [`${unit}, ${property}`, lease.eftReference, tenant].filter(Boolean).join(" · ") });
      byOwner.set(owner.id, entry);
    }

    // Shortfalls carried from each owner's last approved statement
    const lastApproved = await tx
      .selectDistinctOn([schema.ownerStatements.ownerId], { ownerId: schema.ownerStatements.ownerId, payable: schema.ownerStatements.payableCents })
      .from(schema.ownerStatements)
      .innerJoin(schema.statementRuns, eq(schema.statementRuns.id, schema.ownerStatements.runId))
      .where(and(eq(schema.statementRuns.status, "approved"), lt(schema.ownerStatements.period, period)))
      .orderBy(schema.ownerStatements.ownerId, desc(schema.ownerStatements.period));
    const owners = await tx.select().from(schema.owners);
    for (const l of lastApproved) {
      if (carriedForward(l.payable) !== 0 && !byOwner.has(l.ownerId)) byOwner.set(l.ownerId, { owner: owners.find((o) => o.id === l.ownerId)!, lines: [] });
    }

    const [run] = await tx.insert(schema.statementRuns).values({ period }).returning();
    for (const [ownerId, { lines }] of byOwner) {
      const opening = carriedForward(lastApproved.find((l) => l.ownerId === ownerId)?.payable ?? 0);
      const rent = lines.reduce((s, l) => s + l.rentCents, 0);
      const commission = lines.reduce((s, l) => s + l.commissionCents, 0);
      const vat = lines.reduce((s, l) => s + l.vatCents, 0);
      const deductions = lines.reduce((s, l) => s + l.deductionCents, 0);
      const [statement] = await tx
        .insert(schema.ownerStatements)
        .values({ runId: run!.id, ownerId, period, openingCents: opening, rentCents: rent, commissionCents: commission, vatCents: vat, payableCents: opening + rent - deductions })
        .returning({ id: schema.ownerStatements.id });
      if (lines.length) {
        await tx.insert(schema.ownerStatementLines).values(
          lines.map((l) => ({
            statementId: statement!.id,
            leaseId: l.leaseId,
            label: l.label,
            rentCents: l.rentCents,
            commissionCents: l.commissionCents,
            vatCents: l.vatCents,
            basis: l.basis,
            commissionNote: l.note,
          })),
        );
      }
    }
    await audit(tx, { action: "statements.prepared", entity: "statement_run", entityId: run!.id, after: { period, owners: byOwner.size } });
    return run!.id;
  });
}

/** Freezes the month's statements; then files and emails each owner's PDF. */
export async function approveRun(actor: Actor, runId: string): Promise<{ issued: number }> {
  authorise(actor, "statements.manage");
  const agencyId = actor.ctx.agencyId;
  await withAgency(actor.ctx, async (tx) => {
    const [run] = await tx.select().from(schema.statementRuns).where(eq(schema.statementRuns.id, runId)).for("update");
    if (!run) throw new NotFoundError("Statement run");
    if (run.status === "approved") throw new StatementError("These statements are already approved.");
    const [later] = await tx
      .select({ id: schema.statementRuns.id })
      .from(schema.statementRuns)
      .where(and(eq(schema.statementRuns.status, "approved"), sql`${schema.statementRuns.period} > ${run.period}`))
      .limit(1);
    if (later) throw new StatementError("A later month is already approved.");
    await tx.update(schema.statementRuns).set({ status: "approved", approvedAt: sql`now()`, approvedBy: actor.userId }).where(eq(schema.statementRuns.id, run.id));
    const [totals] = await tx
      .select({ owners: sql<number>`count(*)::int`, payable: sql<string>`coalesce(sum(greatest(${schema.ownerStatements.payableCents}, 0)), 0)` })
      .from(schema.ownerStatements)
      .where(eq(schema.ownerStatements.runId, run.id));
    await audit(tx, { action: "statements.approved", entity: "statement_run", entityId: run.id, after: { period: run.period, owners: totals!.owners, payableCents: Number(totals!.payable) } });
  });
  return issueStatements({ agencyId, userId: actor.userId }, runId);
}

/** Files and emails the PDF of every approved statement that does not have one yet. Safe to repeat. */
export async function issueStatements(ctx: { agencyId: string; userId: string | null }, runId: string): Promise<{ issued: number }> {
  const pending = await withAgency({ agencyId: ctx.agencyId, readOnly: true }, (tx) =>
    tx
      .select({ statement: schema.ownerStatements, owner: schema.owners, run: schema.statementRuns })
      .from(schema.ownerStatements)
      .innerJoin(schema.owners, eq(schema.owners.id, schema.ownerStatements.ownerId))
      .innerJoin(schema.statementRuns, eq(schema.statementRuns.id, schema.ownerStatements.runId))
      .where(and(eq(schema.ownerStatements.runId, runId), eq(schema.statementRuns.status, "approved"), sql`${schema.ownerStatements.documentId} is null`)),
  );
  if (pending.length === 0) return { issued: 0 };
  const brand = await loadBrand(ctx.agencyId);
  let issued = 0;
  for (const { statement, owner } of pending) {
    const bytes = new Uint8Array(await renderStatementPdf(ctx.agencyId, brand, statement.id));
    const key = await putGenerated(ctx.agencyId, bytes, "application/pdf", "pdf");
    try {
      await withAgency({ agencyId: ctx.agencyId, userId: ctx.userId }, async (tx) => {
        const [doc] = await tx
          .insert(schema.documents)
          .values({
            ownerId: owner.id,
            kind: "owner_statement",
            filename: `Owner statement ${periodLabel(statement.period)}.pdf`,
            contentType: "application/pdf",
            sizeBytes: bytes.byteLength,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            fileKey: key,
            status: "clean",
            scanResult: "generated",
            scannedAt: sql`now()`,
          })
          .returning({ id: schema.documents.id });
        await tx.update(schema.ownerStatements).set({ documentId: doc!.id }).where(eq(schema.ownerStatements.id, statement.id));
        await send(tx, {
          recipient: { kind: "owner", ownerId: owner.id },
          templateKey: "owner_statement",
          attachmentDocumentId: doc!.id,
          variables: {
            month: periodLabel(statement.period),
            payable: statement.payableCents < 0 ? `0,00 (a shortfall of R${messageMoney(-statement.payableCents)} is carried forward)` : messageMoney(statement.payableCents),
          },
        });
      });
      issued++;
    } catch (err) {
      await deleteObject(key).catch(() => undefined);
      throw err;
    }
  }
  return { issued };
}

async function renderStatementPdf(agencyId: string, brand: Awaited<ReturnType<typeof loadBrand>>, statementId: string): Promise<Buffer> {
  const { statement, owner, lines } = await withAgency({ agencyId, readOnly: true }, async (tx) => {
    const [row] = await tx
      .select({ statement: schema.ownerStatements, owner: schema.owners })
      .from(schema.ownerStatements)
      .innerJoin(schema.owners, eq(schema.owners.id, schema.ownerStatements.ownerId))
      .where(eq(schema.ownerStatements.id, statementId));
    const lines = await tx.select().from(schema.ownerStatementLines).where(eq(schema.ownerStatementLines.statementId, statementId)).orderBy(asc(schema.ownerStatementLines.label));
    return { ...row!, lines };
  });
  const vatIncluded = lines.some((l) => l.basis === "letting_fee" && l.vatCents !== 0) && !lines.some((l) => l.basis === "percent" && l.vatCents !== 0);
  return renderOwnerStatement(brand, {
    ownerName: owner.name,
    period: periodLabel(statement.period),
    issuedOn: pdfDate(todayInSouthAfrica()),
    lines: lines.map((l) => ({ label: l.label, rent: pdfMoney(l.rentCents), commission: pdfMoney(l.commissionCents), vat: pdfMoney(l.vatCents), note: l.commissionNote })),
    opening: statement.openingCents ? pdfMoney(statement.openingCents) : null,
    rent: pdfMoney(statement.rentCents),
    commission: pdfMoney(statement.commissionCents),
    vat: pdfMoney(statement.vatCents),
    vatIncluded,
    payable: pdfMoney(Math.abs(statement.payableCents)),
    shortfall: statement.payableCents < 0,
  });
}

/** A draft statement as a PDF, to check before approving. */
export async function previewStatementPdf(actor: Actor, statementId: string): Promise<Uint8Array> {
  authorise(actor, "statements.manage");
  const [exists] = await withAgency({ ...actor.ctx, readOnly: true }, (tx) =>
    tx.select({ id: schema.ownerStatements.id }).from(schema.ownerStatements).where(eq(schema.ownerStatements.id, statementId)),
  );
  if (!exists) throw new NotFoundError("Statement");
  return new Uint8Array(await renderStatementPdf(actor.ctx.agencyId, await loadBrand(actor.ctx.agencyId), statementId));
}

export async function listRuns(actor: Actor) {
  authorise(actor, "statements.manage");
  return withAgency({ ...actor.ctx, readOnly: true }, (tx) =>
    tx
      .select({
        run: schema.statementRuns,
        owners: sql<number>`(select count(*)::int from owner_statements s where s.run_id = "statement_runs"."id")`,
        payable: sql<string>`(select coalesce(sum(greatest(s.payable_cents, 0)), 0) from owner_statements s where s.run_id = "statement_runs"."id")`,
        unissued: sql<number>`(select count(*)::int from owner_statements s where s.run_id = "statement_runs"."id" and s.document_id is null)`,
      })
      .from(schema.statementRuns)
      .orderBy(desc(schema.statementRuns.period)),
  );
}

export async function getRun(actor: Actor, runId: string) {
  authorise(actor, "statements.manage");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const [run] = await tx.select().from(schema.statementRuns).where(eq(schema.statementRuns.id, runId));
    if (!run) throw new NotFoundError("Statement run");
    const statements = await tx
      .select({ statement: schema.ownerStatements, ownerName: schema.owners.name, ownerEmail: schema.owners.email })
      .from(schema.ownerStatements)
      .innerJoin(schema.owners, eq(schema.owners.id, schema.ownerStatements.ownerId))
      .where(eq(schema.ownerStatements.runId, run.id))
      .orderBy(asc(schema.owners.name));
    const lines = statements.length
      ? await tx
          .select()
          .from(schema.ownerStatementLines)
          .where(inArray(schema.ownerStatementLines.statementId, statements.map((s) => s.statement.id)))
          .orderBy(asc(schema.ownerStatementLines.label))
      : [];
    return { run, statements: statements.map((s) => ({ ...s, lines: lines.filter((l) => l.statementId === s.statement.id) })) };
  });
}

/** The month to prepare next: the last month that has ended. */
export function lastEndedMonth(today = todayInSouthAfrica()): string {
  return addMonths(`${today.slice(0, 8)}01`, -1);
}

/** An owner's approved statements, newest first (owner page). */
export async function ownerStatementHistory(actor: Actor, ownerId: string) {
  authorise(actor, "statements.manage");
  return withAgency({ ...actor.ctx, readOnly: true }, (tx) =>
    tx
      .select({ statement: schema.ownerStatements })
      .from(schema.ownerStatements)
      .innerJoin(schema.statementRuns, eq(schema.statementRuns.id, schema.ownerStatements.runId))
      .where(and(eq(schema.ownerStatements.ownerId, ownerId), eq(schema.statementRuns.status, "approved")))
      .orderBy(desc(schema.ownerStatements.period)),
  );
}

/**
 * Whether the agency takes this lease's first month's rent (D92). Off for an
 * existing tenancy entered by hand; cannot change once the fee has been
 * taken on an approved statement.
 */
export async function setLettingFee(actor: Actor, leaseId: string, applies: boolean): Promise<void> {
  authorise(actor, "statements.manage");
  await withAgency(actor.ctx, async (tx) => {
    const [lease] = await tx.select({ id: schema.leases.id, lettingFee: schema.leases.lettingFee }).from(schema.leases).where(eq(schema.leases.id, leaseId)).for("update");
    if (!lease) throw new NotFoundError("Lease");
    if (lease.lettingFee === applies) return;
    const [taken] = await tx
      .select({ id: schema.ownerStatementLines.id })
      .from(schema.ownerStatementLines)
      .innerJoin(schema.ownerStatements, eq(schema.ownerStatements.id, schema.ownerStatementLines.statementId))
      .innerJoin(schema.statementRuns, eq(schema.statementRuns.id, schema.ownerStatements.runId))
      .where(
        and(
          eq(schema.ownerStatementLines.leaseId, leaseId),
          eq(schema.statementRuns.status, "approved"),
          eq(schema.ownerStatementLines.basis, "letting_fee"),
          ne(schema.ownerStatementLines.commissionCents, 0),
        ),
      )
      .limit(1);
    if (taken) throw new StatementError("The letting fee has already been taken on an approved statement.");
    await tx.update(schema.leases).set({ lettingFee: applies }).where(eq(schema.leases.id, leaseId));
    await audit(tx, { action: "lease.letting_fee_changed", entity: "lease", entityId: leaseId, before: { lettingFee: lease.lettingFee }, after: { lettingFee: applies } });
  });
}
