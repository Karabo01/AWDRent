import { closeDb, schema, withAgency } from "@awdrent/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgencyWithAdmin } from "../../db/test/fixtures";
import { getAgencySettings, trustAccountNumber, updateAgencySettings } from "../src/agency-settings";
import { inviteStaff, listStaff, StaffRuleError, updateStaff } from "../src/staff";

let a: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
let b: Awaited<ReturnType<typeof createAgencyWithAdmin>>;
const ctxA = () => ({ agencyId: a.agency.id, userId: a.admin.id });

beforeAll(async () => {
  a = await createAgencyWithAdmin("StaffA");
  b = await createAgencyWithAdmin("StaffB");
});
afterAll(() => closeDb());

const active = { name: "Agent Smith", role: "agent" as const, phone: null, active: true };

describe("staff management", () => {
  it("invites staff into the current agency only", async () => {
    const id = await inviteStaff(ctxA(), { name: "Agent Smith", email: `smith-${Date.now()}@a.test`, role: "agent", phone: null });
    expect((await listStaff(ctxA())).map((u) => u.id)).toContain(id);
    expect((await listStaff({ agencyId: b.agency.id })).map((u) => u.id)).not.toContain(id);
  });

  it("refuses an email already used anywhere on the platform", async () => {
    await expect(inviteStaff(ctxA(), { name: "Dup", email: b.admin.email, role: "agent", phone: null })).rejects.toBeInstanceOf(
      StaffRuleError,
    );
  });

  it("cannot touch another agency's staff", async () => {
    await expect(updateStaff(ctxA(), b.admin.id, { ...active, name: "hijack" })).rejects.toThrow("not found");
  });

  it("stops admins demoting or deactivating themselves", async () => {
    await expect(updateStaff(ctxA(), a.admin.id, { ...active, name: a.admin.name })).rejects.toThrow(/own admin access/);
  });

  it("keeps at least one active admin", async () => {
    const otherAdmin = await inviteStaff(ctxA(), { name: "Second Admin", email: `second-${Date.now()}@a.test`, role: "admin", phone: null });
    // Demoting the second admin is fine while the first remains
    expect(await updateStaff(ctxA(), otherAdmin, { ...active, name: "Second Admin", active: false })).toBe(true);
    // Acting as the second admin (reactivated), the first cannot be removed if they'd be the last
    await updateStaff(ctxA(), otherAdmin, { name: "Second Admin", role: "admin", phone: null, active: true });
    const ctx2 = { agencyId: a.agency.id, userId: otherAdmin };
    await updateStaff(ctx2, a.admin.id, { name: a.admin.name, role: "agent", phone: null, active: true });
    await expect(updateStaff({ agencyId: a.agency.id, userId: a.admin.id }, otherAdmin, { ...active, name: "Second Admin" })).rejects.toThrow(
      /at least one active admin/,
    );
    // restore
    await updateStaff(ctx2, a.admin.id, { name: a.admin.name, role: "admin", phone: null, active: true });
  });
});

describe("agency settings", () => {
  it("encrypts the trust account number and keeps it out of the audit log", async () => {
    await updateAgencySettings(ctxA(), {
      name: a.agency.name,
      brandColour: "#123456",
      trustBankName: "FNB",
      trustAccountNo: "62001234567",
      quietHoursStart: "20:00",
      quietHoursEnd: "07:00",
    });
    const [row] = await withAgency(ctxA(), (tx) => tx.select().from(schema.agencies).where(eq(schema.agencies.id, a.agency.id)));
    expect(row?.trustAccountNoEnc).toMatch(/^v\d+:/);
    expect(row?.trustAccountNoEnc).not.toContain("62001234567");
    expect(row?.trustAccountNoLast4).toBe("4567");
    expect(await trustAccountNumber(ctxA())).toBe("62001234567");
    expect((await getAgencySettings(ctxA())).trustAccountNoLast4).toBe("4567");

    const log = await withAgency(ctxA(), (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, "agency.settings_updated")),
    );
    expect(JSON.stringify(log)).not.toContain("62001234567");
    expect(log[0]?.after).toMatchObject({ trustAccountNoEnc: "[encrypted]", trustAccountNoLast4: "4567" });
  });

  it("leaves the number unchanged when the field is empty", async () => {
    await updateAgencySettings(ctxA(), {
      name: a.agency.name,
      brandColour: "#123456",
      trustBankName: "FNB",
      trustAccountNo: "",
      quietHoursStart: "21:00",
      quietHoursEnd: "07:00",
    });
    expect(await trustAccountNumber(ctxA())).toBe("62001234567");
  });
});
