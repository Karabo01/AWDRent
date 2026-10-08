"use server";

import { resetWording, saveWording, WordingError } from "@awdrent/core/messages";
import { revalidatePath } from "next/cache";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, formValues } from "@/server/forms";
import { requireCan } from "@/server/session";
import { writeGuard } from "@/server/writes";

const channelOf = (v: unknown) => (v === "sms" ? "sms" : "email");

export async function saveWordingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("settings.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const values = formValues(form);
  const channel = channelOf(values.channel);
  try {
    const failed = await mutate(() =>
      saveWording(actorOf(s), { key: values.key ?? "", channel, subject: channel === "email" ? (values.subject ?? "") : null, body: values.body ?? "" }),
    );
    if (failed) return failed;
  } catch (err) {
    if (err instanceof WordingError) return { error: err.problems.join(" "), values };
    throw err;
  }
  revalidatePath("/settings/messages");
  return { ok: true };
}

export async function resetWordingAction(form: FormData): Promise<void> {
  const s = await requireCan("settings.manage");
  if (s.ctx.readOnly) return;
  await mutate(() => resetWording(actorOf(s), String(form.get("key") ?? ""), channelOf(form.get("channel"))));
  revalidatePath("/settings/messages");
}
