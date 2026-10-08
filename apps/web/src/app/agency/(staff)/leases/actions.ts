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
import {
  depositDeductionSchema,
  depositMoneySchema,
  recordDepositDeduction,
  recordDepositInterest,
  recordDepositReceived,
  recordDepositRefund,
  voidDepositEntry,
} from "@awdrent/core/deposits";
import { addCharge, chargeSchema, LedgerRuleError, voidCharge, voidSchema } from "@awdrent/core/ledger";
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

export async function addChargeAction(leaseId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("ledger.charge");
  const parsed = parseForm(chargeSchema, form);
  if (!parsed.data) return parsed.state;
  try {
    const failed = await mutate(async () => {
      await addCharge(actorOf(s), bound(leaseId), parsed.data);
    });
    if (failed) return failed;
  } catch (err) {
    if (err instanceof LedgerRuleError) return { error: err.message, values: formValues(form) };
    throw err;
  }
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true };
}

export async function voidChargeAction(leaseId: string, chargeId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("ledger.void");
  const parsed = parseForm(voidSchema, form);
  if (!parsed.data) return parsed.state;
  try {
    const failed = await mutate(() => voidCharge(actorOf(s), z.uuid().parse(chargeId), parsed.data.reason));
    if (failed) return failed;
  } catch (err) {
    if (err instanceof LedgerRuleError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true };
}

// ─── deposits ────────────────────────────────────────────────────────

async function depositChange(leaseId: string, fn: () => Promise<unknown>, form?: FormData): Promise<FormState> {
  try {
    const failed = await mutate(async () => {
      await fn();
    });
    if (failed) return failed;
  } catch (err) {
    if (err instanceof LedgerRuleError) return { error: err.message, values: form ? formValues(form) : undefined };
    throw err;
  }
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true };
}

export async function depositMoneyAction(
  leaseId: string,
  kind: "received" | "interest" | "refund",
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const s = await requireCan("deposits.manage");
  const parsed = parseForm(depositMoneySchema, form);
  if (!parsed.data) return parsed.state;
  const fn = { received: recordDepositReceived, interest: recordDepositInterest, refund: recordDepositRefund }[kind];
  return depositChange(leaseId, () => fn(actorOf(s), bound(leaseId), parsed.data), form);
}

export async function depositDeductionAction(leaseId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("deposits.manage");
  const parsed = parseForm(depositDeductionSchema, form);
  if (!parsed.data) return parsed.state;
  return depositChange(leaseId, () => recordDepositDeduction(actorOf(s), bound(leaseId), parsed.data), form);
}

export async function voidDepositEntryAction(leaseId: string, entryId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("deposits.manage");
  const parsed = parseForm(voidSchema, form);
  if (!parsed.data) return parsed.state;
  return depositChange(leaseId, () => voidDepositEntry(actorOf(s), z.uuid().parse(entryId), parsed.data.reason));
}
