import { closeDb, schema, withAgency } from "@awdrent/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { addMonths, monthStart, todayInSouthAfrica } from "../src/billing";
import { runImport } from "../src/import";
import { activateLease, createLease, getLease, type LeaseCreateInput, terminateLease } from "../src/leases";
import { addCharge, balances, getLedger, LedgerRuleError, runDailyBilling, voidCharge } from "../src/ledger";
import { createOwner } from "../src/owners";
import { ForbiddenError } from "../src/permissions";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit, setPropertyAgents } from "../src/properties";
import { inviteStaff } from "../src/staff";
import { createTenant } from "../src/tenants";

let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let agentA: Actor;
let accountsA: Actor;
const today = todayInSouthAfrica();
const thisMonth = monthStart(today);

async function newLease(actor: Actor, over: Partial<LeaseCreateInput> = {}) {
  const owner = await createOwner(actor, {
    kind: "individual",
    name: "Ledger Owner",
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
    name: `Ledger ${Math.random()}`,
    type: "house",
    addressLine1: "1 Road",
    addressLine2: null,
    suburb: null,
    city: "Durban",
    province: null,
    postalCode: null,
    notes: null,
  });
  const unitId = await createUnit(actor, property, { label: "Main", bedrooms: 2, bathrooms: 1, status: "vacant", notes: null });
  const tenantId = await createTenant(actor, {
    fullName: "Ledger Tenant",
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
  const lease = await createLease(actor, {
    unitId,
    primaryTenantId: tenantId,
    coTenantIds: [],
    startDate: addMonths(thisMonth, -2),
    billingStartsOn: null,
    endDate: null,
    rent: 500_000,
    dueDay: 31,
    deposit: 0,
    escalationPercent: null,
    escalationDate: null,
    noticeDays: 30,
    notes: null,
    ...over,
  });
  return { ...lease, property };
}

beforeAll(async () => {
  a = await createAgencyWithAdmin("LedgerA");
  b = await createAgencyWithAdmin("LedgerB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  const agentId = await inviteStaff(adminA.ctx, { name: "Ledger Agent", email: `lga-${Date.now()}@a.test`, role: "agent", phone: null });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
  const accId = await inviteStaff(adminA.ctx, { name: "Ledger Acc", email: `lgacc-${Date.now()}@a.test`, role: "accounts", phone: null });
  accountsA = { ctx: { agencyId: a.agency.id, userId: accId }, role: "accounts", userId: accId };
});
afterAll(() => closeDb());

describe("raising rent", () => {
  it("charges the months already started when a lease is activated", async () => {
    const { id } = await newLease(adminA);
    await activateLease(adminA, id);
    const ledger = await getLedger(adminA, id);
    expect(ledger.lines.map((l) => l.description)).toHaveLength(3);
    expect(ledger.balanceCents).toBe(1_500_000);
    // The two past months are overdue; this month is due on its last day
    expect(ledger.overdueCents).toBeGreaterThanOrEqual(1_000_000);
  });

  it("respects the billing start month (D44)", async () => {
    const { id } = await newLease(adminA, { billingStartsOn: thisMonth });
    await activateLease(adminA, id);
    expect((await getLedger(adminA, id)).balanceCents).toBe(500_000);
  });

  it("raises each later month once, however often the job runs", async () => {
    const { id } = await newLease(adminA, { billingStartsOn: thisMonth });
    await activateLease(adminA, id);
    const nextMonth = addMonths(thisMonth, 1);
    await runDailyBilling(a.agency.id, nextMonth);
    await runDailyBilling(a.agency.id, nextMonth);
    await runDailyBilling(a.agency.id, addMonths(thisMonth, 1).replace(/01$/, "15"));
    expect((await getLedger(adminA, id, nextMonth)).balanceCents).toBe(1_000_000);
  });

  it("applies escalations on their date before raising that month (D46)", async () => {
    const escalationMonth = addMonths(thisMonth, 2);
    const { id } = await newLease(adminA, { billingStartsOn: thisMonth, escalationPercent: 1000, escalationDate: escalationMonth });
    await activateLease(adminA, id);
    const result = await runDailyBilling(a.agency.id, escalationMonth);
    expect(result.escalated).toBeGreaterThanOrEqual(1);
    const rents = (await getLedger(adminA, id, escalationMonth)).lines.map((l) => l.debitCents);
    expect(rents).toEqual([500_000, 500_000, 550_000]);
    expect((await getLease(adminA, id)).lease).toMatchObject({ rentCents: 550_000, escalationDate: addMonths(escalationMonth, 12) });
  });

  it("stops charging after termination", async () => {
    const { id } = await newLease(adminA, { billingStartsOn: thisMonth });
    await activateLease(adminA, id);
    await terminateLease(adminA, id, { terminatedOn: today, reason: "Moved out" });
    await runDailyBilling(a.agency.id, addMonths(thisMonth, 3));
    expect((await getLedger(adminA, id, addMonths(thisMonth, 3))).balanceCents).toBe(500_000);
  });
});

describe("charges and voids", () => {
  it("adds charges, voids them with a reason, and keeps both on the statement", async () => {
    const { id } = await newLease(adminA, { billingStartsOn: thisMonth });
    await activateLease(adminA, id);
    const chargeId = await addCharge(agentA.userId ? adminA : adminA, id, { type: "utility", amount: 45_050, dueDate: today, description: "Water September" });
    expect((await getLedger(adminA, id)).balanceCents).toBe(545_050);
    await voidCharge(accountsA, chargeId, "Billed to the wrong unit");
    const ledger = await getLedger(adminA, id);
    expect(ledger.balanceCents).toBe(500_000);
    expect(ledger.lines.find((l) => l.id === chargeId)).toMatchObject({ counts: false, note: "Voided: Billed to the wrong unit" });
    await expect(voidCharge(accountsA, chargeId, "Again please")).rejects.toBeInstanceOf(LedgerRuleError);
  });

  it("lets agents add charges in their portfolio but not void them", async () => {
    const { id, property } = await newLease(adminA, { billingStartsOn: thisMonth });
    await activateLease(adminA, id);
    await expect(addCharge(agentA, id, { type: "other", amount: 100, dueDate: today, description: "Keys" })).rejects.toBeInstanceOf(NotFoundError);
    await setPropertyAgents(adminA, property, [agentA.userId!]);
    const chargeId = await addCharge(agentA, id, { type: "other", amount: 10_000, dueDate: today, description: "Replacement keys" });
    await expect(voidCharge(agentA, chargeId, "Changed my mind")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses charges on a draft lease", async () => {
    const { id } = await newLease(adminA);
    await expect(addCharge(adminA, id, { type: "other", amount: 100, dueDate: today, description: "Too early" })).rejects.toBeInstanceOf(LedgerRuleError);
  });
});

describe("database guards", () => {
  async function code(p: Promise<unknown>) {
    return p.then(
      () => "ok",
      (e: { cause?: { code?: string } }) => e.cause?.code,
    );
  }

  it("never deletes or edits a charge, and never un-voids one", async () => {
    const { id } = await newLease(adminA, { billingStartsOn: thisMonth });
    await activateLease(adminA, id);
    const [rent] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.charges).where(eq(schema.charges.leaseId, id)));
    expect(await code(withAgency(adminA.ctx, (tx) => tx.delete(schema.charges).where(eq(schema.charges.id, rent!.id))))).toBe("42501");
    expect(await code(withAgency(adminA.ctx, (tx) => tx.execute(sql`update charges set amount_cents = 1 where id = ${rent!.id}`)))).toBe("42501");
    await voidCharge(adminA, rent!.id, "Testing the guard");
    expect(
      await code(withAgency(adminA.ctx, (tx) => tx.execute(sql`update charges set voided_at = null, void_reason = null where id = ${rent!.id}`))),
    ).toBe("23514");
  });

  it("allows one live rent charge per lease per month", async () => {
    const { id } = await newLease(adminA, { billingStartsOn: thisMonth });
    await activateLease(adminA, id);
    expect(
      await code(
        withAgency(adminA.ctx, (tx) =>
          tx.insert(schema.charges).values({ leaseId: id, type: "rent", period: thisMonth, dueDate: today, amountCents: 1, description: "Twice" }),
        ),
      ),
    ).toBe("23505");
  });

  it("freezes a payment once approved", async () => {
    const { id } = await newLease(adminA, { billingStartsOn: thisMonth });
    await activateLease(adminA, id);
    const [p] = await withAgency(adminA.ctx, (tx) =>
      tx.insert(schema.payments).values({ leaseId: id, amountCents: 100, paidOn: today, source: "manual", status: "approved", approvedAt: sql`now()` }).returning(),
    );
    expect(await code(withAgency(adminA.ctx, (tx) => tx.update(schema.payments).set({ status: "rejected" }).where(eq(schema.payments.id, p!.id))))).toBe(
      "23514",
    );
  });
});

describe("ledgers across agencies", () => {
  it("hides another agency's ledger and refuses charges on its leases", async () => {
    const { id } = await newLease(adminA, { billingStartsOn: thisMonth });
    await activateLease(adminA, id);
    await expect(getLedger(adminB, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addCharge(adminB, id, { type: "other", amount: 100, dueDate: today, description: "Sneaky" })).rejects.toBeInstanceOf(NotFoundError);
    const fk = await withAgency(adminB.ctx, (tx) =>
      tx.insert(schema.charges).values({ leaseId: id, type: "other", dueDate: today, amountCents: 100, description: "Raw" }),
    ).then(
      () => "ok",
      (e: { cause?: { code?: string } }) => e.cause?.code,
    );
    expect(fk).toBe("23503");
    expect((await balances(adminB, [id])).size).toBe(0);
    expect((await balances(adminA, [id])).get(id)).toBe(500_000);
  });
});

describe("imported leases (D45)", () => {
  it("bill from next month by default and carry opening arrears or credit", async () => {
    const files = {
      owners: "owner_ref,name,commission_percent\nO1,Import Ledger Owner,10",
      properties: "property_ref,owner_ref,name,address_line1,city\nP1,O1,Import Ledger House,1 Road,Durban",
      units: "property_ref,unit_label\nP1,A\nP1,B",
      tenants: "tenant_ref,full_name,consent_given\nT1,Arrears Tenant,yes\nT2,Credit Tenant,yes",
      leases: `property_ref,unit_label,primary_tenant_ref,status,start_date,rent,due_day,opening_balance
P1,A,T1,active,2025-01-01,7000,1,2500
P1,B,T2,active,2025-01-01,6000,1,-1500.50`,
    };
    await runImport(adminA, files, ["x"]);
    const leases = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.leases).where(eq(schema.leases.startDate, "2025-01-01")));
    const ids = leases.map((l) => l.id);
    expect(leases.every((l) => l.billingStartsOn === addMonths(thisMonth, 1))).toBe(true);
    const bal = await balances(adminA, ids);
    expect([...bal.values()].sort((x, y) => x - y)).toEqual([-150_050, 250_000]);
    // Next month's rent arrives via the daily job
    await runDailyBilling(a.agency.id, addMonths(thisMonth, 1));
    const after = await balances(adminA, ids);
    expect([...after.values()].sort((x, y) => x - y)).toEqual([449_950, 950_000]);
  });

  it("refuses a malformed opening balance or billing month", async () => {
    const { checkImport } = await import("../src/import");
    const report = await checkImport(adminA, {
      owners: "owner_ref,name,commission_percent\nO1,Check Owner,10",
      properties: "property_ref,owner_ref,name,address_line1,city\nP1,O1,Check House,1 Road,Durban",
      units: "property_ref,unit_label\nP1,A\nP1,B",
      tenants: "tenant_ref,full_name\nT1,Check Tenant",
      leases: `property_ref,unit_label,primary_tenant_ref,status,start_date,rent,due_day,opening_balance,billing_starts
P1,A,T1,active,2025-01-01,7000,1,lots,
P1,B,T1,active,2025-01-01,7000,1,,13/2026`,
    });
    expect(report.errors.map((e) => e.column)).toEqual(["opening_balance", "billing_starts"]);
  });
});
