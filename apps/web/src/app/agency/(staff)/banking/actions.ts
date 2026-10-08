"use server";

import { allocateLine, BankImportError, ignoreLine, importStatement, profileSchema, saveProfile, unallocateLine } from "@awdrent/core/banking";
import { LedgerRuleError } from "@awdrent/core/ledger";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, formValues, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";

export interface ImportResultState extends FormState {
  problems?: string[];
  summary?: string;
}

const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;

export async function importStatementAction(_prev: ImportResultState, form: FormData): Promise<ImportResultState> {
  const s = await requireCan("payments.approve");
  const profileId = z.uuid().safeParse(form.get("profileId"));
  const file = form.get("file");
  if (!profileId.success) return { error: "Choose the import profile for this bank." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the statement file (CSV)." };
  if (file.size > MAX_STATEMENT_BYTES) return { error: "Statements can be at most 5 MB. Export a shorter period." };
  let summary = "";
  try {
    const failed = await mutate(async () => {
      const r = await importStatement(actorOf(s), { profileId: profileId.data, fileName: file.name, csv: await file.text() });
      summary =
        `${r.creditLines} money-in line${r.creditLines === 1 ? "" : "s"} read: ${r.newLines} new, ${r.autoMatched} matched to leases automatically` +
        (r.newLines - r.autoMatched > 0 ? `, ${r.newLines - r.autoMatched} waiting below` : "") +
        (r.debitsSkipped ? `. ${r.debitsSkipped} money-out line${r.debitsSkipped === 1 ? "" : "s"} skipped.` : ".");
    });
    if (failed) return failed;
  } catch (err) {
    if (err instanceof BankImportError) return { error: "Nothing was imported.", problems: err.problems.slice(0, 20) };
    throw err;
  }
  revalidatePath("/banking");
  revalidatePath("/leases", "layout");
  return { ok: true, summary };
}

async function lineChange(fn: () => Promise<void>): Promise<FormState> {
  try {
    const failed = await mutate(fn);
    if (failed) return failed;
  } catch (err) {
    if (err instanceof LedgerRuleError) return { error: err.message };
    throw err;
  }
  revalidatePath("/banking");
  return { ok: true };
}

export async function allocateLineAction(lineId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("payments.approve");
  const parsed = z.object({ leaseId: z.uuid("Choose a lease"), target: z.enum(["rent", "deposit"]) }).safeParse(formValues(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Choose a lease" };
  return lineChange(() => allocateLine(actorOf(s), z.uuid().parse(lineId), parsed.data.leaseId, parsed.data.target));
}

const reason = z.object({ reason: z.string().trim().min(3, "Give a short reason").max(200) });

export async function ignoreLineAction(lineId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("payments.approve");
  const parsed = parseForm(reason, form);
  if (!parsed.data) return parsed.state;
  return lineChange(() => ignoreLine(actorOf(s), z.uuid().parse(lineId), parsed.data.reason));
}

export async function unallocateLineAction(lineId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("payments.approve");
  const parsed = parseForm(reason, form);
  if (!parsed.data) return parsed.state;
  return lineChange(() => unallocateLine(actorOf(s), z.uuid().parse(lineId), parsed.data.reason));
}

export async function saveProfileAction(profileId: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("payments.approve");
  const parsed = parseForm(profileSchema, form);
  if (!parsed.data) return parsed.state;
  const failed = await mutate(async () => {
    await saveProfile(actorOf(s), parsed.data, profileId ? z.uuid().parse(profileId) : undefined);
  });
  if (failed) return failed;
  redirect("/banking");
}
