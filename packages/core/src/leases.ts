import { schema, type Tx, withAgency } from "@awdrent/db";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { audit, changes } from "./audit";
import { nextEftReference } from "./eft";
import { parsePercentToBps, parseRandToCents } from "./money";
import {
  type Actor,
  assertLeaseInScope,
  assertTenantInScope,
  assertUnitInScope,
  authorise,
  leaseScope,
  NotFoundError,
  tenantScope,
  unitScope,
} from "./portfolio";

// Lease lifecycle: draft → active → notice_given → ended | terminated.
// One row per agreement; renewals and changes update it and append a
// lease_event with before/after, so the EFT reference and the Phase 2
// balance carry across terms (D3, D17).

export class LeaseRuleError extends Error {}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Choose a valid date");
const optionalDate = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s === "" || isoDate.safeParse(s).success, "Choose a valid date")
  .transform((s) => s || null);
/** R10 million: far above any rent or deposit, well inside a 32-bit cents column. */
const MAX_CENTS = 1_000_000_000;

const rand = (label: string) =>
  z.string().transform((s, ctx) => {
    const cents = parseRandToCents(s);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: `Enter the ${label} in rand, e.g. 7500 or 7500.50` });
      return z.NEVER;
    }
    if (cents > MAX_CENTS) {
      ctx.addIssue({ code: "custom", message: "That is more than R10 million" });
      return z.NEVER;
    }
    return cents;
  });
const optionalPercent = z.string().transform((s, ctx) => {
  if (s.trim() === "") return null;
  const bps = parsePercentToBps(s);
  if (bps === null) {
    ctx.addIssue({ code: "custom", message: "Enter a percentage like 8 or 7.5" });
    return z.NEVER;
  }
  return bps;
});
const int = (min: number, max: number, msg: string) =>
  z.coerce
    .number()
    .int(msg)
    .min(min, msg)
    .max(max, msg);

/** Terms shared by creating and amending a lease. */
const termsShape = {
  startDate: isoDate,
  endDate: optionalDate,
  rent: rand("rent").refine((c) => c > 0, "Rent must be more than R0"),
  dueDay: int(1, 31, "A day from 1 to 31"),
  deposit: rand("deposit"),
  escalationPercent: optionalPercent,
  escalationDate: optionalDate,
  noticeDays: int(0, 365, "Between 0 and 365 days"),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => s || null),
};

function termsRules(v: { startDate: string; endDate: string | null; escalationPercent: number | null; escalationDate: string | null }, ctx: z.RefinementCtx) {
  if (v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Must be after the start date" });
  if ((v.escalationPercent === null) !== (v.escalationDate === null)) {
    ctx.addIssue({ code: "custom", path: ["escalationDate"], message: "Give both the escalation % and its date, or neither" });
  }
}

export const leaseCreateSchema = z
  .object({
    unitId: z.uuid("Choose a unit"),
    primaryTenantId: z.uuid("Choose the main tenant"),
    coTenantIds: z.array(z.uuid()).default([]),
    ...termsShape,
  })
  .superRefine(termsRules);
export type LeaseCreateInput = z.infer<typeof leaseCreateSchema>;

export const leaseAmendSchema = z
  .object({ ...termsShape, effectiveDate: isoDate, reason: z.string().trim().min(3, "Say what changed and why").max(500) })
  .superRefine(termsRules);
export type LeaseAmendInput = z.infer<typeof leaseAmendSchema>;

export const leaseRenewSchema = z.object({
  newEndDate: optionalDate,
  newRent: rand("new rent").refine((c) => c > 0, "Rent must be more than R0"),
  escalationPercent: optionalPercent,
  escalationDate: optionalDate,
  effectiveDate: isoDate,
});
export type LeaseRenewInput = z.infer<typeof leaseRenewSchema>;

export const leaseNoticeSchema = z.object({ noticeDate: isoDate, endDate: isoDate, note: z.string().trim().max(500).default("") });
export const leaseTerminateSchema = z.object({
  terminatedOn: isoDate,
  reason: z.string().trim().min(3, "Give a reason").max(500),
});

type Lease = typeof schema.leases.$inferSelect;

function terms(l: Lease) {
  return {
    status: l.status,
    startDate: l.startDate,
    endDate: l.endDate,
    rentCents: l.rentCents,
    dueDay: l.dueDay,
    depositCents: l.depositCents,
    escalationBps: l.escalationBps,
    escalationDate: l.escalationDate,
    noticeDays: l.noticeDays,
    noticeGivenOn: l.noticeGivenOn,
    terminatedOn: l.terminatedOn,
  };
}

async function loadForUpdate(tx: Tx, actor: Actor, leaseId: string): Promise<Lease> {
  await assertLeaseInScope(tx, actor, leaseId);
  const [lease] = await tx.select().from(schema.leases).where(eq(schema.leases.id, leaseId)).for("update");
  if (!lease) throw new NotFoundError("Lease");
  return lease;
}

async function recordEvent(
  tx: Tx,
  lease: Lease,
  type: (typeof schema.leaseEventType.enumValues)[number],
  effectiveDate: string,
  note: string | null,
  before: Lease | null,
  after: Lease,
) {
  const diff = before ? changes(terms(before), terms(after)) : { before: null, after: terms(after) };
  await tx.insert(schema.leaseEvents).values({
    leaseId: lease.id,
    type,
    effectiveDate,
    note,
    before: diff.before,
    after: diff.after,
  });
  await audit(tx, {
    action: `lease.${type}`,
    entity: "lease",
    entityId: lease.id,
    before: diff.before,
    after: { ...diff.after, ...(note ? { note } : {}) },
  });
}

/** Unit status follows its live leases; maintenance is left alone. */
export async function syncUnitStatus(tx: Tx, unitId: string): Promise<void> {
  const live = await tx
    .select({ status: schema.leases.status })
    .from(schema.leases)
    .where(and(eq(schema.leases.unitId, unitId), inArray(schema.leases.status, ["active", "notice_given"])));
  const next = live.some((l) => l.status === "notice_given") ? "notice_given" : live.length ? "occupied" : "vacant";
  await tx
    .update(schema.units)
    .set({ status: next })
    .where(and(eq(schema.units.id, unitId), ne(schema.units.status, next), next === "vacant" ? ne(schema.units.status, "under_maintenance") : undefined));
}

function overlapError(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } }).cause;
  return cause?.code === "23P01" && cause.constraint === "leases_no_overlap";
}

async function runLeaseChange<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await withAgency(actor.ctx, fn);
  } catch (err) {
    if (overlapError(err)) throw new LeaseRuleError("This unit already has a live lease for some of those dates.");
    throw err;
  }
}

// ─── reads ───────────────────────────────────────────────────────────

// Correlated subqueries name the outer table explicitly: in a single-table
// select Drizzle renders ${table.column} unqualified, which would bind to the
// subquery's own column.
export async function listLeases(actor: Actor, opts: { status?: string; q?: string } = {}) {
  authorise(actor, "records.view");
  return withAgency(actor.ctx, async (tx) => {
    const q = opts.q?.trim();
    const status = schema.leaseStatus.enumValues.find((s) => s === opts.status);
    return tx
      .select({
        lease: schema.leases,
        unitLabel: schema.units.label,
        propertyId: schema.properties.id,
        propertyName: schema.properties.name,
        primaryTenant: sql<string | null>`(select t.full_name from ${schema.leaseTenants} lt
          join ${schema.tenants} t on t.id = lt.tenant_id
          where lt.lease_id = "leases"."id" and lt.is_primary)`,
      })
      .from(schema.leases)
      .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .where(
        and(
          leaseScope(actor),
          status ? eq(schema.leases.status, status) : undefined,
          q
            ? or(
                ilike(schema.leases.eftReference, `%${q}%`),
                ilike(schema.properties.name, `%${q}%`),
                sql`exists (select 1 from ${schema.leaseTenants} lt join ${schema.tenants} t on t.id = lt.tenant_id
                     where lt.lease_id = "leases"."id" and t.full_name ilike ${`%${q}%`})`,
              )
            : undefined,
        ),
      )
      .orderBy(desc(schema.leases.startDate))
      .limit(500);
  });
}

export async function getLease(actor: Actor, leaseId: string) {
  authorise(actor, "records.view");
  return withAgency(actor.ctx, async (tx) => {
    const [row] = await tx
      .select({
        lease: schema.leases,
        unitLabel: schema.units.label,
        propertyId: schema.properties.id,
        propertyName: schema.properties.name,
      })
      .from(schema.leases)
      .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .where(and(eq(schema.leases.id, leaseId), leaseScope(actor)));
    if (!row) throw new NotFoundError("Lease");
    const tenants = await tx
      .select({ id: schema.tenants.id, fullName: schema.tenants.fullName, isPrimary: schema.leaseTenants.isPrimary })
      .from(schema.leaseTenants)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.leaseTenants.tenantId))
      .where(eq(schema.leaseTenants.leaseId, leaseId))
      .orderBy(desc(schema.leaseTenants.isPrimary), asc(schema.tenants.fullName));
    const events = await tx
      .select({ event: schema.leaseEvents, userName: schema.users.name })
      .from(schema.leaseEvents)
      .leftJoin(schema.users, eq(schema.users.id, schema.leaseEvents.createdBy))
      .where(eq(schema.leaseEvents.leaseId, leaseId))
      .orderBy(desc(schema.leaseEvents.createdAt));
    return { ...row, tenants, events };
  });
}

/** Units and tenants the actor may put on a new lease. */
export async function leaseFormOptions(actor: Actor) {
  authorise(actor, "records.edit");
  return withAgency(actor.ctx, async (tx) => {
    const units = await tx
      .select({ id: schema.units.id, label: schema.units.label, propertyName: schema.properties.name, status: schema.units.status })
      .from(schema.units)
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .where(and(unitScope(actor), sql`${schema.units.archivedAt} is null`, sql`${schema.properties.archivedAt} is null`))
      .orderBy(asc(schema.properties.name), asc(schema.units.label));
    const tenants = await tx
      .select({ id: schema.tenants.id, fullName: schema.tenants.fullName })
      .from(schema.tenants)
      .where(and(tenantScope(actor), sql`${schema.tenants.archivedAt} is null`))
      .orderBy(asc(schema.tenants.fullName));
    return { units, tenants };
  });
}

// ─── changes ─────────────────────────────────────────────────────────

/** Creates a draft lease with a newly allocated EFT reference. */
export async function createLease(actor: Actor, input: LeaseCreateInput): Promise<{ id: string; eftReference: string }> {
  authorise(actor, "records.edit");
  const coTenants = [...new Set(input.coTenantIds)].filter((id) => id !== input.primaryTenantId);
  return runLeaseChange(actor, async (tx) => {
    await assertUnitInScope(tx, actor, input.unitId);
    for (const tenantId of [input.primaryTenantId, ...coTenants]) await assertTenantInScope(tx, actor, tenantId);
    const eftReference = await nextEftReference(tx, actor.ctx.agencyId);
    const [lease] = await tx
      .insert(schema.leases)
      .values({
        unitId: input.unitId,
        eftReference,
        status: "draft",
        startDate: input.startDate,
        endDate: input.endDate,
        rentCents: input.rent,
        dueDay: input.dueDay,
        depositCents: input.deposit,
        escalationBps: input.escalationPercent,
        escalationDate: input.escalationDate,
        noticeDays: input.noticeDays,
        notes: input.notes,
      })
      .returning();
    if (!lease) throw new Error("insert failed");
    await tx.insert(schema.leaseTenants).values([
      { leaseId: lease.id, tenantId: input.primaryTenantId, isPrimary: true },
      ...coTenants.map((tenantId) => ({ leaseId: lease.id, tenantId, isPrimary: false })),
    ]);
    await recordEvent(tx, lease, "created", lease.startDate, null, null, lease);
    return { id: lease.id, eftReference };
  });
}

export async function activateLease(actor: Actor, leaseId: string): Promise<void> {
  authorise(actor, "records.edit");
  await runLeaseChange(actor, async (tx) => {
    const before = await loadForUpdate(tx, actor, leaseId);
    if (before.status !== "draft") throw new LeaseRuleError("Only a draft lease can be activated.");
    const [after] = await tx.update(schema.leases).set({ status: "active" }).where(eq(schema.leases.id, leaseId)).returning();
    await recordEvent(tx, before, "activated", before.startDate, null, before, after!);
    await syncUnitStatus(tx, before.unitId);
  });
}

/** Changes the terms of a lease, with a reason, as an amendment event. */
export async function amendLease(actor: Actor, leaseId: string, input: LeaseAmendInput): Promise<void> {
  authorise(actor, "records.edit");
  await runLeaseChange(actor, async (tx) => {
    const before = await loadForUpdate(tx, actor, leaseId);
    if (before.status === "ended" || before.status === "terminated") throw new LeaseRuleError("A closed lease cannot be changed.");
    const [after] = await tx
      .update(schema.leases)
      .set({
        startDate: input.startDate,
        endDate: input.endDate,
        rentCents: input.rent,
        dueDay: input.dueDay,
        depositCents: input.deposit,
        escalationBps: input.escalationPercent,
        escalationDate: input.escalationDate,
        noticeDays: input.noticeDays,
        notes: input.notes,
      })
      .where(eq(schema.leases.id, leaseId))
      .returning();
    await recordEvent(tx, before, "amended", input.effectiveDate, input.reason, before, after!);
  });
}

/** New term on the same lease and EFT reference (D3). Withdraws any notice. */
export async function renewLease(actor: Actor, leaseId: string, input: LeaseRenewInput): Promise<void> {
  authorise(actor, "records.edit");
  await runLeaseChange(actor, async (tx) => {
    const before = await loadForUpdate(tx, actor, leaseId);
    if (before.status !== "active" && before.status !== "notice_given") throw new LeaseRuleError("Only a live lease can be renewed.");
    if (input.newEndDate && before.endDate && input.newEndDate <= before.endDate) {
      throw new LeaseRuleError("The new end date must be after the current one.");
    }
    const [after] = await tx
      .update(schema.leases)
      .set({
        status: "active",
        endDate: input.newEndDate,
        rentCents: input.newRent,
        escalationBps: input.escalationPercent,
        escalationDate: input.escalationDate,
        noticeGivenOn: null,
      })
      .where(eq(schema.leases.id, leaseId))
      .returning();
    await recordEvent(tx, before, "renewed", input.effectiveDate, null, before, after!);
    await syncUnitStatus(tx, before.unitId);
  });
}

/**
 * Applies the lease's escalation: rent × (1 + %), rounded to the cent, and
 * moves the next escalation date on a year.
 */
export async function applyEscalation(actor: Actor, leaseId: string): Promise<void> {
  authorise(actor, "records.edit");
  await runLeaseChange(actor, async (tx) => {
    const before = await loadForUpdate(tx, actor, leaseId);
    if (before.status !== "active" && before.status !== "notice_given") throw new LeaseRuleError("Only a live lease can escalate.");
    if (before.escalationBps === null || !before.escalationDate) throw new LeaseRuleError("This lease has no escalation set.");
    const newRent = escalatedRent(before.rentCents, before.escalationBps);
    const [after] = await tx
      .update(schema.leases)
      .set({ rentCents: newRent, escalationDate: sql`(${before.escalationDate}::date + interval '1 year')::date` })
      .where(eq(schema.leases.id, leaseId))
      .returning();
    await recordEvent(tx, before, "escalated", before.escalationDate, null, before, after!);
  });
}

/** Integer-only: round half up to the nearest cent. */
export function escalatedRent(rentCents: number, bps: number): number {
  return Math.floor((rentCents * (10_000 + bps) + 5_000) / 10_000);
}

export async function giveNotice(actor: Actor, leaseId: string, input: z.infer<typeof leaseNoticeSchema>): Promise<void> {
  authorise(actor, "records.edit");
  await runLeaseChange(actor, async (tx) => {
    const before = await loadForUpdate(tx, actor, leaseId);
    if (before.status !== "active") throw new LeaseRuleError("Notice can only be given on an active lease.");
    if (input.endDate < input.noticeDate) throw new LeaseRuleError("The move-out date must be after the notice date.");
    const [after] = await tx
      .update(schema.leases)
      .set({ status: "notice_given", noticeGivenOn: input.noticeDate, endDate: input.endDate })
      .where(eq(schema.leases.id, leaseId))
      .returning();
    await recordEvent(tx, before, "notice_given", input.noticeDate, input.note || null, before, after!);
    await syncUnitStatus(tx, before.unitId);
  });
}

export async function terminateLease(actor: Actor, leaseId: string, input: z.infer<typeof leaseTerminateSchema>): Promise<void> {
  authorise(actor, "records.edit");
  await runLeaseChange(actor, async (tx) => {
    const before = await loadForUpdate(tx, actor, leaseId);
    if (before.status === "ended" || before.status === "terminated") throw new LeaseRuleError("This lease is already closed.");
    const [after] = await tx
      .update(schema.leases)
      .set({ status: "terminated", terminatedOn: input.terminatedOn, terminationReason: input.reason })
      .where(eq(schema.leases.id, leaseId))
      .returning();
    await recordEvent(tx, before, "terminated", input.terminatedOn, input.reason, before, after!);
    await syncUnitStatus(tx, before.unitId);
  });
}

/** Closes a lease that has run to its end date. */
export async function endLease(actor: Actor, leaseId: string): Promise<void> {
  authorise(actor, "records.edit");
  await runLeaseChange(actor, async (tx) => {
    const before = await loadForUpdate(tx, actor, leaseId);
    if (before.status !== "active" && before.status !== "notice_given") throw new LeaseRuleError("Only a live lease can be ended.");
    if (!before.endDate) throw new LeaseRuleError("Set an end date (give notice) before ending a month-to-month lease.");
    const [after] = await tx.update(schema.leases).set({ status: "ended" }).where(eq(schema.leases.id, leaseId)).returning();
    await recordEvent(tx, before, "ended", before.endDate, null, before, after!);
    await syncUnitStatus(tx, before.unitId);
  });
}

/** Draft leases only: replace the tenants. */
export async function setLeaseTenants(actor: Actor, leaseId: string, primaryTenantId: string, coTenantIds: string[]): Promise<void> {
  authorise(actor, "records.edit");
  await runLeaseChange(actor, async (tx) => {
    const lease = await loadForUpdate(tx, actor, leaseId);
    if (lease.status !== "draft") throw new LeaseRuleError("Tenants can only be changed on a draft lease. Amend or renew instead.");
    const co = [...new Set(coTenantIds)].filter((id) => id !== primaryTenantId);
    for (const id of [primaryTenantId, ...co]) await assertTenantInScope(tx, actor, id);
    const before = await tx.select().from(schema.leaseTenants).where(eq(schema.leaseTenants.leaseId, leaseId));
    await tx.delete(schema.leaseTenants).where(eq(schema.leaseTenants.leaseId, leaseId));
    await tx.insert(schema.leaseTenants).values([
      { leaseId, tenantId: primaryTenantId, isPrimary: true },
      ...co.map((tenantId) => ({ leaseId, tenantId, isPrimary: false })),
    ]);
    await audit(tx, {
      action: "lease.tenants_changed",
      entity: "lease",
      entityId: leaseId,
      before: { tenants: before.map((t) => t.tenantId), primary: before.find((t) => t.isPrimary)?.tenantId },
      after: { tenants: [primaryTenantId, ...co], primary: primaryTenantId },
    });
  });
}
