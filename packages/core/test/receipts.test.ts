import { writeFileSync } from "node:fs";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb, schema, withAgency } from "@awdrent/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { importStatement, listLines, saveProfile, unallocateLine } from "../src/banking";
import { monthStart, todayInSouthAfrica } from "../src/billing";
import { activateLease, createLease } from "../src/leases";
import { recordOpeningBalance } from "../src/ledger";
import { createOwner } from "../src/owners";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit } from "../src/properties";
import { issueReceipts, listReceipts, statementPdf } from "../src/receipts";
import { readObject } from "../src/storage";
import { createTenant } from "../src/tenants";

const today = todayInSouthAfrica();
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let profileA: string;
let n = 0;

async function lease(actor: Actor) {
  const owner = await createOwner(actor, {
    kind: "individual",
    name: "Receipt Owner",
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
  return l;
}

async function pay(actor: Actor, profileId: string, lines: [string, string][]) {
  const csv = ["Date,Amount,Reference,Description", ...lines.map(([amt, ref]) => `${today},${amt},${ref},receipt test ${++n}`)].join("\n");
  const { importId } = await importStatement(actor, { profileId, fileName: `r-${n}.csv`, csv });
  return listLines(actor, { importId });
}

const profile = {
  name: "CSV",
  dateColumn: "Date",
  amountMode: "single" as const,
  amountColumn: "Amount",
  creditColumn: null,
  debitColumn: null,
  referenceColumn: "Reference",
  descriptionColumn: "Description",
  dateFormat: "YMD" as const,
  skipRows: 0,
};

beforeAll(async () => {
  await new S3Client({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
  })
    .send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }))
    .catch(() => undefined);
  a = await createAgencyWithAdmin("RcptA");
  b = await createAgencyWithAdmin("RcptB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  profileA = await saveProfile(adminA, profile);
});
afterAll(() => closeDb());

describe("receipts", () => {
  it("issues one numbered PDF receipt per approved payment, once", async () => {
    const l = await lease(adminA);
    await pay(adminA, profileA, [
      ["5000.00", l.eftReference],
      ["3500.00", `${l.eftReference} balance`],
    ]);
    expect(await issueReceipts(a.agency.id)).toEqual({ issued: 2, cancelled: 0 });
    expect(await issueReceipts(a.agency.id)).toEqual({ issued: 0, cancelled: 0 });
    const receipts = await listReceipts(adminA, l.id);
    expect(receipts.map((r) => r.receiptNumber).sort()).toEqual(["TT-R000001", "TT-R000002"]);

    const [doc] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.id, receipts[0]!.documentId)));
    expect(doc).toMatchObject({ kind: "receipt", status: "clean", contentType: "application/pdf" });
    const bytes = await readObject(doc!.fileKey);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    // Kept for a visual check of the layout
    writeFileSync(`${process.env.TEMP ?? "/tmp"}/awdrent-receipt-sample.pdf`, bytes);
  });

  it("numbers each agency's receipts separately", async () => {
    const profileB = await saveProfile(adminB, profile);
    const l = await lease(adminB);
    await pay(adminB, profileB, [["100.00", l.eftReference]]);
    await issueReceipts(b.agency.id);
    expect((await listReceipts(adminB, l.id)).map((r) => r.receiptNumber)).toEqual(["TT-R000001"]);
  });

  it("cancels the receipt when its payment is reversed", async () => {
    const l = await lease(adminA);
    const [line] = await pay(adminA, profileA, [["8500.00", l.eftReference]]);
    await issueReceipts(a.agency.id);
    await unallocateLine(adminA, line!.line.id, "Wrong tenant");
    expect((await issueReceipts(a.agency.id)).cancelled).toBe(1);
    expect((await listReceipts(adminA, l.id))[0]).toMatchObject({ cancelReason: "Payment reversed: Bank line unallocated: Wrong tenant" });
  });

  it("does not receipt opening balances", async () => {
    const l = await lease(adminA);
    await withAgency(adminA.ctx, (tx) => recordOpeningBalance(tx, l.id, -1000, today));
    await issueReceipts(a.agency.id);
    expect(await listReceipts(adminA, l.id)).toEqual([]);
  });
});

describe("statements", () => {
  it("renders a branded PDF on request, for the agency's own leases only", async () => {
    const l = await lease(adminA);
    const { bytes, filename } = await statementPdf(adminA, l.id);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(filename).toContain(l.eftReference);
    writeFileSync(`${process.env.TEMP ?? "/tmp"}/awdrent-statement-sample.pdf`, bytes);
    await expect(statementPdf(adminB, l.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listReceipts(adminB, l.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
