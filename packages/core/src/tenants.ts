import { schema, withAgency } from "@awdrent/db";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { audit, changes } from "./audit";
import { blindIndex, decrypt, encrypt, last4, normaliseIdentifier } from "./crypto";
import { identityNumberProblem } from "./identity";
import { type Actor, assertTenantInScope, authorise, leaseScope, NotFoundError, tenantScope } from "./portfolio";

const ID_FIELD = "tenants.id_number";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null);
const phone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s()-]/g, ""))
  .refine((s) => s === "" || /^\+?\d{9,15}$/.test(s), "Enter a phone number like 082 123 4567")
  .transform((s) => s || null);
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

export const tenantSchema = z
  .object({
    fullName: z.string().trim().min(2).max(160),
    idKind: z.enum(["sa_id", "passport"]),
    // Empty keeps the stored number on update
    idNumber: z.string().trim().max(30).default(""),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((s) => s === "" || z.email().safeParse(s).success, "Enter a valid email address")
      .transform((s) => s || null),
    phone,
    employer: optionalText(160),
    emergencyContactName: optionalText(160),
    emergencyContactPhone: phone,
    consentGiven: checkbox,
    emailOptIn: checkbox,
    smsOptIn: checkbox,
    whatsappOptIn: checkbox,
    notes: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.idNumber) {
      const problem = identityNumberProblem(v.idNumber, v.idKind === "sa_id" ? "sa_id" : "other");
      if (problem) ctx.addIssue({ code: "custom", path: ["idNumber"], message: problem });
    }
    if (v.smsOptIn && !v.phone) ctx.addIssue({ code: "custom", path: ["phone"], message: "A phone number is needed for SMS" });
    if (v.whatsappOptIn && !v.phone) ctx.addIssue({ code: "custom", path: ["phone"], message: "A phone number is needed for WhatsApp" });
    if (v.emailOptIn && !v.email) ctx.addIssue({ code: "custom", path: ["email"], message: "An email address is needed for email" });
  });
export type TenantInput = z.infer<typeof tenantSchema>;

function present(t: typeof schema.tenants.$inferSelect) {
  return {
    id: t.id,
    fullName: t.fullName,
    idKind: t.idKind,
    idNumberLast4: t.idNumberLast4,
    email: t.email,
    phone: t.phone,
    employer: t.employer,
    emergencyContactName: t.emergencyContactName,
    emergencyContactPhone: t.emergencyContactPhone,
    consentAt: t.consentAt,
    emailOptIn: t.emailOptIn,
    smsOptIn: t.smsOptIn,
    whatsappOptIn: t.whatsappOptIn,
    notes: t.notes,
    archivedAt: t.archivedAt,
  };
}
export type TenantView = ReturnType<typeof present>;

function columns(agencyId: string, input: TenantInput, existingConsentAt: Date | null) {
  const id = input.idNumber ? normaliseIdentifier(input.idNumber) : null;
  const ctx = { agencyId, field: ID_FIELD };
  return {
    fullName: input.fullName,
    idKind: input.idKind,
    email: input.email,
    phone: input.phone,
    employer: input.employer,
    emergencyContactName: input.emergencyContactName,
    emergencyContactPhone: input.emergencyContactPhone,
    // Consent keeps its original date; unticking withdraws it
    consentAt: input.consentGiven ? (existingConsentAt ?? sql`now()`) : null,
    emailOptIn: input.emailOptIn,
    smsOptIn: input.smsOptIn,
    whatsappOptIn: input.whatsappOptIn,
    notes: input.notes,
    ...(id ? { idNumberEnc: encrypt(id, ctx), idNumberLast4: last4(id), idNumberBlindIndex: blindIndex(id, ctx) } : {}),
  };
}

// Correlated subqueries name the outer table explicitly: in a single-table
// select Drizzle renders ${table.column} unqualified, which would bind to the
// subquery's own column.
/** Insert values for a new tenant (shared with the CSV import). */
export function tenantInsertValues(agencyId: string, input: TenantInput) {
  return columns(agencyId, input, null);
}

export async function listTenants(actor: Actor, opts: { q?: string } = {}) {
  authorise(actor, "records.view");
  return withAgency(actor.ctx, async (tx) => {
    const q = opts.q?.trim();
    const rows = await tx
      .select({
        tenant: schema.tenants,
        currentLease: sql<string | null>`(select l.eft_reference from ${schema.leaseTenants} lt
          join ${schema.leases} l on l.id = lt.lease_id
          where lt.tenant_id = "tenants"."id" and l.status in ('active', 'notice_given')
          order by l.start_date desc limit 1)`,
      })
      .from(schema.tenants)
      .where(
        and(
          tenantScope(actor),
          isNull(schema.tenants.archivedAt),
          q
            ? or(
                ilike(schema.tenants.fullName, `%${q}%`),
                ilike(schema.tenants.email, `%${q}%`),
                ilike(schema.tenants.phone, `%${q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(schema.tenants.fullName))
      .limit(500);
    return rows.map((r) => ({ ...present(r.tenant), currentLease: r.currentLease }));
  });
}

export async function getTenant(actor: Actor, tenantId: string) {
  authorise(actor, "records.view");
  return withAgency(actor.ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.tenants)
      .where(and(eq(schema.tenants.id, tenantId), tenantScope(actor)));
    if (!row) throw new NotFoundError("Tenant");
    const leases = await tx
      .select({
        id: schema.leases.id,
        eftReference: schema.leases.eftReference,
        status: schema.leases.status,
        startDate: schema.leases.startDate,
        endDate: schema.leases.endDate,
        isPrimary: schema.leaseTenants.isPrimary,
        unitLabel: schema.units.label,
        propertyName: schema.properties.name,
      })
      .from(schema.leaseTenants)
      .innerJoin(schema.leases, eq(schema.leases.id, schema.leaseTenants.leaseId))
      .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .where(and(eq(schema.leaseTenants.tenantId, tenantId), leaseScope(actor)))
      .orderBy(desc(schema.leases.startDate));
    return { ...present(row), leases };
  });
}

export async function createTenant(actor: Actor, input: TenantInput): Promise<string> {
  authorise(actor, "records.edit");
  return withAgency(actor.ctx, async (tx) => {
    const [row] = await tx.insert(schema.tenants).values(columns(actor.ctx.agencyId, input, null)).returning();
    if (!row) throw new Error("insert failed");
    await audit(tx, { action: "tenant.created", entity: "tenant", entityId: row.id, after: present(row) });
    return row.id;
  });
}

export async function updateTenant(actor: Actor, tenantId: string, input: TenantInput): Promise<void> {
  authorise(actor, "records.edit");
  await withAgency(actor.ctx, async (tx) => {
    await assertTenantInScope(tx, actor, tenantId);
    const [before] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).for("update");
    const [after] = await tx
      .update(schema.tenants)
      .set(columns(actor.ctx.agencyId, input, before!.consentAt))
      .where(eq(schema.tenants.id, tenantId))
      .returning();
    const diff = changes(present(before!), present(after!));
    if (Object.keys(diff.after).length) await audit(tx, { action: "tenant.updated", entity: "tenant", entityId: tenantId, ...diff });
  });
}

/** Full ID number for an admin or the tenant's agent; every reveal is audited. */
export async function revealTenantIdNumber(actor: Actor, tenantId: string): Promise<string | null> {
  authorise(actor, "tenant.id.view");
  return withAgency(actor.ctx, async (tx) => {
    await assertTenantInScope(tx, actor, tenantId);
    const [row] = await tx.select({ enc: schema.tenants.idNumberEnc }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    if (!row?.enc) return null;
    await audit(tx, { action: "tenant.id_number_revealed", entity: "tenant", entityId: tenantId });
    return decrypt(row.enc, { agencyId: actor.ctx.agencyId, field: ID_FIELD });
  });
}

/** Tenants with this ID number in the agency (duplicate check before creating). */
export async function findTenantsByIdNumber(actor: Actor, idNumber: string) {
  authorise(actor, "records.view");
  const index = blindIndex(idNumber, { agencyId: actor.ctx.agencyId, field: ID_FIELD });
  return withAgency(actor.ctx, (tx) =>
    tx
      .select({ id: schema.tenants.id, fullName: schema.tenants.fullName })
      .from(schema.tenants)
      .where(and(eq(schema.tenants.idNumberBlindIndex, index), tenantScope(actor))),
  );
}
