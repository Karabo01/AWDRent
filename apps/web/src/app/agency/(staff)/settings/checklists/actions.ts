"use server";

import { type ApplicantType, resetChecklist, saveChecklist } from "@awdrent/core/onboarding";
import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { actorOf, mutate } from "@/server/actor";
import type { FormState } from "@/server/forms";
import { requireCan } from "@/server/session";
import { writeGuard } from "@/server/writes";

const typeSchema = z.enum(["employed", "self_employed", "company"]);

export async function saveChecklistAction(type: ApplicantType, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("settings.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  let items: unknown;
  try {
    items = JSON.parse(String(form.get("items") ?? "[]"));
  } catch {
    return { error: "The checklist could not be read. Reload the page and try again." };
  }
  try {
    const failed = await mutate(() => saveChecklist(actorOf(s), typeSchema.parse(type), items as never));
    if (failed) return failed;
  } catch (err) {
    if (err instanceof ZodError) return { error: "Each item needs a name (2 to 120 characters); a checklist has 1 to 15 items." };
    throw err;
  }
  revalidatePath("/settings/checklists");
  return { ok: true };
}

export async function resetChecklistAction(type: ApplicantType): Promise<void> {
  const s = await requireCan("settings.manage");
  if (s.ctx.readOnly) return;
  await mutate(() => resetChecklist(actorOf(s), typeSchema.parse(type)));
  revalidatePath("/settings/checklists");
}
