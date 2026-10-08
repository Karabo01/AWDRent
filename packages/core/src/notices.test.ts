import { describe, expect, it } from "vitest";
import { addDays, daysBetween, noticesDue, remindersPaused } from "./notices";

type Lease = Parameters<typeof noticesDue>[0];
type Charge = Parameters<typeof noticesDue>[1][number];
type Payment = Parameters<typeof noticesDue>[2][number];

const lease = (over: Partial<Lease> = {}): Lease =>
  ({
    id: "L",
    agencyId: "A",
    unitId: "U",
    eftReference: "KL-0001",
    status: "active",
    startDate: "2026-01-01",
    billingStartsOn: null,
    endDate: null,
    rentCents: 850_000,
    dueDay: 1,
    depositCents: 0,
    escalationBps: null,
    escalationDate: null,
    noticeDays: 30,
    noticeGivenOn: null,
    terminatedOn: null,
    terminationReason: null,
    remindersPausedAt: null,
    remindersPausedUntil: null,
    remindersPauseReason: null,
    remindersPausedBy: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    ...over,
  }) as Lease;

let n = 0;
const rent = (period: string, dueDate: string, amountCents = 850_000): Charge =>
  ({ id: `c${++n}`, type: "rent", period, dueDate, amountCents, voidedAt: null, createdAt: new Date(n) }) as Charge;
const paid = (amountCents: number, status = "approved"): Payment => ({ id: `p${++n}`, amountCents, status, paidOn: "2026-01-01", createdAt: new Date(n) }) as Payment;

const kinds = (notices: ReturnType<typeof noticesDue>) => notices.map((x) => x.key);
const none = { popPending: false };

describe("date helpers", () => {
  it("counts days across months and years", () => {
    expect(daysBetween("2026-10-27", "2026-11-01")).toBe(5);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(addDays("2027-03-01", -5)).toBe("2027-02-24");
  });
});

describe("rent reminders", () => {
  it("reminds five days before the due date, before the month's rent is raised, for rent plus arrears", () => {
    const charges = [rent("2026-10-01", "2026-10-01")];
    const due = noticesDue(lease(), charges, [paid(800_000)], "2026-10-27", none);
    expect(due.find((d) => d.kind === "rent_due_reminder")).toEqual({
      key: "rent_due_reminder:2026-11-01",
      kind: "rent_due_reminder",
      amountCents: 900_000,
      dueDate: "2026-11-01",
    });
    expect(kinds(noticesDue(lease(), charges, [paid(850_000)], "2026-10-26", none))).toEqual([]);
  });

  it("does not remind a tenant whose credit already covers the rent", () => {
    const due = noticesDue(lease(), [rent("2026-10-01", "2026-10-01")], [paid(1_700_000)], "2026-10-28", none);
    expect(due).toEqual([]);
  });

  it("uses the escalated rent for a month the escalation will have reached", () => {
    const l = lease({ escalationBps: 800, escalationDate: "2026-11-01" });
    const due = noticesDue(l, [rent("2026-10-01", "2026-10-01")], [paid(850_000)], "2026-10-28", none);
    expect(due.find((d) => d.kind === "rent_due_reminder")?.amountCents).toBe(918_000);
  });

  it("reminds on the due day if unpaid, for a mid-month due day", () => {
    const l = lease({ dueDay: 7 });
    const charges = [rent("2026-11-01", "2026-11-07")];
    expect(kinds(noticesDue(l, charges, [], "2026-11-07", none))).toEqual(["rent_due_today:2026-11-01"]);
    expect(kinds(noticesDue(l, charges, [paid(850_000)], "2026-11-07", none))).toEqual([]);
    expect(kinds(noticesDue(l, charges, [], "2026-11-03", none))).toEqual(["rent_due_reminder:2026-11-01"]);
  });

  it("does not remind for a month after the lease ends", () => {
    const l = lease({ endDate: "2026-10-31", status: "notice_given" });
    expect(kinds(noticesDue(l, [rent("2026-10-01", "2026-10-01")], [paid(850_000)], "2026-10-28", none))).toEqual([]);
  });
});

describe("overdue escalation", () => {
  const charges = () => [rent("2026-10-01", "2026-10-01")];

  it("sends the highest stage reached, once per unpaid charge", () => {
    const c = charges();
    expect(kinds(noticesDue(lease(), c, [], "2026-10-01", none))).toEqual(["rent_due_today:2026-10-01"]);
    expect(kinds(noticesDue(lease(), c, [], "2026-10-02", none))).toEqual([`overdue_1:${c[0]!.id}`]);
    expect(kinds(noticesDue(lease(), c, [], "2026-10-08", none))).toEqual([`overdue_7:${c[0]!.id}`]);
    expect(kinds(noticesDue(lease(), c, [], "2026-10-20", none))).toEqual([`overdue_14:${c[0]!.id}`]);
  });

  it("reports the overdue amount, not rent due later", () => {
    const c = [rent("2026-10-01", "2026-10-01"), rent("2026-11-01", "2026-11-01")];
    const due = noticesDue(lease(), c, [paid(50_000)], "2026-10-03", none);
    expect(due).toEqual([{ key: `overdue_1:${c[0]!.id}`, kind: "overdue_1", amountCents: 800_000, dueDate: "2026-10-01" }]);
  });

  it("stops once the arrears are paid, and while paused or a proof of payment waits", () => {
    const c = charges();
    expect(kinds(noticesDue(lease(), c, [paid(850_000)], "2026-10-09", none))).toEqual([]);
    expect(kinds(noticesDue(lease(), c, [paid(850_000, "pending")], "2026-10-09", none))).toEqual([`overdue_7:${c[0]!.id}`]);
    expect(kinds(noticesDue(lease(), c, [], "2026-10-09", { popPending: true }))).toEqual([]);
    const paused = lease({ remindersPausedAt: new Date(), remindersPausedUntil: "2026-10-15" });
    expect(kinds(noticesDue(paused, c, [], "2026-10-15", none))).toEqual([]);
    expect(kinds(noticesDue(paused, c, [], "2026-10-16", none))).toEqual([`overdue_14:${c[0]!.id}`]);
  });

  it("knows when a pause applies", () => {
    expect(remindersPaused({ remindersPausedAt: new Date(), remindersPausedUntil: null }, "2030-01-01")).toBe(true);
    expect(remindersPaused({ remindersPausedAt: null, remindersPausedUntil: null }, "2026-01-01")).toBe(false);
  });

  it("ignores ended leases", () => {
    expect(noticesDue(lease({ status: "ended" }), charges(), [], "2026-10-20", none)).toEqual([]);
  });
});

describe("lease expiry and escalation", () => {
  // Rent reminders for those dates are covered above
  const only = (k: string, notices: ReturnType<typeof noticesDue>) => notices.filter((x) => x.kind === k);

  it("warns 60 and then 30 days before a fixed end date, not after notice", () => {
    const l = lease({ endDate: "2026-12-31" });
    expect(kinds(only("lease_expiry", noticesDue(l, [], [], "2026-11-01", none)))).toEqual(["lease_expiry_60:2026-12-31"]);
    expect(kinds(only("lease_expiry", noticesDue(l, [], [], "2026-12-01", none)))).toEqual(["lease_expiry_30:2026-12-31"]);
    expect(kinds(only("lease_expiry", noticesDue(l, [], [], "2026-10-31", none)))).toEqual([]);
    expect(only("lease_expiry", noticesDue(lease({ endDate: "2026-12-31", status: "notice_given" }), [], [], "2026-12-01", none))).toEqual([]);
  });

  it("gives notice of an escalation within 60 days, with the new rent", () => {
    const l = lease({ escalationBps: 800, escalationDate: "2027-03-01" });
    expect(only("escalation_notice", noticesDue(l, [], [], "2027-01-01", none))).toEqual([
      { key: "escalation_notice:2027-03-01", kind: "escalation_notice", amountCents: 918_000, escalationDate: "2027-03-01" },
    ]);
    expect(only("escalation_notice", noticesDue(l, [], [], "2026-12-30", none))).toEqual([]);
    // Not if the lease ends first
    expect(only("escalation_notice", noticesDue(lease({ escalationBps: 800, escalationDate: "2027-03-01", endDate: "2027-02-28" }), [], [], "2027-01-01", none))).toEqual([]);
  });
});
