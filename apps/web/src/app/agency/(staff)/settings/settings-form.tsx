"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { updateSettingsAction } from "./actions";

export function SettingsForm({
  values,
}: {
  values: {
    name: string;
    brandColour: string;
    trustBankName: string;
    trustAccountHolder: string | null;
    trustBranchCode: string | null;
    trustAccountMasked: string;
    quietHoursStart: string;
    quietHoursEnd: string;
    applicationLinkDays: number;
    applicationRetentionDays: number;
    legalName: string | null;
    registrationNo: string | null;
    ffcNumber: string | null;
    vatNumber: string | null;
    physicalAddress: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
  };
}) {
  const [state, action, pending] = useActionState(updateSettingsAction, {});
  return (
    <form action={action} className="grid gap-4">
      <Field name="name" label="Agency name" defaultValue={values.name} state={state} required />
      <Field
        name="brandColour"
        label="Brand colour"
        type="color"
        className="h-10 w-20 p-1"
        defaultValue={values.brandColour}
        state={state}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="trustBankName" label="Trust account bank" defaultValue={values.trustBankName} state={state} />
        <Field
          name="trustAccountNo"
          label="Trust account number"
          hint={`Current: ${values.trustAccountMasked}. Leave empty to keep it.`}
          inputMode="numeric"
          autoComplete="off"
          state={state}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="trustAccountHolder" label="Account holder" hint="As the bank shows it" defaultValue={values.trustAccountHolder} state={state} />
        <Field name="trustBranchCode" label="Branch code" inputMode="numeric" defaultValue={values.trustBranchCode} state={state} />
      </div>
      <p className="text-xs text-muted-foreground">
        Tenants are shown the trust account for rent payments, and its statements are imported for matching.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="quietHoursStart" label="No messages after" type="time" defaultValue={values.quietHoursStart} state={state} />
        <Field name="quietHoursEnd" label="Until" type="time" defaultValue={values.quietHoursEnd} state={state} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="applicationLinkDays" label="Application links last (days)" type="number" min={1} max={60} defaultValue={values.applicationLinkDays} state={state} />
        <Field
          name="applicationRetentionDays"
          label="Keep documents of applications that did not proceed (days)"
          type="number"
          min={30}
          max={365}
          defaultValue={values.applicationRetentionDays}
          state={state}
        />
      </div>
      <fieldset className="grid gap-4 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Business details on receipts, statements and letters</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="legalName" label="Registered name" defaultValue={values.legalName} state={state} />
          <Field name="registrationNo" label="Company registration number" defaultValue={values.registrationNo} state={state} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="ffcNumber" label="Fidelity Fund Certificate number" hint="From the PPRA; shown on every document" defaultValue={values.ffcNumber} state={state} />
          <Field name="vatNumber" label="VAT number" defaultValue={values.vatNumber} state={state} />
        </div>
        <Field name="physicalAddress" label="Office address" defaultValue={values.physicalAddress} state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="contactPhone" label="Office phone" type="tel" defaultValue={values.contactPhone} state={state} />
          <Field name="contactEmail" label="Office email" type="email" defaultValue={values.contactEmail} state={state} />
        </div>
      </fieldset>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        Save settings
      </Button>
    </form>
  );
}
