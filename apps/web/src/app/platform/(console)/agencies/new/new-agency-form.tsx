"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { createAgencyAction } from "../../actions";

export function NewAgencyForm() {
  const [state, action, pending] = useActionState(createAgencyAction, {});
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <Field name="name" label="Agency name" state={state} required />
      <Field
        name="subdomain"
        label="Address"
        hint="Becomes {address}.awdrent.co.za. Lowercase letters, digits and dashes. Cannot be changed later."
        state={state}
        required
      />
      <Field
        name="eftPrefix"
        label="EFT reference prefix"
        hint="2–4 capital letters, e.g. KL gives references like KL-0042. Cannot be changed once leases exist."
        state={state}
        required
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="plan" label="Plan" defaultValue="standard" state={state} required />
        <Field name="includedUnits" label="Included units" type="number" min={0} defaultValue={0} state={state} required />
        <Field name="includedSms" label="Included SMS / month" type="number" min={0} defaultValue={0} state={state} required />
      </div>
      <Separator />
      <p className="text-sm font-medium">First admin</p>
      <Field name="adminName" label="Full name" state={state} required />
      <Field name="adminEmail" label="Email" type="email" state={state} required />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? "Creating…" : "Create agency and send invite"}
      </Button>
    </form>
  );
}
