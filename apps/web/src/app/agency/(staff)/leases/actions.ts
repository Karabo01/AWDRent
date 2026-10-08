"use server";

import {
  activateLease,
  amendLease,
  applyEscalation,
  createLease,
  endLease,
  giveNotice,
  leaseAmendSchema,
  leaseCreateSchema,
  leaseNoticeSchema,
  leaseRenewSchema,
  LeaseRuleError,
  leaseTerminateSchema,
  renewLease,
  terminateLease,
} from "@awdrent/core/leases";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, formValues, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";

/** Runs a lease change, turning rule violations into a form message. */
async function leaseChange(form: FormData | null, fn: () => Promise<void>): Promise<FormState | null> {
  try {
    return await mutate(fn);
  } catch (err) {
    if (err instanceof LeaseRuleError) return { error: err.message, values: form ? formValues(form) : undefined };
    throw err;
  }
}

export async function createLeaseAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const raw = { ...formValues(form), coTenantIds: form.getAll("coTenantIds").map(String) };
  const parsed = leaseCreateSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { error: "Please fix the highlighted fields.", fieldErrors, values: formValues(form) };
  }
  let id = "";
  const failed = await leaseChange(form, async () => {
    id = (await createLease(actorOf(s), parsed.data)).id;
  });
  if (failed) return failed;
  redirect(`/leases/${id}`);
}

function bound(leaseId: string) {
  return z.uuid().parse(leaseId);
}

export async function activateLeaseAction(leaseId: string, _prev: FormState): Promise<FormState> {
  const s = await requireCan("records.edit");
  const failed = await leaseChange(null, () => activateLease(actorOf(s), bound(leaseId)));
  if (failed) return failed;
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true };
}

export async function applyEscalationAction(leaseId: string, _prev: FormState): Promise<FormState> {
  const s = await requireCan("records.edit");
  const failed = await leaseChange(null, () => applyEscalation(actorOf(s), bound(leaseId)));
  if (failed) return failed;
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true };
}

export async function endLeaseAction(leaseId: string, _prev: FormState): Promise<FormState> {
  const s = await requireCan("records.edit");
  const failed = await leaseChange(null, () => endLease(actorOf(s), bound(leaseId)));
  if (failed) return failed;
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true };
}

export async function amendLeaseAction(leaseId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const parsed = parseForm(leaseAmendSchema, form);
  if (!parsed.data) return parsed.state;
  const failed = await leaseChange(form, () => amendLease(actorOf(s), bound(leaseId), parsed.data));
  if (failed) return failed;
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true };
}

export async function renewLeaseAction(leaseId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const parsed = parseForm(leaseRenewSchema, form);
  if (!parsed.data) return parsed.state;
  const failed = await leaseChange(form, () => renewLease(actorOf(s), bound(leaseId), parsed.data));
  if (failed) return failed;
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true };
}

export async function giveNoticeAction(leaseId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const parsed = parseForm(leaseNoticeSchema, form);
  if (!parsed.data) return parsed.state;
  const failed = await leaseChange(form, () => giveNotice(actorOf(s), bound(leaseId), parsed.data));
  if (failed) return failed;
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true };
}

export async function terminateLeaseAction(leaseId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const parsed = parseForm(leaseTerminateSchema, form);
  if (!parsed.data) return parsed.state;
  const failed = await leaseChange(form, () => terminateLease(actorOf(s), bound(leaseId), parsed.data));
  if (failed) return failed;
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true };
}
