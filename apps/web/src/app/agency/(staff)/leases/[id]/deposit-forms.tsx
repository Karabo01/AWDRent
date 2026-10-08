"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import { depositDeductionAction, depositMoneyAction, voidDepositEntryAction } from "../actions";

const MONEY_LABELS = {
  received: { button: "Record deposit received", reference: "Bank reference", hint: "As it appears on the trust account statement" },
  interest: { button: "Record interest", reference: "Investment statement reference", hint: "Interest the investment account actually paid" },
  refund: { button: "Record refund paid", reference: "Payment reference", hint: "The EFT that paid the deposit back" },
} as const;

export function DepositMoneyForm({ leaseId, kind, today, amount }: { leaseId: string; kind: keyof typeof MONEY_LABELS; today: string; amount?: string }) {
  const [state, action, pending] = useActionState(depositMoneyAction.bind(null, leaseId, kind), {});
  const l = MONEY_LABELS[kind];
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end">
      <Field name="amount" label="Amount (R)" inputMode="decimal" defaultValue={amount} state={state} required />
      <Field name="date" label="Date" type="date" defaultValue={today} state={state} required />
      <Field name="reference" label={l.reference} hint={l.hint} state={state} required />
      <Button type="submit" variant="outline" disabled={pending}>
        {l.button}
      </Button>
      <div className="sm:col-span-4">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function DepositDeductionForm({ leaseId, today }: { leaseId: string; today: string }) {
  const [state, action, pending] = useActionState(depositDeductionAction.bind(null, leaseId), {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr] sm:items-end">
      <SelectField
        name="kind"
        label="Deduction"
        defaultValue="damage"
        state={state}
        options={[
          { value: "rent_arrears", label: "Unpaid rent (clears arrears)" },
          { value: "damage", label: "Damage" },
          { value: "cleaning", label: "Cleaning" },
          { value: "other", label: "Other" },
        ]}
      />
      <Field name="amount" label="Amount (R)" inputMode="decimal" state={state} required />
      <Field name="date" label="Date" type="date" defaultValue={today} state={state} required />
      <div className="sm:col-span-2">
        <Field name="description" label="Description" hint="Itemise it: the tenant sees this" state={state} required />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Record deduction
      </Button>
      <div className="sm:col-span-3">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function VoidDepositEntryButton({ leaseId, entryId }: { leaseId: string; entryId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(voidDepositEntryAction.bind(null, leaseId, entryId), {});
  if (!open) {
    return (
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setOpen(true)}>
        Void
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field name="reason" label="Reason for voiding" state={state} />
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        Void entry
      </Button>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
