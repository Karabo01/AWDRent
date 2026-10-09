import { describe, expect, it } from "vitest";
import { carriedForward, firstMonthRent, rentCollectedThrough, statementLine } from "./statement-calc";

let n = 0;
const charge = (type: string, dueDate: string, amountCents: number, voided = false) => ({
  id: `c${++n}`,
  type,
  dueDate,
  createdAt: new Date(n),
  amountCents,
  voidedAt: voided ? new Date() : null,
});
const pay = (paidOn: string, amountCents: number, opts: { status?: string; source?: string } = {}) => ({
  paidOn,
  createdAt: new Date(++n),
  amountCents,
  status: opts.status ?? "approved",
  source: opts.source ?? "bank_import",
});

describe("rent collected", () => {
  const rentOct = charge("rent", "2026-10-01", 850_000);
  const water = charge("utility", "2026-10-05", 40_000);
  const rentNov = charge("rent", "2026-11-01", 850_000);

  it("counts only what paid rent, oldest charge first, and leaves other charges to the agency", () => {
    // Pays Oct rent in full and the water bill
    expect(rentCollectedThrough([rentOct, water, rentNov], [pay("2026-10-03", 890_000)], "2026-10-31")).toBe(850_000);
    // A short payment pays rent first (it is the oldest charge)
    expect(rentCollectedThrough([rentOct, water], [pay("2026-10-03", 500_000)], "2026-10-31")).toBe(500_000);
  });

  it("treats money paid ahead as credit until the month it pays for", () => {
    // Paid November's rent on 30 October
    const payments = [pay("2026-10-02", 850_000), pay("2026-10-30", 850_000)];
    expect(rentCollectedThrough([rentOct, rentNov], payments, "2026-10-31")).toBe(850_000);
    expect(rentCollectedThrough([rentOct, rentNov], payments, "2026-11-30")).toBe(1_700_000);
  });

  it("ignores payments after the month, pending and reversed payments, voided charges, and credit from the old system", () => {
    expect(rentCollectedThrough([rentOct], [pay("2026-11-01", 850_000)], "2026-10-31")).toBe(0);
    expect(rentCollectedThrough([rentOct], [pay("2026-10-02", 850_000, { status: "pending" }), pay("2026-10-02", 850_000, { status: "reversed" })], "2026-10-31")).toBe(0);
    expect(rentCollectedThrough([charge("rent", "2026-10-01", 850_000, true)], [pay("2026-10-02", 850_000)], "2026-10-31")).toBe(0);
    // A credit brought over covers October's rent, but that money was handled in the old system
    expect(rentCollectedThrough([rentOct], [pay("2026-09-30", 850_000, { source: "opening_balance" })], "2026-10-31")).toBe(0);
  });

  it("counts arrears brought over at import as rent, and rent paid from the deposit", () => {
    const arrears = charge("opening_balance", "2026-09-30", 200_000);
    expect(rentCollectedThrough([arrears, rentOct], [pay("2026-10-10", 1_050_000, { source: "deposit" })], "2026-10-31")).toBe(1_050_000);
  });

  it("finds the first month's rent", () => {
    expect(firstMonthRent([rentNov, rentOct], 999)).toBe(850_000);
    expect(firstMonthRent([], 900_000)).toBe(900_000);
  });
});

describe("statement lines", () => {
  const base = { commissionBps: 1000, lettingFee: true, vatRegistered: true, rentPaidOut: 0, feeTaken: 0, firstMonthRent: 850_000 };

  it("keeps the first month's rent as the letting fee, VAT included, then pays the owner in full", () => {
    const month1 = statementLine({ ...base, model: "first_month", rentToDate: 850_000 });
    expect(month1).toEqual({
      rentCents: 850_000,
      basis: "letting_fee",
      commissionCents: 850_000,
      vatCents: 110_870,
      deductionCents: 850_000,
      note: "Letting fee: first month's rent",
    });
    const month2 = statementLine({ ...base, model: "first_month", rentToDate: 1_700_000, rentPaidOut: 850_000, feeTaken: 850_000 });
    expect(month2).toMatchObject({ rentCents: 850_000, commissionCents: 0, deductionCents: 0, note: null });
  });

  it("takes the fee from part payments until a full month is covered", () => {
    const part = statementLine({ ...base, model: "first_month", rentToDate: 500_000 });
    expect(part).toMatchObject({ rentCents: 500_000, commissionCents: 500_000, note: "Letting fee: first month's rent (part)" });
    const rest = statementLine({ ...base, model: "first_month", rentToDate: 1_200_000, rentPaidOut: 500_000, feeTaken: 500_000 });
    expect(rest).toMatchObject({ rentCents: 700_000, commissionCents: 350_000 });
  });

  it("takes no fee on an imported lease, and no VAT when the agency is not registered", () => {
    expect(statementLine({ ...base, model: "first_month", lettingFee: false, rentToDate: 850_000 })).toMatchObject({ commissionCents: 0, deductionCents: 0 });
    expect(statementLine({ ...base, model: "first_month", vatRegistered: false, rentToDate: 850_000 })).toMatchObject({ vatCents: 0, deductionCents: 850_000 });
  });

  it("charges a percentage of rent collected, with VAT added", () => {
    expect(statementLine({ ...base, model: "percent", commissionBps: 1050, rentToDate: 850_000 })).toEqual({
      rentCents: 850_000,
      basis: "percent",
      commissionCents: 89_250,
      vatCents: 13_388,
      deductionCents: 102_638,
      note: "Commission 10.5% plus VAT",
    });
  });

  it("gives back rent and commission when a payment already paid out is reversed", () => {
    const reversal = statementLine({ ...base, model: "percent", rentToDate: 0, rentPaidOut: 850_000 });
    expect(reversal).toMatchObject({ rentCents: -850_000, commissionCents: -85_000, vatCents: -12_750, deductionCents: -97_750 });
    const feeBack = statementLine({ ...base, model: "first_month", rentToDate: 0, rentPaidOut: 850_000, feeTaken: 850_000 });
    expect(feeBack).toMatchObject({ rentCents: -850_000, commissionCents: -850_000, deductionCents: -850_000 });
  });

  it("carries only a shortfall forward", () => {
    expect(carriedForward(-12_300)).toBe(-12_300);
    expect(carriedForward(500_000)).toBe(0);
  });
});
