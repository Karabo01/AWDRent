"use server";

import { pauseReminders, PauseError, pauseSchema, resumeReminders } from "@awdrent/core/notices";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, formValues, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";

export async function pauseRemindersAction(leaseId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("reminders.pause");
  const parsed = parseForm(pauseSchema, form);
  if (!parsed.data) return parsed.state;
  try {
    const failed = await mutate(() => pauseReminders(actorOf(s), z.uuid().parse(leaseId), parsed.data));
    if (failed) return failed;
  } catch (err) {
    if (err instanceof PauseError) return { error: err.message, values: formValues(form) };
    throw err;
  }
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true };
}

export async function resumeRemindersAction(leaseId: string): Promise<void> {
  const s = await requireCan("reminders.pause");
  if (s.ctx.readOnly) return;
  await mutate(() => resumeReminders(actorOf(s), z.uuid().parse(leaseId)));
  revalidatePath(`/leases/${leaseId}`);
}
