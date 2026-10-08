"use server";

import { agencyOrigin } from "@awdrent/core/hosts";
import {
  agencyCreateSchema,
  agencyUpdateSchema,
  createAgency,
  EmailTakenError,
  getAgency,
  setAgencyStatus,
  SubdomainTakenError,
  updateAgency,
} from "@awdrent/core/platform";
import {
  endSupportSession,
  enableSupportWriteAccess,
  reissueEntryToken,
  startSupportSession,
  supportStartSchema,
} from "@awdrent/core/support";
import { authDb, schema } from "@awdrent/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sendStaffInvite } from "@/server/auth/staff";
import { type FormState, formValues, parseForm } from "@/server/forms";
import { requirePlatformAdmin } from "@/server/session";

const agencyId = z.uuid();

export async function createAgencyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { admin } = await requirePlatformAdmin();
  const parsed = parseForm(agencyCreateSchema, form);
  if (!parsed.data) return parsed.state;
  let created: Awaited<ReturnType<typeof createAgency>>;
  try {
    created = await createAgency(admin.id, parsed.data);
  } catch (err) {
    const values = formValues(form);
    if (err instanceof SubdomainTakenError) return { fieldErrors: { subdomain: err.message }, values };
    if (err instanceof EmailTakenError) return { fieldErrors: { adminEmail: err.message }, values };
    throw err;
  }
  await sendStaffInvite(created.adminUserId);
  redirect(`/agencies/${created.agency.id}?created=1`);
}

export async function updateAgencyAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const { admin } = await requirePlatformAdmin();
  const parsed = parseForm(agencyUpdateSchema, form);
  if (!parsed.data) return parsed.state;
  await updateAgency(admin.id, agencyId.parse(id), parsed.data);
  revalidatePath(`/agencies/${id}`);
  return { ok: true };
}

export async function setAgencyStatusAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const { admin } = await requirePlatformAdmin();
  const status = z.enum(["active", "suspended"]).parse(form.get("status"));
  const reason = String(form.get("reason") ?? "").trim();
  if (status === "suspended" && reason.length < 5) {
    return { fieldErrors: { reason: "Give a reason the agency will understand." }, values: formValues(form) };
  }
  await setAgencyStatus(admin.id, agencyId.parse(id), status, reason || null);
  if (status === "suspended") {
    // Sign every staff member out now rather than at their next request
    await authDb().delete(schema.authSessions).where(eq(schema.authSessions.agencyId, id));
  }
  revalidatePath(`/agencies/${id}`);
  revalidatePath("/");
  return { ok: true };
}

/** Starts a session and sends the admin's browser to the agency with a one-time token. */
export async function startSupportAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const { admin } = await requirePlatformAdmin();
  const parsed = parseForm(supportStartSchema, form);
  if (!parsed.data) return parsed.state;
  const details = await getAgency(agencyId.parse(id));
  if (!details) return { error: "Agency not found" };
  const { entryToken } = await startSupportSession(admin.id, id, parsed.data.reason);
  redirect(`${agencyOrigin(details.agency.subdomain)}/support/enter?token=${entryToken}`);
}

export async function reopenSupportAction(sessionId: string) {
  const { admin } = await requirePlatformAdmin();
  const result = await reissueEntryToken(admin.id, z.uuid().parse(sessionId));
  if (!result) throw new Error("This support session has ended.");
  const details = await getAgency(result.session.agencyId);
  if (!details) throw new Error("Agency not found");
  redirect(`${agencyOrigin(details.agency.subdomain)}/support/enter?token=${result.entryToken}`);
}

export async function enableSupportWriteAction(
  sessionId: string,
  agencySubdomain: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { admin } = await requirePlatformAdmin();
  // Second confirmation (decision D5): retype the agency's address
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== agencySubdomain) {
    return { fieldErrors: { confirm: `Type ${agencySubdomain} to confirm.` } };
  }
  await enableSupportWriteAccess(admin.id, z.uuid().parse(sessionId));
  revalidatePath("/agencies", "layout");
  return { ok: true };
}

export async function endSupportAction(sessionId: string) {
  const { admin } = await requirePlatformAdmin();
  await endSupportSession(admin.id, z.uuid().parse(sessionId));
  revalidatePath("/agencies");
}

/** Re-sends an agency admin's invite (e.g. it expired). Only for admins who never signed in. */
export async function resendInviteAction(userId: string) {
  await requirePlatformAdmin();
  const [user] = await authDb()
    .select({ lastLoginAt: schema.users.lastLoginAt, role: schema.users.role, agencyId: schema.users.agencyId })
    .from(schema.users)
    .where(eq(schema.users.id, z.uuid().parse(userId)));
  if (!user || user.role !== "admin" || user.lastLoginAt) throw new Error("This invite can't be resent.");
  await sendStaffInvite(userId);
  revalidatePath(`/agencies/${user.agencyId}`);
}
