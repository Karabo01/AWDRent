"use server";

import { convertInboundEmail, dismissInboundEmail, InboxError } from "@awdrent/core/inbox";
import { popClaimSchema } from "@awdrent/core/pops";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, formValues, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";
import { writeGuard } from "@/server/writes";

const convertSchema = popClaimSchema.extend({ eftReference: z.string().trim().min(2, "Enter the lease's payment reference").max(20) });

async function run(fn: () => Promise<unknown>, form: FormData): Promise<FormState> {
  try {
    const failed = await mutate(async () => void (await fn()));
    if (failed) return failed;
  } catch (err) {
    if (err instanceof InboxError) return { error: err.message, values: formValues(form) };
    throw err;
  }
  revalidatePath("/payments/inbox");
  revalidatePath("/payments");
  return { ok: true };
}

export async function convertEmailAction(emailId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("payments.approve");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const parsed = parseForm(convertSchema, form);
  if (!parsed.data) return parsed.state;
  const { eftReference, ...claim } = parsed.data;
  return run(() => convertInboundEmail(actorOf(s), z.uuid().parse(emailId), { eftReference, claim }), form);
}

export async function dismissEmailAction(emailId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("payments.approve");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const note = String(form.get("note") ?? "").trim();
  if (note.length < 3) return { fieldErrors: { note: "Say why, e.g. not a proof of payment" } };
  return run(() => dismissInboundEmail(actorOf(s), z.uuid().parse(emailId), note.slice(0, 300)), form);
}
