import { describe, expect, it } from "vitest";
import { parseMonth, parseSignedRand } from "./import";
import { leaseAmendSchema } from "./leases";

describe("import parsers", () => {
  it("reads months in the usual spreadsheet forms", () => {
    expect(parseMonth("2026-11")).toBe("2026-11-01");
    expect(parseMonth("2026-11-15")).toBe("2026-11-01");
    expect(parseMonth("11/2026")).toBe("2026-11-01");
    expect(parseMonth("01/11/2026")).toBe("2026-11-01");
    expect(parseMonth("13/2026")).toBeNull();
    expect(parseMonth("November")).toBeNull();
  });

  it("reads signed amounts, including accounting brackets", () => {
    expect(parseSignedRand("2500")).toBe(250_000);
    expect(parseSignedRand("-1 500,50")).toBe(-150_050);
    expect(parseSignedRand("(1500)")).toBe(-150_000);
    expect(parseSignedRand("")).toBe(0);
    expect(parseSignedRand(undefined)).toBe(0);
    expect(parseSignedRand("lots")).toBeNull();
  });
});

describe("lease form billing month", () => {
  const base = { startDate: "2026-11-01", endDate: "", rent: "7000", dueDay: "1", deposit: "0", escalationPercent: "", escalationDate: "", noticeDays: "30", notes: "", effectiveDate: "2026-11-01", reason: "Testing" };
  it("turns a month input into the first of that month, or null when empty", () => {
    expect(leaseAmendSchema.parse({ ...base, billingStartsOn: "2026-12" }).billingStartsOn).toBe("2026-12-01");
    expect(leaseAmendSchema.parse({ ...base, billingStartsOn: "" }).billingStartsOn).toBeNull();
    expect(leaseAmendSchema.safeParse({ ...base, billingStartsOn: "2026-13" }).success).toBe(false);
  });
});
