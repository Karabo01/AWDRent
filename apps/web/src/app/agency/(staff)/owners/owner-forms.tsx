"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/server/forms";
import { createOwnerAction, setOwnerPortalAction, updateOwnerAction, updateOwnerBankAction } from "./actions";

export interface OwnerFormValues {
  kind: string;
  name: string;
  idOrRegNoMasked: string | null;
  email: string | null;
  phone: string | null;
  postalAddress: string | null;
  commissionModel: "first_month" | "percent";
  commissionPercent: string;
  vatRegistered: boolean;
  vatNumber: string | null;
  notes: string | null;
}

export function OwnerForm({ ownerId, values }: { ownerId?: string; values?: OwnerFormValues }) {
  const action = ownerId ? updateOwnerAction.bind(null, ownerId) : createOwnerAction;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="kind"
          label="Owner type"
          defaultValue={values?.kind ?? "individual"}
          state={state}
          options={[
            { value: "individual", label: "Individual" },
            { value: "company", label: "Company" },
            { value: "trust", label: "Trust" },
          ]}
        />
        <Field name="name" label="Full name or registered name" defaultValue={values?.name} state={state} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="idKind"
          label="Identity document"
          defaultValue="sa_id"
          state={state}
          options={[
            { value: "sa_id", label: "South African ID" },
            { value: "other", label: "Passport or registration number" },
          ]}
          hint="Companies and trusts always use their registration number."
        />
        <Field
          name="idOrRegNo"
          label="ID / registration number"
          state={state}
          autoComplete="off"
          hint={values?.idOrRegNoMasked ? `On file: ${values.idOrRegNoMasked}. Leave empty to keep it.` : "Stored encrypted."}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="email" label="Email" type="email" defaultValue={values?.email} state={state} />
        <Field name="phone" label="Phone" type="tel" defaultValue={values?.phone} state={state} />
      </div>
      <Field name="postalAddress" label="Postal address" defaultValue={values?.postalAddress} state={state} multiline />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          name="commissionModel"
          label="Agency is paid"
          options={[
            { value: "first_month", label: "The first month's rent of each new lease" },
            { value: "percent", label: "A percentage of rent collected" },
          ]}
          defaultValue={values?.commissionModel ?? "first_month"}
          state={state}
        />
        <Field
          name="commissionPercent"
          label="Percentage (if paid that way)"
          inputMode="decimal"
          defaultValue={values?.commissionPercent ?? ""}
          state={state}
        />
        <SelectField
          name="vatRegistered"
          label="VAT registered"
          defaultValue={String(values?.vatRegistered ?? false)}
          state={state}
          options={[
            { value: "false", label: "No" },
            { value: "true", label: "Yes" },
          ]}
        />
        <Field name="vatNumber" label="VAT number" defaultValue={values?.vatNumber} state={state} />
      </div>
      <Field name="notes" label="Notes" defaultValue={values?.notes} state={state} multiline />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        {ownerId ? "Save owner" : "Create owner"}
      </Button>
    </form>
  );
}

export function OwnerBankForm({
  ownerId,
  values,
}: {
  ownerId: string;
  values: { bankName: string | null; bankBranchCode: string | null; bankAccountHolder: string | null; accountMasked: string };
}) {
  const [state, action, pending] = useActionState(updateOwnerBankAction.bind(null, ownerId), {});
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="bankName" label="Bank" defaultValue={values.bankName} state={state} required />
        <Field name="bankBranchCode" label="Branch code" inputMode="numeric" defaultValue={values.bankBranchCode} state={state} required />
      </div>
      <Field name="bankAccountHolder" label="Account holder" defaultValue={values.bankAccountHolder} state={state} required />
      <Field
        name="bankAccountNo"
        label="Account number"
        inputMode="numeric"
        autoComplete="off"
        hint={`On file: ${values.accountMasked}. Leave empty to keep it.`}
        state={state}
      />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        Save bank details
      </Button>
    </form>
  );
}

export function OwnerPortalToggle({ ownerId, enabled }: { ownerId: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(setOwnerPortalAction.bind(null, ownerId, !enabled), {});
  return (
    <form action={action} className="grid gap-2">
      <Button type="submit" variant="outline" size="sm" disabled={pending} className="justify-self-start">
        {enabled ? "Switch the owner portal off" : "Switch the owner portal on"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
