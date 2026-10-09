"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import { detailsAction, submitAction } from "./actions";

export function DetailsForm({
  token,
  values,
}: {
  token: string;
  values: { fullName: string; email: string | null; phone: string | null; idKind: string | null; idNumberLast4: string | null; employer: string | null; currentAddress: string | null };
}) {
  const [state, action, pending] = useActionState(detailsAction.bind(null, token), {});
  return (
    <form action={action} className="grid gap-3">
      <Field name="fullName" label="Full name" defaultValue={values.fullName} state={state} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="idKind"
          label="Identity document"
          options={[
            { value: "sa_id", label: "South African ID" },
            { value: "passport", label: "Passport" },
          ]}
          defaultValue={values.idKind ?? "sa_id"}
          state={state}
        />
        <Field
          name="idNumber"
          label="ID or passport number"
          hint={values.idNumberLast4 ? `Saved (ends ${values.idNumberLast4}). Leave empty to keep it.` : "Stored encrypted."}
          state={state}
          autoComplete="off"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="email" label="Email" type="email" defaultValue={values.email} state={state} />
        <Field name="phone" label="Mobile number" type="tel" defaultValue={values.phone} state={state} />
      </div>
      <Field name="employer" label="Employer (or your business)" defaultValue={values.employer} state={state} />
      <Field name="currentAddress" label="Current address" defaultValue={values.currentAddress} state={state} />
      <FormMessage state={state} />
      <Button type="submit" variant="outline" disabled={pending} className="justify-self-start">
        Save my details
      </Button>
    </form>
  );
}

export function SubmitForm({ token, canSubmit }: { token: string; canSubmit: boolean }) {
  const [state, action, pending] = useActionState(submitAction.bind(null, token), {});
  return (
    <form action={action} className="grid gap-2">
      <Button type="submit" disabled={!canSubmit || pending} className="justify-self-start">
        Submit my application
      </Button>
      {!canSubmit ? <p className="text-xs text-muted-foreground">Save your details and add a file for every required document first.</p> : null}
      <FormMessage state={state} />
    </form>
  );
}
