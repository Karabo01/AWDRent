import "server-only";
import type { OwnerActor } from "@awdrent/core/owner-portal";
import { type PortalActor, portalOwner, portalUser } from "@awdrent/core/portal";
import type { PublicAgency } from "@awdrent/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { portalAuth } from "./auth/portal";
import { currentAgency } from "./session";

export interface TenantSession {
  agency: PublicAgency;
  name: string;
  /** Pass to the core portal functions. Built only from the verified session. */
  actor: PortalActor;
}

/**
 * The signed-in tenant on this agency's host, or null. The portal user and
 * their tenant record are re-checked on every request, so archiving the
 * tenant or switching off their access takes effect at once.
 */
export const optionalTenant = cache(async (): Promise<TenantSession | null> => {
  const agency = await currentAgency();
  if (agency.status !== "active") return null;
  const result = await portalAuth().api.getSession({ headers: await headers() });
  if (!result) return null;
  // Defence in depth: cookies are host-only, and sign-in already checks this
  if ((result.session as { agencyId?: string }).agencyId !== agency.id) return null;
  const row = await portalUser(agency.id, result.user.id);
  if (!row) return null;
  return {
    agency,
    name: row.tenant.fullName,
    actor: { ctx: { agencyId: agency.id, portalUserId: row.user.id }, tenantId: row.tenant.id },
  };
});

/** Call at the top of every portal page, action and route; sends others to sign in. */
export async function requireTenant(next?: string): Promise<TenantSession> {
  const t = await optionalTenant();
  if (!t) redirect(next ? `/p/login?next=${encodeURIComponent(next)}` : "/p/login");
  return t;
}

export interface OwnerSession {
  agency: PublicAgency;
  name: string;
  actor: OwnerActor;
}

/** The signed-in owner on this agency's host (D104), or null; re-checked on every request. */
export const optionalOwner = cache(async (): Promise<OwnerSession | null> => {
  const agency = await currentAgency();
  if (agency.status !== "active") return null;
  const result = await portalAuth().api.getSession({ headers: await headers() });
  if (!result || (result.session as { agencyId?: string }).agencyId !== agency.id) return null;
  const row = await portalOwner(agency.id, result.user.id);
  if (!row) return null;
  return { agency, name: row.owner.name, actor: { ctx: { agencyId: agency.id, portalUserId: row.user.id }, ownerId: row.owner.id } };
});

export async function requireOwner(next?: string): Promise<OwnerSession> {
  const o = await optionalOwner();
  if (!o) redirect(next ? `/op/login?next=${encodeURIComponent(next)}` : "/op/login");
  return o;
}

/** Only portal paths may follow sign-in, so the login page is no open redirect. */
export function safeNext(next: string | undefined | null): string {
  return next && /^\/(p|r|op)(\/[A-Za-z0-9._~\-/]*)?(\?[A-Za-z0-9=&%._-]*)?$/.test(next) && !next.includes("//") ? next : "/p";
}
