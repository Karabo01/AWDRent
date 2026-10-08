import { schema, type AgencyContext, type Tx } from "@awdrent/db";
import { and, eq, exists, inArray, or, type SQL, sql } from "drizzle-orm";
import { assertCan, type Action, isScopedToPortfolio, type StaffRole } from "./permissions";

// Who is acting, and what they may see. Core functions take an Actor and
// apply permissions (permissions.ts) and portfolio limits here themselves,
// so a page or action cannot forget them. RLS separately limits everything
// to the actor's agency.
//
// Agents see (decision D14):
//   properties  assigned to them in agent_portfolios
//   units       of those properties
//   owners      with at least one of those properties, or that they created
// Admins and accounts see everything in the agency.

export interface Actor {
  ctx: AgencyContext;
  role: StaffRole;
  /** null for AWDTECH support (treated as admin). */
  userId: string | null;
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export function authorise(actor: Actor, action: Action): void {
  assertCan(actor.role, action);
}

function myPropertyIds(actor: Actor) {
  return sql`(select ${schema.agentPortfolios.propertyId} from ${schema.agentPortfolios}
              where ${schema.agentPortfolios.userId} = ${actor.userId})`;
}

/** WHERE clause limiting properties to the actor's portfolio (undefined = no limit). */
export function propertyScope(actor: Actor): SQL | undefined {
  if (!isScopedToPortfolio(actor.role)) return undefined;
  if (!actor.userId) return sql`false`;
  return inArray(schema.properties.id, myPropertyIds(actor));
}

export function unitScope(actor: Actor): SQL | undefined {
  if (!isScopedToPortfolio(actor.role)) return undefined;
  if (!actor.userId) return sql`false`;
  return inArray(schema.units.propertyId, myPropertyIds(actor));
}

export function ownerScope(tx: Tx, actor: Actor): SQL | undefined {
  if (!isScopedToPortfolio(actor.role)) return undefined;
  if (!actor.userId) return sql`false`;
  return or(
    eq(schema.owners.createdBy, actor.userId),
    exists(
      tx
        .select({ one: sql`1` })
        .from(schema.properties)
        .where(and(eq(schema.properties.ownerId, schema.owners.id), inArray(schema.properties.id, myPropertyIds(actor)))),
    ),
  );
}

function myUnitIds(actor: Actor) {
  return sql`(select ${schema.units.id} from ${schema.units}
              where ${schema.units.propertyId} in ${myPropertyIds(actor)})`;
}

export function leaseScope(actor: Actor): SQL | undefined {
  if (!isScopedToPortfolio(actor.role)) return undefined;
  if (!actor.userId) return sql`false`;
  return inArray(schema.leases.unitId, myUnitIds(actor));
}

/** Agents see tenants on leases in their portfolio, and tenants they created. */
export function tenantScope(actor: Actor): SQL | undefined {
  if (!isScopedToPortfolio(actor.role)) return undefined;
  if (!actor.userId) return sql`false`;
  return or(
    eq(schema.tenants.createdBy, actor.userId),
    inArray(
      schema.tenants.id,
      sql`(select lt.tenant_id from ${schema.leaseTenants} lt
           join ${schema.leases} l on l.id = lt.lease_id
           where l.unit_id in ${myUnitIds(actor)})`,
    ),
  );
}

export async function assertLeaseInScope(tx: Tx, actor: Actor, leaseId: string): Promise<void> {
  const [row] = await tx
    .select({ id: schema.leases.id })
    .from(schema.leases)
    .where(and(eq(schema.leases.id, leaseId), leaseScope(actor)));
  if (!row) throw new NotFoundError("Lease");
}

export async function assertTenantInScope(tx: Tx, actor: Actor, tenantId: string): Promise<void> {
  const [row] = await tx
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(and(eq(schema.tenants.id, tenantId), tenantScope(actor)));
  if (!row) throw new NotFoundError("Tenant");
}

export async function assertPropertyInScope(tx: Tx, actor: Actor, propertyId: string): Promise<void> {
  const [row] = await tx
    .select({ id: schema.properties.id })
    .from(schema.properties)
    .where(and(eq(schema.properties.id, propertyId), propertyScope(actor)));
  if (!row) throw new NotFoundError("Property");
}

export async function assertOwnerInScope(tx: Tx, actor: Actor, ownerId: string): Promise<void> {
  const [row] = await tx
    .select({ id: schema.owners.id })
    .from(schema.owners)
    .where(and(eq(schema.owners.id, ownerId), ownerScope(tx, actor)));
  if (!row) throw new NotFoundError("Owner");
}

export async function assertUnitInScope(tx: Tx, actor: Actor, unitId: string): Promise<{ propertyId: string }> {
  const [row] = await tx
    .select({ propertyId: schema.units.propertyId })
    .from(schema.units)
    .where(and(eq(schema.units.id, unitId), unitScope(actor)));
  if (!row) throw new NotFoundError("Unit");
  return row;
}
