import { schema, withAgency } from "@awdrent/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Actor, authorise, leaseScope, tenantScope, unitScope } from "./portfolio";

/** Headline figures for the staff dashboard, limited to the actor's portfolio. */
export async function dashboardFigures(actor: Actor) {
  authorise(actor, "records.view");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const [units] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        vacant: sql<number>`count(*) filter (where ${schema.units.status} = 'vacant')::int`,
        occupied: sql<number>`count(*) filter (where ${schema.units.status} = 'occupied')::int`,
        notice: sql<number>`count(*) filter (where ${schema.units.status} = 'notice_given')::int`,
        maintenance: sql<number>`count(*) filter (where ${schema.units.status} = 'under_maintenance')::int`,
      })
      .from(schema.units)
      .where(and(unitScope(actor), isNull(schema.units.archivedAt)));
    const [leases] = await tx
      .select({
        live: sql<number>`count(*) filter (where ${schema.leases.status} in ('active', 'notice_given'))::int`,
        drafts: sql<number>`count(*) filter (where ${schema.leases.status} = 'draft')::int`,
        ending30: sql<number>`count(*) filter (where ${schema.leases.status} in ('active', 'notice_given') and ${schema.leases.endDate} between current_date and current_date + 30)::int`,
        ending60: sql<number>`count(*) filter (where ${schema.leases.status} in ('active', 'notice_given') and ${schema.leases.endDate} between current_date + 31 and current_date + 60)::int`,
        ending90: sql<number>`count(*) filter (where ${schema.leases.status} in ('active', 'notice_given') and ${schema.leases.endDate} between current_date + 61 and current_date + 90)::int`,
        escalationsDue: sql<number>`count(*) filter (where ${schema.leases.status} in ('active', 'notice_given') and ${schema.leases.escalationDate} <= current_date + 60)::int`,
      })
      .from(schema.leases)
      .where(leaseScope(actor));
    const [consent] = await tx
      .select({ missing: sql<number>`count(*)::int` })
      .from(schema.tenants)
      .where(
        and(
          tenantScope(actor),
          isNull(schema.tenants.consentAt),
          isNull(schema.tenants.archivedAt),
          inArray(
            schema.tenants.id,
            tx
              .select({ id: schema.leaseTenants.tenantId })
              .from(schema.leaseTenants)
              .innerJoin(schema.leases, eq(schema.leases.id, schema.leaseTenants.leaseId))
              .where(inArray(schema.leases.status, ["active", "notice_given"])),
          ),
        ),
      );
    return { units: units!, leases: leases!, tenantsWithoutConsent: consent!.missing };
  });
}
