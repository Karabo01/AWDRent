"use server";

import {
  createProperty,
  createUnit,
  DuplicateUnitError,
  propertySchema,
  setPropertyAgents,
  setPropertyArchived,
  unitSchema,
  updateProperty,
  updateUnit,
} from "@awdrent/core/properties";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { type FormState, formValues, parseForm } from "@/server/forms";
import { requireCan } from "@/server/session";

export async function createPropertyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const parsed = parseForm(propertySchema, form);
  if (!parsed.data) return parsed.state;
  let id = "";
  const failed = await mutate(async () => {
    id = await createProperty(actorOf(s), parsed.data);
  });
  if (failed) return failed;
  redirect(`/properties/${id}`);
}

export async function updatePropertyAction(propertyId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const parsed = parseForm(propertySchema, form);
  if (!parsed.data) return parsed.state;
  const failed = await mutate(() => updateProperty(actorOf(s), z.uuid().parse(propertyId), parsed.data));
  if (failed) return failed;
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true };
}

export async function setPropertyArchivedAction(propertyId: string, archived: boolean): Promise<void> {
  const s = await requireCan("records.edit");
  await mutate(() => setPropertyArchived(actorOf(s), z.uuid().parse(propertyId), archived));
  revalidatePath(`/properties/${propertyId}`);
}

export async function createUnitAction(propertyId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const parsed = parseForm(unitSchema, form);
  if (!parsed.data) return parsed.state;
  try {
    const failed = await mutate(async () => {
      await createUnit(actorOf(s), z.uuid().parse(propertyId), parsed.data);
    });
    if (failed) return failed;
  } catch (err) {
    if (err instanceof DuplicateUnitError) return { fieldErrors: { label: err.message }, values: formValues(form) };
    throw err;
  }
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true };
}

export async function updateUnitAction(unitId: string, propertyId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("records.edit");
  const parsed = parseForm(unitSchema, form);
  if (!parsed.data) return parsed.state;
  try {
    const failed = await mutate(() => updateUnit(actorOf(s), z.uuid().parse(unitId), parsed.data));
    if (failed) return failed;
  } catch (err) {
    if (err instanceof DuplicateUnitError) return { fieldErrors: { label: err.message }, values: formValues(form) };
    throw err;
  }
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true };
}

export async function setPropertyAgentsAction(propertyId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const s = await requireCan("portfolio.assign");
  const ids = z.array(z.uuid()).parse(form.getAll("agentId"));
  const failed = await mutate(() => setPropertyAgents(actorOf(s), z.uuid().parse(propertyId), ids));
  if (failed) return failed;
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true };
}
