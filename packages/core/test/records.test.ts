import { closeDb, schema, withAgency } from "@awdrent/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { ForbiddenError } from "../src/permissions";
import {
  createOwner,
  findOwnersByIdNumber,
  getOwner,
  listOwners,
  type OwnerInput,
  revealOwnerBankAccount,
  updateOwner,
  updateOwnerBank,
} from "../src/owners";
import { type Actor, NotFoundError } from "../src/portfolio";
import { createProperty, createUnit, DuplicateUnitError, getProperty, listProperties, setPropertyAgents, updateProperty } from "../src/properties";
import { inviteStaff } from "../src/staff";

let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let adminA: Actor;
let adminB: Actor;
let agentA: Actor;
let accountsA: Actor;

const owner = (name: string, extra: Partial<OwnerInput> = {}): OwnerInput => ({
  kind: "individual",
  name,
  idKind: "sa_id",
  idOrRegNo: "",
  email: null,
  phone: null,
  postalAddress: null,
  commissionPercent: 1000,
  vatRegistered: false,
  vatNumber: null,
  notes: null,
  ...extra,
});
const property = (ownerId: string, name: string) => ({
  ownerId,
  name,
  type: "house" as const,
  addressLine1: "1 Main Road",
  addressLine2: null,
  suburb: null,
  city: "Johannesburg",
  province: null,
  postalCode: null,
  notes: null,
});
const unit = (label: string) => ({ label, bedrooms: 2, bathrooms: 1, status: "vacant" as const, notes: null });

beforeAll(async () => {
  a = await createAgencyWithAdmin("RecA");
  b = await createAgencyWithAdmin("RecB");
  adminA = { ctx: { agencyId: a.agency.id, userId: a.admin.id }, role: "admin", userId: a.admin.id };
  adminB = { ctx: { agencyId: b.agency.id, userId: b.admin.id }, role: "admin", userId: b.admin.id };
  const agentId = await inviteStaff(adminA.ctx, { name: "Agent A", email: `agent-${Date.now()}@reca.test`, role: "agent", phone: null });
  agentA = { ctx: { agencyId: a.agency.id, userId: agentId }, role: "agent", userId: agentId };
  const accId = await inviteStaff(adminA.ctx, { name: "Accounts A", email: `acc-${Date.now()}@reca.test`, role: "accounts", phone: null });
  accountsA = { ctx: { agencyId: a.agency.id, userId: accId }, role: "accounts", userId: accId };
});
afterAll(() => closeDb());

describe("records across agencies", () => {
  it("never shows or changes another agency's owner", async () => {
    const ownerB = await createOwner(adminB, owner("Bravo Owner"));
    await expect(getOwner(adminA, ownerB)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateOwner(adminA, ownerB, owner("Hijacked"))).rejects.toBeInstanceOf(NotFoundError);
    expect((await listOwners(adminA)).map((o) => o.id)).not.toContain(ownerB);
  });

  it("refuses to link a property to another agency's owner, even by raw insert (composite FK)", async () => {
    const ownerB = await createOwner(adminB, owner("Bravo Landlord"));
    await expect(createProperty(adminA, property(ownerB, "Sneaky"))).rejects.toBeInstanceOf(NotFoundError);
    const err = await withAgency(adminA.ctx, (tx) =>
      tx.insert(schema.properties).values(property(ownerB, "Raw insert")),
    ).catch((e: { cause?: { code?: string } }) => e.cause?.code);
    expect(err).toBe("23503");
  });

  it("refuses to re-point an existing property at another agency's owner", async () => {
    const ownerA = await createOwner(adminA, owner("Alpha Owner"));
    const ownerB = await createOwner(adminB, owner("Bravo Owner 2"));
    const prop = await createProperty(adminA, property(ownerA, "Alpha House"));
    const err = await withAgency(adminA.ctx, (tx) =>
      tx.execute(sql`update properties set owner_id = ${ownerB} where id = ${prop}`),
    ).catch((e: { cause?: { code?: string } }) => e.cause?.code);
    expect(err).toBe("23503");
  });
});

describe("agent portfolios", () => {
  it("limits agents to assigned properties and their owners", async () => {
    const ownerA = await createOwner(adminA, owner("Portfolio Owner"));
    const assigned = await createProperty(adminA, property(ownerA, "Assigned Flats"));
    const other = await createProperty(adminA, property(await createOwner(adminA, owner("Other Owner")), "Other Flats"));
    await setPropertyAgents(adminA, assigned, [agentA.userId!]);

    const visible = (await listProperties(agentA)).map((p) => p.property.id);
    expect(visible).toContain(assigned);
    expect(visible).not.toContain(other);
    await expect(getProperty(agentA, other)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createUnit(agentA, other, unit("Flat 1"))).rejects.toBeInstanceOf(NotFoundError);
    expect((await listOwners(agentA)).map((o) => o.name)).toContain("Portfolio Owner");
    expect((await listOwners(agentA)).map((o) => o.name)).not.toContain("Other Owner");
  });

  it("puts an agent's new property in their own portfolio", async () => {
    const mine = await createOwner(agentA, owner("Agent's Own Owner"));
    expect((await listOwners(agentA)).map((o) => o.id)).toContain(mine);
    const prop = await createProperty(agentA, property(mine, "Agent's Property"));
    expect((await getProperty(agentA, prop)).agents.map((x) => x.id)).toEqual([agentA.userId]);
    await updateProperty(agentA, prop, { ...property(mine, "Renamed by agent") });
  });

  it("only lets admins assign portfolios", async () => {
    const prop = await createProperty(adminA, property(await createOwner(adminA, owner("X")), "X House"));
    await expect(setPropertyAgents(agentA, prop, [agentA.userId!])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses assigning a user who is not an agent of this agency", async () => {
    const prop = await createProperty(adminA, property(await createOwner(adminA, owner("Y")), "Y House"));
    await expect(setPropertyAgents(adminA, prop, [b.admin.id])).rejects.toBeInstanceOf(NotFoundError);
    await expect(setPropertyAgents(adminA, prop, [a.admin.id])).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("accounts role", () => {
  it("can read every record but not edit", async () => {
    const o = await createOwner(adminA, owner("Read Only Owner"));
    expect((await getOwner(accountsA, o)).name).toBe("Read Only Owner");
    await expect(updateOwner(accountsA, o, owner("Edited"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createOwner(accountsA, owner("New"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("sensitive owner fields", () => {
  it("encrypts ID numbers, finds duplicates by blind index, and masks them", async () => {
    const id = await createOwner(adminA, owner("Thabo Mokoena", { idOrRegNo: "8001015009087" }));
    const [raw] = await withAgency(adminA.ctx, (tx) => tx.select().from(schema.owners).where(eq(schema.owners.id, id)));
    expect(raw?.idOrRegNoEnc).not.toContain("8001015009087");
    expect((await getOwner(adminA, id)).idOrRegNoLast4).toBe("9087");
    expect((await findOwnersByIdNumber(adminA, "8001 0150 0908 7")).map((o) => o.id)).toContain(id);
    // Same ID in another agency is not found from here
    await createOwner(adminB, owner("Same Person", { idOrRegNo: "8001015009087" }));
    expect(await findOwnersByIdNumber(adminA, "8001015009087")).toHaveLength(1);
  });

  it("lets only admins reveal bank accounts, and audits each reveal", async () => {
    const id = await createOwner(adminA, owner("Bank Owner"));
    await updateOwnerBank(adminA, id, {
      bankName: "Capitec",
      bankBranchCode: "470010",
      bankAccountHolder: "Bank Owner",
      bankAccountNo: "1234567890",
    });
    expect((await getOwner(adminA, id)).bankAccountNoLast4).toBe("7890");
    expect(await revealOwnerBankAccount(adminA, id)).toBe("1234567890");
    await expect(revealOwnerBankAccount(agentA, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revealOwnerBankAccount(accountsA, id)).rejects.toBeInstanceOf(ForbiddenError);
    const log = await withAgency(adminA.ctx, (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, id)),
    );
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["owner.bank_details_updated", "owner.bank_details_revealed"]));
    expect(JSON.stringify(log)).not.toContain("1234567890");
  });

  it("does not allow two units with the same label on one property", async () => {
    const prop = await createProperty(adminA, property(await createOwner(adminA, owner("Unit Owner")), "Unit Block"));
    await createUnit(adminA, prop, unit("Flat 1"));
    await expect(createUnit(adminA, prop, unit("Flat 1"))).rejects.toBeInstanceOf(DuplicateUnitError);
  });
});
