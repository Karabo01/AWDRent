"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { convertEmailAction, dismissEmailAction } from "./actions";

/** Complete an emailed proof of payment: lease, amount and date, prefilled from what the email said. */
export function ConvertEmailForm({ emailId, eftReference, amount, paidOn }: { emailId: string; eftReference: string; amount: string; paidOn: string }) {
  const [state, action, pending] = useActionState(convertEmailAction.bind(null, emailId), {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <Field name="eftReference" label="Payment reference" defaultValue={eftReference} state={state} required />
      <Field name="amount" label="Amount paid (R)" inputMode="decimal" defaultValue={amount} state={state} required />
      <Field name="paidOn" label="Date paid" type="date" defaultValue={paidOn} state={state} required />
      <input type="hidden" name="reference" value="" />
      <Button type="submit" disabled={pending}>
        Create proof of payment
      </Button>
      <div className="sm:col-span-4">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function DismissEmailForm({ emailId }: { emailId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(dismissEmailAction.bind(null, emailId), {});
  if (!open) {
    return (
      <button type="button" className="justify-self-start text-sm text-muted-foreground underline" onClick={() => setOpen(true)}>
        Not a proof of payment? Dismiss
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field name="note" label="Why dismiss?" state={state} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Dismiss
      </Button>
    </form>
  );
}
