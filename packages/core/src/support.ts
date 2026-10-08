import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@awdrent/config";
import { schema, withAgency, withPlatform, type AgencyContext } from "@awdrent/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import { platformAudit } from "./platform";

// Support sessions (decision D5): a platform admin's logged, 60-minute,
// read-only-by-default access to one agency.
//
// Hand-off: the console creates the session and a single-use entry token
// (60 s). The browser carries it to {agency}/support/enter, which swaps it for
// a signed host-only cookie naming the session. Every request re-reads the
// session row, so ending it in the console takes effect immediately.

export const SUPPORT_SESSION_MINUTES = 60;
const ENTRY_TOKEN_SECONDS = 60;
export const SUPPORT_COOKIE = "awd_support";

export const supportStartSchema = z.object({
  reason: z.string().trim().min(10, "Describe why you need access (at least 10 characters)").max(500),
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function startSupportSession(adminId: string, agencyId: string, reason: string) {
  const token = randomBytes(32).toString("base64url");
  const session = await withPlatform(async (tx) => {
    const [agency] = await tx.select({ id: schema.agencies.id }).from(schema.agencies).where(eq(schema.agencies.id, agencyId));
    if (!agency) throw new Error("agency not found");
    const [row] = await tx
      .insert(schema.supportSessions)
      .values({
        platformAdminId: adminId,
        agencyId,
        reason,
        expiresAt: sql`now() + make_interval(mins => ${SUPPORT_SESSION_MINUTES})`,
        entryTokenHash: sha256(token),
        entryTokenExpiresAt: sql`now() + make_interval(secs => ${ENTRY_TOKEN_SECONDS})`,
      })
      .returning();
    if (!row) throw new Error("support session insert failed");
    await platformAudit(tx, { adminId, action: "support.started", agencyId, after: { sessionId: row.id, reason } });
    return row;
  });
  return { session, entryToken: token };
}

/** Issues a fresh entry token for a session that is still running (re-open in a new browser tab). */
export async function reissueEntryToken(adminId: string, sessionId: string) {
  const token = randomBytes(32).toString("base64url");
  const updated = await withPlatform((tx) =>
    tx
      .update(schema.supportSessions)
      .set({
        entryTokenHash: sha256(token),
        entryTokenExpiresAt: sql`now() + make_interval(secs => ${ENTRY_TOKEN_SECONDS})`,
        entryTokenUsedAt: null,
      })
      .where(
        and(
          eq(schema.supportSessions.id, sessionId),
          eq(schema.supportSessions.platformAdminId, adminId),
          isNull(schema.supportSessions.endedAt),
          gt(schema.supportSessions.expiresAt, sql`now()`),
        ),
      )
      .returning(),
  );
  return updated[0] ? { session: updated[0], entryToken: token } : null;
}

/** Atomically spends an entry token on the agency's own host. */
export async function consumeEntryToken(token: string, agencyId: string) {
  const [row] = await withPlatform((tx) =>
    tx
      .update(schema.supportSessions)
      .set({ entryTokenUsedAt: sql`now()` })
      .where(
        and(
          eq(schema.supportSessions.entryTokenHash, sha256(token)),
          eq(schema.supportSessions.agencyId, agencyId),
          isNull(schema.supportSessions.entryTokenUsedAt),
          gt(schema.supportSessions.entryTokenExpiresAt, sql`now()`),
          isNull(schema.supportSessions.endedAt),
          gt(schema.supportSessions.expiresAt, sql`now()`),
        ),
      )
      .returning(),
  );
  return row ?? null;
}

export async function activeSupportSession(sessionId: string, agencyId: string) {
  const [row] = await withPlatform((tx) =>
    tx
      .select({ session: schema.supportSessions, adminName: schema.platformAdmins.name })
      .from(schema.supportSessions)
      .innerJoin(schema.platformAdmins, eq(schema.platformAdmins.id, schema.supportSessions.platformAdminId))
      .where(
        and(
          eq(schema.supportSessions.id, sessionId),
          eq(schema.supportSessions.agencyId, agencyId),
          isNull(schema.supportSessions.endedAt),
          gt(schema.supportSessions.expiresAt, sql`now()`),
        ),
      ),
  );
  return row ?? null;
}

export async function enableSupportWriteAccess(adminId: string, sessionId: string) {
  await withPlatform(async (tx) => {
    const [row] = await tx
      .update(schema.supportSessions)
      .set({ writeAccess: true, writeConfirmedAt: sql`now()` })
      .where(
        and(
          eq(schema.supportSessions.id, sessionId),
          eq(schema.supportSessions.platformAdminId, adminId),
          isNull(schema.supportSessions.endedAt),
          gt(schema.supportSessions.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!row) throw new Error("Support session is not active");
    await platformAudit(tx, { adminId, action: "support.write_enabled", agencyId: row.agencyId, after: { sessionId } });
  });
}

export async function endSupportSession(adminId: string, sessionId: string) {
  await withPlatform(async (tx) => {
    const [row] = await tx
      .update(schema.supportSessions)
      .set({ endedAt: sql`now()` })
      .where(and(eq(schema.supportSessions.id, sessionId), isNull(schema.supportSessions.endedAt)))
      .returning();
    if (row) await platformAudit(tx, { adminId, action: "support.ended", agencyId: row.agencyId, after: { sessionId } });
  });
}

// ─── cookie ──────────────────────────────────────────────────────────

function sign(value: string): string {
  return createHmac("sha256", env().PLATFORM_AUTH_SECRET).update(`support:${value}`).digest("base64url");
}

export function supportCookieValue(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

/** Session id from a cookie value, or null if the signature is wrong. */
export function readSupportCookie(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const id = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(id));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

/** Agency-side record of what support looked at (a separate write, so read-only sessions are logged too). */
export async function logSupportView(ctx: AgencyContext, path: string) {
  await withAgency({ ...ctx, readOnly: false }, (tx) =>
    audit(tx, { action: "support.page_viewed", entity: "support_session", entityId: ctx.supportSessionId ?? null, after: { path } }),
  );
}
