import { createHash } from "node:crypto";
import { schema, type Tx, withAgency } from "@awdrent/db";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import { depositTotals } from "./deposits";
import { parseCsv, parseSignedRand } from "./import";
import { LedgerRuleError } from "./ledger";
import { type Actor, assertLeaseInScope, authorise, NotFoundError } from "./portfolio";

// Trust-account statements (spec, D33, D36). The agency saves how its bank's
// CSV is laid out; credits are imported once each (a fingerprint skips lines
// already seen), lines carrying exactly one lease's EFT reference become
// approved rent payments, and the rest wait for accounts to allocate them to
// a lease's rent or deposit, or ignore them with a reason.

export class BankImportError extends Error {
  constructor(public problems: string[]) {
    super(problems[0] ?? "The statement could not be read");
  }
}

/** Optional column heading; the form only sends the amount fields for the chosen mode. */
const column = z
  .string()
  .max(60)
  .optional()
  .transform((s) => s?.trim() || null);

export const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    dateColumn: z.string().trim().min(1, "Which column holds the date?").max(60),
    amountMode: z.enum(["single", "split"]),
    amountColumn: column,
    creditColumn: column,
    debitColumn: column,
    referenceColumn: z.string().trim().min(1, "Which column holds the reference?").max(60),
    descriptionColumn: column,
    dateFormat: z.enum(["YMD", "DMY", "MDY"]),
    skipRows: z.coerce.number().int().min(0).max(50).default(0),
  })
  .superRefine((v, ctx) => {
    if (v.amountMode === "single" && !v.amountColumn) ctx.addIssue({ code: "custom", path: ["amountColumn"], message: "Which column holds the amount?" });
    if (v.amountMode === "split" && !v.creditColumn) ctx.addIssue({ code: "custom", path: ["creditColumn"], message: "Which column holds money in?" });
  });
export type ProfileInput = z.infer<typeof profileSchema>;
type Profile = typeof schema.bankImportProfiles.$inferSelect;

export interface StatementLine {
  date: string;
  amountCents: number;
  reference: string;
  description: string | null;
}

const heading = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** A bank's date in the profile's order → YYYY-MM-DD, or null. Also accepts "01 Oct 2026". */
export function parseBankDate(raw: string, format: "YMD" | "DMY" | "MDY"): string | null {
  const v = raw.trim();
  const named = /^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{4})$/.exec(v);
  let y: number, m: number, d: number;
  if (named) {
    [y, m, d] = [Number(named[3]), MONTHS[named[2]!.toLowerCase()] ?? 0, Number(named[1])];
  } else if (/^\d{8}$/.test(v) && format === "YMD") {
    [y, m, d] = [Number(v.slice(0, 4)), Number(v.slice(4, 6)), Number(v.slice(6, 8))];
  } else {
    const parts = v.split(/[/.\-\s]+/).map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [a, b, c] = parts as [number, number, number];
    [y, m, d] = format === "YMD" ? [a, b, c] : format === "DMY" ? [c, b, a] : [c, a, b];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 2000 || y > 2100 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Reads a statement with the agency's profile. Only money in is kept;
 * debits are counted and skipped. Any unreadable row stops the import.
 */
export function parseStatement(csv: string, profile: Pick<Profile, "dateColumn" | "amountColumn" | "creditColumn" | "debitColumn" | "referenceColumn" | "descriptionColumn" | "dateFormat" | "skipRows">) {
  const text = (csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv).split(/\r?\n/).slice(profile.skipRows).join("\n");
  const rows = parseCsv(text);
  const problems: string[] = [];
  const need = [profile.dateColumn, profile.amountColumn ?? profile.creditColumn!, profile.referenceColumn].map(heading);
  const present = new Set(Object.keys(rows[0] ?? {}));
  const missing = need.filter((c) => !present.has(c));
  if (rows.length && missing.length) {
    return { lines: [], debits: 0, problems: [`The file has no column called ${missing.join(", ")}. Check the import profile.`] };
  }
  const lines: StatementLine[] = [];
  let debits = 0;
  rows.forEach((r, i) => {
    const row = i + 2 + profile.skipRows;
    const date = parseBankDate(r[heading(profile.dateColumn)] ?? "", profile.dateFormat);
    let amount: number | null;
    if (profile.amountColumn) {
      amount = parseSignedRand(r[heading(profile.amountColumn)]?.replace(/,(?=\d{3}\b)/g, ""));
    } else {
      const credit = parseSignedRand(r[heading(profile.creditColumn!)]?.replace(/,(?=\d{3}\b)/g, ""));
      const debit = profile.debitColumn ? parseSignedRand(r[heading(profile.debitColumn)]?.replace(/,(?=\d{3}\b)/g, "")) : 0;
      amount = credit === null || debit === null ? null : credit > 0 ? credit : -Math.abs(debit);
    }
    if (amount === null) return void problems.push(`Row ${row}: the amount could not be read`);
    if (amount <= 0) return void debits++;
    if (!date) return void problems.push(`Row ${row}: the date could not be read (expected ${profile.dateFormat})`);
    lines.push({
      date,
      amountCents: amount,
      reference: (r[heading(profile.referenceColumn)] ?? "").trim(),
      description: profile.descriptionColumn ? (r[heading(profile.descriptionColumn)] ?? "").trim() || null : null,
    });
  });
  return { lines, debits, problems };
}

/**
 * Fingerprints that stay the same when the same statement line appears in
 * another file. Identical lines on one day (two equal payments) are told
 * apart by their order of appearance.
 */
export function fingerprints(lines: StatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = [l.date, l.amountCents, l.reference.toUpperCase().replace(/\s+/g, " "), (l.description ?? "").toUpperCase().replace(/\s+/g, " ")].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return createHash("sha256").update(`${base}|${n}`).digest("hex");
  });
}

/**
 * Leases whose EFT reference appears in the text, tolerating the spaces,
 * dashes and dots tenants add or leave out ("KL 0042", "kl0042").
 */
export function matchReferences(text: string, leases: { id: string; eftReference: string }[]): string[] {
  const hay = text.toUpperCase();
  return leases
    .filter((l) => {
      const chars = l.eftReference.toUpperCase().replace(/[^A-Z0-9]/g, "").split("");
      if (chars.length < 3) return false;
      const body = chars.join("[\\s._/-]*");
      const last = chars.at(-1)!;
      const after = /\d/.test(last) ? "(?!\\d)" : "(?![A-Z])";
      return new RegExp(`(?<![A-Z0-9])${body}${after}`).test(hay);
    })
    .map((l) => l.id);
}

// ─── profiles ────────────────────────────────────────────────────────

function profileColumns(input: ProfileInput) {
  return {
    name: input.name,
    dateColumn: input.dateColumn,
    amountColumn: input.amountMode === "single" ? input.amountColumn : null,
    creditColumn: input.amountMode === "split" ? input.creditColumn : null,
    debitColumn: input.amountMode === "split" ? input.debitColumn : null,
    referenceColumn: input.referenceColumn,
    descriptionColumn: input.descriptionColumn,
    dateFormat: input.dateFormat,
    skipRows: input.skipRows,
  };
}

export async function listProfiles(actor: Actor) {
  authorise(actor, "payments.approve");
  return withAgency({ ...actor.ctx, readOnly: true }, (tx) =>
    tx.select().from(schema.bankImportProfiles).where(isNull(schema.bankImportProfiles.archivedAt)).orderBy(asc(schema.bankImportProfiles.name)),
  );
}

export async function saveProfile(actor: Actor, input: ProfileInput, profileId?: string): Promise<string> {
  authorise(actor, "payments.approve");
  return withAgency(actor.ctx, async (tx) => {
    if (profileId) {
      const [row] = await tx.update(schema.bankImportProfiles).set(profileColumns(input)).where(eq(schema.bankImportProfiles.id, profileId)).returning();
      if (!row) throw new NotFoundError("Import profile");
      await audit(tx, { action: "bank_profile.updated", entity: "bank_import_profile", entityId: row.id, after: profileColumns(input) });
      return row.id;
    }
    const [row] = await tx.insert(schema.bankImportProfiles).values(profileColumns(input)).returning();
    await audit(tx, { action: "bank_profile.created", entity: "bank_import_profile", entityId: row!.id, after: profileColumns(input) });
    return row!.id;
  });
}

// ─── import ──────────────────────────────────────────────────────────

async function createRentPayment(tx: Tx, actor: Actor, line: typeof schema.bankLines.$inferSelect, leaseId: string) {
  await tx.insert(schema.payments).values({
    leaseId,
    amountCents: line.amountCents,
    paidOn: line.lineDate,
    source: "bank_import",
    status: "approved",
    approvedAt: sql`now()`,
    approvedBy: actor.userId,
    bankLineId: line.id,
    reference: line.reference,
  });
}

/**
 * Imports a statement: new credit lines are stored, and each line naming
 * exactly one lease's EFT reference becomes an approved rent payment.
 * Nothing is imported if any row cannot be read.
 */
export async function importStatement(actor: Actor, input: { profileId: string; fileName: string; csv: string }) {
  authorise(actor, "payments.approve");
  const sha = createHash("sha256").update(input.csv).digest("hex");
  return withAgency(actor.ctx, async (tx) => {
    const [profile] = await tx.select().from(schema.bankImportProfiles).where(eq(schema.bankImportProfiles.id, input.profileId));
    if (!profile) throw new NotFoundError("Import profile");
    const [again] = await tx.select({ id: schema.bankImports.id }).from(schema.bankImports).where(eq(schema.bankImports.fileSha256, sha));
    if (again) throw new BankImportError(["This exact file has already been imported."]);
    const parsed = parseStatement(input.csv, profile);
    if (parsed.problems.length) throw new BankImportError(parsed.problems);
    if (parsed.lines.length === 0) throw new BankImportError(["The file has no money-in lines."]);

    const prints = fingerprints(parsed.lines);
    const known = new Set(
      (await tx.select({ f: schema.bankLines.fingerprint }).from(schema.bankLines).where(inArray(schema.bankLines.fingerprint, prints))).map((r) => r.f),
    );
    const fresh = parsed.lines.map((l, i) => ({ ...l, fingerprint: prints[i]! })).filter((l) => !known.has(l.fingerprint));
    const leases = await tx
      .select({ id: schema.leases.id, eftReference: schema.leases.eftReference })
      .from(schema.leases)
      .where(ne(schema.leases.status, "draft"));

    const dates = parsed.lines.map((l) => l.date).sort();
    const [imp] = await tx
      .insert(schema.bankImports)
      .values({
        profileId: profile.id,
        fileName: input.fileName.slice(0, 200),
        fileSha256: sha,
        periodFrom: dates[0],
        periodTo: dates.at(-1),
        creditLines: parsed.lines.length,
        newLines: fresh.length,
        autoMatched: fresh.filter((l) => matchReferences(`${l.reference} ${l.description ?? ""}`, leases).length === 1).length,
      })
      .returning();

    let matched = 0;
    for (const l of fresh) {
      const [line] = await tx
        .insert(schema.bankLines)
        .values({ importId: imp!.id, lineDate: l.date, amountCents: l.amountCents, reference: l.reference, description: l.description, fingerprint: l.fingerprint })
        .onConflictDoNothing()
        .returning();
      if (!line) continue; // imported by someone else a moment ago
      const hits = matchReferences(`${l.reference} ${l.description ?? ""}`, leases);
      if (hits.length !== 1) continue;
      await createRentPayment(tx, actor, line, hits[0]!);
      await tx
        .update(schema.bankLines)
        .set({ status: "matched", matchedLeaseId: hits[0]!, autoMatched: true, resolvedAt: sql`now()`, resolvedBy: actor.userId })
        .where(eq(schema.bankLines.id, line.id));
      matched++;
    }
    await audit(tx, {
      action: "bank.statement_imported",
      entity: "bank_import",
      entityId: imp!.id,
      after: { fileName: input.fileName, creditLines: parsed.lines.length, newLines: fresh.length, autoMatched: matched, debitsSkipped: parsed.debits },
    });
    return { importId: imp!.id, creditLines: parsed.lines.length, newLines: fresh.length, autoMatched: matched, debitsSkipped: parsed.debits };
  });
}

// ─── reviewing lines ─────────────────────────────────────────────────

export async function listLines(actor: Actor, opts: { status?: "unmatched" | "matched" | "ignored"; importId?: string } = {}) {
  authorise(actor, "payments.approve");
  return withAgency({ ...actor.ctx, readOnly: true }, (tx) =>
    tx
      .select({ line: schema.bankLines, eftReference: schema.leases.eftReference })
      .from(schema.bankLines)
      .leftJoin(schema.leases, eq(schema.leases.id, schema.bankLines.matchedLeaseId))
      .where(
        and(
          opts.status ? eq(schema.bankLines.status, opts.status) : undefined,
          opts.importId ? eq(schema.bankLines.importId, opts.importId) : undefined,
        ),
      )
      .orderBy(desc(schema.bankLines.lineDate))
      .limit(500),
  );
}

export async function listImports(actor: Actor) {
  authorise(actor, "payments.approve");
  return withAgency({ ...actor.ctx, readOnly: true }, (tx) =>
    tx
      .select({ imp: schema.bankImports, userName: schema.users.name })
      .from(schema.bankImports)
      .leftJoin(schema.users, eq(schema.users.id, schema.bankImports.createdBy))
      .orderBy(desc(schema.bankImports.createdAt))
      .limit(50),
  );
}

async function lockLine(tx: Tx, lineId: string) {
  const [line] = await tx.select().from(schema.bankLines).where(eq(schema.bankLines.id, lineId)).for("update");
  if (!line) throw new NotFoundError("Bank line");
  return line;
}

/** Accounts allocates an unmatched line to a lease's rent or deposit. */
export async function allocateLine(actor: Actor, lineId: string, leaseId: string, target: "rent" | "deposit"): Promise<void> {
  authorise(actor, "payments.approve");
  await withAgency(actor.ctx, async (tx) => {
    const line = await lockLine(tx, lineId);
    if (line.status !== "unmatched") throw new LedgerRuleError("This line has already been dealt with.");
    await assertLeaseInScope(tx, actor, leaseId);
    const [lease] = await tx.select({ status: schema.leases.status }).from(schema.leases).where(eq(schema.leases.id, leaseId));
    if (target === "rent") {
      if (lease!.status === "draft") throw new LedgerRuleError("Activate the lease before allocating rent to it.");
      await createRentPayment(tx, actor, line, leaseId);
    } else {
      await tx.insert(schema.depositEntries).values({
        leaseId,
        type: "received",
        amountCents: line.amountCents,
        entryDate: line.lineDate,
        description: "Deposit received",
        reference: line.reference,
        bankLineId: line.id,
      });
    }
    await tx
      .update(schema.bankLines)
      .set({ status: "matched", matchedLeaseId: leaseId, autoMatched: false, resolvedAt: sql`now()`, resolvedBy: actor.userId })
      .where(eq(schema.bankLines.id, lineId));
    await audit(tx, { action: `bank.line_allocated_${target}`, entity: "bank_line", entityId: lineId, after: { leaseId, amountCents: line.amountCents } });
  });
}

/** Marks a line as not rent (e.g. an owner's own transfer), with a reason. */
export async function ignoreLine(actor: Actor, lineId: string, reason: string): Promise<void> {
  authorise(actor, "payments.approve");
  await withAgency(actor.ctx, async (tx) => {
    const line = await lockLine(tx, lineId);
    if (line.status !== "unmatched") throw new LedgerRuleError("This line has already been dealt with.");
    await tx.update(schema.bankLines).set({ status: "ignored", ignoredReason: reason, resolvedAt: sql`now()`, resolvedBy: actor.userId }).where(eq(schema.bankLines.id, lineId));
    await audit(tx, { action: "bank.line_ignored", entity: "bank_line", entityId: lineId, after: { reason } });
  });
}

/**
 * Undoes a match or an ignore: the rent payment is reversed (D52) or the
 * deposit entry voided, and the line goes back to the queue.
 */
export async function unallocateLine(actor: Actor, lineId: string, reason: string): Promise<void> {
  authorise(actor, "payments.approve");
  await withAgency(actor.ctx, async (tx) => {
    const line = await lockLine(tx, lineId);
    if (line.status === "unmatched") throw new LedgerRuleError("This line is not allocated.");
    if (line.status === "matched") {
      const [payment] = await tx
        .select({ id: schema.payments.id })
        .from(schema.payments)
        .where(and(eq(schema.payments.bankLineId, lineId), eq(schema.payments.status, "approved")));
      if (payment) {
        await tx
          .update(schema.payments)
          .set({ status: "reversed", reversedAt: sql`now()`, reversalReason: `Bank line unallocated: ${reason}`, reversedBy: actor.userId })
          .where(eq(schema.payments.id, payment.id));
      }
      const [entry] = await tx
        .select()
        .from(schema.depositEntries)
        .where(and(eq(schema.depositEntries.bankLineId, lineId), isNull(schema.depositEntries.voidedAt)));
      if (entry) {
        const entries = await tx.select().from(schema.depositEntries).where(eq(schema.depositEntries.leaseId, entry.leaseId));
        if (depositTotals(entries).heldCents - entry.amountCents < 0) {
          throw new LedgerRuleError("The deposit has already been paid out; void the refund or deductions first.");
        }
        await tx
          .update(schema.depositEntries)
          .set({ voidedAt: sql`now()`, voidReason: `Bank line unallocated: ${reason}`, voidedBy: actor.userId })
          .where(eq(schema.depositEntries.id, entry.id));
      }
    }
    await tx
      .update(schema.bankLines)
      .set({ status: "unmatched", matchedLeaseId: null, autoMatched: false, ignoredReason: null, resolvedAt: null, resolvedBy: null })
      .where(eq(schema.bankLines.id, lineId));
    await audit(tx, { action: "bank.line_unallocated", entity: "bank_line", entityId: lineId, before: { status: line.status, leaseId: line.matchedLeaseId }, after: { reason } });
  });
}
