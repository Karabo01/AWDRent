import { closeDb } from "@awdrent/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { addMonths, monthStart, todayInSouthAfrica } from "../src/billing";
import { activateLease, createLease } from "../src/leases";
import { createOwner } from "../src/owners";
import { ForbiddenError } from "../src/permissions";
import type { Actor } from "../src/portfolio";
import { createProperty, createUnit, setPropertyAgents } from "../src/properties";
import { ageingBucket, arrearsAgeing, collections, expiringLeases, exportCsv, occupancy } from "../src/reports";
import { inviteStaff } from "../src/staff";
import { createTenant } from "../src/tenants";

const today = todayInSouthAfrica();
const twoMonthsAgo = addMonths(monthStart(today), -2);
const daysSince = (iso: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let agentA: Actor;
let property: string;
let n = 0;

async function lease(actor: Actor, opts: { endDate?: string | null; propertyId?: string } = {}) {
  const unitId = await createUnit(actor, opts.propertyId ?? property, { label: `Flat ${++n}`, bedrooms: 1, bathrooms: 1, status: "vacant", notes: null });
  const tenantId = await createTenant(actor, {
    fullName: `Tenant ${n}`,
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
    startDate: twoMonthsAgo,
    billingStartsOn: null,
    endDate: opts.endDate ?? null,
    rent: 500_000,
    dueDay: 1,
    deposit: 0,
    escalationPercent: null,
    escalationDate: null,
    noticeDays: 30,
    notes: null,
  });
  await activateLease(actor, l.id);
  return l;
}

beforeAll(async () => {
  a = await createAgencyWithAdmin("RepA");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  const agentId = await inviteStaff(adminA.ctx, { name: "Report Agent", email: `ragent-${Date.now()}@a.test`, role: "agent", phone: null });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
  const owner = await createOwner(adminA, {
    kind: "individual",
    name: "Report Owner",
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
  property = await createProperty(adminA, {
    ownerId: owner,
    name: "Report Court",
    type: "apartment_block",
    addressLine1: "1 Report Road",
    addressLine2: null,
    suburb: null,
    city: "Durban",
    province: null,
    postalCode: null,
    notes: null,
  });
});
afterAll(() => closeDb());

describe("reports", () => {
  it("puts overdue amounts in ageing buckets by days overdue", () => {
    expect([1, 30, 31, 60, 61, 90, 91].map(ageingBucket)).toEqual(["current", "current", "d30", "d30", "d60", "d60", "d90"]);
  });

  it("ages each lease's unpaid charges, oldest first", async () => {
    const l = await lease(adminA);
    const { rows } = await arrearsAgeing(adminA);
    const row = rows.find((r) => r.leaseId === l.id)!;
    const expected = { current: 0, d30: 0, d60: 0, d90: 0 };
    for (const m of [0, 1, 2]) {
      const due = addMonths(monthStart(today), -m);
      if (due < today) expected[ageingBucket(daysSince(due))] += 500_000;
    }
    expect(row.buckets).toEqual(expected);
    expect(row.total).toBe(Object.values(expected).reduce((s, v) => s + v, 0));
  });

  it("reports occupancy, leases ending soon and this month's collections", async () => {
    const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 20 * 86_400_000).toISOString().slice(0, 10);
    const l = await lease(adminA, { endDate: soon });
    const expiring = await expiringLeases(adminA);
    expect(expiring.find((e) => e.leaseId === l.id)).toMatchObject({ within: 30, endDate: soon });
    const occ = await occupancy(adminA);
    expect(occ.total).toBeGreaterThanOrEqual(2);
    expect(occ.counts.occupied).toBeGreaterThanOrEqual(2);
    const col = await collections(adminA);
    expect(col.dueCents).toBeGreaterThanOrEqual(1_000_000);
    expect(col.receivedCents).toBe(0);
  });

  it("limits agents to their portfolio and keeps exports for admins and accounts", async () => {
    expect((await arrearsAgeing(agentA)).rows).toEqual([]);
    const other = await createProperty(adminA, {
      ownerId: (await createOwner(adminA, { kind: "individual", name: "O2", idKind: "sa_id", idOrRegNo: "", email: null, phone: null, postalAddress: null, commissionPercent: null, vatRegistered: false, vatNumber: null, notes: null })),
      name: "Agent Court",
      type: "house",
      addressLine1: "2 Report Road",
      addressLine2: null,
      suburb: null,
      city: "Durban",
      province: null,
      postalCode: null,
      notes: null,
    });
    await setPropertyAgents(adminA, other, [agentA.userId!]);
    const mine = await lease(adminA, { propertyId: other });
    expect((await arrearsAgeing(agentA)).rows.map((r) => r.leaseId)).toEqual([mine.id]);
    await expect(exportCsv(agentA, "transactions", { from: twoMonthsAgo, to: today })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("exports transactions and arrears as CSV", async () => {
    const { csv, filename } = await exportCsv(adminA, "transactions", { from: twoMonthsAgo, to: today });
    expect(filename).toBe(`TT transactions ${twoMonthsAgo} to ${today}.csv`);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Date,Kind,Type,Lease reference,Tenant,Description or reference,Debit,Credit,Status");
    expect(lines.slice(1).every((l) => /^\d{4}-\d{2}-\d{2},(charge|payment),/.test(l))).toBe(true);
    expect(lines.some((l) => l.includes(",charge,rent,") && l.includes(",5000.00,"))).toBe(true);
    const arrears = await exportCsv(adminA, "arrears", { from: today, to: today });
    expect(arrears.csv.split("\r\n")[0]).toContain("Total overdue");
  });
});
