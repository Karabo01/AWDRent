"use server";

import { agencySettingsSchema, updateAgencySettings } from "@awdrent/core/agency-settings";
import { revalidatePath } from "next/cache";
import { type FormState, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";
import { readOnlyError, writeGuard } from "@/server/writes";

export async function updateSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("settings.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const parsed = parseForm(agencySettingsSchema, form);
  if (!parsed.data) return parsed.state;
  try {
    await updateAgencySettings(s.ctx, parsed.data);
  } catch (err) {
    const state = readOnlyError(err);
    if (state) return state;
    throw err;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
