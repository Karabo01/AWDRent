import { closeDb, schema, withAgency, withPlatform } from "@awdrent/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { dueDateFor, monthStart, todayInSouthAfrica } from "../src/billing";
import { activateLease, createLease } from "../src/leases";
import { addDays, pauseReminders, resumeReminders, runDailyNotices } from "../src/notices";
import { createOwner } from "../src/owners";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit, setPropertyAgents } from "../src/properties";
import { inviteStaff } from "../src/staff";
import { createTenant } from "../src/tenants";

let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let agentA: Actor;
let otherAgentA: Actor;
let n = 0;
// The first rent of a lease starting this month is due on the 1st
const due = dueDateFor(monthStart(todayInSouthAfrica()), 1);

async function lease(actor: Actor, opts: { endDate?: string; ownerEmail?: string | null; agent?: Actor } = {}) {
  const owner = await createOwner(actor, {
    kind: "individual",
    name: "Pieter van Wyk",
    idKind: "sa_id",
    idOrRegNo: "",
    email: opts.ownerEmail === undefined ? "owner@example.test" : opts.ownerEmail,
    phone: null,
    postalAddress: null,
    commissionPercent: 1000,
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
    suburb: null,
    city: "Johannesburg",
    province: null,
    postalCode: null,
    notes: null,
  });
  if (opts.agent) await setPropertyAgents(actor, property, [opts.agent.userId!]);
  const unitId = await createUnit(actor, property, { label: `Flat ${++n}`, bedrooms: 2, bathrooms: 1, status: "vacant", notes: null });
  const tenantId = await createTenant(actor, {
    fullName: "Ayanda Khumalo",
    idKind: "sa_id",
    idNumber: "",
    email: "ayanda@example.test",
    phone: "0821234567",
    employer: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    consentGiven: true,
    emailOptIn: true,
    smsOptIn: true,
    whatsappOptIn: false,
    notes: null,
  });
  const l = await createLease(actor, {
    unitId,
    primaryTenantId: tenantId,
    coTenantIds: [],
    startDate: due,
    billingStartsOn: null,
    endDate: opts.endDate ?? null,
    rent: 850_000,
    dueDay: 1,
    deposit: 0,
    escalationPercent: null,
    escalationDate: null,
    noticeDays: 30,
    notes: null,
  });
  await activateLease(actor, l.id);
  return l.id;
}

const messages = (agencyId: string, leaseId: string) =>
  withAgency({ agencyId }, (tx) => tx.select().from(schema.messages).where(eq(schema.messages.leaseId, leaseId)));

beforeAll(async () => {
  a = await createAgencyWithAdmin("NoticeA");
  b = await createAgencyWithAdmin("NoticeB");
  await withPlatform((tx) => tx.update(schema.agencies).set({ quietHoursStart: "00:00", quietHoursEnd: "00:00" }).where(eq(schema.agencies.id, a.agency.id)));
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  const agentId = await inviteStaff(adminA.ctx, { name: "Thabo Mokoena", email: `nagent-${Date.now()}@a.test`, role: "agent", phone: "082 555 0123" });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
  const otherId = await inviteStaff(adminA.ctx, { name: "Other Agent", email: `nother-${Date.now()}@a.test`, role: "agent", phone: null });
  otherAgentA = { ctx: { agencyId: a.agency.id, userId: otherId }, role: "agent", userId: otherId };
});
afterAll(() => closeDb());

describe("daily notices", () => {
  it("escalates arrears once per stage: tenant at 7 days with a copy to the agent, staff at 14", async () => {
    const id = await lease(adminA, { agent: agentA });
    expect((await runDailyNotices(a.agency.id, addDays(due, 8))).failed).toBe(0);
    let rows = await messages(a.agency.id, id);
    const overdue7 = rows.filter((m) => m.templateKey === "overdue_7");
    expect(overdue7.map((m) => `${m.recipientKind}:${m.channel}`).sort()).toEqual(["staff:email", "tenant:email", "tenant:sms"]);
    const tenantSms = overdue7.find((m) => m.channel === "sms")!;
    expect(tenantSms.body).toMatch(/^Your account is R8 500,00 in arrears\. Please contact Thabo Mokoena urgently on 082 555 0123\./);
    const copy = overdue7.find((m) => m.recipientKind === "staff")!;
    expect(copy.subject).toBe("Copy: Your account is in arrears");
    expect(copy.body).toMatch(/^This message was sent to Ayanda Khumalo \(Flat \d+, Sunset Court\):\n\nHi Ayanda,/);

    // Running again the same day, or later in the same stage, sends nothing more
    await runDailyNotices(a.agency.id, addDays(due, 8));
    await runDailyNotices(a.agency.id, addDays(due, 10));
    expect((await messages(a.agency.id, id)).length).toBe(rows.length);

    await runDailyNotices(a.agency.id, addDays(due, 15));
    rows = await messages(a.agency.id, id);
    const internal = rows.filter((m) => m.templateKey === "overdue_14");
    // The portfolio agent and the admin; never the tenant
    expect(internal.map((m) => m.recipientId).sort()).toEqual([a.admin.id, agentA.userId].sort());
    expect(internal[0]!.body).toMatch(/^Internal alert: Ayanda Khumalo at Flat \d+, Sunset Court is R8 500,00 in arrears/);
  });

  it("does not chase a paused lease, and resumes when the pause is lifted", async () => {
    const id = await lease(adminA, { agent: agentA });
    await pauseReminders(agentA, id, { reason: "Paying in two parts", until: null }, due);
    await runDailyNotices(a.agency.id, addDays(due, 2));
    expect((await messages(a.agency.id, id)).filter((m) => m.templateKey.startsWith("overdue"))).toEqual([]);
    await resumeReminders(agentA, id);
    await runDailyNotices(a.agency.id, addDays(due, 2));
    expect((await messages(a.agency.id, id)).some((m) => m.templateKey === "overdue_1")).toBe(true);

    const [entry] = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "lease.reminders_paused"), eq(schema.auditLog.entityId, id))),
    );
    expect(entry!.after).toEqual({ reason: "Paying in two parts", until: null });
  });

  it("lets only staff who can see the lease pause it, from today on", async () => {
    const id = await lease(adminA, { agent: agentA });
    await expect(pauseReminders(otherAgentA, id, { reason: "Not mine", until: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(pauseReminders(adminA, id, { reason: "Arrangement", until: "2000-01-01" })).rejects.toThrow(/until today or later/);
  });

  it("warns tenant, owner and agent before the lease ends, by email for owners and staff", async () => {
    const id = await lease(adminA, { endDate: addDays(due, 120), agent: agentA });
    const today = addDays(due, 120 - 45);
    await runDailyNotices(a.agency.id, today);
    const expiry = (await messages(a.agency.id, id)).filter((m) => m.templateKey === "lease_expiry");
    expect(expiry.map((m) => `${m.recipientKind}:${m.channel}`).sort()).toEqual(["owner:email", "staff:email", "tenant:email"]);
    expect(expiry.find((m) => m.recipientKind === "owner")!.body).toMatch(/^Hi Pieter,\n\nThe lease for Flat \d+, Sunset Court ends on/);
  });

  it("logs an owner without an email address as not sent", async () => {
    const id = await lease(adminA, { endDate: addDays(due, 100), ownerEmail: null });
    await runDailyNotices(a.agency.id, addDays(due, 50));
    const owner = (await messages(a.agency.id, id)).find((m) => m.templateKey === "lease_expiry" && m.recipientKind === "owner");
    expect(owner).toMatchObject({ status: "suppressed", error: "No email address" });
  });

  it("keeps each agency's notices to itself", async () => {
    const id = await lease(adminA);
    await runDailyNotices(b.agency.id, addDays(due, 3));
    expect(await messages(a.agency.id, id)).toEqual([]);
    expect(await withAgency({ agencyId: b.agency.id }, (tx) => tx.select().from(schema.scheduledNotices).where(eq(schema.scheduledNotices.leaseId, id)))).toEqual([]);
    await runDailyNotices(a.agency.id, addDays(due, 3));
    expect((await messages(a.agency.id, id)).length).toBeGreaterThan(0);
    expect(await withAgency({ agencyId: b.agency.id }, (tx) => tx.select().from(schema.scheduledNotices))).toEqual([]);
  });
});
