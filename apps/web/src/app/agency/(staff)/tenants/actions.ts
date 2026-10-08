"use server";

import { createTenant, revealTenantIdNumber, tenantSchema, updateTenant } from "@awdrent/core/tenants";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";

export async function createTenantAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const parsed = parseForm(tenantSchema, form);
  if (!parsed.data) return parsed.state;
  let id = "";
  const failed = await mutate(async () => {
    id = await createTenant(actorOf(s), parsed.data);
  });
  if (failed) return failed;
  redirect(`/tenants/${id}`);
}

export async function updateTenantAction(tenantId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const parsed = parseForm(tenantSchema, form);
  if (!parsed.data) return parsed.state;
  const failed = await mutate(() => updateTenant(actorOf(s), z.uuid().parse(tenantId), parsed.data));
  if (failed) return failed;
  revalidatePath(`/tenants/${tenantId}`);
  return { ok: true };
}

export async function revealTenantIdAction(tenantId: string): Promise<{ value?: string | null; error?: string }> {
  const s = await requireCan("tenant.id.view");
  let value: string | null = null;
  const failed = await mutate(async () => {
    value = await revealTenantIdNumber(actorOf(s), z.uuid().parse(tenantId));
  });
  return failed ? { error: failed.error } : { value };
}
