import "server-only";
import { parseHost } from "@awdrent/core/hosts";
import { activeSupportSession, logSupportView, readSupportCookie, SUPPORT_COOKIE } from "@awdrent/core/support";
import { publicAgencyBySubdomain, type AgencyContext, type PublicAgency } from "@awdrent/db";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { platformAuth } from "./auth/platform";
import { staffAuth } from "./auth/staff";

export type StaffRole = "admin" | "agent" | "accounts";

export interface SupportInfo {
  sessionId: string;
  adminName: string;
  writeAccess: boolean;
  expiresAt: Date;
}

export interface StaffSession {
  agency: PublicAgency;
  /** id is null for AWDTECH support, who act as a (read-only by default) admin. */
  user: { id: string | null; name: string; email: string; role: StaffRole };
  /** Pass to withAgency(). Built only from the verified session. */
  ctx: AgencyContext;
  support?: SupportInfo;
}

/** The agency for this request's host, or 404. Cached per request. */
export const currentAgency = cache(async (): Promise<PublicAgency> => {
  const host = parseHost((await headers()).get("host"));
  if (host.kind !== "agency") notFound();
  const agency = await publicAgencyBySubdomain(host.subdomain);
  if (!agency) notFound();
  return agency;
});

/**
 * The signed-in staff member (or AWDTECH support session) on this agency's
 * host, with 2FA set up. Redirects to login, 2FA setup or the suspended page
 * otherwise. Call at the top of every staff page, server action and route handler.
 */
export const requireStaff = cache(async (): Promise<StaffSession> => {
  const support = await supportSession();
  if (support) return support;
  const s = await optionalStaffSession();
  if (!s) redirect("/login");
  if (!s.twoFactorEnabled) redirect("/setup-2fa");
  return s.session;
});

/** Like requireStaff, but 404s for roles not listed. */
export async function requireRole(...roles: StaffRole[]): Promise<StaffSession> {
  const s = await requireStaff();
  if (!roles.includes(s.user.role)) notFound();
  return s;
}

/** Session without the 2FA requirement; only for the 2FA setup page itself. */
export const optionalStaffSession = cache(async () => {
  const agency = await currentAgency();
  if (agency.status !== "active") redirect("/suspended");
  const result = await staffAuth().api.getSession({ headers: await headers() });
  if (!result) return null;
  const { user, session } = result;
  // Defence in depth: cookies are host-only, and login already checks this
  if (session.agencyId !== agency.id || user.agencyId !== agency.id || !user.active) return null;
  return {
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    session: {
      agency,
      user: { id: user.id, name: user.name, email: user.email, role: user.role as StaffRole },
      ctx: { agencyId: agency.id, userId: user.id },
    } satisfies StaffSession,
  };
});

/**
 * A platform admin's support session on this host. Re-checked against the
 * database on every request; ending or expiring it in the console cuts access.
 * Works for suspended agencies too, so support can investigate.
 */
const supportSession = cache(async (): Promise<StaffSession | null> => {
  const sessionId = readSupportCookie((await cookies()).get(SUPPORT_COOKIE)?.value);
  if (!sessionId) return null;
  const agency = await currentAgency();
  const active = await activeSupportSession(sessionId, agency.id);
  if (!active) return null;
  const ctx: AgencyContext = { agencyId: agency.id, supportSessionId: sessionId, readOnly: !active.session.writeAccess };
  await logSupportView(ctx, (await headers()).get("x-awd-path") ?? "unknown");
  return {
    agency,
    user: { id: null, name: `${active.adminName} (AWDTECH support)`, email: "", role: "admin" },
    ctx,
    support: {
      sessionId,
      adminName: active.adminName,
      writeAccess: active.session.writeAccess,
      expiresAt: active.session.expiresAt,
    },
  };
});

export interface PlatformSession {
  admin: { id: string; name: string; email: string };
}

export const optionalPlatformSession = cache(async () => {
  const host = parseHost((await headers()).get("host"));
  if (host.kind !== "platform") notFound();
  const result = await platformAuth().api.getSession({ headers: await headers() });
  if (!result) return null;
  return {
    twoFactorEnabled: Boolean(result.user.twoFactorEnabled),
    session: { admin: { id: result.user.id, name: result.user.name, email: result.user.email } } as PlatformSession,
  };
});

export const requirePlatformAdmin = cache(async (): Promise<PlatformSession> => {
  const s = await optionalPlatformSession();
  if (!s) redirect("/login");
  if (!s.twoFactorEnabled) redirect("/setup-2fa");
  return s.session;
});
