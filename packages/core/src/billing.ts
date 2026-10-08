import { schema, type Tx } from "@awdrent/db";

// Billing rules for rent (D18, D35, D44), as plain functions on ISO dates
// ("2026-11-01"), plus raising a lease's missing rent charges. Dates are
// calendar dates in South Africa; no time zones inside this module.

/** Today's date in South Africa, as YYYY-MM-DD. */
export function todayInSouthAfrica(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(now);
}

export function monthStart(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function addMonths(monthIso: string, n: number): string {
  const y = Number(monthIso.slice(0, 4));
  const m = Number(monthIso.slice(5, 7)) - 1 + n;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

export function daysInMonth(monthIso: string): number {
  const y = Number(monthIso.slice(0, 4));
  const m = Number(monthIso.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Due date in a month: the due day, or the month's last day if shorter (D18). */
export function dueDateFor(monthIso: string, dueDay: number): string {
  const day = Math.min(dueDay, daysInMonth(monthIso));
  return `${monthIso.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

export interface BillableLease {
  status: string;
  startDate: string;
  endDate: string | null;
  billingStartsOn: string | null;
  terminatedOn: string | null;
}

const LIVE = new Set(["active", "notice_given"]);

/**
 * Months that should have a rent charge by `today`: from the billing start
 * month to the last month of the lease (end or termination), but not past
 * the current month. A full month each, no pro-rata (D35). Only live leases
 * raise new charges.
 */
export function monthsToBill(lease: BillableLease, today: string): string[] {
  if (!LIVE.has(lease.status)) return [];
  const first = monthStart(lease.billingStartsOn ?? lease.startDate);
  const stop = [lease.terminatedOn, lease.endDate].filter((d): d is string => Boolean(d)).sort()[0];
  let last = monthStart(today);
  if (stop && monthStart(stop) < last) last = monthStart(stop);
  const months: string[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) months.push(m);
  return months;
}

const monthName = new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Raises any missing rent charges for one lease inside the caller's
 * transaction. Safe to run repeatedly: the database allows one rent charge
 * per lease per month, and repeats are skipped. Uses the lease's current rent.
 */
export async function raiseRentForLease(
  tx: Tx,
  lease: BillableLease & { id: string; rentCents: number; dueDay: number },
  today: string,
): Promise<number> {
  const months = monthsToBill(lease, today);
  if (months.length === 0) return 0;
  const created = await tx
    .insert(schema.charges)
    .values(
      months.map((m) => ({
        leaseId: lease.id,
        type: "rent" as const,
        period: m,
        dueDate: dueDateFor(m, lease.dueDay),
        amountCents: lease.rentCents,
        description: `Rent for ${monthName.format(new Date(`${m}T00:00:00Z`))}`,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.charges.id });
  return created.length;
}
