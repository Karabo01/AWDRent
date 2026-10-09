import { schema, type Tx, withAgency } from "@awdrent/db";
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { audit } from "./audit";
import { addMonths, daysInMonth, monthStart, todayInSouthAfrica } from "./billing";
import { csvRands, toCsv } from "./csv";
import { allocate } from "./ledger";
import { type Actor, authorise, leaseScope } from "./portfolio";

// Reports and exports (spec 7; D114–D117). Everything is worked out from the
// ledger as it stands (D43), so the figures always agree with statements.
// Agents see their portfolio; exports are for admins and accounts.

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const AGEING_BUCKETS = ["current", "d30", "d60", "d90"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];
export const AGEING_LABEL: Record<AgeingBucket, string> = { current: "1–30 days", d30: "31–60 days", d60: "61–90 days", d90: "Over 90 days" };

/** Which bucket an amount overdue by this many days falls in (D114). */
export function ageingBucket(daysOverdue: number): AgeingBucket {
  if (daysOverdue <= 30) return "current";
  if (daysOverdue <= 60) return "d30";
  if (daysOverdue <= 90) return "d60";
  return "d90";
}

async function leasesInScope(tx: Tx, actor: Actor, statuses: ("active" | "notice_given" | "ended" | "terminated")[]) {
  return tx
    .select({ lease: schema.leases, unit: schema.units.label, property: schema.properties.name })
    .from(schema.leases)
    .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
    .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
    .where(and(inArray(schema.leases.status, statuses), leaseScope(actor)));
}

async function primaryTenants(tx: Tx, leaseIds: string[]) {
  if (leaseIds.length === 0) return new Map<string, string>();
  const rows = await tx
    .select({ leaseId: schema.leaseTenants.leaseId, name: schema.tenants.fullName })
    .from(schema.leaseTenants)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.leaseTenants.tenantId))
    .where(and(inArray(schema.leaseTenants.leaseId, leaseIds), eq(schema.leaseTenants.isPrimary, true)));
  return new Map(rows.map((r) => [r.leaseId, r.name]));
}

/**
 * Arrears ageing: what is overdue on each lease (past due date, unpaid after
 * oldest-first allocation), by how long. Ended leases with arrears are included.
 */
export async function arrearsAgeing(actor: Actor, today = todayInSouthAfrica()) {
  authorise(actor, "reports.view");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const leases = await leasesInScope(tx, actor, ["active", "notice_given", "ended", "terminated"]);
    const ids = leases.map((l) => l.lease.id);
    const charges = ids.length ? await tx.select().from(schema.charges).where(inArray(schema.charges.leaseId, ids)) : [];
    const payments = ids.length
      ? await tx.select().from(schema.payments).where(and(inArray(schema.payments.leaseId, ids), eq(schema.payments.status, "approved")))
      : [];
    const tenants = await primaryTenants(tx, ids);
    const rows = [];
    for (const { lease, unit, property } of leases) {
      const paid = payments.filter((p) => p.leaseId === lease.id).reduce((s, p) => s + p.amountCents, 0);
      const alloc = allocate(
        charges.filter((c) => c.leaseId === lease.id),
        paid,
      );
      const buckets: Record<AgeingBucket, number> = { current: 0, d30: 0, d60: 0, d90: 0 };
      for (const c of alloc.charges) {
        if (c.outstandingCents > 0 && c.dueDate < today) buckets[ageingBucket(daysBetween(c.dueDate, today))] += c.outstandingCents;
      }
      const total = Object.values(buckets).reduce((s, v) => s + v, 0);
      if (total > 0) {
        rows.push({ leaseId: lease.id, eftReference: lease.eftReference, status: lease.status, tenant: tenants.get(lease.id) ?? "", unit: `${unit}, ${property}`, buckets, total });
      }
    }
    rows.sort((x, y) => y.total - x.total);
    const totals: Record<AgeingBucket, number> = { current: 0, d30: 0, d60: 0, d90: 0 };
    for (const r of rows) for (const b of AGEING_BUCKETS) totals[b] += r.buckets[b];
    return { rows, totals, total: rows.reduce((s, r) => s + r.total, 0) };
  });
}

/** Units by status, and the vacant ones. */
export async function occupancy(actor: Actor) {
  authorise(actor, "reports.view");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const units = await tx
      .select({ id: schema.units.id, label: schema.units.label, status: schema.units.status, property: schema.properties.name })
      .from(schema.units)
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .where(
        and(
          isNull(schema.units.archivedAt),
          isNull(schema.properties.archivedAt),
          actor.role === "agent"
            ? inArray(
                schema.units.propertyId,
                tx.select({ id: schema.agentPortfolios.propertyId }).from(schema.agentPortfolios).where(eq(schema.agentPortfolios.userId, actor.userId ?? "00000000-0000-0000-0000-000000000000")),
              )
            : undefined,
        ),
      )
      .orderBy(asc(schema.properties.name), asc(schema.units.label));
    const counts: Record<string, number> = {};
    for (const u of units) counts[u.status] = (counts[u.status] ?? 0) + 1;
    const occupied = (counts.occupied ?? 0) + (counts.notice_given ?? 0);
    return {
      total: units.length,
      counts,
      occupancyPercent: units.length ? Math.round((occupied / units.length) * 1000) / 10 : 0,
      vacant: units.filter((u) => u.status === "vacant").map((u) => `${u.label}, ${u.property}`),
    };
  });
}

/** Fixed-term leases ending in the next 90 days, soonest first. */
export async function expiringLeases(actor: Actor, today = todayInSouthAfrica()) {
  authorise(actor, "reports.view");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const until = new Date(Date.parse(`${today}T00:00:00Z`) + 90 * 86_400_000).toISOString().slice(0, 10);
    const rows = await tx
      .select({ lease: schema.leases, unit: schema.units.label, property: schema.properties.name })
      .from(schema.leases)
      .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .where(and(inArray(schema.leases.status, ["active", "notice_given"]), gte(schema.leases.endDate, today), lte(schema.leases.endDate, until), leaseScope(actor)))
      .orderBy(asc(schema.leases.endDate));
    const tenants = await primaryTenants(tx, rows.map((r) => r.lease.id));
    return rows.map(({ lease, unit, property }) => {
      const days = daysBetween(today, lease.endDate!);
      return {
        leaseId: lease.id,
        eftReference: lease.eftReference,
        tenant: tenants.get(lease.id) ?? "",
        unit: `${unit}, ${property}`,
        endDate: lease.endDate!,
        days,
        within: days <= 30 ? 30 : days <= 60 ? 60 : 90,
        noticeGiven: lease.status === "notice_given",
      };
    });
  });
}

/**
 * This month's collections against what was due (D115): charges due in the
 * month, and money received in the month (bank, proofs of payment, manual;
 * not opening balances or deposits applied).
 */
export async function collections(actor: Actor, month = monthStart(todayInSouthAfrica())) {
  authorise(actor, "reports.view");
  const end = `${month.slice(0, 8)}${String(daysInMonth(month)).padStart(2, "0")}`;
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const scope = leaseScope(actor);
    const inScope = scope ? tx.select({ id: schema.leases.id }).from(schema.leases).where(scope) : undefined;
    const [due] = await tx
      .select({ cents: sql<string>`coalesce(sum(${schema.charges.amountCents}), 0)` })
      .from(schema.charges)
      .where(and(isNull(schema.charges.voidedAt), gte(schema.charges.dueDate, month), lte(schema.charges.dueDate, end), inScope ? inArray(schema.charges.leaseId, inScope) : undefined));
    const [received] = await tx
      .select({ cents: sql<string>`coalesce(sum(${schema.payments.amountCents}), 0)` })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.status, "approved"),
          inArray(schema.payments.source, ["bank_import", "pop", "manual"]),
          gte(schema.payments.paidOn, month),
          lte(schema.payments.paidOn, end),
          inScope ? inArray(schema.payments.leaseId, inScope) : undefined,
        ),
      );
    const dueCents = Number(due!.cents);
    const receivedCents = Number(received!.cents);
    return { month, dueCents, receivedCents, percent: dueCents ? Math.round((receivedCents / dueCents) * 1000) / 10 : null, previous: addMonths(month, -1) };
  });
}

// ─── CSV exports (D116) ────────────────────────────────────────────────

export class ExportError extends Error {}

export type ExportKind = "transactions" | "receipts" | "owner-statements" | "arrears";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A CSV for the accounting package. Admins and accounts; every export is audited. */
export async function exportCsv(actor: Actor, kind: ExportKind, range: { from: string; to: string }): Promise<{ csv: string; filename: string }> {
  authorise(actor, "exports.run");
  if (!DATE_RE.test(range.from) || !DATE_RE.test(range.to) || range.from > range.to) throw new ExportError("Choose a date range.");
  if (daysBetween(range.from, range.to) > 400) throw new ExportError("Choose at most a year at a time.");
  const result = await withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const [agency] = await tx.select({ prefix: schema.agencies.eftPrefix }).from(schema.agencies);
    const name = (what: string) => `${agency!.prefix} ${what} ${range.from} to ${range.to}.csv`;
    if (kind === "transactions") {
      const leases = await tx.select({ id: schema.leases.id, ref: schema.leases.eftReference }).from(schema.leases).where(ne(schema.leases.status, "draft"));
      const refs = new Map(leases.map((l) => [l.id, l.ref]));
      const tenants = await primaryTenants(tx, leases.map((l) => l.id));
      const charges = await tx
        .select()
        .from(schema.charges)
        .where(and(gte(schema.charges.dueDate, range.from), lte(schema.charges.dueDate, range.to)));
      const payments = await tx
        .select()
        .from(schema.payments)
        .where(and(gte(schema.payments.paidOn, range.from), lte(schema.payments.paidOn, range.to)));
      const rows = [
        ...charges.map((c) => [c.dueDate, "charge", c.type, refs.get(c.leaseId) ?? "", tenants.get(c.leaseId) ?? "", c.description, csvRands(c.amountCents), "", c.voidedAt ? "voided" : "live"]),
        ...payments.map((p) => [p.paidOn, "payment", p.source, refs.get(p.leaseId) ?? "", tenants.get(p.leaseId) ?? "", p.reference ?? "", "", csvRands(p.amountCents), p.status]),
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0])));
      return {
        csv: toCsv(["Date", "Kind", "Type", "Lease reference", "Tenant", "Description or reference", "Debit", "Credit", "Status"], rows),
        filename: name("transactions"),
        rows: rows.length,
      };
    }
    if (kind === "receipts") {
      const rows = await tx
        .select({ receipt: schema.receipts, ref: schema.leases.eftReference, paidOn: schema.payments.paidOn })
        .from(schema.receipts)
        .innerJoin(schema.leases, eq(schema.leases.id, schema.receipts.leaseId))
        .innerJoin(schema.payments, eq(schema.payments.id, schema.receipts.paymentId))
        .where(and(gte(schema.payments.paidOn, range.from), lte(schema.payments.paidOn, range.to)))
        .orderBy(asc(schema.receipts.receiptNumber));
      const tenants = await primaryTenants(tx, rows.map((r) => r.receipt.leaseId));
      return {
        csv: toCsv(
          ["Receipt number", "Date paid", "Lease reference", "Tenant", "Amount", "Cancelled", "Cancel reason"],
          rows.map((r) => [r.receipt.receiptNumber, r.paidOn, r.ref, tenants.get(r.receipt.leaseId) ?? "", csvRands(r.receipt.amountCents), r.receipt.cancelledAt ? "yes" : "no", r.receipt.cancelReason ?? ""]),
        ),
        filename: name("receipts"),
        rows: rows.length,
      };
    }
    if (kind === "owner-statements") {
      const rows = await tx
        .select({ line: schema.ownerStatementLines, period: schema.ownerStatements.period, owner: schema.owners.name })
        .from(schema.ownerStatementLines)
        .innerJoin(schema.ownerStatements, eq(schema.ownerStatements.id, schema.ownerStatementLines.statementId))
        .innerJoin(schema.statementRuns, eq(schema.statementRuns.id, schema.ownerStatements.runId))
        .innerJoin(schema.owners, eq(schema.owners.id, schema.ownerStatements.ownerId))
        .where(and(eq(schema.statementRuns.status, "approved"), gte(schema.ownerStatements.period, monthStart(range.from)), lte(schema.ownerStatements.period, range.to)))
        .orderBy(asc(schema.ownerStatements.period), asc(schema.owners.name));
      return {
        csv: toCsv(
          ["Month", "Owner", "Lease", "Rent collected", "Commission", "VAT", "Basis"],
          rows.map((r) => [r.period.slice(0, 7), r.owner, r.line.label, csvRands(r.line.rentCents), csvRands(r.line.commissionCents), csvRands(r.line.vatCents), r.line.basis]),
        ),
        filename: name("owner statements"),
        rows: rows.length,
      };
    }
    return null;
  });
  let out = result;
  if (!out) {
    // Arrears as at the end of the range
    const ageing = await arrearsAgeing(actor, range.to);
    out = {
      csv: toCsv(
        ["Lease reference", "Tenant", "Unit", "Status", ...AGEING_BUCKETS.map((b) => AGEING_LABEL[b]), "Total overdue"],
        ageing.rows.map((r) => [r.eftReference, r.tenant, r.unit, r.status, ...AGEING_BUCKETS.map((b) => csvRands(r.buckets[b])), csvRands(r.total)]),
      ),
      filename: `Arrears ageing at ${range.to}.csv`,
      rows: ageing.rows.length,
    };
  }
  await withAgency(actor.ctx, (tx) => audit(tx, { action: "export.downloaded", entity: "export", after: { kind, ...range, rows: out!.rows } }));
  return { csv: out.csv, filename: out.filename };
}
