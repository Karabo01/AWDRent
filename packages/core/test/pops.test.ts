import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";
import { closeDb } from "@awdrent/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { importStatement, listLines, saveProfile, unallocateLine } from "../src/banking";
import { monthStart, todayInSouthAfrica } from "../src/billing";
import { activateLease, createLease } from "../src/leases";
import { getLedger, LedgerRuleError } from "../src/ledger";
import { createOwner } from "../src/owners";
import { ForbiddenError } from "../src/permissions";
import { approvePop, candidateLines, listPops, rejectPop, submitPop } from "../src/pops";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit, setPropertyAgents } from "../src/properties";
import { inviteStaff } from "../src/staff";
import { createTenant } from "../src/tenants";

const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const today = todayInSouthAfrica();
let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let accountsA: Actor;
let agentA: Actor;
let profileA: string;
let n = 0;

async function lease(actor: Actor) {
  const owner = await createOwner(actor, {
    kind: "individual",
    name: "POP Owner",
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
    name: `POP ${Math.random()}`,
    type: "house",
    addressLine1: "1 Road",
    addressLine2: null,
    suburb: null,
    city: "Cape Town",
    province: null,
    postalCode: null,
    notes: null,
  });
  const unitId = await createUnit(actor, property, { label: "Main", bedrooms: 2, bathrooms: 1, status: "vacant", notes: null });
  const tenantId = await createTenant(actor, {
    fullName: "POP Tenant",
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
    rent: 500_000,
    dueDay: 1,
    deposit: 0,
    escalationPercent: null,
    escalationDate: null,
    noticeDays: 30,
    notes: null,
  });
  await activateLease(actor, l.id);
  return { ...l, property, tenantId };
}

async function bankLines(lines: [string, string][]) {
  const csv = ["Date,Amount,Reference,Description", ...lines.map(([amt, ref]) => `${today},${amt},${ref},pop test ${++n}`)].join("\n");
  const { importId } = await importStatement(accountsA, { profileId: profileA, fileName: `pop-${n}.csv`, csv });
  return Object.fromEntries((await listLines(accountsA, { importId })).map((l) => [l.line.reference, l.line]));
}

const claim = (amount: number) => ({ amount, paidOn: today, reference: null });
const submit = (actor: Actor, leaseId: string, amount: number) => submitPop(actor, { leaseId, filename: "pop.pdf", bytes: PDF, claim: claim(amount), via: "staff" });

beforeAll(async () => {
  await new S3Client({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY_ID, secretAccessKey: env().S3_SECRET_ACCESS_KEY },
  })
    .send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }))
    .catch(() => undefined);
  a = await createAgencyWithAdmin("PopA");
  b = await createAgencyWithAdmin("PopB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  const accId = await inviteStaff(adminA.ctx, { name: "POP Accounts", email: `pacc-${Date.now()}@a.test`, role: "accounts", phone: null });
  accountsA = { ctx: { agencyId: a.agency.id, userId: accId }, role: "accounts", userId: accId };
  const agentId = await inviteStaff(adminA.ctx, { name: "POP Agent", email: `pagent-${Date.now()}@a.test`, role: "agent", phone: null });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
  profileA = await saveProfile(accountsA, {
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

describe("proofs of payment", () => {
  it("never changes the balance on their own", async () => {
    const l = await lease(adminA);
    await submit(accountsA, l.id, 500_000);
    expect((await getLedger(adminA, l.id)).balanceCents).toBe(500_000);
    expect((await listPops(accountsA, { leaseId: l.id })).map((p) => p.pop.status)).toEqual(["pending"]);
  });

  it("suggests the matching bank line first and approves by linking to it", async () => {
    const l = await lease(adminA);
    const { popId } = await submit(accountsA, l.id, 500_000);
    const lines = await bankLines([
      ["5000.00", "CASH DEP 1"],
      ["777.00", "SOMEONE ELSE"],
    ]);
    const candidates = await candidateLines(accountsA, popId);
    expect(candidates[0]?.id).toBe(lines["CASH DEP 1"]!.id);
    expect(candidates.map((c) => c.reference)).not.toContain("SOMEONE ELSE");
    expect(await approvePop(accountsA, popId, lines["CASH DEP 1"]!.id)).toBe("approved");
    expect((await getLedger(adminA, l.id)).balanceCents).toBe(0);
  });

  it("links to a line already auto-matched to the lease without paying twice", async () => {
    const l = await lease(adminA);
    const lines = await bankLines([["5000.00", l.eftReference]]);
    expect((await getLedger(adminA, l.id)).balanceCents).toBe(0);
    const { popId } = await submit(accountsA, l.id, 500_000);
    expect((await candidateLines(accountsA, popId))[0]?.reasons).toContain("already paid to this lease");
    await approvePop(accountsA, popId, lines[l.eftReference]!.id);
    expect((await getLedger(adminA, l.id)).balanceCents).toBe(0);
  });

  it("marks a POP partial when the bank shows less than claimed", async () => {
    const l = await lease(adminA);
    const { popId } = await submit(accountsA, l.id, 500_000);
    const lines = await bankLines([["3000.00", `PART ${l.eftReference}`]]);
    expect(await approvePop(accountsA, popId, lines[`PART ${l.eftReference}`]!.id)).toBe("partial");
    expect((await getLedger(adminA, l.id)).balanceCents).toBe(200_000);
  });

  it("refuses a line that paid another lease or already proves another POP", async () => {
    const l1 = await lease(adminA);
    const l2 = await lease(adminA);
    const lines = await bankLines([["5000.00", l1.eftReference]]);
    const line = lines[l1.eftReference]!.id;
    const p2 = await submit(accountsA, l2.id, 500_000);
    await expect(approvePop(accountsA, p2.popId, line)).rejects.toThrow(/paid another lease/);
    const first = await submit(accountsA, l1.id, 500_000);
    const second = await submit(accountsA, l1.id, 500_000);
    await approvePop(accountsA, first.popId, line);
    await expect(approvePop(accountsA, second.popId, line)).rejects.toThrow(/already proves another payment/);
    await expect(approvePop(accountsA, first.popId, line)).rejects.toBeInstanceOf(LedgerRuleError);
  });

  it("rejects with a reason, once", async () => {
    const l = await lease(adminA);
    const { popId } = await submit(accountsA, l.id, 500_000);
    await rejectPop(accountsA, popId, "No such payment on the statement");
    await expect(rejectPop(accountsA, popId, "Again")).rejects.toBeInstanceOf(LedgerRuleError);
    expect((await listPops(accountsA, { leaseId: l.id }))[0]?.pop).toMatchObject({ status: "rejected", rejectReason: "No such payment on the statement" });
  });

  it("goes back to the queue when its bank line is undone", async () => {
    const l = await lease(adminA);
    const { popId } = await submit(accountsA, l.id, 500_000);
    const lines = await bankLines([["5000.00", "EFT FROM TENANT"]]);
    await approvePop(accountsA, popId, lines["EFT FROM TENANT"]!.id);
    await unallocateLine(accountsA, lines["EFT FROM TENANT"]!.id, "Wrong tenant");
    expect((await listPops(accountsA, { leaseId: l.id }))[0]?.pop).toMatchObject({ status: "pending", bankLineId: null });
    expect((await getLedger(adminA, l.id)).balanceCents).toBe(500_000);
  });
});

describe("who can do what", () => {
  it("lets agents upload POPs for their portfolio but not approve them", async () => {
    const l = await lease(adminA);
    await expect(submit(agentA, l.id, 100)).rejects.toBeInstanceOf(NotFoundError);
    await setPropertyAgents(adminA, l.property, [agentA.userId!]);
    const { popId } = await submit(agentA, l.id, 100);
    const lines = await bankLines([["1.00", "AGENT TEST"]]);
    await expect(approvePop(agentA, popId, lines["AGENT TEST"]!.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps each agency's POPs to itself", async () => {
    const l = await lease(adminA);
    const { popId } = await submit(accountsA, l.id, 500_000);
    await expect(submit(adminB, l.id, 100)).rejects.toBeInstanceOf(NotFoundError);
    await expect(rejectPop(adminB, popId, "Not mine")).rejects.toBeInstanceOf(NotFoundError);
    await expect(candidateLines(adminB, popId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listPops(adminB)).map((p) => p.pop.id)).not.toContain(popId);
  });
});
