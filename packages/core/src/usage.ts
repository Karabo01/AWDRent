import { schema, withAgency } from "@awdrent/db";
import { inArray, isNull, and, sql } from "drizzle-orm";

/**
 * Records this month's active units for one agency (the basis of its
 * invoice): units with a live lease. Message counts are added by the
 * messaging service in Phase 2.
 */
export async function snapshotUsage(agencyId: string): Promise<number> {
  return withAgency({ agencyId }, async (tx) => {
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(distinct ${schema.leases.unitId})::int` })
      .from(schema.leases)
      .innerJoin(schema.units, sql`${schema.units.id} = ${schema.leases.unitId}`)
      .where(and(inArray(schema.leases.status, ["active", "notice_given"]), isNull(schema.units.archivedAt)));
    await tx
      .insert(schema.usageCounters)
      .values({ month: sql`date_trunc('month', now() at time zone 'Africa/Johannesburg')::date`, activeUnits: n })
      .onConflictDoUpdate({
        target: [schema.usageCounters.agencyId, schema.usageCounters.month],
        set: { activeUnits: n },
      });
    return n;
  });
}
