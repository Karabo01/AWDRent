import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb } from "@awdrent/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { monthStart, todayInSouthAfrica } from "../src/billing";
import { activateLease, createLease } from "../src/leases";
import { logRequest } from "../src/maintenance";
import { type OwnerActor, ownerMaintenance, ownerProperties, ownerStatements, ownerStatementUrl } from "../src/owner-portal";
import { createOwner, OwnerPortalError, setOwnerPortal } from "../src/owners";
import { ensureOwnerPortalUser, findSignInTarget, portalOwner, portalUser } from "../src/portal";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit } from "../src/properties";
import { createTenant } from "../src/tenants";

let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let n = 0;

async function owner(actor: Actor, email: string | null, phone: string | null = null) {
  return createOwner(actor, {
    kind: "individual",
    name: `Owner ${++n}`,
    idKind: "sa_id",
    idOrRegNo: "",
    email,
    phone,
    postalAddress: null,
    commissionPercent: null,
    vatRegistered: false,
    vatNumber: null,
    notes: null,
  });
}

async function letUnit(actor: Actor, ownerId: string) {
  const property = await createProperty(actor, {
    ownerId,
    name: `House ${++n}`,
    type: "house",
    addressLine1: "1 Oak Street",
    addressLine2: null,
    suburb: null,
    city: "Pretoria",
    province: null,
    postalCode: null,
    notes: null,
  });
  const unitId = await createUnit(actor, property, { label: "Main", bedrooms: 3, bathrooms: 2, status: "vacant", notes: null });
  const tenantId = await createTenant(actor, {
    fullName: "Lindiwe Nkosi",
    idKind: "sa_id",
    idNumber: "",
    email: null,
    phone: null,
    employer: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    consentGiven: true,
    emailOptIn: false,
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
    rent: 1_200_000,
    dueDay: 1,
    deposit: 0,
    escalationPercent: null,
    escalationDate: null,
    noticeDays: 30,
    notes: null,
  });
  await activateLease(actor, l.id);
  return { unitId, leaseId: l.id };
}

beforeAll(async () => {
  await new S3Client({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
  })
    .send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }))
    .catch(() => undefined);
  a = await createAgencyWithAdmin("OwnPA");
  b = await createAgencyWithAdmin("OwnPB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
});
afterAll(() => closeDb());

describe("owner portal", () => {
  it("lets an owner in only once staff switch it on, and only as an owner", async () => {
    const email = `owner${Date.now()}@example.test`;
    const id = await owner(adminA, email);
    expect(await findSignInTarget(a.agency.id, { kind: "email", value: email }, "owner")).toBeNull();
    await setOwnerPortal(adminA, id, true);
    expect(await findSignInTarget(a.agency.id, { kind: "email", value: email }, "owner")).toMatchObject({ kind: "owner", partyId: id, channel: "email" });
    // The same address is not a tenant login
    expect(await findSignInTarget(a.agency.id, { kind: "email", value: email }, "tenant")).toBeNull();
    // Nor an owner at another agency
    expect(await findSignInTarget(b.agency.id, { kind: "email", value: email }, "owner")).toBeNull();

    const portalUserId = await ensureOwnerPortalUser(a.agency.id, id);
    expect(await portalOwner(a.agency.id, portalUserId)).toMatchObject({ owner: { id } });
    expect(await portalUser(a.agency.id, portalUserId)).toBeNull();
    // Switching it off ends access at once
    await setOwnerPortal(adminA, id, false);
    expect(await portalOwner(a.agency.id, portalUserId)).toBeNull();
    await expect(ensureOwnerPortalUser(a.agency.id, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("needs a way to send the code", async () => {
    const id = await owner(adminA, null);
    await expect(setOwnerPortal(adminA, id, true)).rejects.toBeInstanceOf(OwnerPortalError);
  });

  it("shows the owner only their own properties, leases, statements and maintenance", async () => {
    const mine = await owner(adminA, `m${Date.now()}@example.test`);
    const theirs = await owner(adminA, `t${Date.now()}@example.test`);
    await setOwnerPortal(adminA, mine, true);
    const unit = await letUnit(adminA, mine);
    const other = await letUnit(adminA, theirs);
    await logRequest(adminA, { unitId: unit.unitId, title: "Gutter loose", description: "Front gutter hanging", priority: "low" });
    await logRequest(adminA, { unitId: other.unitId, title: "Not theirs", description: "x x x", priority: "low" });
    const actor: OwnerActor = { ctx: { agencyId: a.agency.id, portalUserId: await ensureOwnerPortalUser(a.agency.id, mine) }, ownerId: mine };

    const props = await ownerProperties(actor);
    expect(props).toHaveLength(1);
    expect(props[0]!.units[0]!.lease).toMatchObject({ tenants: ["Lindiwe Nkosi"], rentCents: 1_200_000 });
    expect((await ownerMaintenance(actor)).map((m) => m.title)).toEqual(["Gutter loose"]);
    expect(await ownerStatements(actor)).toEqual([]);
    await expect(ownerStatementUrl(actor, crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});
