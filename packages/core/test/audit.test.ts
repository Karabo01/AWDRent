import { closeDb, schema, withAgency } from "@awdrent/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { audit } from "../src/audit";

let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;

beforeAll(async () => {
  a = await createAgencyWithAdmin("AuditA");
  b = await createAgencyWithAdmin("AuditB");
});
afterAll(() => closeDb());

async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    return (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
  }
  throw new Error("expected failure");
}

describe("audit log", () => {
  it("records the acting user from the transaction, not the caller", async () => {
    await withAgency({ agencyId: a.agency.id, userId: a.admin.id }, async (tx) => {
      await audit(tx, { action: "test.created", entity: "test", after: { ownerAccountNoEnc: "v1:xyz", name: "x" } });
      // A caller trying to forge the actor is overridden by the trigger
      await tx.insert(schema.auditLog).values({ action: "test.forged", entity: "test", userId: null });
    });
    const rows = await withAgency({ agencyId: a.agency.id }, (tx) => tx.select().from(schema.auditLog));
    expect(rows.map((r) => [r.action, r.userId])).toEqual(
      expect.arrayContaining([
        ["test.created", a.admin.id],
        ["test.forged", a.admin.id],
      ]),
    );
    const created = rows.find((r) => r.action === "test.created");
    expect(created?.after).toEqual({ ownerAccountNoEnc: "[encrypted]", name: "x" });
  });

  it("rolls back with the change it describes", async () => {
    await expect(
      withAgency({ agencyId: a.agency.id }, async (tx) => {
        await audit(tx, { action: "test.rolled_back", entity: "test" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await withAgency({ agencyId: a.agency.id }, (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, "test.rolled_back")),
    );
    expect(rows).toEqual([]);
  });

  it("cannot be updated, deleted or truncated", async () => {
    expect(
      await pgCode(withAgency({ agencyId: a.agency.id }, (tx) => tx.update(schema.auditLog).set({ action: "edited" }))),
    ).toBe("42501");
    expect(await pgCode(withAgency({ agencyId: a.agency.id }, (tx) => tx.delete(schema.auditLog)))).toBe("42501");
    expect(
      await pgCode(withAgency({ agencyId: a.agency.id }, (tx) => tx.execute(sql`truncate audit_log`))),
    ).toBe("42501");
  });

  it("is invisible to other agencies", async () => {
    await withAgency({ agencyId: b.agency.id, userId: b.admin.id }, (tx) =>
      audit(tx, { action: "test.b_only", entity: "test" }),
    );
    const seenByA = await withAgency({ agencyId: a.agency.id }, (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, "test.b_only")),
    );
    expect(seenByA).toEqual([]);
  });

  it("rejects writing an entry into another agency's log", async () => {
    const code = await pgCode(
      withAgency({ agencyId: a.agency.id }, (tx) =>
        tx.insert(schema.auditLog).values({ agencyId: b.agency.id, action: "test.cross", entity: "test" }),
      ),
    );
    expect(code).toBe("42501");
  });

  it("rejects an acting user from another agency", async () => {
    const code = await pgCode(
      withAgency({ agencyId: a.agency.id, userId: b.admin.id }, (tx) => audit(tx, { action: "x", entity: "test" })),
    );
    expect(code).toBe("23503");
  });
});
