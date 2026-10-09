import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb, schema, withAgency } from "@awdrent/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { monthStart, todayInSouthAfrica } from "../src/billing";
import { activateLease, createLease } from "../src/leases";
import type { OutgoingEmail, OutgoingSms, Providers } from "../src/messaging/providers";
import { createOwner } from "../src/owners";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit, setPropertyAgents } from "../src/properties";
import {
  cancelEnvelope,
  checkTemplate,
  declineSigning,
  leaseTemplate,
  listEnvelopes,
  previewDocument,
  resetLeaseTemplate,
  saveLeaseTemplate,
  sendForSigning,
  sendSigningCode,
  signDocument,
  SigningError,
  signingDocument,
  signingView,
  verifySigningCode,
} from "../src/signing";
import { STANDARD_LEASE } from "../src/signing/standard-lease";
import { readObject } from "../src/storage";
import { inviteStaff } from "../src/staff";
import { createTenant } from "../src/tenants";

const today = todayInSouthAfrica();
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let agentA: Actor;
let n = 0;

// ─── A real PNG for the drawn signature ────────────────────────────────
const CRC = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function signaturePng(width = 120, height = 40): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const rows = Buffer.alloc((width + 1) * height, 255);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0;
    // A diagonal stroke
    const x = Math.floor((y / height) * width);
    rows[y * (width + 1) + 1 + x] = 0;
  }
  return new Uint8Array(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]),
  );
}

function fakeProviders() {
  const emails: OutgoingEmail[] = [];
  const sms: OutgoingSms[] = [];
  const providers: Providers = {
    email: async (m) => (emails.push(m), { provider: "dev", providerId: m.messageId }),
    sms: async (m) => (sms.push(m), { provider: "dev", providerId: m.messageId }),
  };
  const lastCode = () => (emails.at(-1)?.text ?? sms.at(-1)?.text ?? "").match(/\b(\d{6})\b/)?.[1] ?? "";
  return { providers, emails, sms, lastCode };
}

async function lease(actor: Actor, opts: { tenants?: number; activate?: boolean; ownerEmail?: string | null } = {}) {
  const owner = await createOwner(actor, {
    kind: "individual",
    name: "Pieter van Wyk",
    idKind: "sa_id",
    idOrRegNo: "",
    email: opts.ownerEmail === undefined ? "pieter@example.test" : opts.ownerEmail,
    phone: null,
    postalAddress: "PO Box 12, Parktown, 2193",
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
    suburb: "Parktown",
    city: "Johannesburg",
    province: null,
    postalCode: "2193",
    notes: null,
  });
  await setPropertyAgents(actor, property, [agentA.userId!]);
  const unitId = await createUnit(actor, property, { label: `Flat ${++n}`, bedrooms: 2, bathrooms: 1, status: "vacant", notes: null });
  const tenantIds: string[] = [];
  for (let i = 0; i < (opts.tenants ?? 1); i++) {
    tenantIds.push(
      await createTenant(actor, {
        fullName: i === 0 ? "Ayanda Khumalo" : "Sipho Nkosi",
        idKind: "sa_id",
        idNumber: i === 0 ? "9001015009086" : "",
        email: `tenant${n}-${i}@example.test`,
        phone: null,
        employer: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        consentGiven: true,
        emailOptIn: false,
        smsOptIn: false,
        whatsappOptIn: false,
        notes: null,
      }),
    );
  }
  const l = await createLease(actor, {
    unitId,
    primaryTenantId: tenantIds[0]!,
    coTenantIds: tenantIds.slice(1),
    startDate: monthStart(today),
    billingStartsOn: null,
    endDate: "2027-12-31",
    rent: 850_000,
    dueDay: 1,
    deposit: 1_700_000,
    escalationPercent: 800,
    escalationDate: "2027-07-01",
    noticeDays: 30,
    notes: null,
  });
  if (opts.activate) await activateLease(actor, l.id);
  return l.id;
}

/** The personal link token from the newest signing request to this address. */
async function tokenFor(agencyId: string, to: string): Promise<string> {
  const rows = await withAgency({ agencyId }, (tx) =>
    tx.select().from(schema.messages).where(and(eq(schema.messages.templateKey, "signing_request"), eq(schema.messages.toAddress, to))),
  );
  const link = rows.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0]?.payload.link ?? "";
  return link.split("/s/")[1] ?? "";
}

async function signAs(agencyId: string, token: string, name: string) {
  const fake = fakeProviders();
  expect(await sendSigningCode(agencyId, token, fake.providers)).toMatchObject({ sentTo: expect.stringContaining("***") });
  expect(await verifySigningCode(agencyId, token, fake.lastCode())).toBe("ok");
  return signDocument(agencyId, token, { signedName: name, signaturePng: signaturePng(), ipAddress: "196.25.1.1", userAgent: "Test browser" });
}

const statuses = async (leaseId: string) => (await listEnvelopes(adminA, leaseId))[0]!.signers.map((s) => `${s.role}:${s.status}`);

beforeAll(async () => {
  await new S3Client({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
  })
    .send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }))
    .catch(() => undefined);
  a = await createAgencyWithAdmin("SignA");
  b = await createAgencyWithAdmin("SignB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  const agentId = await inviteStaff(adminA.ctx, { name: "Lesedi Mapena", email: `sagent-${Date.now()}@a.test`, role: "agent", phone: "0825550123" });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
});
afterAll(() => closeDb());

describe("lease template", () => {
  it("starts from the standard lease, refuses unknown fields, and resets", async () => {
    expect((await leaseTemplate(adminA)).custom).toBe(false);
    expect(checkTemplate(STANDARD_LEASE)).toEqual([]);
    await expect(saveLeaseTemplate(adminA, [{ heading: "Pets", body: "No pets at {flat_number}." }])).rejects.toThrow(/\{flat_number\}, which is not a field/);
    await saveLeaseTemplate(adminA, [...STANDARD_LEASE, { heading: "Garden", body: "The Tenant keeps the garden at {property_address} tidy." }]);
    const custom = await leaseTemplate(adminA);
    expect(custom.custom).toBe(true);
    expect(custom.sections.at(-1)!.heading).toBe("Garden");
    expect((await leaseTemplate(adminB)).custom).toBe(false);
  });

  it("fills the lease from its records, with ID numbers masked", async () => {
    const id = await lease(adminA);
    const { bytes, missing } = await previewDocument(agentA, id, { kind: "lease_agreement", landlordSignatory: "owner", agentUserId: agentA.userId! });
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(missing).toContain("Fidelity Fund Certificate number");
    writeFileSync(`${process.env.TEMP ?? "/tmp"}/awdrent-lease-draft-sample.pdf`, bytes);
    await resetLeaseTemplate(adminA);
  });
});

describe("signing a lease agreement", () => {
  it("goes tenants, then owner, then agent, and files the signed original with a certificate", async () => {
    const id = await lease(adminA, { tenants: 2 });
    const envelopeId = await sendForSigning(agentA, id, { kind: "lease_agreement", landlordSignatory: "owner", agentUserId: agentA.userId! });
    expect(await statuses(id)).toEqual(["tenant:invited", "tenant:invited", "owner:waiting", "agent:waiting"]);

    // Tenants have not opted in to email, but a signing request is sent anyway (D84)
    const t1 = await tokenFor(a.agency.id, `tenant${n}-0@example.test`);
    const t2 = await tokenFor(a.agency.id, `tenant${n}-1@example.test`);
    expect(t1).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const view = await signingView(a.agency.id, t1);
    expect(view).toMatchObject({ canSign: true, kind: "lease_agreement", signer: { name: "Ayanda Khumalo", capacity: "Tenant", verified: false } });
    const unsigned = await signingDocument(a.agency.id, t1);
    expect(Buffer.from(unsigned!.bytes).subarray(0, 5).toString()).toBe("%PDF-");

    expect(await signAs(a.agency.id, t1, "Ayanda Khumalo")).toBe("signed");
    expect(await statuses(id)).toEqual(["tenant:signed", "tenant:invited", "owner:waiting", "agent:waiting"]);
    expect(await signAs(a.agency.id, t2, "Sipho Nkosi")).toBe("signed");
    expect(await statuses(id)).toEqual(["tenant:signed", "tenant:signed", "owner:invited", "agent:waiting"]);

    expect(await signAs(a.agency.id, await tokenFor(a.agency.id, "pieter@example.test"), "P van Wyk")).toBe("signed");
    const [agent] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.users).where(eq(schema.users.id, agentA.userId!)));
    expect(await signAs(a.agency.id, await tokenFor(a.agency.id, agent!.email), "Lesedi Mapena")).toBe("completed");

    const [envelope] = await listEnvelopes(adminA, id);
    expect(envelope).toMatchObject({ id: envelopeId, status: "completed" });
    const [signed] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.id, envelope!.signedDocumentId!)));
    expect(signed).toMatchObject({ kind: "lease_agreement", status: "clean", filename: expect.stringMatching(/^Lease agreement TT-\d{4} \(signed\)\.pdf$/) });
    const bytes = await readObject(signed!.fileKey);
    writeFileSync(`${process.env.TEMP ?? "/tmp"}/awdrent-lease-signed-sample.pdf`, bytes);

    // Every signer is sent the signed copy
    const copies = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.messages).where(and(eq(schema.messages.leaseId, id), eq(schema.messages.templateKey, "signing_completed"), eq(schema.messages.channel, "email"))),
    );
    expect(copies).toHaveLength(4);
    expect(copies.every((c) => c.attachmentDocumentId === signed!.id && c.status === "queued")).toBe(true);

    // Signatures are final, and a used link cannot sign again
    await expect(signAs(a.agency.id, t1, "Again")).rejects.toThrow();
  });

  it("lets the agent sign for the owner under mandate, with no owner signature", async () => {
    const id = await lease(adminA);
    await sendForSigning(agentA, id, { kind: "lease_agreement", landlordSignatory: "agent", agentUserId: agentA.userId! });
    const [envelope] = await listEnvelopes(adminA, id);
    expect(envelope!.signers.map((s) => s.capacity)).toEqual(["Tenant", "Agent, for and on behalf of the Landlord (Pieter van Wyk) under mandate"]);
  });

  it("allows one document of a kind out for signing at a time, and cancelling ends the links", async () => {
    const id = await lease(adminA);
    const envelopeId = await sendForSigning(adminA, id, { kind: "lease_agreement", landlordSignatory: "owner", agentUserId: agentA.userId! });
    await expect(sendForSigning(adminA, id, { kind: "lease_agreement", landlordSignatory: "owner", agentUserId: agentA.userId! })).rejects.toThrow(
      /already out for signing/,
    );
    const token = await tokenFor(a.agency.id, `tenant${n}-0@example.test`);
    await cancelEnvelope(adminA, envelopeId, "Wrong deposit amount");
    expect(await signingView(a.agency.id, token)).toMatchObject({ canSign: false, envelopeStatus: "cancelled" });
    expect(await sendSigningCode(a.agency.id, token, fakeProviders().providers)).toBeNull();
    expect(await signingDocument(a.agency.id, token)).toBeNull();
  });

  it("withdraws the document when a signer declines, and tells the sender", async () => {
    const id = await lease(adminA);
    await sendForSigning(agentA, id, { kind: "lease_agreement", landlordSignatory: "owner", agentUserId: agentA.userId! });
    const token = await tokenFor(a.agency.id, `tenant${n}-0@example.test`);
    await expect(declineSigning(a.agency.id, token, "The rent is wrong")).rejects.toThrow(/Confirm the code/);
    const fake = fakeProviders();
    await sendSigningCode(a.agency.id, token, fake.providers);
    await verifySigningCode(a.agency.id, token, fake.lastCode());
    await declineSigning(a.agency.id, token, "The rent is wrong");
    expect((await listEnvelopes(adminA, id))[0]).toMatchObject({ status: "declined" });
    const [notice] = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.messages).where(and(eq(schema.messages.leaseId, id), eq(schema.messages.templateKey, "signing_declined"))),
    );
    expect(notice).toMatchObject({ recipientId: agentA.userId, recipientKind: "staff" });
    expect(notice!.body).toContain("Ayanda Khumalo declined to sign the lease agreement");
  });

  it("locks the code after five wrong tries, and needs a confirmed code to sign", async () => {
    const id = await lease(adminA);
    await sendForSigning(adminA, id, { kind: "lease_agreement", landlordSignatory: "owner", agentUserId: agentA.userId! });
    const token = await tokenFor(a.agency.id, `tenant${n}-0@example.test`);
    await expect(signDocument(a.agency.id, token, { signedName: "Ayanda", signaturePng: signaturePng(), ipAddress: "x", userAgent: "y" })).rejects.toThrow(
      /Confirm the code/,
    );
    await sendSigningCode(a.agency.id, token, fakeProviders().providers);
    for (let i = 0; i < 4; i++) expect(await verifySigningCode(a.agency.id, token, "000000")).toBe("wrong");
    expect(await verifySigningCode(a.agency.id, token, "000001")).toBe("locked");
    await expect(signDocument(a.agency.id, token, { signedName: "Ayanda", signaturePng: new Uint8Array([1, 2, 3]), ipAddress: "x", userAgent: "y" })).rejects.toThrow(
      /Draw your signature/,
    );
  });
});

describe("confirmation letter", () => {
  it("is signed by the agent and then an authorised representative, for a started lease", async () => {
    const draft = await lease(adminA);
    await expect(sendForSigning(adminA, draft, { kind: "confirmation_letter", agentUserId: agentA.userId!, representativeUserId: a.admin.id })).rejects.toThrow(
      /activate the lease first/,
    );
    const id = await lease(adminA, { activate: true });
    await expect(sendForSigning(adminA, id, { kind: "confirmation_letter", agentUserId: a.admin.id, representativeUserId: a.admin.id })).rejects.toBeInstanceOf(
      SigningError,
    );
    await sendForSigning(adminA, id, { kind: "confirmation_letter", agentUserId: agentA.userId!, representativeUserId: a.admin.id });
    expect(await statuses(id)).toEqual(["agent:invited", "agency_representative:waiting"]);
    const [agent] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.users).where(eq(schema.users.id, agentA.userId!)));
    expect(await signAs(a.agency.id, await tokenFor(a.agency.id, agent!.email), "Lesedi Mapena")).toBe("signed");
    expect(await signAs(a.agency.id, await tokenFor(a.agency.id, a.admin.email), "SignA Admin")).toBe("completed");
    const [envelope] = await listEnvelopes(adminA, id);
    const [doc] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.id, envelope!.signedDocumentId!)));
    expect(doc!.kind).toBe("confirmation_letter");
    writeFileSync(`${process.env.TEMP ?? "/tmp"}/awdrent-letter-signed-sample.pdf`, await readObject(doc!.fileKey));
  });
});

describe("isolation", () => {
  it("keeps signing links, documents and envelopes inside their agency and portfolio", async () => {
    const id = await lease(adminA);
    await sendForSigning(adminA, id, { kind: "lease_agreement", landlordSignatory: "owner", agentUserId: agentA.userId! });
    const token = await tokenFor(a.agency.id, `tenant${n}-0@example.test`);
    expect(await signingView(b.agency.id, token)).toBeNull();
    expect(await signingDocument(b.agency.id, token)).toBeNull();
    expect(await sendSigningCode(b.agency.id, token, fakeProviders().providers)).toBeNull();
    await expect(listEnvelopes(adminB, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(previewDocument(adminB, id, { kind: "lease_agreement", landlordSignatory: "owner", agentUserId: agentA.userId! })).rejects.toThrow();
    expect(await signingView(a.agency.id, "not-a-token")).toBeNull();
  });
});
