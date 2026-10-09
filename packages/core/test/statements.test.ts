import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb, schema, withAgency, withPlatform } from "@awdrent/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { importStatement, listLines, saveProfile, unallocateLine } from "../src/banking";
import { addMonths, monthStart, todayInSouthAfrica } from "../src/billing";
import { activateLease, createLease } from "../src/leases";
import { createOwner } from "../src/owners";
import { ForbiddenError } from "../src/permissions";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit } from "../src/properties";
import { inviteStaff } from "../src/staff";
import { approveRun, getRun, prepareRun, StatementError } from "../src/statements";
import { createTenant } from "../src/tenants";

const today = todayInSouthAfrica();
const thisMonth = monthStart(today);
const lastMonth = addMonths(thisMonth, -1);
const nextMonth = addMonths(thisMonth, 1);
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let profileA: string;
let n = 0;

async function ownerWith(actor: Actor, name: string, model: "first_month" | "percent", percent: number | null) {
  return createOwner(actor, {
    kind: "individual",
    name,
    idKind: "sa_id",
    idOrRegNo: "",
    email: `${name.split(" ")[0]!.toLowerCase()}${++n}@example.test`,
    phone: null,
    postalAddress: null,
    commissionModel: model,
    commissionPercent: percent,
    vatRegistered: false,
    vatNumber: null,
    notes: null,
  });
}

/** A lease for the owner that started last month, so last month's and this month's rent are raised. */
async function leaseFor(actor: Actor, ownerId: string) {
  const property = await createProperty(actor, {
    ownerId,
    name: `Block ${++n}`,
    type: "apartment_block",
    addressLine1: "1 Main Road",
    addressLine2: null,
    suburb: null,
    city: "Pretoria",
    province: null,
    postalCode: null,
    notes: null,
  });
  const unitId = await createUnit(actor, property, { label: "Flat 1", bedrooms: 2, bathrooms: 1, status: "vacant", notes: null });
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
    startDate: lastMonth,
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

/** Money arriving on the trust account on a date, matched by reference. */
async function bankPayment(date: string, cents: number, reference: string) {
  const csv = ["Date,Amount,Reference,Description", `${date},${(cents / 100).toFixed(2)},${reference},stmt ${++n}`].join("\n");
  const { importId } = await importStatement(adminA, { profileId: profileA, fileName: `s${n}.csv`, csv });
  return (await listLines(adminA, { importId }))[0]!.line;
}

const statementFor = async (runId: string, ownerId: string) => (await getRun(adminA, runId)).statements.find((s) => s.statement.ownerId === ownerId)!;

beforeAll(async () => {
  await new S3Client({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
  })
    .send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }))
    .catch(() => undefined);
  a = await createAgencyWithAdmin("StmtA");
  b = await createAgencyWithAdmin("StmtB");
  // Agency A is VAT-registered
  await withPlatform((tx) => tx.update(schema.agencies).set({ vatNumber: "4999999999" }).where(eq(schema.agencies.id, a.agency.id)));
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  profileA = await saveProfile(adminA, {
    name: "CSV",
    dateColumn: "Date",
    amountMode: "single",
    amountColumn: "Amount",
    creditColumn: null,
    debitColumn: null,
    referenceColumn: "Reference",
    descriptionColumn: "Description",
    dateFormat: "YMD",
    skipRows: 0,
  });
});
afterAll(() => closeDb());

describe("owner statements", () => {
  it("pays owners their rent less commission, month by month, carrying reversals into the next month", async () => {
    const percentOwner = await ownerWith(adminA, "Pieter Percent", "percent", 1000);
    const feeOwner = await ownerWith(adminA, "Fatima Firstmonth", "first_month", null);
    const pLease = await leaseFor(adminA, percentOwner);
    const fLease = await leaseFor(adminA, feeOwner);
    const pLine = await bankPayment(`${lastMonth.slice(0, 8)}03`, 850_000, pLease.eftReference);
    await bankPayment(`${lastMonth.slice(0, 8)}04`, 850_000, fLease.eftReference);
    // Paid on the first of this month: belongs to this month, not last
    await bankPayment(thisMonth, 850_000, fLease.eftReference);

    await expect(prepareRun(adminA, thisMonth)).rejects.toThrow(/has not ended yet/);
    const draft = await prepareRun(adminA, lastMonth);
    // Prepared again, the draft is replaced
    const run1 = await prepareRun(adminA, lastMonth);
    expect(run1).not.toBe(draft);

    const p1 = await statementFor(run1, percentOwner);
    expect(p1.statement).toMatchObject({ openingCents: 0, rentCents: 850_000, commissionCents: 85_000, vatCents: 12_750, payableCents: 752_250 });
    expect(p1.lines[0]).toMatchObject({ basis: "percent", commissionNote: "Commission 10% plus VAT" });
    const f1 = await statementFor(run1, feeOwner);
    expect(f1.statement).toMatchObject({ rentCents: 850_000, commissionCents: 850_000, vatCents: 110_870, payableCents: 0 });
    expect(f1.lines[0]).toMatchObject({ basis: "letting_fee", commissionNote: "Letting fee: first month's rent" });

    expect(await approveRun(adminA, run1)).toEqual({ issued: expect.any(Number) });
    await expect(prepareRun(adminA, lastMonth)).rejects.toThrow(/already approved/);
    const issued = await statementFor(run1, percentOwner);
    const [doc] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.id, issued.statement.documentId!)));
    expect(doc).toMatchObject({ kind: "owner_statement", ownerId: percentOwner, status: "clean" });
    const [email] = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.messages).where(and(eq(schema.messages.templateKey, "owner_statement"), eq(schema.messages.recipientId, percentOwner))),
    );
    expect(email).toMatchObject({ attachmentDocumentId: doc!.id, recipientKind: "owner" });
    expect(email!.body).toContain("Amount payable: R7 522,50.");

    // Next month: the percentage owner's payment bounces; the first-month owner is paid in full
    await unallocateLine(adminA, pLine.id, "Bounced");
    const run2 = await prepareRun(adminA, thisMonth, addMonths(nextMonth, 0).slice(0, 8) + "02");
    const p2 = await statementFor(run2, percentOwner);
    expect(p2.statement).toMatchObject({ rentCents: -850_000, commissionCents: -85_000, vatCents: -12_750, payableCents: -752_250 });
    const f2 = await statementFor(run2, feeOwner);
    expect(f2.statement).toMatchObject({ rentCents: 850_000, commissionCents: 0, payableCents: 850_000 });
    // The approved month cannot be undone
    await expect(withAgency(adminA.ctx, (tx) => tx.delete(schema.statementRuns).where(eq(schema.statementRuns.id, run1)))).rejects.toThrow();
  });

  it("is for admins and accounts, and each agency sees only its own", async () => {
    const agentId = await inviteStaff(adminA.ctx, { name: "Stmt Agent", email: `sa-${Date.now()}@a.test`, role: "agent", phone: null });
    const agent: Actor = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
    await expect(prepareRun(agent, lastMonth)).rejects.toBeInstanceOf(ForbiddenError);
    const runs = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.statementRuns));
    await expect(getRun(adminB, runs[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    const runB = await prepareRun(adminB, lastMonth);
    expect((await getRun(adminB, runB)).statements).toEqual([]);
    await expect(prepareRun(adminA, "2026-13-01")).rejects.toBeInstanceOf(StatementError);
  });
});
