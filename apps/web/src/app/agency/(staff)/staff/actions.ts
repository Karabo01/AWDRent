"use server";

import { inviteStaff, StaffRuleError, staffInviteSchema, staffUpdateSchema, updateStaff } from "@awdrent/core/staff";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { revokeStaffSessions, sendStaffInvite } from "@/server/auth/staff";
import { type FormState, formValues, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";
import { readOnlyError, writeGuard } from "@/server/writes";

export async function inviteStaffAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("staff.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const parsed = parseForm(staffInviteSchema, form);
  if (!parsed.data) return parsed.state;
  let userId: string;
  try {
    userId = await inviteStaff(s.ctx, parsed.data);
  } catch (err) {
    if (err instanceof StaffRuleError) return { fieldErrors: { email: err.message }, values: formValues(form) };
    const ro = readOnlyError(err);
    if (ro) return ro;
    throw err;
  }
  await sendStaffInvite(userId);
  revalidatePath("/staff");
  redirect(`/staff?invited=${encodeURIComponent(parsed.data.email)}`);
}

export async function updateStaffAction(userId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("staff.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const parsed = parseForm(staffUpdateSchema, form);
  if (!parsed.data) return parsed.state;
  const id = z.uuid().parse(userId);
  try {
    const deactivated = await updateStaff(s.ctx, id, parsed.data);
    if (deactivated) await revokeStaffSessions(id);
  } catch (err) {
    if (err instanceof StaffRuleError) return { error: err.message, values: formValues(form) };
    const ro = readOnlyError(err);
    if (ro) return ro;
    throw err;
  }
  revalidatePath("/staff");
  return { ok: true };
}

export async function resendStaffInviteAction(userId: string): Promise<void> {
  const s = await requireCan("staff.manage");
  if (s.ctx.readOnly) return;
  const { getStaff } = await import("@awdrent/core/staff");
  // Loading through withAgency first proves the user belongs to this agency
  const user = await getStaff(s.ctx, z.uuid().parse(userId));
  if (!user || user.lastLoginAt || !user.active) return;
  await sendStaffInvite(user.id);
  revalidatePath("/staff");
}
