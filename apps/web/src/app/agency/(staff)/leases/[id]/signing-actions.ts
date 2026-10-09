"use server";

import { cancelEnvelope, finishEnvelope, prepareSchema, resendInvitation, sendForSigning, SigningError } from "@awdrent/core/signing";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, formValues } from "@/server/forms";
import { requireCan } from "@/server/session";
import { writeGuard } from "@/server/writes";

const page = (leaseId: string) => `/leases/${leaseId}`;

async function run(leaseId: string, fn: () => Promise<void>, form?: FormData): Promise<FormState> {
  try {
    const failed = await mutate(fn);
    if (failed) return failed;
  } catch (err) {
    if (err instanceof SigningError) return { error: err.message, values: form ? formValues(form) : undefined };
    throw err;
  }
  revalidatePath(page(leaseId));
  return { ok: true };
}

export async function sendForSigningAction(leaseId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("documents.prepare");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const parsed = prepareSchema.safeParse(formValues(form));
  if (!parsed.success) return { error: "Choose who signs.", values: formValues(form) };
  return run(leaseId, async () => void (await sendForSigning(actorOf(s), z.uuid().parse(leaseId), parsed.data)), form);
}

export async function cancelEnvelopeAction(leaseId: string, envelopeId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("documents.prepare");
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 3) return { fieldErrors: { reason: "Say why" } };
  return run(leaseId, () => cancelEnvelope(actorOf(s), z.uuid().parse(envelopeId), reason));
}

export async function resendInvitationAction(leaseId: string, signerId: string): Promise<void> {
  const s = await requireCan("documents.prepare");
  if (s.ctx.readOnly) return;
  await run(leaseId, () => resendInvitation(actorOf(s), z.uuid().parse(signerId)));
}

export async function finishEnvelopeAction(leaseId: string, envelopeId: string): Promise<void> {
  const s = await requireCan("documents.prepare");
  if (s.ctx.readOnly) return;
  await run(leaseId, () => finishEnvelope(actorOf(s), z.uuid().parse(envelopeId)));
}
