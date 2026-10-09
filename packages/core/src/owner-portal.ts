import { type AgencyContext, schema, withAgency } from "@awdrent/db";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { todayInSouthAfrica } from "./billing";
import { ledgerInTx } from "./ledger";
import { jobReference, STATUS_LABEL } from "./maintenance";
import { NotFoundError } from "./portfolio";
import { signedDownloadUrl } from "./storage";

// The owner portal (spec; D41, D104–D106): read-only. An owner whose portal
// staff have switched on signs in with a one-time code and sees their
// properties, the current leases with their arrears, their approved monthly
// statements, and maintenance on their properties. Every call takes an
// OwnerActor built from the verified portal session.

export interface OwnerActor {
  ctx: AgencyContext & { portalUserId: string };
  ownerId: string;
}

const read = (actor: OwnerActor) => ({ ...actor.ctx, readOnly: true });

/** The owner's properties and units, with each unit's current lease. */
export async function ownerProperties(actor: OwnerActor, today = todayInSouthAfrica()) {
  return withAgency(read(actor), async (tx) => {
    const properties = await tx
      .select()
      .from(schema.properties)
      .where(and(eq(schema.properties.ownerId, actor.ownerId), isNull(schema.properties.archivedAt)))
      .orderBy(asc(schema.properties.name));
    if (properties.length === 0) return [];
    const units = await tx
      .select()
      .from(schema.units)
      .where(and(inArray(schema.units.propertyId, properties.map((p) => p.id)), isNull(schema.units.archivedAt)))
      .orderBy(asc(schema.units.label));
    const leases = units.length
      ? await tx
          .select()
          .from(schema.leases)
          .where(and(inArray(schema.leases.unitId, units.map((u) => u.id)), inArray(schema.leases.status, ["active", "notice_given"])))
      : [];
    const tenants = leases.length
      ? await tx
          .select({ leaseId: schema.leaseTenants.leaseId, name: schema.tenants.fullName })
          .from(schema.leaseTenants)
          .innerJoin(schema.tenants, eq(schema.tenants.id, schema.leaseTenants.tenantId))
          .where(inArray(schema.leaseTenants.leaseId, leases.map((l) => l.id)))
      : [];
    const out = [];
    for (const p of properties) {
      const rows = [];
      for (const u of units.filter((x) => x.propertyId === p.id)) {
        const lease = leases.find((l) => l.unitId === u.id);
        const ledger = lease ? await ledgerInTx(tx, lease.id, today) : null;
        rows.push({
          id: u.id,
          label: u.label,
          status: u.status,
          lease: lease
            ? {
                eftReference: lease.eftReference,
                status: lease.status,
                startDate: lease.startDate,
                endDate: lease.endDate,
                rentCents: lease.rentCents,
                tenants: tenants.filter((t) => t.leaseId === lease.id).map((t) => t.name),
                overdueCents: ledger!.overdueCents,
              }
            : null,
        });
      }
      out.push({ id: p.id, name: p.name, address: [p.addressLine1, p.suburb, p.city].filter(Boolean).join(", "), units: rows });
    }
    return out;
  });
}

/** The owner's approved statements, newest first. */
export async function ownerStatements(actor: OwnerActor) {
  return withAgency(read(actor), (tx) =>
    tx
      .select({ statement: schema.ownerStatements })
      .from(schema.ownerStatements)
      .innerJoin(schema.statementRuns, eq(schema.statementRuns.id, schema.ownerStatements.runId))
      .where(and(eq(schema.ownerStatements.ownerId, actor.ownerId), eq(schema.statementRuns.status, "approved")))
      .orderBy(desc(schema.ownerStatements.period)),
  );
}

/** A short-lived download link for one of the owner's statement PDFs. */
export async function ownerStatementUrl(actor: OwnerActor, statementId: string): Promise<string> {
  const doc = await withAgency(read(actor), async (tx) => {
    const [row] = await tx
      .select({ doc: schema.documents })
      .from(schema.ownerStatements)
      .innerJoin(schema.statementRuns, eq(schema.statementRuns.id, schema.ownerStatements.runId))
      .innerJoin(schema.documents, eq(schema.documents.id, schema.ownerStatements.documentId))
      .where(and(eq(schema.ownerStatements.id, statementId), eq(schema.ownerStatements.ownerId, actor.ownerId), eq(schema.statementRuns.status, "approved")));
    if (!row) throw new NotFoundError("Statement");
    return row.doc;
  });
  return signedDownloadUrl(doc.fileKey, actor.ctx.agencyId, doc.filename);
}

/** Maintenance on the owner's properties, newest first. */
export async function ownerMaintenance(actor: OwnerActor) {
  return withAgency(read(actor), async (tx) => {
    const rows = await tx
      .select({
        request: schema.maintenanceRequests,
        unit: schema.units.label,
        property: schema.properties.name,
        contractor: schema.contractors.name,
      })
      .from(schema.maintenanceRequests)
      .innerJoin(schema.units, eq(schema.units.id, schema.maintenanceRequests.unitId))
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .leftJoin(schema.contractors, eq(schema.contractors.id, schema.maintenanceRequests.contractorId))
      .where(eq(schema.properties.ownerId, actor.ownerId))
      .orderBy(desc(schema.maintenanceRequests.createdAt))
      .limit(100);
    return rows.map((r) => ({
      id: r.request.id,
      reference: jobReference(r.request.id),
      title: r.request.title,
      status: STATUS_LABEL[r.request.status],
      priority: r.request.priority,
      where: `${r.unit}, ${r.property}`,
      contractor: r.contractor,
      createdAt: r.request.createdAt,
      completedAt: r.request.completedAt,
    }));
  });
}
