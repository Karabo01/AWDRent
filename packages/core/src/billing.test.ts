import { describe, expect, it } from "vitest";
import { addMonths, dueDateFor, monthsToBill, todayInSouthAfrica } from "./billing";
import { allocate, statement } from "./ledger";

const lease = (over: Partial<Parameters<typeof monthsToBill>[0]> = {}) => ({
  status: "active",
  startDate: "2026-08-15",
  endDate: null,
  billingStartsOn: null,
  terminatedOn: null,
  ...over,
});

describe("rent months (D35, D44)", () => {
  it("charges full months from the start month to the current month", () => {
    expect(monthsToBill(lease(), "2026-10-08")).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });

  it("starts at the billing start month when set", () => {
    expect(monthsToBill(lease({ billingStartsOn: "2026-10-01" }), "2026-12-01")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
  });

  it("stops at the end or termination month, whichever is first", () => {
    expect(monthsToBill(lease({ endDate: "2026-09-30" }), "2027-01-01")).toEqual(["2026-08-01", "2026-09-01"]);
    expect(monthsToBill(lease({ endDate: "2027-07-31", terminatedOn: "2026-08-20" }), "2027-01-01")).toEqual(["2026-08-01"]);
  });

  it("charges nothing for future, draft or closed leases", () => {
    expect(monthsToBill(lease({ startDate: "2026-11-01" }), "2026-10-08")).toEqual([]);
    expect(monthsToBill(lease({ status: "draft" }), "2026-10-08")).toEqual([]);
    expect(monthsToBill(lease({ status: "ended" }), "2026-10-08")).toEqual([]);
  });

  it("uses the last day of short months for late due days (D18)", () => {
    expect(dueDateFor("2026-02-01", 31)).toBe("2026-02-28");
    expect(dueDateFor("2028-02-01", 30)).toBe("2028-02-29");
    expect(dueDateFor("2026-04-01", 31)).toBe("2026-04-30");
    expect(dueDateFor("2026-01-01", 1)).toBe("2026-01-01");
  });

  it("does month arithmetic across years", () => {
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });

  it("uses the South African date, not UTC", () => {
    // 23:30 UTC on 31 Oct is already 1 Nov in Johannesburg
    expect(todayInSouthAfrica(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
  });
});

const charge = (id: string, dueDate: string, amountCents: number, voided = false) => ({
  id,
  dueDate,
  amountCents,
  createdAt: new Date(`${dueDate}T00:00:00Z`),
  voidedAt: voided ? new Date() : null,
});

describe("oldest-first allocation (D34)", () => {
  it("pays the oldest charges first and carries credit forward", () => {
    const { charges, creditCents } = allocate([charge("mar", "2026-03-01", 500), charge("jan", "2026-01-01", 500), charge("feb", "2026-02-01", 500)], 700);
    expect(charges.map((c) => [c.id, c.outstandingCents])).toEqual([
      ["jan", 0],
      ["feb", 300],
      ["mar", 500],
    ]);
    expect(creditCents).toBe(0);
    expect(allocate([charge("a", "2026-01-01", 500)], 800).creditCents).toBe(300);
  });

  it("ignores voided charges", () => {
    const { charges } = allocate([charge("a", "2026-01-01", 500, true), charge("b", "2026-02-01", 500)], 500);
    expect(charges.map((c) => [c.id, c.outstandingCents])).toEqual([["b", 0]]);
  });
});

describe("statement", () => {
  it("runs the balance over charges and approved payments only", () => {
    const base = { leaseId: "l", agencyId: "a", updatedAt: new Date(), createdBy: null };
    const lines = statement(
      [
        { ...base, ...charge("c1", "2026-01-01", 1000), type: "rent", period: "2026-01-01", description: "Rent Jan", voidReason: null, voidedBy: null },
        { ...base, ...charge("c2", "2026-01-05", 200, true), type: "other", period: null, description: "Mistake", voidReason: "typo", voidedBy: null },
      ],
      [
        { ...base, id: "p1", amountCents: 600, paidOn: "2026-01-03", source: "bank_import", status: "approved", bankLineId: null, reference: "KL-0001", notes: null, approvedBy: null, approvedAt: new Date(), createdAt: new Date() },
        { ...base, id: "p2", amountCents: 999, paidOn: "2026-01-04", source: "pop", status: "pending", bankLineId: null, reference: null, notes: null, approvedBy: null, approvedAt: null, createdAt: new Date() },
      ],
    );
    expect(lines.map((l) => [l.id, l.counts, l.balanceCents])).toEqual([
      ["c1", true, 1000],
      ["p1", true, 400],
      ["p2", false, 400],
      ["c2", false, 400],
    ]);
    expect(lines.find((l) => l.id === "c2")?.note).toBe("Voided: typo");
  });
});
