import { schema, withAgency } from "@awdrent/db";
import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { audit, changes } from "./audit";
import { blindIndex, decrypt, encrypt, last4, normaliseIdentifier } from "./crypto";
import { identityNumberProblem } from "./identity";
import { parsePercentToBps } from "./money";
import { type Actor, assertOwnerInScope, authorise, NotFoundError, ownerScope } from "./portfolio";

const ID_FIELD = "owners.id_or_reg_no";
const BANK_FIELD = "owners.bank_account_no";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null);

export const ownerSchema = z
  .object({
    kind: z.enum(["individual", "company", "trust"]),
    name: z.string().trim().min(2).max(160),
    // "sa_id" is validated with the Luhn check; "other" is passport/registration
    idKind: z.enum(["sa_id", "other"]).default("sa_id"),
    // Empty keeps the stored number on update
    idOrRegNo: z.string().trim().max(30).default(""),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((s) => s === "" || z.email().safeParse(s).success, "Enter a valid email address")
      .transform((s) => s || null),
    phone: optionalText(30),
    postalAddress: optionalText(300),
    commissionPercent: z.string().transform((s, ctx) => {
      const bps = parsePercentToBps(s);
      if (bps === null) {
        ctx.addIssue({ code: "custom", message: "Enter a percentage like 10 or 8.5" });
        return z.NEVER;
      }
      return bps;
    }),
    vatRegistered: z.enum(["true", "false"]).transform((v) => v === "true"),
    vatNumber: optionalText(20),
    notes: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.idOrRegNo) {
      const problem = identityNumberProblem(v.idOrRegNo, v.kind === "individual" ? v.idKind : "other");
      if (problem) ctx.addIssue({ code: "custom", path: ["idOrRegNo"], message: problem });
    }
    if (v.vatRegistered && !v.vatNumber) ctx.addIssue({ code: "custom", path: ["vatNumber"], message: "Enter the VAT number" });
  });
export type OwnerInput = z.infer<typeof ownerSchema>;

export const ownerBankSchema = z.object({
  bankName: z.string().trim().min(2).max(80),
  bankBranchCode: z.string().trim().regex(/^\d{6}$/, "6-digit branch code"),
  bankAccountHolder: z.string().trim().min(2).max(160),
  // Empty keeps the stored number
  bankAccountNo: z
    .string()
    .transform(normaliseIdentifier)
    .refine((s) => s === "" || /^\d{6,20}$/.test(s), "Digits only, 6 to 20 of them"),
});
export type OwnerBankInput = z.infer<typeof ownerBankSchema>;

/** What pages may show: masked numbers only. */
function present(o: typeof schema.owners.$inferSelect) {
  return {
    id: o.id,
    kind: o.kind,
    name: o.name,
    idOrRegNoLast4: o.idOrRegNoLast4,
    email: o.email,
    phone: o.phone,
    postalAddress: o.postalAddress,
    bankName: o.bankName,
    bankBranchCode: o.bankBranchCode,
    bankAccountHolder: o.bankAccountHolder,
    bankAccountNoLast4: o.bankAccountNoLast4,
    commissionBps: o.commissionBps,
    vatRegistered: o.vatRegistered,
    vatNumber: o.vatNumber,
    notes: o.notes,
    archivedAt: o.archivedAt,
    createdAt: o.createdAt,
  };
}
export type OwnerView = ReturnType<typeof present>;

// Correlated subqueries name the outer table explicitly: in a single-table
// select Drizzle renders ${table.column} unqualified, which would bind to the
// subquery's own column.
export async function listOwners(actor: Actor, opts: { q?: string; includeArchived?: boolean } = {}) {
  authorise(actor, "records.view");
  return withAgency(actor.ctx, async (tx) => {
    const q = opts.q?.trim();
    const rows = await tx
      .select({
        owner: schema.owners,
        propertyCount: sql<number>`(select count(*)::int from ${schema.properties} p where p.owner_id = "owners"."id" and p.archived_at is null)`,
      })
      .from(schema.owners)
      .where(
        and(
          ownerScope(tx, actor),
          opts.includeArchived ? undefined : isNull(schema.owners.archivedAt),
          q ? or(ilike(schema.owners.name, `%${q}%`), ilike(schema.owners.email, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(asc(schema.owners.name))
      .limit(500);
    return rows.map((r) => ({ ...present(r.owner), propertyCount: r.propertyCount }));
  });
}

export async function getOwner(actor: Actor, ownerId: string) {
  authorise(actor, "records.view");
  return withAgency(actor.ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.owners)
      .where(and(eq(schema.owners.id, ownerId), ownerScope(tx, actor)));
    if (!row) throw new NotFoundError("Owner");
    return present(row);
  });
}

function identityColumns(agencyId: string, input: OwnerInput) {
  if (!input.idOrRegNo) return {};
  const value = normaliseIdentifier(input.idOrRegNo);
  const ctx = { agencyId, field: ID_FIELD };
  return { idOrRegNoEnc: encrypt(value, ctx), idOrRegNoLast4: last4(value), idOrRegNoBlindIndex: blindIndex(value, ctx) };
}

function ownerColumns(input: OwnerInput) {
  return {
    kind: input.kind,
    name: input.name,
    email: input.email,
    phone: input.phone,
    postalAddress: input.postalAddress,
    commissionBps: input.commissionPercent,
    vatRegistered: input.vatRegistered,
    vatNumber: input.vatRegistered ? input.vatNumber : null,
    notes: input.notes,
  };
}

export async function createOwner(actor: Actor, input: OwnerInput): Promise<string> {
  authorise(actor, "records.edit");
  return withAgency(actor.ctx, async (tx) => {
    const [row] = await tx
      .insert(schema.owners)
      .values({ ...ownerColumns(input), ...identityColumns(actor.ctx.agencyId, input) })
      .returning();
    if (!row) throw new Error("insert failed");
    await audit(tx, { action: "owner.created", entity: "owner", entityId: row.id, after: present(row) });
    return row.id;
  });
}

export async function updateOwner(actor: Actor, ownerId: string, input: OwnerInput): Promise<void> {
  authorise(actor, "records.edit");
  await withAgency(actor.ctx, async (tx) => {
    await assertOwnerInScope(tx, actor, ownerId);
    const [before] = await tx.select().from(schema.owners).where(eq(schema.owners.id, ownerId)).for("update");
    const [after] = await tx
      .update(schema.owners)
      .set({ ...ownerColumns(input), ...identityColumns(actor.ctx.agencyId, input) })
      .where(eq(schema.owners.id, ownerId))
      .returning();
    const diff = changes(present(before!), present(after!));
    if (Object.keys(diff.after).length) await audit(tx, { action: "owner.updated", entity: "owner", entityId: ownerId, ...diff });
  });
}

export async function updateOwnerBank(actor: Actor, ownerId: string, input: OwnerBankInput): Promise<void> {
  authorise(actor, "owner.bank.edit");
  await withAgency(actor.ctx, async (tx) => {
    await assertOwnerInScope(tx, actor, ownerId);
    const [before] = await tx.select().from(schema.owners).where(eq(schema.owners.id, ownerId)).for("update");
    const account = input.bankAccountNo
      ? {
          bankAccountNoEnc: encrypt(input.bankAccountNo, { agencyId: actor.ctx.agencyId, field: BANK_FIELD }),
          bankAccountNoLast4: last4(input.bankAccountNo),
        }
      : {};
    const [after] = await tx
      .update(schema.owners)
      .set({
        bankName: input.bankName,
        bankBranchCode: input.bankBranchCode,
        bankAccountHolder: input.bankAccountHolder,
        ...account,
      })
      .where(eq(schema.owners.id, ownerId))
      .returning();
    const diff = changes(present(before!), present(after!));
    if (Object.keys(diff.after).length) {
      await audit(tx, { action: "owner.bank_details_updated", entity: "owner", entityId: ownerId, ...diff });
    }
  });
}

/** Full bank account number for an admin; every reveal is audited. */
export async function revealOwnerBankAccount(actor: Actor, ownerId: string): Promise<string | null> {
  authorise(actor, "owner.bank.view");
  return withAgency(actor.ctx, async (tx) => {
    await assertOwnerInScope(tx, actor, ownerId);
    const [row] = await tx
      .select({ enc: schema.owners.bankAccountNoEnc })
      .from(schema.owners)
      .where(eq(schema.owners.id, ownerId));
    if (!row?.enc) return null;
    await audit(tx, { action: "owner.bank_details_revealed", entity: "owner", entityId: ownerId });
    return decrypt(row.enc, { agencyId: actor.ctx.agencyId, field: BANK_FIELD });
  });
}

export async function setOwnerArchived(actor: Actor, ownerId: string, archived: boolean): Promise<void> {
  authorise(actor, "records.edit");
  await withAgency(actor.ctx, async (tx) => {
    await assertOwnerInScope(tx, actor, ownerId);
    await tx
      .update(schema.owners)
      .set({ archivedAt: archived ? sql`now()` : null })
      .where(eq(schema.owners.id, ownerId));
    await audit(tx, { action: archived ? "owner.archived" : "owner.restored", entity: "owner", entityId: ownerId });
  });
}

/** Owners of the agency with the same ID/registration number (duplicate check). */
export async function findOwnersByIdNumber(actor: Actor, idOrRegNo: string) {
  authorise(actor, "records.view");
  const index = blindIndex(idOrRegNo, { agencyId: actor.ctx.agencyId, field: ID_FIELD });
  return withAgency(actor.ctx, (tx) =>
    tx
      .select({ id: schema.owners.id, name: schema.owners.name })
      .from(schema.owners)
      .where(eq(schema.owners.idOrRegNoBlindIndex, index)),
  );
}
