import { schema, withAgency } from "@awdrent/db";
import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { audit, changes } from "./audit";
import {
  type Actor,
  assertOwnerInScope,
  assertPropertyInScope,
  assertUnitInScope,
  authorise,
  NotFoundError,
  propertyScope,
} from "./portfolio";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null);

const optionalCount = z
  .string()
  .trim()
  .refine((s) => s === "" || /^\d{1,2}$/.test(s), "A whole number")
  .transform((s) => (s === "" ? null : Number(s)));

export const PROPERTY_TYPES = ["house", "apartment_block", "complex", "commercial", "mixed_use", "other"] as const;
export const UNIT_STATUSES = ["vacant", "occupied", "notice_given", "under_maintenance"] as const;

export const propertySchema = z.object({
  ownerId: z.uuid("Choose an owner"),
  name: z.string().trim().min(2).max(160),
  type: z.enum(PROPERTY_TYPES),
  addressLine1: z.string().trim().min(3).max(200),
  addressLine2: optionalText(200),
  suburb: optionalText(100),
  city: z.string().trim().min(2).max(100),
  province: optionalText(60),
  postalCode: z
    .string()
    .trim()
    .refine((s) => s === "" || /^\d{4}$/.test(s), "4-digit postal code")
    .transform((s) => s || null),
  notes: optionalText(2000),
});
export type PropertyInput = z.infer<typeof propertySchema>;

export const unitSchema = z.object({
  label: z.string().trim().min(1).max(60),
  bedrooms: optionalCount,
  bathrooms: optionalCount,
  status: z.enum(UNIT_STATUSES),
  notes: optionalText(1000),
});
export type UnitInput = z.infer<typeof unitSchema>;

export class DuplicateUnitError extends Error {
  constructor() {
    super("This property already has a unit with that label");
  }
}

export async function listProperties(actor: Actor, opts: { q?: string; ownerId?: string; includeArchived?: boolean } = {}) {
  authorise(actor, "records.view");
  return withAgency(actor.ctx, async (tx) => {
    const q = opts.q?.trim();
    return tx
      .select({
        property: schema.properties,
        ownerName: schema.owners.name,
        unitCount: sql<number>`(select count(*)::int from ${schema.units} u where u.property_id = ${schema.properties.id} and u.archived_at is null)`,
        vacantCount: sql<number>`(select count(*)::int from ${schema.units} u where u.property_id = ${schema.properties.id} and u.archived_at is null and u.status = 'vacant')`,
      })
      .from(schema.properties)
      .innerJoin(schema.owners, eq(schema.owners.id, schema.properties.ownerId))
      .where(
        and(
          propertyScope(actor),
          opts.includeArchived ? undefined : isNull(schema.properties.archivedAt),
          opts.ownerId ? eq(schema.properties.ownerId, opts.ownerId) : undefined,
          q
            ? or(
                ilike(schema.properties.name, `%${q}%`),
                ilike(schema.properties.addressLine1, `%${q}%`),
                ilike(schema.properties.suburb, `%${q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(schema.properties.name))
      .limit(500);
  });
}

export async function getProperty(actor: Actor, propertyId: string) {
  authorise(actor, "records.view");
  return withAgency(actor.ctx, async (tx) => {
    const [row] = await tx
      .select({ property: schema.properties, ownerName: schema.owners.name })
      .from(schema.properties)
      .innerJoin(schema.owners, eq(schema.owners.id, schema.properties.ownerId))
      .where(and(eq(schema.properties.id, propertyId), propertyScope(actor)));
    if (!row) throw new NotFoundError("Property");
    const units = await tx
      .select()
      .from(schema.units)
      .where(eq(schema.units.propertyId, propertyId))
      .orderBy(asc(schema.units.label));
    const agents = await tx
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.agentPortfolios)
      .innerJoin(schema.users, eq(schema.users.id, schema.agentPortfolios.userId))
      .where(eq(schema.agentPortfolios.propertyId, propertyId))
      .orderBy(asc(schema.users.name));
    return { ...row, units, agents };
  });
}

export async function createProperty(actor: Actor, input: PropertyInput): Promise<string> {
  authorise(actor, "records.edit");
  return withAgency(actor.ctx, async (tx) => {
    await assertOwnerInScope(tx, actor, input.ownerId);
    const [row] = await tx.insert(schema.properties).values(input).returning();
    if (!row) throw new Error("insert failed");
    // An agent's new property joins their own portfolio (decision D14)
    if (actor.role === "agent" && actor.userId) {
      await tx.insert(schema.agentPortfolios).values({ userId: actor.userId, propertyId: row.id });
    }
    await audit(tx, { action: "property.created", entity: "property", entityId: row.id, after: input });
    return row.id;
  });
}

export async function updateProperty(actor: Actor, propertyId: string, input: PropertyInput): Promise<void> {
  authorise(actor, "records.edit");
  await withAgency(actor.ctx, async (tx) => {
    await assertPropertyInScope(tx, actor, propertyId);
    await assertOwnerInScope(tx, actor, input.ownerId);
    const [before] = await tx.select().from(schema.properties).where(eq(schema.properties.id, propertyId)).for("update");
    const [after] = await tx.update(schema.properties).set(input).where(eq(schema.properties.id, propertyId)).returning();
    const diff = changes(before!, after!);
    if (Object.keys(diff.after).length) {
      await audit(tx, { action: "property.updated", entity: "property", entityId: propertyId, ...diff });
    }
  });
}

export async function setPropertyArchived(actor: Actor, propertyId: string, archived: boolean): Promise<void> {
  authorise(actor, "records.edit");
  await withAgency(actor.ctx, async (tx) => {
    await assertPropertyInScope(tx, actor, propertyId);
    await tx
      .update(schema.properties)
      .set({ archivedAt: archived ? sql`now()` : null })
      .where(eq(schema.properties.id, propertyId));
    await audit(tx, { action: archived ? "property.archived" : "property.restored", entity: "property", entityId: propertyId });
  });
}

function isDuplicateUnit(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } }).cause;
  return cause?.code === "23505" && cause.constraint === "units_agency_property_label_key";
}

export async function createUnit(actor: Actor, propertyId: string, input: UnitInput): Promise<string> {
  authorise(actor, "records.edit");
  try {
    return await withAgency(actor.ctx, async (tx) => {
      await assertPropertyInScope(tx, actor, propertyId);
      const [row] = await tx
        .insert(schema.units)
        .values({ ...input, propertyId })
        .returning();
      if (!row) throw new Error("insert failed");
      await audit(tx, { action: "unit.created", entity: "unit", entityId: row.id, after: { propertyId, ...input } });
      return row.id;
    });
  } catch (err) {
    if (isDuplicateUnit(err)) throw new DuplicateUnitError();
    throw err;
  }
}

export async function updateUnit(actor: Actor, unitId: string, input: UnitInput): Promise<void> {
  authorise(actor, "records.edit");
  try {
    await withAgency(actor.ctx, async (tx) => {
      await assertUnitInScope(tx, actor, unitId);
      const [before] = await tx.select().from(schema.units).where(eq(schema.units.id, unitId)).for("update");
      const [after] = await tx.update(schema.units).set(input).where(eq(schema.units.id, unitId)).returning();
      const diff = changes(before!, after!);
      if (Object.keys(diff.after).length) await audit(tx, { action: "unit.updated", entity: "unit", entityId: unitId, ...diff });
    });
  } catch (err) {
    if (isDuplicateUnit(err)) throw new DuplicateUnitError();
    throw err;
  }
}

/** Agents in the agency, for the portfolio picker. */
export async function listAgents(actor: Actor) {
  authorise(actor, "portfolio.assign");
  return withAgency(actor.ctx, (tx) =>
    tx
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(and(eq(schema.users.role, "agent"), eq(schema.users.active, true)))
      .orderBy(asc(schema.users.name)),
  );
}

/** Replaces the agents assigned to a property. Only active agents of this agency can be assigned. */
export async function setPropertyAgents(actor: Actor, propertyId: string, userIds: string[]): Promise<void> {
  authorise(actor, "portfolio.assign");
  await withAgency(actor.ctx, async (tx) => {
    await assertPropertyInScope(tx, actor, propertyId);
    const wanted = [...new Set(userIds)];
    if (wanted.length) {
      const valid = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(inArray(schema.users.id, wanted), eq(schema.users.role, "agent"), eq(schema.users.active, true)));
      if (valid.length !== wanted.length) throw new NotFoundError("Agent");
    }
    const before = await tx
      .select({ userId: schema.agentPortfolios.userId })
      .from(schema.agentPortfolios)
      .where(eq(schema.agentPortfolios.propertyId, propertyId));
    await tx.delete(schema.agentPortfolios).where(eq(schema.agentPortfolios.propertyId, propertyId));
    if (wanted.length) {
      await tx.insert(schema.agentPortfolios).values(wanted.map((userId) => ({ userId, propertyId })));
    }
    await audit(tx, {
      action: "portfolio.updated",
      entity: "property",
      entityId: propertyId,
      before: { agents: before.map((b) => b.userId).sort() },
      after: { agents: wanted.sort() },
    });
  });
}
