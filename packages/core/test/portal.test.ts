import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb, schema, withAgency } from "@awdrent/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { updateAgencySettings } from "../src/agency-settings";
import { monthStart, todayInSouthAfrica } from "../src/billing";
import { createLease, activateLease } from "../src/leases";
import type { OutgoingEmail, OutgoingSms, Providers } from "../src/messaging/providers";
import { createOwner } from "../src/owners";
import {
  ensurePortalUser,
  findSignInTarget,
  parseSignInIdentifier,
  type PortalActor,
  portalLeases,
  portalLedger,
  portalPaymentDetails,
  portalProfile,
  portalReceiptUrl,
  portalSetConsent,
  portalStatementPdf,
  portalSubmitPop,
  sendSignInCode,
} from "../src/portal";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit } from "../src/properties";
import { createTenant } from "../src/tenants";

const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const today = todayInSouthAfrica();
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let n = 0;

async function tenant(actor: Actor, contact: { name?: string; email?: string | null; phone?: string | null }) {
  return createTenant(actor, {
    fullName: contact.name ?? "Ayanda Khumalo",
    idKind: "sa_id",
    idNumber: "",
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    employer: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    consentGiven: true,
    emailOptIn: true,
    smsOptIn: false,
    whatsappOptIn: false,
    notes: null,
  });
}

async function leaseFor(actor: Actor, tenantId: string, opts: { activate?: boolean } = {}) {
  const owner = await createOwner(actor, {
    kind: "individual",
    name: "Portal Owner",
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
  if (opts.activate !== false) await activateLease(actor, l.id);
  return l.id;
}

async function signIn(agencyId: string, tenantId: string): Promise<PortalActor> {
  const portalUserId = await ensurePortalUser(agencyId, tenantId);
  return { ctx: { agencyId, portalUserId }, tenantId };
}

function fakeProviders() {
  const emails: OutgoingEmail[] = [];
  const sms: OutgoingSms[] = [];
  const providers: Providers = {
    email: async (m) => (emails.push(m), { provider: "resend", providerId: `re-${m.messageId}` }),
    sms: async (m) => (sms.push(m), { provider: "clickatell", providerId: `ct-${m.messageId}` }),
  };
  return { providers, emails, sms };
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
  a = await createAgencyWithAdmin("PortalA");
  b = await createAgencyWithAdmin("PortalB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
});
afterAll(() => closeDb());

describe("sign-in identifiers", () => {
  it("accepts an email address or a mobile number in any common form", () => {
    expect(parseSignInIdentifier(" Ayanda@Example.TEST ")).toEqual({ kind: "email", value: "ayanda@example.test" });
    expect(parseSignInIdentifier("082 123 4567")).toEqual({ kind: "phone", value: "27821234567" });
    expect(parseSignInIdentifier("+27821234567")).toEqual({ kind: "phone", value: "27821234567" });
    expect(parseSignInIdentifier("not an address")).toBeNull();
  });
});

describe("finding who signs in", () => {
  it("finds a tenant on a lease by email or phone, within the host's agency only", async () => {
    const email = `t${Date.now()}@example.test`;
    const id = await tenant(adminA, { email, phone: "071 555 0001" });
    await leaseFor(adminA, id);
    expect(await findSignInTarget(a.agency.id, parseSignInIdentifier(email.toUpperCase())!)).toMatchObject({ tenantId: id, channel: "email", to: email });
    expect(await findSignInTarget(a.agency.id, parseSignInIdentifier("+27 71 555 0001")!)).toMatchObject({ tenantId: id, channel: "sms", to: "27715550001" });
    // The same address at another agency finds nothing here
    expect(await findSignInTarget(b.agency.id, parseSignInIdentifier(email)!)).toBeNull();
  });

  it("refuses an address two tenant records share, a tenant with only a draft lease, and LIKE wildcards", async () => {
    const shared = `shared${Date.now()}@example.test`;
    await leaseFor(adminA, await tenant(adminA, { name: "One", email: shared }));
    await leaseFor(adminA, await tenant(adminA, { name: "Two", email: shared }));
    expect(await findSignInTarget(a.agency.id, { kind: "email", value: shared })).toBeNull();

    const draftOnly = `draft${Date.now()}@example.test`;
    await leaseFor(adminA, await tenant(adminA, { email: draftOnly }), { activate: false });
    expect(await findSignInTarget(a.agency.id, { kind: "email", value: draftOnly })).toBeNull();

    expect(await findSignInTarget(a.agency.id, { kind: "email", value: "%@example.test" })).toBeNull();
  });

  it("sends the code at once, and logs the message without the code", async () => {
    const email = `code${Date.now()}@example.test`;
    const id = await tenant(adminA, { email });
    await leaseFor(adminA, id);
    const target = (await findSignInTarget(a.agency.id, { kind: "email", value: email }))!;
    const fake = fakeProviders();
    await sendSignInCode(a.agency.id, target, "493817", fake.providers);
    expect(fake.emails[0]!.text).toContain("Your sign-in code is 493817");
    const [logged] = await withAgency({ agencyId: a.agency.id }, (tx) =>
      tx.select().from(schema.messages).where(and(eq(schema.messages.recipientId, id), eq(schema.messages.templateKey, "portal_sign_in_code"))),
    );
    expect(logged).toMatchObject({ status: "sent", channel: "email", toAddress: email });
    expect(JSON.stringify(logged)).not.toContain("493817");

    await sendSignInCode(a.agency.id, { ...target, channel: "sms", to: "27715550002" }, "112233", fake.providers);
    expect(fake.sms[0]!.text).toMatch(/^112233 is your PortalA Rentals sign-in code\./);
  });
});

describe("what a signed-in tenant can see and do", () => {
  it("shows only the tenant's own leases; another tenant's or agency's lease is not found", async () => {
    const me = await tenant(adminA, { email: `me${Date.now()}@example.test` });
    const other = await tenant(adminA, { email: `other${Date.now()}@example.test` });
    const mine = await leaseFor(adminA, me);
    const theirs = await leaseFor(adminA, other);
    const elsewhere = await leaseFor(adminB, await tenant(adminB, {}));
    const actor = await signIn(a.agency.id, me);

    const leases = await portalLeases(actor);
    expect(leases.map((l) => l.id)).toEqual([mine]);
    expect(leases[0]).toMatchObject({ balanceCents: 850_000, unit: expect.stringMatching(/^Flat \d+, Sunset Court$/) });
    expect((await portalLedger(actor, mine)).lines[0]!.description).toMatch(/^Rent for /);
    await expect(portalLedger(actor, theirs)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portalLedger(actor, elsewhere)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portalStatementPdf(actor, theirs)).rejects.toBeInstanceOf(NotFoundError);
    const { bytes } = await portalStatementPdf(actor, mine);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    await expect(portalReceiptUrl(actor, "TT-R999999")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("takes a proof of payment from the tenant, queued for accounts and audited as theirs", async () => {
    const me = await tenant(adminA, { email: `pop${Date.now()}@example.test` });
    const leaseId = await leaseFor(adminA, me);
    const actor = await signIn(a.agency.id, me);
    const { popId } = await portalSubmitPop(actor, { leaseId, filename: "pop.pdf", bytes: PDF, claim: { amount: 850_000, paidOn: today, reference: null } });
    const [pop] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.proofsOfPayment).where(eq(schema.proofsOfPayment.id, popId)));
    expect(pop).toMatchObject({ status: "pending", submittedVia: "portal", tenantId: me });
    const [entry] = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "pop.submitted"), eq(schema.auditLog.entityId, leaseId))),
    );
    expect(entry).toMatchObject({ portalUserId: actor.ctx.portalUserId, userId: null });
    // Not on someone else's lease
    const other = await leaseFor(adminA, await tenant(adminA, {}));
    await expect(
      portalSubmitPop(actor, { leaseId: other, filename: "pop.pdf", bytes: PDF, claim: { amount: 100, paidOn: today, reference: null } }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets the tenant change their message consent, audited", async () => {
    const me = await tenant(adminA, { email: `consent${Date.now()}@example.test`, phone: "0825550199" });
    await leaseFor(adminA, me);
    const actor = await signIn(a.agency.id, me);
    await portalSetConsent(actor, { email: false, sms: true });
    expect(await portalProfile(actor)).toMatchObject({ emailOptIn: false, smsOptIn: true });
    const [entry] = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "tenant.consent_changed"), eq(schema.auditLog.entityId, me))),
    );
    expect(entry).toMatchObject({ portalUserId: actor.ctx.portalUserId, after: { emailOptIn: false, smsOptIn: true, via: "portal" } });
  });

  it("shows the full trust account details and the tenant's reference", async () => {
    await updateAgencySettings(adminA.ctx, {
      name: a.agency.name,
      brandColour: "#123456",
      trustBankName: "FNB",
      trustAccountNo: "62000000001",
      trustAccountHolder: "PortalA Trust",
      trustBranchCode: "250655",
      quietHoursStart: "20:00",
      quietHoursEnd: "07:00",
      legalName: null,
      registrationNo: null,
      ffcNumber: null,
      vatNumber: null,
      physicalAddress: null,
      contactPhone: null,
      contactEmail: null,
    });
    const me = await tenant(adminA, {});
    const leaseId = await leaseFor(adminA, me);
    const d = await portalPaymentDetails(await signIn(a.agency.id, me));
    expect(d).toMatchObject({ bank: "FNB", accountNumber: "62000000001", holder: "PortalA Trust", branchCode: "250655" });
    expect(d.leases.map((l) => l.id)).toEqual([leaseId]);
  });

  it("creates one portal user per tenant, and none for a tenant with no live or past lease", async () => {
    const me = await tenant(adminA, {});
    await leaseFor(adminA, me);
    expect(await ensurePortalUser(a.agency.id, me)).toBe(await ensurePortalUser(a.agency.id, me));
    const draft = await tenant(adminA, {});
    await leaseFor(adminA, draft, { activate: false });
    await expect(ensurePortalUser(a.agency.id, draft)).rejects.toBeInstanceOf(NotFoundError);
    // Another agency cannot create a portal user for this tenant
    await expect(ensurePortalUser(b.agency.id, me)).rejects.toBeInstanceOf(NotFoundError);
  });
});
