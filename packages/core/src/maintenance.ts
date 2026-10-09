import { schema, type Tx, withAgency } from "@awdrent/db";
import { and, asc, desc, eq, inArray, ne, type SQL } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import { storeUpload } from "./documents";
import { agencyUrl, leaseContact, send } from "./messages";
import type { PortalActor } from "./portal";
import { type Actor, assertUnitInScope, authorise, NotFoundError } from "./portfolio";

// Maintenance (spec 6; D100–D103).
//   Tenants log a request for a unit on their lease, with photos; the
//   portfolio agent is emailed. Agents set the priority, assign a contractor
//   (emailed a job card with the tenant's name and phone, D102) and move the
//   status on; each status change tells the tenant (maintenance_update).
//   The timeline is append-only. Owners pay contractors directly (D93).

export class MaintenanceError extends Error {}

export const PRIORITY_LABEL = { low: "Low", normal: "Normal", urgent: "Urgent", emergency: "Emergency" } as const;
export const STATUS_LABEL = { open: "Logged", assigned: "Contractor assigned", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" } as const;
type Status = keyof typeof STATUS_LABEL;
type Priority = keyof typeof PRIORITY_LABEL;

const MAX_PHOTOS = 5;

/** Short job reference for contractors and tenants: M-1A2B3C. */
export const jobReference = (id: string) => `M-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

export const requestSchema = z.object({
  title: z.string().trim().min(3, "Say briefly what is wrong").max(120),
  description: z.string().trim().min(3, "Describe the problem").max(3000),
  priority: z.enum(["low", "normal", "urgent", "emergency"]).default("normal"),
});

async function unitDetails(tx: Tx, unitId: string) {
  const [u] = await tx
    .select({ unit: schema.units, property: schema.properties })
    .from(schema.units)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
    .where(eq(schema.units.id, unitId));
  if (!u) throw new NotFoundError("Unit");
  const p = u.property;
  return {
    unitName: `${u.unit.label}, ${p.name}`,
    address: [`${u.unit.label}, ${p.name}`, p.addressLine1 !== p.name ? p.addressLine1 : null, p.suburb, p.city].filter(Boolean).join(", "),
  };
}

/** The current lease and its primary tenant for a unit, if any. */
async function currentLease(tx: Tx, unitId: string) {
  const [row] = await tx
    .select({ leaseId: schema.leases.id, tenantId: schema.leaseTenants.tenantId })
    .from(schema.leases)
    .innerJoin(schema.leaseTenants, and(eq(schema.leaseTenants.leaseId, schema.leases.id), eq(schema.leaseTenants.isPrimary, true)))
    .where(and(eq(schema.leases.unitId, unitId), inArray(schema.leases.status, ["active", "notice_given"])))
    .limit(1);
  return row ?? null;
}

async function notifyAgents(tx: Tx, request: typeof schema.maintenanceRequests.$inferSelect, tenantName: string) {
  const agents = await tx
    .select({ id: schema.users.id })
    .from(schema.units)
    .innerJoin(schema.agentPortfolios, eq(schema.agentPortfolios.propertyId, schema.units.propertyId))
    .innerJoin(schema.users, eq(schema.users.id, schema.agentPortfolios.userId))
    .where(and(eq(schema.units.id, request.unitId), eq(schema.users.active, true)));
  const admins = agents.length
    ? []
    : await tx.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.role, "admin"), eq(schema.users.active, true)));
  const { unitName } = await unitDetails(tx, request.unitId);
  for (const { id } of [...agents, ...admins]) {
    await send(tx, {
      recipient: { kind: "staff", userId: id },
      templateKey: "maintenance_new",
      leaseId: request.leaseId,
      variables: {
        title: request.title,
        unit: unitName,
        tenant: tenantName,
        priority: PRIORITY_LABEL[request.priority].toLowerCase(),
        link: await agencyUrl(tx, `/maintenance/${request.id}`),
      },
    });
  }
}

// ─── Tenants (portal) ──────────────────────────────────────────────────

/** Units the tenant may log requests for: those of their current leases. */
export async function portalMaintenanceUnits(actor: PortalActor) {
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const rows = await tx
      .select({ leaseId: schema.leases.id, unitId: schema.leases.unitId })
      .from(schema.leases)
      .innerJoin(schema.leaseTenants, eq(schema.leaseTenants.leaseId, schema.leases.id))
      .where(and(eq(schema.leaseTenants.tenantId, actor.tenantId), inArray(schema.leases.status, ["active", "notice_given"])));
    const out = [];
    for (const r of rows) out.push({ ...r, unitName: (await unitDetails(tx, r.unitId)).unitName });
    return out;
  });
}

export async function portalLogRequest(
  actor: PortalActor,
  input: { leaseId: string; title: string; description: string; photos: { filename: string; bytes: Uint8Array }[] },
): Promise<{ requestId: string; documentIds: string[] }> {
  if (input.photos.length > MAX_PHOTOS) throw new MaintenanceError(`Add at most ${MAX_PHOTOS} photos.`);
  const requestId = await withAgency(actor.ctx, async (tx) => {
    const [lease] = await tx
      .select({ unitId: schema.leases.unitId })
      .from(schema.leases)
      .innerJoin(schema.leaseTenants, eq(schema.leaseTenants.leaseId, schema.leases.id))
      .where(and(eq(schema.leases.id, input.leaseId), eq(schema.leaseTenants.tenantId, actor.tenantId), inArray(schema.leases.status, ["active", "notice_given"])));
    if (!lease) throw new NotFoundError("Lease");
    const [request] = await tx
      .insert(schema.maintenanceRequests)
      .values({ unitId: lease.unitId, leaseId: input.leaseId, tenantId: actor.tenantId, reportedVia: "portal", title: input.title, description: input.description })
      .returning();
    await tx.insert(schema.maintenanceUpdates).values({ requestId: request!.id, status: "open", note: null, portalUserId: actor.ctx.portalUserId });
    await audit(tx, { action: "maintenance.logged", entity: "maintenance_request", entityId: request!.id, after: { title: input.title, via: "portal" } });
    const [tenant] = await tx.select({ name: schema.tenants.fullName }).from(schema.tenants).where(eq(schema.tenants.id, actor.tenantId));
    await notifyAgents(tx, request!, tenant!.name);
    return request!.id;
  });
  const documentIds: string[] = [];
  for (const p of input.photos) {
    documentIds.push(
      await storeUpload(actor.ctx, { subject: { type: "maintenance_request", id: requestId }, kind: "maintenance_photo", filename: p.filename, bytes: p.bytes }, async (tx) => {
        const [r] = await tx.select({ tenantId: schema.maintenanceRequests.tenantId }).from(schema.maintenanceRequests).where(eq(schema.maintenanceRequests.id, requestId));
        if (r?.tenantId !== actor.tenantId) throw new NotFoundError("Maintenance request");
      }),
    );
  }
  return { requestId, documentIds };
}

/** The tenant's requests, with what they may see of the timeline. */
export async function portalRequests(actor: PortalActor) {
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const units = (
      await tx
        .select({ unitId: schema.leases.unitId })
        .from(schema.leases)
        .innerJoin(schema.leaseTenants, eq(schema.leaseTenants.leaseId, schema.leases.id))
        .where(and(eq(schema.leaseTenants.tenantId, actor.tenantId), ne(schema.leases.status, "draft")))
    ).map((u) => u.unitId);
    if (units.length === 0) return [];
    // Requests the tenant logged, and those staff logged for their current lease
    const requests = await tx
      .select()
      .from(schema.maintenanceRequests)
      .where(inArray(schema.maintenanceRequests.unitId, units))
      .orderBy(desc(schema.maintenanceRequests.createdAt))
      .limit(50);
    const leases = (
      await tx
        .select({ id: schema.leaseTenants.leaseId })
        .from(schema.leaseTenants)
        .where(eq(schema.leaseTenants.tenantId, actor.tenantId))
    ).map((l) => l.id);
    const mine = requests.filter((r) => r.tenantId === actor.tenantId || (r.leaseId && leases.includes(r.leaseId)));
    if (mine.length === 0) return [];
    const updates = await tx
      .select()
      .from(schema.maintenanceUpdates)
      .where(and(inArray(schema.maintenanceUpdates.requestId, mine.map((r) => r.id)), eq(schema.maintenanceUpdates.visibleToTenant, true)))
      .orderBy(asc(schema.maintenanceUpdates.createdAt));
    return mine.map((r) => ({ ...r, reference: jobReference(r.id), updates: updates.filter((u) => u.requestId === r.id) }));
  });
}

// ─── Staff ─────────────────────────────────────────────────────────────

/** Staff log a request for a unit (e.g. reported by phone). */
export async function logRequest(actor: Actor, input: { unitId: string; title: string; description: string; priority: Priority }): Promise<string> {
  authorise(actor, "maintenance.manage");
  return withAgency(actor.ctx, async (tx) => {
    await assertUnitInScope(tx, actor, input.unitId);
    const lease = await currentLease(tx, input.unitId);
    const [request] = await tx
      .insert(schema.maintenanceRequests)
      .values({ unitId: input.unitId, leaseId: lease?.leaseId ?? null, tenantId: null, reportedVia: "staff", title: input.title, description: input.description, priority: input.priority })
      .returning();
    await tx.insert(schema.maintenanceUpdates).values({ requestId: request!.id, status: "open", note: null });
    await audit(tx, { action: "maintenance.logged", entity: "maintenance_request", entityId: request!.id, after: { title: input.title, via: "staff" } });
    return request!.id;
  });
}

export async function listRequests(actor: Actor, opts: { status?: string; open?: boolean } = {}) {
  authorise(actor, "maintenance.manage");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const where: (SQL | undefined)[] = [];
    if (actor.role === "agent") {
      where.push(
        inArray(
          schema.units.propertyId,
          tx.select({ id: schema.agentPortfolios.propertyId }).from(schema.agentPortfolios).where(eq(schema.agentPortfolios.userId, actor.userId ?? "")),
        ),
      );
    }
    if (opts.status) where.push(eq(schema.maintenanceRequests.status, opts.status as Status));
    if (opts.open) where.push(inArray(schema.maintenanceRequests.status, ["open", "assigned", "in_progress"]));
    const rows = await tx
      .select({ request: schema.maintenanceRequests, unit: schema.units.label, property: schema.properties.name, contractor: schema.contractors.name })
      .from(schema.maintenanceRequests)
      .innerJoin(schema.units, eq(schema.units.id, schema.maintenanceRequests.unitId))
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .leftJoin(schema.contractors, eq(schema.contractors.id, schema.maintenanceRequests.contractorId))
      .where(and(...where))
      .orderBy(desc(schema.maintenanceRequests.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r, reference: jobReference(r.request.id) }));
  });
}

export async function getRequest(actor: Actor, requestId: string) {
  authorise(actor, "maintenance.manage");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const [request] = await tx.select().from(schema.maintenanceRequests).where(eq(schema.maintenanceRequests.id, requestId));
    if (!request) throw new NotFoundError("Maintenance request");
    await assertUnitInScope(tx, actor, request.unitId);
    const { unitName, address } = await unitDetails(tx, request.unitId);
    const updates = await tx
      .select({ update: schema.maintenanceUpdates, by: schema.users.name })
      .from(schema.maintenanceUpdates)
      .leftJoin(schema.users, eq(schema.users.id, schema.maintenanceUpdates.createdBy))
      .where(eq(schema.maintenanceUpdates.requestId, request.id))
      .orderBy(asc(schema.maintenanceUpdates.createdAt));
    const [tenant] = request.leaseId
      ? await tx
          .select({ name: schema.tenants.fullName, phone: schema.tenants.phone })
          .from(schema.leaseTenants)
          .innerJoin(schema.tenants, eq(schema.tenants.id, schema.leaseTenants.tenantId))
          .where(and(eq(schema.leaseTenants.leaseId, request.leaseId), eq(schema.leaseTenants.isPrimary, true)))
      : [];
    return { request, reference: jobReference(request.id), unitName, address, tenant: tenant ?? null, updates };
  });
}

export const updateSchema = z.object({
  status: z.enum(["open", "assigned", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["low", "normal", "urgent", "emergency"]),
  contractorId: z
    .string()
    .trim()
    .transform((s) => s || null)
    .pipe(z.uuid().nullable()),
  note: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => s || null),
  visibleToTenant: z.enum(["on", "off"]).default("off").transform((v) => v === "on"),
});
export type UpdateInput = z.infer<typeof updateSchema>;

/**
 * Moves a request on. A new contractor is emailed a job card; a status change
 * tells the tenant, with the note if it is meant for them.
 */
export async function updateRequest(actor: Actor, requestId: string, input: UpdateInput): Promise<void> {
  authorise(actor, "maintenance.manage");
  await withAgency(actor.ctx, async (tx) => {
    const [request] = await tx.select().from(schema.maintenanceRequests).where(eq(schema.maintenanceRequests.id, requestId)).for("update");
    if (!request) throw new NotFoundError("Maintenance request");
    await assertUnitInScope(tx, actor, request.unitId);
    if (request.status === "completed" || request.status === "cancelled") {
      if (input.status === request.status && !input.note) throw new MaintenanceError("This request is closed.");
    }
    let contractor: typeof schema.contractors.$inferSelect | undefined;
    if (input.contractorId) {
      [contractor] = await tx.select().from(schema.contractors).where(eq(schema.contractors.id, input.contractorId));
      if (!contractor || !contractor.active) throw new MaintenanceError("Choose an active contractor.");
    }
    // Assigning a contractor to a logged request moves it on
    const status: Status = input.status === "open" && input.contractorId ? "assigned" : input.status;
    const statusChanged = status !== request.status;
    const contractorChanged = (input.contractorId ?? null) !== request.contractorId;
    if (!statusChanged && !contractorChanged && input.priority === request.priority && !input.note) return;

    await tx
      .update(schema.maintenanceRequests)
      .set({
        status,
        priority: input.priority,
        contractorId: input.contractorId,
        completedAt: status === "completed" ? (request.completedAt ?? new Date()) : null,
      })
      .where(eq(schema.maintenanceRequests.id, request.id));
    const parts = [
      contractorChanged ? (contractor ? `Contractor: ${contractor.name}` : "Contractor removed") : null,
      input.priority !== request.priority ? `Priority: ${PRIORITY_LABEL[input.priority]}` : null,
      input.note,
    ].filter(Boolean);
    await tx.insert(schema.maintenanceUpdates).values({
      requestId: request.id,
      status: statusChanged ? status : null,
      note: parts.length ? parts.join(". ") : null,
      visibleToTenant: input.visibleToTenant || (statusChanged && !input.note),
    });
    await audit(tx, {
      action: "maintenance.updated",
      entity: "maintenance_request",
      entityId: request.id,
      before: { status: request.status, priority: request.priority, contractorId: request.contractorId },
      after: { status, priority: input.priority, contractorId: input.contractorId, note: input.note },
    });

    const { address } = await unitDetails(tx, request.unitId);
    const reference = jobReference(request.id);
    const lease = request.leaseId ? { leaseId: request.leaseId } : await currentLease(tx, request.unitId);
    const [tenant] = lease?.leaseId
      ? await tx
          .select({ id: schema.tenants.id, name: schema.tenants.fullName, phone: schema.tenants.phone })
          .from(schema.leaseTenants)
          .innerJoin(schema.tenants, eq(schema.tenants.id, schema.leaseTenants.tenantId))
          .where(and(eq(schema.leaseTenants.leaseId, lease.leaseId), eq(schema.leaseTenants.isPrimary, true)))
      : [];
    if (contractor && contractorChanged) {
      const contact = lease?.leaseId ? await leaseContact(tx, lease.leaseId) : { agent_name: "the agency", agent_phone: "" };
      await send(tx, {
        recipient: { kind: "contractor", contractorId: contractor.id },
        templateKey: "maintenance_job",
        leaseId: request.leaseId,
        variables: {
          title: request.title,
          priority: PRIORITY_LABEL[input.priority].toLowerCase(),
          address,
          description: request.description,
          // Shared to arrange access (D102)
          tenant: tenant?.name ?? "the occupant",
          tenant_phone: tenant?.phone ?? "(no number on record; contact the agent)",
          ...contact,
          reference,
        },
      });
    }
    const tenantId = request.tenantId ?? tenant?.id;
    if (statusChanged && tenantId) {
      await send(tx, {
        recipient: { kind: "tenant", tenantId },
        templateKey: "maintenance_update",
        leaseId: request.leaseId,
        variables: { title: request.title, status: `${STATUS_LABEL[status].toLowerCase()}${input.visibleToTenant && input.note ? `. ${input.note}` : ""}` },
      });
    }
  });
}

// ─── Contractors ───────────────────────────────────────────────────────

export const contractorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  trade: z
    .string()
    .trim()
    .max(60)
    .transform((s) => s || null),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .refine((s) => s === "" || z.email().safeParse(s).success, "Enter a valid email address")
    .transform((s) => s || null),
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((s) => s || null),
  notes: z
    .string()
    .trim()
    .max(1000)
    .transform((s) => s || null),
});
export type ContractorInput = z.infer<typeof contractorSchema>;

export async function listContractors(actor: Actor, opts: { activeOnly?: boolean } = {}) {
  authorise(actor, "maintenance.manage");
  return withAgency({ ...actor.ctx, readOnly: true }, (tx) =>
    tx
      .select()
      .from(schema.contractors)
      .where(opts.activeOnly ? eq(schema.contractors.active, true) : undefined)
      .orderBy(asc(schema.contractors.name)),
  );
}

export async function saveContractor(actor: Actor, contractorId: string | null, input: ContractorInput & { active?: boolean }): Promise<string> {
  authorise(actor, "maintenance.manage");
  return withAgency(actor.ctx, async (tx) => {
    if (!contractorId) {
      const [c] = await tx.insert(schema.contractors).values(input).returning({ id: schema.contractors.id });
      await audit(tx, { action: "contractor.created", entity: "contractor", entityId: c!.id, after: input });
      return c!.id;
    }
    const [before] = await tx.select().from(schema.contractors).where(eq(schema.contractors.id, contractorId));
    if (!before) throw new NotFoundError("Contractor");
    await tx.update(schema.contractors).set(input).where(eq(schema.contractors.id, contractorId));
    await audit(tx, { action: "contractor.updated", entity: "contractor", entityId: contractorId, before: { name: before.name, active: before.active }, after: input });
    return contractorId;
  });
}
