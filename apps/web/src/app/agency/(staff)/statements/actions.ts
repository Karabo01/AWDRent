"use server";

import { approveRun, issueStatements, prepareRun, setLettingFee, StatementError } from "@awdrent/core/statements";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import type { FormState } from "@/server/forms";
import { requireCan } from "@/server/session";
import { writeGuard } from "@/server/writes";

async function run(fn: () => Promise<unknown>): Promise<FormState | null> {
  try {
    return await mutate(async () => void (await fn()));
  } catch (err) {
    if (err instanceof StatementError) return { error: err.message };
    throw err;
  }
}

export async function prepareRunAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("statements.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  // <input type="month"> gives YYYY-MM
  const month = String(form.get("month") ?? "");
  let runId = "";
  const failed = await run(async () => (runId = await prepareRun(actorOf(s), `${month}-01`)));
  if (failed) return failed;
  revalidatePath("/statements");
  redirect(`/statements/${runId}`);
}

export async function approveRunAction(runId: string, _prev: FormState): Promise<FormState> {
  const s = await requireCan("statements.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const failed = await run(() => approveRun(actorOf(s), z.uuid().parse(runId)));
  if (failed) return failed;
  revalidatePath(`/statements/${runId}`);
  return { ok: true };
}

export async function issueMissingAction(runId: string): Promise<void> {
  const s = await requireCan("statements.manage");
  if (s.ctx.readOnly) return;
  await issueStatements({ agencyId: s.ctx.agencyId, userId: s.user.id }, z.uuid().parse(runId));
  revalidatePath(`/statements/${runId}`);
}

export async function setLettingFeeAction(leaseId: string, applies: boolean, _prev: FormState): Promise<FormState> {
  const s = await requireCan("statements.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const failed = await run(() => setLettingFee(actorOf(s), z.uuid().parse(leaseId), applies));
  if (failed) return failed;
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true };
}
