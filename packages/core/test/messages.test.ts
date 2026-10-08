import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb, schema, withAgency, withPlatform } from "@awdrent/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { monthStart, todayInSouthAfrica } from "../src/billing";
import { activateLease, createLease } from "../src/leases";
import {
  deliverDue,
  listMessages,
  listTemplates,
  optOut,
  optOutStatus,
  recordDelivery,
  resetWording,
  saveWording,
  send,
  WordingError,
} from "../src/messages";
import { type OutgoingEmail, type OutgoingSms, PermanentSendError, type Providers } from "../src/messaging/providers";
import { createOwner } from "../src/owners";
import { ForbiddenError } from "../src/permissions";
import { rejectPop, submitPop } from "../src/pops";
import type { Actor } from "../src/portfolio";
import { createProperty, createUnit, setPropertyAgents } from "../src/properties";
import { inviteStaff } from "../src/staff";
import { createTenant } from "../src/tenants";

const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const today = todayInSouthAfrica();
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let agentA: Actor;
let n = 0;

/** Records what was "sent"; fails SMS while `failSms` says so. */
function fakeProviders(opts: { failSms?: "retry" | "permanent" } = {}) {
  const emails: OutgoingEmail[] = [];
  const sms: OutgoingSms[] = [];
  const providers: Providers = {
    email: async (m) => {
      emails.push(m);
      return { provider: "resend", providerId: `re-${m.messageId}` };
    },
    sms: async (m) => {
      if (opts.failSms === "permanent") throw new PermanentSendError("Invalid destination address");
      if (opts.failSms === "retry") throw new Error("Clickatell 503: try later");
      sms.push(m);
      return { provider: "clickatell", providerId: `ct-${m.messageId}` };
    },
  };
  return { providers, emails, sms };
}

async function tenantOnLease(actor: Actor, contact: { email?: string | null; phone?: string | null; emailOptIn?: boolean; smsOptIn?: boolean; name?: string }) {
  const owner = await createOwner(actor, {
    kind: "individual",
    name: "Msg Owner",
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
  const unitId = await createUnit(actor, property, { label: `Flat ${++n}`, bedrooms: 2, bathrooms: 1, status: "vacant", notes: null });
  const tenantId = await createTenant(actor, {
    fullName: contact.name ?? "Ayanda Khumalo",
    idKind: "sa_id",
    idNumber: "",
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    employer: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    consentGiven: true,
    emailOptIn: contact.emailOptIn ?? true,
    smsOptIn: contact.smsOptIn ?? false,
    whatsappOptIn: false,
    notes: null,
  });
  const l = await createLease(actor, {
    unitId,
    primaryTenantId: tenantId,
    coTenantIds: [],
    startDate: monthStart(today),
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
  return { leaseId: l.id, tenantId, property, eftReference: l.eftReference };
}

const rows = (agencyId: string, leaseId: string) =>
  withAgency({ agencyId }, (tx) => tx.select().from(schema.messages).where(eq(schema.messages.leaseId, leaseId)));

/** Makes queued messages due now (as if the backoff had passed). */
const makeDue = (agencyId: string) =>
  withAgency({ agencyId }, (tx) => tx.update(schema.messages).set({ nextAttemptAt: new Date(0) }).where(eq(schema.messages.status, "queued")));

const sendRentToday = (agencyId: string, t: { leaseId: string; tenantId: string }) =>
  withAgency({ agencyId }, (tx) =>
    send(tx, {
      recipient: { kind: "tenant", tenantId: t.tenantId },
      templateKey: "rent_due_today",
      leaseId: t.leaseId,
      variables: { amount: "8 500,00", eft_ref: "TT-0001", portal_link: "https://x.test/p" },
    }),
  );

beforeAll(async () => {
  await new S3Client({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
  })
    .send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }))
    .catch(() => undefined);
  a = await createAgencyWithAdmin("MsgA");
  b = await createAgencyWithAdmin("MsgB");
  // No quiet hours, so the tests do not depend on the time of day they run
  await withPlatform((tx) =>
    tx.update(schema.agencies).set({ quietHoursStart: "00:00", quietHoursEnd: "00:00", smsSenderName: "MsgA" }).where(eq(schema.agencies.id, a.agency.id)),
  );
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  const agentId = await inviteStaff(adminA.ctx, { name: "Thabo Mokoena", email: `magent-${Date.now()}@a.test`, role: "agent", phone: "082 555 0123" });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
});
afterAll(() => closeDb());

describe("send()", () => {
  it("queues each channel the tenant opted in to and logs why the others are not sent", async () => {
    const t = await tenantOnLease(adminA, { email: "ayanda@example.test", phone: "082 123 4567", smsOptIn: false });
    await submitPop(adminA, { leaseId: t.leaseId, filename: "pop.pdf", bytes: PDF, claim: { amount: 850_000, paidOn: today, reference: null }, via: "staff" });
    const logged = await rows(a.agency.id, t.leaseId);
    const email = logged.find((m) => m.channel === "email")!;
    const sms = logged.find((m) => m.channel === "sms")!;
    expect(email).toMatchObject({ templateKey: "pop_received", status: "queued", toAddress: "ayanda@example.test", subject: "We've received your proof of payment" });
    expect(email.body).toContain("Hi Ayanda,");
    expect(email.body).toContain("R8 500,00");
    expect(sms).toMatchObject({ status: "suppressed", error: "Not opted in to SMS", toAddress: "27821234567" });
    expect(email.batchId).toBe(sms.batchId);
  });

  it("keeps SMS to one segment, in the GSM alphabet, with the opt-out link when it fits", async () => {
    const t = await tenantOnLease(adminA, { phone: "+27 82 123 4567", smsOptIn: true, emailOptIn: false, name: "Zoë O’Brien-Nkosinathi" });
    await sendRentToday(a.agency.id, t);
    const [sms] = (await rows(a.agency.id, t.leaseId)).filter((m) => m.channel === "sms" && m.templateKey === "rent_due_today");
    expect(sms!.body.length).toBeLessThanOrEqual(160);
    expect(sms!.body).toMatch(/^Reminder: rent of R8 500,00 is due today\. Ref TT-0001\. Upload proof of payment: x\.test\/p Opt out: .+\/o\/[A-Za-z0-9]{7}$/);
  });

  it("names the portfolio agent in a rejection", async () => {
    const t = await tenantOnLease(adminA, { email: "rej@example.test" });
    await setPropertyAgents(adminA, t.property, [agentA.userId!]);
    const { popId } = await submitPop(adminA, { leaseId: t.leaseId, filename: "pop.pdf", bytes: PDF, claim: { amount: 100_000, paidOn: today, reference: null }, via: "staff" });
    await rejectPop(adminA, popId, "the amount does not match");
    const [email] = (await rows(a.agency.id, t.leaseId)).filter((m) => m.templateKey === "pop_rejected" && m.channel === "email");
    expect(email!.body).toContain("We couldn't verify your payment of R1 000,00: the amount does not match.");
    expect(email!.body).toContain("Please contact Thabo Mokoena on 082 555 0123.");
  });

  it("waits until after quiet hours", async () => {
    const t = await tenantOnLease(adminB, { phone: "0821234567", smsOptIn: true });
    // 21:00 SAST, inside agency B's default 20:00–07:00
    await withAgency({ agencyId: b.agency.id }, async (tx) => {
      await send(tx, {
        recipient: { kind: "tenant", tenantId: t.tenantId },
        templateKey: "rent_due_today",
        leaseId: t.leaseId,
        variables: { amount: "1,00", eft_ref: "TT-1", portal_link: "x" },
        now: new Date("2099-03-01T19:00:00Z"),
      });
    });
    const [sms] = await rows(b.agency.id, t.leaseId);
    expect(sms!.nextAttemptAt.toISOString()).toBe("2099-03-02T05:00:00.000Z");
    expect((await deliverDue(b.agency.id, { providers: fakeProviders().providers })).sent).toBe(0);
  });
});

describe("delivery", () => {
  it("sends due messages, records the provider id and counts usage", async () => {
    const t = await tenantOnLease(adminA, { email: "deliver@example.test", phone: "0821110000", smsOptIn: true });
    await sendRentToday(a.agency.id, t);
    const [before] = await withAgency({ agencyId: a.agency.id }, (tx) => tx.select().from(schema.usageCounters));
    const fake = fakeProviders();
    expect((await deliverDue(a.agency.id, { providers: fake.providers })).sent).toBeGreaterThanOrEqual(1);
    expect(fake.sms.find((s) => s.to === "27821110000")).toMatchObject({ from: "MsgA" });
    const [sms] = await rows(a.agency.id, t.leaseId);
    expect(sms).toMatchObject({ status: "sent", provider: "clickatell", providerId: `ct-${sms!.id}`, attempts: 1 });
    const [after] = await withAgency({ agencyId: a.agency.id }, (tx) => tx.select().from(schema.usageCounters));
    expect(after!.smsSent).toBeGreaterThan(before?.smsSent ?? 0);
    // Nothing left to send
    expect((await deliverDue(a.agency.id, { providers: fake.providers })).sent).toBe(0);
  });

  it("retries twice with backoff, then fails and falls back to email", async () => {
    const t = await tenantOnLease(adminA, { email: "fallback@example.test", phone: "0821110001", smsOptIn: true });
    await sendRentToday(a.agency.id, t);
    const failing = fakeProviders({ failSms: "retry" });
    await deliverDue(a.agency.id, { providers: failing.providers });
    let [sms] = await rows(a.agency.id, t.leaseId);
    expect(sms).toMatchObject({ status: "queued", attempts: 1, error: "Clickatell 503: try later" });
    expect(sms!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    await makeDue(a.agency.id);
    await deliverDue(a.agency.id, { providers: failing.providers });
    await makeDue(a.agency.id);
    await deliverDue(a.agency.id, { providers: failing.providers });
    const logged = await rows(a.agency.id, t.leaseId);
    sms = logged.find((m) => m.channel === "sms");
    expect(sms).toMatchObject({ status: "failed", attempts: 3 });
    const email = logged.find((m) => m.channel === "email")!;
    expect(email).toMatchObject({ status: "queued", fallbackOf: sms!.id, toAddress: "fallback@example.test", subject: "Rent of R8 500,00 is due today" });
    const ok = fakeProviders();
    await deliverDue(a.agency.id, { providers: ok.providers });
    expect(ok.emails.find((e) => e.to === "fallback@example.test")?.html).toContain("MsgA Rentals");
  });

  it("does not retry a number the gateway refused", async () => {
    const t = await tenantOnLease(adminA, { phone: "0821110002", smsOptIn: true, emailOptIn: false, email: "x@example.test" });
    await sendRentToday(a.agency.id, t);
    await deliverDue(a.agency.id, { providers: fakeProviders({ failSms: "permanent" }).providers });
    const logged = await rows(a.agency.id, t.leaseId);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: "failed", attempts: 1, error: "Invalid destination address" });
  });
});

describe("delivery reports", () => {
  it("moves the status forward only, and an SMS that never arrives falls back to email", async () => {
    const t = await tenantOnLease(adminA, { email: "dlr@example.test", phone: "0821110003", smsOptIn: true });
    await sendRentToday(a.agency.id, t);
    await deliverDue(a.agency.id, { providers: fakeProviders().providers });
    const [sms] = await rows(a.agency.id, t.leaseId);
    expect(await recordDelivery("clickatell", sms!.providerId!, "failed", "Expired")).toBe("updated");
    expect(await recordDelivery("clickatell", sms!.providerId!, "delivered")).toBe("ignored");
    const logged = await rows(a.agency.id, t.leaseId);
    expect(logged.find((m) => m.channel === "sms")).toMatchObject({ status: "failed", error: "Expired" });
    const email = logged.find((m) => m.channel === "email")!;
    expect(email.fallbackOf).toBe(sms!.id);

    await deliverDue(a.agency.id, { providers: fakeProviders().providers });
    const providerId = `re-${email.id}`;
    expect(await recordDelivery("resend", providerId, "delivered")).toBe("updated");
    expect(await recordDelivery("resend", providerId, "sent")).toBe("ignored");
    expect(await recordDelivery("resend", providerId, "read")).toBe("updated");
    const [read] = (await rows(a.agency.id, t.leaseId)).filter((m) => m.id === email.id);
    expect(read).toMatchObject({ status: "read" });
    expect(read!.deliveredAt).not.toBeNull();
    expect(await recordDelivery("resend", "re-unknown", "delivered")).toBe("unknown");
  });
});

describe("isolation", () => {
  it("keeps each agency's messages, wording and opt-out codes to itself", async () => {
    const t = await tenantOnLease(adminA, { email: "iso@example.test" });
    await sendRentToday(a.agency.id, t);
    expect((await listMessages(adminA, { leaseId: t.leaseId })).length).toBe(1);
    expect(await listMessages(adminB, { leaseId: t.leaseId })).toEqual([]);
    // Agency B's worker never picks up A's messages
    const fake = fakeProviders();
    await deliverDue(b.agency.id, { providers: fake.providers });
    expect(fake.emails.find((e) => e.to === "iso@example.test")).toBeUndefined();

    const [tenant] = await withAgency({ agencyId: a.agency.id }, (tx) => tx.select().from(schema.tenants).where(eq(schema.tenants.id, t.tenantId)));
    const code = tenant!.optOutCode!;
    expect(await optOutStatus(b.agency.id, code)).toBeNull();
    expect(await optOut(b.agency.id, code, ["sms", "email"])).toBe(false);
    expect(await optOutStatus(a.agency.id, code)).toEqual({ sms: false, email: true });
  });

  it("shows agents only messages about their portfolio", async () => {
    const mine = await tenantOnLease(adminA, { email: "mine@example.test" });
    const other = await tenantOnLease(adminA, { email: "other@example.test" });
    await setPropertyAgents(adminA, mine.property, [agentA.userId!]);
    await sendRentToday(a.agency.id, mine);
    await sendRentToday(a.agency.id, other);
    expect((await listMessages(agentA, { leaseId: mine.leaseId })).length).toBe(1);
    expect(await listMessages(agentA, { leaseId: other.leaseId })).toEqual([]);
  });
});

describe("opt-out links", () => {
  it("stops the chosen channel and is audited", async () => {
    const t = await tenantOnLease(adminA, { email: "stop@example.test", phone: "0821110004", smsOptIn: true });
    await sendRentToday(a.agency.id, t);
    const [tenant] = await withAgency({ agencyId: a.agency.id }, (tx) => tx.select().from(schema.tenants).where(eq(schema.tenants.id, t.tenantId)));
    expect(await optOut(a.agency.id, tenant!.optOutCode!, ["sms"])).toBe(true);
    expect(await optOutStatus(a.agency.id, tenant!.optOutCode!)).toEqual({ sms: false, email: true });
    const [entry] = await withAgency({ agencyId: a.agency.id }, (tx) =>
      tx
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.action, "tenant.opted_out"), eq(schema.auditLog.entityId, t.tenantId))),
    );
    expect(entry!.after).toMatchObject({ smsOptIn: false, via: "opt-out link" });
    await sendRentToday(a.agency.id, t);
    const latest = (await rows(a.agency.id, t.leaseId)).filter((m) => m.channel === "sms" && m.status === "suppressed");
    expect(latest[0]).toMatchObject({ error: "Not opted in to SMS" });
    expect(await optOutStatus(a.agency.id, "bad code!")).toBeNull();
  });
});

describe("wording", () => {
  it("lets admins reword a message, checks it, and resets it", async () => {
    await expect(saveWording(adminA, { key: "rent_due_today", channel: "sms", subject: null, body: "Pay {amount} for {flat}" })).rejects.toThrow(/Unknown variable: \{flat\}/);
    await expect(
      saveWording(adminA, { key: "rent_due_today", channel: "sms", subject: null, body: `${"Please ".repeat(25)}{amount}` }),
    ).rejects.toBeInstanceOf(WordingError);
    await expect(saveWording(agentA, { key: "rent_due_today", channel: "sms", subject: null, body: "R{amount} due" })).rejects.toBeInstanceOf(ForbiddenError);

    await saveWording(adminA, { key: "rent_due_today", channel: "sms", subject: null, body: "{agency}: R{amount} due today, ref {eft_ref}." });
    expect((await listTemplates(adminA)).find((t) => t.entry.key === "rent_due_today")!.sms).toMatchObject({ custom: true });
    // Agency B still has the built-in wording
    expect((await listTemplates(adminB)).find((t) => t.entry.key === "rent_due_today")!.sms).toMatchObject({ custom: false });

    const t = await tenantOnLease(adminA, { phone: "0821110005", smsOptIn: true, emailOptIn: false });
    await sendRentToday(a.agency.id, t);
    expect((await rows(a.agency.id, t.leaseId))[0]!.body).toMatch(/^MsgA Rentals: R8 500,00 due today, ref TT-0001\./);

    await resetWording(adminA, "rent_due_today", "sms");
    expect((await listTemplates(adminA)).find((t) => t.entry.key === "rent_due_today")!.sms).toMatchObject({ custom: false });
  });
});
