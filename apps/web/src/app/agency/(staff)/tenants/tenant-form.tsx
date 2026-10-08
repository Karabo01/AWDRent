"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/server/forms";
import { createTenantAction, updateTenantAction } from "./actions";

export interface TenantFormValues {
  fullName: string;
  idKind: string;
  idNumberMasked: string | null;
  email: string | null;
  phone: string | null;
  employer: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  consentAt: string | null;
  emailOptIn: boolean;
  smsOptIn: boolean;
  whatsappOptIn: boolean;
  notes: string | null;
}

function Check({ name, label, checked, state }: { name: string; label: string; checked: boolean; state: FormState }) {
  const fromState = state.values ? state.values[name] === "on" : undefined;
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={fromState ?? checked} />
      {label}
    </label>
  );
}

export function TenantForm({ tenantId, values }: { tenantId?: string; values?: TenantFormValues }) {
  const action = tenantId ? updateTenantAction.bind(null, tenantId) : createTenantAction;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="grid gap-4">
      <Field name="fullName" label="Full name" defaultValue={values?.fullName} state={state} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="idKind"
          label="Identity document"
          defaultValue={values?.idKind ?? "sa_id"}
          state={state}
          options={[
            { value: "sa_id", label: "South African ID" },
            { value: "passport", label: "Passport" },
          ]}
        />
        <Field
          name="idNumber"
          label="ID / passport number"
          autoComplete="off"
          state={state}
          hint={values?.idNumberMasked ? `On file: ${values.idNumberMasked}. Leave empty to keep it.` : "Stored encrypted."}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="email" label="Email" type="email" defaultValue={values?.email} state={state} />
        <Field name="phone" label="Mobile number" type="tel" defaultValue={values?.phone} state={state} />
      </div>
      <Field name="employer" label="Employer" defaultValue={values?.employer} state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="emergencyContactName" label="Emergency contact" defaultValue={values?.emergencyContactName} state={state} />
        <Field name="emergencyContactPhone" label="Emergency contact number" type="tel" defaultValue={values?.emergencyContactPhone} state={state} />
      </div>
      <fieldset className="grid gap-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Consent and messages (POPIA)</legend>
        <Check
          name="consentGiven"
          label={
            values?.consentAt
              ? `Tenant consented to processing of their information (recorded ${values.consentAt})`
              : "Tenant has consented to processing of their information for this lease"
          }
          checked={Boolean(values?.consentAt)}
          state={state}
        />
        <p className="text-xs text-muted-foreground">Channels the tenant agreed to receive rent reminders and receipts on:</p>
        <div className="flex flex-wrap gap-4">
          <Check name="emailOptIn" label="Email messages" checked={values?.emailOptIn ?? true} state={state} />
          <Check name="smsOptIn" label="SMS messages" checked={values?.smsOptIn ?? false} state={state} />
          <Check name="whatsappOptIn" label="WhatsApp messages" checked={values?.whatsappOptIn ?? false} state={state} />
        </div>
        {state.fieldErrors?.consentGiven ? <p className="text-sm text-destructive">{state.fieldErrors.consentGiven}</p> : null}
      </fieldset>
      <Field name="notes" label="Notes" defaultValue={values?.notes} state={state} multiline />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        {tenantId ? "Save tenant" : "Create tenant"}
      </Button>
    </form>
  );
}
