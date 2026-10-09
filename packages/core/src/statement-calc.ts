// The money rules of owner statements (D91–D95), as pure functions on
// integer cents. Nothing here reads the database, so every rule is unit
// tested.
//
//   Rent collected   approved payments, oldest charge first (D34), as far as
//                    they paid rent (and arrears brought over at import).
//                    Payments only count up to the end of the month, against
//                    charges due by then; a credit brought over from the
//                    previous system is not new money for the owner.
//   Commission       per owner: the lease's first month's rent (letting fee,
//                    VAT included), or a percentage of rent collected (VAT
//                    added when the agency is VAT-registered).
//   Each statement pays what was collected since the last approved one, so a
//   late payment or a reversal shows in the next statement.

export const VAT_BPS = 1500;

export interface CalcCharge {
  id: string;
  type: string;
  dueDate: string;
  createdAt: Date;
  amountCents: number;
  voidedAt: Date | null;
}

export interface CalcPayment {
  paidOn: string;
  createdAt: Date;
  amountCents: number;
  status: string;
  source: string;
}

/** Charge types whose money belongs to the owner (D93): rent, and rent arrears brought over at import. */
const OWNER_CHARGES = new Set(["rent", "opening_balance"]);

/** Rent paid by real money up to and including `periodEnd`, in cents. */
export function rentCollectedThrough(charges: CalcCharge[], payments: CalcPayment[], periodEnd: string): number {
  const live = charges
    .filter((c) => !c.voidedAt && c.dueDate <= periodEnd)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.getTime() - b.createdAt.getTime());
  const paid = payments
    .filter((p) => p.status === "approved" && p.paidOn <= periodEnd)
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.createdAt.getTime() - b.createdAt.getTime());
  let rent = 0;
  let ci = 0;
  let leftInCharge = live[0]?.amountCents ?? 0;
  for (const p of paid) {
    let left = p.amountCents;
    while (left > 0 && ci < live.length) {
      const take = Math.min(left, leftInCharge);
      if (OWNER_CHARGES.has(live[ci]!.type) && p.source !== "opening_balance") rent += take;
      left -= take;
      leftInCharge -= take;
      if (leftInCharge === 0) {
        ci++;
        leftInCharge = live[ci]?.amountCents ?? 0;
      }
    }
  }
  return rent;
}

/** The first month's rent of a lease: its earliest rent charge, or the rent on record if none is raised yet. */
export function firstMonthRent(charges: CalcCharge[], rentCents: number): number {
  const first = charges
    .filter((c) => c.type === "rent" && !c.voidedAt)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.getTime() - b.createdAt.getTime())[0];
  return first?.amountCents ?? rentCents;
}

/** Rounds half away from zero, so a reversal mirrors the payment it undoes. */
const roundDiv = (n: number, d: number) => Math.sign(n) * Math.floor((Math.abs(n) * 2 + d) / (2 * d));

export interface LineInput {
  model: "first_month" | "percent";
  commissionBps: number;
  lettingFee: boolean;
  vatRegistered: boolean;
  /** Rent collected since the lease started, through the end of this month */
  rentToDate: number;
  /** Rent already paid out on approved statements */
  rentPaidOut: number;
  /** Letting fee already taken on approved statements */
  feeTaken: number;
  firstMonthRent: number;
}

export interface LineResult {
  rentCents: number;
  basis: "letting_fee" | "percent";
  commissionCents: number;
  vatCents: number;
  /** What comes off the owner's money for this line */
  deductionCents: number;
  note: string | null;
}

/** One lease's line on a month's statement. */
export function statementLine(i: LineInput): LineResult {
  const rent = i.rentToDate - i.rentPaidOut;
  if (i.model === "first_month") {
    // The agency keeps rent collected until one month's rent is covered (D92)
    const feeToDate = i.lettingFee ? Math.min(Math.max(i.rentToDate, 0), i.firstMonthRent) : 0;
    const fee = feeToDate - i.feeTaken;
    const vat = i.vatRegistered ? roundDiv(fee * VAT_BPS, 10_000 + VAT_BPS) : 0;
    return {
      rentCents: rent,
      basis: "letting_fee",
      commissionCents: fee,
      vatCents: vat,
      deductionCents: fee,
      note: fee !== 0 ? (feeToDate === i.firstMonthRent ? "Letting fee: first month's rent" : "Letting fee: first month's rent (part)") : null,
    };
  }
  const commission = roundDiv(rent * i.commissionBps, 10_000);
  const vat = i.vatRegistered ? roundDiv(commission * VAT_BPS, 10_000) : 0;
  return {
    rentCents: rent,
    basis: "percent",
    commissionCents: commission,
    vatCents: vat,
    deductionCents: commission + vat,
    note: commission !== 0 ? `Commission ${(i.commissionBps / 100).toFixed(2).replace(/\.?0+$/, "")}%${vat ? " plus VAT" : ""}` : null,
  };
}

/** A shortfall carried into the next statement: only a negative balance carries; a positive one is paid out. */
export const carriedForward = (payableCents: number) => Math.min(payableCents, 0);
