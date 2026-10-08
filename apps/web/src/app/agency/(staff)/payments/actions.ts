"use server";

import { LedgerRuleError } from "@awdrent/core/ledger";
import { approvePop, rejectPop } from "@awdrent/core/pops";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";

async function review(fn: () => Promise<unknown>): Promise<FormState> {
  try {
    const failed = await mutate(async () => {
      await fn();
    });
    if (failed) return failed;
  } catch (err) {
    if (err instanceof LedgerRuleError) return { error: err.message };
    throw err;
  }
  revalidatePath("/payments");
  revalidatePath("/banking");
  return { ok: true };
}

export async function approvePopAction(popId: string, bankLineId: string, _prev: FormState): Promise<FormState> {
  const s = await requireCan("payments.approve");
  return review(() => approvePop(actorOf(s), z.uuid().parse(popId), z.uuid().parse(bankLineId)));
}

export async function rejectPopAction(popId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("payments.approve");
  const parsed = parseForm(z.object({ reason: z.string().trim().min(5, "Tell the tenant why").max(300) }), form);
  if (!parsed.data) return parsed.state;
  return review(() => rejectPop(actorOf(s), z.uuid().parse(popId), parsed.data.reason));
}
