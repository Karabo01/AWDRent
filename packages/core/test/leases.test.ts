import { closeDb, schema, withAgency } from "@awdrent/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { claimImportedReference } from "../src/eft";
import {
  activateLease,
  applyEscalation,
  createLease,
  escalatedRent,
  getLease,
  giveNotice,
  type LeaseCreateInput,
  LeaseRuleError,
  renewLease,
  setLeaseTenants,
  terminateLease,
} from "../src/leases";
import { createOwner } from "../src/owners";
import { ForbiddenError } from "../src/permissions";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit, getProperty, setPropertyAgents } from "../src/properties";
import { inviteStaff } from "../src/staff";
import { createTenant, revealTenantIdNumber, type TenantInput } from "../src/tenants";

let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let agentA: Actor;
let accountsA: Actor;

const tenant = (fullName: string, extra: Partial<TenantInput> = {}): TenantInput => ({
  fullName,
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
  ...extra,
});

async function newUnit(actor: Actor, label = "Flat 1") {
  const owner = await createOwner(actor, {
    kind: "individual",
    name: `Owner ${Math.random()}`,
    idKind: "sa_id",
    idOrRegNo: "",
    email: null,
    phone: null,
    postalAddress: null,
    commissionPercent: 1000,
    vatRegistered: false,
    vatNumber: null,
    notes: null,
  });
  const property = await createProperty(actor, {
    ownerId: owner,
    name: `Block ${Math.random()}`,
    type: "apartment_block",
    addressLine1: "1 Long Street",
    addressLine2: null,
    suburb: null,
    city: "Cape Town",
    province: null,
    postalCode: null,
    notes: null,
  });
  const unitId = await createUnit(actor, property, { label, bedrooms: 1, bathrooms: 1, status: "vacant", notes: null });
  return { property, unitId };
}

function lease(unitId: string, primaryTenantId: string, extra: Partial<LeaseCreateInput> = {}): LeaseCreateInput {
  return {
    unitId,
    primaryTenantId,
    coTenantIds: [],
    startDate: "2026-11-01",
    billingStartsOn: null,
    endDate: "2027-10-31",
    rent: 750_000,
    dueDay: 1,
    deposit: 1_500_000,
    escalationPercent: 800,
    escalationDate: "2027-11-01",
    noticeDays: 30,
    notes: null,
    ...extra,
  };
}

async function unitStatus(actor: Actor, propertyId: string) {
  return (await getProperty(actor, propertyId)).units[0]?.status;
}

beforeAll(async () => {
  a = await createAgencyWithAdmin("LeaseA");
  b = await createAgencyWithAdmin("LeaseB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  const agentId = await inviteStaff(adminA.ctx, { name: "Lease Agent", email: `la-${Date.now()}@a.test`, role: "agent", phone: null });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
  const accId = await inviteStaff(adminA.ctx, { name: "Lease Acc", email: `lacc-${Date.now()}@a.test`, role: "accounts", phone: null });
  accountsA = { ctx: { agencyId: a.agency.id, userId: accId }, role: "accounts", userId: accId };
});
afterAll(() => closeDb());

describe("EFT references", () => {
  it("numbers each agency's leases from its own sequence", async () => {
    const { unitId } = await newUnit(adminA);
    const t = await createTenant(adminA, tenant("Seq Tenant"));
    const first = await createLease(adminA, lease(unitId, t));
    const second = await createLease(adminA, lease(unitId, t));
    expect(first.eftReference).toMatch(/^TT-\d{4}$/);
    expect(Number(second.eftReference.slice(3))).toBe(Number(first.eftReference.slice(3)) + 1);

    const { unitId: unitB } = await newUnit(adminB);
    const tb = await createTenant(adminB, tenant("Other Agency Tenant"));
    expect((await createLease(adminB, lease(unitB, tb))).eftReference).toBe("TT-0001");
  });

  it("never hands out the same reference twice under concurrency", async () => {
    const { unitId } = await newUnit(adminA);
    const t = await createTenant(adminA, tenant("Busy Tenant"));
    const refs = await Promise.all(Array.from({ length: 12 }, () => createLease(adminA, lease(unitId, t))));
    expect(new Set(refs.map((r) => r.eftReference)).size).toBe(12);
  });

  it("skips past imported references with the agency's prefix (D4)", async () => {
    await withAgency(adminA.ctx, (tx) => claimImportedReference(tx, a.agency.id, "TT-0500"));
    const { unitId } = await newUnit(adminA);
    const t = await createTenant(adminA, tenant("After Import"));
    expect((await createLease(adminA, lease(unitId, t))).eftReference).toBe("TT-0501");
  });
});

describe("lease lifecycle", () => {
  it("activates, gives notice, renews on the same reference, and terminates", async () => {
    const { property, unitId } = await newUnit(adminA);
    const t = await createTenant(adminA, tenant("Lifecycle Tenant"));
    const { id, eftReference } = await createLease(adminA, lease(unitId, t));
    expect(await unitStatus(adminA, property)).toBe("vacant");

    await activateLease(adminA, id);
    expect(await unitStatus(adminA, property)).toBe("occupied");

    await giveNotice(adminA, id, { noticeDate: "2027-08-01", endDate: "2027-10-31", note: "" });
    expect(await unitStatus(adminA, property)).toBe("notice_given");

    await renewLease(adminA, id, {
      newEndDate: "2028-10-31",
      newRent: 810_000,
      escalationPercent: null,
      escalationDate: null,
      effectiveDate: "2027-11-01",
    });
    const renewed = await getLease(adminA, id);
    expect(renewed.lease).toMatchObject({ status: "active", eftReference, rentCents: 810_000, endDate: "2028-10-31", noticeGivenOn: null });
    expect(await unitStatus(adminA, property)).toBe("occupied");

    await terminateLease(adminA, id, { terminatedOn: "2028-03-31", reason: "Mutual agreement" });
    expect(await unitStatus(adminA, property)).toBe("vacant");
    const events = (await getLease(adminA, id)).events.map((e) => e.event.type);
    expect(events).toEqual(["terminated", "renewed", "notice_given", "activated", "created"]);
  });

  it("refuses two live leases on a unit for overlapping dates, but allows drafts", async () => {
    const { unitId } = await newUnit(adminA);
    const t = await createTenant(adminA, tenant("Overlap Tenant"));
    const first = await createLease(adminA, lease(unitId, t));
    const second = await createLease(adminA, lease(unitId, t, { startDate: "2027-06-01", endDate: "2028-05-31" }));
    await activateLease(adminA, first.id);
    await expect(activateLease(adminA, second.id)).rejects.toBeInstanceOf(LeaseRuleError);
    const next = await createLease(adminA, lease(unitId, t, { startDate: "2027-11-01", endDate: "2028-10-31" }));
    await activateLease(adminA, next.id);
  });

  it("escalates rent with integer rounding and moves the date a year", async () => {
    expect(escalatedRent(750_000, 800)).toBe(810_000);
    expect(escalatedRent(123_457, 750)).toBe(132_716); // 132716.275 → 132716
    expect(escalatedRent(100_001, 5_000)).toBe(150_002); // 150001.5 → 150002
    const { unitId } = await newUnit(adminA);
    const t = await createTenant(adminA, tenant("Escalation Tenant"));
    const { id } = await createLease(adminA, lease(unitId, t));
    await activateLease(adminA, id);
    await applyEscalation(adminA, id);
    expect((await getLease(adminA, id)).lease).toMatchObject({ rentCents: 810_000, escalationDate: "2028-11-01" });
  });

  it("keeps lease history append-only", async () => {
    const { unitId } = await newUnit(adminA);
    const t = await createTenant(adminA, tenant("History Tenant"));
    const { id } = await createLease(adminA, lease(unitId, t));
    const code = await withAgency(adminA.ctx, (tx) =>
      tx.update(schema.leaseEvents).set({ note: "rewritten" }).where(eq(schema.leaseEvents.leaseId, id)),
    ).catch((e: { cause?: { code?: string } }) => e.cause?.code);
    expect(code).toBe("42501");
  });

  it("only changes tenants on a draft", async () => {
    const { unitId } = await newUnit(adminA);
    const t1 = await createTenant(adminA, tenant("Draft One"));
    const t2 = await createTenant(adminA, tenant("Draft Two"));
    const { id } = await createLease(adminA, lease(unitId, t1));
    await setLeaseTenants(adminA, id, t2, [t1]);
    expect((await getLease(adminA, id)).tenants.map((t) => [t.fullName, t.isPrimary])).toEqual([
      ["Draft Two", true],
      ["Draft One", false],
    ]);
    await activateLease(adminA, id);
    await expect(setLeaseTenants(adminA, id, t1, [])).rejects.toBeInstanceOf(LeaseRuleError);
  });
});

describe("leases across agencies and portfolios", () => {
  it("cannot put another agency's tenant or unit on a lease", async () => {
    const { unitId } = await newUnit(adminA);
    const { unitId: unitB } = await newUnit(adminB);
    const tA = await createTenant(adminA, tenant("Alpha Tenant"));
    const tB = await createTenant(adminB, tenant("Bravo Tenant"));
    await expect(createLease(adminA, lease(unitId, tB))).rejects.toBeInstanceOf(NotFoundError);
    await expect(createLease(adminA, lease(unitB, tA))).rejects.toBeInstanceOf(NotFoundError);
    const { id } = await createLease(adminA, lease(unitId, tA));
    const code = await withAgency(adminA.ctx, (tx) =>
      tx.insert(schema.leaseTenants).values({ leaseId: id, tenantId: tB, isPrimary: false }),
    ).catch((e: { cause?: { code?: string } }) => e.cause?.code);
    expect(code).toBe("23503");
    await expect(getLease(adminB, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("limits agents to leases on their portfolio's units", async () => {
    const mine = await newUnit(adminA);
    const theirs = await newUnit(adminA);
    await setPropertyAgents(adminA, mine.property, [agentA.userId!]);
    const t = await createTenant(agentA, tenant("Agent's Tenant"));
    const { id } = await createLease(agentA, lease(mine.unitId, t));
    await expect(createLease(agentA, lease(theirs.unitId, t))).rejects.toBeInstanceOf(NotFoundError);
    const other = await createLease(adminA, lease(theirs.unitId, await createTenant(adminA, tenant("Not Agent's"))));
    await expect(getLease(agentA, other.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getLease(agentA, id)).lease.id).toBe(id);
  });

  it("lets admins and the tenant's agent reveal ID numbers, audited; not accounts", async () => {
    const t = await createTenant(agentA, tenant("ID Tenant", { idNumber: "8001015009087" }));
    expect(await revealTenantIdNumber(agentA, t)).toBe("8001015009087");
    expect(await revealTenantIdNumber(adminA, t)).toBe("8001015009087");
    await expect(revealTenantIdNumber(accountsA, t)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revealTenantIdNumber(adminB, t)).rejects.toBeInstanceOf(NotFoundError);
    const reveals = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, "tenant.id_number_revealed")),
    );
    expect(reveals.filter((r) => r.entityId === t)).toHaveLength(2);
  });
});

describe("list summaries", () => {
  it("shows each tenant's current lease and each lease's main tenant", async () => {
    const { listTenants } = await import("../src/tenants");
    const { listLeases } = await import("../src/leases");
    const { unitId } = await newUnit(adminA);
    const main = await createTenant(adminA, tenant("Summary Main"));
    const co = await createTenant(adminA, tenant("Summary Co"));
    const { id, eftReference } = await createLease(adminA, lease(unitId, main, { coTenantIds: [co] }));
    await activateLease(adminA, id);
    const tenants = await listTenants(adminA, { q: "Summary" });
    expect(Object.fromEntries(tenants.map((t) => [t.fullName, t.currentLease]))).toEqual({
      "Summary Main": eftReference,
      "Summary Co": eftReference,
    });
    const leases = await listLeases(adminA, { q: eftReference });
    expect(leases.map((l) => l.primaryTenant)).toEqual(["Summary Main"]);
  });
});

describe("usage snapshot", () => {
  it("counts units with live leases and lets the platform read it", async () => {
    const { snapshotUsage } = await import("../src/usage");
    const { withPlatform } = await import("@awdrent/db");
    const c = await createAgencyWithAdmin("Usage");
    const admin: Actor = { ctx: { agencyId: c.agency.id, userId: c.admin.id }, role: "admin", userId: c.admin.id };
    const u1 = await newUnit(admin);
    const u2 = await newUnit(admin, "Flat 2");
    const t = await createTenant(admin, tenant("Usage Tenant"));
    await activateLease(admin, (await createLease(admin, lease(u1.unitId, t))).id);
    await createLease(admin, lease(u2.unitId, t)); // draft: not counted
    expect(await snapshotUsage(c.agency.id)).toBe(1);
    expect(await snapshotUsage(c.agency.id)).toBe(1); // idempotent per month
    const rows = await withPlatform((tx) => tx.select().from(schema.usageCounters).where(eq(schema.usageCounters.agencyId, c.agency.id)));
    expect(rows.map((r) => r.activeUnits)).toEqual([1]);
  });
});
