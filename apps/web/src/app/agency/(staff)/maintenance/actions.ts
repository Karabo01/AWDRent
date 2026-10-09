"use server";

import { contractorSchema, logRequest, MaintenanceError, requestSchema, saveContractor, updateRequest, updateSchema } from "@awdrent/core/maintenance";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, formValues, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";
import { writeGuard } from "@/server/writes";

async function run(fn: () => Promise<unknown>, form: FormData): Promise<FormState | null> {
  try {
    return await mutate(async () => void (await fn()));
  } catch (err) {
    if (err instanceof MaintenanceError) return { error: err.message, values: formValues(form) };
    throw err;
  }
}

export async function logRequestAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("maintenance.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const parsed = parseForm(requestSchema.extend({ unitId: z.uuid("Choose the unit") }), form);
  if (!parsed.data) return parsed.state;
  let id = "";
  const failed = await run(async () => (id = await logRequest(actorOf(s), parsed.data)), form);
  if (failed) return failed;
  redirect(`/maintenance/${id}`);
}

export async function updateRequestAction(requestId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("maintenance.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const parsed = parseForm(updateSchema, form);
  if (!parsed.data) return parsed.state;
  const failed = await run(() => updateRequest(actorOf(s), z.uuid().parse(requestId), parsed.data), form);
  if (failed) return failed;
  revalidatePath(`/maintenance/${requestId}`);
  return { ok: true };
}

export async function saveContractorAction(contractorId: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("maintenance.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const parsed = parseForm(contractorSchema, form);
  if (!parsed.data) return parsed.state;
  const active = contractorId ? form.get("active") === "on" : true;
  const failed = await run(() => saveContractor(actorOf(s), contractorId ? z.uuid().parse(contractorId) : null, { ...parsed.data, active }), form);
  if (failed) return failed;
  revalidatePath("/maintenance/contractors");
  return { ok: true };
}
