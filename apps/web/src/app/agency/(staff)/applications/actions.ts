"use server";

import {
  ApplicationError,
  approveApplication,
  declineApplication,
  inviteApplicant,
  inviteSchema,
  resendApplication,
  reviewFile,
  revokeApplication,
} from "@awdrent/core/onboarding";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";
import { writeGuard } from "@/server/writes";

async function run(fn: () => Promise<unknown>): Promise<FormState | null> {
  try {
    return await mutate(async () => void (await fn()));
  } catch (err) {
    if (err instanceof ApplicationError) return { error: err.message };
    throw err;
  }
}

export async function inviteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("applications.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const parsed = parseForm(inviteSchema, form);
  if (!parsed.data) return parsed.state;
  let id = "";
  const failed = await run(async () => (id = await inviteApplicant(actorOf(s), parsed.data)));
  if (failed) return failed;
  redirect(`/applications/${id}`);
}

export async function reviewFileAction(applicationId: string, fileId: string, accept: boolean, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("applications.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const reason = String(form.get("reason") ?? "").trim();
  if (!accept && reason.length < 3) return { fieldErrors: { reason: "Say what is wrong, so the applicant can fix it" } };
  const failed = await run(() => reviewFile(actorOf(s), z.uuid().parse(fileId), accept ? { accept: true } : { accept: false, reason: reason.slice(0, 300) }));
  if (failed) return failed;
  revalidatePath(`/applications/${applicationId}`);
  return { ok: true };
}

export async function decideAction(applicationId: string, decision: "approve" | "decline" | "revoke" | "resend", _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("applications.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const id = z.uuid().parse(applicationId);
  const actor = actorOf(s);
  let leaseId: string | null = null;
  const failed = await run(async () => {
    if (decision === "approve") leaseId = (await approveApplication(actor, id)).leaseId;
    else if (decision === "decline") {
      const reason = String(form.get("reason") ?? "").trim();
      if (reason.length < 3) throw new ApplicationError("Note why (kept internal; the applicant gets a courteous notice).");
      await declineApplication(actor, id, reason.slice(0, 500));
    } else if (decision === "revoke") await revokeApplication(actor, id);
    else await resendApplication(actor, id);
  });
  if (failed) return failed;
  if (leaseId) redirect(`/leases/${leaseId}`);
  revalidatePath(`/applications/${applicationId}`);
  return { ok: true };
}
