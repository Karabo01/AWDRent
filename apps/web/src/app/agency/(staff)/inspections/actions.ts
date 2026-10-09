"use server";

import { addItem, completeInspection, deleteDraftInspection, fileMissingReport, InspectionError, itemsSchema, saveInspection, startInspection } from "@awdrent/core/inspections";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, formValues, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";
import { writeGuard } from "@/server/writes";

async function run(fn: () => Promise<unknown>, form?: FormData): Promise<FormState | null> {
  try {
    return await mutate(async () => void (await fn()));
  } catch (err) {
    if (err instanceof InspectionError) return { error: err.message, values: form ? formValues(form) : undefined };
    throw err;
  }
}

const isoDate = z.iso.date("Enter a date");

export async function startInspectionAction(leaseId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("inspections.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const parsed = parseForm(z.object({ kind: z.enum(["ingoing", "outgoing"]), inspectedOn: isoDate }), form);
  if (!parsed.data) return parsed.state;
  let id = "";
  const failed = await run(async () => (id = await startInspection(actorOf(s), z.uuid().parse(leaseId), parsed.data.kind, parsed.data.inspectedOn)), form);
  if (failed) return failed;
  redirect(`/inspections/${id}`);
}

const detailsSchema = z.object({
  inspectedOn: isoDate,
  attendees: z
    .string()
    .trim()
    .max(500)
    .transform((s) => s || null),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => s || null),
});

/** Saves the whole sheet; with intent=complete, then completes it (report filed and emailed). */
export async function saveInspectionAction(inspectionId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("inspections.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const id = z.uuid().parse(inspectionId);
  const parsed = parseForm(detailsSchema, form);
  if (!parsed.data) return parsed.state;
  // Items arrive as condition:<id> and notes:<id>
  const ids = [...form.keys()].filter((k) => k.startsWith("notes:")).map((k) => k.slice(6));
  const items = itemsSchema.safeParse(
    ids.map((itemId) => ({ id: itemId, condition: (form.get(`condition:${itemId}`) as string) || null, notes: (form.get(`notes:${itemId}`) as string) ?? "" })),
  );
  if (!items.success) return { error: "Some items could not be read. Reload the page and try again.", values: formValues(form) };
  const complete = form.get("intent") === "complete";
  const failed = await run(async () => {
    await saveInspection(actorOf(s), id, { items: items.data, ...parsed.data });
    if (complete) await completeInspection(actorOf(s), id);
  }, form);
  if (failed) return failed;
  revalidatePath(`/inspections/${id}`);
  return { ok: true };
}

export async function addItemAction(inspectionId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("inspections.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const parsed = parseForm(
    z.object({ room: z.string().trim().min(1, "Enter the room").max(80), item: z.string().trim().min(1, "Enter the item").max(120) }),
    form,
  );
  if (!parsed.data) return parsed.state;
  const id = z.uuid().parse(inspectionId);
  const failed = await run(() => addItem(actorOf(s), id, parsed.data.room, parsed.data.item), form);
  if (failed) return failed;
  revalidatePath(`/inspections/${id}`);
  return { ok: true };
}

export async function deleteInspectionAction(inspectionId: string, leaseId: string, _prev: FormState): Promise<FormState> {
  const s = await requireCan("inspections.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const failed = await run(() => deleteDraftInspection(actorOf(s), z.uuid().parse(inspectionId)));
  if (failed) return failed;
  redirect(`/leases/${z.uuid().parse(leaseId)}#inspections`);
}

export async function fileReportAction(inspectionId: string, _prev: FormState): Promise<FormState> {
  const s = await requireCan("inspections.manage");
  const blocked = writeGuard(s);
  if (blocked) return blocked;
  const id = z.uuid().parse(inspectionId);
  const failed = await run(() => fileMissingReport(actorOf(s), id));
  if (failed) return failed;
  revalidatePath(`/inspections/${id}`);
  return { ok: true };
}
