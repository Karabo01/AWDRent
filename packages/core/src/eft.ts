import { schema, type Tx } from "@awdrent/db";
import { eq, sql } from "drizzle-orm";

// EFT references (decisions D2–D4): {PREFIX}-{sequence}, at least 4 digits,
// unique within the agency and never reused. The counter lives in
// eft_sequences and is bumped atomically, so two leases created at the same
// moment can never get the same number.

export function formatEftReference(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

/** Number part of a reference in this agency's own format, or null. */
export function eftSequenceNumber(reference: string, prefix: string): number | null {
  const m = new RegExp(`^${prefix}-(\\d{4,9})$`).exec(reference);
  return m ? Number(m[1]) : null;
}

/** Imported references are kept if bank-safe (D4): uppercase letters, digits, dashes, 3–20 long. */
export function normaliseImportedReference(input: string): string | null {
  const ref = input.trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9][A-Z0-9-]{2,19}$/.test(ref) ? ref : null;
}

async function agencyPrefix(tx: Tx, agencyId: string): Promise<string> {
  const [a] = await tx.select({ prefix: schema.agencies.eftPrefix }).from(schema.agencies).where(eq(schema.agencies.id, agencyId));
  if (!a) throw new Error("agency not found");
  return a.prefix;
}

async function referenceTaken(tx: Tx, reference: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.leases.id })
    .from(schema.leases)
    .where(eq(schema.leases.eftReference, reference));
  return Boolean(row);
}

/** Allocates the next unused reference for the transaction's agency. */
export async function nextEftReference(tx: Tx, agencyId: string): Promise<string> {
  const prefix = await agencyPrefix(tx, agencyId);
  // Skips numbers an import already used with this prefix
  for (let attempt = 0; attempt < 1000; attempt++) {
    const [row] = await tx
      .insert(schema.eftSequences)
      .values({ lastValue: 1 })
      .onConflictDoUpdate({ target: schema.eftSequences.agencyId, set: { lastValue: sql`${schema.eftSequences.lastValue} + 1` } })
      .returning({ n: schema.eftSequences.lastValue });
    const reference = formatEftReference(prefix, row!.n);
    if (!(await referenceTaken(tx, reference))) return reference;
  }
  throw new Error("could not allocate an EFT reference");
}

/**
 * Records an imported reference: refuses duplicates, and moves the counter
 * past it when it uses this agency's own prefix (D4).
 */
export async function claimImportedReference(tx: Tx, agencyId: string, reference: string): Promise<void> {
  if (await referenceTaken(tx, reference)) throw new Error(`EFT reference ${reference} is already used by another lease`);
  const n = eftSequenceNumber(reference, await agencyPrefix(tx, agencyId));
  if (n === null) return;
  await tx
    .insert(schema.eftSequences)
    .values({ lastValue: n })
    .onConflictDoUpdate({
      target: schema.eftSequences.agencyId,
      set: { lastValue: sql`greatest(${schema.eftSequences.lastValue}, ${n})` },
    });
}
