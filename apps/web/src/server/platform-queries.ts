import "server-only";
import { env } from "@awdrent/config";
import { devOutbox } from "@awdrent/core/email";
import { authDb, schema } from "@awdrent/db";
import { and, eq } from "drizzle-orm";

/**
 * An agency's admin logins, for the console (contact and invite status only).
 * Read through the auth role; the platform role cannot see agency staff.
 * Callers must have checked requirePlatformAdmin().
 */
export async function agencyAdmins(agencyId: string) {
  return authDb()
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      lastLoginAt: schema.users.lastLoginAt,
      active: schema.users.active,
    })
    .from(schema.users)
    .where(and(eq(schema.users.agencyId, agencyId), eq(schema.users.role, "admin")));
}

/** Local development without Resend: the newest emailed link for an address. */
export function devEmailLink(email: string): string | null {
  if (env().NODE_ENV === "production" || env().RESEND_API_KEY) return null;
  const mail = [...devOutbox].reverse().find((m) => m.to === email);
  return mail?.text.match(/https?:\/\/\S+/)?.[0] ?? null;
}
