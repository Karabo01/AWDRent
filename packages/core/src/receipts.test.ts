import { describe, expect, it } from "vitest";
import { paymentCoverage, pdfMoney } from "./receipts";

const at = (d: string) => new Date(`${d}T08:00:00Z`);
const charge = (id: string, dueDate: string, amountCents: number, voided = false) => ({
  id,
  dueDate,
  createdAt: at(dueDate),
  amountCents,
  description: `Rent ${id}`,
  voidedAt: voided ? new Date() : null,
});
const payment = (id: string, paidOn: string, amountCents: number, status = "approved") => ({ id, paidOn, createdAt: at(paidOn), amountCents, status });

describe("what a payment paid for (D34)", () => {
  const charges = [charge("Oct", "2026-10-01", 5000), charge("Nov", "2026-11-01", 5000), charge("Dec", "2026-12-01", 5000)];

  it("covers the oldest unpaid charges first, continuing from earlier payments", () => {
    const payments = [payment("p1", "2026-10-03", 3000), payment("p2", "2026-11-02", 5000)];
    expect(paymentCoverage(charges, payments, "p1")).toEqual({ allocations: [{ description: "Rent Oct", amountCents: 3000 }], creditCents: 0 });
    expect(paymentCoverage(charges, payments, "p2")).toEqual({
      allocations: [
        { description: "Rent Oct", amountCents: 2000 },
        { description: "Rent Nov", amountCents: 3000 },
      ],
      creditCents: 0,
    });
  });

  it("reports money beyond all charges as credit, and ignores voided charges and unapproved payments", () => {
    const payments = [payment("pending", "2026-10-01", 9999, "pending"), payment("p", "2026-10-02", 20000)];
    const result = paymentCoverage([...charges, charge("X", "2026-09-01", 7000, true)], payments, "p");
    expect(result.allocations.map((a) => a.description)).toEqual(["Rent Oct", "Rent Nov", "Rent Dec"]);
    expect(result.creditCents).toBe(5000);
  });

  it("formats money with plain spaces the PDF font can draw", () => {
    expect(pdfMoney(123456)).toMatch(/^R 1 234,56$/);
  });
});
