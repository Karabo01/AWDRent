import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb, schema, withAgency } from "@awdrent/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { monthStart, todayInSouthAfrica } from "../src/billing";
import {
  amountsIn,
  convertInboundEmail,
  dismissInboundEmail,
  InboxError,
  inboxAddressFor,
  listInbox,
  receiveEmail,
  referencesIn,
  subdomainFromRecipients,
} from "../src/inbox";
import { activateLease, createLease } from "../src/leases";
import { createOwner } from "../src/owners";
import { ForbiddenError } from "../src/permissions";
import type { Actor } from "../src/portfolio";
import { createProperty, createUnit } from "../src/properties";
import { inviteStaff } from "../src/staff";
import { createTenant } from "../src/tenants";

const today = todayInSouthAfrica();
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let agentA: Actor;
let n = 0;

describe("routing and reading", () => {
  it("finds the agency in the plus-address, whichever header carries it", () => {
    expect(subdomainFromRecipients(["Kgosi POP <pop+kgosi@awdrent.co.za>"], "pop@awdrent.co.za")).toBe("kgosi");
    expect(subdomainFromRecipients(["pop@kgosi.co.za", "POP+Bayview@AWDRENT.CO.ZA"], "pop@awdrent.co.za")).toBe("bayview");
    expect(subdomainFromRecipients(["pop@awdrent.co.za"], "pop@awdrent.co.za")).toBeNull();
    expect(subdomainFromRecipients(["xpop+kgosi@awdrent.co.za"], "pop@awdrent.co.za")).toBeNull();
    expect(subdomainFromRecipients(["pop+kgosi@awdrent.co.za.evil.test"], "pop@awdrent.co.za")).toBeNull();
    expect(inboxAddressFor("kgosi", "pop@awdrent.co.za")).toBe("pop+kgosi@awdrent.co.za");
  });

  it("reads rand amounts in the ways people write them", () => {
    expect(amountsIn("Paid R8 500,00 today")).toEqual([850000]);
    expect(amountsIn("Amount: R 8,500.00 (ref KL-0042)")).toEqual([850000]);
    expect(amountsIn("r8500 for October")).toEqual([850000]);
    expect(amountsIn("Paid R8500 and R8 500,00")).toEqual([850000]);
    expect(amountsIn("R1 200 and R300")).toEqual([120000, 30000]);
    expect(amountsIn("ROOM 12, no amount")).toEqual([]);
  });

  it("finds payment references however they are typed", () => {
    const leases = [
      { id: "a", eftReference: "KL-0042" },
      { id: "b", eftReference: "KL-0004" },
      { id: "c", eftReference: "OLDREF77" },
    ];
    expect(referencesIn("Ref: kl 42", leases)).toEqual(["a"]);
    expect(referencesIn("KL0042 paid", leases)).toEqual(["a"]);
    expect(referencesIn("KL-00421", leases)).toEqual([]);
    expect(referencesIn("KL-4 and oldref77", leases)).toEqual(["b", "c"]);
  });
});

// ─── Emails as they arrive ─────────────────────────────────────────────

function email(opts: { to: string; from: string; subject: string; text: string; attachments?: { name: string; type: string; bytes: Buffer; inline?: boolean }[]; id?: string }) {
  const boundary = `b${++n}x`;
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${opts.text}\r\n`,
    ...(opts.attachments ?? []).map(
      (f) =>
        `--${boundary}\r\nContent-Type: ${f.type}; name="${f.name}"\r\nContent-Transfer-Encoding: base64\r\n` +
        (f.inline ? `Content-Disposition: inline; filename="${f.name}"\r\nContent-ID: <logo${n}@x>\r\n` : `Content-Disposition: attachment; filename="${f.name}"\r\n`) +
        `\r\n${f.bytes.toString("base64")}\r\n`,
    ),
  ];
  return Buffer.from(
    [
      `Message-ID: <${opts.id ?? `${Date.now()}-${++n}`}@mail.test>`,
      `Date: ${new Date().toUTCString()}`,
      `From: Sender <${opts.from}>`,
      "To: pop@kgosi-lettings.co.za",
      `Delivered-To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      ...parts,
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  );
}

async function lease(actor: Actor, tenantEmail: string) {
  const owner = await createOwner(actor, {
    kind: "individual",
    name: "Inbox Owner",
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
    fullName: "Ayanda Khumalo",
    idKind: "sa_id",
    idNumber: "",
    email: tenantEmail,
    phone: null,
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
  return { leaseId: l.id, tenantId, ref: l.eftReference };
}

const pops = (agencyId: string, leaseId: string) =>
  withAgency({ agencyId }, (tx) => tx.select().from(schema.proofsOfPayment).where(eq(schema.proofsOfPayment.leaseId, leaseId)));

beforeAll(async () => {
  await new S3Client({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
  })
    .send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }))
    .catch(() => undefined);
  a = await createAgencyWithAdmin("InboxA");
  b = await createAgencyWithAdmin("InboxB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  const agentId = await inviteStaff(adminA.ctx, { name: "Inbox Agent", email: `iagent-${Date.now()}@a.test`, role: "agent", phone: null });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
});
afterAll(() => closeDb());

const toA = () => inboxAddressFor(a.agency.subdomain);

describe("receiving emailed proofs of payment", () => {
  it("turns an email naming one lease and one amount into a POP for that lease", async () => {
    const t = await lease(adminA, `t${Date.now()}@example.test`);
    const raw = email({
      to: toA(),
      from: "someone.else@example.test",
      subject: `POP ${t.ref.replace("-", " ")}`,
      text: "Good day, please find attached proof of payment of R8 500,00. Thanks",
      attachments: [
        { name: "pop.pdf", type: "application/pdf", bytes: PDF },
        { name: "logo.png", type: "image/png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), inline: true },
      ],
    });
    const result = await receiveEmail(raw);
    expect(result).toMatchObject({ outcome: "converted", agencyId: a.agency.id });
    const [pop] = await pops(a.agency.id, t.leaseId);
    expect(pop).toMatchObject({ submittedVia: "email", claimedCents: 850_000, claimedPaidOn: today, status: "pending", tenantId: null });
    // The file is now a lease document, waiting for its virus scan; the inline logo was skipped
    const docs = await withAgency({ agencyId: a.agency.id }, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.leaseId, t.leaseId)));
    expect(docs.map((d) => [d.filename, d.status])).toEqual([["pop.pdf", "pending_scan"]]);
    // The tenant is told it arrived
    const [message] = await withAgency({ agencyId: a.agency.id }, (tx) =>
      tx.select().from(schema.messages).where(and(eq(schema.messages.leaseId, t.leaseId), eq(schema.messages.templateKey, "pop_received"))),
    );
    expect(message).toBeDefined();

    // The same email read again is recorded once
    expect(await receiveEmail(raw)).toEqual({ outcome: "duplicate", agencyId: a.agency.id });
    expect(await pops(a.agency.id, t.leaseId)).toHaveLength(1);
  });

  it("matches by the tenant's own address when no reference is given", async () => {
    const from = `ayanda${Date.now()}@example.test`;
    const t = await lease(adminA, from);
    await receiveEmail(email({ to: toA(), from: from.toUpperCase(), subject: "Rent", text: "Paid R8500", attachments: [{ name: "slip.pdf", type: "application/pdf", bytes: PDF }] }));
    expect((await pops(a.agency.id, t.leaseId))[0]).toMatchObject({ tenantId: t.tenantId, claimedCents: 850_000 });
  });

  it("keeps an email it cannot place in the inbox, for accounts to complete", async () => {
    const t = await lease(adminA, `x${Date.now()}@example.test`);
    const result = await receiveEmail(
      email({ to: toA(), from: "stranger@example.test", subject: "payment", text: "see attached", attachments: [{ name: "proof.pdf", type: "application/pdf", bytes: PDF }] }),
    );
    expect(result.outcome).toBe("inbox");
    const inbox = await listInbox(adminA);
    const item = inbox.find((i) => result.outcome === "inbox" && i.id === result.inboundEmailId)!;
    expect(item).toMatchObject({ fromAddress: "stranger@example.test", subject: "payment", suggestedLeaseId: null, suggestedCents: null });
    expect(item.attachments.map((x) => x.filename)).toEqual(["proof.pdf"]);

    await expect(convertInboundEmail(adminA, item.id, { eftReference: "ZZ-9999", claim: { amount: 100, paidOn: today, reference: null } })).rejects.toThrow(InboxError);
    await convertInboundEmail(adminA, item.id, { eftReference: t.ref.toLowerCase(), claim: { amount: 850_000, paidOn: today, reference: null } });
    expect((await pops(a.agency.id, t.leaseId))[0]).toMatchObject({ submittedVia: "email", claimedCents: 850_000 });
    expect((await listInbox(adminA, "converted")).some((i) => i.id === item.id)).toBe(true);
    await expect(dismissInboundEmail(adminA, item.id, "Too late")).rejects.toThrow(InboxError);
  });

  it("does not guess when an email names two amounts, and lets accounts dismiss what is not a POP", async () => {
    const t = await lease(adminA, `y${Date.now()}@example.test`);
    const result = await receiveEmail(
      email({ to: toA(), from: "y@example.test", subject: `${t.ref} rent and water`, text: "R8 500 rent and R450 water", attachments: [{ name: "a.pdf", type: "application/pdf", bytes: PDF }] }),
    );
    expect(result.outcome).toBe("inbox");
    const item = (await listInbox(adminA)).find((i) => result.outcome === "inbox" && i.id === result.inboundEmailId)!;
    expect(item).toMatchObject({ suggestedLeaseId: t.leaseId, suggestedRef: t.ref, suggestedCents: null, matchReason: `Payment reference ${t.ref} in the email` });
    await dismissInboundEmail(adminA, item.id, "Sent twice");
    expect((await listInbox(adminA, "dismissed")).find((i) => i.id === item.id)).toMatchObject({ note: "Sent twice" });
  });

  it("records an email with no usable attachment, and ignores files that are not PDFs or images", async () => {
    const result = await receiveEmail(
      email({ to: toA(), from: "z@example.test", subject: "POP", text: "R100", attachments: [{ name: "pop.exe", type: "application/octet-stream", bytes: Buffer.from("MZ...") }] }),
    );
    expect(result).toMatchObject({ outcome: "inbox", documentIds: [] });
  });

  it("drops emails not addressed to an active agency, and keeps agencies apart", async () => {
    expect(await receiveEmail(email({ to: "pop+no-such-agency@awdrent.co.za", from: "a@b.test", subject: "x", text: "y" }))).toEqual({ outcome: "not_for_an_agency" });
    expect(await receiveEmail(email({ to: "pop@awdrent.co.za", from: "a@b.test", subject: "x", text: "y" }))).toEqual({ outcome: "not_for_an_agency" });
    // A's lease reference sent to B's address does not reach A
    const t = await lease(adminA, `z${Date.now()}@example.test`);
    const result = await receiveEmail(
      email({ to: inboxAddressFor(b.agency.subdomain), from: "q@example.test", subject: t.ref, text: "R8500", attachments: [{ name: "p.pdf", type: "application/pdf", bytes: PDF }] }),
    );
    expect(result).toMatchObject({ outcome: "inbox", agencyId: b.agency.id });
    expect(await pops(a.agency.id, t.leaseId)).toEqual([]);
    expect((await listInbox(adminA)).some((i) => result.outcome === "inbox" && i.id === result.inboundEmailId)).toBe(false);
  });

  it("is for admins and accounts, not agents", async () => {
    await expect(listInbox(agentA)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
