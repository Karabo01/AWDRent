import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb, schema, withAgency } from "@awdrent/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { monthStart, todayInSouthAfrica } from "../src/billing";
import { activateLease, createLease } from "../src/leases";
import { getRequest, listRequests, logRequest, MaintenanceError, portalLogRequest, portalRequests, saveContractor, updateRequest } from "../src/maintenance";
import { createOwner } from "../src/owners";
import { ensurePortalUser, type PortalActor } from "../src/portal";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit, setPropertyAgents } from "../src/properties";
import { inviteStaff } from "../src/staff";
import { createTenant } from "../src/tenants";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let agentA: Actor;
let otherAgentA: Actor;
let n = 0;

async function setup(actor: Actor) {
  const owner = await createOwner(actor, {
    kind: "individual",
    name: "Maint Owner",
    idKind: "sa_id",
    idOrRegNo: "",
    email: null,
    phone: null,
    postalAddress: null,
    commissionPercent: null,
    vatRegistered: false,
    vatNumber: null,
    notes: null,
  });
  const property = await createProperty(actor, {
    ownerId: owner,
    name: "Sunset Court",
    type: "apartment_block",
    addressLine1: "14 Jan Smuts Avenue",
    addressLine2: null,
    suburb: "Parktown",
    city: "Johannesburg",
    province: null,
    postalCode: null,
    notes: null,
  });
  const unitId = await createUnit(actor, property, { label: `Flat ${++n}`, bedrooms: 2, bathrooms: 1, status: "vacant", notes: null });
  const tenantId = await createTenant(actor, {
    fullName: "Ayanda Khumalo",
    idKind: "sa_id",
    idNumber: "",
    email: `ayanda${n}@example.test`,
    phone: "082 555 0201",
    employer: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    consentGiven: true,
    emailOptIn: true,
    smsOptIn: false,
    whatsappOptIn: false,
    notes: null,
  });
  const l = await createLease(actor, {
    unitId,
    primaryTenantId: tenantId,
    coTenantIds: [],
    startDate: monthStart(todayInSouthAfrica()),
    billingStartsOn: null,
    endDate: null,
    rent: 850_000,
    dueDay: 1,
    deposit: 0,
    escalationPercent: null,
    escalationDate: null,
    noticeDays: 30,
    notes: null,
  });
  await activateLease(actor, l.id);
  return { property, unitId, tenantId, leaseId: l.id };
}

const messages = (agencyId: string, key: string) =>
  withAgency({ agencyId }, (tx) => tx.select().from(schema.messages).where(eq(schema.messages.templateKey, key)));

beforeAll(async () => {
  await new S3Client({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
  })
    .send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }))
    .catch(() => undefined);
  a = await createAgencyWithAdmin("MaintA");
  b = await createAgencyWithAdmin("MaintB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  const agentId = await inviteStaff(adminA.ctx, { name: "Thabo Mokoena", email: `magent-${Date.now()}@a.test`, role: "agent", phone: "082 555 0123" });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
  const otherId = await inviteStaff(adminA.ctx, { name: "Other Agent", email: `mother-${Date.now()}@a.test`, role: "agent", phone: null });
  otherAgentA = { ctx: { agencyId: a.agency.id, userId: otherId }, role: "agent", userId: otherId };
});
afterAll(() => closeDb());

describe("maintenance", () => {
  it("goes from the tenant's report to the contractor's job card and back to the tenant", async () => {
    const s = await setup(adminA);
    await setPropertyAgents(adminA, s.property, [agentA.userId!]);
    const tenant: PortalActor = { ctx: { agencyId: a.agency.id, portalUserId: await ensurePortalUser(a.agency.id, s.tenantId) }, tenantId: s.tenantId };

    const { requestId, documentIds } = await portalLogRequest(tenant, {
      leaseId: s.leaseId,
      title: "Leaking geyser",
      description: "Water dripping through the bathroom ceiling",
      photos: [{ filename: "geyser.png", bytes: PNG }],
    });
    expect(documentIds).toHaveLength(1);
    // The portfolio agent is told
    expect((await messages(a.agency.id, "maintenance_new")).filter((m) => m.recipientId === agentA.userId)).toHaveLength(1);

    const plumber = await saveContractor(agentA, null, { name: "Joe's Plumbing", trade: "plumber", email: "joe@plumb.test", phone: "011 555 0000", notes: null });
    await updateRequest(agentA, requestId, { status: "open", priority: "urgent", contractorId: plumber, note: "Called the tenant", visibleToTenant: false });
    const view = await getRequest(agentA, requestId);
    expect(view.request).toMatchObject({ status: "assigned", priority: "urgent", contractorId: plumber });

    const [job] = (await messages(a.agency.id, "maintenance_job")).filter((m) => m.recipientId === plumber);
    expect(job).toMatchObject({ recipientKind: "contractor", toAddress: "joe@plumb.test", subject: `Job ${view.reference}: Leaking geyser at Flat ${n}, Sunset Court, 14 Jan Smuts Avenue, Parktown, Johannesburg` });
    expect(job!.body).toContain("contact the tenant, Ayanda Khumalo, on 082 555 0201");
    expect(job!.body).toContain("Please confirm with Thabo Mokoena on 082 555 0123");

    await updateRequest(agentA, requestId, { status: "completed", priority: "urgent", contractorId: plumber, note: "Geyser valve replaced", visibleToTenant: true });
    const tenantUpdates = (await messages(a.agency.id, "maintenance_update"))
      .filter((m) => m.recipientId === s.tenantId && m.channel === "email")
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
    expect(tenantUpdates.map((m) => m.body.split("\n")[2])).toEqual([
      'Update on your maintenance request "Leaking geyser": contractor assigned.',
      'Update on your maintenance request "Leaking geyser": completed. Geyser valve replaced.',
    ]);

    // The tenant sees the timeline without the internal note
    const [mine] = await portalRequests(tenant);
    expect(mine).toMatchObject({ id: requestId, status: "completed" });
    expect(mine!.updates.map((u) => u.note)).not.toContain("Contractor: Joe's Plumbing. Priority: Urgent. Called the tenant");
    expect(mine!.updates.at(-1)!.note).toBe("Geyser valve replaced");
  });

  it("keeps requests within the agent's portfolio and the agency", async () => {
    const s = await setup(adminA);
    await setPropertyAgents(adminA, s.property, [agentA.userId!]);
    const id = await logRequest(adminA, { unitId: s.unitId, title: "Broken window", description: "Lounge window cracked", priority: "normal" });
    expect((await listRequests(agentA)).some((r) => r.request.id === id)).toBe(true);
    expect((await listRequests(otherAgentA)).some((r) => r.request.id === id)).toBe(false);
    await expect(getRequest(otherAgentA, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRequest(adminB, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateRequest(adminA, id, { status: "open", priority: "normal", contractorId: crypto.randomUUID(), note: null, visibleToTenant: false })).rejects.toBeInstanceOf(
      MaintenanceError,
    );
    // A tenant cannot log a request on someone else's lease
    const other = await setup(adminA);
    const tenant: PortalActor = { ctx: { agencyId: a.agency.id, portalUserId: await ensurePortalUser(a.agency.id, other.tenantId) }, tenantId: other.tenantId };
    await expect(portalLogRequest(tenant, { leaseId: s.leaseId, title: "Not mine", description: "x x x", photos: [] })).rejects.toBeInstanceOf(NotFoundError);
    const [audit] = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "maintenance.logged"), eq(schema.auditLog.entityId, id))),
    );
    expect(audit).toBeDefined();
  });
});
