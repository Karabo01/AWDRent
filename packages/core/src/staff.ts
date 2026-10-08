import { schema, withAgency, type AgencyContext } from "@awdrent/db";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { audit, changes } from "./audit";

// Agency staff management (admins only; checked by the caller).

const roleEnum = z.enum(["admin", "agent", "accounts"]);
const phone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s()-]/g, ""))
  .refine((s) => s === "" || /^\+?\d{9,15}$/.test(s), "Enter a phone number like 082 123 4567")
  .transform((s) => s || null);

export const staffInviteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase(),
  role: roleEnum,
  phone,
});
export type StaffInviteInput = z.infer<typeof staffInviteSchema>;

export const staffUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  role: roleEnum,
  phone,
  active: z.enum(["true", "false"]).transform((v) => v === "true"),
});
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

export class StaffRuleError extends Error {}

export async function listStaff(ctx: AgencyContext) {
  return withAgency(ctx, (tx) =>
    tx
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        phone: schema.users.phone,
        role: schema.users.role,
        active: schema.users.active,
        twoFactorEnabled: schema.users.twoFactorEnabled,
        lastLoginAt: schema.users.lastLoginAt,
      })
      .from(schema.users)
      .orderBy(asc(schema.users.name)),
  );
}

export async function getStaff(ctx: AgencyContext, userId: string) {
  const rows = await withAgency(ctx, (tx) => tx.select().from(schema.users).where(eq(schema.users.id, userId)));
  return rows[0] ?? null;
}

/** Creates the staff row; the caller emails the invite. */
export async function inviteStaff(ctx: AgencyContext, input: StaffInviteInput): Promise<string> {
  try {
    return await withAgency(ctx, async (tx) => {
      const [row] = await tx
        .insert(schema.users)
        .values({ ...input, createdBy: ctx.userId ?? null })
        .returning();
      if (!row) throw new Error("insert failed");
      await audit(tx, {
        action: "user.invited",
        entity: "user",
        entityId: row.id,
        after: { name: row.name, email: row.email, role: row.role, phone: row.phone },
      });
      return row.id;
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; constraint?: string } }).cause;
    if (cause?.code === "23505" && cause.constraint === "users_email_key") {
      throw new StaffRuleError("That email can't be used for a new login. Use a different address or contact support.");
    }
    throw err;
  }
}

/**
 * Updates a staff member. Admins cannot demote or deactivate themselves, and
 * the agency always keeps at least one active admin.
 * Returns true when the user was deactivated (caller revokes their sessions).
 */
export async function updateStaff(ctx: AgencyContext, userId: string, input: StaffUpdateInput): Promise<boolean> {
  return withAgency(ctx, async (tx) => {
    const [before] = await tx.select().from(schema.users).where(eq(schema.users.id, userId)).for("update");
    if (!before) throw new StaffRuleError("Staff member not found");
    if (userId === ctx.userId && (input.role !== "admin" || !input.active)) {
      throw new StaffRuleError("You can't remove your own admin access. Ask another admin.");
    }
    if (before.role === "admin" && before.active && (input.role !== "admin" || !input.active)) {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.users)
        .where(and(eq(schema.users.role, "admin"), eq(schema.users.active, true), ne(schema.users.id, userId)));
      if (n === 0) throw new StaffRuleError("The agency needs at least one active admin.");
    }
    const [after] = await tx.update(schema.users).set(input).where(eq(schema.users.id, userId)).returning();
    const diff = changes(
      { name: before.name, role: before.role, phone: before.phone, active: before.active },
      { name: after!.name, role: after!.role, phone: after!.phone, active: after!.active },
    );
    if (Object.keys(diff.after).length > 0) {
      await audit(tx, { action: "user.updated", entity: "user", entityId: userId, ...diff });
    }
    return before.active && !input.active;
  });
}

export async function listAudit(ctx: AgencyContext, opts: { limit: number; before?: Date }) {
  return withAgency(ctx, (tx) =>
    tx
      .select({ entry: schema.auditLog, userName: schema.users.name, portalName: schema.portalUsers.name })
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
      .leftJoin(schema.portalUsers, eq(schema.portalUsers.id, schema.auditLog.portalUserId))
      .where(opts.before ? sql`${schema.auditLog.createdAt} < ${opts.before}` : undefined)
      .orderBy(sql`${schema.auditLog.createdAt} desc`)
      .limit(opts.limit),
  );
}
