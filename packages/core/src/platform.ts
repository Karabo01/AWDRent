import { schema, withAgency, withPlatform, type Tx } from "@awdrent/db";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";

// Platform console operations. All run as the platform role, which can see
// agencies and usage but no agency records; the one exception is creating an
// agency's first admin, which runs inside that new agency's own context.

const RESERVED = new Set(["admin", "www", "api", "files", "mail", "app"]);

export const agencyCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/, "Lowercase letters, digits and dashes; 1–32 characters")
    .refine((s) => !RESERVED.has(s), "That address is reserved"),
  eftPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}$/, "2–4 capital letters"),
  plan: z.string().trim().min(1).max(40).default("standard"),
  includedUnits: z.coerce.number().int().min(0).max(100_000),
  includedSms: z.coerce.number().int().min(0).max(1_000_000),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.email().trim().toLowerCase(),
});
export type AgencyCreateInput = z.infer<typeof agencyCreateSchema>;

export const agencyUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  plan: z.string().trim().min(1).max(40),
  includedUnits: z.coerce.number().int().min(0).max(100_000),
  includedSms: z.coerce.number().int().min(0).max(1_000_000),
  smsSenderName: z
    .string()
    .trim()
    .max(11, "SMS sender IDs are at most 11 characters")
    .regex(/^[A-Za-z0-9 ]*$/, "Letters, digits and spaces only")
    .transform((s) => s || null),
});
export type AgencyUpdateInput = z.infer<typeof agencyUpdateSchema>;

export async function platformAudit(
  tx: Tx,
  entry: { adminId: string; action: string; agencyId?: string | null; before?: unknown; after?: unknown },
) {
  await tx.insert(schema.platformAuditLog).values({
    platformAdminId: entry.adminId,
    action: entry.action,
    agencyId: entry.agencyId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

/** Public fields of an agency for logs (never the bank number). */
function agencySummary(a: typeof schema.agencies.$inferSelect) {
  return {
    name: a.name,
    subdomain: a.subdomain,
    eftPrefix: a.eftPrefix,
    plan: a.plan,
    includedUnits: a.includedUnits,
    includedSms: a.includedSms,
    smsSenderName: a.smsSenderName,
    status: a.status,
    suspendedReason: a.suspendedReason,
  };
}

export class SubdomainTakenError extends Error {
  constructor() {
    super("That subdomain is already in use");
  }
}

export class EmailTakenError extends Error {
  constructor() {
    super("That email already belongs to a staff login");
  }
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } }).cause ?? (err as { code?: string; constraint?: string });
  return cause?.code === "23505" && cause.constraint === constraint;
}

/**
 * Creates the agency and its first admin user. The caller then sends the
 * admin an invite (web layer, because it needs the auth instance).
 */
export async function createAgency(adminId: string, input: AgencyCreateInput) {
  let agency: typeof schema.agencies.$inferSelect;
  try {
    agency = await withPlatform(async (tx) => {
      const [row] = await tx
        .insert(schema.agencies)
        .values({
          name: input.name,
          subdomain: input.subdomain,
          eftPrefix: input.eftPrefix,
          plan: input.plan,
          includedUnits: input.includedUnits,
          includedSms: input.includedSms,
          createdBy: adminId,
        })
        .returning();
      if (!row) throw new Error("agency insert failed");
      await platformAudit(tx, { adminId, action: "agency.created", agencyId: row.id, after: agencySummary(row) });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err, "agencies_subdomain_key")) throw new SubdomainTakenError();
    throw err;
  }

  try {
    const user = await withAgency({ agencyId: agency.id }, async (tx) => {
      const [row] = await tx
        .insert(schema.users)
        .values({ name: input.adminName, email: input.adminEmail, role: "admin" })
        .returning();
      if (!row) throw new Error("user insert failed");
      await audit(tx, {
        action: "user.created",
        entity: "user",
        entityId: row.id,
        after: { name: row.name, email: row.email, role: row.role, by: "platform" },
      });
      return row;
    });
    return { agency, adminUserId: user.id };
  } catch (err) {
    if (isUniqueViolation(err, "users_email_key")) {
      // The agency exists without an admin; the console offers "add admin" again
      throw new EmailTakenError();
    }
    throw err;
  }
}

export async function listAgencies() {
  return withPlatform(async (tx) => {
    const month = sql`date_trunc('month', now())::date`;
    return tx
      .select({
        agency: schema.agencies,
        usage: schema.usageCounters,
      })
      .from(schema.agencies)
      .leftJoin(
        schema.usageCounters,
        sql`${schema.usageCounters.agencyId} = ${schema.agencies.id} and ${schema.usageCounters.month} = ${month}`,
      )
      .orderBy(schema.agencies.name);
  });
}

export async function getAgency(agencyId: string) {
  return withPlatform(async (tx) => {
    const [agency] = await tx.select().from(schema.agencies).where(eq(schema.agencies.id, agencyId));
    if (!agency) return null;
    const usage = await tx
      .select()
      .from(schema.usageCounters)
      .where(eq(schema.usageCounters.agencyId, agencyId))
      .orderBy(desc(schema.usageCounters.month))
      .limit(12);
    const support = await tx
      .select({ session: schema.supportSessions, adminName: schema.platformAdmins.name })
      .from(schema.supportSessions)
      .innerJoin(schema.platformAdmins, eq(schema.platformAdmins.id, schema.supportSessions.platformAdminId))
      .where(eq(schema.supportSessions.agencyId, agencyId))
      .orderBy(desc(schema.supportSessions.startedAt))
      .limit(20);
    const log = await tx
      .select({ entry: schema.platformAuditLog, adminName: schema.platformAdmins.name })
      .from(schema.platformAuditLog)
      .leftJoin(schema.platformAdmins, eq(schema.platformAdmins.id, schema.platformAuditLog.platformAdminId))
      .where(eq(schema.platformAuditLog.agencyId, agencyId))
      .orderBy(desc(schema.platformAuditLog.createdAt))
      .limit(50);
    return { agency, usage, support, log };
  });
}

export async function updateAgency(adminId: string, agencyId: string, input: AgencyUpdateInput) {
  return withPlatform(async (tx) => {
    const [before] = await tx.select().from(schema.agencies).where(eq(schema.agencies.id, agencyId)).for("update");
    if (!before) throw new Error("agency not found");
    const [after] = await tx.update(schema.agencies).set(input).where(eq(schema.agencies.id, agencyId)).returning();
    await platformAudit(tx, {
      adminId,
      action: "agency.updated",
      agencyId,
      before: agencySummary(before),
      after: after ? agencySummary(after) : null,
    });
  });
}

/** Suspending blocks every staff login for the agency at once; data is untouched. */
export async function setAgencyStatus(
  adminId: string,
  agencyId: string,
  status: "active" | "suspended",
  reason: string | null,
) {
  return withPlatform(async (tx) => {
    const [before] = await tx.select().from(schema.agencies).where(eq(schema.agencies.id, agencyId)).for("update");
    if (!before) throw new Error("agency not found");
    if (status === "suspended" && !reason?.trim()) throw new Error("A reason is required to suspend an agency");
    await tx
      .update(schema.agencies)
      .set({ status, suspendedReason: status === "suspended" ? reason!.trim() : null })
      .where(eq(schema.agencies.id, agencyId));
    await platformAudit(tx, {
      adminId,
      action: status === "suspended" ? "agency.suspended" : "agency.reactivated",
      agencyId,
      before: { status: before.status },
      after: { status, reason },
    });
  });
}
