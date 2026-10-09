"use server";

import { resetLeaseTemplate, saveLeaseTemplate, SigningError } from "@awdrent/core/signing";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { actorOf, mutate } from "@/server/actor";
import type { FormState } from "@/server/forms";
import { requireCan } from "@/server/session";
import { writeGuard } from "@/server/writes";

export async function saveLeaseTemplateAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("settings.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  let sections: unknown;
  try {
    sections = JSON.parse(String(form.get("sections") ?? "[]"));
  } catch {
    return { error: "The template could not be read. Reload the page and try again." };
  }
  try {
    const failed = await mutate(() => saveLeaseTemplate(actorOf(s), sections as { heading: string; body: string }[]));
    if (failed) return failed;
  } catch (err) {
    if (err instanceof SigningError) return { error: err.message };
    if (err instanceof ZodError) return { error: "Every clause needs a heading and text (up to 6 000 characters), and there can be at most 60 clauses." };
    throw err;
  }
  revalidatePath("/settings/lease-template");
  return { ok: true };
}

export async function resetLeaseTemplateAction(): Promise<void> {
  const s = await requireCan("settings.manage");
  if (s.ctx.readOnly) return;
  await mutate(() => resetLeaseTemplate(actorOf(s)));
  revalidatePath("/settings/lease-template");
}
