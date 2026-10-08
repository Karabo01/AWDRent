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
    trustAccountMasked: string;
    quietHoursStart: string;
    quietHoursEnd: string;
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
      <p className="text-xs text-muted-foreground">
        Tenants are shown the trust account for rent payments, and its statements are imported for matching.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="quietHoursStart" label="No messages after" type="time" defaultValue={values.quietHoursStart} state={state} />
        <Field name="quietHoursEnd" label="Until" type="time" defaultValue={values.quietHoursEnd} state={state} />
      </div>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        Save settings
      </Button>
    </form>
  );
}
