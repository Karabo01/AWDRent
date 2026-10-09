"use server";

import {
  createOwner,
  ownerBankSchema,
  ownerSchema,
  OwnerPortalError,
  revealOwnerBankAccount,
  setOwnerArchived,
  setOwnerPortal,
  updateOwner,
  updateOwnerBank,
} from "@awdrent/core/owners";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";

export async function createOwnerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const parsed = parseForm(ownerSchema, form);
  if (!parsed.data) return parsed.state;
  let id = "";
  const failed = await mutate(async () => {
    id = await createOwner(actorOf(s), parsed.data);
  });
  if (failed) return failed;
  redirect(`/owners/${id}`);
}

export async function updateOwnerAction(ownerId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const parsed = parseForm(ownerSchema, form);
  if (!parsed.data) return parsed.state;
  const failed = await mutate(() => updateOwner(actorOf(s), z.uuid().parse(ownerId), parsed.data));
  if (failed) return failed;
  revalidatePath(`/owners/${ownerId}`);
  return { ok: true };
}

export async function updateOwnerBankAction(ownerId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("owner.bank.edit");
  const parsed = parseForm(ownerBankSchema, form);
  if (!parsed.data) return parsed.state;
  const failed = await mutate(() => updateOwnerBank(actorOf(s), z.uuid().parse(ownerId), parsed.data));
  if (failed) return failed;
  revalidatePath(`/owners/${ownerId}`);
  return { ok: true };
}

/** Returns the full account number to the admin's screen; the reveal is audited. */
export async function revealOwnerBankAction(ownerId: string): Promise<{ value?: string | null; error?: string }> {
  const s = await requireCan("owner.bank.view");
  let value: string | null = null;
  const failed = await mutate(async () => {
    value = await revealOwnerBankAccount(actorOf(s), z.uuid().parse(ownerId));
  });
  return failed ? { error: failed.error } : { value };
}

export async function setOwnerArchivedAction(ownerId: string, archived: boolean): Promise<void> {
  const s = await requireCan("records.edit");
  await mutate(() => setOwnerArchived(actorOf(s), z.uuid().parse(ownerId), archived));
  revalidatePath(`/owners/${ownerId}`);
  revalidatePath("/owners");
}

export async function setOwnerPortalAction(ownerId: string, enabled: boolean, _prev: FormState): Promise<FormState> {
  const s = await requireCan("records.edit");
  try {
    const failed = await mutate(() => setOwnerPortal(actorOf(s), z.uuid().parse(ownerId), enabled));
    if (failed) return failed;
  } catch (err) {
    if (err instanceof OwnerPortalError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owners/${ownerId}`);
  return { ok: true };
}
