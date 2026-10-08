import { closeDb, schema, withAgency } from "@awdrent/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { monthStart, todayInSouthAfrica } from "../src/billing";
import {
  getDeposit,
  recordDepositDeduction,
  recordDepositInterest,
  recordDepositReceived,
  recordDepositRefund,
  voidDepositEntry,
} from "../src/deposits";
import { activateLease, createLease, endLease, giveNotice } from "../src/leases";
import { getLedger, LedgerRuleError } from "../src/ledger";
import { createOwner } from "../src/owners";
import { ForbiddenError } from "../src/permissions";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit } from "../src/properties";
import { inviteStaff } from "../src/staff";
import { createTenant } from "../src/tenants";

let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let accountsA: Actor;
let agentA: Actor;
const today = todayInSouthAfrica();

/** An active lease, rent R5 000 from this month (so R5 000 owed), deposit R10 000. */
async function activeLease(actor: Actor) {
  const owner = await createOwner(actor, {
    kind: "individual",
    name: "Deposit Owner",
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
    name: `Deposit ${Math.random()}`,
    type: "house",
    addressLine1: "1 Road",
    addressLine2: null,
    suburb: null,
    city: "Pretoria",
    province: null,
    postalCode: null,
    notes: null,
  });
  const unitId = await createUnit(actor, property, { label: "Main", bedrooms: 2, bathrooms: 1, status: "vacant", notes: null });
  const tenantId = await createTenant(actor, {
    fullName: "Deposit Tenant",
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
  const { id } = await createLease(actor, {
    unitId,
    primaryTenantId: tenantId,
    coTenantIds: [],
    startDate: monthStart(today),
    billingStartsOn: null,
    endDate: null,
    rent: 500_000,
    dueDay: 1,
    deposit: 1_000_000,
    escalationPercent: null,
    escalationDate: null,
    noticeDays: 30,
    notes: null,
  });
  await activateLease(actor, id);
  return id;
}

const money = (amount: number, reference = "TRUST-123") => ({ amount, date: today, reference });

beforeAll(async () => {
  a = await createAgencyWithAdmin("DepA");
  b = await createAgencyWithAdmin("DepB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  const accId = await inviteStaff(adminA.ctx, { name: "Dep Accounts", email: `dacc-${Date.now()}@a.test`, role: "accounts", phone: null });
  accountsA = { ctx: { agencyId: a.agency.id, userId: accId }, role: "accounts", userId: accId };
  const agentId = await inviteStaff(adminA.ctx, { name: "Dep Agent", email: `dagent-${Date.now()}@a.test`, role: "agent", phone: null });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
});
afterAll(() => closeDb());

describe("deposit held", () => {
  it("adds up received and interest, and shows what is still outstanding", async () => {
    const lease = await activeLease(adminA);
    await recordDepositReceived(accountsA, lease, money(600_000));
    let d = await getDeposit(adminA, lease);
    expect(d).toMatchObject({ requiredCents: 1_000_000, receivedCents: 600_000, outstandingCents: 400_000, heldCents: 600_000 });
    await recordDepositReceived(accountsA, lease, money(400_000));
    await recordDepositInterest(accountsA, lease, money(1_234, "INV-2026-09"));
    d = await getDeposit(adminA, lease);
    expect(d).toMatchObject({ outstandingCents: 0, interestCents: 1_234, heldCents: 1_001_234 });
  });

  it("is managed by admins and accounts only", async () => {
    const lease = await activeLease(adminA);
    await expect(recordDepositReceived(agentA, lease, money(100))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses interest before any deposit is received", async () => {
    const lease = await activeLease(adminA);
    await expect(recordDepositInterest(accountsA, lease, money(100))).rejects.toBeInstanceOf(LedgerRuleError);
  });
});

describe("end of tenancy", () => {
  it("allows deductions only once the tenancy is ending, and never more than is held", async () => {
    const lease = await activeLease(adminA);
    await recordDepositReceived(accountsA, lease, money(1_000_000));
    const deduction = { kind: "damage" as const, amount: 50_000, date: today, description: "Broken window" };
    await expect(recordDepositDeduction(accountsA, lease, deduction)).rejects.toThrow(/tenancy ends/);
    await giveNotice(adminA, lease, { noticeDate: today, endDate: today, note: "" });
    await recordDepositDeduction(accountsA, lease, deduction);
    await expect(recordDepositDeduction(accountsA, lease, { ...deduction, amount: 2_000_000 })).rejects.toThrow(/more than the deposit held/);
    expect((await getDeposit(adminA, lease)).heldCents).toBe(950_000);
  });

  it("pays unpaid rent from the deposit, clearing the arrears on the rent ledger", async () => {
    const lease = await activeLease(adminA);
    await recordDepositReceived(accountsA, lease, money(1_000_000));
    await giveNotice(adminA, lease, { noticeDate: today, endDate: today, note: "" });
    expect((await getLedger(adminA, lease)).balanceCents).toBe(500_000);
    await expect(
      recordDepositDeduction(accountsA, lease, { kind: "rent_arrears", amount: 600_000, date: today, description: "Last month" }),
    ).rejects.toThrow(/more than the rent owed/);
    await recordDepositDeduction(accountsA, lease, { kind: "rent_arrears", amount: 500_000, date: today, description: "Last month" });
    const ledger = await getLedger(adminA, lease);
    expect(ledger.balanceCents).toBe(0);
    expect(ledger.lines.map((l) => l.description)).toContain("Paid from deposit");
    expect((await getDeposit(adminA, lease)).heldCents).toBe(500_000);
  });

  it("refunds only after the lease has ended, and not more than is held", async () => {
    const lease = await activeLease(adminA);
    await recordDepositReceived(accountsA, lease, money(1_000_000));
    await expect(recordDepositRefund(accountsA, lease, money(1_000_000))).rejects.toThrow(/after the lease has ended/);
    await giveNotice(adminA, lease, { noticeDate: today, endDate: today, note: "" });
    await endLease(adminA, lease);
    await expect(recordDepositRefund(accountsA, lease, money(1_000_001))).rejects.toThrow(/more than the deposit held/);
    await recordDepositRefund(accountsA, lease, money(1_000_000, "EFT-REFUND-1"));
    expect((await getDeposit(adminA, lease)).heldCents).toBe(0);
  });
});

describe("voiding", () => {
  it("voiding an unpaid-rent deduction reverses the rent payment it made", async () => {
    const lease = await activeLease(adminA);
    await recordDepositReceived(accountsA, lease, money(1_000_000));
    await giveNotice(adminA, lease, { noticeDate: today, endDate: today, note: "" });
    const entry = await recordDepositDeduction(accountsA, lease, { kind: "rent_arrears", amount: 500_000, date: today, description: "Last month" });
    await voidDepositEntry(accountsA, entry, "Tenant paid by EFT instead");
    expect((await getDeposit(adminA, lease)).heldCents).toBe(1_000_000);
    const ledger = await getLedger(adminA, lease);
    expect(ledger.balanceCents).toBe(500_000);
    expect(ledger.lines.find((l) => l.description === "Paid from deposit")?.note).toBe("Reversed: Deposit deduction voided: Tenant paid by EFT instead");
  });

  it("refuses a void that would leave less than nothing held", async () => {
    const lease = await activeLease(adminA);
    const received = await recordDepositReceived(accountsA, lease, money(1_000_000));
    await giveNotice(adminA, lease, { noticeDate: today, endDate: today, note: "" });
    await endLease(adminA, lease);
    await recordDepositRefund(accountsA, lease, money(1_000_000));
    await expect(voidDepositEntry(accountsA, received, "Wrong amount")).rejects.toThrow(/less than nothing/);
  });
});

describe("database guards and agencies", () => {
  it("never deletes deposit entries, and a reversed payment stays reversed", async () => {
    const lease = await activeLease(adminA);
    const entry = await recordDepositReceived(accountsA, lease, money(1_000));
    const del = await withAgency(adminA.ctx, (tx) => tx.delete(schema.depositEntries).where(eq(schema.depositEntries.id, entry))).then(
      () => "ok",
      (e: { cause?: { code?: string } }) => e.cause?.code,
    );
    expect(del).toBe("42501");
    const [p] = await withAgency(adminA.ctx, (tx) =>
      tx
        .insert(schema.payments)
        .values({ leaseId: lease, amountCents: 100, paidOn: today, source: "manual", status: "approved", approvedAt: sql`now()` })
        .returning(),
    );
    await withAgency(adminA.ctx, (tx) =>
      tx.update(schema.payments).set({ status: "reversed", reversedAt: sql`now()`, reversalReason: "Bounced" }).where(eq(schema.payments.id, p!.id)),
    );
    const back = await withAgency(adminA.ctx, (tx) =>
      tx.update(schema.payments).set({ status: "approved", reversedAt: null, reversalReason: null }).where(eq(schema.payments.id, p!.id)),
    ).then(
      () => "ok",
      (e: { cause?: { code?: string } }) => e.cause?.code,
    );
    expect(back).toBe("23514");
  });

  it("keeps each agency's deposits to itself", async () => {
    const lease = await activeLease(adminA);
    const entry = await recordDepositReceived(accountsA, lease, money(1_000));
    await expect(getDeposit(adminB, lease)).rejects.toBeInstanceOf(NotFoundError);
    await expect(recordDepositReceived(adminB, lease, money(1_000))).rejects.toBeInstanceOf(NotFoundError);
    await expect(voidDepositEntry(adminB, entry, "Not mine")).rejects.toBeInstanceOf(NotFoundError);
  });
});
