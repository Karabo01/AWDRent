"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import { UNIT_STATUS_OPTIONS } from "@/lib/labels";
import type { FormState } from "@/server/forms";
import {
  createPropertyAction,
  createUnitAction,
  setPropertyAgentsAction,
  updatePropertyAction,
  updateUnitAction,
} from "./actions";

const TYPES = [
  { value: "house", label: "House" },
  { value: "apartment_block", label: "Block of flats" },
  { value: "complex", label: "Townhouse complex" },
  { value: "commercial", label: "Commercial" },
  { value: "mixed_use", label: "Mixed use" },
  { value: "other", label: "Other" },
];

const PROVINCES = [
  "",
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
].map((p) => ({ value: p, label: p || "—" }));

export interface PropertyFormValues {
  ownerId: string;
  name: string;
  type: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string | null;
  city: string;
  province: string | null;
  postalCode: string | null;
  notes: string | null;
}

export function PropertyForm({
  propertyId,
  values,
  owners,
}: {
  propertyId?: string;
  values?: Partial<PropertyFormValues>;
  owners: { id: string; name: string }[];
}) {
  const action = propertyId ? updatePropertyAction.bind(null, propertyId) : createPropertyAction;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="grid gap-4">
      <SelectField
        name="ownerId"
        label="Owner"
        defaultValue={values?.ownerId ?? ""}
        state={state}
        options={[{ value: "", label: "Choose an owner…" }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Property name" hint="e.g. 12 Oak Street, or Sunset Court" defaultValue={values?.name} state={state} required />
        <SelectField name="type" label="Type" options={TYPES} defaultValue={values?.type ?? "house"} state={state} />
      </div>
      <Field name="addressLine1" label="Street address" defaultValue={values?.addressLine1} state={state} required />
      <Field name="addressLine2" label="Address line 2" defaultValue={values?.addressLine2} state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="suburb" label="Suburb" defaultValue={values?.suburb} state={state} />
        <Field name="city" label="City / town" defaultValue={values?.city} state={state} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField name="province" label="Province" options={PROVINCES} defaultValue={values?.province ?? ""} state={state} />
        <Field name="postalCode" label="Postal code" inputMode="numeric" defaultValue={values?.postalCode} state={state} />
      </div>
      <Field name="notes" label="Notes" defaultValue={values?.notes} state={state} multiline />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        {propertyId ? "Save property" : "Create property"}
      </Button>
    </form>
  );
}

export function UnitForm({
  propertyId,
  unitId,
  values,
}: {
  propertyId: string;
  unitId?: string;
  values?: { label: string; bedrooms: number | null; bathrooms: number | null; status: string; notes: string | null };
}) {
  const action = unitId ? updateUnitAction.bind(null, unitId, propertyId) : createUnitAction.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_2fr_auto] sm:items-end">
      <Field name="label" label="Unit" hint={unitId ? undefined : "e.g. Flat 4, Main house"} defaultValue={values?.label} state={state} required />
      <Field name="bedrooms" label="Beds" type="number" min={0} defaultValue={values?.bedrooms} state={state} />
      <Field name="bathrooms" label="Baths" type="number" min={0} defaultValue={values?.bathrooms} state={state} />
      <SelectField name="status" label="Status" options={UNIT_STATUS_OPTIONS} defaultValue={values?.status ?? "vacant"} state={state} />
      <input type="hidden" name="notes" value={values?.notes ?? ""} />
      <Button type="submit" variant={unitId ? "outline" : "default"} disabled={pending}>
        {unitId ? "Save" : "Add unit"}
      </Button>
      <div className="sm:col-span-5">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function AgentsForm({
  propertyId,
  agents,
  assigned,
}: {
  propertyId: string;
  agents: { id: string; name: string }[];
  assigned: string[];
}) {
  const [state, action, pending] = useActionState(setPropertyAgentsAction.bind(null, propertyId), {});
  if (agents.length === 0) return <p className="text-sm text-muted-foreground">No active rental agents. Invite one from Staff.</p>;
  return (
    <form action={action} className="grid gap-3">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm text-muted-foreground">Agents who manage this property</legend>
        {agents.map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="agentId" value={a.id} defaultChecked={assigned.includes(a.id)} />
            {a.name}
          </label>
        ))}
      </fieldset>
      <FormMessage state={state} />
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="justify-self-start">
        Save agents
      </Button>
    </form>
  );
}
