import { closeDb, schema, withAgency } from "@awdrent/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { allocateLine, BankImportError, ignoreLine, importStatement, listLines, saveProfile, unallocateLine } from "../src/banking";
import { monthStart, todayInSouthAfrica } from "../src/billing";
import { getDeposit } from "../src/deposits";
import { activateLease, createLease } from "../src/leases";
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
let profileA: string;
let profileB: string;
const today = todayInSouthAfrica();
let fileNo = 0;

const profile = {
  name: "FNB CSV",
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

/** A statement CSV; a unique comment column value keeps each file distinct. */
function statement(lines: [string, string, string][]): string {
  return ["Date,Amount,Reference,Description", ...lines.map(([d, amt, ref]) => `${d},${amt},${ref},file ${fileNo}`)].join("\n");
}
const run = (actor: Actor, profileId: string, csv: string) => importStatement(actor, { profileId, fileName: `statement-${++fileNo}.csv`, csv });

async function activeLease(actor: Actor, opts: { draft?: boolean } = {}) {
  const owner = await createOwner(actor, {
    kind: "individual",
    name: "Bank Owner",
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
    name: `Bank ${Math.random()}`,
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
    fullName: "Bank Tenant",
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
  if (!opts.draft) await activateLease(actor, lease.id);
  return lease;
}

beforeAll(async () => {
  a = await createAgencyWithAdmin("BankA");
  b = await createAgencyWithAdmin("BankB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  const accId = await inviteStaff(adminA.ctx, { name: "Bank Accounts", email: `bacc-${Date.now()}@a.test`, role: "accounts", phone: null });
  accountsA = { ctx: { agencyId: a.agency.id, userId: accId }, role: "accounts", userId: accId };
  const agentId = await inviteStaff(adminA.ctx, { name: "Bank Agent", email: `bagent-${Date.now()}@a.test`, role: "agent", phone: null });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
  profileA = await saveProfile(accountsA, profile);
  profileB = await saveProfile(adminB, profile);
});
afterAll(() => closeDb());

describe("importing statements", () => {
  it("matches lines by EFT reference and pays the rent", async () => {
    const lease = await activeLease(adminA);
    const ref = lease.eftReference.replace("-", " ");
    const result = await run(accountsA, profileA, statement([[today, "5000.00", ref], [today, "123.00", "UNKNOWN PAYER"]]));
    expect(result).toMatchObject({ creditLines: 2, newLines: 2, autoMatched: 1 });
    expect((await getLedger(adminA, lease.id)).balanceCents).toBe(0);
    const open = await listLines(accountsA, { status: "unmatched", importId: result.importId });
    expect(open.map((l) => l.line.reference)).toEqual(["UNKNOWN PAYER"]);
  });

  it("refuses the same file twice and skips lines already imported from an overlapping file", async () => {
    const lease = await activeLease(adminA);
    const csv = statement([[today, "2500.00", lease.eftReference]]);
    await run(accountsA, profileA, csv);
    await expect(run(accountsA, profileA, csv)).rejects.toBeInstanceOf(BankImportError);
    // Same line plus a new one, in a differently named/shaped file
    const overlap = `${csv}\n${today},2500.00,${lease.eftReference},file ${fileNo}`;
    const second = await importStatement(accountsA, { profileId: profileA, fileName: "overlap.csv", csv: overlap });
    expect(second).toMatchObject({ creditLines: 2, newLines: 1, autoMatched: 1 });
    expect((await getLedger(adminA, lease.id)).balanceCents).toBe(0);
  });

  it("imports nothing if any row is unreadable", async () => {
    await expect(run(accountsA, profileA, statement([[today, "100", "X"], ["not a date", "100", "Y"]]))).rejects.toBeInstanceOf(BankImportError);
    expect((await listLines(accountsA, { status: "unmatched" })).some((l) => l.line.reference === "Y")).toBe(false);
  });

  it("is for accounts and admins only", async () => {
    await expect(run(agentA, profileA, statement([[today, "1", "Z"]]))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("resolving lines by hand", () => {
  it("allocates to rent or deposit, ignores with a reason, and undoes each", async () => {
    const lease = await activeLease(adminA);
    const { importId } = await run(accountsA, profileA, statement([[today, "5000", "CASH DEP"], [today, "10000", "MRS T"], [today, "999", "OWNER TRANSFER"]]));
    const lines = Object.fromEntries((await listLines(accountsA, { importId })).map((l) => [l.line.reference, l.line.id]));

    await allocateLine(accountsA, lines["CASH DEP"]!, lease.id, "rent");
    await allocateLine(accountsA, lines["MRS T"]!, lease.id, "deposit");
    await ignoreLine(accountsA, lines["OWNER TRANSFER"]!, "Owner topping up the trust account");
    expect((await getLedger(adminA, lease.id)).balanceCents).toBe(0);
    expect((await getDeposit(adminA, lease.id)).heldCents).toBe(1_000_000);
    await expect(allocateLine(accountsA, lines["CASH DEP"]!, lease.id, "rent")).rejects.toBeInstanceOf(LedgerRuleError);

    await unallocateLine(accountsA, lines["CASH DEP"]!, "Belongs to another tenant");
    await unallocateLine(accountsA, lines["MRS T"]!, "Wrong lease");
    await unallocateLine(accountsA, lines["OWNER TRANSFER"]!, "Actually rent");
    const ledger = await getLedger(adminA, lease.id);
    expect(ledger.balanceCents).toBe(500_000);
    expect(ledger.lines.some((l) => l.note?.startsWith("Reversed: Bank line unallocated"))).toBe(true);
    expect((await getDeposit(adminA, lease.id)).heldCents).toBe(0);
    expect((await listLines(accountsA, { importId, status: "unmatched" })).length).toBe(3);
  });

  it("will not put rent on a draft lease", async () => {
    const draft = await activeLease(adminA, { draft: true });
    const { importId } = await run(accountsA, profileA, statement([[today, "100", "EARLY"]]));
    const [line] = await listLines(accountsA, { importId });
    await expect(allocateLine(accountsA, line!.line.id, draft.id, "rent")).rejects.toThrow(/Activate the lease/);
    await allocateLine(accountsA, line!.line.id, draft.id, "deposit");
  });
});

describe("banking across agencies", () => {
  it("never matches or allocates to another agency's lease", async () => {
    const leaseA = await activeLease(adminA);
    // Agency B's statement carries agency A's reference: it must not match
    const { autoMatched, importId } = await run(adminB, profileB, statement([[today, "5000", leaseA.eftReference]]));
    expect(autoMatched).toBe(0);
    const [lineB] = await listLines(adminB, { importId });
    await expect(allocateLine(adminB, lineB!.line.id, leaseA.id, "rent")).rejects.toBeInstanceOf(NotFoundError);
    await expect(allocateLine(adminA, lineB!.line.id, leaseA.id, "rent")).rejects.toBeInstanceOf(NotFoundError);
    await expect(run(adminB, profileA, statement([[today, "1", "X"]]))).rejects.toBeInstanceOf(NotFoundError);
    expect((await getLedger(adminA, leaseA.id)).balanceCents).toBe(500_000);
  });

  it("keeps what the bank said unchangeable, and a line pays for one thing", async () => {
    const lease = await activeLease(adminA);
    const { importId } = await run(accountsA, profileA, statement([[today, "5000", lease.eftReference]]));
    const [line] = await listLines(accountsA, { importId });
    const code = (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (e: { cause?: { code?: string } }) => e.cause?.code,
      );
    expect(await code(withAgency(adminA.ctx, (tx) => tx.execute(sql`update bank_lines set amount_cents = 1 where id = ${line!.line.id}`)))).toBe("42501");
    expect(await code(withAgency(adminA.ctx, (tx) => tx.delete(schema.bankLines).where(eq(schema.bankLines.id, line!.line.id))))).toBe("42501");
    expect(
      await code(
        withAgency(adminA.ctx, (tx) =>
          tx.insert(schema.payments).values({
            leaseId: lease.id,
            amountCents: 5000,
            paidOn: today,
            source: "bank_import",
            status: "approved",
            approvedAt: sql`now()`,
            bankLineId: line!.line.id,
          }),
        ),
      ),
    ).toBe("23505");
  });
});
