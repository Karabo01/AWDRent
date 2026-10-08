import { describe, expect, it } from "vitest";
import { assertCan, can, ForbiddenError } from "./permissions";

describe("permissions", () => {
  it("lets only admins manage settings, staff, imports and bank details", () => {
    for (const action of ["settings.manage", "staff.manage", "import.run", "owner.bank.view", "owner.bank.edit"] as const) {
      expect(can("admin", action)).toBe(true);
      expect(can("agent", action)).toBe(false);
      expect(can("accounts", action)).toBe(false);
    }
  });

  it("gives accounts read-only access to records in Phase 1", () => {
    expect(can("accounts", "records.view")).toBe(true);
    expect(can("accounts", "records.edit")).toBe(false);
    expect(can("accounts", "tenant.id.view")).toBe(false);
  });

  it("lets agents edit records and see ID numbers (portfolio-scoped elsewhere)", () => {
    expect(can("agent", "records.edit")).toBe(true);
    expect(can("agent", "tenant.id.view")).toBe(true);
    expect(can("agent", "documents.delete")).toBe(false);
  });

  it("throws a ForbiddenError", () => {
    expect(() => assertCan("accounts", "staff.manage")).toThrow(ForbiddenError);
  });
});
